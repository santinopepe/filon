import { test, expect } from '@playwright/test';
import { bancoDeHoy, masRara, vigilarErrores } from './ayuda.js';

test('carga inicial: portada, cuenta regresiva y sin errores', async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/Filón/);
  await expect(page.locator('#btn-comenzar')).toBeVisible();
  await expect(page.locator('#cuenta-inicio')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  const inicio = await page.locator('#p-inicio').boundingBox();
  expect(Math.abs(inicio.x + inicio.width / 2 - page.viewportSize().width / 2)).toBeLessThan(1);
  expect(await page.locator('#panel').evaluate((el) => getComputedStyle(el).position)).toBe('relative');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(page.locator('#inicio-meta')).toBeInViewport();
  expect(errores).toEqual([]);
});

test('comienzo de partida, respuesta incorrecta y correcta', async ({ page, request }) => {
  const banco = await bancoDeHoy(request);
  const errores = vigilarErrores(page);
  await page.goto('/');
  await page.click('#btn-comenzar');
  await expect(page.locator('#p-ronda')).toBeVisible();
  await expect(page.locator('#ronda-num')).toHaveText('Pregunta 1 de 7');
  await expect(page.locator('#ronda-enunciado')).toHaveText(banco.preguntas[0].enunciado);

  await page.fill('#campo-respuesta', 'esto no está en ninguna veta');
  await page.press('#campo-respuesta', 'Enter');
  await expect(page.locator('#ronda-mensaje')).toHaveClass(/error/);
  await expect(page.locator('#p-ronda')).toBeVisible();

  const correcta = masRara(banco, 1);
  await page.fill('#campo-respuesta', correcta.canonica);
  await page.press('#campo-respuesta', 'Enter');
  await expect(page.locator('#p-resultado')).toBeVisible();
  await expect(page.locator('#res-respuesta')).toContainText(correcta.canonica);
  await expect(page.locator('#res-puntos')).toContainText(`+${correcta.puntos} puntos`);
  expect(errores).toEqual([]);
});

test('doble envío: dos respuestas correctas simultáneas puntúan una sola vez', async ({ page, request }) => {
  const banco = await bancoDeHoy(request);
  await page.goto('/');
  await page.click('#btn-comenzar');
  await expect(page.locator('#p-ronda')).toBeVisible();
  const { partidaHoy } = await (await page.request.get('/api/estado')).json();
  const correcta = masRara(banco, 1);
  // Mismas cookies que la página: dos POST a la vez, como un doble clic con red lenta.
  const ruta = `/api/partidas/${partidaHoy.id}/rondas/1/respuesta`;
  const [a, b] = await Promise.all([page.request.post(ruta, { data: { texto: correcta.canonica } }), page.request.post(ruta, { data: { texto: correcta.canonica } })]);
  const resultados = [(await a.json()).resultado, (await b.json()).resultado].sort();
  expect(resultados).toEqual(['aceptada', 'cerrada']);
  const partida = (await (await page.request.get(`/api/partidas/${partidaHoy.id}`)).json()).partida;
  expect(partida.puntos).toBe(correcta.puntos);
});

test('recarga durante una partida: la ronda sigue y el reloj no se reinicia', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-comenzar');
  await expect(page.locator('#p-ronda')).toBeVisible();
  const enunciado = await page.locator('#ronda-enunciado').textContent();
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.locator('#p-ronda')).toBeVisible();
  await expect(page.locator('#ronda-enunciado')).toHaveText(enunciado);
  const segundos = Number(await page.locator('#mecha-num').textContent());
  expect(segundos).toBeLessThanOrEqual(23);
});

