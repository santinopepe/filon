import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createClient } from '@libsql/client';
import { abrirBD, MIGRACIONES } from '../servidor/db.js';

let dir;
before(() => (dir = mkdtempSync(join(tmpdir(), 'filon-migraciones-'))));
after(() => rmSync(dir, { recursive: true, force: true }));
const ruta = () => join(dir, `${Math.random().toString(36).slice(2)}.db`);
const ultima = MIGRACIONES.at(-1).version;

test('una base nueva queda con todas las migraciones registradas, en orden', async () => {
  const eventos = [];
  const db = await abrirBD(ruta(), { registro: { info: (e, d) => eventos.push({ e, ...d }), error() {} } });
  try {
    const versiones = (await db.all('SELECT version FROM migraciones ORDER BY version')).map((m) => m.version);
    assert.deepEqual(versiones, MIGRACIONES.map((m) => m.version));
    assert.equal(eventos.filter((x) => x.e === 'migracion').length, MIGRACIONES.length, 'cada migración deja un log');
    for (const tabla of ['admin_sesiones', 'limites', 'puntajes_desafio']) {
      assert.ok(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", tabla), `existe ${tabla}`);
    }
    const columnas = (await db.all('PRAGMA table_info(corridas)')).map((c) => c.name);
    assert.ok(columnas.includes('llamadas_ia') && columnas.includes('costo_estimado_usd'));
  } finally {
    db.close();
  }
});

test('una base con el esquema anterior (sin control de migraciones) se migra y conserva sus datos', async () => {
  const archivo = ruta();
  // Base creada como lo hacía la versión anterior: solo el esquema inicial, con una partida terminada.
  const vieja = createClient({ url: `file:${archivo}` });
  await vieja.executeMultiple(MIGRACIONES[0].multiple);
  await vieja.executeMultiple(`
    INSERT INTO desafios (id, fecha, numero, origen, publicado_en) VALUES (1, '2026-10-01', 1, 'reserva', 0);
    INSERT INTO jugadores (id, creado_en) VALUES ('j1', 0), ('j2', 0);
    INSERT INTO partidas (id, jugador_id, desafio_id, iniciada_en, terminada_en, puntos) VALUES ('p1', 'j1', 1, 0, 10, 300), ('p2', 'j2', 1, 0, 10, 300);
    INSERT INTO corridas (fecha_objetivo, iniciada_en) VALUES ('2026-10-01', 0);
  `);
  vieja.close();

  const db = await abrirBD(archivo);
  try {
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM migraciones')).n, MIGRACIONES.length);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM partidas')).n, 2, 'los datos siguen ahí');
    assert.deepEqual(await db.all('SELECT desafio_id, puntos, cantidad FROM puntajes_desafio'), [{ desafio_id: 1, puntos: 300, cantidad: 2 }], 'el histograma se completa con lo existente');
    assert.equal((await db.get('SELECT llamadas_ia FROM corridas')).llamadas_ia, 0, 'columnas nuevas con valor por defecto');
  } finally {
    db.close();
  }
  // Reabrir no vuelve a aplicar nada.
  const otra = await abrirBD(archivo);
  assert.equal((await otra.get('SELECT MAX(version) AS v FROM migraciones')).v, ultima);
  otra.close();
});

test('dos instancias que arrancan a la vez (en hilos separados) migran una sola vez sin errores', async () => {
  const archivo = ruta();
  const modulo = new URL('../servidor/db.js', import.meta.url).href;
  const arrancar = () =>
    new Promise((ok, mal) => {
      const w = new Worker(
        `const { parentPort, workerData } = require('node:worker_threads');
         import(workerData.modulo).then(async ({ abrirBD }) => {
           const db = await abrirBD(workerData.archivo);
           parentPort.postMessage((await db.get('SELECT COUNT(*) AS n FROM migraciones')).n);
           db.close();
         }).catch((e) => parentPort.postMessage('error: ' + e.message));`,
        { eval: true, workerData: { modulo, archivo } },
      );
      w.once('message', (m) => (w.terminate(), typeof m === 'number' ? ok(m) : mal(new Error(m))));
      w.once('error', mal);
    });
  const cuentas = await Promise.all([arrancar(), arrancar(), arrancar()]);
  assert.deepEqual(cuentas, [MIGRACIONES.length, MIGRACIONES.length, MIGRACIONES.length]);
  const db = await abrirBD(archivo);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM migraciones')).n, MIGRACIONES.length, 'ninguna quedó duplicada');
  db.close();
});

