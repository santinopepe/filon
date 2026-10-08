// Validación estructural y de consistencia de preguntas (sin IA).
// Detecta: campos faltantes, enunciados subjetivos, rarezas inválidas, respuestas duplicadas,
// variantes contradictorias (la misma forma apunta a dos respuestas), rechazos que chocan con
// respuestas aceptadas, falta de variedad de rarezas, fuentes no permitidas y repeticiones recientes.
import { RAREZAS, CATEGORIAS, ORDEN_RAREZAS, PREGUNTAS_POR_DESAFIO, MODOS, MODO_POR_DEFECTO, VARIEDAD_NORMAL } from './dominio.js';
import { normalizar, formasRegistrables } from './normalizar.js';

export const MIN_RESPUESTAS = 5;
export const MAX_RESPUESTAS = 80;

const PALABRAS_VACIAS = new Set(
  'nombra nombre nombrá menciona escribi decí deci un una uno unos unas de del la el los las lo que en y a al por con para alguien haya hayan sido sea fue algun alguna cualquier se su sus o como mas sobre entre'.split(' '),
);

const PATRONES_SUBJETIVOS = [
  /\b(el|la|los|las|tu|su|sus|tus)\s+(mejor|mejores|peor|peores)\b/,
  /\bfavorit/,
  /\bpreferid/,
  /\bmas\s+(lind|bonit|fe[oa]|important|famos|popular|interesant|divertid|emocionant)/,
  /\bte\s+gust/,
  /\bopinion/,
  /\bque\s+(te|le)\s+parezca/,
];

const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export function esSubjetiva(enunciado) {
  const n = normalizar(enunciado);
  return PATRONES_SUBJETIVOS.some((re) => re.test(n));
}

export function huellaDe(enunciado) {
  const tokens = normalizar(enunciado)
    .split(' ')
    .filter((t) => t.length > 2 && !PALABRAS_VACIAS.has(t));
  return [...new Set(tokens)].sort().join(' ');
}

function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function dominioPermitido(url, dominios) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return dominios.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

/** Lleva una candidata (de la IA o de la reserva) a la forma interna, sin validar. */
export function prepararCandidata(c = {}) {
  const fuentes = (Array.isArray(c.fuentes) ? c.fuentes : [])
    .map((f) => (typeof f === 'string' ? { url: f, titulo: '' } : { url: texto(f?.url), titulo: texto(f?.titulo) }))
    .filter((f) => f.url);
  return {
    id: texto(c.id) || null,
    categoria: texto(c.categoria).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
    enunciado: texto(c.enunciado),
    alcance: texto(c.alcance),
    fuentes,
    respuestas: (Array.isArray(c.respuestas) ? c.respuestas : []).map((r) => ({
      canonica: texto(r?.canonica),
      variantes: (Array.isArray(r?.variantes) ? r.variantes : []).map(texto).filter(Boolean),
      rareza: texto(r?.rareza).toLowerCase(),
      explicacion: texto(r?.explicacion),
      fuente: r?.fuente?.url
        ? { url: texto(r.fuente.url), titulo: texto(r.fuente.titulo) }
        : r?.fuente_url
          ? { url: texto(r.fuente_url), titulo: texto(r.fuente_titulo) }
          : null,
    })),
    rechazos: (Array.isArray(c.rechazos) ? c.rechazos : [])
      .map((x) => ({
        textos: (Array.isArray(x?.textos) ? x.textos : [x?.texto]).map(texto).filter(Boolean),
        motivo: texto(x?.motivo),
      }))
      .filter((x) => x.textos.length && x.motivo),
  };
}

/**
 * Valida una pregunta. Los problemas de una respuesta puntual la descartan (y se informan);
 * los problemas de la pregunta la invalidan entera.
 * Con `estricta`, cualquier descarte o contradicción también invalida (se usa para la reserva).
 * `modo` fija qué categorías valen: las siete de Normal o la única de un modo temático.
 */
