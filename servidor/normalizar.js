// Normalización de respuestas.
// - Ignora mayúsculas, espacios repetidos, tildes, diéresis y signos de puntuación.
// - Conserva la «ñ» (año ≠ ano).
// - Se registran de antemano formas sin artículo inicial ("La traviata" → "traviata").
// - Al buscar, también se prueba la forma compacta (sin espacios: "j r r tolkien" = "jrr tolkien").

const MARCA_ENIE = '\u0001';
const ARTICULO_INICIAL = /^(el|la|los|las|lo|un|una|unos|unas|the)\s+/;
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'lo', 'un', 'una', 'unos', 'unas', 'y', 'e', 'en', 'a', 'of', 'the', 'and', 'da', 'do', 'dos', 'di', 'van', 'von']);

export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFC')
    .toLocaleLowerCase('es')
    .replace(/ñ/g, MARCA_ENIE)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(new RegExp(MARCA_ENIE, 'g'), 'ñ')
    .replace(/[’‘'´`"“”«»]/g, '')
    .replace(/&/g, ' y ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export const compactar = (normalizado) => normalizado.replace(/ /g, '');
export const sinArticulo = (normalizado) => normalizado.replace(ARTICULO_INICIAL, '');

// Hace equivalentes nombres con las mismas palabras en distinto orden. Las
// iniciales consecutivas se agrupan: «J R R Tolkien» y «Tolkien JRR» comparten
// la misma firma.
function agruparPalabras(normalizado) {
  const palabras = normalizado.split(' ').filter(Boolean);
  const agrupadas = [];
  for (let i = 0; i < palabras.length; i++) {
    if (palabras[i].length === 1 && palabras[i + 1]?.length === 1) {
      let iniciales = palabras[i];
      while (palabras[i + 1]?.length === 1) iniciales += palabras[++i];
      agrupadas.push(iniciales);
    } else {
      agrupadas.push(palabras[i]);
    }
  }
  return agrupadas;
}

const firmaPalabras = (normalizado) => agruparPalabras(normalizado).sort().join('|');

/** Formas que se registran para una variante: la normalizada y, si corresponde, sin artículo. */
export function formasRegistrables(texto) {
  const n = normalizar(texto);
  if (!n) return [];
  const formas = [n];
  const s = sinArticulo(n);
  if (s && s !== n && s.length >= 2) formas.push(s);
  return formas;
}

/**
 * Construye un índice de búsqueda a partir de pares {respuestaId, normalizada}.
 * Las formas compactas ambiguas (que apuntan a dos respuestas distintas) se descartan.
 */
export function crearIndice(entradas) {
  const exacto = new Map();
  const compacto = new Map();
  const palabras = new Map();
  const formas = [];
  const parciales = [];
  const registradas = new Map();
  for (const { respuestaId, normalizada } of entradas) {
    if (!normalizada) continue;
    if (!registradas.has(respuestaId)) registradas.set(respuestaId, new Set());
    if (registradas.get(respuestaId).has(normalizada)) continue;
    registradas.get(respuestaId).add(normalizada);
    if (!exacto.has(normalizada)) exacto.set(normalizada, respuestaId);
    const c = compactar(normalizada);
    if (!compacto.has(c)) compacto.set(c, respuestaId);
    else if (compacto.get(c) !== respuestaId) compacto.set(c, null);
    const f = firmaPalabras(normalizada);
    if (!palabras.has(f)) palabras.set(f, respuestaId);
    else if (palabras.get(f) !== respuestaId) palabras.set(f, null);
    formas.push({ respuestaId, normalizada: c });
    if (f !== c) formas.push({ respuestaId, normalizada: f });
    parciales.push({ respuestaId, compacta: c, palabras: agruparPalabras(normalizada) });
  }
  return { exacto, compacto, palabras, formas, parciales };
}

/** Busca un texto ingresado en el índice. Devuelve el id de respuesta o null. */
export function buscarEnIndice(indice, texto) {
  const n = normalizar(texto);
  if (!n) return null;
  const candidatos = [n];
  const s = sinArticulo(n);
  if (s && s !== n) candidatos.push(s);
  for (const c of candidatos) if (indice.exacto.has(c)) return indice.exacto.get(c);
  for (const c of candidatos) {
    const id = indice.compacto.get(compactar(c));
    if (id != null) return id;
  }
  for (const c of candidatos) {
    const id = indice.palabras?.get(firmaPalabras(c));
    if (id != null) return id;
  }
  return null;
}

// Distancia Damerau-Levenshtein acotada: además de inserciones, borrados y
// reemplazos, considera un intercambio de letras contiguas como un solo error.
function distanciaAcotada(a, b, limite) {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let anterior2 = null;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      let valor = Math.min(actual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (anterior2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        valor = Math.min(valor, anterior2[j - 2] + 1);
      }
      actual[j] = valor;
      menor = Math.min(menor, valor);
    }
    if (menor > limite) return limite + 1;
    anterior2 = anterior;
    anterior = actual;
  }
  return anterior[b.length];
}

// Una palabra completa de cuatro letras (Bach, King) alcanza. Para un
// fragmento interno o un error de tipeo se exigen cinco. Conectores y números
// solos no identifican una respuesta.
function esFragmentoSignificativo(palabras) {
  return palabras.some((p) => !CONECTORES.has(p) && /\p{L}/u.test(p) && p.length >= 4);
}

function contienePalabras(candidata, entrada) {
  const disponibles = [...candidata];
  for (const palabra of entrada) {
    const i = disponibles.indexOf(palabra);
    if (i < 0) return false;
    disponibles.splice(i, 1);
  }
  return true;
}

// Genera sólo los tramos del largo buscado, sin guardar todas las combinaciones
// en el índice. Permite corregir «garciamarqez» o «marqez garcia» dentro de un
// nombre largo, además de un apellido suelto como «tolkein».
function* fragmentosDe(palabras, largo, limite) {
  for (let i = 0; i < palabras.length; i++) {
    let compacta = '';
    for (let j = i; j < palabras.length; j++) {
      compacta += palabras[j];
      if (compacta.length > largo + limite) break;
      if (compacta.length < largo - limite) continue;
      const tramo = palabras.slice(i, j + 1);
      if (!esFragmentoSignificativo(tramo)) continue;
      yield compacta;
      if (tramo.length > 1) yield [...tramo].sort().join('|');
    }
  }
}

/**
 * Sugiere una respuesta por palabras completas, subcadenas o pocos errores.
 * Las coincidencias exactas ganan; un fragmento compartido nunca se desempata
 * por el largo del nombre ni por cuántas variantes tenga cada respuesta.
 * Las correcciones toleran hasta un 20 % de ediciones, con un máximo de tres.
 */
export function buscarParecidoEnIndice(indice, texto) {
  const normalizado = normalizar(texto);
  if (!normalizado) return null;
  const exacta = buscarEnIndice(indice, texto);
  if (exacta != null) return exacta;
  const consultas = [normalizado, sinArticulo(normalizado)]
    .filter((forma, i, todas) => forma && todas.indexOf(forma) === i);
  const parciales = new Set();
  for (const consulta of consultas) {
    const palabras = agruparPalabras(consulta);
    if (!esFragmentoSignificativo(palabras)) continue;
    const compacta = compactar(consulta);
    for (const forma of indice.parciales || []) {
      if (contienePalabras(forma.palabras, palabras) || (compacta.length >= 5 && forma.compacta.includes(compacta))) {
        parciales.add(forma.respuestaId);
        if (parciales.size > 1) return null;
      }
    }
  }
  if (parciales.size) return parciales.values().next().value;

  const entradas = consultas
    .flatMap((forma) => [compactar(forma), firmaPalabras(forma)])
    .filter((forma, i, todas) => todas.indexOf(forma) === i)
    .filter((forma) => forma.replace(/\|/g, '').length >= 5);
  if (!entradas.length) return null;

  const mejores = new Map();
  const permiteFragmentos = consultas.some((c) => esFragmentoSignificativo(agruparPalabras(c)));
  const registrar = (entrada, candidata, respuestaId) => {
    const largo = Math.max(entrada.replace(/\|/g, '').length, candidata.replace(/\|/g, '').length);
    const limite = Math.min(3, Math.floor(largo * 0.2));
    if (limite < 1) return;
    const distancia = distanciaAcotada(entrada, candidata, limite);
    if (distancia > limite) return;
    const previa = mejores.get(respuestaId);
    if (previa === undefined || distancia < previa) mejores.set(respuestaId, distancia);
  };
  for (const entrada of entradas) {
    for (const forma of indice.formas || []) {
      registrar(entrada, forma.normalizada, forma.respuestaId);
    }
    if (!permiteFragmentos) continue;
    const largo = entrada.replace(/\|/g, '').length;
    // Si faltan letras, el 20 % se calcula sobre el candidato más largo:
    // nueve letras pueden aproximar un tramo de once con dos omisiones.
    const limite = Math.min(3, Math.floor(largo / 4));
    for (const forma of indice.parciales || []) {
      for (const fragmento of fragmentosDe(forma.palabras, largo, limite)) {
        registrar(entrada, fragmento, forma.respuestaId);
      }
    }
  }
  if (!mejores.size) return null;
  const ordenadas = [...mejores].sort((a, b) => a[1] - b[1]);
  if (ordenadas[1]?.[1] === ordenadas[0][1]) return null;
  return ordenadas[0][0];
}
