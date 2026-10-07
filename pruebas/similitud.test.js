import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analizarSimilitud, raicesDe } from '../servidor/similitud.js';
import { iniciarServidor } from '../servidor/index.js';
import { publicarDesafio } from '../servidor/banco.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { sumarDias } from '../servidor/tiempo.js';

const paises = ['Argentina', 'Bolivia', 'Colombia', 'Venezuela', 'Guyana', 'Uruguay', 'Chile', 'Perú', 'Ecuador', 'Paraguay'];
const pregunta = (enunciado, respuestas, categoria = 'geografia') => ({ categoria, enunciado, respuestas: respuestas.map((canonica) => ({ canonica })) });

test('raíces: plurales y conjugaciones cercanas cuentan como la misma palabra', () => {
  assert.deepEqual([...raicesDe('Nombrá países que terminen en A')].sort(), [...raicesDe('Nombrá un país que termina con A')].sort());
  assert.deepEqual([...raicesDe('capitales europeas')].sort(), [...raicesDe('capital europea')].sort());
  const a = raicesDe('Nombrá países que terminen en A');
  const b = raicesDe('Nombrá un país cuyo nombre termina en la letra A');
  assert.ok([...a].every((r) => b.has(r)), `${[...a]} ⊂ ${[...b]}`);
});

