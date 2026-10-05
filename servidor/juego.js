// Lógica de partida. Todo (tiempos, respuestas y puntos) se decide en el servidor.
import { randomUUID } from 'node:crypto';
import { transaccion } from './db.js';
import { CATEGORIAS, RAREZAS, METROS_POR_PUNTO, PREGUNTAS_POR_DESAFIO } from './dominio.js';
import { normalizar } from './normalizar.js';
import { fechaLocal, inicioDeFecha, sumarDias, proximaMedianoche } from './tiempo.js';
import { desafioPorFecha, desafioPorId, preguntasDeDesafio, respuestasDePregunta, respuestasDeDesafio, evaluarTexto } from './banco.js';

export class ErrorJuego extends Error {
  constructor(estado, codigo, mensaje) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const ESTADOS_CERRADOS = new Set(['acertada', 'vencida', 'pasada', 'caducada']);
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

  function desafioDeHoy(t = ahora()) {
    return desafioPorFecha(db, fechaLocal(t, zona));
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
        await tx.run('UPDATE partidas SET terminada_en = ?, puntos = ? WHERE id = ?', t, cerradas.puntos, fila.id);
        return { ...fila, terminada_en: t, puntos: cerradas.puntos };
      }
      return fila;
    });
  }

  function respuestasPublicas(respuestas) {
    return respuestas
      .map((r) => ({ canonica: r.canonica, rareza: r.rareza, nombreRareza: RAREZAS[r.rareza].nombre, puntos: r.puntos }))
      .sort((a, b) => b.puntos - a.puntos || a.canonica.localeCompare(b.canonica, 'es'));
  }

  async function estadisticasDe(partida) {
    const resultados = (
      await db.all('SELECT puntos FROM partidas WHERE desafio_id = ? AND terminada_en IS NOT NULL ORDER BY puntos DESC, terminada_en, id', partida.desafio_id)
    ).map((fila) => fila.puntos);
    const total = resultados.length;
    if (!total) return null;

    const mayores = resultados.filter((puntos) => puntos > partida.puntos).length;
    const iguales = resultados.filter((puntos) => puntos === partida.puntos).length;
    const menores = total - mayores - iguales;
    const promedio = resultados.reduce((suma, puntos) => suma + puntos, 0) / total;
    const varianza = resultados.reduce((suma, puntos) => suma + (puntos - promedio) ** 2, 0) / total;
    const ancho = 50;
    const distribucion = Array.from({ length: 14 }, (_, indice) => ({
      desde: indice * ancho,
      hasta: indice === 13 ? 700 : (indice + 1) * ancho - 1,
      cantidad: 0,
    }));
    for (const puntos of resultados) distribucion[Math.min(13, Math.max(0, Math.floor(puntos / ancho)))].cantidad++;

    return {
      total,
      puesto: mayores + 1,
      empatados: iguales,
      superados: menores,
      percentil: total > 1 ? Math.round(((menores + (iguales - 1) / 2) / (total - 1)) * 100) : null,
      promedio,
      desviacion: Math.sqrt(varianza),
      minimo: resultados.at(-1),
      maximo: resultados[0],
      distribucion,
      suficientesDatos: total >= 5 && varianza > 0,
    };
  }

  async function vista(partida, t = ahora()) {
    const desafio = await desafioPorId(db, partida.desafio_id);
    const [preguntas, respuestasPorPregunta, filasRondas, filasIntentos] = await Promise.all([
      preguntasDeDesafio(db, desafio.id),
      respuestasDeDesafio(db, desafio.id),
      rondasDe(db, partida.id),
      db.all('SELECT posicion, texto, motivo FROM intentos WHERE partida_id = ? AND aceptado = 0 ORDER BY id', partida.id),
    ]);
    const rondas = new Map(filasRondas.map((r) => [r.posicion, r]));
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
        const todas = respuestasPorPregunta.get(p.id) || [];
        item.totalRespuestas = todas.length;
        item.intentos = intentosDe(p.posicion);
      }
      if (r.estado === 'acertada') {
        const resp = (respuestasPorPregunta.get(p.id) || []).find((x) => x.id === r.respuesta_id);
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

  async function partidaPendienteAnterior(jugadorId, fechaHoy, t) {
    const fila = await db.get(
      `SELECT p.* FROM partidas p JOIN desafios d ON d.id = p.desafio_id
       WHERE p.jugador_id = ? AND p.terminada_en IS NULL AND d.fecha < ?
       ORDER BY d.fecha DESC LIMIT 1`,
      jugadorId, fechaHoy,
    );
    if (!fila) return null;
    const actualizada = await mantener(fila, t);
    return actualizada.terminada_en ? null : actualizada;
  }

  return {
    asegurarJugador,

    async estado(jugadorId) {
      const t = ahora();
      await asegurarJugador(jugadorId, t);
      const hoy = fechaLocal(t, zona);
      const desafio = await desafioPorFecha(db, hoy);
      let partidaHoy = null;
      if (desafio) {
        const fila = await db.get('SELECT * FROM partidas WHERE jugador_id = ? AND desafio_id = ?', jugadorId, desafio.id);
        if (fila) partidaHoy = await vista(await mantener(fila, t), t);
      }
      const pendiente = await partidaPendienteAnterior(jugadorId, hoy, t);
      return {
        ahora: t,
        zona,
        proximoDesafioEn: proximaMedianoche(t, zona),
        desafio: desafio ? { fecha: desafio.fecha, numero: desafio.numero, preguntas: PREGUNTAS_POR_DESAFIO } : null,
        partidaHoy,
        partidaPendiente: pendiente ? await vista(pendiente, t) : null,
      };
    },

    async iniciarPartida(jugadorId) {
      const t = ahora();
      await asegurarJugador(jugadorId, t);
      const desafio = await desafioDeHoy(t);
      if (!desafio) throw new ErrorJuego(503, 'sin_desafio', 'El desafío de hoy todavía se está preparando. Probá de nuevo en unos minutos.');
      await db.run('INSERT OR IGNORE INTO partidas (id, jugador_id, desafio_id, iniciada_en) VALUES (?, ?, ?, ?)', randomUUID(), jugadorId, desafio.id, t);
      const fila = await db.get('SELECT * FROM partidas WHERE jugador_id = ? AND desafio_id = ?', jugadorId, desafio.id);
      return vista(await mantener(fila, t), t);
    },

    async verPartida(jugadorId, partidaId) {
      const t = ahora();
      return vista(await mantener(await obtenerPartida(jugadorId, partidaId), t), t);
    },

    async respuestasValidas(jugadorId, partidaId, posicion) {
      const t = ahora();
      const partida = await mantener(await obtenerPartida(jugadorId, partidaId), t);
      const ronda = await db.get('SELECT r.estado, r.pregunta_id AS preguntaId FROM rondas r WHERE r.partida_id = ? AND r.posicion = ?', partida.id, posicion);
      if (!ronda) throw new ErrorJuego(409, 'ronda_no_iniciada', 'Esa ronda todavía no empezó.');
      if (ronda.estado === 'activa') throw new ErrorJuego(409, 'ronda_activa', 'Las respuestas se revelan cuando termina la ronda.');
      if (ronda.estado === 'caducada') throw new ErrorJuego(410, 'ronda_caducada', 'Esa ronda quedó sin jugar.');
      return respuestasPublicas(await respuestasDePregunta(db, ronda.preguntaId));
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

      const previos = await db.all('SELECT normalizado FROM intentos WHERE partida_id = ? AND posicion = ?', partida.id, posicion);
      if (previos.length >= config.maxIntentosPorRonda) {
        return { resultado: 'rechazada', motivo: 'Llegaste al máximo de intentos de esta ronda.', partida: await vista(partida, t) };
      }
      const repetida = previos.some((p) => p.normalizado === normalizado);
      const ev = await evaluarTexto(db, ronda.pregunta_id, texto);
      if (ev.sugerencia) {
        return { resultado: 'sugerida', sugerencia: ev.sugerencia, partida: await vista(partida, t) };
      }

      const resultado = await transaccion(db, async (tx) => {
        const actual = await tx.get('SELECT estado FROM rondas WHERE partida_id = ? AND posicion = ?', partida.id, posicion);
        if (actual.estado !== 'activa') return 'cerrada';
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
