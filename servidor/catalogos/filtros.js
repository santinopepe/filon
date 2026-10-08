// Filtros declarativos del generador por catálogos. Una plantilla describe su condición con un objeto de
// datos (nunca código, SQL ni expresiones): una conjunción («y») de hasta tres condiciones con operadores
// de una lista cerrada y parámetros validados. De la misma condición salen las respuestas (evaluar) y el
// enunciado (describir); `interpretar` lee el enunciado de vuelta, y las pruebas comprueban que da la
// misma condición y el mismo conjunto.
import { normalizar } from '../normalizar.js';
import { ALFABETO, rasgos, mascaraDe, textoNormal } from './texto.js';

export const VERSION_FILTROS = '1';

// Operadores permitidos: sobre qué tipo de campo se aplican y qué parámetros aceptan.
const SOBRE_TEXTO = ['nombre', 'texto'];
const OPERADORES = {
  empieza: { campos: SOBRE_TEXTO, parametros: ['textos', 'no'] },
  termina: { campos: SOBRE_TEXTO, parametros: ['textos', 'no'] },
  tiene: { campos: SOBRE_TEXTO, parametros: ['letras', 'no'] },
  contiene: { campos: SOBRE_TEXTO, parametros: ['texto', 'no'] },
  letras: { campos: SOBRE_TEXTO, parametros: ['min', 'max'] },
  palabras: { campos: SOBRE_TEXTO, parametros: ['min', 'max'] },
  es: { campos: ['texto', 'lista'], parametros: ['valores'] },
  entre: { campos: ['numero', 'lista_numeros'], parametros: ['desde', 'hasta'] },
};
const ORDEN = Object.keys(OPERADORES);
const MAX_CONDICIONES = 3;
const coleccion = new Intl.Collator('es');

const tipoDeCampo = (campo, catalogo) => (campo === 'nombre' ? 'nombre' : catalogo.atributos?.[campo]?.tipo);
const esEntero = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const letraValida = (l) => typeof l === 'string' && ALFABETO.includes(textoNormal(l)) && textoNormal(l).length === 1;
const textoValido = (t, max) => typeof t === 'string' && /^\p{L}+$/u.test(t) && textoNormal(t).length >= 1 && textoNormal(t).length <= max;

/** Lleva un filtro a la forma { y: [condiciones] } sin validar. */
const comoConjuncion = (f) => (f && Array.isArray(f.y) ? f : { y: [f] });

/**
 * Valida un filtro contra un catálogo. Devuelve { ok, errores, filtro } con el filtro en forma canónica:
 * condiciones ordenadas, parámetros normalizados y sin valores por omisión. Dos filtros equivalentes
 * (mismas condiciones en otro orden, letras en otro orden, «A» y «a») tienen la misma forma canónica.
 */
