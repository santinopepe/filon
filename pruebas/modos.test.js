// Modos de juego: Normal, Farándula Argentina y Geografía. Cada uno tiene su desafío diario, sus
// preguntas (solo de su categoría), su historial y su propio límite de una partida por persona y día.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepararEntorno } from './ayuda.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { elegirDeReserva } from '../servidor/generador/reserva.js';
import { crearProgramador } from '../servidor/programador.js';
import { crearJuego } from '../servidor/juego.js';
import { desafioPorFecha, preguntasDeDesafio } from '../servidor/banco.js';
import { validarPregunta, validarLote } from '../servidor/validacion.js';
import { MODOS, CLAVES_MODOS, ranurasDeModo, PREGUNTAS_POR_DESAFIO } from '../servidor/dominio.js';
import { iniciarServidor } from '../servidor/index.js';

const silencioso = { info() {}, warn() {}, error() {} };
const YO = '22222222-2222-4222-8222-222222222222';

async function publicar(e, modo, fecha = '2026-10-05') {
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha, modo, reservas: e.reservas, reserva: e.reserva, ahora: e.reloj.ahora });
  assert.equal(r.resultado, 'publicado', JSON.stringify(r));
  return r;
}

test('cada modo tiene una reserva válida con al menos siete preguntas de su categoría', async () => {
  const e = await prepararEntorno();
  for (const modo of CLAVES_MODOS) {
    const reserva = e.reservas[modo];
    assert.deepEqual(reserva.invalidas, [], `${modo}: todas pasan la validación estricta`);
    assert.ok(reserva.preguntas.length >= PREGUNTAS_POR_DESAFIO, `${modo}: alcanzan para un día`);
    for (const p of reserva.preguntas) assert.ok(MODOS[modo].categorias.includes(p.categoria), `${p.id} es de ${modo}`);
  }
});

test('validación: cada modo solo acepta preguntas de su categoría', async () => {
  const e = await prepararEntorno();
  const deFarandula = e.reservas.farandula.preguntas[0];
  const dominios = e.config.fuentes.dominios;
  assert.ok(validarPregunta(deFarandula, { dominios, modo: 'farandula' }).ok);
  assert.match(validarPregunta(deFarandula, { dominios, modo: 'normal' }).errores.join(' '), /Categoría inválida/);
  assert.match(validarPregunta(deFarandula, { dominios, modo: 'geografia' }).errores.join(' '), /tiene que ser «geografia»/);
  // Un día temático son siete preguntas distintas de la misma categoría (Normal exige las siete distintas).
  const siete = e.reservas.geografia.preguntas.slice(0, 7);
  assert.ok(validarLote(siete, 'geografia').ok);
  assert.match(validarLote(siete, 'normal').errores.join(' '), /al menos 4 categorías/);
  assert.match(validarLote([...siete.slice(0, 6), deFarandula], 'geografia').errores.join(' '), /solo admite preguntas de la categoría «geografia»/);
});

test('la reserva temática llena las siete ranuras sin repetir preguntas', async () => {
  const e = await prepararEntorno();
  const ranuras = ranurasDeModo('farandula');
  assert.equal(ranuras.length, 7);
  const { elegidas } = elegirDeReserva({ reserva: e.reservas.farandula, categorias: ranuras, recientes: [], usos: new Map(), fecha: '2026-10-05' });
  const ids = ranuras.map((r) => elegidas.get(r).id);
  assert.equal(new Set(ids).size, 7, 'siete preguntas distintas');
});

