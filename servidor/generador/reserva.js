// Banco de reserva: preguntas curadas y validadas de antemano, usadas si la IA falla.
import { readFileSync } from 'node:fs';
import { validarPregunta, buscarRepeticion } from '../validacion.js';
import { generadorConSemilla } from '../azar.js';
import { normalizar } from '../normalizar.js';
import { categoriaDeRanura, MODO_POR_DEFECTO } from '../dominio.js';
import { preguntaParaEditar } from '../banco.js';

/** Carga y valida (en modo estricto) todo el banco de reserva de un modo. */
export function cargarReserva(ruta, { dominios, modo = MODO_POR_DEFECTO }) {
  const datos = JSON.parse(readFileSync(ruta, 'utf8'));
  const validas = [];
  const invalidas = [];
  const ids = new Set();
  for (const bruta of datos.preguntas || []) {
    const r = validarPregunta(bruta, { dominios, estricta: true, modo });
    if (!bruta.id || ids.has(bruta.id)) r.errores.push('Identificador ausente o repetido.');
    ids.add(bruta.id);
    if (r.ok && r.errores.length === 0) validas.push({ ...r.pregunta, origen: 'reserva' });
    else invalidas.push({ id: bruta.id, errores: r.errores, advertencias: r.advertencias, descartadas: r.descartadas });
  }
  return { modo, version: datos.version, revisado: datos.revisado, preguntas: validas, invalidas };
}

/**
 * Elige una pregunta de reserva por ranura (en Normal, cada ranura es una categoría; en los modos
 * temáticos, las siete ranuras comparten categoría y nunca se repite una pregunta en el mismo día):
 * primero las que no repiten nada reciente, luego las nunca usadas o usadas hace más tiempo.
 * Si todas se usaron hace poco, elige la menos reciente y lo informa.
 */
export function elegirDeReserva({ reserva, categorias, recientes, usos, fecha }) {
  const azar = generadorConSemilla(`reserva:${fecha}`);
  const elegidas = new Map();
  const usadas = new Set();
  const avisos = [];
  for (const ranura of categorias) {
    const categoria = categoriaDeRanura(ranura);
    const candidatas = reserva.preguntas
      .filter((p) => p.categoria === categoria && !usadas.has(p.id))
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
    elegidas.set(ranura, candidatas[0].p);
    usadas.add(candidatas[0].p.id);
  }
  return { elegidas, avisos };
}

// ───── Reserva en la base (editable desde el panel) ─────

/**
 * Pasa una pregunta validada (forma interna) al formato de los bancos de reserva (datos/reserva.json):
 * sin puntos ni formas normalizadas, con la fuente de cada respuesta solo si difiere de la general.
 */
export function aFormatoReserva(p) {
  const general = p.fuentes?.[0]?.url;
  return {
    id: p.id,
    categoria: p.categoria,
    enunciado: p.enunciado,
    alcance: p.alcance,
    fuentes: (p.fuentes || []).map((f) => ({ url: f.url, titulo: f.titulo })),
    respuestas: (p.respuestas || []).map((r) => ({
      canonica: r.canonica,
      variantes: r.variantes || [],
      rareza: r.rareza,
      explicacion: r.explicacion,
      ...(r.fuente?.url && r.fuente.url !== general ? { fuente: { url: r.fuente.url, titulo: r.fuente.titulo } } : {}),
    })),
    rechazos: (p.rechazos || []).map((x) => ({ textos: x.textos, motivo: x.motivo })),
  };
}

/**
 * Guarda preguntas (ya validadas) en la reserva de un modo. Sin `reemplazar` no pisa una que ya esté
 * (por ejemplo, editada a mano). Las que ya están en el banco de archivo (`idsArchivo`) no se duplican.
 */
export async function guardarEnReserva(db, modo, preguntas, { origen, reemplazar = false, idsArchivo = new Set(), ahora = Date.now() } = {}) {
  let guardadas = 0;
  for (const p of preguntas) {
    if (!p.id || (!reemplazar && idsArchivo.has(p.id))) continue;
    const datos = JSON.stringify(aFormatoReserva(p));
    const sql = reemplazar
      ? `INSERT INTO reserva (id, modo, pregunta, origen, activa, creada_en, actualizada_en) VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET pregunta = excluded.pregunta, origen = excluded.origen, modo = excluded.modo, actualizada_en = excluded.actualizada_en`
      : 'INSERT OR IGNORE INTO reserva (id, modo, pregunta, origen, activa, creada_en, actualizada_en) VALUES (?, ?, ?, ?, 1, ?, ?)';
    const r = await db.run(sql, p.id, modo, datos, origen, ahora, ahora);
    guardadas += r.changes;
  }
  return guardadas;
}