export function validarFiltro(entrada, catalogo) {
  const errores = [];
  const filtro = comoConjuncion(entrada);
  const extra = Object.keys(filtro).filter((k) => k !== 'y');
  if (extra.length) errores.push(`Claves no permitidas: ${extra.join(', ')}.`);
  // Sin condiciones = todo el catálogo (solo para plantillas que lo declaran con «todos»).
  if (!Array.isArray(filtro.y) || filtro.y.length > MAX_CONDICIONES) errores.push(`Hasta ${MAX_CONDICIONES} condiciones.`);
  const valoresDe = (campo) => catalogo.valores?.get(campo) ?? new Set();
  const canonicas = [];
  for (const c of filtro.y) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      errores.push('Condición inválida.');
      continue;
    }
    const def = OPERADORES[c.op];
    if (!def) {
      errores.push(`Operador no permitido: «${c.op}».`);
      continue;
    }
    const sobrantes = Object.keys(c).filter((k) => k !== 'op' && k !== 'campo' && !def.parametros.includes(k));
    if (sobrantes.length) errores.push(`«${c.op}» no acepta: ${sobrantes.join(', ')}.`);
    const tipo = tipoDeCampo(c.campo, catalogo);
    if (!tipo || !def.campos.includes(tipo)) {
      errores.push(`«${c.op}» no se aplica al campo «${c.campo}».`);
      continue;
    }
    const k = { op: c.op, campo: c.campo };
    if (c.no !== undefined && typeof c.no !== 'boolean') errores.push('«no» tiene que ser verdadero o falso.');
    if (c.no) k.no = true;
    switch (c.op) {
      case 'empieza':
      case 'termina':
        if (!Array.isArray(c.textos) || !c.textos.length || c.textos.length > 3 || !c.textos.every((t) => textoValido(t, 4))) errores.push(`«${c.op}»: de 1 a 3 textos de hasta 4 letras.`);
        else k.textos = [...new Set(c.textos.map(textoNormal))].sort();
        break;
      case 'tiene':
        if (!Array.isArray(c.letras) || !c.letras.length || c.letras.length > 5 || !c.letras.every(letraValida)) errores.push('«tiene»: de 1 a 5 letras.');
        else k.letras = [...new Set(c.letras.map(textoNormal))].sort((a, b) => ALFABETO.indexOf(a) - ALFABETO.indexOf(b));
        break;
      case 'contiene':
        if (!textoValido(c.texto, 5) || textoNormal(c.texto).length < 2) errores.push('«contiene»: una secuencia de 2 a 5 letras.');
        else k.texto = textoNormal(c.texto);
        break;
      case 'letras':
      case 'palabras': {
        const tope = c.op === 'letras' ? 40 : 10;
        if (c.min !== undefined && !esEntero(c.min, 1, tope)) errores.push(`«${c.op}»: mínimo entre 1 y ${tope}.`);
        if (c.max !== undefined && !esEntero(c.max, 1, tope)) errores.push(`«${c.op}»: máximo entre 1 y ${tope}.`);
        if (c.min === undefined && c.max === undefined) errores.push(`«${c.op}»: hace falta un mínimo o un máximo.`);
        if (c.min !== undefined && c.max !== undefined && c.min > c.max) errores.push(`«${c.op}»: el mínimo supera al máximo.`);
        if (c.min !== undefined) k.min = c.min;
        if (c.max !== undefined) k.max = c.max;
        break;
      }
      case 'es': {
        const posibles = valoresDe(c.campo);
        if (!Array.isArray(c.valores) || !c.valores.length || c.valores.length > 4) errores.push('«es»: de 1 a 4 valores.');
        else if (!c.valores.every((v) => typeof v === 'string' && posibles.has(v))) errores.push(`«es»: valores que no existen en «${c.campo}».`);
        else k.valores = [...new Set(c.valores)].sort(coleccion.compare);
        break;
      }
      case 'entre':
        if (!esEntero(c.desde, -5000, 3000) || !esEntero(c.hasta, -5000, 3000) || c.desde > c.hasta) errores.push('«entre»: un rango de enteros con desde ≤ hasta.');
        else Object.assign(k, { desde: c.desde, hasta: c.hasta });
        break;
    }
    canonicas.push(k);
  }
  const clave = (c) => `${ORDEN.indexOf(c.op)}|${c.campo}|${JSON.stringify(c)}`;
  canonicas.sort((a, b) => (clave(a) < clave(b) ? -1 : 1));
  if (new Set(canonicas.map((c) => JSON.stringify(c))).size !== canonicas.length) errores.push('Condiciones repetidas.');
  return { ok: errores.length === 0, errores, filtro: { y: canonicas } };
}

/** Clave canónica (texto) de un filtro ya validado: base de la firma semántica. */
export const claveDeFiltro = (filtro) => JSON.stringify(filtro.y);

// ───── Evaluación ─────

function rasgosDe(entidad, campo) {
  entidad._rasgos ??= {};
  return (entidad._rasgos[campo] ??= rasgos(campo === 'nombre' ? entidad.nombre : String(entidad.atributos?.[campo] ?? '')));
}

