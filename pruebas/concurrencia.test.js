// Límites distribuidos, concurrencia e idempotencia con dos «instancias» sobre la misma base,
// como dos funciones de Vercel compartiendo Turso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { crearAplicacion } from '../servidor/app.js';
import { crearLimitadorDistribuido } from '../servidor/limites.js';
import { publicarDesafio, desafioPorFecha } from '../servidor/banco.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { cargarConfig } from '../servidor/config.js';
import { crearReloj, publicarHoy } from './ayuda.js';

const silencioso = { info() {}, warn() {}, error() {} };
let dir;
before(() => (dir = mkdtempSync(join(tmpdir(), 'filon-concurrencia-'))));
after(() => rmSync(dir, { recursive: true, force: true }));

const nuevaRuta = () => join(dir, `${Math.random().toString(36).slice(2)}.db`);
const ENV = { IA_PROVEEDOR: 'ninguno', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TURSO_DATABASE_URL: '', BD_URL: '', SECRETO_SESION: 'secreto-compartido' };

/** Una instancia en su propio hilo (event loop propio), como otra función de Vercel. */
async function instancia(ruta, inicio) {
  const w = new Worker(new URL('./instancia-trabajador.js', import.meta.url), { workerData: { inicio, env: { ...ENV, RUTA_BD: ruta } } });
  await new Promise((ok, mal) => (w.once('message', ok), w.once('error', mal)));
  const pendientes = new Map();
  let siguiente = 0;
  w.on('message', ({ id, resultado, error }) => {
    const p = pendientes.get(id);
    pendientes.delete(id);
    if (error) p.mal(new Error(error));
    else p.ok(resultado);
  });
  const llamar = (metodo, ...args) =>
    new Promise((ok, mal) => {
      const id = ++siguiente;
      pendientes.set(id, { ok, mal });
      w.postMessage({ id, metodo, args });
    });
  return {
    juego: new Proxy({}, { get: (_, metodo) => (...args) => llamar(metodo, ...args) }),
    avanzar: (ms) => llamar('avanzar', ms),
    cerrar: async () => (await llamar('cerrar'), await w.terminate()),
  };
}

/** Base con el desafío de hoy publicado + dos instancias en hilos separados. */
async function escenario() {
  const reloj = crearReloj('2026-10-05T15:00:00-03:00');
  const ruta = nuevaRuta();
  const principal = await crearAplicacion({ sinArchivoEnv: true, log: silencioso, ahora: reloj.ahora, env: { ...ENV, RUTA_BD: ruta } });
  await publicarHoy({
    db: principal.db,
    config: principal.config,
    reloj,
    reserva: cargarReserva(principal.config.rutaReserva, { dominios: principal.config.fuentes.dominios }),
    verificador: principal.contexto.verificador,
  });
  const a = await instancia(ruta, reloj.ahora());
  const b = await instancia(ruta, reloj.ahora());
  return { db: principal.db, config: principal.config, a, b, cerrar: async () => (await a.cerrar(), await b.cerrar(), principal.db.close()) };
}

async function dosInstancias(reloj) {
  const ruta = nuevaRuta();
  const opciones = { sinArchivoEnv: true, log: silencioso, ahora: reloj.ahora, env: { ...ENV, RUTA_BD: ruta } };
  const a = await crearAplicacion(opciones);
  const b = await crearAplicacion(opciones);
  return { a, b, cerrar: () => (a.db.close(), b.db.close()) };
}

test('límite distribuido: dos instancias comparten el contador y la ventana vence', async () => {
  const reloj = crearReloj('2026-10-05T12:00:00-03:00');
  const { a, b, cerrar } = await dosInstancias(reloj);
  try {
    const la = crearLimitadorDistribuido({ db: a.db, secreto: 's', ahora: reloj.ahora });
    const lb = crearLimitadorDistribuido({ db: b.db, secreto: 's', ahora: reloj.ahora });
    // 5 intentos de login permitidos por 15 min y por origen, repartidos en paralelo entre instancias.
    const resultados = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? la : lb).consumir('login_admin', '203.0.113.7')));
    assert.equal(resultados.filter((r) => r.permitido).length, 5, 'exactamente el máximo, aunque lleguen a la vez a dos instancias');
    assert.equal((await lb.consumir('login_admin', '198.51.100.1')).permitido, true, 'otra IP tiene su propio contador');
    const filas = await a.db.all('SELECT clave FROM limites');
    assert.ok(filas.every((f) => !f.clave.includes('203.0.113.7')), 'la IP no se guarda en claro');
    reloj.avanzar(15 * 60_000);
    assert.equal((await la.consumir('login_admin', '203.0.113.7')).permitido, true, 'la ventana nueva vuelve a permitir');
    reloj.avanzar(60 * 60_000);
    assert.ok((await la.limpiar()) >= 1, 'la limpieza borra contadores vencidos');
  } finally {
    cerrar();
  }
});

