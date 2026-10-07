// Reserva en la base y edición de preguntas desde el panel: lo que se publica queda en la reserva,
// la reserva se puede editar y desactivar, y una pregunta ya publicada se puede corregir sin
// romper las partidas jugadas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepararEntorno } from './ayuda.js';
import { reservaCompleta, guardarEnReserva, cambiarEstadoReserva, elegirDeReserva } from '../servidor/generador/reserva.js';
import { ranurasDeModo } from '../servidor/dominio.js';
import { iniciarServidor } from '../servidor/index.js';

const silencioso = { info() {}, warn() {}, error() {} };

test('la reserva completa suma lo de la base, la edición pisa al archivo y las inactivas no se eligen', async () => {
  const e = await prepararEntorno();
  const base = e.reservas.farandula;
  const dominios = e.config.fuentes.dominios;
  const original = base.preguntas.find((p) => p.id === 'far-bandana');
  // Una nueva, una edición de una del archivo y una del archivo desactivada.
  const nueva = { ...original, id: 'far-nueva', enunciado: 'Nombrá a una integrante del grupo Bandana, por su nombre artístico.' };
  await guardarEnReserva(e.db, 'farandula', [nueva], { origen: 'manual' });
  await guardarEnReserva(e.db, 'farandula', [{ ...original, alcance: 'Alcance corregido desde el panel.' }], { origen: 'edicion', reemplazar: true });
  assert.ok(await cambiarEstadoReserva(e.db, 'farandula', 'far-soda-stereo', false, { base }));

  const completa = await reservaCompleta(e.db, 'farandula', base, { dominios });
  const ids = completa.preguntas.map((p) => p.id);
  assert.ok(ids.includes('far-nueva'));
  assert.ok(!ids.includes('far-soda-stereo'), 'la desactivada no está entre las elegibles');
  assert.equal(ids.filter((id) => id === 'far-bandana').length, 1, 'la edición reemplaza a la del archivo');
  assert.equal(completa.preguntas.find((p) => p.id === 'far-bandana').alcance, 'Alcance corregido desde el panel.');
  assert.equal(completa.preguntas.length, base.preguntas.length); // +1 nueva, −1 desactivada
  const { elegidas } = elegirDeReserva({ reserva: completa, categorias: ranurasDeModo('farandula'), recientes: [], usos: new Map(), fecha: '2026-10-05' });
  assert.ok(![...elegidas.values()].some((p) => p.id === 'far-soda-stereo'));
  // Sin `reemplazar`, guardar de nuevo no pisa una edición.
  await guardarEnReserva(e.db, 'farandula', [original], { origen: 'manual' });
  assert.equal((await reservaCompleta(e.db, 'farandula', base, { dominios })).preguntas.find((p) => p.id === 'far-bandana').alcance, 'Alcance corregido desde el panel.');
});

let dir;
before(() => (dir = mkdtempSync(join(tmpdir(), 'filon-reserva-'))));
after(() => rmSync(dir, { recursive: true, force: true }));

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
    return { estado: res.status, datos: await res.json().catch(() => null) };
  };
}
const ADMIN = { authorization: 'Bearer secreto-admin' };

async function levantar(env = {}) {
  return iniciarServidor({
    sinArchivoEnv: true,
    log: silencioso,
    env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, `${Math.random().toString(36).slice(2)}.db`), IA_PROVEEDOR: 'ninguno', ANTHROPIC_API_KEY: '', TURSO_DATABASE_URL: '', BD_URL: '', TOKEN_ADMIN: 'secreto-admin', PROGRAMADOR_INTERNO: '0', ...env },
  });
}

