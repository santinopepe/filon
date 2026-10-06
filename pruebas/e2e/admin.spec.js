import { test, expect } from '@playwright/test';
import { TOKEN_ADMIN_E2E, lotePorCategoria, vigilarErrores } from './ayuda.js';

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
  await page.fill('#imp-fecha', '2030-03-15');

  await page.fill('#imp-json', '{ esto no es JSON');
  await page.click('#imp-boton');
  await expect(page.locator('#imp-resultado')).toContainText('JSON inválido');

  const lote = lotePorCategoria();
  await page.fill('#imp-json', JSON.stringify({ preguntas: lote.slice(0, 6) }));
  await page.click('#imp-boton');
  await expect(page.locator('#imp-resultado')).toHaveClass(/mal/);
  await expect(page.locator('#imp-resultado')).toContainText('7 preguntas');

  await page.fill('#imp-json', JSON.stringify({ preguntas: lote }));
  await page.click('#imp-boton');
  await expect(page.locator('#imp-resultado')).toHaveClass(/ok/);
  await expect(page.locator('#imp-resultado')).toContainText('Desafío manual publicado');
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
