import { test, expect } from '@playwright/test';
import { vigilarErrores } from './ayuda.js';

// Revelado en el final: precarga, reutilización, carga en curso, errores, paginación y filtros.

/** Juega la partida de hoy pasando las siete rondas (por la API, con la cookie de la página) y abre el final. */
async function llegarAlFinal(page, modo = 'normal', { navegar = true } = {}) {
  if (navegar) {
    await page.goto('/');
    await expect(page.locator('#p-inicio')).toBeVisible(); // la página ya tiene su cookie
  }
  const { partida } = await (await page.request.post('/api/partidas', { data: { modo } })).json();
  for (let n = 1; n <= 7; n++) {
    for (const accion of ['iniciar', 'pasar']) expect((await page.request.post(`/api/partidas/${partida.id}/rondas/${n}/${accion}`, { data: {} })).ok()).toBe(true);
  }
  return partida;
}
const pedidosDeRespuestas = (page) => {
  const urls = [];
  page.on('request', (r) => /\/respuestas(\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search) && urls.push(r.url()));
  return urls;
};
const filas = (page) => page.locator('#lista-respuestas li[data-rareza]');

test('final: las respuestas se piden solas, una vez, y abrir o cerrar no repite la descarga', async ({ page }) => {
  const errores = vigilarErrores(page);
  const partida = await llegarAlFinal(page);
  const urls = pedidosDeRespuestas(page);
  const precarga = page.waitForResponse((r) => r.url().endsWith(`/api/partidas/${partida.id}/respuestas`));
  await page.reload();
  await expect(page.locator('#p-final')).toBeVisible();
  expect((await precarga).status()).toBe(200); // sin tocar nada
  const totales = (await (await page.request.get(`/api/partidas/${partida.id}`)).json()).partida.rondas.map((r) => r.totalRespuestas);

  for (const n of [1, 3, 1, 7]) {
    await page.locator('#desglose .respuesta-abrir').nth(n - 1).click();
    await expect(filas(page)).toHaveCount(totales[n - 1]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dlg-respuestas')).toBeHidden();
  }
  expect(urls).toHaveLength(1);
  expect(urls[0]).toMatch(new RegExp(`/api/partidas/${partida.id}/respuestas$`));
  expect(errores).toEqual([]);
});

test('abrir mientras se descarga: muestra la carga y usa el mismo pedido', async ({ page }) => {
  const partida = await llegarAlFinal(page);
  const urls = pedidosDeRespuestas(page);
  let soltar;
  const demora = new Promise((ok) => (soltar = ok));
  await page.route(`**/api/partidas/${partida.id}/respuestas`, async (ruta) => {
    await demora;
    await ruta.continue();
  });
  await page.reload();
  await page.locator('#desglose .respuesta-abrir').first().click();
  await expect(page.locator('#lista-respuestas')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#lista-respuestas .respuestas-cargando')).toContainText('Extrayendo');
  soltar();
  await expect(filas(page).first()).toBeVisible();
  await expect(page.locator('#lista-respuestas')).toHaveAttribute('aria-busy', 'false');
  expect(urls).toHaveLength(1);
});

test('si la descarga falla, el detalle lo dice y deja reintentar sin afectar el final', async ({ page }) => {
  const partida = await llegarAlFinal(page);
  let fallos = 2; // la precarga y el primer intento al abrir
  await page.route(`**/api/partidas/${partida.id}/respuestas`, (ruta) =>
    fallos-- > 0 ? ruta.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'prueba', mensaje: 'La veta no responde (prueba).' }) }) : ruta.continue(),
  );
  await page.reload();
  await expect(page.locator('#p-final')).toBeVisible();
  await page.locator('#desglose .respuesta-abrir').first().click();
  await expect(page.locator('#lista-respuestas')).toContainText('La veta no responde (prueba).');
  await expect(page.locator('#final-metros')).toBeAttached(); // el resultado sigue ahí
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(filas(page).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#desglose .respuesta-abrir').nth(1).click();
  await expect(filas(page).first()).toBeVisible(); // la descarga buena se reutiliza
});

// Lista grande SINTÉTICA (12.000 respuestas) servida por intercepción: prueba la interfaz sin depender del banco.
const TOTAL = 12_000;
const RAREZAS = { diamante: { nombre: 'Diamante', puntos: 100 }, oro: { nombre: 'Oro', puntos: 85 }, plata: { nombre: 'Plata', puntos: 60 }, cobre: { nombre: 'Cobre', puntos: 30 }, grava: { nombre: 'Grava', puntos: 10 } };
const ORDEN = ['diamante', 'oro', 'plata', 'cobre', 'grava'];
const sintetica = Array.from({ length: TOTAL }, (_, i) => ({ canonica: `Sintética ${String(i).padStart(5, '0')}`, rareza: ORDEN[Math.floor((i / TOTAL) * 5)] }));
const contar = (lista) => Object.fromEntries(ORDEN.map((r) => [r, lista.filter((x) => x.rareza === r).length]));

