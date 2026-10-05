// Estadísticas para el panel de administración: totales, serie diaria y detalle de un día.
import { CATEGORIAS, METROS_POR_PUNTO, PREGUNTAS_POR_DESAFIO } from './dominio.js';
import { desafioPorFecha, preguntasDeDesafio } from './banco.js';
import { fechaLocal, inicioDeFecha, sumarDias } from './tiempo.js';

const percentil = (ordenados, p) => {
  if (!ordenados.length) return null;
  const i = (ordenados.length - 1) * p;
  const a = Math.floor(i);
  const b = Math.ceil(i);
  return ordenados[a] + (ordenados[b] - ordenados[a]) * (i - a);
};

/** Promedio, desviación, mediana y cuartiles de una lista de números. */
export function resumir(valores) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const promedio = valores.reduce((s, v) => s + v, 0) / valores.length;
  const desviacion = Math.sqrt(valores.reduce((s, v) => s + (v - promedio) ** 2, 0) / valores.length);
  return {
    cantidad: valores.length,
    promedio,
    desviacion,
    minimo: ordenados[0],
    p25: percentil(ordenados, 0.25),
    mediana: percentil(ordenados, 0.5),
    p75: percentil(ordenados, 0.75),
    maximo: ordenados.at(-1),
  };
}

