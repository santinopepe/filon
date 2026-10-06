import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarServidor } from '../servidor/index.js';
import { publicarDesafio } from '../servidor/banco.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { sumarDias } from '../servidor/tiempo.js';
import { insertarHistorial } from '../publico/prompt.js';

const PROMPT = readFileSync(new URL('../datos/prompt-generacion.txt', import.meta.url), 'utf8');

test('el historial se inserta en el bloque «Historial reciente» sin tocar el resto del prompt', () => {
  const historial = [
    { fecha: '2026-10-05', categoria: 'historia', enunciado: 'Nombrá un emperador romano.', alcance: 'Siglo I.', respuestas: ['Nerón', 'Trajano'] },
    { fecha: '2026-10-06', categoria: 'ciencia', enunciado: 'Nombrá un gas noble.', alcance: 'Grupo 18.', respuestas: ['Helio'] },
  ];
  const final = insertarHistorial(PROMPT, historial);
  const [antes] = PROMPT.split('Historial reciente:');
  const [, despues] = PROMPT.split('Fuentes verificadas disponibles:');
  assert.ok(final.startsWith(`${antes}Historial reciente:\n[\n  {"fecha":"2026-10-05"`), 'el principio no cambia');
  assert.ok(final.endsWith(`Fuentes verificadas disponibles:${despues}`), 'el final (fuentes y la orden) no cambia');
  const bloque = final.split('Historial reciente:\n')[1].split('\n\nFuentes verificadas')[0];
  assert.deepEqual(JSON.parse(bloque), historial, 'el historial insertado es JSON válido');
  assert.ok(!final.includes('Historial reciente:\n[]'));
  // Repetir la inserción reemplaza (no acumula) y un historial vacío deja [].
  assert.equal(insertarHistorial(final, []), PROMPT);
  // Si el prompt editado ya no tiene el bloque, se agrega al final.
  assert.match(insertarHistorial('Generá algo.', historial), /^Generá algo\.\n\nHistorial reciente:\n\[\n {2}\{/);
});

test('descarga del historial (JSON y CSV) de los últimos días, solo para administración', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filon-historial-'));
  const app = await iniciarServidor({
    sinArchivoEnv: true,
    log: { info() {}, warn() {}, error() {} },
    env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, 'f.db'), IA_PROVEEDOR: 'ninguno', TURSO_DATABASE_URL: '', BD_URL: '', TOKEN_ADMIN: 'adm', PROGRAMADOR_INTERNO: '0' },
  });
  const base = `http://127.0.0.1:${app.puerto}`;
  const admin = { authorization: 'Bearer adm' };
  try {
    const hoy = (await (await fetch(`${base}/api/salud`)).json()).fecha;
    const reserva = cargarReserva(app.config.rutaReserva, { dominios: app.config.fuentes.dominios }).preguntas;
    const lote = (k) => ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'].map((c, i) => reserva.filter((p) => p.categoria === c)[(k + i) % 3]);
    for (const [k, delta] of [-3, -2, 0, 1].entries()) await publicarDesafio(app.db, { fecha: sumarDias(hoy, delta), preguntas: lote(k), origen: 'reserva' });
    // Una consigna con coma y comillas para probar el escape del CSV.
    await app.db.run('UPDATE preguntas SET enunciado = ? WHERE id = ?', 'Nombrá un país, "difícil" de recordar.', `${hoy}-p1`);

    assert.equal((await fetch(`${base}/api/admin/historial`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/prompt`)).status, 401);

    const r = await fetch(`${base}/api/admin/historial?dias=3`, { headers: admin });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.match(r.headers.get('content-disposition'), new RegExp(`attachment; filename="filon-historial-${sumarDias(hoy, -2)}-3d\\.json"`));
    const json = await r.json();
    assert.equal(json.desde, sumarDias(hoy, -2));
    const fechas = [...new Set(json.preguntas.map((p) => p.fecha))];
    assert.deepEqual(fechas, [sumarDias(hoy, -2), hoy, sumarDias(hoy, 1)], 'últimos 3 días + los ya programados; no el de hace 3');
    assert.equal(json.preguntas.length, 21);
    assert.ok(json.preguntas.every((p) => p.respuestas.length === p.totalRespuestas && p.respuestas.length >= 5 && p.enunciado && p.alcance));

    const c = await fetch(`${base}/api/admin/historial?dias=3&formato=csv`, { headers: admin });
    assert.match(c.headers.get('content-type'), /text\/csv/);
    assert.match(c.headers.get('content-disposition'), /\.csv"$/);
    const bytes = Buffer.from(await c.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para Excel');
    const csv = bytes.subarray(3).toString('utf8');
    assert.ok(csv.startsWith('fecha,numero,posicion,categoria,enunciado,alcance,total_respuestas,respuestas\r\n'));
    assert.equal(csv.trim().split('\r\n').length, 22, 'encabezado + 21 preguntas');
    assert.ok(csv.includes('"Nombrá un país, ""difícil"" de recordar."'), 'comas y comillas escapadas');

    const todo = await (await fetch(`${base}/api/admin/historial?dias=999`, { headers: admin })).json();
    assert.equal(todo.dias, 30, 'el período tiene tope');
    assert.equal(todo.preguntas.length, 28);

    const prompt = await (await fetch(`${base}/api/admin/prompt`, { headers: admin })).json();
    assert.equal(prompt.texto, PROMPT);
  } finally {
    await app.cerrar();
    rmSync(dir, { recursive: true, force: true });
  }
});
