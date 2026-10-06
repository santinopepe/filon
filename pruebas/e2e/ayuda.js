// Utilidades compartidas por las pruebas E2E.
import { readFileSync } from 'node:fs';

export const TOKEN_ADMIN_E2E = 'token-admin-solo-para-e2e';
export const BEARER = { authorization: `Bearer ${TOKEN_ADMIN_E2E}` };

/** Banco del día (solo para las pruebas, por la API de administración). */
export async function bancoDeHoy(request) {
  const { fecha } = await (await request.get('/api/salud')).json();
  const r = await request.get(`/api/admin/desafios/${fecha}`, { headers: BEARER });
  return { fecha, ...(await r.json()) };
}

export const masRara = (banco, n) => [...banco.preguntas[n - 1].respuestas].sort((a, b) => b.puntos - a.puntos)[0];

/** Siete preguntas válidas (una por categoría) tomadas de la reserva, para la carga manual. */
export function lotePorCategoria() {
  const reserva = JSON.parse(readFileSync(new URL('../../datos/reserva.json', import.meta.url), 'utf8'));
  return ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'].map((c) => reserva.preguntas.find((p) => p.categoria === c));
}

/** Junta los errores de consola y de la página para afirmar que no hubo ninguno. */
export function vigilarErrores(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errores.push(m.text()));
  return errores;
}