test('cada modo publica su propio desafío del día, numerado por separado', async () => {
  const e = await prepararEntorno();
  await publicar(e, 'normal', '2026-10-04');
  await publicar(e, 'normal');
  const far = await publicar(e, 'farandula');
  const geo = await publicar(e, 'geografia');
  assert.equal(far.numero, 1, 'el primer desafío de Farándula es el #1 aunque Normal ya tenga dos');
  assert.equal(geo.numero, 1);
  const repetido = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', modo: 'farandula', reservas: e.reservas, ahora: e.reloj.ahora });
  assert.equal(repetido.resultado, 'ya_existia');

  for (const [modo, categoria] of [['farandula', 'farandula'], ['geografia', 'geografia']]) {
    const d = await desafioPorFecha(e.db, '2026-10-05', modo);
    assert.equal(d.modo, modo);
    const preguntas = await preguntasDeDesafio(e.db, d.id);
    assert.equal(preguntas.length, 7);
    assert.ok(preguntas.every((p) => p.categoria === categoria), `${modo}: solo preguntas de su categoría`);
    assert.ok(preguntas.every((p) => p.id.startsWith(`2026-10-05-${modo}-p`)));
    assert.equal(new Set(preguntas.map((p) => p.reserva_id)).size, 7);
  }
  const normal = await preguntasDeDesafio(e.db, (await desafioPorFecha(e.db, '2026-10-05')).id);
  assert.equal(new Set(normal.map((p) => p.categoria)).size, 7, 'Normal sigue con una pregunta por categoría');
  assert.equal(normal[0].id, '2026-10-05-p1', 'Normal conserva el formato de id');
});

test('una partida por persona, modo y día: jugar un modo no bloquea los otros', async () => {
  const e = await prepararEntorno();
  for (const modo of CLAVES_MODOS) await publicar(e, modo);
  const juego = crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora });

  let estado = await juego.estado(YO, 'farandula');
  assert.deepEqual(estado.modos.map((m) => [m.clave, m.estado]), [['normal', 'disponible'], ['farandula', 'disponible'], ['geografia', 'disponible']]);

  // Termina Farándula pasando las siete rondas.
  let p = await juego.iniciarPartida(YO, 'farandula');
  assert.equal(p.modo, 'farandula');
  assert.ok(p.rondas.every((r) => r.categoria === 'Farándula'));
  for (let n = 1; n <= 7; n++) {
    p = await juego.iniciarRonda(YO, p.id, n);
    p = await juego.pasar(YO, p.id, n);
  }
  assert.ok(p.terminada);
  // Pedir otra partida de Farándula devuelve la misma (ya jugada): el límite se respeta.
  assert.equal((await juego.iniciarPartida(YO, 'farandula')).id, p.id);

  // Geografía y Normal siguen disponibles y son partidas distintas.
  const geo = await juego.iniciarPartida(YO, 'geografia');
  const normal = await juego.iniciarPartida(YO);
  assert.equal(new Set([p.id, geo.id, normal.id]).size, 3);
  assert.equal(geo.modo, 'geografia');
  assert.equal(normal.modo, 'normal');

  // El estado vive en la base: otra instancia (una recarga, otro proceso) ve lo mismo.
  const otra = crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora });
  estado = await otra.estado(YO, 'geografia');
  assert.deepEqual(estado.modos.map((m) => [m.clave, m.estado]), [['normal', 'en_curso'], ['farandula', 'jugado'], ['geografia', 'en_curso']]);
  assert.equal(estado.partidaHoy.id, geo.id);
  assert.equal(estado.desafio.modo, 'geografia');

  // Al día siguiente, el límite se reinicia en todos los modos (mismo criterio que antes).
  e.reloj.fijar('2026-10-06T08:00:00-03:00');
  for (const modo of CLAVES_MODOS) await publicar(e, modo, '2026-10-06');
  estado = await otra.estado(YO, 'farandula');
  assert.ok(estado.modos.every((m) => m.estado === 'disponible'));
  assert.equal(estado.partidaPendiente, null, 'la partida terminada de ayer no queda pendiente');
  const pendienteGeo = await otra.estado(YO, 'geografia');
  assert.equal(pendienteGeo.partidaPendiente?.id, geo.id, 'la de Geografía de ayer se puede terminar desde su modo');
});

test('el programador asegura hoy en los tres modos; mañana, recién cerca de medianoche', async () => {
  const e = await prepararEntorno({ inicio: '2026-10-05T10:00:00-03:00' });
  const prog = crearProgramador({ db: e.db, config: e.config, contexto: { reserva: e.reserva, reservas: e.reservas }, ahora: e.reloj.ahora, log: silencioso });
  await prog.revisar();
  for (const modo of CLAVES_MODOS) assert.ok(await desafioPorFecha(e.db, '2026-10-05', modo), `hoy existe en ${modo}`);
  for (const modo of CLAVES_MODOS) assert.equal(await desafioPorFecha(e.db, '2026-10-06', modo), null, `${modo} deja tiempo para la carga manual`);
  e.reloj.fijar('2026-10-05T23:45:00-03:00');
  await prog.revisar();
  for (const modo of CLAVES_MODOS) assert.ok(await desafioPorFecha(e.db, '2026-10-06', modo), `mañana existe en ${modo}`);
  prog.detener();
});