test('lista grande: páginas de 100 (nunca más filas montadas), filtros y búsqueda en el servidor, respuestas tardías descartadas', async ({ page }) => {
  const errores = vigilarErrores(page);
  const partida = await llegarAlFinal(page);
  const pedidas = [];
  await page.route(`**/api/partidas/${partida.id}/respuestas`, async (ruta) => {
    const original = await (await ruta.fetch()).json();
    original.preguntas[0] = { posicion: 1, total: TOTAL, conteos: contar(sintetica), respuestas: sintetica.slice(0, 100).map((r) => [r.canonica, r.rareza]) };
    await ruta.fulfill({ json: original });
  });
  await page.route(`**/api/partidas/${partida.id}/rondas/1/respuestas?*`, async (ruta) => {
    const q = new URL(ruta.request().url()).searchParams;
    pedidas.push(Object.fromEntries(q));
    const buscar = (q.get('buscar') || '').toLowerCase();
    const buscadas = sintetica.filter((r) => r.canonica.toLowerCase().includes(buscar));
    const coinciden = q.get('rareza') ? buscadas.filter((r) => r.rareza === q.get('rareza')) : buscadas;
    const desde = Number(q.get('desde'));
    // La primera búsqueda («00») llega tarde, después de la segunda («001»): no debe pisarla.
    if (buscar === '00') await new Promise((ok) => setTimeout(ok, 1200));
    await ruta.fulfill({
      json: {
        respuestas: coinciden.slice(desde, desde + 100).map((r) => ({ ...r, nombreRareza: RAREZAS[r.rareza].nombre, puntos: RAREZAS[r.rareza].puntos })),
        total: TOTAL, coincidencias: coinciden.length, conteos: contar(buscadas), desde,
        siguiente: desde + 100 < coinciden.length ? desde + 100 : null, anterior: desde ? desde - 100 : null,
      },
    });
  });
  await page.reload();
  await page.locator('#desglose .respuesta-abrir').first().click();
  await expect(filas(page)).toHaveCount(100);
  expect(pedidas).toHaveLength(0); // la primera página vino con el final
  await expect(page.locator('#respuestas-rango')).toHaveText('1–100 de 12.000');
  await expect(page.locator('#respuestas-anterior')).toBeDisabled();

  for (let i = 0; i < 3; i++) await page.click('#respuestas-siguiente');
  await expect(page.locator('#respuestas-rango')).toHaveText('301–400 de 12.000');
  await expect(filas(page)).toHaveCount(100);
  await expect(filas(page).first()).toContainText('Sintética 00300');
  expect(await page.locator('#lista-respuestas li').count()).toBeLessThanOrEqual(100);
  await page.click('#respuestas-anterior');
  await expect(filas(page).first()).toContainText('Sintética 00200');
  await page.click('#respuestas-siguiente'); // ya guardada: no se vuelve a pedir
  await expect(filas(page).first()).toContainText('Sintética 00300');
  expect(pedidas.filter((p) => p.desde === '300')).toHaveLength(1);

  // Filtro de rareza: cuenta sobre el total y vuelve a la primera página.
  await expect(page.locator('#respuestas-rarezas [data-filtro="oro"]')).toContainText('2.400');
  await page.click('#respuestas-rarezas [data-filtro="oro"]');
  await expect(page.locator('#respuestas-rarezas [data-filtro="oro"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(filas(page).first()).toContainText('Sintética 02400');
  expect(pedidas.at(-1)).toMatchObject({ rareza: 'oro', desde: '0' });
  await expect(page.locator('#respuestas-ayuda')).toContainText('2.400 de 12.000');
  await page.click('#respuestas-rarezas [data-filtro=""]');

  // Búsqueda en el servidor: «00» llega después que «001» y se descarta.
  await page.fill('#respuestas-buscar', '00');
  await page.waitForTimeout(400);
  await page.fill('#respuestas-buscar', '001');
  const con001 = sintetica.filter((r) => r.canonica.includes('001'));
  const esperado = `${new Intl.NumberFormat('es-AR').format(con001.length)} de 12.000 respuestas coinciden`;
  await expect(page.locator('#respuestas-ayuda')).toContainText(esperado);
  await page.waitForTimeout(1500); // llega la respuesta vieja de «00»
  await expect(page.locator('#respuestas-ayuda')).toContainText(esperado);
  await expect(filas(page).first()).toContainText(con001[0].canonica);
  expect(pedidas.some((p) => p.buscar === '00')).toBe(true);
  expect(errores).toEqual([]);
});

test('cambio de desafío: al pasar a otro modo se descartan las respuestas guardadas y se piden las del nuevo', async ({ page }) => {
  const errores = vigilarErrores(page);
  const normal = await llegarAlFinal(page);
  const farandula = await llegarAlFinal(page, 'farandula', { navegar: false });
  const urls = pedidosDeRespuestas(page);
  await page.reload();
  await expect(page.locator('#p-final')).toBeVisible();
  await page.locator('#desglose .respuesta-abrir').first().click();
  await expect(filas(page).first()).toBeVisible();
  const enunciadoNormal = await page.locator('#respuestas-pregunta').textContent();
  await page.keyboard.press('Escape');

  // Sin recargar: el selector de modos abre el final de Farándula.
  await page.click('#btn-modos');
  await page.click('.modo-opcion[data-modo="farandula"]');
  await expect(page.locator('#p-final')).toBeVisible();
  await page.locator('#desglose .respuesta-abrir').first().click();
  await expect(filas(page).first()).toBeVisible();
  expect(await page.locator('#respuestas-pregunta').textContent()).not.toBe(enunciadoNormal);
  const datos = (await (await page.request.get(`/api/partidas/${farandula.id}/rondas/1/respuestas`)).json()).respuestas;
  await expect(filas(page)).toHaveCount(datos.length);
  await expect(filas(page).first()).toContainText(datos[0].canonica);
  expect(urls.filter((u) => u.endsWith(`/api/partidas/${normal.id}/respuestas`))).toHaveLength(1);
  expect(urls.filter((u) => u.endsWith(`/api/partidas/${farandula.id}/respuestas`))).toHaveLength(1);
  expect(errores).toEqual([]);
});
