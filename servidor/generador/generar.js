// Tarea de generación diaria: prepara, valida y publica un único lote de 7 preguntas por fecha y modo.
// - Idempotente: si ya hay desafío para la fecha y el modo, no hace nada (y la base impide duplicados).
// - La IA automática (Wikidata, alcance global) solo arma el modo Normal; los modos temáticos usan su
//   reserva o la carga manual del panel (con el prompt de cada modo para otra IA).
// - Un bloqueo con vencimiento evita que dos procesos generen la misma fecha a la vez.
// - Si la IA falla o no está configurada, completa con el banco de reserva validado.
import { randomUUID } from 'node:crypto';
import { CLAVES_CATEGORIAS, CATEGORIAS, MODOS, MODO_POR_DEFECTO, ranurasDeModo, categoriaDeRanura } from '../dominio.js';
import { validarPregunta, validarLote } from '../validacion.js';
import { normalizar } from '../normalizar.js';
import { mezclar } from '../azar.js';
import { tomarBloqueo, liberarBloqueo } from '../db.js';
import { desafioPorFecha, publicarDesafio, preguntasRecientes, usosDeReserva } from '../banco.js';
import { elegirDeReserva } from './reserva.js';
import { fechaLocal, inicioDeFecha } from '../tiempo.js';

async function enParalelo(items, limite, fn) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return resultados;
}

const comoReciente = (p, fecha) => ({
  enunciado: p.enunciado,
  huella: p.huella,
  reservaId: p.origen === 'reserva' ? p.id : null,
  fecha,
  claves: p.respuestas.map((r) => normalizar(r.canonica)),
});

function puntaje(p) {
  const rarezas = new Set(p.respuestas.map((r) => r.rareza));
  return Math.min(p.respuestas.length, 30) + 3 * rarezas.size + (rarezas.has('diamante') ? 2 : 0);
}