function cumple(c, entidad) {
  let r;
  switch (c.op) {
    case 'empieza':
      r = c.textos.some((t) => rasgosDe(entidad, c.campo).forma.startsWith(t));
      break;
    case 'termina':
      r = c.textos.some((t) => rasgosDe(entidad, c.campo).forma.endsWith(t));
      break;
    case 'tiene': {
      const m = mascaraDe(c.letras);
      r = (rasgosDe(entidad, c.campo).mascara & m) === m;
      break;
    }
    case 'contiene':
      r = rasgosDe(entidad, c.campo).forma.includes(c.texto);
      break;
    case 'letras':
    case 'palabras': {
      const n = c.op === 'letras' ? rasgosDe(entidad, c.campo).nLetras : rasgosDe(entidad, c.campo).nPalabras;
      r = (c.min === undefined || n >= c.min) && (c.max === undefined || n <= c.max);
      break;
    }
    case 'es': {
      const v = entidad.atributos?.[c.campo];
      r = Array.isArray(v) ? v.some((x) => c.valores.includes(x)) : c.valores.includes(v);
      break;
    }
    case 'entre': {
      const v = entidad.atributos?.[c.campo];
      r = (Array.isArray(v) ? v : [v]).some((x) => typeof x === 'number' && x >= c.desde && x <= c.hasta);
      break;
    }
  }
  return c.no ? !r : r;
}

/** ¿La entidad cumple el filtro (canónico)? */
export const evaluar = (filtro, entidad) => filtro.y.every((c) => cumple(c, entidad));

/**
 * La primera condición que la entidad no cumple, explicada (para los rechazos con motivo):
 * «Perú» → «su nombre termina en «U»». `etiquetas` nombra cada campo («nombre», «región (M49)»).
 */
export function explicarFalla(filtro, entidad, etiquetas = {}) {
  const c = filtro.y.find((x) => !cumple(x, entidad));
  if (!c) return null;
  const r = ['empieza', 'termina', 'tiene', 'contiene', 'letras', 'palabras'].includes(c.op) ? rasgosDe(entidad, c.campo) : null;
  const etiqueta = etiquetas[c.campo] ?? c.campo;
  // Con alias, se aclara qué nombre se mira («República Checa» → se toma el nombre «Chequia»).
  const que = c.campo === 'nombre' && entidad.alias?.length ? `se toma el ${etiqueta || 'nombre'} «${entidad.nombre}», que` : etiqueta ? `su ${etiqueta}` : 'la palabra';
  switch (c.op) {
    case 'empieza':
      return c.no ? `${que} empieza con ${listaO(c.textos)}` : `${que} empieza con «${mostrarTexto(r.forma.replace(/ .*/, '').slice(0, c.textos[0].length))}»`;
    case 'termina':
      return c.no ? `${que} termina en ${listaO(c.textos)}` : `${que} termina en «${mostrarTexto(r.forma.slice(-c.textos[0].length))}»`;
    case 'tiene': {
      if (c.no) return `${que} tiene ${listaY(c.letras.filter((l) => r.mascara & mascaraDe([l])).map((l) => `la «${l.toUpperCase()}»`))}`;
      const faltan = c.letras.filter((l) => !(r.mascara & mascaraDe([l])));
      return `${que} no tiene ${listaY(faltan.map((l) => `la «${l.toUpperCase()}»`))}`;
    }
    case 'contiene':
      return c.no ? `${que} contiene «${c.texto}»` : `${que} no contiene «${c.texto}»`;
    case 'letras':
      return `${que} tiene ${cantidad(r.nLetras, 'letra')}`;
    case 'palabras':
      return `${que} tiene ${cantidad(r.nPalabras, 'palabra')}`;
    default: {
      const v = entidad.atributos?.[c.campo];
      const valor = Array.isArray(v) ? v.join(', ') : v;
      return valor == null || valor === '' ? null : `${que} es ${valor}`;
    }
  }
}

// ───── Descripción (enunciado) ─────

const mostrarTexto = (t) => (t.length === 1 ? t.toUpperCase() : t);
const comillas = (t) => `«${mostrarTexto(t)}»`;
const listaO = (textos) => textos.map(comillas).join(' o ');
function listaY(partes) {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
}
const cantidad = (n, palabra) => `${n} ${palabra}${n === 1 ? '' : 's'}`;
const esClausula = (frase) => /^(que|cuyo|cuya|cuyos|cuyas) /.test(frase);
const llenar = (frase, valores) => frase.replace(/\{(\w+)\}/g, (_, k) => String(valores[k]));

