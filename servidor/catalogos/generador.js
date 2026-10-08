// Generador de desafíos por catálogos, sin IA: arma preguntas a partir de catálogos verificados
// (datos/catalogos/) y plantillas declarativas (datos/plantillas.json). Es una función pura: recibe los
// datos, el historial y la semilla, y devuelve el lote, lo que se descartó y por qué. Con la misma semilla,
// fecha, versiones e historial, el resultado es el mismo.
import { createHash } from 'node:crypto';
import { generadorConSemilla } from '../azar.js';
import { CATEGORIAS, CATEGORIAS_NORMAL, PREGUNTAS_POR_DESAFIO, VARIEDAD_NORMAL } from '../dominio.js';
import { formasRegistrables, normalizar } from '../normalizar.js';
import { validarPregunta } from '../validacion.js';
import { validarFiltro, evaluar, describir, explicarFalla, claveDeFiltro, VERSION_FILTROS } from './filtros.js';
import { combinaciones, instanciar } from './plantillas.js';
import { VERSION_TEXTO } from './texto.js';
import { dentroDeVentana } from '../tiempo.js';
import { versionDeCatalogos } from './catalogos.js';

export const VERSION_GENERADOR = '2';
const QUINTILES = ['grava', 'cobre', 'plata', 'oro', 'diamante'];
const CENTRO = { facil: 0.2, media: 0.45, dificil: 0.7 };
const MINHASH = 64;
const sha = (texto) => createHash('sha256').update(texto).digest('hex');

export const POR_OMISION = Object.freeze({
  maxRespuestas: 15_000, // tope global de respuestas de una pregunta generada
  diasSinRepetir: 60, // ventana de repetición en días calendario: a 59 se rechaza, a 60 se permite
  diasFamiliaReciente: 3, // ventana corta: se prefieren familias que no salieron hace poco
  solapamientoParecido: 0.9, // desde acá, un conjunto muy parecido a uno reciente del mismo catálogo pierde preferencia (no se bloquea)
  solapamientoManual: 0.9, // con preguntas manuales o de reserva (sin condición), bloquea solo si las respuestas son casi las mismas
  candidatosPorPlantilla: 6,
  intentosPorPlantilla: 60, // muestra por día de las plantillas enormes (Gramática)
  intentosTotales: 1500,
  maxRechazos: 150,
  maxPorFamilia: 1,
  // Topes por categoría más bajos que el general (Gramática: una por día, para que el lote sea variado).
  maxPorCategoria: { gramatica: 1 },
});

/**
 * Reglas del lote de cada modo con generador. Normal: siete preguntas generales, variadas por categoría.
 * Geografía: siete de geografía, variadas por familia y por catálogo. Los demás modos no tienen generador.
 */
export const REGLAS_LOTE = Object.freeze({
  normal: { categorias: CATEGORIAS_NORMAL, minCategorias: VARIEDAD_NORMAL.minCategorias, maxPorCategoria: VARIEDAD_NORMAL.maxPorCategoria, maxPorCatalogo: 2 },
  // Geografía: se prefieren como mucho 3 de las 7 con condiciones sobre las letras del nombre (empieza,
  // termina, tiene…) y nunca más de 5, para que el día no sea un juego de palabras.
  geografia: { categorias: ['geografia'], minCategorias: 1, maxPorCategoria: PREGUNTAS_POR_DESAFIO, maxPorCatalogo: 3, letrasPreferidas: 3, maxDeLetras: 5 },
});

// ───── Utilidades ─────

function fnv32(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Firma MinHash de un conjunto de ids: estima el solapamiento sin guardar los conjuntos enteros. */
export function minhash(ids) {
  const firma = new Array(MINHASH).fill(0xffffffff);
  for (const id of ids) for (let k = 0; k < MINHASH; k++) firma[k] = Math.min(firma[k], fnv32(`${k}:${id}`));
  return firma;
}
export const jaccardEstimado = (a, b) => (a && b ? a.filter((x, i) => x === b[i]).length / MINHASH : 0);

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return A.size + B.size - inter ? inter / (A.size + B.size - inter) : 0;
}

const nivel = (d) => (d < 0.35 ? 'facil' : d < 0.6 ? 'media' : 'dificil');