/** Genera candidatas con IA, las depura y elige la mejor por categoría. */
export async function generarConIA({ proveedor, verificador, catalogo, categorias, recientes, fecha, config, detalle, elegidas = new Map(), signal = null }) {
  const dominios = config.fuentes.dominios;
  const registrar = (lista, item) => {
    if (lista.length < 300) lista.push(item);
  };

  for (let pasada = 1; pasada <= 2; pasada++) {
    if (signal?.aborted) break;
    const pendientes = categorias.filter((c) => !elegidas.has(c));
    if (!pendientes.length) break;
    const yaElegidas = () => [...elegidas.values()].map((p) => comoReciente(p, fecha));

    // 1) Generación por categoría.
    const generadas = await enParalelo(pendientes, 3, async (categoria) => {
      try {
        if (signal?.aborted) return [];
        const { preguntas, uso } = await proveedor.generarPreguntas({
          signal,
          categoria,
          cantidad: config.ia.candidatasPorCategoria,
          recientes: recientes.filter((r) => r.enunciado).slice(0, 120),
          fecha,
        });
        registrar(detalle.pasos, { pasada, categoria, candidatas: preguntas.length, uso });
        return preguntas.map((p) => ({ ...p, categoria, id: null }));
      } catch (e) {
        registrar(detalle.pasos, { pasada, categoria, error: e.message });
        return [];
      }
    });

    // 2) Validación estructural y verificación contra fuentes.
    const depuradas = [];
    for (const candidata of generadas.flat()) {
      if (signal?.aborted) break;
      let preparada = candidata;
      if (candidata.consulta_wikidata || candidata.consultaWikidata) {
        if (!catalogo) {
          registrar(detalle.rechazadas, { etapa: 'wikidata', categoria: candidata.categoria, enunciado: candidata.enunciado, motivos: ['No hay catálogo de Wikidata configurado.'] });
          continue;
        }
        try {
          preparada = await catalogo.hidratar(candidata, { signal });
          registrar(detalle.pasos, { pasada, categoria: candidata.categoria, wikidata: preparada.respuestas.length });
        } catch (e) {
          registrar(detalle.rechazadas, { etapa: 'wikidata', categoria: candidata.categoria, enunciado: candidata.enunciado, motivos: [e.message] });
          continue;
        }
      }
      const v = validarPregunta(preparada, { dominios, recientes: [...recientes, ...yaElegidas()] });
      for (const d of v.descartadas) registrar(detalle.descartes, { etapa: 'estructura', enunciado: candidata.enunciado, ...d });
      if (!v.ok) {
        registrar(detalle.rechazadas, { etapa: 'estructura', categoria: candidata.categoria, enunciado: candidata.enunciado, motivos: v.errores });
        continue;
      }
      const ver = await verificador.verificarPregunta(v.pregunta, { signal });
      if (!ver.verificada) {
        registrar(detalle.rechazadas, { etapa: 'fuentes', categoria: candidata.categoria, enunciado: candidata.enunciado, motivos: ['No se pudo leer ninguna fuente.', ...ver.errores] });
        continue;
      }
      for (const d of ver.descartadas) registrar(detalle.descartes, { etapa: 'fuentes', enunciado: candidata.enunciado, ...d });
      depuradas.push({ ...v.pregunta, respuestas: ver.respuestas, origen: 'ia' });
    }
    if (!depuradas.length || signal?.aborted) continue;

    // 3) Revisión adversarial: solo puede quitar respuestas o preguntas, nunca agregar ni aprobar por sí sola.
    let revisadas = depuradas;
    if (config.ia.revisionAdversarial) {
      try {
        const { revisiones } = await proveedor.revisarPreguntas({ preguntas: depuradas, signal });
        const porIndice = new Map(revisiones.map((r) => [r.indice, r]));
        revisadas = [];
        depuradas.forEach((p, i) => {
          const rev = porIndice.get(i);
          if (!rev) {
            registrar(detalle.rechazadas, { etapa: 'revision', enunciado: p.enunciado, motivos: ['La revisión no la cubrió.'] });
            return;
          }
          const faltantes = Array.isArray(rev.faltantes) ? rev.faltantes : [];
          if (!rev.apta || faltantes.length >= 3) {
            registrar(detalle.rechazadas, { etapa: 'revision', enunciado: p.enunciado, motivos: [...(rev.problemas || []), ...(faltantes.length ? [`Faltan respuestas: ${faltantes.join(', ')}`] : [])] });
            return;
          }
          let conservadas = p.respuestas;
          if (p.datosEstructurados !== 'wikidata') {
            const veredictos = new Map((rev.respuestas || []).map((r) => [normalizar(r.canonica), r]));
            conservadas = p.respuestas.filter((r) => {
              const vr = veredictos.get(normalizar(r.canonica));
              const ok = vr?.veredicto === 'correcta';
              if (!ok) registrar(detalle.descartes, { etapa: 'revision', enunciado: p.enunciado, canonica: r.canonica, motivo: vr ? `${vr.veredicto}: ${vr.motivo || ''}` : 'sin veredicto' });
              return ok;
            });
          }
          if (faltantes.length) registrar(detalle.avisos, `Posibles respuestas faltantes en «${p.enunciado}»: ${faltantes.join(', ')}`);
          revisadas.push({ ...p, respuestas: conservadas });
        });
      } catch (e) {
        registrar(detalle.pasos, { pasada, revision: 'error', error: e.message });
        continue; // sin revisión no se publica nada de esta pasada
      }
    }

    // 4) Revalidación tras los descartes y elección de la mejor candidata por categoría.
    for (const p of revisadas) {
      if (elegidas.has(p.categoria)) {
        const actual = elegidas.get(p.categoria);
        if (puntaje(actual) >= puntaje(p)) continue;
      }
      const v = validarPregunta(p, { dominios, recientes: [...recientes, ...[...elegidas.values()].filter((e) => e.categoria !== p.categoria).map((e) => comoReciente(e, fecha))] });
      if (!v.ok) {
        registrar(detalle.rechazadas, { etapa: 'revalidacion', categoria: p.categoria, enunciado: p.enunciado, motivos: v.errores });
        continue;
      }
      elegidas.set(p.categoria, { ...v.pregunta, origen: 'ia' });
    }
  }
  return elegidas;
}