async function totales(db) {
  const fila = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM jugadores) AS visitantes,
       (SELECT COUNT(DISTINCT jugador_id) FROM partidas) AS jugadores,
       (SELECT COUNT(*) FROM (SELECT jugador_id FROM partidas GROUP BY jugador_id HAVING COUNT(DISTINCT desafio_id) >= 2)) AS recurrentes,
       (SELECT COUNT(*) FROM partidas) AS partidas,
       (SELECT COUNT(*) FROM partidas WHERE terminada_en IS NOT NULL) AS terminadas,
       (SELECT COUNT(*) FROM reportes WHERE estado = 'pendiente') AS reportesPendientes`,
  );
  return fila;
}

/** Una fila por día del rango (incluye días sin desafío, en cero). */
async function serieDiaria(db, { desde, hasta, zona }) {
  const porDia = await db.all(
    `SELECT d.fecha, d.numero,
            COUNT(p.id) AS jugadores,
            COALESCE(SUM(p.terminada_en IS NOT NULL), 0) AS terminadas,
            AVG(CASE WHEN p.terminada_en IS NOT NULL THEN p.puntos END) AS promedioPuntos
     FROM desafios d LEFT JOIN partidas p ON p.desafio_id = d.id
     WHERE d.fecha BETWEEN ? AND ?
     GROUP BY d.id`,
    desde,
    hasta,
  );
  // Visitantes nuevos: jugadores cuya primera visita cae en ese día local.
  const visitas = await db.all(
    'SELECT creado_en FROM jugadores WHERE creado_en >= ? AND creado_en < ?',
    inicioDeFecha(desde, zona),
    inicioDeFecha(sumarDias(hasta, 1), zona),
  );
  const nuevos = new Map();
  for (const v of visitas) {
    const f = fechaLocal(v.creado_en, zona);
    nuevos.set(f, (nuevos.get(f) || 0) + 1);
  }
  const datos = new Map(porDia.map((d) => [d.fecha, d]));
  const serie = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const d = datos.get(f);
    serie.push({
      fecha: f,
      desafio: Boolean(d),
      numero: d?.numero ?? null,
      visitantesNuevos: nuevos.get(f) || 0,
      jugadores: d?.jugadores || 0,
      terminadas: d?.terminadas || 0,
      promedioMetros: d?.promedioPuntos == null ? null : d.promedioPuntos * METROS_POR_PUNTO,
    });
  }
  return serie;
}

async function detalleDelDia(db, fecha) {
  const desafio = await desafioPorFecha(db, fecha);
  if (!desafio) return null;
  const partidas = await db.all('SELECT puntos, terminada_en FROM partidas WHERE desafio_id = ?', desafio.id);
  const metros = partidas.filter((p) => p.terminada_en != null).map((p) => p.puntos * METROS_POR_PUNTO);

  const estados = await db.all(
    `SELECT r.posicion, r.estado, COUNT(*) AS n, COALESCE(SUM(r.puntos), 0) AS puntos
     FROM rondas r JOIN partidas p ON p.id = r.partida_id
     WHERE p.desafio_id = ? GROUP BY r.posicion, r.estado`,
    desafio.id,
  );
  const rarezas = await db.all(
    `SELECT r.posicion, x.rareza, COUNT(*) AS n
     FROM rondas r JOIN partidas p ON p.id = r.partida_id JOIN respuestas x ON x.id = r.respuesta_id
     WHERE p.desafio_id = ? AND r.estado = 'acertada' GROUP BY r.posicion, x.rareza`,
    desafio.id,
  );
  const aceptadas = await db.all(
    `SELECT r.posicion, x.canonica AS texto, COUNT(*) AS veces
     FROM rondas r JOIN partidas p ON p.id = r.partida_id JOIN respuestas x ON x.id = r.respuesta_id
     WHERE p.desafio_id = ? AND r.estado = 'acertada'
     GROUP BY r.posicion, x.id ORDER BY veces DESC`,
    desafio.id,
  );
  // Intentos que no estaban en la veta: si muchos repiten lo mismo, puede faltar una respuesta.
  const fallidas = await db.all(
    `SELECT i.posicion, MIN(i.texto) AS texto, COUNT(*) AS veces
     FROM intentos i JOIN partidas p ON p.id = i.partida_id
     WHERE p.desafio_id = ? AND i.aceptado = 0
     GROUP BY i.posicion, i.normalizado ORDER BY veces DESC`,
    desafio.id,
  );

  const preguntas = (await preguntasDeDesafio(db, desafio.id)).map((q) => {
    const de = (lista) => lista.filter((x) => x.posicion === q.posicion);
    const cuenta = Object.fromEntries(de(estados).map((e) => [e.estado, e.n]));
    const jugadas = (cuenta.acertada || 0) + (cuenta.pasada || 0) + (cuenta.vencida || 0);
    const puntos = de(estados).filter((e) => e.estado !== 'caducada').reduce((s, e) => s + e.puntos, 0);
    return {
      posicion: q.posicion,
      categoria: CATEGORIAS[q.categoria] ?? q.categoria,
      enunciado: q.enunciado,
      origen: q.origen,
      jugadas,
      acertadas: cuenta.acertada || 0,
      pasadas: cuenta.pasada || 0,
      vencidas: cuenta.vencida || 0,
      enCurso: cuenta.activa || 0,
      promedioMetros: jugadas ? (puntos / jugadas) * METROS_POR_PUNTO : null,
      rarezas: Object.fromEntries(de(rarezas).map((r) => [r.rareza, r.n])),
      topAceptadas: de(aceptadas).slice(0, 5).map(({ texto, veces }) => ({ texto, veces })),
      topFallidas: de(fallidas).slice(0, 6).map(({ texto, veces }) => ({ texto, veces })),
    };
  });

  return {
    fecha,
    numero: desafio.numero,
    origen: desafio.origen,
    jugadores: partidas.length,
    terminadas: metros.length,
    enCurso: partidas.length - metros.length,
    maximoMetros: PREGUNTAS_POR_DESAFIO * 100 * METROS_POR_PUNTO,
    metros,
    resumen: resumir(metros),
    preguntas,
  };
}

export async function estadisticasAdmin(db, { zona, desde, hasta, fecha }) {
  const [t, serie, dia] = await Promise.all([totales(db), serieDiaria(db, { desde, hasta, zona }), detalleDelDia(db, fecha)]);
  return { desde, hasta, fecha, totales: t, serie, dia };
}