/**
 * Dificultad estimada (0–1), una política editorial y no una estadística de jugadores: parte de la
 * dificultad declarada de la plantilla y suma si hasta las respuestas más conocidas del conjunto son
 * poco conocidas dentro de su catálogo, si hay más de una condición y si el conjunto es chico. Un conjunto
 * grande no la baja por sí solo: importa qué tan conocidas son sus mejores respuestas.
 */
function estimarDificultad(plantilla, catalogo, entidades, filtro) {
  const percentiles = entidades.map((e) => catalogo.percentil(e)).sort((a, b) => b - a);
  const top = percentiles.slice(0, 5);
  const conocimiento = top.reduce((s, x) => s + x, 0) / top.length;
  const d = plantilla.dificultad + 0.4 * (1 - conocimiento) + 0.1 * Math.max(0, filtro.y.length - 1) + (entidades.length < 8 ? 0.1 : 0);
  const valor = Math.round(Math.min(1, Math.max(0, d)) * 100) / 100;
  return { valor, nivel: nivel(valor) };
}

/**
 * Rareza por popularidad relativa dentro del conjunto (política explícita y reproducible): se ordenan las
 * respuestas por popularidad (empates por id) y se reparten en quintiles: el 20 % más conocido es Grava y
 * el 20 % menos conocido, Diamante. Con 5 o más respuestas hay de las cinco rarezas.
 */