test('API: lo cargado a mano queda en la reserva y la reserva se edita y se desactiva', async () => {
  const app = await levantar();
  try {
    const pedir = cliente(app.puerto);
    const geografia = JSON.parse(readFileSync(new URL('../datos/reserva-geografia.json', import.meta.url), 'utf8')).preguntas;
    const lote = geografia.slice(0, 7).map((p, i) => ({ ...p, id: `cargada-${i + 1}` }));
    const imp = await pedir('POST', '/api/admin/desafios/2030-05-10/importar?modo=geografia', { preguntas: lote }, ADMIN);
    assert.equal(imp.datos.resultado, 'publicado', JSON.stringify(imp.datos));
    assert.equal(imp.datos.enReserva, 7);

    const reserva = (await pedir('GET', '/api/admin/reserva?modo=geografia', null, ADMIN)).datos;
    const cargadas = reserva.preguntas.filter((p) => p.origen === 'manual');
    assert.equal(cargadas.length, 7);
    assert.ok(cargadas.every((p) => p.usos?.veces === 1 && p.usos.ultima === '2030-05-10'), 'el uso se cuenta por el id de reserva');
    assert.ok(reserva.preguntas.some((p) => p.origen === 'archivo'));

    // Editar una de la reserva: inválida no se guarda; válida, sí.
    const editada = { ...cargadas[0].pregunta, enunciado: 'x' };
    const mala = await pedir('POST', '/api/admin/reserva?modo=geografia', { pregunta: editada }, ADMIN);
    assert.equal(mala.estado, 422);
    assert.match(mala.datos.detalles.errores.join(' '), /enunciado/);
    const buena = await pedir('POST', '/api/admin/reserva?modo=geografia', { pregunta: { ...editada, enunciado: 'Nombrá un país limítrofe de la República Argentina.' } }, ADMIN);
    assert.equal(buena.datos.resultado, 'editada');
    // Nueva sin id: se le asigna uno. Otra categoría en un modo temático no vale.
    const nueva = await pedir('POST', '/api/admin/reserva?modo=geografia', { pregunta: { ...geografia[8], id: '' } }, ADMIN);
    assert.equal(nueva.datos.resultado, 'agregada');
    assert.match(nueva.datos.id, /^manual-geografia-/);
    const deOtraCategoria = await pedir('POST', '/api/admin/reserva?modo=geografia', { pregunta: { ...geografia[8], id: 'otra', categoria: 'historia' } }, ADMIN);
    assert.equal(deOtraCategoria.estado, 422);

    // Desactivar una del archivo.
    assert.equal((await pedir('POST', '/api/admin/reserva/estado?modo=geografia', { id: 'gm-oceanos', activa: false }, ADMIN)).datos.ok, true);
    assert.equal((await pedir('POST', '/api/admin/reserva/estado?modo=geografia', { id: 'no-existe', activa: false }, ADMIN)).estado, 404);
    const despues = (await pedir('GET', '/api/admin/reserva?modo=geografia', null, ADMIN)).datos.preguntas;
    assert.equal(despues.find((p) => p.id === 'gm-oceanos').activa, false);
    assert.equal(despues.find((p) => p.id === cargadas[0].id).pregunta.enunciado, 'Nombrá un país limítrofe de la República Argentina.');
    assert.equal((await pedir('GET', '/api/admin/reserva?modo=geografia')).estado, 401, 'solo con sesión de administración');
  } finally {
    await app.cerrar();
  }
});

