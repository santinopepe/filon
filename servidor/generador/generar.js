// Publicación diaria: arma, valida y publica un único lote de 7 preguntas por fecha y modo, tomándolas de
// la reserva del modo (banco de archivo + lo guardado y editado desde el panel).
// - Idempotente: si ya hay desafío para la fecha y el modo, no hace nada (y la base impide duplicados).
// - Un bloqueo con vencimiento evita que dos procesos publiquen la misma fecha a la vez.
// - Las preguntas nuevas se cargan a mano desde el panel (con el prompt de cada modo para otra IA).
import { randomUUID } from 'node:crypto';
import { CLAVES_CATEGORIAS, MODO_POR_DEFECTO, ranurasDeModo } from '../dominio.js';
import { validarLote } from '../validacion.js';
import { normalizar } from '../normalizar.js';
import { mezclar } from '../azar.js';
import { tomarBloqueo, liberarBloqueo } from '../db.js';
import { desafioPorFecha, publicarDesafio, preguntasRecientes, usosDeReserva } from '../banco.js';
import { elegirDeReserva, reservaCompleta } from './reserva.js';

async function finalizarCorrida(db, corridaId, resultado, detalle, ahora) {
  await db.run('UPDATE corridas SET terminada_en = ?, resultado = ?, detalle = ? WHERE id = ?', ahora, resultado, JSON.stringify(detalle), corridaId);
}

/**
 * Asegura que exista el desafío de `fecha` para `modo`, con preguntas de la reserva.
 * reemplazar=true (administración) arma uno nuevo aunque ya exista y, solo si se pudo publicar, borra
 * el anterior; las preguntas reemplazadas cuentan como recientes, así el día cambia de verdad.
 * `reservas` trae el banco de archivo de cada modo; `reserva` (el de Normal) se acepta por compatibilidad.
 */
export async function asegurarDesafio({ db, config, fecha, modo = MODO_POR_DEFECTO, reserva: reservaNormal, reservas = null, reemplazar = false, ahora = () => Date.now(), titular = randomUUID() }) {
  const anterior = await desafioPorFecha(db, fecha, modo);
  if (anterior && !reemplazar) return { resultado: 'ya_existia', fecha, modo };

  // Normal conserva el nombre histórico del bloqueo (lo comparten instancias de versiones anteriores).
  const nombreBloqueo = modo === MODO_POR_DEFECTO ? `generacion:${fecha}` : `generacion:${modo}:${fecha}`;
  if (!(await tomarBloqueo(db, nombreBloqueo, titular, 20 * 60 * 1000, ahora()))) return { resultado: 'ocupado', fecha, modo };

  const { lastInsertRowid } = await db.run('INSERT INTO corridas (fecha_objetivo, modo, iniciada_en) VALUES (?, ?, ?)', fecha, modo, ahora());
  const corridaId = Number(lastInsertRowid);
  const detalle = { modo, avisos: [] };

  try {
    if (!reemplazar && (await desafioPorFecha(db, fecha, modo))) {
      await finalizarCorrida(db, corridaId, 'ya_existia', detalle, ahora());
      return { resultado: 'ya_existia', fecha, modo, corridaId };
    }
    const base = reservas?.[modo] ?? (modo === MODO_POR_DEFECTO ? reservaNormal : null) ?? { preguntas: [] };
    const reserva = await reservaCompleta(db, modo, base, { dominios: config.fuentes.dominios });
    const recientes = await preguntasRecientes(db, fecha, config.diasSinRepetir, modo);
    if (anterior) {
      detalle.reemplaza = anterior.id;
      const viejas = await db.all('SELECT id, enunciado, huella, reserva_id AS reservaId FROM preguntas WHERE desafio_id = ?', anterior.id);
      const canonicas = await db.all('SELECT r.pregunta_id, r.canonica FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id WHERE p.desafio_id = ?', anterior.id);
      for (const v of viejas) {
        recientes.push({ ...v, fecha, claves: canonicas.filter((c) => c.pregunta_id === v.id).map((c) => normalizar(c.canonica)) });
      }
    }
    // Ranuras del día: en Normal, las siete categorías en un orden que depende de la fecha.
    const categorias = modo === MODO_POR_DEFECTO ? mezclar(CLAVES_CATEGORIAS, `orden:${fecha}`) : ranurasDeModo(modo);
    const { elegidas, avisos } = elegirDeReserva({ reserva, categorias, recientes, usos: await usosDeReserva(db, modo), fecha });
    detalle.avisos.push(...avisos);
    const preguntas = categorias.map((c) => elegidas.get(c)).filter(Boolean);
    const lote = validarLote(preguntas, modo);
    if (!lote.ok) {
      detalle.errorLote = lote.errores;
      await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora());
      return { resultado: 'fallo', fecha, modo, corridaId, errores: lote.errores };
    }

    const pub = await publicarDesafio(db, { fecha, modo, preguntas, origen: 'reserva', corridaId, ahora: ahora(), reemplazar });
    detalle.publicadas = preguntas.map((p) => ({ categoria: p.categoria, enunciado: p.enunciado, origen: p.origen, id: p.id, respuestas: p.respuestas.length }));
    await finalizarCorrida(db, corridaId, pub.publicado ? 'publicado_reserva' : 'ya_existia', detalle, ahora());
    return pub.publicado
      ? { resultado: anterior && reemplazar ? 'reemplazado' : 'publicado', fecha, modo, origen: 'reserva', desafioId: pub.desafioId, numero: pub.numero, corridaId }
      : { resultado: 'ya_existia', fecha, modo, corridaId };
  } catch (e) {
    detalle.error = e.stack || e.message;
    await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora()).catch(() => {});
    return { resultado: 'fallo', fecha, modo, corridaId, error: e.message };
  } finally {
    await liberarBloqueo(db, nombreBloqueo, titular).catch(() => {});
  }
}
