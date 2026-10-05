// Recorrido completo en un navegador real (opcional): inicio, rechazo, acierto con normalización,
// recarga a mitad de ronda, vencimiento, pasar, final, compartir y partida completada.
//
// Requiere Playwright:  npm i -D playwright && npx playwright install chromium
// Uso:                  npm run test:navegador            (capturas en ./capturas)
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { iniciarServidor } from '../../servidor/index.js';
import { normalizar } from '../../servidor/normalizar.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Falta Playwright. Instalalo con: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const CAPTURAS = resolve(process.env.CAPTURAS || 'capturas');
mkdirSync(CAPTURAS, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'filon-e2e-'));
const silencioso = { info() {}, warn() {}, error: console.error };
const SEGUNDOS = 8;
const app = await iniciarServidor({
  sinArchivoEnv: true,
  log: silencioso,
  env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, 'e2e.db'), IA_PROVEEDOR: 'ninguno', ANTHROPIC_API_KEY: '', TURSO_DATABASE_URL: '', BD_URL: '', SEGUNDOS_POR_PREGUNTA: String(SEGUNDOS) },
});
const BASE = `http://127.0.0.1:${app.puerto}`;
const hoy = (await app.db.get('SELECT fecha FROM desafios ORDER BY fecha LIMIT 1')).fecha;
const respuestasPorPosicion = new Map();
for (let pos = 1; pos <= 7; pos++) {
  respuestasPorPosicion.set(
    pos,
    await app.db.all('SELECT r.* FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id JOIN desafios d ON d.id = p.desafio_id WHERE d.fecha = ? AND p.posicion = ? ORDER BY r.puntos', hoy, pos),
  );
}
const respuestas = (pos) => respuestasPorPosicion.get(pos);
const todasLasCanonicas = (await app.db.all('SELECT canonica FROM respuestas')).map((r) => r.canonica);

let fallas = 0;
function comprobar(condicion, descripcion) {
  console.log(`${condicion ? '✓' : '✗'} ${descripcion}`);
  if (!condicion) fallas++;
}
// Quita tildes pero conserva la ñ, como hace el servidor.
const sinTildesMayus = (t) => t.replace(/ñ/g, '\u0001').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0001/g, 'ñ').toUpperCase();