test('API: editar una pregunta publicada conserva las partidas y no deja quitar respuestas ya dadas', async () => {
  const app = await levantar({ PROGRAMADOR_INTERNO: '1' });
  try {
    const pedir = cliente(app.puerto);
    const jugador = cliente(app.puerto);
    const { fecha } = (await pedir('GET', '/api/salud')).datos;
    const ruta = `/api/admin/desafios/${fecha}/preguntas/1?modo=farandula`;
    const { pregunta, preguntaId } = (await pedir('GET', ruta, null, ADMIN)).datos;
    assert.ok(pregunta.respuestas.length >= 5);

    // Un jugador acierta la pregunta 1 con la primera respuesta.
    const partida = (await jugador('POST', '/api/partidas', { modo: 'farandula' })).datos.partida;
    await jugador('POST', `/api/partidas/${partida.id}/rondas/1/iniciar`);
    const dada = pregunta.respuestas[0].canonica;
    const r = await jugador('POST', `/api/partidas/${partida.id}/rondas/1/respuesta`, { texto: dada });
    assert.equal(r.datos.resultado, 'aceptada');
    const puntosAntes = r.datos.partida.puntos;

    // Quitar esa respuesta no se puede.
    const sinLaDada = { ...pregunta, respuestas: pregunta.respuestas.slice(1) };
    const bloqueada = await pedir('POST', ruta, { pregunta: sinLaDada }, ADMIN);
    assert.equal(bloqueada.estado, 409);
    assert.match(bloqueada.datos.mensaje, new RegExp(dada));

    // Corregir el enunciado, cambiar la rareza de la dada y sumar una respuesta, sí.
    const extra = { canonica: 'Respuesta nueva de prueba', variantes: ['Nueva de prueba'], rareza: 'diamante', explicacion: 'Agregada desde el panel para la prueba.' };
    const corregida = {
      ...pregunta,
      enunciado: `${pregunta.enunciado.replace(/\.$/, '')}, corregida.`,
      respuestas: [{ ...pregunta.respuestas[0], rareza: 'diamante' }, ...pregunta.respuestas.slice(1), extra],
    };
    const ok = await pedir('POST', ruta, { pregunta: corregida }, ADMIN);
    assert.equal(ok.datos.resultado, 'editada', JSON.stringify(ok.datos));
    const releida = (await pedir('GET', ruta, null, ADMIN)).datos;
    assert.equal(releida.preguntaId, preguntaId);
    assert.equal(releida.pregunta.enunciado, corregida.enunciado);
    assert.equal(releida.pregunta.respuestas.length, pregunta.respuestas.length + 1);

    // La partida jugada conserva sus puntos y la respuesta aceptada.
    const vista = (await jugador('GET', `/api/partidas/${partida.id}`)).datos.partida;
    assert.equal(vista.puntos, puntosAntes);
    assert.equal(vista.rondas[0].respuesta.canonica, dada);

    // Un jugador nuevo ve el enunciado corregido y la respuesta agregada vale (también por su variante).
    const otro = cliente(app.puerto);
    const p2 = (await otro('POST', '/api/partidas', { modo: 'farandula' })).datos.partida;
    const ronda = (await otro('POST', `/api/partidas/${p2.id}/rondas/1/iniciar`)).datos.partida.rondas[0];
    assert.equal(ronda.enunciado, corregida.enunciado);
    const sugerida = await otro('POST', `/api/partidas/${p2.id}/rondas/1/respuesta`, { texto: 'nueva de prueba' });
    assert.equal(sugerida.datos.sugerencia, extra.canonica);
    const aceptada = await otro('POST', `/api/partidas/${p2.id}/rondas/1/respuesta`, { texto: extra.canonica });
    assert.equal(aceptada.datos.resultado, 'aceptada');
    assert.equal(aceptada.datos.partida.puntos, 100);

    // La versión editada quedó en la reserva.
    const reserva = (await pedir('GET', '/api/admin/reserva?modo=farandula', null, ADMIN)).datos.preguntas;
    const enReserva = reserva.find((p) => p.id === pregunta.id);
    assert.equal(enReserva.origen, 'edicion');
    assert.equal(enReserva.pregunta.enunciado, corregida.enunciado);

    // La categoría no se puede cambiar desde la edición (se mantiene la del día).
    const otraCategoria = await pedir('POST', ruta, { pregunta: { ...corregida, categoria: 'cine' }, soloValidar: true }, ADMIN);
    assert.equal(otraCategoria.datos.resultado, 'valido');
  } finally {
    await app.cerrar();
  }
});