test('niveles: reformulada = repetida; respuestas en común = parecida; tema distinto = nada', () => {
  const historial = [{ fecha: '2026-10-05', categoria: 'geografia', enunciado: 'Nombrá un país de Sudamérica.', respuestas: paises }];
  const [reformulada, parecida, distinta, otraRedaccion] = analizarSimilitud(
    [
      pregunta('Nombrá un país sudamericano.', paises),
      pregunta('Nombrá un país cuyo nombre termina en A.', ['Argentina', 'Bolivia', 'Colombia', 'Venezuela', 'Guyana', 'Kenia', 'Rusia', 'China', 'India', 'Italia', 'Austria', 'Grecia'], 'historia'),
      pregunta('Nombrá un elemento químico gaseoso.', ['Helio', 'Neón', 'Argón', 'Oxígeno', 'Nitrógeno'], 'ciencia'),
      pregunta('Nombrá un país de Sudamérica, de habla hispana.', ['Chile', 'Perú', 'Ecuador'], 'musica'),
    ],
    historial,
  );
  assert.equal(reformulada.coincidencias[0].nivel, 'repetida');
  assert.equal(reformulada.coincidencias[0].fecha, '2026-10-05');
  assert.equal(reformulada.coincidencias[0].compartidas.length, 10);
  assert.equal(parecida.coincidencias.find((c) => c.origen === 'historial').nivel, 'parecida', '5 respuestas en común, conjunto distinto');
  assert.match(parecida.coincidencias.find((c) => c.origen === 'historial').motivo, /5 respuestas en común \(Argentina, Bolivia/);
  assert.deepEqual(distinta.coincidencias, []);
  assert.equal(otraRedaccion.coincidencias.find((c) => c.origen === 'historial').nivel, 'repetida', 'mismo enunciado con un agregado y respuestas incluidas');
});

test('mismo tipo de pregunta con otro conjunto (Mundial masculino / femenino) es «parecida», no «repetida»', () => {
  const masculino = { fecha: '2026-10-06', categoria: 'deportes', enunciado: 'Nombrá una selección campeona de la Copa del Mundo de fútbol masculino.', respuestas: ['Brasil', 'Alemania', 'Italia', 'Argentina', 'Francia', 'Uruguay', 'Inglaterra', 'España'] };
  const [femenino] = analizarSimilitud([pregunta('Nombrá una selección campeona de la Copa Mundial Femenina de fútbol.', ['Estados Unidos', 'Alemania', 'Noruega', 'Japón', 'España'], 'deportes')], [masculino]);
  assert.equal(femenino.coincidencias[0].nivel, 'parecida');
  assert.deepEqual(femenino.coincidencias[0].compartidas, ['Alemania', 'España']);
});

test('dentro del mismo lote también se detectan preguntas parecidas', () => {
  const [a, b] = analizarSimilitud([pregunta('Nombrá un país de Sudamérica.', paises), pregunta('Nombrá un país de América del Sur.', paises, 'historia')], []);
  assert.equal(a.coincidencias[0].origen, 'lote');
  assert.equal(a.coincidencias[0].posicion, 2);
  assert.equal(b.coincidencias[0].posicion, 1);
  assert.equal(a.coincidencias[0].nivel, 'repetida');
});

test('importación: compara con los últimos días; repetida bloquea, parecida avisa, «solo validar» no publica', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filon-similitud-'));
  const app = await iniciarServidor({
    sinArchivoEnv: true,
    log: { info() {}, warn() {}, error() {} },
    env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, 'f.db'), TURSO_DATABASE_URL: '', BD_URL: '', TOKEN_ADMIN: 'adm', PROGRAMADOR_INTERNO: '0' },
  });
  const base = `http://127.0.0.1:${app.puerto}`;
  const importar = async (fecha, cuerpo) => {
    const r = await fetch(`${base}/api/admin/desafios/${fecha}/importar`, { method: 'POST', headers: { authorization: 'Bearer adm', 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { estado: r.status, datos: await r.json() };
  };
  try {
    const hoy = (await (await fetch(`${base}/api/salud`)).json()).fecha;
    const crudo = JSON.parse(readFileSync(new URL('../datos/reserva.json', import.meta.url), 'utf8')).preguntas;
    const categorias = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];
    const deCategoria = (c, i) => structuredClone(crudo.filter((p) => p.categoria === c)[i]);
    const reserva = cargarReserva(app.config.rutaReserva, { dominios: app.config.fuentes.dominios }).preguntas;
    const validas = (i) => categorias.map((c) => reserva.filter((p) => p.categoria === c)[i]);
    // Ayer: la variante 0 de cada categoría. Hace 6 días: la variante 2 (fuera de la ventana de 3 días).
    await publicarDesafio(app.db, { fecha: sumarDias(hoy, -1), preguntas: validas(0), origen: 'reserva' });
    await publicarDesafio(app.db, { fecha: sumarDias(hoy, -6), preguntas: validas(2), origen: 'reserva' });

    // Lote nuevo con la variante 1 (distinta de ayer)…
    const lote = categorias.map((c) => deCategoria(c, 1));
    const limpio = await importar('2030-01-01', { preguntas: lote, soloValidar: true });
    assert.equal(limpio.estado, 200);
    assert.equal(limpio.datos.resultado, 'valido');
    assert.equal(limpio.datos.diasSimilitud, 3);
    assert.equal((await app.db.get("SELECT COUNT(*) AS n FROM desafios WHERE fecha = '2030-01-01'")).n, 0, '«solo validar» no publica');

    // …con la pregunta de geografía de AYER reformulada: se bloquea.
    const repetida = deCategoria('geografia', 0);
    repetida.id = 'geo-reformulada';
    repetida.enunciado = `${repetida.enunciado.replace(/\.$/, '')}, por favor.`;
    const conRepetida = await importar('2030-01-01', { preguntas: [repetida, ...lote.slice(1)] });
    assert.equal(conRepetida.estado, 422);
    assert.ok(conRepetida.datos.detalles.errores.some((e) => e.startsWith('Pregunta 1: repite «') && e.includes(sumarDias(hoy, -1))), JSON.stringify(conRepetida.datos.detalles.errores));
    assert.equal(conRepetida.datos.detalles.similitudes[0].coincidencias[0].nivel, 'repetida');

    // Una pregunta que comparte 3 respuestas con una de ayer (conjunto distinto): avisa pero se publica.
    const ayerHistoria = deCategoria('historia', 0).respuestas.slice(0, 3).map((r) => ({ ...r, rareza: 'grava' }));
    const parecida = deCategoria('historia', 1);
    parecida.respuestas = [...parecida.respuestas, ...ayerHistoria];
    const conParecida = await importar('2030-01-02', { preguntas: [lote[0], parecida, ...lote.slice(2)] });
    assert.equal(conParecida.estado, 200, JSON.stringify(conParecida.datos));
    assert.equal(conParecida.datos.resultado, 'publicado');
    assert.ok(conParecida.datos.advertencias.some((a) => a.startsWith('Pregunta 2: se parece a «') && /3 respuestas en común/.test(a)));

    // Ventana configurable: con 3 días, lo de hace 6 días no cuenta; con 7, sí.
    const viejaReformulada = deCategoria('cine', 2);
    viejaReformulada.id = 'cine-vieja';
    viejaReformulada.enunciado = `${viejaReformulada.enunciado.replace(/\.$/, '')}, sin contar otras.`;
    const lote3 = [...lote.slice(0, 4), viejaReformulada, ...lote.slice(5)];
    const tres = await importar('2030-01-03', { preguntas: lote3, soloValidar: true, diasSimilitud: 3 });
    const siete = await importar('2030-01-03', { preguntas: lote3, soloValidar: true, diasSimilitud: 7 });
    const deCine = (r) => (r.datos.similitudes ?? r.datos.detalles.similitudes)[4].coincidencias.filter((c) => c.origen === 'historial');
    assert.deepEqual(deCine(tres), [], 'fuera de la ventana de 3 días');
    assert.equal(deCine(siete)[0].fecha, sumarDias(hoy, -6));
  } finally {
    await app.cerrar();
    rmSync(dir, { recursive: true, force: true });
  }
});