export function asignarRarezas(entidades) {
  const orden = [...entidades].sort((a, b) => b.popularidad - a.popularidad || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(orden.map((e, i) => [e.id, QUINTILES[Math.min(4, Math.floor((i * 5) / orden.length))]]));
}

/** ¿El catálogo cubre lo que promete el filtro? Devuelve el motivo si no alcanza, o null. */
export function problemaDeCobertura(catalogo, filtro) {
  for (const c of filtro.y) {
    if (c.campo !== 'nombre' && !catalogo.completos.has(c.campo)) return `al atributo «${c.campo}» le faltan datos en algunas entidades`;
  }
  const cob = catalogo.cobertura;
  if (cob.tipo === 'completa') return null;
  if (cob.completoPor && filtro.y.some((c) => c.op === 'es' && c.campo === cob.completoPor && c.valores.length === 1)) return null;
  for (const tramo of cob.completoEn ?? []) {
    if (filtro.y.some((c) => c.op === 'entre' && c.campo === tramo.campo && c.desde >= tramo.desde && c.hasta <= tramo.hasta)) return null;
  }
  return `el catálogo es parcial (${cob.criterio}) y la condición sale de lo que tiene completo`;
}

function llenarExplicacion(molde, e) {
  const texto = molde
    .replace(/\{(\w+)\}/g, (_, k) => {
      const v = k === 'nombre' ? e.nombre : e.atributos[k];
      if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return 'sin dato en la fuente';
      return Array.isArray(v) ? v.join(', ') : String(v);
    })
    .replace(/\s+/g, ' ')
    .trim();
  return texto.length > 240 ? `${texto.slice(0, 237)}…` : texto;
}

// ───── Repeticiones ─────

/**
 * Firma semántica de una consigna: el catálogo y la condición canónica. No depende del id ni de la
 * familia de la plantilla, de la versión del catálogo ni de la redacción: renombrar una plantilla,
 * reimportar los datos o cambiar el texto no permite repetir una consigna dentro de la ventana.
 */
export const firmaDe = (catalogoId, filtro) => sha(JSON.stringify({ catalogo: catalogoId, filtro: claveDeFiltro(filtro) })).slice(0, 32);
const conjuntoDe = (catalogoId, ids) => sha(`${catalogoId}|${[...ids].sort().join('\u0001')}`).slice(0, 32);

/**
 * Motivo por el que un candidato es la misma consigna que un registro (del historial dentro de la ventana
 * o del propio lote), o null. Son equivalentes si tienen la misma firma (misma condición) o exactamente el
 * mismo conjunto de respuestas del mismo catálogo (condiciones distintas que dicen lo mismo con estos
 * datos). Compartir muchas respuestas no las hace equivalentes: eso solo baja la preferencia (ver
 * `solapamiento`). La ventana la aplica quien arma los registros.
 */
export function repeticion(candidato, registros) {
  for (const r of registros) {
    const cuando = r.fecha ? `el ${r.fecha}` : 'en este lote';
    if (r.firma && r.firma === candidato.firma) return `misma consigna que ${cuando}`;
    if (r.conjunto && r.conjunto === candidato.conjunto) return `mismo conjunto de respuestas que ${cuando}`;
  }
  return null;
}

/** Mayor solapamiento estimado (Jaccard por MinHash) con registros del mismo catálogo. */
function solapamiento(candidato, registros) {
  let maximo = 0;
  for (const r of registros) if (r.minhash && r.catalogo === candidato.catalogo.id) maximo = Math.max(maximo, jaccardEstimado(r.minhash, candidato.minhash));
  return maximo;
}

// ───── Candidatos ─────
/**
 * ¿Dos respuestas del conjunto se escriben igual? («Capital» de Mendoza y de San Juan.) Con nombres que se
 * repiten en el catálogo pero no dentro del conjunto, la pregunta no es ambigua: cada forma aceptada lleva
 * a una sola respuesta, y las homónimas de afuera no se usan como rechazo.
 */
/** ¿La consigna pone condiciones sobre las letras del nombre? */
const deLetras = (c) => c.filtro.y.some((x) => x.campo === 'nombre');

function nombresRepetidos(entidades) {
  const vistas = new Map();
  for (const e of entidades) {
    for (const f of formasRegistrables(e.nombre)) {
      if (vistas.has(f) && vistas.get(f) !== e.id) return true;
      vistas.set(f, e.id);
    }
  }
  return false;
}


// Candidatos preparados por plantilla y versión del catálogo: se calculan una vez por proceso (no en cada
// día ni en cada intento). Las plantillas enormes (combinaciones × entidades) se muestrean por día.
const preparados = new Map();
const LIMITE_EVALUACIONES = 3_000_000;

/**
 * Todos los candidatos utilizables de una plantilla: filtro válido, tamaño en rango, catálogo que lo cubre
 * y nombres sin ambigüedad (con `validar`, además, que la pregunta pase la validación). Devuelve
 * { candidatos, combinaciones, descartes: { motivo: cantidad } }. Con `completo: false` y una plantilla
 * enorme, evalúa una muestra de `intentos` combinaciones en el orden de `semilla`.
 */
export function prepararCandidatos(plantilla, catalogo, { dominios = [], maxRespuestas = POR_OMISION.maxRespuestas, validar = false, completo = false, semilla = '', intentos = POR_OMISION.intentosPorPlantilla } = {}) {
  const combos = combinaciones(plantilla, catalogo);
  const enorme = combos.length * catalogo.entidades.length > LIMITE_EVALUACIONES;
  const clave = `${catalogo.id}@${catalogo.version}|${JSON.stringify(plantilla)}|${maxRespuestas}|${validar}`;
  if (!enorme || completo) {
    const guardado = preparados.get(clave);
    if (guardado) return guardado;
  }
  let lista = combos;
  if (enorme && !completo) {
    const azar = generadorConSemilla(`${semilla}|muestra|${plantilla.id}`);
    lista = [...combos];
    for (let i = lista.length - 1; i > 0; i--) {
      const j = Math.floor(azar() * (i + 1));
      [lista[i], lista[j]] = [lista[j], lista[i]];
    }
    lista = lista.slice(0, intentos);
  }
  const candidatos = [];
  const descartes = {};
  const descartar = (motivo) => (descartes[motivo] = (descartes[motivo] ?? 0) + 1);
  const max = Math.min(plantilla.respuestas.max, maxRespuestas);
  const vistos = new Set();
  for (const combo of lista) {
    const { ok, filtro } = validarFiltro(instanciar(plantilla.filtro, combo.valores), catalogo);
    if (!ok) {
      descartar('filtro inválido');
      continue;
    }
    const firma = firmaDe(catalogo.id, filtro);
    if (vistos.has(firma)) continue; // la misma condición desde otra combinación
    vistos.add(firma);
    const entidades = catalogo.entidades.filter((e) => evaluar(filtro, e));
    if (entidades.length < plantilla.respuestas.min || entidades.length > max) {
      descartar(entidades.length < plantilla.respuestas.min ? 'pocas respuestas' : 'demasiadas respuestas');
      continue;
    }
    if (problemaDeCobertura(catalogo, filtro)) {
      descartar('cobertura insuficiente');
      continue;
    }
    if (nombresRepetidos(entidades)) {
      descartar('nombres ambiguos');
      continue;
    }
    const c = {
      plantilla,
      catalogo,
      familia: plantilla.familia,
      categoria: plantilla.categoria,
      valores: combo.valores,
      filtro,
      enunciado: describir(filtro, plantilla, combo.vistas),
      entidades,
      firma,
      conjunto: conjuntoDe(catalogo.id, entidades.map((e) => e.id)),
      dificultad: estimarDificultad(plantilla, catalogo, entidades, filtro),
    };
    if (validar && !armarPregunta(c, { dominios, opciones: { ...POR_OMISION, maxRespuestas }, modo: 'normal', semilla: '', versiones: {} }).ok) {
      descartar('no pasa la validación');
      continue;
    }
    candidatos.push(c);
  }
  const r = { candidatos, combinaciones: combos.length, descartes, muestra: enorme && !completo };
  if (!r.muestra) preparados.set(clave, r);
  return r;
}

/** Arma y valida la pregunta de un candidato (mismo validador y formato que la carga manual). */
function armarPregunta(c, ctx) {
  const rarezas = asignarRarezas(c.entidades);
  const fuentes = c.catalogo.fuentes.map((f) => ({ url: f.url, titulo: f.nombre }));
  const respuestas = c.entidades.map((e) => ({
    canonica: e.nombre,
    variantes: e.alias,
    rareza: rarezas.get(e.id),
    explicacion: llenarExplicacion(c.plantilla.explicacion, e),
    fuente: e.fuente ? { url: e.fuente, titulo: fuentes[0].titulo } : null,
  }));
  // Rechazos con motivo: las entidades más conocidas del catálogo que no cumplen la condición, explicadas
  // desde el mismo filtro («su nombre termina en «U»»). Nunca chocan con una respuesta válida.
  const rechazos = [];
  if (c.plantilla.rechazos) {
    const formasValidas = new Set(c.entidades.flatMap((e) => [e.nombre, ...e.alias].flatMap(formasRegistrables)));
    const etiquetas = Object.fromEntries(Object.entries(c.catalogo.atributos ?? {}).map(([k, a]) => [k, a.etiqueta]));
    etiquetas.nombre = { 'cuyo título': 'título', que: '' }[c.plantilla.sujetos.nombre] ?? 'nombre';
    if (c.plantilla.sujetos.simbolo) etiquetas.simbolo = 'símbolo';
    const dentro = new Set(c.entidades.map((e) => e.id));
    const fuera = c.catalogo.entidades
      .filter((e) => !dentro.has(e.id) && !e.ambigua)
      .sort((a, b) => b.popularidad - a.popularidad || (a.id < b.id ? -1 : 1));
    for (const e of fuera) {
      if (rechazos.length >= ctx.opciones.maxRechazos) break;
      const textos = [e.nombre, ...e.alias].filter((t) => !formasRegistrables(t).some((f) => formasValidas.has(f)));
      const motivo = explicarFalla(c.filtro, e, etiquetas);
      if (textos.length && motivo) rechazos.push({ textos, motivo });
    }
  }
  const v = validarPregunta(
    { categoria: c.categoria, enunciado: c.enunciado, alcance: c.plantilla.alcance, fuentes, respuestas, rechazos },
    { dominios: ctx.dominios, estricta: true, modo: ctx.modo, maxRespuestas: Math.min(c.plantilla.respuestas.max, ctx.opciones.maxRespuestas) },
  );
  if (!v.ok) return { ok: false, errores: v.errores };
  return {
    ok: true,
    pregunta: {
      ...v.pregunta,
      origen: 'catalogo',
      coincidencia: c.plantilla.coincidencia,
      firma: c.firma,
      conjunto: c.conjunto,
      generacion: {
        generador: 'catalogos',
        version: VERSION_GENERADOR,
        plantilla: c.plantilla.id,
        familia: c.familia,
        catalogo: { id: c.catalogo.id, version: c.catalogo.version },
        filtro: c.filtro,
        parametros: c.valores,
        semilla: ctx.semilla,
        versiones: ctx.versiones,
        dificultad: c.dificultad,
        respuestas: c.entidades.length,
        minhash: c.minhash,
      },
    },
  };
}

// ───── Lote ─────

/**
 * Genera el lote del día. `historial`: preguntas generadas recientes ({ fecha, firma, conjunto, familia,
 * catalogo, minhash }); `recientes`: las demás preguntas recientes ({ fecha, enunciado, claves }).
 * Devuelve { ok, preguntas, elegidas, descartes, semilla, versiones, errores }.
 */
export function generarLote({ catalogos, plantillas, fecha, modo = 'normal', semillaBase = 'filon', historial = [], recientes = [], dominios = [], opciones = {}, limite = PREGUNTAS_POR_DESAFIO }) {
  const reglas = REGLAS_LOTE[modo];
  if (!reglas) throw new Error(`El modo «${modo}» no tiene generador por catálogos.`);
  const op = { ...POR_OMISION, maxPorCatalogo: reglas.maxPorCatalogo, ...opciones };
  const versiones = { plantillas: plantillas.version, filtros: VERSION_FILTROS, texto: VERSION_TEXTO, generador: VERSION_GENERADOR, catalogos: versionDeCatalogos(catalogos) };
  const semilla = sha(`${semillaBase}|${fecha}|${modo}|${JSON.stringify(versiones)}`).slice(0, 16);
  const ctx = { semilla, versiones, modo, dominios, opciones: op };
  const azar = generadorConSemilla(semilla);
  const descartes = [];
  const descartar = (plantilla, enunciado, motivo) => descartes.push({ plantilla, enunciado: enunciado ?? null, motivo });

  // 1) Candidatos de cada plantilla que no repiten una consigna dentro de la ventana (en días calendario,
  // hacia atrás y hacia adelante: a 59 días se rechaza, a 60 se permite).
  const enVentana = (r) => !r.fecha || dentroDeVentana(fecha, r.fecha, op.diasSinRepetir);
  const historialVentana = historial.filter(enVentana);
  const recientesVentana = recientes.filter(enVentana);
  const pool = [];
  for (const p of plantillas.lista.filter((x) => reglas.categorias.includes(x.categoria) && (!x.modos || x.modos.includes(modo)))) {
    const catalogo = catalogos.get(p.catalogo);
    if (!catalogo) {
      descartar(p.id, null, `falta el catálogo «${p.catalogo}» (importalo con npm run importar-catalogos)`);
      continue;
    }
    const preparado = prepararCandidatos(p, catalogo, { dominios, maxRespuestas: op.maxRespuestas, semilla, intentos: op.intentosPorPlantilla });
    for (const [motivo, n] of Object.entries(preparado.descartes)) descartes.push({ plantilla: p.id, enunciado: null, motivo, cantidad: n });
    const frescos = [];
    for (const c of preparado.candidatos) {
      const motivo = repeticion(c, historialVentana);
      if (motivo) descartar(p.id, c.enunciado, `repetida: ${motivo}`);
      else frescos.push(c);
    }
    // Orden reproducible (semilla del día y plantilla); los candidatos preparados no se modifican.
    const azarPlantilla = generadorConSemilla(`${semilla}|${p.id}`);
    for (let i = frescos.length - 1; i > 0; i--) {
      const j = Math.floor(azarPlantilla() * (i + 1));
      [frescos[i], frescos[j]] = [frescos[j], frescos[i]];
    }
    for (const c of frescos.slice(0, op.candidatosPorPlantilla)) pool.push({ ...c, sorteo: azarPlantilla(), usado: false });
  }
  const minhashDe = (c) => (c.minhash ??= minhash(c.entidades.map((e) => e.id)));

  // 2) Siete preguntas variadas: dificultades mezcladas, sin repetir familia, con tope por categoría y
  // por catálogo y al menos `minCategorias` categorías distintas.
  const objetivos = ['facil', 'facil', 'media', 'media', 'media', 'dificil', azar() < 0.5 ? 'media' : 'dificil'];
  for (let i = objetivos.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [objetivos[i], objetivos[j]] = [objetivos[j], objetivos[i]];
  }
  const familiasRecientes = new Set(historial.filter((h) => h.fecha && dentroDeVentana(fecha, h.fecha, op.diasFamiliaReciente + 1)).map((h) => h.familia));
  const elegidas = [];
  let intentos = 0;
  for (let slot = 0; slot < limite && intentos < op.intentosTotales; slot++) {
    const categorias = new Set(elegidas.map((e) => e.candidato.categoria));
    const faltanCategorias = reglas.minCategorias - categorias.size;
    const exigirNueva = faltanCategorias > 0 && limite - slot <= faltanCategorias;
    const objetivo = CENTRO[objetivos[slot % objetivos.length]];
    const sobranLetras = reglas.letrasPreferidas !== undefined && elegidas.filter((e) => deLetras(e.candidato)).length >= reglas.letrasPreferidas;
    // Preferencias (no bloqueos): dificultad cercana al objetivo, consignas conocidas, familias que no
    // salieron hace poco y conjuntos que no se parezcan mucho a uno reciente del mismo catálogo.
    const puntaje = (c) =>
      Math.abs(c.dificultad.valor - objetivo) - 0.06 * c.plantilla.prioridad + (familiasRecientes.has(c.familia) ? 0.3 : 0) + (solapamiento({ ...c, minhash: minhashDe(c) }, historialVentana) >= op.solapamientoParecido ? 0.3 : 0) + (sobranLetras && deLetras(c) ? 0.4 : 0) + 0.1 * c.sorteo;
    const ordenados = pool.filter((c) => !c.usado).sort((a, b) => puntaje(a) - puntaje(b));
    for (const c of ordenados) {
      if (++intentos > op.intentosTotales) break;
      const porCategoria = elegidas.filter((e) => e.candidato.categoria === c.categoria).length;
      if (porCategoria >= (op.maxPorCategoria[c.categoria] ?? reglas.maxPorCategoria)) continue;
      if (exigirNueva && categorias.has(c.categoria)) continue;
      if (elegidas.filter((e) => e.candidato.familia === c.familia).length >= op.maxPorFamilia) continue;
      if (elegidas.filter((e) => e.candidato.catalogo.id === c.catalogo.id).length >= op.maxPorCatalogo) continue;
      if (reglas.maxDeLetras !== undefined && deLetras(c) && elegidas.filter((e) => deLetras(e.candidato)).length >= reglas.maxDeLetras) continue;
      const enLote = repeticion(c, elegidas.map((e) => ({ firma: e.candidato.firma, conjunto: e.candidato.conjunto })));
      if (enLote) {
        c.usado = true;
        descartar(c.plantilla.id, c.enunciado, `repetida: ${enLote}`);
        continue;
      }
      const claves = c.entidades.map((e) => normalizar(e.nombre));
      // Preguntas cargadas a mano o de la reserva: no tienen condición, así que la única evidencia de que
      // son la misma consigna es que tengan prácticamente las mismas respuestas.
      const parecida = recientesVentana.find((r) => r.claves?.length && jaccard(claves, r.claves) >= op.solapamientoManual);
      if (parecida) {
        c.usado = true;
        descartar(c.plantilla.id, c.enunciado, `repetida: casi el mismo conjunto que «${parecida.enunciado}» (${parecida.fecha})`);
        continue;
      }
      const enLoteNombres = elegidas.find((e) => jaccard(claves, e.claves) >= 0.5);
      if (enLoteNombres) {
        c.usado = true;
        descartar(c.plantilla.id, c.enunciado, `comparte la mitad de las respuestas con «${enLoteNombres.candidato.enunciado}»`);
        continue;
      }
      minhashDe(c);
      const armada = armarPregunta(c, ctx);
      c.usado = true;
      if (!armada.ok) {
        descartar(c.plantilla.id, c.enunciado, `no pasó la validación: ${armada.errores.join(' ')}`);
        continue;
      }
      elegidas.push({ candidato: c, pregunta: armada.pregunta, claves });
      break;
    }
  }

  const errores = [];
  if (elegidas.length < limite) errores.push(`Solo se armaron ${elegidas.length} de ${limite} preguntas con los catálogos disponibles.`);
  return {
    ok: elegidas.length === limite,
    preguntas: elegidas.map((e) => e.pregunta),
    elegidas: elegidas.map(({ candidato: c, pregunta: p }) => ({
      plantilla: c.plantilla.id,
      familia: c.familia,
      categoria: c.categoria,
      nombreCategoria: CATEGORIAS[c.categoria],
      enunciado: c.enunciado,
      respuestas: p.respuestas.length,
      rechazos: p.rechazos.length,
      dificultad: c.dificultad,
      catalogo: `${c.catalogo.id}@${c.catalogo.version}`,
      fuentes: c.catalogo.fuentes.map((f) => `${f.nombre} (${f.licencia})`),
      coincidencia: c.plantilla.coincidencia,
      ejemplos: [...p.respuestas].sort((a, b) => b.puntos - a.puntos).slice(0, 3).map((r) => `${r.canonica} (${r.rareza})`),
    })),
    descartes,
    semilla,
    versiones,
    errores,
  };
}