/** Frase verbal de una condición sobre texto (sin el sujeto). `vistas`: cómo mostrar cada texto normalizado. */
function verbo(c, vistas) {
  const no = c.no ? 'no ' : '';
  const textos = c.textos?.map((t) => vistas[t] ?? t);
  switch (c.op) {
    case 'empieza':
      return `${no}empiece con ${listaO(textos)}`;
    case 'termina':
      return `${no}termine en ${listaO(textos)}`;
    case 'tiene':
      return `${no}tenga ${listaY(c.letras.map((l) => `la «${l.toUpperCase()}»`))}`;
    case 'contiene':
      return `${no}contenga «${vistas[c.texto] ?? c.texto}»`;
    case 'letras':
    case 'palabras': {
      const p = c.op === 'letras' ? 'letra' : 'palabra';
      if (c.min !== undefined && c.min === c.max) return `tenga exactamente ${cantidad(c.min, p)}`;
      if (c.min !== undefined && c.max !== undefined) return `tenga entre ${c.min} y ${c.max} ${p}s`;
      if (c.min !== undefined) return `tenga ${c.min} ${p}s o más`;
      return `tenga ${c.max} ${p}s o menos`;
    }
  }
  return null;
}

/**
 * Enunciado de un filtro canónico según la plantilla:
 *   «{base}{complementos}{cláusulas}.» → «Nombrá un país de Sudamérica cuyo nombre termine en «A».»
 * Los complementos son las frases de atributos que no empiezan con «que/cuyo»; las cláusulas se unen
 * con « y », y las consecutivas sobre el mismo sujeto no lo repiten («cuyo nombre empiece con «A» y
 * termine en «A»»). `vistas` dice cómo mostrar cada texto normalizado (con tildes: cion → «ción»).
 */
export function describir(filtro, plantilla, vistas = {}) {
  const complementos = [];
  const clausulas = [];
  let sujetoAnterior = null;
  const deAtributo = (c) => (c.op === 'es' ? c.valores.map((valor) => llenar(plantilla.frases[c.campo], { valor })).join(' o ') : llenar(plantilla.frases[c.campo], { desde: c.desde, hasta: c.hasta }));
  // Los complementos van en el orden de las frases de la plantilla («del disco «X» de Y»).
  for (const campo of Object.keys(plantilla.frases ?? {})) {
    if (esClausula(plantilla.frases[campo])) continue;
    for (const c of filtro.y) if ((c.op === 'es' || c.op === 'entre') && c.campo === campo) complementos.push(deAtributo(c));
  }
  filtro.y.forEach((c) => {
    if (c.op === 'es' || c.op === 'entre') {
      if (esClausula(plantilla.frases[c.campo])) {
        clausulas.push(deAtributo(c));
        sujetoAnterior = null;
      }
      return;
    }
    const sujeto = plantilla.sujetos[c.campo];
    clausulas.push(sujeto === sujetoAnterior ? verbo(c, vistas) : `${sujeto} ${verbo(c, vistas)}`);
    sujetoAnterior = sujeto;
  });
  const partes = [plantilla.enunciado, ...complementos];
  if (clausulas.length) partes.push(clausulas.join(' y '));
  return `${partes.join(' ')}.`;
}

// ───── Interpretación (el camino inverso, para las pruebas y la vista previa) ─────

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ENTRE_COMILLAS = '«([^»]+)»';

/**
 * Lee un enunciado generado con `describir` y devuelve el filtro (sin canonizar), o null si no lo
 * reconoce. Solo entiende el lenguaje acotado de las plantillas: es la prueba de que el enunciado dice
 * exactamente la condición con la que se armaron las respuestas.
 */
