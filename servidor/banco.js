// Acceso al banco de desafíos publicado (preguntas, respuestas y variantes congeladas).
import { transaccion } from './db.js';
import { compactar, crearIndice, buscarEnIndice, buscarParecidoEnIndice, normalizar, sinArticulo } from './normalizar.js';
import { diasEntre, sumarDias } from './tiempo.js';

// Lo publicado no cambia: desafíos, preguntas y respuestas se cachean en memoria por base.
const caches = new WeakMap();
function cacheDe(db, nombre) {
  let c = caches.get(db);
  if (!c) caches.set(db, (c = {}));
  return (c[nombre] ??= new Map());
}
async function recordar(mapa, clave, cargar) {
  if (mapa.has(clave)) return mapa.get(clave);
  const valor = await cargar();
  if (valor != null) {
    mapa.set(clave, valor);
    if (mapa.size > 500) mapa.delete(mapa.keys().next().value);
  }
  return valor;
}

export async function desafioPorFecha(db, fecha) {
  return recordar(cacheDe(db, 'desafioFecha'), fecha, () => db.get('SELECT * FROM desafios WHERE fecha = ?', fecha));
}

export async function desafioPorId(db, id) {
  return recordar(cacheDe(db, 'desafioId'), id, () => db.get('SELECT * FROM desafios WHERE id = ?', id));
}

export async function preguntasDeDesafio(db, desafioId) {
  return recordar(cacheDe(db, 'preguntas'), desafioId, async () => {
    const filas = await db.all('SELECT * FROM preguntas WHERE desafio_id = ? ORDER BY posicion', desafioId);
    return filas.length ? filas : null;
  }) ?? [];
}

export async function preguntaPorPosicion(db, desafioId, posicion) {
  return (await preguntasDeDesafio(db, desafioId)).find((p) => p.posicion === posicion) ?? null;
}

/** Respuestas de todas las preguntas de un desafío, agrupadas por pregunta (una sola consulta). */
export async function respuestasDeDesafio(db, desafioId) {
  return recordar(cacheDe(db, 'respuestasDesafio'), desafioId, async () => {
    const filas = await db.all(
      'SELECT r.* FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id WHERE p.desafio_id = ? ORDER BY r.puntos, r.id',
      desafioId,
    );
    if (!filas.length) return null;
    const porPregunta = new Map();
    for (const r of filas) {
      if (!porPregunta.has(r.pregunta_id)) porPregunta.set(r.pregunta_id, []);
      porPregunta.get(r.pregunta_id).push(r);
    }
    return porPregunta;
  }) ?? new Map();
}

export async function respuestasDePregunta(db, preguntaId) {
  return recordar(cacheDe(db, 'respuestas'), preguntaId, async () => {
    const filas = await db.all('SELECT * FROM respuestas WHERE pregunta_id = ? ORDER BY puntos, id', preguntaId);
    return filas.length ? filas : null;
  }) ?? [];
}

/**
 * Publica un desafío completo en una sola transacción.
 * Si ya existe uno para esa fecha no lo reemplaza: devuelve { publicado: false }.
 */
