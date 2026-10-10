// Publicación diaria: arma, valida y publica un único lote de 7 preguntas por fecha y modo. Normal puede
// armarlo con el generador por catálogos (sin IA; ver docs/GENERADOR.md) o desde la reserva; los modos
// temáticos, desde su reserva (banco de archivo + lo guardado y editado desde el panel).
// - Idempotente: si ya hay desafío para la fecha y el modo, no hace nada (y la base impide duplicados).
// - Un bloqueo con vencimiento evita que dos procesos publiquen la misma fecha a la vez.
// - Las preguntas nuevas se cargan a mano desde el panel (con el prompt de cada modo para otra IA).
import { randomUUID } from 'node:crypto';
import { CLAVES_CATEGORIAS, MODO_POR_DEFECTO, VARIEDAD_NORMAL, ranurasDeModo } from '../dominio.js';
import { validarLote } from '../validacion.js';
import { normalizar } from '../normalizar.js';
import { mezclar } from '../azar.js';
import { tomarBloqueo, liberarBloqueo, describirError } from '../db.js';
import { desafioPorFecha, publicarDesafio, preguntasRecientes, usosDeReserva } from '../banco.js';
import { elegirDeReserva, reservaCompleta } from './reserva.js';
import { generarConCatalogos, resumirDescartes } from './catalogos.js';

async function finalizarCorrida(db, corridaId, resultado, detalle, ahora) {
  await db.run('UPDATE corridas SET terminada_en = ?, resultado = ?, detalle = ? WHERE id = ?', ahora, resultado, JSON.stringify(detalle), corridaId);
}

/**
 * Asegura que exista el desafío de `fecha` para `modo`, con preguntas de la reserva.
 * reemplazar=true (administración) arma uno nuevo aunque ya exista y, solo si se pudo publicar, borra
 * el anterior; las preguntas reemplazadas cuentan como recientes, así el día cambia de verdad.
 * `reservas` trae el banco de archivo de cada modo; `reserva` (el de Normal) se acepta por compatibilidad.
 * `generador` («catalogos» o «reserva») elige cómo se arma Normal o Geografía; por omisión, el de
 * config.generadores. Los demás modos usan siempre su reserva.
 */
export async function asegurarDesafio({ db, config, fecha, modo = MODO_POR_DEFECTO, reserva: reservaNormal, reservas = null, reemplazar = false, ahora = () => Date.now(), titular = randomUUID(), generador = null }) {
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
    const recientes = await preguntasRecientes(db, fecha, config.diasSinRepetir, modo);
    let anteriores = [];
    if (anterior) {
      detalle.reemplaza = anterior.id;
      anteriores = await db.all('SELECT id, categoria, enunciado, huella, reserva_id AS reservaId, firma, conjunto, generacion FROM preguntas WHERE desafio_id = ?', anterior.id);
      const canonicas = await db.all('SELECT r.pregunta_id, r.canonica FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id WHERE p.desafio_id = ?', anterior.id);
      for (const v of anteriores) {
        v.claves = canonicas.filter(c=>c.pregunta_id===v.id).map(c=>normalizar(c.canonica));
        recientes.push({ ...v, fecha, claves: v.claves });
      }
    }

    let preguntas = [];
    const tipo = Object.hasOwn(config.generadores, modo) ? (generador ?? config.generadores[modo]) : 'reserva';
    detalle.generador = tipo;
    if (tipo === 'catalogos') {
      const g = await generarConCatalogos({ db, config, fecha, modo, anteriores });
      detalle.catalogos = { semilla: g.semilla, versiones: g.versiones, elegidas: g.elegidas, descartes: resumirDescartes(g.descartes), problemas: g.problemas, errores: g.errores };
      preguntas = g.preguntas;
      if (!g.ok && (!config.catalogos.completarConReserva || config.catalogos.planDificultad)) {
        detalle.errorLote = g.errores;
        await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora());
        return { resultado: 'fallo', fecha, modo, corridaId, errores: g.errores };
      }
    }

    if (preguntas.length < 7) {
      // Reserva: en Normal, categorías clásicas en un orden que depende de la fecha; si ya hay preguntas
      // generadas, solo las que faltan, respetando el tope por categoría y sumando categorías nuevas primero.
      const reserva = await reservaCompleta(db, modo, base, { dominios: config.fuentes.dominios });
      let categorias = modo === MODO_POR_DEFECTO ? mezclar(CLAVES_CATEGORIAS, `orden:${fecha}`) : ranurasDeModo(modo);
      if (preguntas.length) {
        const usadas = preguntas.map((p) => p.categoria);
        const libres = categorias.filter((c) => usadas.filter((u) => u === c).length < VARIEDAD_NORMAL.maxPorCategoria);
        categorias = [...libres.filter((c) => !usadas.includes(c)), ...libres.filter((c) => usadas.includes(c))].slice(0, 7 - preguntas.length);
        detalle.completadaConReserva = categorias;
      }
      const { elegidas, avisos } = elegirDeReserva({ reserva, categorias, recientes, usos: await usosDeReserva(db, modo), fecha });
      detalle.avisos.push(...avisos);
      preguntas = [...preguntas, ...categorias.map((c) => elegidas.get(c)).filter(Boolean)];
    }
    const lote = validarLote(preguntas, modo);
    if (!lote.ok) {
      detalle.errorLote = lote.errores;
      await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora());
      return { resultado: 'fallo', fecha, modo, corridaId, errores: lote.errores };
    }
    const deCatalogo = preguntas.filter((p) => p.origen === 'catalogo').length;
    const origen = deCatalogo === preguntas.length ? 'catalogo' : deCatalogo ? 'mixto' : 'reserva';

    const pub = await publicarDesafio(db, { fecha, modo, preguntas, origen, corridaId, ahora: ahora(), reemplazar });
    detalle.publicadas = preguntas.map((p) => ({ categoria: p.categoria, enunciado: p.enunciado, origen: p.origen, id: p.id, respuestas: p.respuestas.length }));
    await finalizarCorrida(db, corridaId, pub.publicado ? `publicado_${origen}` : 'ya_existia', detalle, ahora());
    return pub.publicado
      ? { resultado: anterior && reemplazar ? 'reemplazado' : 'publicado', fecha, modo, origen, desafioId: pub.desafioId, numero: pub.numero, corridaId }
      : { resultado: 'ya_existia', fecha, modo, corridaId };
  } catch (e) {
    detalle.error = e.stack || e.message;
    detalle.causa = describirError(e);
    await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora()).catch(() => {});
    return { resultado: 'fallo', fecha, modo, corridaId, error: describirError(e) };
  } finally {
    await liberarBloqueo(db, nombreBloqueo, titular).catch(() => {});
  }
}
