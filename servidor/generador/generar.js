// Tarea de generación diaria: prepara, valida y publica un único lote de 7 preguntas por fecha.
// - Idempotente: si ya hay desafío para la fecha, no hace nada (y la base impide duplicados).
// - Un bloqueo con vencimiento evita que dos procesos generen la misma fecha a la vez.
// - Si la IA falla o no está configurada, completa con el banco de reserva validado.
import { randomUUID } from 'node:crypto';
import { CLAVES_CATEGORIAS, CATEGORIAS } from '../dominio.js';
import { validarPregunta, validarLote } from '../validacion.js';
import { normalizar } from '../normalizar.js';
import { mezclar } from '../azar.js';
import { tomarBloqueo, liberarBloqueo } from '../db.js';
import { desafioPorFecha, publicarDesafio, preguntasRecientes, usosDeReserva } from '../banco.js';
import { elegirDeReserva } from './reserva.js';

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
export async function generarConIA({ proveedor, verificador, catalogo, categorias, recientes, fecha, config, detalle, elegidas = new Map() }) {
  const dominios = config.fuentes.dominios;
  const registrar = (lista, item) => {
    if (lista.length < 300) lista.push(item);
  };

  for (let pasada = 1; pasada <= 2; pasada++) {
    const pendientes = categorias.filter((c) => !elegidas.has(c));
    if (!pendientes.length) break;
    const yaElegidas = () => [...elegidas.values()].map((p) => comoReciente(p, fecha));

    // 1) Generación por categoría.
    const generadas = await enParalelo(pendientes, 3, async (categoria) => {
      try {
        const { preguntas, uso } = await proveedor.generarPreguntas({
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
      let preparada = candidata;
      if (candidata.consulta_wikidata || candidata.consultaWikidata) {
        if (!catalogo) {
          registrar(detalle.rechazadas, { etapa: 'wikidata', categoria: candidata.categoria, enunciado: candidata.enunciado, motivos: ['No hay catálogo de Wikidata configurado.'] });
          continue;
        }
        try {
          preparada = await catalogo.hidratar(candidata);
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
      const ver = await verificador.verificarPregunta(v.pregunta);
      if (!ver.verificada) {
        registrar(detalle.rechazadas, { etapa: 'fuentes', categoria: candidata.categoria, enunciado: candidata.enunciado, motivos: ['No se pudo leer ninguna fuente.', ...ver.errores] });
        continue;
      }
      for (const d of ver.descartadas) registrar(detalle.descartes, { etapa: 'fuentes', enunciado: candidata.enunciado, ...d });
      depuradas.push({ ...v.pregunta, respuestas: ver.respuestas, origen: 'ia' });
    }
    if (!depuradas.length) continue;

    // 3) Revisión adversarial: solo puede quitar respuestas o preguntas, nunca agregar ni aprobar por sí sola.
    let revisadas = depuradas;
    if (config.ia.revisionAdversarial) {
      try {
        const { revisiones } = await proveedor.revisarPreguntas({ preguntas: depuradas });
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
async function generarConPresupuesto(args, presupuestoMs) {
  if (!presupuestoMs) return generarConIA(args);
  let temporizador;
  const vencido = new Promise((ok) => {
    temporizador = setTimeout(() => {
      args.detalle.avisos.push(`La IA superó el presupuesto de ${Math.round(presupuestoMs / 1000)} s; se usa lo que alcanzó a elegir.`);
      ok(args.elegidas);
    }, presupuestoMs);
  });
  try {
    return await Promise.race([generarConIA(args), vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Asegura que exista el desafío de `fecha`.
 * permitirReserva=false se usa al preparar con anticipación: si la IA falla, se reintenta más tarde.
 */
export async function asegurarDesafio({ db, config, fecha, proveedor = null, verificador, catalogo = null, reserva, permitirReserva = true, ahora = () => Date.now(), titular = randomUUID() }) {
  if (await desafioPorFecha(db, fecha)) return { resultado: 'ya_existia', fecha };

  const quedanIntentosIA = Boolean(proveedor) && (await intentosDeIA(db, fecha)) < config.ia.maxIntentosPorDia;
  if (!permitirReserva && !quedanIntentosIA) return { resultado: 'pendiente', fecha, motivo: 'esperando la ventana de reserva' };

  const nombreBloqueo = `generacion:${fecha}`;
  if (!(await tomarBloqueo(db, nombreBloqueo, titular, 20 * 60 * 1000, ahora()))) return { resultado: 'ocupado', fecha };

  const { lastInsertRowid } = await db.run('INSERT INTO corridas (fecha_objetivo, iniciada_en) VALUES (?, ?)', fecha, ahora());
  const corridaId = Number(lastInsertRowid);
  const detalle = { proveedor: proveedor?.nombre ?? 'ninguno', modelo: proveedor?.modelo ?? null, pasos: [], rechazadas: [], descartes: [], avisos: [] };

  try {
    if (await desafioPorFecha(db, fecha)) {
      await finalizarCorrida(db, corridaId, 'ya_existia', detalle, ahora());
      return { resultado: 'ya_existia', fecha, corridaId };
    }
    const recientes = await preguntasRecientes(db, fecha, config.diasSinRepetir);
    const categorias = mezclar(CLAVES_CATEGORIAS, `orden:${fecha}`);
    let elegidas = new Map();

    if (quedanIntentosIA) {
      await db.run('UPDATE corridas SET uso_ia = 1 WHERE id = ?', corridaId);
      try {
        elegidas = await generarConPresupuesto({ proveedor, verificador, catalogo, categorias, recientes, fecha, config, detalle, elegidas }, config.ia.presupuestoMs);
        elegidas = new Map(elegidas); // la IA pudo seguir corriendo en segundo plano: se congela lo elegido
      } catch (e) {
        detalle.errorIA = e.message;
      }
    } else if (proveedor) {
      detalle.avisos.push('Se agotaron los intentos de IA para esta fecha.');
    }

    const faltantes = categorias.filter((c) => !elegidas.has(c));
    if (faltantes.length) {
      if (quedanIntentosIA) detalle.avisos.push(`Categorías sin pregunta de IA: ${faltantes.map((c) => CATEGORIAS[c]).join(', ')}.`);
      if (!permitirReserva) {
        await finalizarCorrida(db, corridaId, 'pendiente', detalle, ahora());
        return { resultado: 'pendiente', fecha, corridaId, faltantes };
      }
      const yaElegidas = [...elegidas.values()].map((p) => comoReciente(p, fecha));
      const { elegidas: deReserva, avisos } = elegirDeReserva({ reserva, categorias: faltantes, recientes: [...recientes, ...yaElegidas], usos: await usosDeReserva(db), fecha });
      detalle.avisos.push(...avisos);
      for (const [c, p] of deReserva) elegidas.set(c, p);
    }

    let preguntas = categorias.map((c) => elegidas.get(c)).filter(Boolean);
    let lote = validarLote(preguntas);
    if (!lote.ok && permitirReserva && preguntas.some((p) => p.origen === 'ia')) {
      detalle.avisos.push(`Lote mixto inválido (${lote.errores.join(' ')}); se usa reserva completa.`);
      const { elegidas: deReserva, avisos } = elegirDeReserva({ reserva, categorias, recientes, usos: await usosDeReserva(db), fecha });
      detalle.avisos.push(...avisos);
      preguntas = categorias.map((c) => deReserva.get(c)).filter(Boolean);
      lote = validarLote(preguntas);
    }
    if (!lote.ok) {
      detalle.errorLote = lote.errores;
      await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora());
      return { resultado: 'fallo', fecha, corridaId, errores: lote.errores };
    }

    const deIA = preguntas.filter((p) => p.origen === 'ia').length;
    const origen = deIA === preguntas.length ? 'ia' : deIA === 0 ? 'reserva' : 'mixto';
    const pub = await publicarDesafio(db, { fecha, preguntas, origen, modelo: deIA ? proveedor?.modelo : null, corridaId, ahora: ahora() });
    detalle.publicadas = preguntas.map((p) => ({ categoria: p.categoria, enunciado: p.enunciado, origen: p.origen, respuestas: p.respuestas.length }));
    await finalizarCorrida(db, corridaId, pub.publicado ? `publicado_${origen}` : 'ya_existia', detalle, ahora());
    return pub.publicado
      ? { resultado: 'publicado', fecha, origen, desafioId: pub.desafioId, numero: pub.numero, corridaId }
      : { resultado: 'ya_existia', fecha, corridaId };
  } catch (e) {
    detalle.error = e.stack || e.message;
    await finalizarCorrida(db, corridaId, 'fallo', detalle, ahora()).catch(() => {});
    return { resultado: 'fallo', fecha, corridaId, error: e.message };
  } finally {
    await liberarBloqueo(db, nombreBloqueo, titular).catch(() => {});
  }
}
