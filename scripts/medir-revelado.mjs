#!/usr/bin/env node
// Medición reproducible del final de partida y del revelado de respuestas (solo local, base temporal).
//
//   node scripts/medir-revelado.mjs                       # backend: banco real (datos/reserva.json)
//   node scripts/medir-revelado.mjs --sintetico 12000     # una pregunta SINTÉTICA de 12.000 respuestas
//   node scripts/medir-revelado.mjs --latencia 10         # simula 10 ms por viaje a la base (Turso)
//   node scripts/medir-revelado.mjs --navegador           # además, tiempos en Chromium con red simulada
//
// Separa: viajes a la base por solicitud (lo que cuesta en Turso), tiempo de servidor, bytes
// transferidos y, en el navegador, el tiempo hasta que la pantalla o la primera fila son visibles.
// «Frío» = instancia nueva (cachés vacías, como una función de Vercel recién creada); «caliente» = repetido.
// Nunca apunta a producción.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cargarConfig, RAIZ } from '../servidor/config.js';
import { abrirBD, obtenerSecreto } from '../servidor/db.js';
import { crearJuego } from '../servidor/juego.js';
import { crearApi } from '../servidor/api.js';
import { crearEstaticos } from '../servidor/http.js';
import { publicarDesafio } from '../servidor/banco.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { normalizar } from '../servidor/normalizar.js';
import { fechaLocal } from '../servidor/tiempo.js';

const args = process.argv.slice(2);
const valor = (f, def) => (args.includes(f) ? args[args.indexOf(f) + 1] : def);
const SINTETICO = Number(valor('--sintetico', 0));
const LATENCIA = Number(valor('--latencia', 0));
const NAVEGADOR = args.includes('--navegador');
const REPETICIONES = Number(valor('--repeticiones', 5));

const dir = mkdtempSync(join(tmpdir(), 'filon-medir-'));
const env = {
  RUTA_BD: join(dir, 'medir.db'), TURSO_DATABASE_URL: '', BD_URL: '', PROGRAMADOR_INTERNO: '0',
  SECRETO_SESION: 'medicion-local', LIMITES_ESCALA: '100', COOKIE_SEGURA: '0', VERCEL: '',
};
const config = cargarConfig({ sinArchivoEnv: true, env });

// ───── Base instrumentada: cuenta viajes (y opcionalmente simula su latencia) ─────
const contador = { viajes: 0 };
const dormir = (ms) => (ms > 0 ? new Promise((ok) => setTimeout(ok, ms)) : null);
function instrumentar(cx) {
  for (const m of ['get', 'all', 'run']) {
    const original = cx[m].bind(cx);
    cx[m] = async (...a) => {
      contador.viajes++;
      await dormir(LATENCIA);
      return original(...a);
    };
  }
  return cx;
}
async function abrirInstrumentada() {
  const db = await abrirBD(config.rutaBD);
  instrumentar(db);
  const transaccion = db.transaccion;
  db.transaccion = (fn) => {
    contador.viajes += 2; // BEGIN y COMMIT
    return transaccion(async (tx) => {
      await dormir(2 * LATENCIA);
      return fn(instrumentar(tx));
    });
  };
  return db;
}

