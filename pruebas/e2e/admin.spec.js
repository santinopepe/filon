import { test, expect } from '@playwright/test';
import { TOKEN_ADMIN_E2E, lotePorCategoria, enunciadosRecientes, vigilarErrores } from './ayuda.js';

async function ingresar(page, token = TOKEN_ADMIN_E2E) {
  await page.goto('/admin');
  await expect(page.locator('#ingreso')).toBeVisible();
  await page.fill('#token', token);
  await page.click('#ingresar');
}

test('administración sin autenticación: la API rechaza y el panel pide ingresar', async ({ page }) => {
  expect((await page.request.get('/api/admin/desafios')).status()).toBe(401);
  expect((await page.request.post('/api/admin/desafios/2030-01-01/generar', { data: { modo: 'reserva' } })).status()).toBe(401);
  await page.goto('/admin');
  await expect(page.locator('#ingreso')).toBeVisible();
  await expect(page.locator('#panel')).toBeHidden();
});

test('login y logout: sesión en cookie HttpOnly, nada en el almacenamiento, revocada al salir', async ({ page, context }) => {
  const errores = vigilarErrores(page);
  await ingresar(page, 'token-equivocado');
  await expect(page.locator('#error-ingreso')).toHaveText('Token incorrecto.');
  await expect(page.locator('#token')).toHaveValue('');

  await ingresar(page);
  await expect(page.locator('#nav')).toBeVisible();
  await expect(page.locator('#kpis .kpi')).toHaveCount(5);
  const almacenado = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(almacenado).not.toContain(TOKEN_ADMIN_E2E);
  const cookie = (await context.cookies()).find((c) => c.name === 'filon_admin');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');

  await page.reload();
  await expect(page.locator('#nav')).toBeVisible(); // la sesión sobrevive a una recarga

  await page.click('#salir');
  await expect(page.locator('#ingreso')).toBeVisible();
  await expect(page.locator('#error-ingreso')).toHaveText('Cerraste la sesión.');
  // La cookie vieja ya no sirve: el servidor la revocó.
  await context.addCookies([{ ...cookie }]);
  expect((await page.request.get('/api/admin/desafios')).status()).toBe(401);
  expect(errores).toEqual([]);
});

test('importación JSON: inválida no guarda nada; válida publica el día', async ({ page }) => {
  await ingresar(page);
  await page.click('#tab-crear');
  await expect(page.locator('#pestana-crear')).toBeVisible();
  await page.fill('#normal-imp-fecha', '2030-03-15');

  await page.fill('#normal-imp-json', '{ esto no es JSON');
  await page.click('#normal-imp-boton');
  await expect(page.locator('#normal-imp-resultado')).toContainText('JSON inválido');

  const recientes = await enunciadosRecientes(page.request);
  const lote = lotePorCategoria(recientes);
  // Un lote con una pregunta ya publicada hoy: «Solo validar» la marca como repetida y no publica.
  const yaPublicada = lotePorCategoria([]).find((p) => recientes.includes(p.enunciado));
  await page.fill('#normal-imp-json', JSON.stringify({ preguntas: lote.map((p) => (p.categoria === yaPublicada.categoria ? yaPublicada : p)) }));
  await page.click('#normal-imp-validar');
  await expect(page.locator('#normal-imp-resultado')).toHaveClass(/mal/);
  await expect(page.locator('#normal-imp-resultado')).toContainText('repite «');

  await page.fill('#normal-imp-json', JSON.stringify({ preguntas: lote }));
  await page.click('#normal-imp-validar');
  await expect(page.locator('#normal-imp-resultado')).toHaveClass(/ok/);
  await expect(page.locator('#normal-imp-resultado')).toContainText('El JSON es válido');
  expect((await page.request.get('/api/admin/desafios/2030-03-15')).status()).toBe(404);

  await page.fill('#normal-imp-json', JSON.stringify({ preguntas: lote.slice(0, 6) }));
  await page.click('#normal-imp-boton');
  await expect(page.locator('#normal-imp-resultado')).toHaveClass(/mal/);
  await expect(page.locator('#normal-imp-resultado')).toContainText('7 preguntas');

  await page.fill('#normal-imp-json', JSON.stringify({ preguntas: lote }));
  await page.click('#normal-imp-boton');
  await expect(page.locator('#normal-imp-resultado')).toHaveClass(/ok/);
  await expect(page.locator('#normal-imp-resultado')).toContainText('Desafío manual publicado');
  expect((await (await page.request.get('/api/admin/desafios/2030-03-15')).json()).preguntas).toHaveLength(7);
});