async function finalizarCorrida(db, corridaId, resultado, detalle, ahora) {
  await db.run('UPDATE corridas SET terminada_en = ?, resultado = ?, detalle = ? WHERE id = ?', ahora, resultado, JSON.stringify(detalle), corridaId);
}

export async function intentosDeIA(db, fecha) {
  return (await db.get('SELECT COUNT(*) AS n FROM corridas WHERE fecha_objetivo = ? AND uso_ia = 1', fecha)).n;
}

/** Corre la generación con IA, pero deja de esperarla al agotar el presupuesto (se conserva lo ya elegido). */
/**
 * Corre la generación con IA con un tope de tiempo. Al vencer, ABORTA las solicitudes en curso
 * (proveedor, Wikidata y fuentes): no quedan llamadas pagas corriendo en segundo plano.
 * Se conserva lo que ya se eligió.
 */
export async function generarConPresupuesto(args, presupuestoMs) {
  const controlador = new AbortController();
  const senal = args.signal ? AbortSignal.any([controlador.signal, args.signal]) : controlador.signal;
  if (!presupuestoMs) return generarConIA({ ...args, signal: senal });
  let temporizador;
  const vencido = new Promise((ok) => {
    temporizador = setTimeout(() => {
      args.detalle.avisos.push(`La IA superó el presupuesto de ${Math.round(presupuestoMs / 1000)} s; se cancelaron las solicitudes y se usa lo que alcanzó a elegir.`);
      controlador.abort(new Error('Presupuesto de tiempo de la IA agotado.'));
      ok(args.elegidas);
    }, presupuestoMs);
  });
  try {
    return await Promise.race([generarConIA({ ...args, signal: senal }), vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Envuelve al proveedor: cuenta llamadas y tokens, y corta al llegar al tope de la corrida. */
export function contarUso(proveedor, { maxLlamadas }) {
  const uso = { llamadas: 0, tokensEntrada: 0, tokensSalida: 0 };
  const llamar = (metodo) => async (args) => {
    if (uso.llamadas >= maxLlamadas) throw new Error(`Se alcanzó el tope de ${maxLlamadas} llamadas a la IA para esta corrida.`);
    uso.llamadas++;
    const r = await proveedor[metodo](args);
    uso.tokensEntrada += r?.uso?.input_tokens || 0;
    uso.tokensSalida += r?.uso?.output_tokens || 0;
    return r;
  };
  return { proveedor: { ...proveedor, generarPreguntas: llamar('generarPreguntas'), revisarPreguntas: llamar('revisarPreguntas') }, uso };
}

async function llamadasIADelDia(db, config, t) {
  const desde = inicioDeFecha(fechaLocal(t, config.zona), config.zona);
  return (await db.get('SELECT COALESCE(SUM(llamadas_ia), 0) AS n FROM corridas WHERE iniciada_en >= ?', desde)).n;
}

/**
 * Asegura que exista el desafío de `fecha` para `modo`.
 * permitirReserva=false se usa al preparar con anticipación: si la IA falla, se reintenta más tarde.
 * reemplazar=true (administración) genera uno nuevo aunque ya exista y, solo si se pudo publicar,
 * borra el anterior; forzarIA=true ignora el máximo de intentos de IA por día.
 * `reservas` trae el banco de cada modo; `reserva` (el de Normal) se acepta por compatibilidad.
 */
export async function asegurarDesafio({ db, config, fecha, modo = MODO_POR_DEFECTO, proveedor: proveedorIA = null, verificador, catalogo = null, reserva: reservaNormal, reservas = null, permitirReserva = true, reemplazar = false, forzarIA = false, ahora = () => Date.now(), titular = randomUUID(), registro = null }) {
  const anterior = await desafioPorFecha(db, fecha, modo);
  if (anterior && !reemplazar) return { resultado: 'ya_existia', fecha, modo };
  const proveedor = MODOS[modo].iaAutomatica ? proveedorIA : null;
  const reserva = reservas?.[modo] ?? (modo === MODO_POR_DEFECTO ? reservaNormal : null) ?? { preguntas: [] };

  // Tope diario de llamadas (todas las corridas del día): si se agotó, se sigue sin IA.
  const restantesHoy = proveedor ? config.ia.maxLlamadasPorDia - (await llamadasIADelDia(db, config, ahora())) : 0;
  const sinCupo = Boolean(proveedor) && restantesHoy <= 0;
  let quedanIntentosIA = Boolean(proveedor) && !sinCupo && (forzarIA || (await intentosDeIA(db, fecha)) < config.ia.maxIntentosPorDia);
  if (!permitirReserva && !quedanIntentosIA) return { resultado: 'pendiente', fecha, modo, motivo: 'esperando la ventana de reserva' };

  // Normal conserva el nombre histórico del bloqueo (lo comparten instancias de versiones anteriores).
  const nombreBloqueo = modo === MODO_POR_DEFECTO ? `generacion:${fecha}` : `generacion:${modo}:${fecha}`;
  if (!(await tomarBloqueo(db, nombreBloqueo, titular, 20 * 60 * 1000, ahora()))) return { resultado: 'ocupado', fecha, modo };
  // Una sola generación con IA a la vez (aunque sea para otra fecha): evita costos duplicados.
  let conBloqueoIA = false;
  if (quedanIntentosIA) {
    conBloqueoIA = await tomarBloqueo(db, 'generacion:ia', titular, 20 * 60 * 1000, ahora());
    if (!conBloqueoIA) {
      if (!permitirReserva) {
        await liberarBloqueo(db, nombreBloqueo, titular);
        return { resultado: 'ocupado', fecha, modo, motivo: 'otra generación con IA en curso' };
      }
      quedanIntentosIA = false;
    }
  }
  const inicio = ahora();
  const medidor = proveedor ? contarUso(proveedor, { maxLlamadas: Math.max(0, Math.min(config.ia.maxLlamadasPorCorrida, restantesHoy)) }) : null;

  const { lastInsertRowid } = await db.run('INSERT INTO corridas (fecha_objetivo, modo, iniciada_en) VALUES (?, ?, ?)', fecha, modo, ahora());
  const corridaId = Number(lastInsertRowid);
  const detalle = { modo, proveedor: proveedor?.nombre ?? 'ninguno', modelo: proveedor?.modelo ?? null, pasos: [], rechazadas: [], descartes: [], avisos: [] };
  if (sinCupo) detalle.avisos.push(`Se agotó el tope diario de ${config.ia.maxLlamadasPorDia} llamadas a la IA.`);

  try {
    if (!reemplazar && (await desafioPorFecha(db, fecha, modo))) {
      await finalizarCorrida(db, corridaId, 'ya_existia', detalle, ahora());
      return { resultado: 'ya_existia', fecha, modo, corridaId };
    }
    const recientes = await preguntasRecientes(db, fecha, config.diasSinRepetir, modo);
    // Al regenerar, las preguntas que se reemplazan cuentan como recientes: el día cambia de verdad.
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
    let elegidas = new Map();

    if (quedanIntentosIA) {
      await db.run('UPDATE corridas SET uso_ia = 1 WHERE id = ?', corridaId);
      try {
        elegidas = await generarConPresupuesto({ proveedor: medidor.proveedor, verificador, catalogo, categorias, recientes, fecha, config, detalle, elegidas }, config.ia.presupuestoMs);
        elegidas = new Map(elegidas); // la IA pudo seguir corriendo en segundo plano: se congela lo elegido
      } catch (e) {
        detalle.errorIA = e.message;
      }
    } else if (proveedor) {
      detalle.avisos.push('Se agotaron los intentos de IA para esta fecha.');
    }

    const faltantes = categorias.filter((c) => !elegidas.has(c));
    if (faltantes.length) {
      if (quedanIntentosIA) detalle.avisos.push(`Categorías sin pregunta de IA: ${faltantes.map((c) => CATEGORIAS[categoriaDeRanura(c)]).join(', ')}.`);
      if (!permitirReserva) {
        await finalizarCorrida(db, corridaId, 'pendiente', detalle, ahora());
        return { resultado: 'pendiente', fecha, modo, corridaId, faltantes };
      }
      const yaElegidas = [...elegidas.values()].map((p) => comoReciente(p, fecha));
      const { elegidas: deReserva, avisos } = elegirDeReserva({ reserva, categorias: faltantes, recientes: [...recientes, ...yaElegidas], usos: await usosDeReserva(db, modo), fecha });
      detalle.avisos.push(...avisos);
      for (const [c, p] of deReserva) elegidas.set(c, p);
    }

    let preguntas = categorias.map((c) => elegidas.get(c)).filter(Boolean);
    let lote = validarLote(preguntas, modo);
    if (!lote.ok && permitirReserva && preguntas.some((p) => p.origen === 'ia')) {
      detalle.avisos.push(`Lote mixto inválido (${lote.errores.join(' ')}); se usa reserva completa.`);
      const { elegidas: deReserva, avisos } = elegirDeReserva({ reserva, categorias, recientes, usos: await usosDeReserva(db, modo), fecha });
      detalle.avisos.push(...avisos);
      preguntas = categorias.map((c) => deReserva.get(c)).filter(Boolean);
      lote = validarLote(preguntas, modo);
    }
    if (!lote.ok) {
      detalle.errorLote = lote.errores;
      await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora());
      return { resultado: 'fallo', fecha, modo, corridaId, errores: lote.errores };
    }

    const deIA = preguntas.filter((p) => p.origen === 'ia').length;
    const origen = deIA === preguntas.length ? 'ia' : deIA === 0 ? 'reserva' : 'mixto';
    const pub = await publicarDesafio(db, { fecha, modo, preguntas, origen, modelo: deIA ? proveedor?.modelo : null, corridaId, ahora: ahora(), reemplazar });
    detalle.publicadas = preguntas.map((p) => ({ categoria: p.categoria, enunciado: p.enunciado, origen: p.origen, respuestas: p.respuestas.length }));
    await finalizarCorrida(db, corridaId, pub.publicado ? `publicado_${origen}` : 'ya_existia', detalle, ahora());
    return pub.publicado
      ? { resultado: anterior && reemplazar ? 'reemplazado' : 'publicado', fecha, modo, origen, desafioId: pub.desafioId, numero: pub.numero, corridaId }
      : { resultado: 'ya_existia', fecha, modo, corridaId };
  } catch (e) {
    detalle.error = e.stack || e.message;
    await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora()).catch(() => {});
    return { resultado: 'fallo', fecha, modo, corridaId, error: e.message };
  } finally {
    if (medidor?.uso.llamadas) {
      const { llamadas, tokensEntrada, tokensSalida } = medidor.uso;
      const costo = config.ia.costoEntradaMTok || config.ia.costoSalidaMTok
        ? (tokensEntrada * config.ia.costoEntradaMTok + tokensSalida * config.ia.costoSalidaMTok) / 1e6
        : null;
      await db
        .run('UPDATE corridas SET llamadas_ia = ?, tokens_entrada = ?, tokens_salida = ?, costo_estimado_usd = ? WHERE id = ?', llamadas, tokensEntrada, tokensSalida, costo, corridaId)
        .catch(() => {});
      registro?.info('ia', {
        proveedor: proveedor.nombre,
        modelo: proveedor.modelo,
        fecha,
        corridaId,
        duracionMs: ahora() - inicio,
        llamadas,
        tokensEntrada,
        tokensSalida,
        costoEstimadoUsd: costo,
        resultado: detalle.publicadas ? 'publicado' : detalle.errorIA || detalle.error ? 'error' : 'sin_publicar',
        preguntasDeIA: [...(detalle.publicadas || [])].filter((p) => p.origen === 'ia').length,
        errorIA: detalle.errorIA,
      });
    }
    if (conBloqueoIA) await liberarBloqueo(db, 'generacion:ia', titular).catch(() => {});
    await liberarBloqueo(db, nombreBloqueo, titular).catch(() => {});
  }
}