export function publicarDesafio(db, { fecha, preguntas, origen, modelo = null, corridaId = null, ahora = Date.now() }) {
  return transaccion(db, async (tx) => {
    const existente = await tx.get('SELECT id FROM desafios WHERE fecha = ?', fecha);
    if (existente) return { publicado: false, motivo: 'ya_existia', desafioId: existente.id };

    const primera = (await tx.get('SELECT MIN(fecha) AS f FROM desafios'))?.f;
    const numero = primera && primera < fecha ? diasEntre(primera, fecha) + 1 : 1;

    const { lastInsertRowid: desafioId } = await tx.run(
      'INSERT INTO desafios (fecha, numero, origen, modelo, corrida_id, publicado_en) VALUES (?, ?, ?, ?, ?, ?)',
      fecha, numero, origen, modelo, corridaId, ahora,
    );

    const insPregunta = `INSERT INTO preguntas (id, desafio_id, posicion, categoria, enunciado, alcance, huella, origen, reserva_id, fuentes, rechazos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const insRespuesta = `INSERT INTO respuestas (pregunta_id, canonica, rareza, puntos, explicacion, fuente_url, fuente_titulo, variantes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const insVariante = 'INSERT INTO variantes (pregunta_id, normalizada, respuesta_id) VALUES (?, ?, ?)';

    for (const [i, p] of preguntas.entries()) {
      const posicion = i + 1;
      const preguntaId = `${fecha}-p${posicion}`;
      await tx.run(
        insPregunta,
        preguntaId,
        desafioId,
        posicion,
        p.categoria,
        p.enunciado,
        p.alcance,
        p.huella,
        p.origen,
        p.origen === 'reserva' ? p.id : null,
        JSON.stringify(p.fuentes),
        JSON.stringify(p.rechazos.map((r) => ({ formas: r.formas, motivo: r.motivo, ejemplo: r.textos[0] }))),
      );
      for (const r of p.respuestas) {
        const { lastInsertRowid: respuestaId } = await tx.run(
          insRespuesta,
          preguntaId,
          r.canonica,
          r.rareza,
          r.puntos,
          r.explicacion,
          r.fuente?.url ?? p.fuentes[0].url,
          r.fuente?.titulo ?? p.fuentes[0].titulo,
          JSON.stringify(r.variantes),
        );
        for (const forma of r.formas) await tx.run(insVariante, preguntaId, forma, respuestaId);
      }
    }
    return { publicado: true, desafioId: Number(desafioId), numero };
  });
}

// Índices de búsqueda en memoria. Los bancos publicados no cambian, así que se pueden cachear.
const cacheIndices = new Map();

export async function indiceDePregunta(db, preguntaId) {
  const clave = `${preguntaId}`;
  let entrada = cacheIndices.get(clave);
  if (entrada && entrada.db === db) return entrada;
  const filas = await db.all('SELECT normalizada, respuesta_id AS respuestaId FROM variantes WHERE pregunta_id = ?', preguntaId);
  const pregunta = await db.get('SELECT rechazos FROM preguntas WHERE id = ?', preguntaId);
  const rechazos = new Map();
  for (const r of JSON.parse(pregunta?.rechazos || '[]')) for (const f of r.formas) rechazos.set(f, r.motivo);
  entrada = { db, indice: crearIndice(filas), rechazos };
  cacheIndices.set(clave, entrada);
  if (cacheIndices.size > 500) cacheIndices.delete(cacheIndices.keys().next().value);
  return entrada;
}

/** Valida un texto contra el banco almacenado (sin IA). */
export async function evaluarTexto(db, preguntaId, texto) {
  const { indice, rechazos } = await indiceDePregunta(db, preguntaId);
  const respuestaPorId = async (id) => (await respuestasDePregunta(db, preguntaId)).find((r) => r.id === id);
  const respuestaId = buscarEnIndice(indice, texto);
  if (respuestaId != null) {
    const respuesta = await respuestaPorId(respuestaId);
    const entrada = compactar(sinArticulo(normalizar(texto)));
    const canonica = compactar(sinArticulo(normalizar(respuesta.canonica)));
    if (entrada === canonica) return { aceptada: true, respuesta };
    return { aceptada: false, sugerencia: respuesta.canonica };
  }
  const n = normalizar(texto);
  const motivo = rechazos.get(n) ?? rechazos.get(sinArticulo(n)) ?? null;
  if (!motivo) {
    const parecidaId = buscarParecidoEnIndice(indice, texto);
    if (parecidaId != null) {
      const respuesta = await respuestaPorId(parecidaId);
      return { aceptada: false, sugerencia: respuesta.canonica };
    }
  }
  return { aceptada: false, motivo };
}

/** Preguntas publicadas en una ventana de fechas, para evitar repeticiones. */
export async function preguntasRecientes(db, fecha, dias) {
  const desde = sumarDias(fecha, -dias);
  const hasta = sumarDias(fecha, dias);
  const filas = await db.all(
    `SELECT p.id, p.enunciado, p.huella, p.reserva_id AS reservaId, d.fecha
     FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE d.fecha BETWEEN ? AND ? AND d.fecha <> ?`,
    desde, hasta, fecha,
  );
  const canonicas = await db.all(
    `SELECT r.pregunta_id, r.canonica FROM respuestas r
     JOIN preguntas p ON p.id = r.pregunta_id JOIN desafios d ON d.id = p.desafio_id
     WHERE d.fecha BETWEEN ? AND ? AND d.fecha <> ? ORDER BY r.id`,
    desde, hasta, fecha,
  );
  const claves = new Map(filas.map((f) => [f.id, []]));
  for (const r of canonicas) claves.get(r.pregunta_id)?.push(normalizar(r.canonica));
  return filas.map((f) => ({ ...f, claves: claves.get(f.id) }));
}

/** Última fecha en que se usó cada pregunta de reserva. */
export async function usosDeReserva(db) {
  const filas = await db.all(
    `SELECT p.reserva_id AS id, MAX(d.fecha) AS ultima, COUNT(*) AS veces
     FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE p.reserva_id IS NOT NULL GROUP BY p.reserva_id`,
  );
  return new Map(filas.map((f) => [f.id, { ultima: f.ultima, veces: f.veces }]));
}
