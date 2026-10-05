// Banco de reserva: preguntas curadas y validadas de antemano, usadas si la IA falla.
import { readFileSync } from 'node:fs';
import { validarPregunta, buscarRepeticion } from '../validacion.js';
import { generadorConSemilla } from '../azar.js';
import { normalizar } from '../normalizar.js';

/** Carga y valida (en modo estricto) todo el banco de reserva. */
export function cargarReserva(ruta, { dominios }) {
  const datos = JSON.parse(readFileSync(ruta, 'utf8'));
  const validas = [];
  const invalidas = [];
  const ids = new Set();
  for (const bruta of datos.preguntas || []) {
    const r = validarPregunta(bruta, { dominios, estricta: true });
    if (!bruta.id || ids.has(bruta.id)) r.errores.push('Identificador ausente o repetido.');
    ids.add(bruta.id);
    if (r.ok && r.errores.length === 0) validas.push({ ...r.pregunta, origen: 'reserva' });
    else invalidas.push({ id: bruta.id, errores: r.errores, advertencias: r.advertencias, descartadas: r.descartadas });
  }
  return { version: datos.version, revisado: datos.revisado, preguntas: validas, invalidas };
}

/**
 * Elige una pregunta de reserva por categoría:
 * primero las que no repiten nada reciente, luego las nunca usadas o usadas hace más tiempo.
 * Si todas se usaron hace poco, elige la menos reciente y lo informa.
 */
export function elegirDeReserva({ reserva, categorias, recientes, usos, fecha }) {
  const azar = generadorConSemilla(`reserva:${fecha}`);
  const elegidas = new Map();
  const avisos = [];
  for (const categoria of categorias) {
    const candidatas = reserva.preguntas
      .filter((p) => p.categoria === categoria)
      .map((p) => ({
        p,
        repetida: Boolean(buscarRepeticion({ id: p.id, huella: p.huella, claves: p.respuestas.map((r) => normalizar(r.canonica)) }, recientes)),
        ultima: usos.get(p.id)?.ultima ?? '',
        sorteo: azar(),
      }))
      .sort((a, b) => Number(a.repetida) - Number(b.repetida) || a.ultima.localeCompare(b.ultima) || a.sorteo - b.sorteo);
    if (!candidatas.length) {
      avisos.push(`No hay preguntas de reserva para la categoría ${categoria}.`);
      continue;
    }
    if (candidatas[0].repetida) avisos.push(`Todas las preguntas de reserva de ${categoria} se usaron hace poco; se repite la menos reciente.`);
    elegidas.set(categoria, candidatas[0].p);
  }
  return { elegidas, avisos };
}
