// Filón — utilidades de pixel art para las escenas de viaje: tipografía de 3×5 y cuadrícula.
// Todo se dibuja en coordenadas de pantalla sobre un lienzo de baja resolución (cada «pixel» mide P).

// Tipografía de 3×5: cada letra es una cadena de 15 bits (tres por fila, de arriba hacia abajo).
const GLIFOS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '0': '111101101101111', '1': '010110010010111',
  '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
  '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  '!': '010010010000010', '¡': '010000010010010', '.': '000000000000010', ',': '000000000010100',
  '-': '000000111000000', '·': '000000010000000', "'": '010010000000000', ' ': '000000000000000',
};
// Glifos de 5×5 para los carteles de los fans.
const ICONOS = {
  '♥': '0101011111111110111000100',
  '★': '0010001110111110111001010',
};
const ACENTOS = { Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N' };

/** Ancho en pixeles de un texto en la tipografía de 3×5 (sin escalar). */
export function anchoTexto(texto) {
  let ancho = 0;
  for (const ch of texto.toUpperCase()) ancho += (ICONOS[ch] ? 5 : 3) + 1;
  return Math.max(0, ancho - 1);
}

/**
 * Escribe un texto con la tipografía pixel. (x, y) es la esquina superior izquierda en pantalla;
 * cada pixel del glifo mide P × escala. Las vocales con tilde y la Ñ llevan su marca encima.
 */
export function textoPixel(ctx, texto, x, y, P, { escala = 1, color = '#fff8dc', alinear = 'izquierda' } = {}) {
  const c = P * escala;
  let cx = Math.round((alinear === 'centro' ? x - (anchoTexto(texto) * c) / 2 : x) / P) * P;
  const cy = Math.round(y / P) * P;
  ctx.fillStyle = color;
  for (const original of texto.toUpperCase()) {
    const icono = ICONOS[original];
    const base = ACENTOS[original] ?? original;
    const bits = icono ?? GLIFOS[base] ?? GLIFOS[' '];
    const ancho = icono ? 5 : 3;
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') ctx.fillRect(cx + (i % ancho) * c, cy + Math.floor(i / ancho) * c, c, c);
    if (base !== original) {
      // Tilde: un pixel arriba a la derecha; eñe: una rayita.
      if (original === 'Ñ') ctx.fillRect(cx, cy - 2 * c, 3 * c, c);
      else ctx.fillRect(cx + c * 2, cy - 2 * c, c, c);
    }
    cx += (ancho + 1) * c;
  }
}

/** Cartel con borde, al estilo de los rótulos de la mina pero en pixeles. */
export function cartelPixel(ctx, texto, x, y, P, { acento = '#ffe45f', fondo = '#18162f', color = '#fff8dc', escala = 1, limites = null } = {}) {
  const c = P * escala;
  const ancho = (anchoTexto(texto) + 6) * c;
  const alto = 11 * c;
  // Con `limites` = [mínimo, máximo] el cartel no se sale de la pantalla.
  const centro = limites ? Math.max(limites[0] + ancho / 2, Math.min(limites[1] - ancho / 2, x)) : x;
  const x0 = Math.round((centro - ancho / 2) / P) * P;
  const y0 = Math.round((y - alto / 2) / P) * P;
  ctx.fillStyle = 'rgb(10 8 24 / .55)';
  ctx.fillRect(x0 + c, y0 + c, ancho, alto);
  ctx.fillStyle = acento;
  ctx.fillRect(x0, y0, ancho, alto);
  ctx.fillStyle = fondo;
  ctx.fillRect(x0 + c, y0 + c, ancho - 2 * c, alto - 2 * c);
  textoPixel(ctx, texto, x0 + 3 * c, y0 + 4 * c, P, { escala, color });
  return { x: x0, y: y0, ancho, alto };
}
