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
    assert.ok(!/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i.test(texto), `la migración ${m.version} no borra estructuras`);
    assert.ok(!/RENAME\s+(TO|COLUMN)/i.test(texto), `la migración ${m.version} no renombra`);
  }
});