/** Una «instancia» nueva (cachés vacías): servidor HTTP con API y estáticos sobre la misma base. */
async function instancia() {
  const db = await abrirInstrumentada();
  const ahora = () => Date.now();
  const juego = crearJuego({ db, config, ahora });
  const api = crearApi({ db, config, juego, secreto: await obtenerSecreto(db, config.secretoSesion), contexto: null, ahora, registro: { info() {}, warn() {}, error: console.error } });
  const estaticos = crearEstaticos(resolve(RAIZ, 'publico'));
  const servidor = createServer(async (req, res) => {
    if (await api(req, res, req.url)) return;
    if (estaticos(req, res, req.url)) return;
    if (!req.url.includes('.') && estaticos(req, res, '/index.html')) return;
    res.writeHead(404).end();
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  return { db, base: `http://127.0.0.1:${servidor.address().port}`, cerrar: () => new Promise((ok) => servidor.close(ok)).then(() => db.close()) };
}

// ───── Banco ─────
const RAREZAS = [['grava', 10], ['cobre', 30], ['plata', 60], ['oro', 85], ['diamante', 100]];
function preguntaSintetica(categoria, n) {
  return {
    categoria,
    enunciado: `[SINTÉTICA] Nombrá una entidad de la lista de prueba de ${categoria}.`,
    alcance: 'Lista sintética de medición: no es contenido del juego.',
    huella: `sintetica-${categoria}-${n}`,
    origen: 'ia',
    fuentes: [{ url: 'https://es.wikipedia.org/wiki/Prueba', titulo: 'Prueba' }],
    rechazos: [],
    respuestas: Array.from({ length: n }, (_, i) => {
      const [rareza, puntos] = RAREZAS[i % 5];
      const canonica = `Entidad sintética ${categoria} ${String(i).padStart(5, '0')}`;
      return { canonica, rareza, puntos, explicacion: 'Sintética.', variantes: [], formas: [normalizar(canonica)] };
    }),
  };
}

const preparacion = await abrirBD(config.rutaBD);
const hoy = fechaLocal(Date.now(), config.zona);
if (SINTETICO) {
  const categorias = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];
  const t0 = performance.now();
  await publicarDesafio(preparacion, { fecha: hoy, preguntas: categorias.map((c, i) => preguntaSintetica(c, i === 0 ? SINTETICO : 20)), origen: 'ia' });
  console.log(`Banco SINTÉTICO: pregunta 1 con ${SINTETICO.toLocaleString('es-AR')} respuestas, las otras 6 con 20 (publicado en ${Math.round(performance.now() - t0)} ms).`);
} else {
  const reserva = cargarReserva(config.rutaReserva, { dominios: config.fuentes.dominios });
  await asegurarDesafio({ db: preparacion, config, fecha: hoy, reserva });
  const n = await preparacion.all('SELECT COUNT(*) AS n FROM respuestas GROUP BY pregunta_id');
  console.log(`Banco real (datos/reserva.json): ${n.map((f) => f.n).join(', ')} respuestas por pregunta.`);
}
preparacion.close();
console.log(LATENCIA ? `Latencia simulada por viaje a la base: ${LATENCIA} ms.` : 'Sin latencia simulada (base local en archivo).');

// ───── Cliente HTTP con cookie ─────
function cliente(base) {
  let cookie = '';
  return {
    usar(b) {
      base = b;
    },
    get cookie() {
      return cookie;
    },
    async pedir(metodo, ruta, cuerpo) {
      const viajes0 = contador.viajes;
      const t0 = performance.now();
      const res = await fetch(base + ruta, {
        method: metodo,
        headers: { ...(cookie ? { cookie } : {}), ...(metodo === 'POST' ? { 'content-type': 'application/json', origin: base } : {}), 'accept-encoding': 'gzip' },
        body: metodo === 'POST' ? JSON.stringify(cuerpo ?? {}) : undefined,
      });
      const texto = await res.text();
      const ms = performance.now() - t0;
      const nueva = res.headers.get('set-cookie');
      if (nueva) cookie = nueva.split(';')[0];
      return { estado: res.status, datos: texto ? JSON.parse(texto) : null, ms, viajes: contador.viajes - viajes0, bytes: Buffer.byteLength(texto) };
    },
  };
}

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fila = (nombre, m) => console.log(`  ${nombre.padEnd(52)} ${String(m.viajes).padStart(4)} viajes  ${m.ms.toFixed(1).padStart(7)} ms  ${(m.bytes / 1024).toFixed(1).padStart(7)} KB`);

async function jugarHastaElFinal(c, { ultima = true } = {}) {
  const p = (await c.pedir('POST', '/api/partidas', {})).datos.partida;
  let ultimaMedicion = null;
  for (let n = 1; n <= 7; n++) {
    if (n === 7 && !ultima) break;
    await c.pedir('POST', `/api/partidas/${p.id}/rondas/${n}/iniciar`);
    ultimaMedicion = await c.pedir('POST', `/api/partidas/${p.id}/rondas/${n}/pasar`);
  }
  return { partidaId: p.id, ultima: ultimaMedicion };
}

// ───── Backend ─────
console.log('\nBackend (servidor local; viajes = consultas a la base por solicitud)');
const finales = [];
for (let i = 0; i < REPETICIONES; i++) {
  const inst = await instancia();
  const { ultima } = await jugarHastaElFinal(cliente(inst.base));
  finales.push(ultima);
  await inst.cerrar();
}
fila('última respuesta (pasar ronda 7) → partida final', { viajes: mediana(finales.map((f) => f.viajes)), ms: mediana(finales.map((f) => f.ms)), bytes: finales[0].bytes });

const fria = await instancia();
const c = cliente(fria.base);
const { partidaId } = await jugarHastaElFinal(c);
await fria.cerrar();

// Lo que el final necesita para mostrar las respuestas de las 7 preguntas.
// Con una partida inexistente: una ruta que no existe responde «no_encontrado» (y no calienta cachés).
const resumenDisponible = async (inst) => (await cliente(inst.base).pedir('GET', '/api/partidas/00000000-0000-4000-8000-000000000000/respuestas')).datos?.error !== 'no_encontrado';
async function medirRevelado(etiqueta, caliente) {
  const inst = await instancia();
  c.usar(inst.base);
  if (caliente) for (let n = 1; n <= 7; n++) await c.pedir('GET', `/api/partidas/${partidaId}/rondas/${n}/respuestas?desde=0&limite=100`);
  const tieneResumen = await resumenDisponible(inst);
  const medidas = [];
  if (tieneResumen) {
    medidas.push(['resumen del final (7 preguntas, 1.ª página c/u)', await c.pedir('GET', `/api/partidas/${partidaId}/respuestas`)]);
  } else {
    let total = { viajes: 0, ms: 0, bytes: 0 };
    for (let n = 1; n <= 7; n++) {
      const m = await c.pedir('GET', `/api/partidas/${partidaId}/rondas/${n}/respuestas?desde=0&limite=100`);
      total = { viajes: total.viajes + m.viajes, ms: total.ms + m.ms, bytes: total.bytes + m.bytes };
    }
    medidas.push(['las 7 preguntas, 1.ª página (7 solicitudes)', total]);
  }
  medidas.push(['pregunta 1, 1.ª página', await c.pedir('GET', `/api/partidas/${partidaId}/rondas/1/respuestas?desde=0&limite=100`)]);
  medidas.push(['pregunta 1, búsqueda «0042»', await c.pedir('GET', `/api/partidas/${partidaId}/rondas/1/respuestas?desde=0&limite=100&buscar=0042`)]);
  if (SINTETICO > 5000) medidas.push(['pregunta 1, página en desde=5000', await c.pedir('GET', `/api/partidas/${partidaId}/rondas/1/respuestas?desde=5000&limite=100`)]);
  const rareza = await c.pedir('GET', `/api/partidas/${partidaId}/rondas/1/respuestas?desde=0&limite=100&rareza=diamante`);
  if (rareza.datos?.rareza === 'diamante') medidas.push(['pregunta 1, filtro diamante', rareza]);
  console.log(`\nRevelado ${etiqueta}`);
  for (const [n, m] of medidas) fila(n, m);
  await inst.cerrar();
}
await medirRevelado('en frío (instancia nueva, cachés vacías)', false);
await medirRevelado('con caché (instancia que ya lo sirvió)', true);

// Memoria que retiene la caché del proceso al revelar la pregunta 1 (primera página y una búsqueda).
// Se mide sobre la base directamente para aislarla del resto; correlo con --expose-gc.
{
  const banco = await import('../servidor/banco.js');
  const db = await abrirBD(config.rutaBD);
  await banco.sincronizarCaches(db);
  const heap = () => (globalThis.gc?.(), process.memoryUsage().heapUsed);
  const pregunta = (await banco.preguntasDeDesafio(db, (await db.get('SELECT id FROM desafios')).id))[0];
  const h0 = heap();
  if (banco.catalogoParaRevelar) await banco.catalogoParaRevelar(db, pregunta.id);
  else for (const opciones of [{}, { buscar: '0042' }]) await banco.paginaDeRespuestas(db, pregunta, opciones);
  const h1 = heap();
  console.log(`\nMemoria que retiene la caché por la pregunta 1: ${((h1 - h0) / 1048576).toFixed(2)} MB${globalThis.gc ? '' : ' (indicativo: correlo con node --expose-gc)'}`);
  db.close();
}

// ───── Navegador ─────
async function corridaEnNavegador() {
  const { chromium } = await import('playwright');
  const inst = await instancia();
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  // Red simulada (móvil 4G lento): 150 ms de ida y vuelta, 1,6 Mb/s de bajada.
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 94_000 });
  const pedidos = [];
  page.on('request', (r) => r.url().includes('/respuestas') && pedidos.push(r.url()));
  await page.goto(inst.base + '/');
  await page.waitForSelector('#p-inicio:not([hidden])', { timeout: 60_000 }); // la página ya tiene su cookie
  // Seis rondas por la API con la cookie del navegador; la séptima se juega en la página.
  const req = page.context().request;
  const p = (await (await req.post(`${inst.base}/api/partidas`, { data: {} })).json()).partida;
  for (let n = 1; n <= 6; n++) {
    for (const accion of ['iniciar', 'pasar']) {
      const r = await req.post(`${inst.base}/api/partidas/${p.id}/rondas/${n}/${accion}`, { data: {} });
      if (!r.ok()) throw new Error(`${accion} ${n}: ${r.status()} ${await r.text()}`);
    }
  }
  await page.goto(inst.base + '/');
  // Inicio con la partida empezada: «Seguir» retoma en la ronda 7.
  await page.click('#btn-comenzar');
  await page.waitForSelector('#p-ronda:not([hidden]) #btn-pasar:not([disabled])', { timeout: 60_000 });
  let t0 = Date.now();
  await page.click('#btn-pasar');
  await page.waitForSelector('#p-resultado:not([hidden]) #btn-siguiente:not([disabled])');
  const tPasar = Date.now() - t0;
  const pedidosAntes = pedidos.length;
  t0 = Date.now();
  await page.click('#btn-siguiente');
  await page.waitForSelector('#p-final:not([hidden]) #desglose li');
  const tFinal = Date.now() - t0;
  const fila1 = '#lista-respuestas li[data-rareza]';
  await page.waitForTimeout(1500); // el jugador mira su resultado
  const precargados = pedidos.length - pedidosAntes;
  t0 = Date.now();
  await page.click('#desglose li:nth-child(1) .respuesta-abrir');
  await page.waitForSelector(fila1);
  const tAbrir = Date.now() - t0;
  const filas1 = await page.locator('#lista-respuestas li').count();
  await page.keyboard.press('Escape');
  const antesReabrir = pedidos.length;
  t0 = Date.now();
  await page.click('#desglose li:nth-child(1) .respuesta-abrir');
  await page.waitForSelector(fila1);
  const tReabrir = Date.now() - t0;
  const pedidosReabrir = pedidos.length - antesReabrir;
  // Recorrer varias páginas: ¿cuántas filas quedan montadas?
  for (let i = 0; i < 5; i++) {
    const siguientePagina = page.locator('#respuestas-mas:not([hidden]):not([disabled]), #respuestas-siguiente:not([hidden]):not([disabled])');
    if (!(await siguientePagina.count())) break;
    await siguientePagina.first().click();
    await page.waitForTimeout(400);
  }
  const filasTras5 = await page.locator('#lista-respuestas li').count();
  await page.keyboard.press('Escape');
  t0 = Date.now();
  await page.click('#desglose li:nth-child(2) .respuesta-abrir');
  await page.waitForSelector(fila1);
  const tOtra = Date.now() - t0;
  await navegador.close();
  await inst.cerrar();
  return { tPasar, tFinal, precargados, tAbrir, filas1, tReabrir, pedidosReabrir, tOtra, filasTras5, total: pedidos.length };
}

