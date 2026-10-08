import { test, expect } from '@playwright/test';
import { bancoDeHoy, masRara, vigilarErrores, BEARER } from './ayuda.js';
import { normalizar } from '../../servidor/normalizar.js';

test('un fragmento autocompleta el campo y un segundo Enter confirma la respuesta', async ({ page, request }) => {
  const banco = await bancoDeHoy(request);
  const respuestas = banco.preguntas[0].respuestas;
  const opciones = respuestas.map((r) => ({
    canonica: r.canonica,
    fragmento: normalizar(r.canonica).slice(0, -2),
    formas: [r.canonica, ...r.variantes].map(normalizar),
  }));
  const elegida = opciones.find((r) => r.fragmento.length >= 5
    && !opciones.some((otra) => otra.formas.includes(r.fragmento))
    && opciones.filter((otra) => otra.formas.some((f) => f.includes(r.fragmento))).length === 1);
  expect(elegida).toBeTruthy();
  await page.goto('/');
  await page.click('#btn-comenzar');
  await page.fill('#campo-respuesta', elegida.fragmento);
  await page.press('#campo-respuesta', 'Enter');
  await expect(page.locator('#campo-respuesta')).toHaveValue(elegida.canonica);
  await expect(page.locator('#ronda-mensaje')).toContainText('Enter de nuevo para confirmarla');
  await expect(page.locator('#campo-respuesta')).toBeFocused();
  const { partidaHoy } = await (await page.request.get('/api/estado')).json();
  expect(partidaHoy.rondas[0].estado).toBe('activa');
  expect(partidaHoy.rondas[0].intentos).toEqual([]);
  await page.press('#campo-respuesta', 'Enter');
  await expect(page.locator('#p-resultado')).toBeVisible();
  await expect(page.locator('#res-respuesta')).toContainText(elegida.canonica);
});

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

test('mecha apagada: lo que quedó escrito va como último intento', async ({ page, request }) => {
  const errores = vigilarErrores(page);
  const banco = await bancoDeHoy(request);
  const valida = masRara(banco, 1);
  // El reloj del navegador se adelanta; el del servidor no, así que el último intento llega «a tiempo»,
  // como cuando entra dentro del margen de red (GRACIA_RED_MS).
  await page.clock.install();
  await page.goto('/');
  await page.click('#btn-comenzar');
  await expect(page.locator('#p-ronda')).toBeVisible();
  await page.fill('#campo-respuesta', valida.canonica);
  await page.clock.fastForward(26_000);
  await expect(page.locator('#ronda-mensaje')).toContainText('último intento');
  await expect(page.locator('#p-resultado')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#res-titulo')).not.toHaveText('Se apagó la mecha');
  const { partidaHoy } = await (await page.request.get('/api/estado')).json();
  expect(partidaHoy.rondas[0].estado).toBe('acertada');
  expect(partidaHoy.rondas[0].respuesta.canonica).toBe(valida.canonica);

  // Si lo escrito no vale, se explica por qué y la ronda se cierra igual.
  await page.click('#btn-siguiente');
  await expect(page.locator('#p-ronda')).toBeVisible();
  await page.fill('#campo-respuesta', 'zzzz no existe');
  await page.clock.fastForward(26_000);
  await expect(page.locator('#ronda-mensaje')).toContainText('«zzzz no existe»');
  await expect(page.locator('#campo-respuesta')).toBeDisabled();
  const { partidaHoy: despues } = await (await page.request.get('/api/estado')).json();
  expect(despues.rondas[1].intentos.map((i) => i.texto ?? i)).toContain('zzzz no existe');
  expect(errores).toEqual([]);
});

test('modo desactivado: no aparece en el selector y un enlace viejo abre Normal', async ({ page }) => {
  const errores = vigilarErrores(page);
  // Simula MODOS_ACTIVOS=normal,geografia: el servidor no lista Farándula y responde con Normal.
  await page.route(/\/api\/estado/, async (ruta) => {
    const respuesta = await ruta.fetch({ url: ruta.request().url().replace('modo=farandula', 'modo=normal') });
    const cuerpo = await respuesta.json();
    cuerpo.modos = cuerpo.modos.filter((m) => m.clave !== 'farandula');
    await ruta.fulfill({ response: respuesta, json: cuerpo });
  });
  await page.goto('/?modo=farandula');
  await expect(page.locator('#btn-comenzar')).toBeVisible();
  await expect(page).not.toHaveURL(/modo=/);
  await expect(page.locator('body')).toHaveClass(/modo-normal/);
  await page.click('#btn-modos');
  const dialogo = page.locator('#dlg-modos');
  await expect(dialogo.locator('.modo-opcion:visible')).toHaveCount(2);
  await expect(dialogo.locator('.modo-opcion[data-modo="farandula"]')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('filon:prefs') ?? '{}').modo ?? 'normal')).toBe('normal');
  expect(errores).toEqual([]);
});

