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

/**
 * Siete preguntas válidas (una por categoría) de la reserva, para la carga manual.
 * `usadas`: enunciados ya publicados (por ejemplo, el historial reciente) que se evitan.
 */
export const preguntasDeReserva = () => JSON.parse(readFileSync(new URL('../../datos/reserva.json', import.meta.url), 'utf8')).preguntas;

export function lotePorCategoria(usadas = []) {
  const reserva = { preguntas: preguntasDeReserva() };
  const evitar = new Set(usadas);
  return ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'].map(
    (c) => reserva.preguntas.find((p) => p.categoria === c && !evitar.has(p.enunciado)) ?? reserva.preguntas.find((p) => p.categoria === c),
  );
}

/** Enunciados publicados en los últimos días (los que la carga manual no debe repetir). */
export async function enunciadosRecientes(request) {
  const r = await request.get('/api/admin/historial?dias=3', { headers: BEARER });
  return (await r.json()).preguntas.map((p) => p.enunciado);
}

/** Junta los errores de consola y de la página para afirmar que no hubo ninguno. */
export function vigilarErrores(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errores.push(m.text()));
  return errores;
}
