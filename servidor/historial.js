// Historial de preguntas publicadas, para pasárselo a una IA y que no repita consignas.
import { LIMITES } from './dominio.js';

/**
 * Preguntas publicadas desde `desde` (incluye los días ya programados a futuro), en orden de fecha y
 * posición, con sus respuestas canónicas (las más comunes primero, con tope por pregunta).
 */
export async function historialDesde(db, desde, { maxRespuestas = LIMITES.respuestasEnDetalleAdmin } = {}) {
  const preguntas = await db.all(
    `SELECT d.fecha, d.numero, p.id, p.posicion, p.categoria, p.enunciado, p.alcance
     FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE d.fecha >= ? ORDER BY d.fecha, p.posicion`,
    desde,
  );
  const respuestas = await db.all(
    `SELECT r.pregunta_id, r.canonica FROM respuestas r
     JOIN preguntas p ON p.id = r.pregunta_id JOIN desafios d ON d.id = p.desafio_id
     WHERE d.fecha >= ? ORDER BY r.puntos, r.id`,
    desde,
  );
  const porPregunta = new Map(preguntas.map((p) => [p.id, []]));
  for (const r of respuestas) porPregunta.get(r.pregunta_id)?.push(r.canonica);
  return preguntas.map((p) => {
    const todas = porPregunta.get(p.id);
    return {
      fecha: p.fecha,
      numero: p.numero,
      posicion: p.posicion,
      categoria: p.categoria,
      enunciado: p.enunciado,
      alcance: p.alcance,
      totalRespuestas: todas.length,
      respuestas: todas.slice(0, maxRespuestas),
    };
  });
}

const celda = (valor) => {
  const texto = String(valor ?? '');
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
};

/** CSV (RFC 4180) con BOM para que Excel respete los acentos. */
export function historialACsv(preguntas) {
  const filas = [['fecha', 'numero', 'posicion', 'categoria', 'enunciado', 'alcance', 'total_respuestas', 'respuestas']];
  for (const p of preguntas) {
    filas.push([p.fecha, p.numero, p.posicion, p.categoria, p.enunciado, p.alcance, p.totalRespuestas, p.respuestas.join(' | ')]);
  }
  return `\uFEFF${filas.map((f) => f.map(celda).join(',')).join('\r\n')}\r\n`;
}