test('pestañas del panel por teclado (flechas, Inicio y Fin)', async ({ page }) => {
  await ingresar(page);
  await expect(page.locator('#nav')).toBeVisible();
  await page.locator('#tab-resumen').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-desafios')).toBeFocused();
  await expect(page.locator('#tab-desafios')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pestana-desafios')).toBeVisible();
  await expect(page.locator('#tab-resumen')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(page.locator('#tab-reportes')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-resumen')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#tab-reportes')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#tab-resumen')).toHaveAttribute('aria-selected', 'true');
  // Las filas de desafíos son botones: se eligen con el teclado.
  await page.keyboard.press('ArrowRight');
  const fila = page.locator('#tabla-desafios .boton-fila').first();
  await fila.focus();
  await page.keyboard.press('Enter');
  await expect(fila).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#detalle .pregunta')).toHaveCount(7);
});

test('generar con otra IA: prompt a mano, descargas del historial y copia con historial', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ingresar(page);
  await page.click('#tab-crear');
  const prompt = page.locator('#normal-prompt-texto');
  await expect(prompt).toHaveValue(/^Sos el editor de preguntas de Filón/);
  await expect(prompt).toHaveValue(/Historial reciente:\n\[\]\n/);

  const [json] = await Promise.all([page.waitForEvent('download'), page.click('#normal-hist-json')]);
  expect(json.suggestedFilename()).toMatch(/^filon-historial-\d{4}-\d{2}-\d{2}-3d\.json$/);
  const datos = JSON.parse(await (await json.createReadStream()).toArray().then((p) => Buffer.concat(p).toString('utf8')));
  expect(datos.preguntas.length).toBeGreaterThanOrEqual(7);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#normal-hist-csv')]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);

  await page.click('#normal-prompt-copiar-historial');
  await expect(page.locator('#normal-prompt-estado')).toContainText('Prompt copiado con');
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado).toContain('Historial reciente:\n[\n  {"fecha":');
  expect(copiado).toContain(datos.preguntas[0].enunciado);
  expect(copiado).toContain('Generá ahora el desafío completo.');

  // Las ediciones quedan en este navegador y se pueden descartar.
  await prompt.fill('Prompt editado de prueba');
  await page.reload();
  await page.click('#tab-crear');
  await expect(page.locator('#normal-prompt-texto')).toHaveValue('Prompt editado de prueba');
  await page.click('#normal-prompt-restaurar');
  await expect(page.locator('#normal-prompt-texto')).toHaveValue(/^Sos el editor de preguntas de Filón/);
});

test('crear por modo: pestañas Normal, Farándula y Geografía con prompt e historial propios', async ({ page }) => {
  const errores = vigilarErrores(page);
  await ingresar(page);
  await page.click('#tab-crear');
  await expect(page.locator('#tab-crear-normal')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#crear-normal')).toBeVisible();

  await page.click('#tab-crear-farandula');
  await expect(page.locator('#crear-farandula')).toBeVisible();
  await expect(page.locator('#crear-normal')).toBeHidden();
  await expect(page.locator('#farandula-prompt-texto')).toHaveValue(/modo Farándula Argentina/);
  await expect(page.locator('#farandula-gen-modo option')).toHaveCount(1); // sin IA automática: solo reserva
  const [json] = await Promise.all([page.waitForEvent('download'), page.click('#farandula-hist-json')]);
  expect(json.suggestedFilename()).toMatch(/^filon-historial-farandula-/);
  const datos = JSON.parse(await (await json.createReadStream()).toArray().then((p) => Buffer.concat(p).toString('utf8')));
  expect(datos.modo).toBe('farandula');
  expect(datos.preguntas.every((p) => p.categoria === 'farandula')).toBe(true);

  // Flechas del teclado entre los modos.
  await page.locator('#tab-crear-farandula').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-crear-geografia')).toBeFocused();
  await expect(page.locator('#geografia-prompt-texto')).toHaveValue(/modo Geografía/);

  // Lo escrito en un modo no aparece en otro.
  await page.fill('#geografia-imp-json', '{"preguntas":[]}');
  await page.click('#tab-crear-normal');
  await expect(page.locator('#normal-imp-json')).toHaveValue('');

  // El listado de desafíos se filtra por modo.
  await page.click('#tab-desafios');
  await page.selectOption('#des-modo', 'geografia');
  await expect(page.locator('#detalle .pregunta')).toHaveCount(7);
  await expect(page.locator('#detalle .cabecera-detalle')).toContainText('Geografía');
  expect(errores).toEqual([]);
});