export function validarPregunta(entrada, { dominios = [], recientes = [], estricta = false, modo = MODO_POR_DEFECTO, maxRespuestas = MAX_RESPUESTAS } = {}) {
  const p = prepararCandidata(entrada);
  const errores = [];
  const advertencias = [];
  const descartadas = [];
  let contradicciones = 0;

  const permitidas = MODOS[modo].categorias;
  if (!permitidas.includes(p.categoria)) {
    errores.push(
      permitidas.length === 1
        ? `Categoría inválida para ${MODOS[modo].nombre}: «${p.categoria}» (tiene que ser «${permitidas[0]}»).`
        : `Categoría inválida: «${p.categoria}».`,
    );
  }
  if (p.enunciado.length < 12 || p.enunciado.length > 180) errores.push('El enunciado debe tener entre 12 y 180 caracteres.');
  if (p.alcance.length < 8 || p.alcance.length > 260) errores.push('El alcance debe tener entre 8 y 260 caracteres.');
  if (p.enunciado && esSubjetiva(p.enunciado)) errores.push('El enunciado es subjetivo (mejor, favorito, más famoso…).');

  const fuentesValidas = p.fuentes.filter((f) => dominioPermitido(f.url, dominios));
  for (const f of p.fuentes) if (!fuentesValidas.includes(f)) advertencias.push(`Fuente descartada por dominio o protocolo: ${f.url}`);
  if (!fuentesValidas.length) errores.push('La pregunta necesita al menos una fuente https de un dominio permitido.');
  p.fuentes = fuentesValidas.map((f) => ({ url: f.url, titulo: f.titulo || new URL(f.url).hostname }));

  // 1) Respuestas individuales.
  const porCanonica = new Map();
  let candidatas = [];
  for (const r of p.respuestas) {
    const motivos = [];
    if (!r.canonica || r.canonica.length > 90 || !normalizar(r.canonica)) motivos.push('canónica vacía o demasiado larga');
    if (!RAREZAS[r.rareza]) motivos.push(`rareza inválida «${r.rareza}»`);
    if (r.explicacion.length < 8 || r.explicacion.length > 240) motivos.push('explicación ausente o fuera de 8–240 caracteres');
    if (motivos.length) {
      descartadas.push({ canonica: r.canonica || '(vacía)', motivo: motivos.join('; ') });
      continue;
    }
    const clave = normalizar(r.canonica);
    if (porCanonica.has(clave)) {
      const previa = porCanonica.get(clave);
      if (previa.rareza !== r.rareza) {
        contradicciones++;
        descartadas.push({ canonica: r.canonica, motivo: `contradicción: aparece dos veces con rarezas distintas (${previa.rareza} y ${r.rareza})` });
      } else {
        descartadas.push({ canonica: r.canonica, motivo: 'respuesta duplicada' });
      }
      continue;
    }
    let fuente = r.fuente;
    if (fuente && !dominioPermitido(fuente.url, dominios)) {
      advertencias.push(`Fuente de «${r.canonica}» reemplazada por la fuente general: ${fuente.url}`);
      fuente = null;
    }
    const nueva = { ...r, fuente: fuente || p.fuentes[0] || null, clave };
    porCanonica.set(clave, nueva);
    candidatas.push(nueva);
  }

  // 2) Formas registrables y choques entre respuestas.
  const duenios = new Map(); // forma -> Set(clave canónica)
  const formasPorRespuesta = new Map();
  for (const r of candidatas) {
    const formas = new Map(); // forma -> 'principal' | 'derivada'
    for (const t of [r.canonica, ...r.variantes]) {
      formasRegistrables(t).forEach((f, i) => {
        if (!formas.has(f) || i === 0) formas.set(f, i === 0 ? 'principal' : 'derivada');
      });
    }
    formasPorRespuesta.set(r.clave, formas);
    for (const f of formas.keys()) {
      if (!duenios.has(f)) duenios.set(f, new Set());
      duenios.get(f).add(r.clave);
    }
  }
  for (const [forma, claves] of duenios) {
    if (claves.size < 2) continue;
    const lista = [...claves];
    const esCanonicaDe = lista.find((k) => k === forma);
    const tipos = lista.map((k) => formasPorRespuesta.get(k).get(forma));
    if (esCanonicaDe) {
      // La forma es el nombre canónico de una respuesta: se quita como variante de las demás.
      const otrasPrincipales = lista.filter((k) => k !== esCanonicaDe && formasPorRespuesta.get(k).get(forma) === 'principal');
      for (const k of lista) if (k !== esCanonicaDe) formasPorRespuesta.get(k).delete(forma);
      if (otrasPrincipales.length) {
        contradicciones++;
        advertencias.push(`Contradicción: «${forma}» es una respuesta y también variante de otra; se conserva solo como respuesta propia.`);
      }
    } else {
      for (const k of lista) formasPorRespuesta.get(k).delete(forma);
      if (tipos.includes('principal')) {
        contradicciones++;
        advertencias.push(`Contradicción: la variante «${forma}» apuntaba a varias respuestas; se eliminó por ambigua.`);
      } else {
        advertencias.push(`La forma sin artículo «${forma}» era ambigua y no se registró.`);
      }
    }
  }

  // 3) Rechazos conocidos que no pueden chocar con respuestas aceptadas.
  const rechazos = [];
  for (const x of p.rechazos) {
    const formas = [...new Set(x.textos.flatMap((t) => formasRegistrables(t)))];
    const choque = formas.find((f) => duenios.has(f) && [...duenios.get(f)].some((k) => formasPorRespuesta.get(k).has(f)));
    if (choque) {
      contradicciones++;
      advertencias.push(`Contradicción: el rechazo «${x.textos[0]}» coincide con una respuesta válida; se descartó el rechazo.`);
      continue;
    }
    rechazos.push({ textos: x.textos, motivo: x.motivo, formas });
  }

  // 4) Cantidad y variedad de rarezas.
  candidatas = candidatas.filter((r) => formasPorRespuesta.get(r.clave).size > 0);
  const minimo = MIN_RESPUESTAS;
  // Las preguntas editoriales tienen tope 80; el generador por catálogos pasa el suyo (hasta miles).
  const maximo = maxRespuestas;
  if (candidatas.length < minimo) errores.push(`Hacen falta al menos ${minimo} respuestas válidas (hay ${candidatas.length}).`);
  if (candidatas.length > maximo) errores.push(`Demasiadas respuestas (${candidatas.length}); el conjunto debe estar acotado a ${maximo}.`);
  const rarezas = new Set(candidatas.map((r) => r.rareza));
  if (rarezas.size < 3) errores.push('Las respuestas deben repartirse en al menos 3 rarezas distintas.');
  if (!rarezas.has('grava') && !rarezas.has('cobre')) errores.push('Debe haber al menos una respuesta de Grava o Cobre (accesible para cualquiera).');
  // Sin Diamante no se puede llegar al máximo (7 × 100): cada pregunta necesita al menos una.
  if (!rarezas.has('diamante')) errores.push('Debe haber al menos una respuesta Diamante (si no, el puntaje máximo es inalcanzable).');

  const enunciadoNorm = ` ${normalizar(p.enunciado)} `;
  for (const r of candidatas) {
    if (r.clave.length > 3 && enunciadoNorm.includes(` ${r.clave} `)) {
      advertencias.push(`El enunciado menciona una de sus propias respuestas: «${r.canonica}».`);
    }
  }

  // 5) Repeticiones respecto de desafíos recientes.
  const huella = huellaDe(p.enunciado);
  const repeticion = buscarRepeticion({ id: p.id, huella, claves: candidatas.map((r) => r.clave) }, recientes);
  if (repeticion) errores.push(repeticion);

  if (estricta && (descartadas.length || contradicciones)) {
    errores.push(`Validación estricta: ${descartadas.length} respuesta(s) descartada(s) y ${contradicciones} contradicción(es).`);
  }

  const respuestas = candidatas
    .map((r) => ({
      canonica: r.canonica,
      variantes: r.variantes,
      rareza: r.rareza,
      puntos: RAREZAS[r.rareza].puntos,
      explicacion: r.explicacion,
      fuente: r.fuente,
      formas: [...formasPorRespuesta.get(r.clave).keys()],
    }))
    .sort((a, b) => ORDEN_RAREZAS.indexOf(a.rareza) - ORDEN_RAREZAS.indexOf(b.rareza));

  return {
    ok: errores.length === 0,
    errores,
    advertencias,
    descartadas,
    contradicciones,
    pregunta: { ...p, huella, respuestas, rechazos },
  };
}