test('modos: el menú ☰ abre el selector y cada modo tiene su ambientación y su partida diaria', async ({ page, request }) => {
  const errores = vigilarErrores(page);
  await page.goto('/');
  await expect(page.locator('#btn-comenzar')).toBeVisible();
  await page.click('#btn-modos');
  const dialogo = page.locator('#dlg-modos');
  await expect(dialogo).toBeVisible();
  await expect(page.locator('#btn-modos')).toHaveAttribute('aria-expanded', 'true');
  await expect(dialogo.locator('.modo-opcion')).toHaveCount(3);
  for (const nombre of ['Normal', 'Farándula Argentina', 'Geografía']) {
    const opcion = dialogo.locator('.modo-opcion', { hasText: nombre });
    await expect(opcion.locator('.modo-mini')).toBeVisible();
    await expect(opcion.locator('.modo-nombre')).toHaveText(nombre);
  }
  await expect(dialogo.locator('.modo-opcion[data-modo="normal"]')).toHaveAttribute('aria-current', 'true');

  // Farándula: textos, URL y desafío propios.
  await dialogo.locator('.modo-opcion[data-modo="farandula"]').click();
  await expect(dialogo).toBeHidden();
  await expect(page).toHaveURL(/\?modo=farandula$/);
  await expect(page.locator('body')).toHaveClass(/modo-farandula/);
  await expect(page.locator('#inicio-modo')).toHaveText('Farándula Argentina');
  await expect(page.locator('#btn-comenzar')).toHaveText('Bajar de la limusina');
  const { fecha } = await (await request.get('/api/salud')).json();
  const banco = await (await request.get(`/api/admin/desafios/${fecha}?modo=farandula`, { headers: BEARER })).json();

  await page.click('#btn-comenzar');
  await expect(page.locator('#p-ronda')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#ronda-categoria')).toHaveText('Farándula');
  await expect(page.locator('#ronda-enunciado')).toHaveText(banco.preguntas[0].enunciado);
  // Mientras corre la mecha no se puede cambiar de modo.
  await page.click('#btn-modos');
  await expect(dialogo).toBeHidden();
  await expect(page.locator('#aviso')).toContainText('Terminá la ronda');

  // La recarga vuelve al mismo modo y a la misma ronda.
  await page.reload();
  await expect(page.locator('#p-ronda')).toBeVisible();
  await expect(page.locator('#ronda-enunciado')).toHaveText(banco.preguntas[0].enunciado);
  for (let n = 1; n <= 7; n++) {
    await expect(page.locator('#p-ronda')).toBeVisible({ timeout: 8000 });
    await page.click('#btn-pasar');
    await expect(page.locator('#p-resultado')).toBeVisible();
    await page.click('#btn-siguiente');
  }
  await expect(page.locator('#p-final')).toBeVisible();
  await expect(page.locator('#final-unidad')).toHaveText('metros');

  // Farándula quedó jugada; Geografía sigue disponible y usa kilómetros.
  await page.click('#btn-modos');
  await expect(dialogo.locator('.modo-opcion[data-modo="farandula"] .modo-estado')).toHaveText(/Jugado hoy/);
  await expect(dialogo.locator('.modo-opcion[data-modo="geografia"] .modo-estado')).toHaveText('Disponible');
  await dialogo.locator('.modo-opcion[data-modo="geografia"]').click();
  await expect(page.locator('#btn-comenzar')).toHaveText('Despegar');
  await expect(page.locator('#btn-comenzar')).toBeEnabled();
  await expect(page.locator('#tope')).toHaveText('42.000 km');

  // Volver a Farándula muestra el resultado guardado (no se puede jugar de nuevo hoy).
  await page.goto('/?modo=farandula');
  await expect(page.locator('#p-final')).toBeVisible();
  await expect(page.locator('#final-sobre')).toContainText('Ya desfilaste hoy');
  expect(errores).toEqual([]);
});

test('celular: con el teclado abierto la ronda se compacta sola, sin esperar a que se scrollee', async ({ browser }) => {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await contexto.newPage();
  // visualViewport simulado: el teclado «sube» sin disparar ningún evento (como pasa en iOS).
  await page.addInitScript(() => {
    const vv = new EventTarget();
    let alto = 844;
    Object.defineProperties(vv, {
      height: { get: () => alto },
      width: { get: () => 390 },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { get: () => vv });
    window.__teclado = (abierto) => (alto = abierto ? 480 : 844);
  });
  await page.goto('/?modo=geografia');
  await page.click('#btn-comenzar');
  await expect(page.locator('#p-ronda')).toBeVisible({ timeout: 8000 });
  await page.locator('#campo-respuesta').focus();
  await page.evaluate(() => window.__teclado(true));
  await expect(page.locator('body')).toHaveClass(/teclado-abierto/);
  const pregunta = await page.locator('#ronda-enunciado').boundingBox();
  const campo = await page.locator('#campo-respuesta').boundingBox();
  expect(pregunta.y).toBeGreaterThan(0);
  expect(campo.y + campo.height).toBeLessThanOrEqual(480);
  await page.evaluate(() => window.__teclado(false));
  await page.locator('#campo-respuesta').blur();
  await expect(page.locator('body')).not.toHaveClass(/teclado-abierto/);
  await contexto.close();
});