// ───────── API ─────────
let dir;
before(() => (dir = mkdtempSync(join(tmpdir(), 'filon-modos-'))));
after(() => rmSync(dir, { recursive: true, force: true }));

async function levantar(env = {}) {
  return iniciarServidor({
    sinArchivoEnv: true,
    log: silencioso,
    env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, `${Math.random().toString(36).slice(2)}.db`), TURSO_DATABASE_URL: '', BD_URL: '', TOKEN_ADMIN: 'secreto-admin', ...env },
  });
}

function cliente(puerto) {
  let cookie = '';
  return async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
      method: metodo,
      headers: { ...(cookie ? { cookie } : {}), ...(metodo === 'POST' ? { 'content-type': 'application/json' } : {}), ...cabeceras },
      body: metodo === 'POST' ? JSON.stringify(cuerpo ?? {}) : undefined,
    });
    const nueva = res.headers.get('set-cookie');
    if (nueva) cookie = nueva.split(';')[0];
    const texto = await res.text();
    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      datos = texto;
    }
    return { estado: res.status, datos, res };
  };
}

const ADMIN = { authorization: 'Bearer secreto-admin' };

test('API: estado y partidas por modo, con el límite diario independiente', async () => {
  const app = await levantar();
  try {
    const pedir = cliente(app.puerto);
    const salud = (await pedir('GET', '/api/salud')).datos;
    assert.deepEqual(salud.modos, { normal: true, farandula: true, geografia: true });
    const estado = (await pedir('GET', '/api/estado?modo=farandula')).datos;
    assert.equal(estado.modo, 'farandula');
    assert.equal(estado.desafio.modo, 'farandula');
    assert.equal(estado.modos.length, 3);
    assert.equal((await pedir('GET', '/api/estado?modo=otro')).estado, 400);
    assert.equal((await pedir('POST', '/api/partidas', { modo: 'otro' })).estado, 400);

    const far = (await pedir('POST', '/api/partidas', { modo: 'farandula' })).datos.partida;
    const far2 = (await pedir('POST', '/api/partidas', { modo: 'farandula' })).datos.partida;
    const geo = (await pedir('POST', '/api/partidas', { modo: 'geografia' })).datos.partida;
    const normal = (await pedir('POST', '/api/partidas')).datos.partida;
    assert.equal(far.id, far2.id, 'una sola partida de Farándula');
    assert.equal(new Set([far.id, geo.id, normal.id]).size, 3);
    assert.equal((await pedir('GET', '/api/estado')).datos.partidaHoy.id, normal.id, 'sin modo es Normal');
  } finally {
    await app.cerrar();
  }
});

