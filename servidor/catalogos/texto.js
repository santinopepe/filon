// Reglas de texto de las condiciones sobre nombres (explícitas y documentadas en docs/GENERADOR.md):
// - Se mira solo el nombre canónico de la entidad, nunca sus alias.
// - No importan mayúsculas, tildes ni diéresis (á = a, ü = u). La ñ es una letra distinta de la n.
// - Espacios, guiones, apóstrofos y signos separan palabras y no son letras: «Guinea-Bisáu» tiene dos
//   palabras y diez letras. Los dígitos tampoco son letras.
// - «Empieza/termina con» y «contiene la secuencia» se miran dentro de las palabras (sin saltar espacios);
//   «tiene la letra» y la cantidad de letras, sobre todas las letras del nombre.
import { normalizar } from '../normalizar.js';

export const VERSION_TEXTO = '1';
export const ALFABETO = [...'abcdefghijklmnñopqrstuvwxyz'];
const BIT = new Map(ALFABETO.map((l, i) => [l, 1 << i]));

/** Rasgos de un nombre para evaluar condiciones (se calculan una vez por entidad). */
export function rasgos(nombre) {
  const forma = normalizar(nombre);
  const letras = forma.replace(/[^\p{L}]/gu, '');
  let mascara = 0;
  for (const l of letras) mascara |= BIT.get(l) ?? 0;
  const palabras = forma.split(' ').filter((p) => /\p{L}/u.test(p));
  return { forma, letras, mascara, nLetras: [...letras].length, nPalabras: palabras.length, inicial: palabras[0]?.[0] ?? '', final: [...letras].at(-1) ?? '' };
}

/** Máscara de bits de un conjunto de letras (para «tiene la A y la S»). */
export const mascaraDe = (letras) => letras.reduce((m, l) => m | (BIT.get(l) ?? 0), 0);

/** Letra o secuencia de un parámetro, normalizada con las mismas reglas. */
export const textoNormal = (t) => normalizar(t).replace(/[^\p{L}]/gu, '');