const navegador = await chromium.launch();
try {
  // ───────── Escritorio ─────────
  const ctx = await navegador.newContext({ viewport: { width: 1366, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
  const visible = (id) => page.waitForSelector(`#${id}:not([hidden])`, { timeout: 15_000 });
  const texto = (sel) => page.textContent(sel);
  let esperado = 0;

  await page.goto(BASE);
  await visible('p-inicio');
  comprobar((await texto('#btn-comenzar')).trim() === 'Comenzar excavación', 'Inicio: botón «Comenzar excavación»');
  comprobar(/\d\d:\d\d:\d\d/.test(await texto('#cuenta-inicio')), 'Inicio: cuenta regresiva al próximo desafío');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(CAPTURAS, 'escritorio-1-inicio.png') });

  // Ronda 1: rechazo y acierto escrito sin tildes y en mayúsculas
  await page.click('#btn-comenzar');
  await visible('p-ronda');
  await page.fill('#campo-respuesta', 'zzzz no existe');
  await page.press('#campo-respuesta', 'Enter');
  await page.waitForFunction(() => document.querySelector('#ronda-mensaje').textContent.includes('no está en la veta'));
  comprobar(true, 'Ronda 1: una respuesta inválida se rechaza y permite reintentar');
  const r1 = respuestas(1).at(-1);
  if (/ñ/i.test(r1.canonica)) {
    const sinEnie = sinTildesMayus(r1.canonica).replace(/Ñ/g, 'N');
    await page.fill('#campo-respuesta', sinEnie);
    await page.press('#campo-respuesta', 'Enter');
    await page.waitForFunction((t) => document.querySelector('#ronda-mensaje').textContent.includes(t), sinEnie);
    comprobar(true, `Ronda 1: «${sinEnie}» se rechaza porque la ñ cuenta`);
  }
  await page.fill('#campo-respuesta', `  ${sinTildesMayus(r1.canonica)} `);
  await page.screenshot({ path: join(CAPTURAS, 'escritorio-2-ronda.png') });
  await page.press('#campo-respuesta', 'Enter');
  await visible('p-resultado');
  await page.waitForSelector('#btn-siguiente:not([disabled])', { timeout: 15_000 });
  esperado += r1.puntos;
  comprobar((await texto('#res-respuesta')).includes(r1.canonica), `Ronda 1: «${sinTildesMayus(r1.canonica)}» se acepta como «${r1.canonica}»`);
  comprobar(normalizar(await texto('#res-titulo')) === r1.rareza, `Ronda 1: muestra la rareza (${r1.rareza}) y la explicación`);
  await page.screenshot({ path: join(CAPTURAS, 'escritorio-3-resultado.png') });

  // Ronda 2: recarga a mitad de ronda y vencimiento
  await page.click('#btn-siguiente');
  await visible('p-ronda');
  const enunciado2 = await texto('#ronda-enunciado');
  await page.waitForTimeout(2600);
  const antes = Number(await texto('#mecha-num'));
  await page.reload();
  await visible('p-ronda');
  const despues = Number(await texto('#mecha-num'));
  comprobar((await texto('#ronda-enunciado')) === enunciado2 && despues <= antes && despues < SEGUNDOS, `Recarga: la ronda sigue igual y el reloj no se reinicia (${antes} s → ${despues} s)`);
  await visible('p-resultado');
  comprobar((await texto('#res-titulo')).includes('Se apagó la mecha'), 'Ronda 2: al vencer el tiempo la ronda vale 0 puntos');
  await page.screenshot({ path: join(CAPTURAS, 'escritorio-4-vencida.png') });

  // Ronda 3: pasar
  await page.click('#btn-siguiente');
  await visible('p-ronda');
  await page.click('#btn-pasar');
  await visible('p-resultado');
  comprobar((await texto('#res-titulo')).includes('Pasaste'), 'Ronda 3: pasar otorga 0 puntos');

  // Rondas 4 a 7
  for (let n = 4; n <= 7; n++) {
    await page.click('#btn-siguiente');
    await visible('p-ronda');
    const r = respuestas(n).at(-1);
    await page.fill('#campo-respuesta', r.canonica);
    await page.press('#campo-respuesta', 'Enter');
    await visible('p-resultado');
    await page.waitForSelector('#btn-siguiente:not([disabled])', { timeout: 15_000 });
    esperado += r.puntos;
  }
  comprobar((await texto('#btn-siguiente')).includes('resultado final'), 'Tras la ronda 7 se ofrece ver el resultado');
  await page.click('#btn-siguiente');
  await visible('p-final');
  await page.waitForTimeout(1500);
  const metros = Number((await texto('#final-metros')).replace(/\./g, ''));
  comprobar(metros === esperado * 10, `Final: profundidad ${metros} m = ${esperado} puntos × 10`);
  comprobar((await page.$$('#desglose li')).length === 7, 'Final: desglose de las 7 preguntas');
  await page.screenshot({ path: join(CAPTURAS, 'escritorio-5-final.png') });

  await page.click('#btn-compartir');
  const compartido = await page.evaluate(() => navigator.clipboard.readText());
  const filtradas = todasLasCanonicas.filter((c) => c.length > 3 && compartido.includes(c));
  comprobar(compartido.startsWith('Filón #') && filtradas.length === 0, 'Compartir: resumen sin revelar respuestas');
  console.log(compartido.split('\n').map((l) => `    ${l}`).join('\n'));

  await page.reload();
  await visible('p-final');
  comprobar((await texto('#final-sobre')).includes('Ya excavaste hoy'), 'Partida completada: al volver se muestra el resultado guardado');
  comprobar(/\d\d:\d\d:\d\d/.test(await texto('#cuenta-final')), 'Partida completada: tiempo hasta el siguiente desafío');
  const otra = await page.request.post(`${BASE}/api/partidas`, { data: {} });
  comprobar((await otra.json()).partida.terminada === true, 'Una sola partida por día para el mismo identificador');

  await page.click('#btn-movimiento');
  comprobar(await page.evaluate(() => document.documentElement.classList.contains('movimiento-reducido')), 'Control de movimiento reducido');
  await page.click('#btn-sonido');
  comprobar((await page.getAttribute('#btn-sonido', 'aria-pressed')) === 'false', 'Control para silenciar el sonido');
  comprobar(errores.length === 0, `Sin errores en la consola${errores.length ? `: ${errores.join(' | ')}` : ''}`);
  await ctx.close();

  // ───────── Celular ─────────
  const movil = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await movil.newPage();
  await mp.goto(BASE);
  await mp.waitForSelector('#p-inicio:not([hidden])');
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: join(CAPTURAS, 'movil-1-inicio.png') });
  await mp.click('#btn-comenzar');
  for (let n = 1; n <= 7; n++) {
    if (n > 1) await mp.click('#btn-siguiente');
    await mp.waitForSelector('#p-ronda:not([hidden])');
    if (n === 1) await mp.screenshot({ path: join(CAPTURAS, 'movil-2-ronda.png') });
    await mp.fill('#campo-respuesta', respuestas(n).at(-1).canonica);
    await mp.press('#campo-respuesta', 'Enter');
    await mp.waitForSelector('#p-resultado:not([hidden])');
    await mp.waitForSelector('#btn-siguiente:not([disabled])', { timeout: 15_000 });
    if (n === 7) await mp.screenshot({ path: join(CAPTURAS, 'movil-3-resultado.png') });
  }
  await mp.click('#btn-siguiente');
  await mp.waitForSelector('#p-final:not([hidden])');
  await mp.waitForTimeout(1500);
  await mp.screenshot({ path: join(CAPTURAS, 'movil-4-final.png') });
  const desborde = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  comprobar(!desborde, 'Celular: sin desplazamiento horizontal');
  await movil.close();
} finally {
  await navegador.close();
  await app.cerrar();
  rmSync(dir, { recursive: true, force: true });
}

console.log(fallas ? `\n${fallas} comprobación(es) fallida(s).` : `\nRecorrido completo OK. Capturas en ${CAPTURAS}`);
process.exit(fallas ? 1 : 0);
