// Normalización de texto compartida por el servidor (validación de respuestas) y el navegador (búsqueda
// en las respuestas reveladas): ignora mayúsculas, espacios repetidos, tildes, diéresis y puntuación, y
// conserva la «ñ» (año ≠ ano). Sin dependencias: se importa tal cual desde Node y desde la página.

const MARCA_ENIE = '\u0001';

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
