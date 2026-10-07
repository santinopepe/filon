// Lógica de partida. Todo (tiempos, respuestas y puntos) se decide en el servidor.
import { randomUUID } from 'node:crypto';
import { transaccion } from './db.js';
import { CATEGORIAS, RAREZAS, METROS_POR_PUNTO, PREGUNTAS_POR_DESAFIO, LIMITES, MODOS, CLAVES_MODOS, MODO_POR_DEFECTO } from './dominio.js';
import { normalizar } from './normalizar.js';
import { fechaLocal, inicioDeFecha, sumarDias, proximaMedianoche } from './tiempo.js';
import { desafioPorFecha, desafioPorId, preguntasDeDesafio, catalogoParaRevelar, conteoRespuestasDeDesafio, respuestasPorIds, evaluarTexto } from './banco.js';

export class ErrorJuego extends Error {
  constructor(estado, codigo, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const MAX_LARGO_RESPUESTA = 120;
const MAX_REPORTES_POR_PARTIDA = 15;

export function crearJuego({ db, config, ahora = () => Date.now() }) {
  const msPorRonda = config.segundosPorPregunta * 1000;
  const gracia = config.graciaRedMs;
  const zona = config.zona;

  const finDelDia = (fecha) => inicioDeFecha(sumarDias(fecha, 1), zona);
  const limiteParaRetomar = (fecha) => finDelDia(fecha) + config.horasParaRetomar * 3_600_000;

  async function asegurarJugador(id, t = ahora()) {
    await db.run('INSERT OR IGNORE INTO jugadores (id, creado_en) VALUES (?, ?)', id, t);
  }

  function desafioDeHoy(t = ahora(), modo = MODO_POR_DEFECTO) {
    return desafioPorFecha(db, fechaLocal(t, zona), modo);
  }

  /** Cómo está cada modo hoy para el selector: sin desafío, disponible, en curso o ya jugado. */
  function resumenModo(clave, desafio, partida) {
    return {
      clave,
      nombre: MODOS[clave].nombre,
      estado: !desafio ? 'preparando' : !partida ? 'disponible' : partida.terminada_en ? 'jugado' : 'en_curso',
      numero: desafio?.numero ?? null,
      profundidad: partida ? partida.puntos * METROS_POR_PUNTO : null,
    };
  }

  async function obtenerPartida(jugadorId, partidaId) {
    const p = await db.get('SELECT * FROM partidas WHERE id = ? AND jugador_id = ?', partidaId, jugadorId);
    if (!p) throw new ErrorJuego(404, 'partida_inexistente', 'No encontramos esa partida.');
    return p;
  }

  const rondasDe = (cx, partidaId) => cx.all('SELECT * FROM rondas WHERE partida_id = ? ORDER BY posicion', partidaId);

  /** Cierra rondas vencidas, caduca partidas abandonadas y marca el fin cuando corresponde. */
  async function mantener(partida, t = ahora()) {
    if (partida.terminada_en) return partida;
    const desafio = await desafioPorId(db, partida.desafio_id);
    const preguntas = await preguntasDeDesafio(db, desafio.id);
    return transaccion(db, async (tx) => {
      await tx.run(
        `UPDATE rondas SET estado = 'vencida', cierre_en = limite_en
         WHERE partida_id = ? AND estado = 'activa' AND limite_en + ? < ?`,
        partida.id, gracia, t,
      );

      const fila = await tx.get('SELECT * FROM partidas WHERE id = ?', partida.id);
      if (fila.terminada_en) return fila;

      if (t > limiteParaRetomar(desafio.fecha)) {
        await tx.run(`UPDATE rondas SET estado = 'vencida', cierre_en = limite_en WHERE partida_id = ? AND estado = 'activa'`, fila.id);
        const existentes = new Set((await rondasDe(tx, fila.id)).map((r) => r.posicion));
        for (const p of preguntas) {
          if (!existentes.has(p.posicion)) {
            await tx.run(
              `INSERT INTO rondas (partida_id, posicion, pregunta_id, estado, inicio_en, limite_en, cierre_en, puntos)
               VALUES (?, ?, ?, 'caducada', ?, ?, ?, 0)`,
              fila.id, p.posicion, p.id, t, t, t,
            );
          }
        }
      }

      const cerradas = await tx.get(`SELECT COUNT(*) AS n, COALESCE(SUM(puntos), 0) AS puntos FROM rondas WHERE partida_id = ? AND estado <> 'activa'`, fila.id);
      if (cerradas.n >= PREGUNTAS_POR_DESAFIO) {
        const fin = await tx.run('UPDATE partidas SET terminada_en = ?, puntos = ? WHERE id = ? AND terminada_en IS NULL', t, cerradas.puntos, fila.id);
        if (fin.changes === 1) {
          await tx.run(
            `INSERT INTO puntajes_desafio (desafio_id, puntos, cantidad) VALUES (?, ?, 1)
             ON CONFLICT(desafio_id, puntos) DO UPDATE SET cantidad = cantidad + 1`,
            fila.desafio_id,
            cerradas.puntos,
          );
        }
        return { ...fila, terminada_en: t, puntos: cerradas.puntos };
      }
      return fila;
    });
  }

  /** Ranking y distribución del día a partir del histograma agregado (≤ 141 filas, no todas las partidas). */
  async function estadisticasDe(partida) {
    const filas = await db.all('SELECT puntos, cantidad FROM puntajes_desafio WHERE desafio_id = ? AND cantidad > 0 ORDER BY puntos DESC', partida.desafio_id);
    const total = filas.reduce((s, f) => s + f.cantidad, 0);
    if (!total) return null;
    let mayores = 0;
    let iguales = 0;
    let suma = 0;
    for (const f of filas) {
      if (f.puntos > partida.puntos) mayores += f.cantidad;
      else if (f.puntos === partida.puntos) iguales += f.cantidad;
      suma += f.puntos * f.cantidad;
    }
    const menores = total - mayores - iguales;
    const promedio = suma / total;
    const varianza = filas.reduce((s, f) => s + f.cantidad * (f.puntos - promedio) ** 2, 0) / total;
    const ancho = 50;
    const distribucion = Array.from({ length: 14 }, (_, indice) => ({
      desde: indice * ancho,
      hasta: indice === 13 ? 700 : (indice + 1) * ancho - 1,
      cantidad: 0,
    }));
    for (const f of filas) distribucion[Math.min(13, Math.max(0, Math.floor(f.puntos / ancho)))].cantidad += f.cantidad;

    return {
      total,
      puesto: mayores + 1,
      empatados: iguales,
      superados: menores,
      percentil: total > 1 ? Math.round(((menores + (iguales - 1) / 2) / (total - 1)) * 100) : null,
      promedio,
      desviacion: Math.sqrt(varianza),
      minimo: filas.at(-1).puntos,
      maximo: filas[0].puntos,
      distribucion,
      suficientesDatos: total >= 5 && varianza > 0,
    };
  }

  async function vista(partida, t = ahora()) {
    const desafio = await desafioPorId(db, partida.desafio_id);
    const [preguntas, conteo, filasRondas, filasIntentos] = await Promise.all([
      preguntasDeDesafio(db, desafio.id),
      conteoRespuestasDeDesafio(db, desafio.id),
      rondasDe(db, partida.id),
      db.all('SELECT posicion, texto, motivo FROM intentos WHERE partida_id = ? AND aceptado = 0 ORDER BY id', partida.id),
    ]);
    const rondas = new Map(filasRondas.map((r) => [r.posicion, r]));
    // Solo las respuestas aceptadas en esta partida (≤ 7), no el banco completo.
    const aceptadas = await respuestasPorIds(db, filasRondas.filter((r) => r.estado === 'acertada').map((r) => r.respuesta_id));
    const intentosDe = (posicion) => filasIntentos.filter((i) => i.posicion === posicion).map((i) => ({ texto: i.texto, motivo: i.motivo }));

    let rondaActiva = null;
    let siguiente = null;
    const lista = preguntas.map((p) => {
      const r = rondas.get(p.posicion);
      const item = { posicion: p.posicion, categoria: CATEGORIAS[p.categoria] ?? p.categoria, estado: r?.estado ?? 'pendiente' };
      if (!r) {
        if (siguiente === null && !partida.terminada_en) siguiente = p.posicion;
        return item;
      }
      item.enunciado = p.enunciado;
      item.alcance = p.alcance;
      item.inicioEn = r.inicio_en;
      item.limiteEn = r.limite_en;
      if (r.estado === 'activa') {
        rondaActiva = p.posicion;
        item.intentos = intentosDe(p.posicion);
        return item;
      }
      item.puntos = r.puntos;
      item.metros = r.puntos * METROS_POR_PUNTO;
      if (r.estado !== 'caducada') {
        item.totalRespuestas = conteo.get(p.id) || 0;
        item.intentos = intentosDe(p.posicion);
      }
      if (r.estado === 'acertada') {
        const resp = aceptadas.get(r.respuesta_id);
        item.textoIngresado = r.texto_aceptado;
        item.respuesta = {
          canonica: resp.canonica,
          rareza: resp.rareza,
          nombreRareza: RAREZAS[resp.rareza].nombre,
          descripcionRareza: RAREZAS[resp.rareza].descripcion,
          puntos: resp.puntos,
          explicacion: resp.explicacion,
          fuente: { url: resp.fuente_url, titulo: resp.fuente_titulo },
        };
      }
      return item;
    });

    const puntos = lista.reduce((s, r) => s + (r.puntos || 0), 0);
    if (rondaActiva) siguiente = null;
    return {
      id: partida.id,
      modo: desafio.modo ?? MODO_POR_DEFECTO,
      fecha: desafio.fecha,
      numero: desafio.numero,
      terminada: Boolean(partida.terminada_en),
      puntos,
      profundidad: puntos * METROS_POR_PUNTO,
      segundosPorPregunta: config.segundosPorPregunta,
      graciaMs: gracia,
      rondaActiva,
      siguiente,
      cierreDesafio: finDelDia(desafio.fecha),
      retomarHasta: limiteParaRetomar(desafio.fecha),
      rondas: lista,
      estadisticas: partida.terminada_en ? await estadisticasDe(partida) : null,
      ahora: t,
    };
  }

  async function partidaPendienteAnterior(jugadorId, fechaHoy, t, modo) {
    const fila = await db.get(
      `SELECT p.* FROM partidas p JOIN desafios d ON d.id = p.desafio_id
       WHERE p.jugador_id = ? AND p.terminada_en IS NULL AND d.fecha < ? AND d.modo = ?
       ORDER BY d.fecha DESC LIMIT 1`,
      jugadorId, fechaHoy, modo,
    );
    if (!fila) return null;
    const actualizada = await mantener(fila, t);
    return actualizada.terminada_en ? null : actualizada;
  }

  return {
    asegurarJugador,

    /**
     * Estado del día para un modo (desafío, partida de hoy y una pendiente de ayer) y, en `modos`,
     * cómo está cada uno de los tres: el límite es una partida por persona, modo y día.
     */
    async estado(jugadorId, modo = MODO_POR_DEFECTO) {
      const t = ahora();
      await asegurarJugador(jugadorId, t);
      const hoy = fechaLocal(t, zona);
      const modos = [];
      let desafio = null;
      let partidaHoy = null;
      for (const clave of CLAVES_MODOS) {
        const delModo = await desafioPorFecha(db, hoy, clave);
        let fila = delModo ? await db.get('SELECT * FROM partidas WHERE jugador_id = ? AND desafio_id = ?', jugadorId, delModo.id) : null;
        if (fila) fila = await mantener(fila, t);
        modos.push(resumenModo(clave, delModo, fila));
        if (clave !== modo) continue;
        desafio = delModo;
        if (fila) partidaHoy = await vista(fila, t);
      }
      const pendiente = await partidaPendienteAnterior(jugadorId, hoy, t, modo);
      return {
        ahora: t,
        zona,
        modo,
        proximoDesafioEn: proximaMedianoche(t, zona),
        desafio: desafio ? { fecha: desafio.fecha, numero: desafio.numero, preguntas: PREGUNTAS_POR_DESAFIO, modo } : null,
        partidaHoy,
        partidaPendiente: pendiente ? await vista(pendiente, t) : null,
        modos,
      };
    },

    async iniciarPartida(jugadorId, modo = MODO_POR_DEFECTO) {
      const t = ahora();
      await asegurarJugador(jugadorId, t);
      const desafio = await desafioDeHoy(t, modo);
      if (!desafio) throw new ErrorJuego(503, 'sin_desafio', 'El desafío de hoy todavía se está preparando. Probá de nuevo en unos minutos.');
      await db.run('INSERT OR IGNORE INTO partidas (id, jugador_id, desafio_id, iniciada_en) VALUES (?, ?, ?, ?)', randomUUID(), jugadorId, desafio.id, t);
      const fila = await db.get('SELECT * FROM partidas WHERE jugador_id = ? AND desafio_id = ?', jugadorId, desafio.id);
      return vista(await mantener(fila, t), t);
    },

    async verPartida(jugadorId, partidaId) {
      const t = ahora();
      return vista(await mantener(await obtenerPartida(jugadorId, partidaId), t), t);
    },

    async respuestasValidas(jugadorId, partidaId, posicion, { desde = 0, limite = LIMITES.paginaRevelado, buscar = '' } = {}) {
      const t = ahora();
      // Al finalizar, la partida y sus rondas ya no cambian: autorización y ronda en
      // un solo viaje a Turso. En curso se mantiene el vencimiento y se relee la ronda.
      const partida = await db.get(
        `SELECT p.*, r.estado AS estadoRonda, r.pregunta_id AS preguntaId
         FROM partidas p LEFT JOIN rondas r ON r.partida_id = p.id AND r.posicion = ?
         WHERE p.id = ? AND p.jugador_id = ?`,
        posicion, partidaId, jugadorId,
      );
      if (!partida) throw new ErrorJuego(404, 'partida_inexistente', 'No encontramos esa partida.');
      let ronda = partida.preguntaId == null ? null : { estado: partida.estadoRonda, preguntaId: partida.preguntaId };
      if (!partida.terminada_en) {
        await mantener(partida, t);
        ronda = await db.get('SELECT r.estado, r.pregunta_id AS preguntaId FROM rondas r WHERE r.partida_id = ? AND r.posicion = ?', partida.id, posicion);
      }
      if (!ronda) throw new ErrorJuego(409, 'ronda_no_iniciada', 'Esa ronda todavía no empezó.');
      if (ronda.estado === 'activa') throw new ErrorJuego(409, 'ronda_activa', 'Las respuestas se revelan cuando termina la ronda.');
      if (ronda.estado === 'caducada') throw new ErrorJuego(410, 'ronda_caducada', 'Esa ronda quedó sin jugar.');
      const { respuestas: todas, normalizadas } = await catalogoParaRevelar(db, ronda.preguntaId);
      const filtro = normalizar(buscar);
      const filtradas = filtro ? todas.filter((_, i) => normalizadas[i].includes(filtro)) : todas;
      const tope = Math.min(Math.max(1, limite), LIMITES.paginaRevelado);
      const pagina = filtradas.slice(desde, desde + tope);
      return {
        respuestas: pagina,
        total: todas.length,
        coincidencias: filtradas.length,
        desde,
        siguiente: desde + pagina.length < filtradas.length ? desde + pagina.length : null,
      };
    },

    async iniciarRonda(jugadorId, partidaId, posicion) {
      const t = ahora();
      const partida = await mantener(await obtenerPartida(jugadorId, partidaId), t);
      const pregunta = (await preguntasDeDesafio(db, partida.desafio_id)).find((p) => p.posicion === posicion);
      await transaccion(db, async (tx) => {
        const existente = await tx.get('SELECT estado FROM rondas WHERE partida_id = ? AND posicion = ?', partida.id, posicion);
        if (existente) return; // idempotente: recargar no reinicia el reloj
        if (partida.terminada_en) throw new ErrorJuego(409, 'partida_terminada', 'Esta partida ya terminó.');
        const activa = await tx.get(`SELECT posicion FROM rondas WHERE partida_id = ? AND estado = 'activa'`, partida.id);
        if (activa) throw new ErrorJuego(409, 'ronda_activa', `La ronda ${activa.posicion} sigue en curso.`);
        const cerradas = (await tx.get('SELECT COUNT(*) AS n FROM rondas WHERE partida_id = ?', partida.id)).n;
        if (posicion !== cerradas + 1) throw new ErrorJuego(409, 'orden_invalido', `Corresponde jugar la ronda ${cerradas + 1}.`);
        if (!pregunta) throw new ErrorJuego(404, 'ronda_inexistente', 'Esa ronda no existe.');
        await tx.run(
          `INSERT INTO rondas (partida_id, posicion, pregunta_id, estado, inicio_en, limite_en) VALUES (?, ?, ?, 'activa', ?, ?)`,
          partida.id, posicion, pregunta.id, t, t + msPorRonda,
        );
      });
      return vista(await mantener(partida, t), t);
    },

    async responder(jugadorId, partidaId, posicion, textoBruto) {
      const t = ahora();
      const partida = await mantener(await obtenerPartida(jugadorId, partidaId), t);
      const texto = String(textoBruto ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LARGO_RESPUESTA);
      const ronda = await db.get('SELECT * FROM rondas WHERE partida_id = ? AND posicion = ?', partida.id, posicion);
      if (!ronda) throw new ErrorJuego(409, 'ronda_no_iniciada', 'Esa ronda todavía no empezó.');
      if (ronda.estado !== 'activa') {
        return { resultado: ronda.estado === 'vencida' ? 'vencida' : 'cerrada', partida: await vista(partida, t) };
      }
      const normalizado = normalizar(texto);
      if (!normalizado) return { resultado: 'vacia', partida: await vista(partida, t) };

      const ev = await evaluarTexto(db, ronda.pregunta_id, texto);
      if (ev.sugerencia) {
        return { resultado: 'sugerida', sugerencia: ev.sugerencia, partida: await vista(partida, t) };
      }

      // Todo lo que decide se lee y se escribe en la misma transacción (BEGIN IMMEDIATE): dos envíos
      // simultáneos no pueden superar el máximo de intentos ni puntuar dos veces.
      let repetida = false;
      const resultado = await transaccion(db, async (tx) => {
        const actual = await tx.get('SELECT estado FROM rondas WHERE partida_id = ? AND posicion = ?', partida.id, posicion);
        if (actual.estado !== 'activa') return 'cerrada';
        const previos = await tx.get(
          'SELECT COUNT(*) AS n, COALESCE(SUM(normalizado = ?), 0) AS iguales FROM intentos WHERE partida_id = ? AND posicion = ?',
          normalizado,
          partida.id,
          posicion,
        );
        repetida = previos.iguales > 0;
        if (previos.n >= config.maxIntentosPorRonda) return 'limite';
        await tx.run(
          'INSERT INTO intentos (partida_id, posicion, texto, normalizado, aceptado, motivo, en) VALUES (?, ?, ?, ?, ?, ?, ?)',
          partida.id,
          posicion,
          texto,
          normalizado,
          ev.aceptada ? 1 : 0,
          ev.aceptada ? null : ev.motivo,
          t,
        );
        if (!ev.aceptada) return 'rechazada';
        await tx.run(
          `UPDATE rondas SET estado = 'acertada', cierre_en = ?, respuesta_id = ?, texto_aceptado = ?, puntos = ? WHERE partida_id = ? AND posicion = ?`,
          t, ev.respuesta.id, texto, ev.respuesta.puntos, partida.id, posicion,
        );
        await tx.run('UPDATE partidas SET puntos = (SELECT COALESCE(SUM(puntos), 0) FROM rondas WHERE partida_id = ?) WHERE id = ?', partida.id, partida.id);
        return 'aceptada';
      });
      if (resultado === 'limite') {
        return { resultado: 'rechazada', motivo: 'Llegaste al máximo de intentos de esta ronda.', partida: await vista(partida, t) };
      }
      const actualizada = await mantener(partida, t);
      return { resultado, motivo: ev.aceptada ? null : ev.motivo, repetida, partida: await vista(actualizada, t) };
    },

    async pasar(jugadorId, partidaId, posicion) {
      const t = ahora();
      const partida = await mantener(await obtenerPartida(jugadorId, partidaId), t);
      await db.run(
        `UPDATE rondas SET estado = 'pasada', cierre_en = ?, puntos = 0 WHERE partida_id = ? AND posicion = ? AND estado = 'activa'`,
        t, partida.id, posicion,
      );
      return vista(await mantener(partida, t), t);
    },

    async reportar(jugadorId, partidaId, posicion, textoBruto, comentarioBruto) {
      const t = ahora();
      const partida = await obtenerPartida(jugadorId, partidaId);
      const ronda = await db.get('SELECT pregunta_id FROM rondas WHERE partida_id = ? AND posicion = ?', partida.id, posicion);
      if (!ronda) throw new ErrorJuego(409, 'ronda_no_iniciada', 'Solo podés reportar respuestas de rondas que ya jugaste.');
      const texto = String(textoBruto ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LARGO_RESPUESTA);
      const comentario = String(comentarioBruto ?? '').trim().slice(0, 300);
      const normalizado = normalizar(texto);
      if (!normalizado) throw new ErrorJuego(400, 'reporte_vacio', 'Escribí la respuesta que querés reportar.');
      const cantidad = (
        await db.get('SELECT COUNT(*) AS n FROM reportes WHERE jugador_id = ? AND pregunta_id IN (SELECT pregunta_id FROM rondas WHERE partida_id = ?)', jugadorId, partida.id)
      ).n;
      if (cantidad >= MAX_REPORTES_POR_PARTIDA) throw new ErrorJuego(429, 'demasiados_reportes', 'Ya enviaste muchos reportes en esta partida.');
      const ev = await evaluarTexto(db, ronda.pregunta_id, texto);
      if (ev.aceptada || ev.sugerencia) return { ok: true, yaValida: true };
      const r = await db.run(
        'INSERT OR IGNORE INTO reportes (jugador_id, pregunta_id, texto, normalizado, comentario, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
        jugadorId, ronda.pregunta_id, texto, normalizado, comentario || null, t,
      );
      return { ok: true, duplicado: r.changes === 0 };
    },
  };
}