test('las migraciones son solo aditivas (compatibles con el código anterior durante un despliegue)', () => {
  for (const m of MIGRACIONES) {
    const texto = [m.multiple, ...(m.sentencias || []), m.aplicar?.toString()].filter(Boolean).join('\n');
    // Única excepción: las que declaran `reconstruye` pueden borrar y rehacer esas tablas (y su copia
    // temporal); la prueba siguiente comprueba que no pierden columnas, filas ni claves foráneas.
    const borradas = [...texto.matchAll(/\bDROP\s+(TABLE|COLUMN|INDEX)\s+(\w+)/gi)].map((x) => `${x[1].toUpperCase()} ${x[2]}`);
    const permitidas = (m.reconstruye || []).flatMap((t) => [`TABLE ${t}`, `TABLE ${t}_copia`]);
    assert.deepEqual(borradas.filter((b) => !permitidas.includes(b)), [], `la migración ${m.version} no borra estructuras`);
    assert.ok(!/RENAME\s+(TO|COLUMN)/i.test(texto), `la migración ${m.version} no renombra`);
  }
});

test('modos de juego: desafios se reconstruye sin perder columnas, filas ni claves foráneas', async () => {
  const archivo = ruta();
  // Base con las migraciones 1 a 6 y datos que dependen de desafios (preguntas, partidas, rondas).
  const vieja = createClient({ url: `file:${archivo}` });
  await vieja.executeMultiple(MIGRACIONES[0].multiple);
  await vieja.executeMultiple(`
    INSERT INTO desafios (id, fecha, numero, origen, modelo, corrida_id, publicado_en) VALUES (1, '2026-10-01', 1, 'reserva', 'manual', 4, 11), (2, '2026-10-02', 2, 'ia', 'm', 5, 22);
    INSERT INTO preguntas (id, desafio_id, posicion, categoria, enunciado, alcance, huella, origen, fuentes) VALUES ('2026-10-01-p1', 1, 1, 'historia', 'x', 'x', 'x', 'reserva', '[]');
    INSERT INTO jugadores (id, creado_en) VALUES ('j1', 0);
    INSERT INTO partidas (id, jugador_id, desafio_id, iniciada_en) VALUES ('p1', 'j1', 1, 0);
  `);
  const antes = (await vieja.execute('PRAGMA table_info(desafios)')).rows.map((c) => c.name);
  vieja.close();

  const db = await abrirBD(archivo);
  try {
    const despues = (await db.all('PRAGMA table_info(desafios)')).map((c) => c.name);
    for (const c of antes) assert.ok(despues.includes(c), `conserva la columna ${c}`);
    assert.ok(despues.includes('modo'));
    assert.deepEqual(
      await db.all('SELECT id, fecha, numero, origen, modelo, corrida_id, publicado_en, modo FROM desafios ORDER BY id'),
      [
        { id: 1, fecha: '2026-10-01', numero: 1, origen: 'reserva', modelo: 'manual', corrida_id: 4, publicado_en: 11, modo: 'normal' },
        { id: 2, fecha: '2026-10-02', numero: 2, origen: 'ia', modelo: 'm', corrida_id: 5, publicado_en: 22, modo: 'normal' },
      ],
    );
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), [], 'las filas que apuntan a desafios siguen siendo válidas');
    assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1, 'las claves foráneas siguen activas');
    // El código anterior sigue pudiendo insertar sin modo (queda en normal)…
    await db.run("INSERT INTO desafios (fecha, numero, origen, publicado_en) VALUES ('2026-10-03', 3, 'reserva', 0)");
    assert.equal((await db.get("SELECT modo FROM desafios WHERE fecha = '2026-10-03'")).modo, 'normal');
    // …y ahora la misma fecha admite un desafío por modo, pero no dos del mismo.
    await db.run("INSERT INTO desafios (fecha, modo, numero, origen, publicado_en) VALUES ('2026-10-03', 'farandula', 1, 'reserva', 0)");
    await assert.rejects(() => db.run("INSERT INTO desafios (fecha, modo, numero, origen, publicado_en) VALUES ('2026-10-03', 'farandula', 1, 'reserva', 0)"), /UNIQUE/);
    await assert.rejects(() => db.run("INSERT INTO partidas (id, jugador_id, desafio_id, iniciada_en) VALUES ('p2', 'j1', 999, 0)"), /FOREIGN KEY/);
    assert.ok((await db.all('PRAGMA table_info(corridas)')).some((c) => c.name === 'modo'));
    assert.equal(await db.get("SELECT name FROM sqlite_master WHERE name = 'desafios_copia'"), null, 'no queda la copia temporal');
  } finally {
    db.close();
  }
});