/**
 * Indica si una pregunta repite (por enunciado o por conjunto de respuestas) alguna reciente.
 * `p` = { id?, huella, claves: [canónicas normalizadas] }. Devuelve el motivo o null.
 */
export function buscarRepeticion(p, recientes) {
  const tokens = new Set((p.huella || '').split(' ').filter(Boolean));
  const claves = new Set(p.claves || []);
  for (const rec of recientes) {
    if (p.id && rec.reservaId && p.id === rec.reservaId) return `La misma pregunta de reserva se usó el ${rec.fecha}.`;
    const simEnunciado = jaccard(tokens, new Set((rec.huella || '').split(' ').filter(Boolean)));
    const simRespuestas = jaccard(claves, new Set(rec.claves || []));
    if (simEnunciado >= 0.6 || simRespuestas >= 0.5) return `Se parece demasiado a una pregunta del ${rec.fecha}: «${rec.enunciado}».`;
  }
  return null;
}

/**
 * Valida el lote completo de un día (después de validar cada pregunta).
 * Normal: siete preguntas variadas (ninguna categoría más de dos veces y al menos cuatro distintas).
 * Temáticos: las siete de la categoría del modo.
 */
export function validarLote(preguntas, modo = MODO_POR_DEFECTO) {
  const errores = [];
  if (preguntas.length !== PREGUNTAS_POR_DESAFIO) errores.push(`El lote debe tener ${PREGUNTAS_POR_DESAFIO} preguntas (tiene ${preguntas.length}).`);
  const permitidas = MODOS[modo].categorias;
  const cats = new Set(preguntas.map((p) => p.categoria));
  if (modo === MODO_POR_DEFECTO) {
    for (const c of cats) {
      if (!permitidas.includes(c)) errores.push(`Categoría inválida: «${c}».`);
      const veces = preguntas.filter((p) => p.categoria === c).length;
      if (veces > VARIEDAD_NORMAL.maxPorCategoria) errores.push(`Hay ${veces} preguntas de ${CATEGORIAS[c] ?? c}: el máximo es ${VARIEDAD_NORMAL.maxPorCategoria}.`);
    }
    if (cats.size < VARIEDAD_NORMAL.minCategorias) errores.push(`El lote necesita al menos ${VARIEDAD_NORMAL.minCategorias} categorías distintas (tiene ${cats.size}).`);
  } else {
    for (const c of cats) if (!permitidas.includes(c)) errores.push(`${MODOS[modo].nombre} solo admite preguntas de la categoría «${permitidas[0]}» (llegó «${c}»).`);
  }
  for (let i = 0; i < preguntas.length; i++) {
    for (let j = i + 1; j < preguntas.length; j++) {
      const a = preguntas[i];
      const b = preguntas[j];
      if (normalizar(a.enunciado) === normalizar(b.enunciado)) errores.push(`Enunciado duplicado: «${a.enunciado}».`);
      const sim = jaccard(
        a.respuestas.map((r) => normalizar(r.canonica)),
        b.respuestas.map((r) => normalizar(r.canonica)),
      );
      if (sim >= 0.5) errores.push(`Dos preguntas comparten casi las mismas respuestas: «${a.enunciado}» y «${b.enunciado}».`);
    }
  }
  return { ok: errores.length === 0, errores };
}