/** Activa o saca de circulación una pregunta de la reserva (también una del archivo). */
export async function cambiarEstadoReserva(db, modo, id, activa, { base = null, ahora = Date.now() } = {}) {
  const r = await db.run('UPDATE reserva SET activa = ?, actualizada_en = ? WHERE id = ? AND modo = ?', activa ? 1 : 0, ahora, id, modo);
  if (r.changes) return true;
  // Una pregunta del archivo se desactiva con una fila que la reemplaza.
  const delArchivo = base?.preguntas.find((p) => p.id === id);
  if (!delArchivo) return false;
  await db.run(
    "INSERT INTO reserva (id, modo, pregunta, origen, activa, creada_en, actualizada_en) VALUES (?, ?, ?, 'edicion', ?, ?, ?)",
    id, modo, JSON.stringify(aFormatoReserva(delArchivo)), activa ? 1 : 0, ahora, ahora,
  );
  return true;
}

/**
 * Reserva completa de un modo: el banco de archivo más lo guardado en la base. Una fila de la base con
 * el mismo id reemplaza a la del archivo; las inactivas no se usan. Las filas que ya no validan
 * (por ejemplo, un dominio de fuentes que se quitó de la configuración) quedan en `invalidas`.
 */
export async function reservaCompleta(db, modo, base, { dominios, conInactivas = false } = {}) {
  const filas = await db.all('SELECT id, pregunta, origen, activa, creada_en, actualizada_en FROM reserva WHERE modo = ?', modo);
  const porId = new Map((base?.preguntas || []).map((p) => [p.id, { pregunta: p, origen: 'archivo', activa: true }]));
  const invalidas = [];
  for (const f of filas) {
    const r = validarPregunta(JSON.parse(f.pregunta), { dominios, estricta: true, modo });
    if (!r.ok) {
      invalidas.push({ id: f.id, errores: r.errores });
      if (f.activa) continue;
    }
    porId.set(f.id, { pregunta: { ...r.pregunta, id: f.id, origen: 'reserva' }, origen: f.origen, activa: Boolean(f.activa), actualizadaEn: f.actualizada_en, valida: r.ok });
  }
  const entradas = [...porId.values()].filter((e) => conInactivas || e.activa);
  return { modo, preguntas: entradas.map((e) => e.pregunta), entradas, invalidas };
}

/**
 * Copia a la reserva de la base las preguntas ya publicadas de un modo (las que no vienen del banco de
 * archivo ni están ya guardadas), y deja cada día vinculado a su pregunta de reserva para contar los
 * usos. Idempotente: correrla de nuevo no duplica nada. Con `seco` solo informa qué haría.
 */
export async function copiarPublicadasAReserva(db, modo, { idsArchivo = new Set(), dominios = [], seco = false, ahora = Date.now() } = {}) {
  const filas = await db.all(
    // Las del generador por catálogos no: se vuelven a armar desde los catálogos y pueden tener miles de respuestas.
    `SELECT p.id, p.reserva_id, p.origen, d.fecha FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE d.modo = ? AND p.origen <> 'catalogo' ORDER BY d.fecha, p.posicion`,
    modo,
  );
  const informe = { revisadas: filas.length, delArchivo: 0, yaEstaban: 0, copiadas: 0, invalidas: [] };
  for (const f of filas) {
    if (f.reserva_id && idsArchivo.has(f.reserva_id)) {
      informe.delArchivo++;
      continue;
    }
    const pregunta = await preguntaParaEditar(db, f.id);
    if (await db.get('SELECT 1 AS si FROM reserva WHERE id = ?', pregunta.id)) {
      informe.yaEstaban++;
      continue;
    }
    const v = validarPregunta(pregunta, { dominios, estricta: true, modo });
    if (!v.ok) {
      informe.invalidas.push({ id: pregunta.id, fecha: f.fecha, errores: v.errores });
      continue;
    }
    informe.copiadas++;
    if (seco) continue;
    await guardarEnReserva(db, modo, [{ ...v.pregunta, id: pregunta.id }], { origen: f.origen === 'ia' ? 'ia' : 'manual', ahora });
    if (!f.reserva_id) await db.run('UPDATE preguntas SET reserva_id = ? WHERE id = ?', pregunta.id, f.id);
  }
  return informe;
}