test('concurrencia: muchos envíos simultáneos no superan el máximo de intentos', async () => {
  const { db, config, a, b, cerrar } = await escenario();
  try {
    const yo = '44444444-4444-4444-8444-444444444444';
    const p = await a.juego.iniciarPartida(yo);
    await a.juego.iniciarRonda(yo, p.id, 1);
    const max = config.maxIntentosPorRonda;
    const resultados = await Promise.all(Array.from({ length: max + 25 }, (_, i) => (i % 2 ? a : b).juego.responder(yo, p.id, 1, `inventada ${i}`)));
    const { n } = await db.get('SELECT COUNT(*) AS n FROM intentos WHERE partida_id = ? AND posicion = 1', p.id);
    assert.equal(n, max, `se guardan exactamente ${max} intentos`);
    assert.equal(resultados.filter((r) => /máximo/.test(r.motivo || '')).length, 25);
  } finally {
    await cerrar();
  }
});

test('doble clic y reintento: la respuesta correcta puntúa una sola vez', async () => {
  const { db, a, b, cerrar } = await escenario();
  try {
    const yo = '55555555-5555-4555-8555-555555555555';
    // Doble POST de inicio en dos instancias: misma partida.
    const [p1, p2] = await Promise.all([a.juego.iniciarPartida(yo), b.juego.iniciarPartida(yo)]);
    assert.equal(p1.id, p2.id);
    // Doble inicio de ronda: el reloj no se reinicia.
    const [r1, r2] = await Promise.all([a.juego.iniciarRonda(yo, p1.id, 1), b.juego.iniciarRonda(yo, p1.id, 1)]);
    assert.equal(r1.rondas[0].limiteEn, r2.rondas[0].limiteEn);
    const canonica = (await db.get("SELECT canonica FROM respuestas WHERE pregunta_id LIKE '%-p1' ORDER BY puntos DESC LIMIT 1")).canonica;
    const envios = await Promise.all([a, b, a, b].map((inst) => inst.juego.responder(yo, p1.id, 1, canonica)));
    assert.equal(envios.filter((r) => r.resultado === 'aceptada').length, 1, 'solo un envío se acepta');
    assert.ok(envios.every((r) => r.resultado === 'aceptada' || r.resultado === 'cerrada'));
    const { puntos } = await db.get('SELECT puntos FROM partidas WHERE id = ?', p1.id);
    const ronda = await db.get('SELECT puntos FROM rondas WHERE partida_id = ? AND posicion = 1', p1.id);
    assert.ok(ronda.puntos > 0);
    assert.equal(puntos, ronda.puntos, 'el puntaje de la partida no se duplica');
    assert.equal((await a.juego.responder(yo, p1.id, 1, canonica)).resultado, 'cerrada', 'el reintento tras el cierre es idempotente');
  } finally {
    await cerrar();
  }
});

test('el fin de partida suma una sola vez al histograma aunque se consulte en paralelo', async () => {
  const { db, a, b, cerrar } = await escenario();
  try {
    const yo = '66666666-6666-4666-8666-666666666666';
    const p = await a.juego.iniciarPartida(yo);
    for (let n = 1; n <= 7; n++) {
      await a.juego.iniciarRonda(yo, p.id, n);
      if (n < 7) await a.juego.pasar(yo, p.id, n);
    }
    // La última ronda vence por tiempo y varias consultas simultáneas cierran la partida.
    await Promise.all([a.avanzar(60_000), b.avanzar(60_000)]);
    await Promise.all([a, b, a, b, a].map((inst) => inst.juego.verPartida(yo, p.id)));
    assert.deepEqual(await db.all('SELECT puntos, cantidad FROM puntajes_desafio'), [{ puntos: 0, cantidad: 1 }]);
  } finally {
    await cerrar();
  }
});

test('numeración: cargar un día anterior al primero renumera todo según la fecha', async () => {
  const reloj = crearReloj('2026-10-05T15:00:00-03:00');
  const { a, cerrar } = await dosInstancias(reloj);
  try {
    const config = cargarConfig({ sinArchivoEnv: true, env: ENV });
    const reserva = cargarReserva(config.rutaReserva, { dominios: config.fuentes.dominios });
    const lote = (desde) => ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'].map((c, i) => reserva.preguntas.filter((p) => p.categoria === c)[(desde + i) % 3]);
    await publicarDesafio(a.db, { fecha: '2026-10-05', preguntas: lote(0), origen: 'reserva' });
    await publicarDesafio(a.db, { fecha: '2026-10-06', preguntas: lote(1), origen: 'reserva' });
    // El juego cacheó el #1 del 5/10 en esta instancia.
    assert.equal((await desafioPorFecha(a.db, '2026-10-05')).numero, 1);
    await publicarDesafio(a.db, { fecha: '2026-10-03', preguntas: lote(2), origen: 'reserva' });
    const numeros = await a.db.all('SELECT fecha, numero FROM desafios ORDER BY fecha');
    assert.deepEqual(numeros, [
      { fecha: '2026-10-03', numero: 1 },
      { fecha: '2026-10-05', numero: 3 },
      { fecha: '2026-10-06', numero: 4 },
    ]);
    // Reemplazar el primero no desordena la numeración.
    await publicarDesafio(a.db, { fecha: '2026-10-03', preguntas: lote(0), origen: 'reserva', reemplazar: true });
    assert.deepEqual((await a.db.all('SELECT numero FROM desafios ORDER BY fecha')).map((d) => d.numero), [1, 3, 4]);
  } finally {
    cerrar();
  }
});
