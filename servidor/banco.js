// Acceso al banco de desafíos publicado (preguntas, respuestas y variantes congeladas).
import { transaccion } from './db.js';
import { compactar, crearIndice, buscarEnIndice, buscarParecidoEnIndice, normalizar, sinArticulo } from './normalizar.js';
import { diasEntre, sumarDias } from './tiempo.js';

// Lo publicado solo cambia si un administrador regenera un día: desafíos, preguntas y respuestas se
// cachean en memoria por base, y cada reemplazo sube `version_banco` para que todas las instancias
// (en Vercel hay varias) descarten su caché en la siguiente solicitud.
const caches = new WeakMap();
const versiones = new WeakMap();

/** Descarta las cachés si otro proceso reemplazó algún desafío. Una consulta por llamada. */
export async function sincronizarCaches(db) {
  const version = (await db.get("SELECT valor FROM meta WHERE clave = 'version_banco'"))?.valor ?? '0';
  if (versiones.has(db) && versiones.get(db) !== version) {
    caches.delete(db);
    for (const [clave, entrada] of cacheIndices) if (entrada.db === db) cacheIndices.delete(clave);
  }
  versiones.set(db, version);
}

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

/** Cantidad de respuestas válidas por pregunta de un desafío (sin traer las respuestas). */
export async function conteoRespuestasDeDesafio(db, desafioId) {
  return recordar(cacheDe(db, 'conteoRespuestas'), desafioId, async () => {
    const filas = await db.all(
      'SELECT r.pregunta_id, COUNT(*) AS n FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id WHERE p.desafio_id = ? GROUP BY r.pregunta_id',
      desafioId,
    );
    return filas.length ? new Map(filas.map((f) => [f.pregunta_id, f.n])) : null;
  }) ?? new Map();
}

/** Respuestas puntuales por id (las aceptadas de una partida), con caché. */
export async function respuestasPorIds(db, ids) {
  const cache = cacheDe(db, 'respuestaId');
  const faltan = [...new Set(ids.filter((id) => id != null && !cache.has(id)))];
  if (faltan.length) {
    const filas = await db.all(`SELECT * FROM respuestas WHERE id IN (${faltan.map(() => '?').join(',')})`, ...faltan);
    for (const f of filas) cache.set(f.id, f);
    while (cache.size > 2000) cache.delete(cache.keys().next().value);
  }
  return new Map(ids.filter((id) => cache.has(id)).map((id) => [id, cache.get(id)]));
}

/** Rehace el histograma de puntajes de un desafío a partir de las partidas terminadas. */
export function conciliarPuntajes(db, desafioId) {
  return transaccion(db, async (tx) => {
    await tx.run('DELETE FROM puntajes_desafio WHERE desafio_id = ?', desafioId);
    await tx.run(
      `INSERT INTO puntajes_desafio (desafio_id, puntos, cantidad)
       SELECT desafio_id, puntos, COUNT(*) FROM partidas WHERE desafio_id = ? AND terminada_en IS NOT NULL GROUP BY puntos`,
      desafioId,
    );
  });
}

export async function respuestasDePregunta(db, preguntaId) {
  return recordar(cacheDe(db, 'respuestas'), preguntaId, async () => {
    const filas = await db.all('SELECT * FROM respuestas WHERE pregunta_id = ? ORDER BY puntos, id', preguntaId);
    return filas.length ? filas : null;
  }) ?? [];
}

/** Borra un desafío con todo lo que depende de él (partidas, rondas, intentos y reportes incluidos). */
async function borrarDesafio(tx, desafioId) {
  const partidas = 'SELECT id FROM partidas WHERE desafio_id = ?';
  const preguntas = 'SELECT id FROM preguntas WHERE desafio_id = ?';
  await tx.run(`DELETE FROM intentos WHERE partida_id IN (${partidas})`, desafioId);
  await tx.run(`DELETE FROM rondas WHERE partida_id IN (${partidas})`, desafioId);
  await tx.run('DELETE FROM partidas WHERE desafio_id = ?', desafioId);
  await tx.run(`DELETE FROM reportes WHERE pregunta_id IN (${preguntas})`, desafioId);
  await tx.run(`DELETE FROM variantes WHERE pregunta_id IN (${preguntas})`, desafioId);
  await tx.run(`DELETE FROM respuestas WHERE pregunta_id IN (${preguntas})`, desafioId);
  await tx.run('DELETE FROM preguntas WHERE desafio_id = ?', desafioId);
  await tx.run('DELETE FROM desafios WHERE id = ?', desafioId);
  await tx.run(
    `INSERT INTO meta (clave, valor) VALUES ('version_banco', '1')
     ON CONFLICT(clave) DO UPDATE SET valor = CAST(CAST(valor AS INTEGER) + 1 AS TEXT)`,
  );
}

/** Desafíos publicados con la cantidad de partidas de cada uno (para administración). */
export function listarDesafios(db, limite = 120) {
  return db.all(
    `SELECT d.id, d.fecha, d.numero, d.origen, d.modelo, d.corrida_id, d.publicado_en,
            (SELECT COUNT(*) FROM partidas p WHERE p.desafio_id = d.id) AS partidas,
            (SELECT COUNT(*) FROM partidas p WHERE p.desafio_id = d.id AND p.terminada_en IS NOT NULL) AS terminadas
     FROM desafios d ORDER BY d.fecha DESC LIMIT ?`,
    limite,
  );
}

/**
 * Publica un desafío completo en una sola transacción.
 * Si ya existe uno para esa fecha no lo reemplaza (devuelve { publicado: false }), salvo con
 * reemplazar: true, que borra el anterior —con sus partidas— en la misma transacción.
 */
export function publicarDesafio(db, { fecha, preguntas, origen, modelo = null, corridaId = null, ahora = Date.now(), reemplazar = false }) {
  return transaccion(db, async (tx) => {
    const existente = await tx.get('SELECT id FROM desafios WHERE fecha = ?', fecha);
    if (existente && !reemplazar) return { publicado: false, motivo: 'ya_existia', desafioId: existente.id };
    if (existente) await borrarDesafio(tx, existente.id);

    const primera = (await tx.get('SELECT MIN(fecha) AS f FROM desafios'))?.f;
    const numero = primera && primera < fecha ? diasEntre(primera, fecha) + 1 : 1;
    if (primera && fecha < primera) {
      // Carga hacia atrás: el nuevo día pasa a ser el #1 y el resto se corre.
      await tx.run(
        "UPDATE desafios SET numero = CAST(julianday(fecha) - julianday(?) AS INTEGER) + 1",
        fecha,
      );
      await tx.run(
        `INSERT INTO meta (clave, valor) VALUES ('version_banco', '1')
         ON CONFLICT(clave) DO UPDATE SET valor = CAST(CAST(valor AS INTEGER) + 1 AS TEXT)`,
      );
    }

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
  const respuestaPorId = async (id) => (await respuestasPorIds(db, [id])).get(id);
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