if (NAVEGADOR) {
  const corridas = [];
  for (let i = 0; i < 3; i++) corridas.push(await corridaEnNavegador());
  const m = (k) => mediana(corridas.map((x) => x[k]));
  console.log('\nNavegador (Chromium, red simulada 150 ms RTT y 1,6 Mb/s; movimiento reducido; mediana de 3 corridas)');
  console.log(`  pasar la ronda 7 → resultado visible                 ${m('tPasar')} ms`);
  console.log(`  «Ver el resultado final» → pantalla final visible    ${m('tFinal')} ms`);
  console.log(`  solicitudes de respuestas hechas solas en el final   ${m('precargados')}`);
  console.log(`  abrir respuestas de la pregunta 1 → primera fila     ${m('tAbrir')} ms (${m('filas1')} filas montadas)`);
  console.log(`  cerrar y reabrir → primera fila                      ${m('tReabrir')} ms (${m('pedidosReabrir')} solicitudes)`);
  console.log(`  abrir la pregunta 2 → primera fila                   ${m('tOtra')} ms`);
  console.log(`  filas montadas tras avanzar 5 páginas                ${m('filasTras5')}`);
  console.log(`  solicitudes de respuestas en total                   ${m('total')}`);
}

rmSync(dir, { recursive: true, force: true });