test('cierre y revelado: al terminar se ven todas las respuestas válidas', async ({ page, request }) => {
  const banco = await bancoDeHoy(request);
  await page.goto('/');
  await page.click('#btn-comenzar');
  const correcta = masRara(banco, 1);
  await page.fill('#campo-respuesta', correcta.canonica);
  await page.press('#campo-respuesta', 'Enter');
  for (let n = 2; n <= 7; n++) {
    await page.locator('#btn-siguiente:not([disabled])').click();
    await expect(page.locator('#p-ronda')).toBeVisible();
    await page.click('#btn-pasar');
    await expect(page.locator('#p-resultado')).toBeVisible();
  }
  await page.locator('#btn-siguiente:not([disabled])').click();
  await expect(page.locator('#p-final')).toBeVisible();
  await expect(page.locator('#final-metros')).toHaveText(new Intl.NumberFormat('es-AR').format(correcta.puntos * 10));
  await expect(page.locator('#desglose .respuesta-abrir')).toHaveCount(7);

  const final = await page.locator('#p-final').boundingBox();
  expect(Math.abs(final.x + final.width / 2 - page.viewportSize().width / 2)).toBeLessThan(1);
  await expect(page.locator('#recorrido')).toBeVisible();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('#recorrido-fin')).toBeInViewport();
    await expect(page.locator('#marcador-texto')).toHaveText(`${new Intl.NumberFormat('es-AR').format(correcta.puntos * 10)} m`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#marcador-texto')).toHaveText('0 m');
  }

  await page.locator('#desglose .respuesta-abrir').first().click();
  const dialogo = page.locator('#dlg-respuestas');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.locator('.lista-respuestas li')).toHaveCount(banco.preguntas[0].respuestas.length);
  await expect(dialogo.locator('li.es-tuya')).toContainText(correcta.canonica);
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  // La revelación no se ofrece antes de terminar la ronda (el servidor la niega).
  const { partidaHoy } = await (await page.request.get('/api/estado')).json();
  expect((await page.request.get(`/api/partidas/${partidaHoy.id}/rondas/1/respuestas?limite=500`)).status()).toBe(200);
});

test('móvil y teclado: se juega sin mouse y sin desborde horizontal', async ({ browser }) => {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await contexto.newPage();
  const errores = vigilarErrores(page);
  await page.goto('/');
  await page.locator('#btn-comenzar').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#p-ronda')).toBeVisible();
  await expect(page.locator('#campo-respuesta')).toBeFocused();
  await page.keyboard.type('otra cosa que no existe');
  await page.keyboard.press('Enter');
  await expect(page.locator('#ronda-mensaje')).toHaveClass(/error/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errores).toEqual([]);
  await contexto.close();
});

for (const conPuntos of [false, true]) {
  test(`recorrido de una partida guardada ${conPuntos ? 'hasta el fondo' : 'sin descenso'}`, async ({ page, request }) => {
    const errores = vigilarErrores(page);
    const banco = await bancoDeHoy(request);
    await page.goto('/');
    await expect(page.locator('#btn-comenzar')).toBeVisible();
    const inicio = await page.request.post('/api/partidas', { data: {} });
    expect(inicio.ok()).toBe(true);
    const { partida } = await inicio.json();
    let profundidad = 0;
    for (let n = 1; n <= 7; n++) {
      const ruta = `/api/partidas/${partida.id}/rondas/${n}`;
      expect((await page.request.post(`${ruta}/iniciar`, { data: {} })).ok()).toBe(true);
      if (conPuntos) {
        const correcta = masRara(banco, n);
        profundidad += correcta.puntos * 10;
        expect((await page.request.post(`${ruta}/respuesta`, { data: { texto: correcta.canonica } })).ok()).toBe(true);
      } else {
        expect((await page.request.post(`${ruta}/pasar`, { data: {} })).ok()).toBe(true);
      }
    }
    await page.reload();
    await expect(page.locator('#p-final')).toBeVisible();
    await expect(page.locator('#final-metros')).toHaveText(new Intl.NumberFormat('es-AR').format(profundidad));
    if (conPuntos) {
      await page.mouse.wheel(0, 100000);
      await expect(page.locator('#recorrido-fin')).toBeInViewport();
      await expect(page.locator('#marcador-texto')).toHaveText(`${new Intl.NumberFormat('es-AR').format(profundidad)} m`);
      await page.mouse.wheel(0, -100000);
      await expect(page.locator('#final-titulo')).toBeInViewport();
      await expect(page.locator('#marcador-texto')).toHaveText('0 m');
    } else {
      await expect(page.locator('#recorrido')).toBeHidden();
      await page.locator('#cuenta-final').scrollIntoViewIfNeeded();
      await expect(page.locator('#cuenta-final')).toBeInViewport();
    }
    expect(errores).toEqual([]);
  });
}