test('API de administración: carga, historial, prompt y listados separados por modo', async () => {
  const app = await levantar({ PROGRAMADOR_INTERNO: '0' });
  try {
    const pedir = cliente(app.puerto);
    const fecha = '2030-05-10';
    const geografia = JSON.parse(readFileSync(new URL('../datos/reserva-geografia.json', import.meta.url), 'utf8')).preguntas.slice(0, 7);
    // Sin «categoria», un modo temático completa la suya.
    const sinCategoria = geografia.map(({ categoria: _c, ...resto }) => resto);
    const importar = (modo, preguntas, extra = {}) => pedir('POST', `/api/admin/desafios/${fecha}/importar?modo=${modo}`, { preguntas, ...extra }, ADMIN);

    assert.equal((await importar('normal', geografia)).estado, 422, 'Normal no acepta siete preguntas de geografía');
    const valido = await importar('geografia', sinCategoria, { soloValidar: true });
    assert.equal(valido.datos.resultado, 'valido', JSON.stringify(valido.datos));
    const publicado = await importar('geografia', sinCategoria);
    assert.equal(publicado.datos.resultado, 'publicado', JSON.stringify(publicado.datos));
    assert.equal(publicado.datos.modo, 'geografia');
    // El mismo lote (con su categoría) en Farándula falla por categoría, no por repetición: los
    // historiales de los modos no se mezclan.
    const enFarandula = await importar('farandula', geografia);
    assert.equal(enFarandula.estado, 422);
    assert.match(enFarandula.datos.detalles.errores.join(' '), /Categoría inválida para Farándula Argentina/);
    assert.doesNotMatch(enFarandula.datos.detalles.errores.join(' '), /repite/);
    // Volver a cargarlo en Geografía para el mismo día pide confirmar el reemplazo.
    assert.equal((await importar('geografia', sinCategoria)).datos.error, 'ya_existe');

    const listado = (m) => pedir('GET', `/api/admin/desafios?modo=${m}`, null, ADMIN);
    assert.equal((await listado('geografia')).datos.desafios.length, 1);
    assert.equal((await listado('normal')).datos.desafios.length, 0);
    assert.equal((await pedir('GET', `/api/admin/desafios/${fecha}?modo=geografia`, null, ADMIN)).datos.preguntas.length, 7);
    assert.equal((await pedir('GET', `/api/admin/desafios/${fecha}`, null, ADMIN)).estado, 404);

    // Historial por modo (JSON y CSV) — se piden con fecha de hoy, así que se mira el rango completo.
    const historial = async (m) => (await pedir('GET', `/api/admin/historial?modo=${m}&dias=30`, null, ADMIN));
    const h = await historial('geografia');
    assert.equal(h.datos.modo, 'geografia');
    assert.match(h.res.headers.get('content-disposition'), /filon-historial-geografia-/);
    assert.ok(h.datos.preguntas.every((p) => p.categoria === 'geografia'));
    assert.equal((await historial('farandula')).datos.preguntas.length, 0);

    // Un prompt por modo.
    const prompt = async (m) => (await pedir('GET', `/api/admin/prompt?modo=${m}`, null, ADMIN)).datos.texto;
    assert.match(await prompt('farandula'), /Farándula Argentina/);
    assert.match(await prompt('geografia'), /"categoria": siempre "geografia"/);
    assert.match(await prompt('normal'), /una por categoría/);
    for (const m of CLAVES_MODOS) assert.match(await prompt(m), /Historial reciente:\n\[\]\n\nFuentes verificadas disponibles:/, `${m}: el panel puede insertar el historial`);

    // Publicar desde la reserva del modo.
    const reserva = await pedir('POST', '/api/admin/desafios/2030-05-11/generar?modo=farandula', {}, ADMIN);
    assert.equal(reserva.datos.resultado, 'publicado');
    assert.equal(reserva.datos.modo, 'farandula');
    const corridas = (await pedir('GET', '/api/admin/corridas', null, ADMIN)).datos.corridas;
    assert.equal(corridas[0].modo, 'farandula');
    const stats = (await pedir('GET', '/api/admin/estadisticas?fecha=2030-05-10&desde=2030-05-01&hasta=2030-05-10&modo=geografia', null, ADMIN)).datos;
    assert.equal(stats.modo, 'geografia');
    assert.equal(stats.dia.preguntas.length, 7);
  } finally {
    await app.cerrar();
  }
});

test('tarea diaria por HTTP: hoy y mañana aseguran los tres modos; manana-ia ya no existe', async () => {
  const app = await levantar({ PROGRAMADOR_INTERNO: '0', CRON_SECRET: 'cron' });
  try {
    const pedir = cliente(app.puerto);
    const cron = { authorization: 'Bearer cron' };
    assert.equal((await pedir('GET', '/api/cron/manana-ia', null, cron)).estado, 404);
    const hoy = (await pedir('GET', '/api/cron/hoy', null, cron)).datos;
    assert.equal(hoy.resultado, 'publicado');
    assert.deepEqual(Object.fromEntries(Object.entries(hoy.modos).map(([m, r]) => [m, r.resultado])), { normal: 'publicado', farandula: 'publicado', geografia: 'publicado' });
    const manana = (await pedir('GET', '/api/cron/manana', null, cron)).datos;
    assert.deepEqual(Object.keys(manana.modos), ['normal', 'farandula', 'geografia']);
  } finally {
    await app.cerrar();
  }
});
