// Normalización de respuestas.
// - Ignora mayúsculas, espacios repetidos, tildes, diéresis y signos de puntuación.
// - Conserva la «ñ» (año ≠ ano).
// - Se registran de antemano formas sin artículo inicial ("La traviata" → "traviata").
// - Al buscar, también se prueba la forma compacta (sin espacios: "j r r tolkien" = "jrr tolkien").

const MARCA_ENIE = '\u0001';
const ARTICULO_INICIAL = /^(el|la|los|las|lo|un|una|unos|unas|the)\s+/;

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
function firmaPalabras(normalizado) {
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
  return agrupadas.sort().join('|');
}

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
  for (const { respuestaId, normalizada } of entradas) {
    if (!exacto.has(normalizada)) exacto.set(normalizada, respuestaId);
    const c = compactar(normalizada);
    if (!compacto.has(c)) compacto.set(c, respuestaId);
    else if (compacto.get(c) !== respuestaId) compacto.set(c, null);
    const f = firmaPalabras(normalizada);
    if (!palabras.has(f)) palabras.set(f, respuestaId);
    else if (palabras.get(f) !== respuestaId) palabras.set(f, null);
    formas.push({ respuestaId, normalizada: c });
    if (f !== c) formas.push({ respuestaId, normalizada: f });
  }
  return { exacto, compacto, palabras, formas };
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

/**
 * Busca una única respuesta inequívoca con pocos errores de tipeo.
 * No completa prefijos cortos: exige al menos cinco caracteres y tolera como
 * máximo un 20 % de ediciones (hasta tres), para no convertirlo en un buscador
 * que revele el banco durante la ronda.
 */
export function buscarParecidoEnIndice(indice, texto) {
  const normalizado = normalizar(texto);
  if (!normalizado) return null;
  const entradas = [normalizado, sinArticulo(normalizado)]
    .filter((forma, i, todas) => forma && todas.indexOf(forma) === i)
    .flatMap((forma) => [compactar(forma), firmaPalabras(forma)])
    .filter((forma, i, todas) => todas.indexOf(forma) === i)
    .filter((forma) => forma.length >= 5);
  if (!entradas.length) return null;

  const mejores = new Map();
  for (const entrada of entradas) {
    for (const forma of indice.formas || []) {
      const limite = Math.min(3, Math.floor(Math.max(entrada.length, forma.normalizada.length) * 0.2));
      if (limite < 1) continue;
      const distancia = distanciaAcotada(entrada, forma.normalizada, limite);
      if (distancia < 1 || distancia > limite) continue;
      const previa = mejores.get(forma.respuestaId);
      if (previa === undefined || distancia < previa) mejores.set(forma.respuestaId, distancia);
    }
  }
  if (!mejores.size) return null;
  const ordenadas = [...mejores].sort((a, b) => a[1] - b[1]);
  if (ordenadas[1]?.[1] === ordenadas[0][1]) return null;
  return ordenadas[0][0];
}