export function interpretar(enunciado, plantilla, catalogo) {
  if (!enunciado.startsWith(plantilla.enunciado) || !enunciado.endsWith('.')) return null;
  let resto = enunciado.slice(plantilla.enunciado.length, -1);
  const condiciones = [];
  // Complementos de atributos: frases con valores de una lista cerrada (los del catálogo).
  const fraseRegex = (frase, valores) =>
    escapar(frase)
      .replace('\\{valor\\}', `(${valores.map(escapar).join('|')})`)
      .replace('\\{desde\\}', '(-?\\d+)')
      .replace('\\{hasta\\}', '(-?\\d+)');
  const valoresOrdenados = (campo) => [...(catalogo.valores.get(campo) ?? [])].sort((a, b) => b.length - a.length);
  for (const [campo, frase] of Object.entries(plantilla.frases ?? {})) {
    if (esClausula(frase)) continue;
    const una = fraseRegex(frase, valoresOrdenados(campo));
    const m = resto.match(new RegExp(`^ (${una}(?: o ${una})*)`));
    if (!m) continue;
    const valores = [...m[1].matchAll(new RegExp(una, 'g'))].map((x) => x[1]);
    condiciones.push({ op: 'es', campo, valores });
    resto = resto.slice(m[0].length);
  }
  if (!resto) return { y: condiciones };
  if (!resto.startsWith(' ')) return null;
  resto = resto.slice(1);
  // Cláusulas, separadas por « y ». Cada una puede empezar con un sujeto o heredar el anterior.
  const sujetos = Object.entries(plantilla.sujetos ?? {}).sort((a, b) => b[1].length - a[1].length);
  const patrones = [
    ['empieza', new RegExp(`^(no )?empiece con ${ENTRE_COMILLAS}((?: o ${ENTRE_COMILLAS})*)`)],
    ['termina', new RegExp(`^(no )?termine en ${ENTRE_COMILLAS}((?: o ${ENTRE_COMILLAS})*)`)],
    ['tiene', /^(no )?tenga (la «[^»]+»(?:(?:, | y )la «[^»]+»)*)/],
    ['contiene', new RegExp(`^(no )?contenga ${ENTRE_COMILLAS}`)],
    ['cantidad', /^tenga (?:exactamente (\d+)|entre (\d+) y (\d+)|(\d+)) (letra|palabra)s?(?: (o más|o menos))?/],
  ];
  let campoAnterior = null;
  while (resto) {
    let avanzo = false;
    for (const [campo, frase] of Object.entries(plantilla.frases ?? {})) {
      if (!esClausula(frase)) continue;
      const una = fraseRegex(frase, valoresOrdenados(campo));
      const m = resto.match(new RegExp(`^(${una}(?: o ${una})*)`));
      if (!m) continue;
      if (frase.includes('{desde}')) {
        const r = resto.match(new RegExp(`^${una}`));
        condiciones.push({ op: 'entre', campo, desde: Number(r[1]), hasta: Number(r[2]) });
        resto = resto.slice(r[0].length);
      } else {
        condiciones.push({ op: 'es', campo, valores: [...m[1].matchAll(new RegExp(una, 'g'))].map((x) => x[1]) });
        resto = resto.slice(m[0].length);
      }
      campoAnterior = null;
      avanzo = true;
      break;
    }
    if (!avanzo) {
      let campo = campoAnterior;
      const conSujeto = sujetos.find(([, s]) => resto.startsWith(`${s} `));
      if (conSujeto) {
        campo = conSujeto[0];
        resto = resto.slice(conSujeto[1].length + 1);
      }
      if (!campo) return null;
      const encontrado = patrones.map(([op, re]) => [op, resto.match(re)]).find(([, m]) => m);
      if (!encontrado) return null;
      const [op, m] = encontrado;
      const no = Boolean(m[1]) && op !== 'cantidad';
      if (op === 'empieza' || op === 'termina') condiciones.push({ op, campo, textos: [m[2], ...[...(m[3] ?? '').matchAll(/«([^»]+)»/g)].map((x) => x[1])], ...(no ? { no } : {}) });
      else if (op === 'tiene') condiciones.push({ op, campo, letras: [...m[2].matchAll(/«([^»]+)»/g)].map((x) => x[1]), ...(no ? { no } : {}) });
      else if (op === 'contiene') condiciones.push({ op, campo, texto: m[2], ...(no ? { no } : {}) });
      else {
        const tipo = m[5] === 'letra' ? 'letras' : 'palabras';
        if (m[1]) condiciones.push({ op: tipo, campo, min: Number(m[1]), max: Number(m[1]) });
        else if (m[2]) condiciones.push({ op: tipo, campo, min: Number(m[2]), max: Number(m[3]) });
        else condiciones.push({ op: tipo, campo, ...(m[6] === 'o más' ? { min: Number(m[4]) } : { max: Number(m[4]) }) });
      }
      resto = resto.slice(m[0].length);
      campoAnterior = campo;
    }
    if (!resto) break;
    if (!resto.startsWith(' y ')) return null;
    resto = resto.slice(3);
  }
  return { y: condiciones };
}

/** Forma normalizada de un texto de vista («ción» → «cion»), para comparar con el filtro canónico. */
export const normalTexto = (t) => normalizar(t);
