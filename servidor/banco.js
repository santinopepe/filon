// Acceso al banco de desafíos publicado (preguntas, respuestas y variantes congeladas).
import { transaccion } from './db.js';
import { compactar, crearIndice, buscarEnIndice, buscarParecidoEnIndice, normalizar, sinArticulo } from './normalizar.js';
import { diasEntre, limitesDeVentana } from './tiempo.js';
import { MODO_POR_DEFECTO, RAREZAS, ORDEN_RAREZAS, LIMITES } from './dominio.js';
import { prepararRevelado, conteosVacios } from './revelado.js';

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

export async function desafioPorFecha(db, fecha, modo = MODO_POR_DEFECTO) {
  return recordar(cacheDe(db, 'desafioFecha'), `${modo}:${fecha}`, () => db.get('SELECT * FROM desafios WHERE fecha = ? AND modo = ?', fecha, modo));
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

/** Total y cantidad por rareza de una pregunta, precalculados al publicar (los prepara si faltan). */
export async function conteosDePregunta(db, pregunta) {
  if (!pregunta.conteos) {
    // Publicada por una instancia anterior a la migración 9 durante un despliegue: se prepara una vez.
    const resumen = await transaccion(db, (tx) => prepararRevelado(tx, pregunta.id));
    pregunta.conteos = JSON.stringify(resumen); // la fila cacheada queda completa
  }
  return (pregunta.conteosLeidos ??= JSON.parse(pregunta.conteos));
}

/** Cantidad de respuestas válidas por pregunta de un desafío (sin consultar la base si ya está cacheado). */
export async function conteoRespuestasDeDesafio(db, desafioId) {
  const conteo = new Map();
  for (const p of await preguntasDeDesafio(db, desafioId)) conteo.set(p.id, (await conteosDePregunta(db, p)).total);
  return conteo;
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

// ───── Revelado de respuestas ─────
// Una pregunta de hasta CATALOGO_EN_MEMORIA respuestas se guarda entera en memoria (ya ordenada por la
// base) y se filtra ahí. Las más grandes se paginan en la base sobre el índice (pregunta_id, orden): ni se
// cargan enteras ni se ordenan al servir. Las cachés tienen tope (filas y entradas), se descartan con la
// versión del banco y son solo una ayuda: con la caché vacía (instancia nueva) el resultado es el mismo.
export const CATALOGO_EN_MEMORIA = 1000;
const FILAS_EN_MEMORIA = 50_000; // tope de filas de catálogos por proceso (≈ unos pocos MB)
const PAGINAS_EN_MEMORIA = 200;
const PRIMERA_PAGINA = LIMITES.paginaRevelado;

/** LRU con peso: al pasar el tope descarta lo menos usado. */
function lruDe(db, nombre, maxPeso) {
  const c = cacheDe(db, nombre);
  c.peso ??= 0;
  return {
    obtener(clave) {
      const e = c.get(clave);
      if (!e) return undefined;
      c.delete(clave);
      c.set(clave, e);
      return e.valor;
    },
    guardar(clave, valor, peso = 1) {
      if (peso > maxPeso) return valor;
      if (c.has(clave)) c.peso -= c.get(clave).peso;
      c.set(clave, { valor, peso });
      c.peso += peso;
      for (const [k, e] of c) {
        if (c.peso <= maxPeso) break;
        c.delete(k);
        c.peso -= e.peso;
      }
      return valor;
    },
  };
}

const conRareza = (f) => ({ canonica: f.canonica, rareza: f.rareza, puntos: f.puntos, nombreRareza: RAREZAS[f.rareza].nombre });
const escaparLike = (t) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

async function catalogoEnMemoria(db, pregunta, total) {
  const cache = lruDe(db, 'catalogo', FILAS_EN_MEMORIA);
  const guardado = cache.obtener(pregunta.id);
  if (guardado) return guardado;
  const filas = await db.all('SELECT canonica, rareza, puntos, normalizada FROM respuestas WHERE pregunta_id = ? ORDER BY orden', pregunta.id);
  return cache.guardar(pregunta.id, filas, total);
}

/**
 * Una página de respuestas válidas de una pregunta, en el orden del revelado.
 * `buscar` (texto libre) y `rareza` filtran sobre el conjunto completo; `conteos` son las cantidades por
 * rareza de lo que coincide con la búsqueda (sin filtrar por rareza), para los filtros de la interfaz.
 */
export async function paginaDeRespuestas(db, pregunta, { desde = 0, limite = 100, buscar = '', rareza = null } = {}) {
  const resumen = await conteosDePregunta(db, pregunta);
  const filtro = normalizar(buscar);
  if (resumen.total <= CATALOGO_EN_MEMORIA) {
    const todas = await catalogoEnMemoria(db, pregunta, resumen.total);
    const buscadas = filtro ? todas.filter((r) => r.normalizada.includes(filtro)) : todas;
    const conteos = filtro ? conteosVacios() : Object.fromEntries(ORDEN_RAREZAS.map((r) => [r, resumen[r]]));
    if (filtro) for (const r of buscadas) conteos[r.rareza]++;
    const coinciden = rareza ? buscadas.filter((r) => r.rareza === rareza) : buscadas;
    return { respuestas: coinciden.slice(desde, desde + limite).map(conRareza), total: resumen.total, coincidencias: coinciden.length, conteos };
  }

  const paginas = lruDe(db, 'paginas', PAGINAS_EN_MEMORIA);
  const clave = `${pregunta.id}|${filtro}|${rareza ?? ''}|${desde}|${limite}`;
  const guardada = paginas.obtener(clave);
  if (guardada) return guardada;
  let respuestas;
  let coincidencias;
  let conteos = Object.fromEntries(ORDEN_RAREZAS.map((r) => [r, resumen[r]]));
  if (!filtro && !rareza) {
    // Sin filtros, `orden` va de 0 a total-1: la página es un rango del índice, sin OFFSET. La primera
    // página es la misma que manda el final de la partida: comparten caché.
    const primeras = desde === 0 && limite === PRIMERA_PAGINA ? lruDe(db, 'primeras', PAGINAS_EN_MEMORIA) : null;
    respuestas = primeras?.obtener(pregunta.id) ??
      (await db.all('SELECT canonica, rareza, puntos FROM respuestas WHERE pregunta_id = ? AND orden >= ? AND orden < ? ORDER BY orden', pregunta.id, desde, desde + limite));
    primeras?.guardar(pregunta.id, respuestas, 1);
    coincidencias = resumen.total;
  } else {
    const condiciones = ['pregunta_id = ?'];
    const valores = [pregunta.id];
    if (filtro) {
      condiciones.push("normalizada LIKE ? ESCAPE '\\'");
      valores.push(`%${escaparLike(filtro)}%`);
    }
    if (!filtro) {
      // Solo rareza: los conteos ya se conocen; la página sale del índice (pregunta_id, rareza, orden).
      coincidencias = conteos[rareza];
      respuestas = coincidencias > desde
        ? await db.all('SELECT canonica, rareza, puntos FROM respuestas WHERE pregunta_id = ? AND rareza = ? ORDER BY orden LIMIT ? OFFSET ?', pregunta.id, rareza, limite, desde)
        : [];
    } else {
      // Con búsqueda: página y conteos por rareza de lo que coincide, en una sola consulta. Las funciones de
      // ventana se calculan sobre todo lo buscado (subconsulta) y recién afuera se filtra la rareza y se
      // pagina: solo viajan las filas de la página.
      const sumas = ORDEN_RAREZAS.map((r) => `SUM(rareza = '${r}') OVER () AS c_${r}`).join(', ');
      const consulta = (lim, off, conRareza) =>
        db.all(
          `SELECT canonica, rareza, puntos, ${ORDEN_RAREZAS.map((r) => `c_${r}`).join(', ')} FROM (
             SELECT canonica, rareza, puntos, orden, ${sumas} FROM respuestas WHERE ${condiciones.join(' AND ')}
           ) WHERE ? IS NULL OR rareza = ? ORDER BY orden LIMIT ? OFFSET ?`,
          ...valores, conRareza, conRareza, lim, off,
        );
      const filas = await consulta(limite, desde, rareza);
      // Página vacía (fuera de rango o rareza sin coincidencias): los conteos salen de la primera coincidencia.
      const conConteos = filas[0] ?? (await consulta(1, 0, null))[0];
      conteos = conteosVacios();
      if (conConteos) for (const r of ORDEN_RAREZAS) conteos[r] = conConteos[`c_${r}`];
      coincidencias = rareza ? conteos[rareza] : ORDEN_RAREZAS.reduce((suma, r) => suma + conteos[r], 0);
      respuestas = filas;
    }
  }
  return paginas.guardar(clave, { respuestas: respuestas.map(conRareza), total: resumen.total, coincidencias, conteos });
}

/**
 * Las primeras `limite` respuestas de varias preguntas (para el final de la partida). Las chicas salen del
 * catálogo en memoria; las demás, de una sola consulta para todas.
 */
export async function primerasRespuestas(db, preguntas, limite = PRIMERA_PAGINA) {
  const resultado = new Map();
  // La caché guarda primeras páginas de tamaño estándar; otro tamaño se pide sin guardar.
  const cache = limite === PRIMERA_PAGINA ? lruDe(db, 'primeras', PAGINAS_EN_MEMORIA) : { obtener() {}, guardar: (_, v) => v };
  const faltan = [];
  for (const p of preguntas) {
    const resumen = await conteosDePregunta(db, p);
    const guardada = cache.obtener(p.id) ?? lruDe(db, 'catalogo', FILAS_EN_MEMORIA).obtener(p.id)?.slice(0, limite);
    if (guardada) resultado.set(p.id, { resumen, filas: guardada });
    else faltan.push([p, resumen]);
  }
  if (faltan.length) {
    const filas = await db.all(
      `SELECT pregunta_id, canonica, rareza, puntos FROM respuestas
       WHERE pregunta_id IN (${faltan.map(() => '?').join(',')}) AND orden < ? ORDER BY pregunta_id, orden`,
      ...faltan.map(([p]) => p.id),
      limite,
    );
    for (const [p, resumen] of faltan) {
      const deEsta = filas.filter((f) => f.pregunta_id === p.id);
      resultado.set(p.id, { resumen, filas: cache.guardar(p.id, deEsta, 1) });
    }
  }
  return resultado;
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

/** Desafíos publicados de un modo con la cantidad de partidas de cada uno (para administración). */
export function listarDesafios(db, { modo = MODO_POR_DEFECTO, limite = 120 } = {}) {
  return db.all(
    `SELECT d.id, d.fecha, d.modo, d.numero, d.origen, d.modelo, d.corrida_id, d.publicado_en,
            (SELECT COUNT(*) FROM partidas p WHERE p.desafio_id = d.id) AS partidas,
            (SELECT COUNT(*) FROM partidas p WHERE p.desafio_id = d.id AND p.terminada_en IS NOT NULL) AS terminadas
     FROM desafios d WHERE d.modo = ? ORDER BY d.fecha DESC LIMIT ?`,
    modo,
    limite,
  );
}

/** Id de cada pregunta: el modo Normal conserva el formato histórico («2026-10-05-p1»). */
export const idDePregunta = (fecha, modo, posicion) => (modo === MODO_POR_DEFECTO ? `${fecha}-p${posicion}` : `${fecha}-${modo}-p${posicion}`);

/**
 * Publica un desafío completo de un modo en una sola transacción.
 * Si ya existe uno para esa fecha y modo no lo reemplaza (devuelve { publicado: false }), salvo con
 * reemplazar: true, que borra el anterior —con sus partidas— en la misma transacción.
 * El número de desafío se cuenta por modo, desde el primero publicado de ese modo.
 */
export function publicarDesafio(db, { fecha, modo = MODO_POR_DEFECTO, preguntas, origen, modelo = null, corridaId = null, ahora = Date.now(), reemplazar = false }) {
  return transaccion(db, async (tx) => {
    const existente = await tx.get('SELECT id FROM desafios WHERE fecha = ? AND modo = ?', fecha, modo);
    if (existente && !reemplazar) return { publicado: false, motivo: 'ya_existia', desafioId: existente.id };
    if (existente) await borrarDesafio(tx, existente.id);

    const primera = (await tx.get('SELECT MIN(fecha) AS f FROM desafios WHERE modo = ?', modo))?.f;
    const numero = primera && primera < fecha ? diasEntre(primera, fecha) + 1 : 1;
    if (primera && fecha < primera) {
      // Carga hacia atrás: el nuevo día pasa a ser el #1 y el resto se corre.
      await tx.run(
        "UPDATE desafios SET numero = CAST(julianday(fecha) - julianday(?) AS INTEGER) + 1 WHERE modo = ?",
        fecha,
        modo,
      );
      await tx.run(
        `INSERT INTO meta (clave, valor) VALUES ('version_banco', '1')
         ON CONFLICT(clave) DO UPDATE SET valor = CAST(CAST(valor AS INTEGER) + 1 AS TEXT)`,
      );
    }

    const { lastInsertRowid: desafioId } = await tx.run(
      'INSERT INTO desafios (fecha, modo, numero, origen, modelo, corrida_id, publicado_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
      fecha, modo, numero, origen, modelo, corridaId, ahora,
    );

    // Respuestas y variantes en tandas con ids explícitos (la transacción tiene el bloqueo de escritura):
    // una pregunta de miles de respuestas son decenas de sentencias, no miles de viajes a la base.
    let siguienteId = (await tx.get('SELECT COALESCE(MAX(id), 0) AS m FROM respuestas')).m + 1;
    const enTandas = async (filas, columnas, tabla, tamanio) => {
      for (let i = 0; i < filas.length; i += tamanio) {
        const tanda = filas.slice(i, i + tamanio);
        await tx.run(
          `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ${tanda.map(() => `(${columnas.map(() => '?').join(', ')})`).join(', ')}`,
          ...tanda.flat(),
        );
      }
    };

    for (const [i, p] of preguntas.entries()) {
      const posicion = i + 1;
      const preguntaId = idDePregunta(fecha, modo, posicion);
      await tx.run(
        `INSERT INTO preguntas (id, desafio_id, posicion, categoria, enunciado, alcance, huella, origen, reserva_id, fuentes, rechazos, firma, conjunto, generacion, coincidencia)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        preguntaId,
        desafioId,
        posicion,
        p.categoria,
        p.enunciado,
        p.alcance,
        p.huella,
        p.origen,
        p.origen === 'catalogo' ? null : (p.id ?? null), // id en la reserva
        JSON.stringify(p.fuentes),
        JSON.stringify(p.rechazos.map((r) => ({ formas: r.formas, motivo: r.motivo, ejemplo: r.textos[0] }))),
        p.firma ?? null,
        p.conjunto ?? null,
        p.generacion ? JSON.stringify(p.generacion) : null,
        p.coincidencia ?? 'flexible',
      );
      const respuestas = [];
      const variantes = [];
      for (const r of p.respuestas) {
        const respuestaId = siguienteId++;
        respuestas.push([respuestaId, preguntaId, r.canonica, r.rareza, r.puntos, r.explicacion, r.fuente?.url ?? p.fuentes[0].url, r.fuente?.titulo ?? p.fuentes[0].titulo, JSON.stringify(r.variantes)]);
        for (const forma of r.formas) variantes.push([preguntaId, forma, respuestaId]);
      }
      await enTandas(respuestas, ['id', 'pregunta_id', 'canonica', 'rareza', 'puntos', 'explicacion', 'fuente_url', 'fuente_titulo', 'variantes'], 'respuestas', 100);
      await enTandas(variantes, ['pregunta_id', 'normalizada', 'respuesta_id'], 'variantes', 300);
      await prepararRevelado(tx, preguntaId);
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
  const pregunta = await db.get('SELECT rechazos, coincidencia FROM preguntas WHERE id = ?', preguntaId);
  const rechazos = new Map();
  for (const r of JSON.parse(pregunta?.rechazos || '[]')) for (const f of r.formas) rechazos.set(f, r.motivo);
  entrada = { db, indice: crearIndice(filas), rechazos, exacta: pregunta?.coincidencia === 'exacta' };
  cacheIndices.set(clave, entrada);
  if (cacheIndices.size > 500) cacheIndices.delete(cacheIndices.keys().next().value);
  return entrada;
}

/** Valida un texto contra el banco almacenado (sin IA). */
export async function evaluarTexto(db, preguntaId, texto) {
  const { indice, rechazos, exacta } = await indiceDePregunta(db, preguntaId);
  const respuestaPorId = async (id) => (await respuestasPorIds(db, [id])).get(id);
  if (exacta) {
    // Preguntas sobre palabras: vale solo la palabra escrita (sin tildes ni mayúsculas). Completar un
    // fragmento o sugerir una parecida regalaría respuestas («cas» → «casa»).
    const n = normalizar(texto);
    const id = indice.exacto.get(n);
    if (id != null) return { aceptada: true, respuesta: await respuestaPorId(id) };
    return { aceptada: false, motivo: rechazos.get(n) ?? null };
  }
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

/**
 * Preguntas publicadas de un modo a menos de `dias` días calendario de la fecha (hacia atrás y hacia los
 * días ya programados), para evitar repeticiones. Lo que salió hace `dias` días o más no cuenta.
 */
export async function preguntasRecientes(db, fecha, dias, modo = MODO_POR_DEFECTO) {
  const [desde, hasta] = limitesDeVentana(fecha, dias);
  const filas = await db.all(
    `SELECT p.id, p.categoria, p.enunciado, p.huella, p.reserva_id AS reservaId, p.firma, d.fecha
     FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE d.modo = ? AND d.fecha BETWEEN ? AND ? AND d.fecha <> ?`,
    modo, desde, hasta, fecha,
  );
  const canonicas = await db.all(
    `SELECT r.pregunta_id, r.canonica FROM respuestas r
     JOIN preguntas p ON p.id = r.pregunta_id JOIN desafios d ON d.id = p.desafio_id
     WHERE d.modo = ? AND d.fecha BETWEEN ? AND ? AND d.fecha <> ?
       AND (p.firma IS NULL OR r.orden < 500) ORDER BY r.id`,
    modo, desde, hasta, fecha,
  );
  const claves = new Map(filas.map((f) => [f.id, []]));
  for (const r of canonicas) claves.get(r.pregunta_id)?.push(normalizar(r.canonica));
  return filas.map((f) => ({ ...f, claves: claves.get(f.id) }));
}

/** Última fecha en que se usó cada pregunta de la reserva de un modo. */
export async function usosDeReserva(db, modo = MODO_POR_DEFECTO) {
  const filas = await db.all(
    `SELECT p.reserva_id AS id, MAX(d.fecha) AS ultima, COUNT(*) AS veces
     FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE p.reserva_id IS NOT NULL AND d.modo = ? GROUP BY p.reserva_id`,
    modo,
  );
  return new Map(filas.map((f) => [f.id, { ultima: f.ultima, veces: f.veces }]));
}

/** Una pregunta publicada en el formato de los bancos de reserva (con todas sus respuestas). */
export async function preguntaParaEditar(db, preguntaId) {
  const p = await db.get('SELECT * FROM preguntas WHERE id = ?', preguntaId);
  if (!p) return null;
  const respuestas = await db.all('SELECT * FROM respuestas WHERE pregunta_id = ? ORDER BY puntos, id', preguntaId);
  const fuentes = JSON.parse(p.fuentes);
  const general = fuentes[0]?.url;
  return {
    id: p.reserva_id || p.id,
    categoria: p.categoria,
    enunciado: p.enunciado,
    alcance: p.alcance,
    fuentes,
    respuestas: respuestas.map((r) => ({
      canonica: r.canonica,
      variantes: JSON.parse(r.variantes),
      rareza: r.rareza,
      explicacion: r.explicacion,
      ...(r.fuente_url && r.fuente_url !== general ? { fuente: { url: r.fuente_url, titulo: r.fuente_titulo } } : {}),
    })),
    // Se guarda solo un ejemplo de cada rechazo (más sus formas normalizadas).
    rechazos: JSON.parse(p.rechazos).map((r) => ({ textos: [r.ejemplo ?? r.formas?.[0]].filter(Boolean), motivo: r.motivo })),
  };
}

/**
 * Reemplaza el contenido de una pregunta publicada por una versión validada (forma interna).
 * Las respuestas se emparejan por su nombre normalizado: las que siguen conservan su id (las rondas
 * ya jugadas las referencian y sus puntos no cambian); no se puede quitar una respuesta que algún
 * jugador ya dio. Devuelve { editada: true } o { editada: false, enUso: [canónicas] }.
 */
export function editarPregunta(db, preguntaId, nueva) {
  return transaccion(db, async (tx) => {
    const actuales = await tx.all('SELECT id, canonica FROM respuestas WHERE pregunta_id = ?', preguntaId);
    const porClave = new Map(actuales.map((r) => [normalizar(r.canonica), r]));
    const nuevasClaves = new Set(nueva.respuestas.map((r) => normalizar(r.canonica)));
    const quitadas = actuales.filter((r) => !nuevasClaves.has(normalizar(r.canonica)));
    if (quitadas.length) {
      const enUso = await tx.all(
        `SELECT DISTINCT x.canonica FROM rondas r JOIN respuestas x ON x.id = r.respuesta_id
         WHERE r.respuesta_id IN (${quitadas.map(() => '?').join(',')})`,
        ...quitadas.map((r) => r.id),
      );
      if (enUso.length) return { editada: false, enUso: enUso.map((r) => r.canonica) };
    }
    await tx.run('DELETE FROM variantes WHERE pregunta_id = ?', preguntaId);
    for (const r of quitadas) await tx.run('DELETE FROM respuestas WHERE id = ?', r.id);
    await tx.run(
      'UPDATE preguntas SET enunciado = ?, alcance = ?, huella = ?, fuentes = ?, rechazos = ?, reserva_id = COALESCE(reserva_id, ?) WHERE id = ?',
      nueva.enunciado,
      nueva.alcance,
      nueva.huella,
      JSON.stringify(nueva.fuentes),
      JSON.stringify(nueva.rechazos.map((r) => ({ formas: r.formas, motivo: r.motivo, ejemplo: r.textos[0] }))),
      nueva.id,
      preguntaId,
    );
    for (const r of nueva.respuestas) {
      const fuente = r.fuente ?? nueva.fuentes[0];
      const existente = porClave.get(normalizar(r.canonica));
      let respuestaId = existente?.id;
      if (existente) {
        await tx.run(
          'UPDATE respuestas SET canonica = ?, rareza = ?, puntos = ?, explicacion = ?, fuente_url = ?, fuente_titulo = ?, variantes = ? WHERE id = ?',
          r.canonica, r.rareza, r.puntos, r.explicacion, fuente.url, fuente.titulo, JSON.stringify(r.variantes), existente.id,
        );
      } else {
        respuestaId = (
          await tx.run(
            'INSERT INTO respuestas (pregunta_id, canonica, rareza, puntos, explicacion, fuente_url, fuente_titulo, variantes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            preguntaId, r.canonica, r.rareza, r.puntos, r.explicacion, fuente.url, fuente.titulo, JSON.stringify(r.variantes),
          )
        ).lastInsertRowid;
      }
      for (const forma of r.formas) await tx.run('INSERT OR IGNORE INTO variantes (pregunta_id, normalizada, respuesta_id) VALUES (?, ?, ?)', preguntaId, forma, respuestaId);
    }
    await prepararRevelado(tx, preguntaId);
    // Todas las instancias descartan su caché del banco.
    await tx.run(
      `INSERT INTO meta (clave, valor) VALUES ('version_banco', '1')
       ON CONFLICT(clave) DO UPDATE SET valor = CAST(CAST(valor AS INTEGER) + 1 AS TEXT)`,
    );
    return { editada: true };
  });
}
