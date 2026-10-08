// Preparación del revelado de respuestas: se hace una vez al publicar (o editar) una pregunta, no en cada
// lectura. Cada respuesta guarda su posición en el orden del revelado (más puntos primero; a igual
// puntaje, orden alfabético español; a igual nombre, por id) y su forma normalizada para buscar. La
// pregunta guarda el total y la cantidad por rareza. Así una página es un rango del índice
// (pregunta_id, orden) y nadie ordena ni cuenta miles de filas al servir una solicitud.
import { normalizar } from './normalizar.js';
import { ORDEN_RAREZAS } from './dominio.js';

const ordenEspanol = new Intl.Collator('es');
const FILAS_POR_SENTENCIA = 200;

/** Conteos vacíos por rareza ({ grava: 0, …, diamante: 0 }). */
export const conteosVacios = () => Object.fromEntries(ORDEN_RAREZAS.map((r) => [r, 0]));

/** Recalcula orden, forma de búsqueda y conteos de una pregunta. `cx` es la base o una transacción. */
export async function prepararRevelado(cx, preguntaId) {
  const filas = await cx.all('SELECT id, canonica, rareza, puntos FROM respuestas WHERE pregunta_id = ?', preguntaId);
  filas.sort((a, b) => b.puntos - a.puntos || ordenEspanol.compare(a.canonica, b.canonica) || a.id - b.id);
  const conteos = conteosVacios();
  for (const f of filas) conteos[f.rareza]++;
  // UPDATE … FROM (VALUES …): pocas sentencias aunque la pregunta tenga miles de respuestas.
  for (let i = 0; i < filas.length; i += FILAS_POR_SENTENCIA) {
    const tanda = filas.slice(i, i + FILAS_POR_SENTENCIA);
    await cx.run(
      `UPDATE respuestas SET orden = v.column2, normalizada = v.column3
       FROM (VALUES ${tanda.map(() => '(?, ?, ?)').join(', ')}) AS v WHERE respuestas.id = v.column1`,
      ...tanda.flatMap((f, j) => [f.id, i + j, normalizar(f.canonica)]),
    );
  }
  const resumen = { total: filas.length, ...conteos };
  await cx.run('UPDATE preguntas SET conteos = ? WHERE id = ?', JSON.stringify(resumen), preguntaId);
  return resumen;
}
