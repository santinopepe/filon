// Filón — paisaje del modo Geografía: cielo, sierras, colinas, vegetación, mar y monumentos en pixel art.
// Todo se dibuja en coordenadas de pantalla sobre lienzos de baja resolución (ver escena-viaje.js):
//  - fondo (se desenfoca): cielo, sol o luna, nubes lejanas y dos cordones de sierras;
//  - medio (nítido y con contorno): colinas, vegetación de cada región, monumentos, suelo y mar.
// La luz viene del sol, a la derecha: las caras de la derecha van más claras y las de la izquierda en sombra.
// Las medidas están en unidades de la altura de Filón (a), así la composición no depende de la pantalla.
import { generador, limitar, lerp, mezcla, rgb } from './escena.js';

export const ETAPAS_GEOGRAFIA = [
  { hasta: 0, nombre: 'la pista de Aeroparque', titulo: 'Aeroparque' },
  { hasta: 1000, nombre: 'América del Sur', titulo: 'América del Sur', barra: '#5fd38d', acento: '#5fd38d' },
  { hasta: 2000, nombre: 'América del Norte', titulo: 'América del Norte', barra: '#77b8f2', acento: '#77b8f2' },
  { hasta: 3000, nombre: 'Europa', titulo: 'Europa', barra: '#9b7bff', acento: '#b9a5ff' },
  { hasta: 4000, nombre: 'África', titulo: 'África', barra: '#f0a24a', acento: '#ffd166' },
  { hasta: 5000, nombre: 'Asia', titulo: 'Asia', barra: '#ff7882', acento: '#ff93a5' },
  { hasta: 6000, nombre: 'Oceanía', titulo: 'Oceanía', barra: '#77edf2', acento: '#77edf2' },
  { hasta: Infinity, nombre: 'la Antártida', titulo: 'Antártida', barra: '#e5eff4', acento: '#e5eff4' },
];

// Monumentos del recorrido (x en metros de avance).
export const LUGARES = [
  { x: 120, tipo: 'obelisco', nombre: 'Buenos Aires' },
  { x: 470, tipo: 'andes', nombre: 'Aconcagua' },
  { x: 820, tipo: 'cristo', nombre: 'Río de Janeiro' },
  { x: 1430, tipo: 'chichen', nombre: 'Chichén Itzá' },
  { x: 1760, tipo: 'libertad', nombre: 'Nueva York' },
  { x: 2310, tipo: 'bigben', nombre: 'Londres' },
  { x: 2590, tipo: 'eiffel', nombre: 'París' },
  { x: 2860, tipo: 'coliseo', nombre: 'Roma' },
  { x: 3250, tipo: 'piramides', nombre: 'Giza' },
  { x: 3700, tipo: 'kilimanjaro', nombre: 'Kilimanjaro' },
  { x: 4200, tipo: 'tajmahal', nombre: 'Agra' },
  { x: 4520, tipo: 'muralla', nombre: 'Gran Muralla China' },
  { x: 4830, tipo: 'fuji', nombre: 'Monte Fuji' },
  { x: 5370, tipo: 'opera', nombre: 'Sídney' },
  { x: 5730, tipo: 'uluru', nombre: 'Uluru' },
  { x: 6470, tipo: 'pinguinos', nombre: 'Mar de Weddell' },
  { x: 7090, tipo: 'base', nombre: 'Base Marambio' },
];

const MARES = [[980, 1290], [2000, 2190], [5000, 5200], [6000, 6280]];
export const enMar = (x) => MARES.some(([a, b]) => x >= a && x <= b);

// Cielo por tramo: [arriba, medio, horizonte]. Día en América, nublado en Europa, atardecer en África,
// anochecer en Asia, mañana en Oceanía y noche polar con aurora en la Antártida.
const CIELOS = [
  [0, [64, 170, 232], [126, 200, 240], [214, 240, 250]],
  [900, [64, 170, 232], [126, 200, 240], [214, 240, 250]],
  [1150, [58, 156, 226], [118, 192, 238], [208, 236, 248]],
  [1900, [58, 156, 226], [118, 192, 238], [208, 236, 248]],
  [2150, [112, 152, 196], [162, 190, 218], [228, 234, 240]],
  [2900, [112, 152, 196], [162, 190, 218], [228, 234, 240]],
  [3150, [226, 112, 70], [246, 162, 92], [255, 222, 150]],
  [3900, [226, 112, 70], [246, 162, 92], [255, 222, 150]],
  [4150, [78, 54, 130], [176, 98, 140], [246, 170, 132]],
  [4900, [78, 54, 130], [176, 98, 140], [246, 170, 132]],
  [5150, [82, 168, 230], [150, 204, 236], [255, 226, 188]],
  [5900, [82, 168, 230], [150, 204, 236], [255, 226, 188]],
  [6200, [10, 14, 40], [24, 34, 82], [52, 70, 128]],
];
// Sierras por tramo: [luz, sombra, nieve en sombra].
const SIERRAS = [
  [0, [104, 150, 170], [72, 108, 134], [200, 214, 236]],
  [2900, [118, 146, 168], [86, 110, 136], [204, 214, 232]],
  [3150, [206, 146, 96], [168, 108, 74], [236, 206, 170]],
  [3900, [206, 146, 96], [168, 108, 74], [236, 206, 170]],
  [4150, [138, 100, 156], [100, 70, 126], [214, 186, 214]],
  [4900, [138, 100, 156], [100, 70, 126], [214, 186, 214]],
  [5150, [190, 118, 92], [150, 86, 70], [236, 206, 190]],
  [5900, [190, 118, 92], [150, 86, 70], [236, 206, 190]],
  [6200, [172, 196, 228], [112, 136, 184], [214, 228, 246]],
];
// Suelo por tramo: [pasto o tierra, borde claro, sombra].
const SUELOS = [
  [0, [92, 98, 120], [120, 126, 150], [64, 68, 88]],
  [70, [82, 178, 74], [140, 214, 96], [52, 132, 64]],
  [950, [82, 178, 74], [140, 214, 96], [52, 132, 64]],
  [1300, [110, 170, 70], [170, 206, 96], [74, 128, 58]],
  [1620, [70, 160, 82], [124, 202, 104], [44, 116, 66]],
  [2000, [70, 160, 82], [124, 202, 104], [44, 116, 66]],
  [2200, [96, 178, 92], [150, 214, 112], [62, 134, 72]],
  [3000, [96, 178, 92], [150, 214, 112], [62, 134, 72]],
  [3080, [234, 196, 122], [252, 226, 164], [204, 158, 92]],
  [3500, [234, 196, 122], [252, 226, 164], [204, 158, 92]],
  [3600, [198, 178, 86], [226, 210, 120], [156, 136, 62]],
  [4000, [198, 178, 86], [226, 210, 120], [156, 136, 62]],
  [4080, [84, 164, 98], [140, 206, 122], [56, 120, 76]],
  [5000, [84, 164, 98], [140, 206, 122], [56, 120, 76]],
  [5200, [206, 114, 64], [236, 158, 96], [160, 80, 48]],
  [6000, [206, 114, 64], [236, 158, 96], [160, 80, 48]],
  [6300, [236, 244, 250], [255, 255, 255], [180, 204, 230]],
];

// Vegetación y construcciones de cada región: [desde, hasta, tipos posibles, probabilidad].
const DECORADO = [
  [70, 950, ['jacaranda', 'ombu', 'ombu', 'arbusto', 'casita'], 0.6],
  [1290, 1620, ['cactus', 'cactus', 'arbusto', 'palmera'], 0.55],
  [1620, 2000, ['pino', 'pino', 'arbol', 'casita'], 0.65],
  [2190, 3000, ['arbol', 'cipres', 'cipres', 'casita', 'pino'], 0.65],
  [3080, 3550, ['palmera'], 0.25],
  [3550, 4000, ['acacia', 'acacia', 'arbusto', 'jirafa'], 0.5],
  [4080, 5000, ['cerezo', 'cerezo', 'pino', 'pagoda', 'arbusto'], 0.6],
  [5200, 6000, ['eucalipto', 'arbusto', 'arbusto'], 0.5],
  [6280, 7300, ['tempano', 'tempano'], 0.45],
];


export function interpolar(tabla, x, campo = 1) {
  if (x <= tabla[0][0]) return tabla[0][campo];
  for (let i = 1; i < tabla.length; i++) {
    if (x <= tabla[i][0]) {
      const [x0] = tabla[i - 1];
      const [x1] = tabla[i];
      return mezcla(tabla[i - 1][campo], tabla[i][campo], (x - x0) / (x1 - x0));
    }
  }
  return tabla.at(-1)[campo];
}

// Ruido suave de una dimensión (para sierras y colinas que no se vean «dibujadas con regla»).
const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function ruido(x) {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), t);
}
const fractal = (x) => ruido(x) * 0.55 + ruido(x * 2.1 + 7) * 0.28 + ruido(x * 4.7 + 19) * 0.17;
// Cordillera: picos marcados (ruido «plegado») pero laderas largas, sin dientes de sierra.
const cordillera = (x) => {
  const pliegue = 1 - Math.abs(ruido(x) * 2 - 1);
  return pliegue * 0.7 + ruido(x * 2.3 + 5) * 0.22 + ruido(x * 5.1 + 11) * 0.08;
};

function pol(ctx, puntos, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}
function circ(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function elip(ctx, x, y, rx, ry, color, giro = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, giro, 0, Math.PI * 2);
  ctx.fill();
}
function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
/** Grilla de ventanitas: algunas prendidas, otras apagadas. */
function ventanas(ctx, x, y, w, h, a, semilla, { prendida = '#ffe7a1', apagada = '#5d6a8c', paso = 0.075 } = {}) {
  const azar = generador(semilla);
  const t = a * 0.032;
  for (let vy = y + a * 0.05; vy < y + h - a * 0.05; vy += a * paso) {
    for (let vx = x + a * 0.04; vx < x + w - a * 0.04; vx += a * 0.06) rect(ctx, vx, vy, t, t * 1.4, azar() < 0.45 ? prendida : apagada);
  }
}

// ───── Vegetación y construcciones chicas ─────
// Cada pieza se dibuja con la base en (x, piso) y altura s (en pixeles de pantalla).
const PIEZAS = {
  ombu(ctx, x, piso, s) {
    rect(ctx, x - s * 0.06, piso - s * 0.5, s * 0.12, s * 0.5, '#6b4630');
    rect(ctx, x - s * 0.06, piso - s * 0.5, s * 0.04, s * 0.5, '#4f3222');
    for (const [dx, dy, r, c] of [[-0.25, -0.62, 0.27, '#2f8a3e'], [0.22, -0.64, 0.26, '#2f8a3e'], [0, -0.82, 0.3, '#2f8a3e'], [0.1, -0.86, 0.2, '#4caf50'], [0.3, -0.68, 0.14, '#4caf50'], [0.16, -0.94, 0.09, '#7fd16a']]) circ(ctx, x + dx * s, piso + dy * s, r * s, c);
  },
  jacaranda(ctx, x, piso, s) {
    rect(ctx, x - s * 0.05, piso - s * 0.5, s * 0.1, s * 0.5, '#5e3d2c');
    for (const [dx, dy, r, c] of [[-0.22, -0.62, 0.24, '#7b4fb8'], [0.2, -0.64, 0.24, '#7b4fb8'], [0, -0.8, 0.28, '#7b4fb8'], [0.1, -0.84, 0.18, '#a77ee0'], [0.28, -0.66, 0.12, '#a77ee0'], [0.14, -0.92, 0.08, '#d3b6f5']]) circ(ctx, x + dx * s, piso + dy * s, r * s, c);
  },
  arbol(ctx, x, piso, s) {
    rect(ctx, x - s * 0.05, piso - s * 0.45, s * 0.1, s * 0.45, '#6b4630');
    for (const [dx, dy, r, c] of [[0, -0.66, 0.3, '#3a8f42'], [-0.14, -0.58, 0.2, '#3a8f42'], [0.14, -0.72, 0.18, '#5cb85c'], [0.2, -0.6, 0.12, '#5cb85c']]) circ(ctx, x + dx * s, piso + dy * s, r * s, c);
  },
  arbusto(ctx, x, piso, s) {
    elip(ctx, x, piso - s * 0.12, s * 0.22, s * 0.14, '#3e8a48');
    elip(ctx, x + s * 0.06, piso - s * 0.16, s * 0.12, s * 0.08, '#63b45e');
  },
  pino(ctx, x, piso, s) {
    rect(ctx, x - s * 0.04, piso - s * 0.18, s * 0.08, s * 0.18, '#5a3a26');
    for (let i = 0; i < 3; i++) {
      const base = piso - s * (0.12 + i * 0.26);
      const ancho = s * (0.3 - i * 0.07);
      pol(ctx, [[x - ancho, base], [x, base - s * 0.38], [x + ancho, base]], '#24704a');
      pol(ctx, [[x, base - s * 0.38], [x + ancho, base], [x + ancho * 0.25, base]], '#3d9a62');
    }
  },
  cipres(ctx, x, piso, s) {
    elip(ctx, x, piso - s * 0.5, s * 0.1, s * 0.5, '#2f6b3e');
    elip(ctx, x + s * 0.03, piso - s * 0.56, s * 0.05, s * 0.36, '#4b8f55');
  },
  palmera(ctx, x, piso, s) {
    ctx.strokeStyle = '#8a6440';
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(x, piso);
    ctx.quadraticCurveTo(x + s * 0.12, piso - s * 0.5, x + s * 0.04, piso - s * 0.9);
    ctx.stroke();
    for (const [ang, largo] of [[-2.7, 0.42], [-2.1, 0.36], [-0.5, 0.42], [-1.1, 0.36], [-1.6, 0.3]]) {
      const cx = x + s * 0.04 + Math.cos(ang) * s * largo * 0.5;
      const cy = piso - s * 0.9 + Math.sin(ang) * s * largo * 0.35 + s * 0.04;
      elip(ctx, cx, cy, s * largo * 0.5, s * 0.06, ang > -1.6 ? '#4caf50' : '#2f8a3e', ang + Math.PI / 2 - Math.PI / 2 + (ang > -1.6 ? 0.35 : -0.35));
    }
    circ(ctx, x + s * 0.04, piso - s * 0.88, s * 0.05, '#6b4630');
  },
  cactus(ctx, x, piso, s) {
    const verde = '#3f9a52';
    const luz = '#6cc074';
    rect(ctx, x - s * 0.07, piso - s * 0.7, s * 0.14, s * 0.7, verde);
    rect(ctx, x + s * 0.02, piso - s * 0.68, s * 0.04, s * 0.66, luz);
    rect(ctx, x - s * 0.24, piso - s * 0.48, s * 0.1, s * 0.22, verde);
    rect(ctx, x - s * 0.24, piso - s * 0.3, s * 0.2, s * 0.08, verde);
    rect(ctx, x + s * 0.14, piso - s * 0.58, s * 0.1, s * 0.26, verde);
    rect(ctx, x + s * 0.04, piso - s * 0.36, s * 0.2, s * 0.08, verde);
    circ(ctx, x, piso - s * 0.7, s * 0.07, verde);
  },
  acacia(ctx, x, piso, s) {
    ctx.strokeStyle = '#5a3a26';
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.moveTo(x, piso);
    ctx.lineTo(x, piso - s * 0.45);
    ctx.lineTo(x - s * 0.18, piso - s * 0.62);
    ctx.moveTo(x, piso - s * 0.45);
    ctx.lineTo(x + s * 0.2, piso - s * 0.62);
    ctx.stroke();
    elip(ctx, x, piso - s * 0.68, s * 0.52, s * 0.1, '#5b7a2e');
    elip(ctx, x + s * 0.1, piso - s * 0.73, s * 0.36, s * 0.06, '#7fa040');
  },
  jirafa(ctx, x, piso, s) {
    const piel = '#e8b04a';
    const mancha = '#a8662a';
    for (const dx of [-0.16, -0.08, 0.1, 0.17]) rect(ctx, x + dx * s, piso - s * 0.35, s * 0.04, s * 0.35, piel);
    elip(ctx, x, piso - s * 0.42, s * 0.22, s * 0.1, piel);
    pol(ctx, [[x + s * 0.12, piso - s * 0.46], [x + s * 0.24, piso - s * 0.95], [x + s * 0.3, piso - s * 0.93], [x + s * 0.2, piso - s * 0.42]], piel);
    elip(ctx, x + s * 0.3, piso - s * 0.95, s * 0.08, s * 0.04, piel);
    for (const [dx, dy] of [[-0.1, -0.44], [0.02, -0.4], [0.18, -0.6], [0.22, -0.76], [-0.02, -0.46]]) rect(ctx, x + dx * s, piso + dy * s, s * 0.05, s * 0.04, mancha);
  },
  cerezo(ctx, x, piso, s) {
    rect(ctx, x - s * 0.05, piso - s * 0.42, s * 0.1, s * 0.42, '#5b3a35');
    for (const [dx, dy, r, c] of [[-0.2, -0.56, 0.22, '#e98fb4'], [0.18, -0.58, 0.22, '#e98fb4'], [0, -0.74, 0.26, '#e98fb4'], [0.1, -0.8, 0.16, '#ffc2da'], [0.26, -0.62, 0.1, '#ffc2da']]) circ(ctx, x + dx * s, piso + dy * s, r * s, c);
  },
  pagoda(ctx, x, piso, s) {
    for (let i = 0; i < 3; i++) {
      const base = piso - s * i * 0.28;
      const w = s * (0.22 - i * 0.04);
      rect(ctx, x - w * 0.7, base - s * 0.2, w * 1.4, s * 0.2, '#f2e2c8');
      rect(ctx, x - w * 0.7, base - s * 0.2, w * 0.4, s * 0.2, '#d6c0a0');
      pol(ctx, [[x - w * 1.25, base - s * 0.18], [x, base - s * 0.32], [x + w * 1.25, base - s * 0.18]], '#c0392b');
    }
    rect(ctx, x - s * 0.01, piso - s * 0.98, s * 0.03, s * 0.16, '#8a5a2a');
  },
  eucalipto(ctx, x, piso, s) {
    rect(ctx, x - s * 0.04, piso - s * 0.62, s * 0.08, s * 0.62, '#e9e2d4');
    rect(ctx, x - s * 0.04, piso - s * 0.62, s * 0.03, s * 0.62, '#bdb3a2');
    for (const [dx, dy, r] of [[-0.18, -0.7, 0.18], [0.16, -0.74, 0.18], [0, -0.86, 0.2]]) elip(ctx, x + dx * s, piso + dy * s, r * s, r * s * 0.7, '#7d9a5a');
    elip(ctx, x + s * 0.1, piso - s * 0.84, s * 0.1, s * 0.06, '#a3bd78');
  },
  casita(ctx, x, piso, s) {
    rect(ctx, x - s * 0.22, piso - s * 0.3, s * 0.44, s * 0.3, '#f4e7cf');
    rect(ctx, x - s * 0.22, piso - s * 0.3, s * 0.12, s * 0.3, '#d8c6a6');
    pol(ctx, [[x - s * 0.28, piso - s * 0.28], [x, piso - s * 0.52], [x + s * 0.28, piso - s * 0.28]], '#c6533e');
    pol(ctx, [[x, piso - s * 0.52], [x + s * 0.28, piso - s * 0.28], [x + s * 0.1, piso - s * 0.28]], '#e0705a');
    rect(ctx, x + s * 0.04, piso - s * 0.2, s * 0.1, s * 0.1, '#7fc3e8');
    rect(ctx, x - s * 0.12, piso - s * 0.18, s * 0.09, s * 0.18, '#7a4a32');
  },
  tempano(ctx, x, piso, s) {
    pol(ctx, [[x - s * 0.4, piso], [x - s * 0.28, piso - s * 0.3], [x - s * 0.05, piso - s * 0.42], [x + s * 0.22, piso - s * 0.28], [x + s * 0.38, piso]], '#e8f6ff');
    pol(ctx, [[x - s * 0.05, piso - s * 0.42], [x + s * 0.22, piso - s * 0.28], [x + s * 0.38, piso], [x + s * 0.02, piso]], '#ffffff');
    pol(ctx, [[x - s * 0.4, piso], [x - s * 0.28, piso - s * 0.3], [x - s * 0.12, piso]], '#a9d4f0');
  },
};

// ───── Monumentos ─────
// Base en (x, piso), medidas en unidades de a. Devuelven la altura que ocupan (para el cartel).
const MONUMENTOS = {
  obelisco(ctx, x, piso, a) {
    const edificios = [[-1.5, 0.95, 0.42, '#c9b8a0'], [-1.05, 1.3, 0.36, '#9fb0cc'], [-0.65, 0.8, 0.3, '#d8c9b0'], [0.5, 1.05, 0.38, '#a9b6cf'], [0.92, 0.7, 0.44, '#d9ccb5'], [1.38, 1.4, 0.34, '#93a5c2']];
    edificios.forEach(([dx, h, w, c], i) => {
      const bx = x + dx * a;
      rect(ctx, bx, piso - h * a, w * a, h * a, c);
      rect(ctx, bx, piso - h * a, w * a * 0.25, h * a, rgb(mezcla(hex(c), [40, 40, 70], 0.3)));
      rect(ctx, bx, piso - h * a, w * a, a * 0.03, rgb(mezcla(hex(c), [255, 255, 255], 0.35)));
      ventanas(ctx, bx + w * a * 0.25, piso - h * a + a * 0.04, w * a * 0.7, h * a - a * 0.08, a, i * 17 + 3);
    });
    // Obelisco: base, fuste con cara en sombra y punta.
    rect(ctx, x - a * 0.17, piso - a * 0.08, a * 0.34, a * 0.08, '#d8cfb4');
    pol(ctx, [[x - a * 0.1, piso - a * 0.08], [x - a * 0.065, piso - a * 1.68], [x, piso - a * 1.82], [x + a * 0.065, piso - a * 1.68], [x + a * 0.1, piso - a * 0.08]], '#fff6e0');
    pol(ctx, [[x - a * 0.1, piso - a * 0.08], [x - a * 0.065, piso - a * 1.68], [x, piso - a * 1.82], [x, piso - a * 0.08]], '#dcd0b0');
    rect(ctx, x + a * 0.01, piso - a * 1.52, a * 0.03, a * 0.04, '#5d5a6e');
    // Jacarandás al pie.
    PIEZAS.jacaranda(ctx, x - a * 0.38, piso, a * 0.42);
    PIEZAS.jacaranda(ctx, x + a * 0.34, piso, a * 0.38);
    return 1.82;
  },
  andes(ctx, x, piso, a) {
    const picos = [[-1.7, 1.15, 0.95], [-0.85, 1.55, 1.0], [0.05, 2.1, 1.15], [0.95, 1.45, 0.95], [1.75, 1.05, 0.85]];
    for (const [dx, h, w] of picos) {
      const cx = x + dx * a;
      const cima = piso - h * a;
      pol(ctx, [[cx - w * a, piso], [cx, cima], [cx + w * a, piso]], '#8d8aa6');
      pol(ctx, [[cx - w * a, piso], [cx, cima], [cx - w * a * 0.05, piso]], '#68668a');
      // Vetas de roca.
      ctx.strokeStyle = '#59577a';
      ctx.lineWidth = a * 0.025;
      ctx.beginPath();
      ctx.moveTo(cx - w * a * 0.3, piso - h * a * 0.35);
      ctx.lineTo(cx - w * a * 0.12, piso - h * a * 0.6);
      ctx.moveTo(cx + w * a * 0.28, piso - h * a * 0.3);
      ctx.lineTo(cx + w * a * 0.16, piso - h * a * 0.52);
      ctx.stroke();
      // Nieve con borde dentado, con su lado en sombra.
      const n = 0.3 * h;
      const borde = (f) => piso - (h - n * (0.75 + 0.35 * Math.sin(f * 13 + dx * 5))) * a;
      const pts = [[cx, cima]];
      for (let f = -1; f <= 1.001; f += 0.25) pts.push([cx + f * w * a * (n / h), borde(f)]);
      pol(ctx, pts, '#ffffff');
      pol(ctx, [[cx, cima], ...pts.filter(([px]) => px <= cx)], '#c9d6ee');
    }
    return 2.1;
  },
  cristo(ctx, x, piso, a) {
    // Pan de Azúcar a la derecha y el Corcovado con su selva.
    ctx.fillStyle = '#7c8794';
    ctx.beginPath();
    ctx.moveTo(x + a * 0.9, piso);
    ctx.bezierCurveTo(x + a * 0.95, piso - a * 0.95, x + a * 1.55, piso - a * 0.95, x + a * 1.65, piso);
    ctx.fill();
    elip(ctx, x + a * 1.38, piso - a * 0.62, a * 0.12, a * 0.2, '#a2acb8');
    ctx.fillStyle = '#3f8a4a';
    ctx.beginPath();
    ctx.moveTo(x - a * 1.7, piso);
    ctx.quadraticCurveTo(x - a * 0.7, piso - a * 1.55, x, piso - a * 1.25);
    ctx.quadraticCurveTo(x + a * 0.45, piso - a * 1.05, x + a * 0.95, piso);
    ctx.fill();
    // Ladera izquierda en sombra.
    ctx.fillStyle = '#2f6e3c';
    ctx.beginPath();
    ctx.moveTo(x - a * 1.7, piso);
    ctx.quadraticCurveTo(x - a * 1.15, piso - a * 1.0, x - a * 0.55, piso - a * 1.15);
    ctx.quadraticCurveTo(x - a * 0.85, piso - a * 0.6, x - a * 0.8, piso);
    ctx.fill();
    ctx.fillStyle = '#6f7c88';
    ctx.beginPath();
    ctx.moveTo(x + a * 0.05, piso - a * 1.24);
    ctx.quadraticCurveTo(x + a * 0.45, piso - a * 1.0, x + a * 0.6, piso - a * 0.4);
    ctx.lineTo(x + a * 0.35, piso - a * 0.5);
    ctx.quadraticCurveTo(x + a * 0.2, piso - a * 0.95, x - a * 0.05, piso - a * 1.2);
    ctx.fill();
    // Copas de la selva asomando por la ladera.
    for (const [dx, dy, r] of [[-1.3, -0.3, 0.1], [-1.05, -0.62, 0.11], [-0.7, -0.92, 0.1], [-0.35, -1.08, 0.08], [-0.15, -0.75, 0.07], [0.1, -0.35, 0.08], [-0.55, -0.45, 0.07], [-0.95, -0.25, 0.08]]) {
      circ(ctx, x + dx * a, piso + dy * a, r * a, '#4b9e50');
      circ(ctx, x + (dx + r * 0.3) * a, piso + (dy - r * 0.3) * a, r * a * 0.55, '#6dc062');
    }
    // Cristo Redentor con su pedestal.
    const base = piso - a * 1.25;
    rect(ctx, x - a * 0.07, base - a * 0.08, a * 0.14, a * 0.08, '#cfc6b2');
    pol(ctx, [[x - a * 0.07, base - a * 0.08], [x - a * 0.04, base - a * 0.55], [x + a * 0.04, base - a * 0.55], [x + a * 0.07, base - a * 0.08]], '#f6f1e6');
    pol(ctx, [[x - a * 0.07, base - a * 0.08], [x - a * 0.04, base - a * 0.55], [x, base - a * 0.55], [x, base - a * 0.08]], '#d6cebe');
    rect(ctx, x - a * 0.34, base - a * 0.5, a * 0.68, a * 0.07, '#f6f1e6');
    rect(ctx, x - a * 0.34, base - a * 0.45, a * 0.68, a * 0.02, '#d6cebe');
    circ(ctx, x, base - a * 0.6, a * 0.055, '#f6f1e6');
    return 1.9;
  },
  chichen(ctx, x, piso, a) {
    for (let i = 0; i < 6; i++) {
      const w = (1.7 - i * 0.24) * a;
      const y = piso - (i + 1) * 0.17 * a;
      rect(ctx, x - w / 2, y, w, 0.17 * a, '#cfa56c');
      rect(ctx, x - w / 2, y, w * 0.3, 0.17 * a, '#a98150');
      rect(ctx, x - w / 2, y + 0.14 * a, w, 0.03 * a, '#8f6a3e');
      rect(ctx, x - w / 2, y, w, 0.02 * a, '#e7c48c');
    }
    // Escalinata central con sus escalones.
    rect(ctx, x - a * 0.13, piso - a * 1.02, a * 0.26, a * 1.02, '#b88e58');
    for (let y = piso - a * 0.98; y < piso; y += a * 0.06) rect(ctx, x - a * 0.13, y, a * 0.26, a * 0.02, '#8f6a3e');
    // Templo de arriba.
    rect(ctx, x - a * 0.3, piso - a * 1.3, a * 0.6, a * 0.28, '#cfa56c');
    rect(ctx, x - a * 0.3, piso - a * 1.3, a * 0.16, a * 0.28, '#a98150');
    rect(ctx, x - a * 0.34, piso - a * 1.34, a * 0.68, a * 0.05, '#e7c48c');
    rect(ctx, x - a * 0.07, piso - a * 1.22, a * 0.14, a * 0.2, '#4a3220');
    PIEZAS.palmera(ctx, x - a * 1.2, piso, a * 0.7);
    PIEZAS.palmera(ctx, x + a * 1.15, piso, a * 0.62);
    return 1.34;
  },
  libertad(ctx, x, piso, a) {
    // Manhattan atrás, con un rascacielos escalonado y su aguja.
    const torres = [[-2.1, 1.3, 0.3], [-1.75, 1.75, 0.28], [-1.4, 1.15, 0.32], [0.65, 1.45, 0.3], [1.0, 1.9, 0.26], [1.35, 1.25, 0.36], [1.75, 1.6, 0.28]];
    torres.forEach(([dx, h, w], i) => {
      const bx = x + dx * a;
      rect(ctx, bx, piso - h * a, w * a, h * a, '#7f8fb4');
      rect(ctx, bx, piso - h * a, w * a * 0.3, h * a, '#62719a');
      ventanas(ctx, bx + w * a * 0.3, piso - h * a + a * 0.04, w * a * 0.65, h * a - a * 0.06, a, i * 31 + 7, { apagada: '#55628a' });
    });
    const tx = x + a * 1.0;
    rect(ctx, tx + a * 0.06, piso - a * 2.15, a * 0.14, a * 0.25, '#7f8fb4');
    rect(ctx, tx + a * 0.115, piso - a * 2.4, a * 0.03, a * 0.25, '#c9d2e6');
    // Pedestal de piedra.
    rect(ctx, x - a * 0.24, piso - a * 0.55, a * 0.48, a * 0.55, '#b6a88c');
    rect(ctx, x - a * 0.24, piso - a * 0.55, a * 0.14, a * 0.55, '#968a70');
    for (let y = piso - a * 0.5; y < piso; y += a * 0.1) rect(ctx, x - a * 0.24, y, a * 0.48, a * 0.015, '#8a7e64');
    rect(ctx, x - a * 0.28, piso - a * 0.58, a * 0.56, a * 0.05, '#cdbf9f');
    // La estatua: túnica verde con sombra, cabeza, corona y antorcha.
    pol(ctx, [[x - a * 0.17, piso - a * 0.58], [x - a * 0.09, piso - a * 1.38], [x + a * 0.09, piso - a * 1.38], [x + a * 0.17, piso - a * 0.58]], '#7cc2a6');
    pol(ctx, [[x - a * 0.17, piso - a * 0.58], [x - a * 0.09, piso - a * 1.38], [x - a * 0.01, piso - a * 1.38], [x - a * 0.03, piso - a * 0.58]], '#58997f');
    rect(ctx, x - a * 0.2, piso - a * 1.1, a * 0.1, a * 0.14, '#58997f');
    circ(ctx, x, piso - a * 1.45, a * 0.075, '#7cc2a6');
    for (let i = -2; i <= 2; i++) rect(ctx, x + i * a * 0.04 - a * 0.01, piso - a * 1.6 + Math.abs(i) * a * 0.025, a * 0.02, a * 0.08, '#9fd8c2');
    rect(ctx, x + a * 0.06, piso - a * 1.9, a * 0.06, a * 0.55, '#7cc2a6');
    rect(ctx, x + a * 0.045, piso - a * 1.95, a * 0.09, a * 0.05, '#c9a83a');
    pol(ctx, [[x + a * 0.05, piso - a * 1.96], [x + a * 0.09, piso - a * 2.1], [x + a * 0.13, piso - a * 1.96]], '#ffb347');
    pol(ctx, [[x + a * 0.07, piso - a * 1.96], [x + a * 0.09, piso - a * 2.04], [x + a * 0.11, piso - a * 1.96]], '#ffe45f');
    return 2.4;
  },
  bigben(ctx, x, piso, a) {
    // Parlamento con ventanas góticas y torrecitas.
    rect(ctx, x - a * 1.6, piso - a * 0.62, a * 1.4, a * 0.62, '#c9a46a');
    rect(ctx, x - a * 1.6, piso - a * 0.62, a * 1.4, a * 0.04, '#e3c48d');
    for (let vx = x - a * 1.52; vx < x - a * 0.3; vx += a * 0.14) {
      rect(ctx, vx, piso - a * 0.5, a * 0.05, a * 0.18, '#6b5536');
      rect(ctx, vx, piso - a * 0.24, a * 0.05, a * 0.14, '#6b5536');
    }
    for (const dx of [-1.6, -1.1, -0.6]) pol(ctx, [[x + dx * a, piso - a * 0.62], [x + (dx + 0.05) * a, piso - a * 0.8], [x + (dx + 0.1) * a, piso - a * 0.62]], '#8a6a3c');
    // Torre Elizabeth: fuste, reloj, campanario y aguja.
    rect(ctx, x - a * 0.17, piso - a * 1.45, a * 0.34, a * 1.45, '#d4b07a');
    rect(ctx, x - a * 0.17, piso - a * 1.45, a * 0.1, a * 1.45, '#a8874f');
    for (let vy = piso - a * 1.35; vy < piso - a * 0.1; vy += a * 0.16) rect(ctx, x - a * 0.02, vy, a * 0.04, a * 0.1, '#7a6038');
    rect(ctx, x - a * 0.21, piso - a * 1.72, a * 0.42, a * 0.3, '#d4b07a');
    rect(ctx, x - a * 0.21, piso - a * 1.72, a * 0.12, a * 0.3, '#a8874f');
    circ(ctx, x + a * 0.02, piso - a * 1.57, a * 0.12, '#c9a83a');
    circ(ctx, x + a * 0.02, piso - a * 1.57, a * 0.1, '#fffbe8');
    ctx.strokeStyle = '#3a2f22';
    ctx.lineWidth = a * 0.022;
    ctx.beginPath();
    ctx.moveTo(x + a * 0.02, piso - a * 1.57);
    ctx.lineTo(x + a * 0.02, piso - a * 1.65);
    ctx.moveTo(x + a * 0.02, piso - a * 1.57);
    ctx.lineTo(x + a * 0.08, piso - a * 1.56);
    ctx.stroke();
    rect(ctx, x - a * 0.18, piso - a * 1.9, a * 0.36, a * 0.18, '#d4b07a');
    for (const dx of [-0.12, -0.02, 0.08]) rect(ctx, x + dx * a, piso - a * 1.86, a * 0.05, a * 0.11, '#5c4a32');
    pol(ctx, [[x - a * 0.2, piso - a * 1.9], [x, piso - a * 2.35], [x + a * 0.2, piso - a * 1.9]], '#5f6e6a');
    pol(ctx, [[x - a * 0.2, piso - a * 1.9], [x, piso - a * 2.35], [x - a * 0.03, piso - a * 1.9]], '#46534f');
    rect(ctx, x - a * 0.01, piso - a * 2.45, a * 0.025, a * 0.12, '#e8c14a');
    return 2.45;
  },
  eiffel(ctx, x, piso, a) {
    PIEZAS.arbol(ctx, x - a * 0.95, piso, a * 0.5);
    PIEZAS.arbol(ctx, x + a * 1.0, piso, a * 0.46);
    const pata = (t, lado) => {
      const u = 1 - t;
      return [x + lado * (u * u * 0.78 + 2 * u * t * 0.2 + t * t * 0.05) * a, piso - (2 * u * t * 1 + t * t * 2.3) * a];
    };
    ctx.lineJoin = 'round';
    for (const [lado, color, grosor] of [[-1, '#5e4532', 0.06], [1, '#8a674c', 0.06]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = a * grosor;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const [px, py] = pata(i / 20, lado);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    // Reticulado en cruz entre las patas.
    ctx.strokeStyle = '#6f523c';
    ctx.lineWidth = a / 34;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const [ia, ib] = [pata(i / 7, -1), pata((i + 1) / 7, -1)];
      const [da, db] = [pata(i / 7, 1), pata((i + 1) / 7, 1)];
      ctx.moveTo(...ia);
      ctx.lineTo(...db);
      ctx.moveTo(...da);
      ctx.lineTo(...ib);
    }
    ctx.stroke();
    // Arco de la base y plataformas con baranda.
    ctx.strokeStyle = '#7a5c44';
    ctx.lineWidth = a * 0.05;
    ctx.beginPath();
    ctx.arc(x, piso + a * 0.05, a * 0.42, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    for (const [t, w] of [[0.27, 0.62], [0.55, 0.36], [0.86, 0.14]]) {
      const [, py] = pata(t, 1);
      rect(ctx, x - w * a, py - a * 0.06, w * 2 * a, a * 0.07, '#8a674c');
      rect(ctx, x - w * a, py - a * 0.06, w * 0.6 * a, a * 0.07, '#5e4532');
      rect(ctx, x - w * a, py - a * 0.1, w * 2 * a, a * 0.02, '#a9876a');
    }
    rect(ctx, x - a * 0.015, piso - a * 2.55, a * 0.03, a * 0.26, '#8a674c');
    return 2.55;
  },
  coliseo(ctx, x, piso, a) {
    // Muro elíptico, más bajo y roto del lado izquierdo.
    const alto = (f) => (f < 0.35 ? lerp(0.62, 0.98, f / 0.35) - (Math.floor(f * 20) % 2) * 0.06 : 0.98 + (f - 0.35) * 0.05);
    for (let f = 0; f < 1; f += 0.02) {
      const bx = x - a * 1.25 + f * a * 2.5;
      rect(ctx, bx, piso - alto(f) * a, a * 0.052, alto(f) * a, f < 0.3 ? '#c4a275' : '#dcbd8e');
    }
    rect(ctx, x - a * 1.25, piso - a * 0.05, a * 2.5, a * 0.05, '#b39368');
    // Tres hileras de arcos (interior oscuro, pilares claros).
    for (let fila = 0; fila < 3; fila++) {
      for (let i = 0; i < 10; i++) {
        const f = (i + 0.5) / 10;
        if (fila === 2 && f < 0.3) continue;
        const ax = x - a * 1.18 + i * a * 0.245;
        const ay = piso - (0.08 + fila * 0.24) * a;
        ctx.fillStyle = '#6d4f30';
        ctx.beginPath();
        ctx.roundRect(ax, ay - a * 0.17, a * 0.12, a * 0.17, [a * 0.06, a * 0.06, 0, 0]);
        ctx.fill();
        rect(ctx, ax + a * 0.12, ay - a * 0.17, a * 0.03, a * 0.17, '#f0d5a6');
      }
      rect(ctx, x - a * 1.25, piso - (0.27 + fila * 0.24) * a, a * 2.5, a * 0.025, '#b39368');
    }
    PIEZAS.cipres(ctx, x - a * 1.5, piso, a * 0.75);
    PIEZAS.cipres(ctx, x + a * 1.45, piso, a * 0.68);
    return 1.04;
  },
  piramides(ctx, x, piso, a) {
    for (const [dx, h] of [[-1.0, 0.78], [1.0, 1.08], [0, 1.5]]) {
      const cx = x + dx * a;
      const w = h * 0.86 * a;
      pol(ctx, [[cx - w, piso], [cx, piso - h * a], [cx + w, piso]], '#ecc27a');
      pol(ctx, [[cx - w, piso], [cx, piso - h * a], [cx + w * 0.18, piso]], '#c99652');
      // Hiladas de bloques.
      ctx.strokeStyle = 'rgb(150 104 52 / .9)';
      ctx.lineWidth = a * 0.018;
      ctx.beginPath();
      for (let f = 0.15; f < 1; f += 0.15) {
        const y = piso - f * h * a;
        ctx.moveTo(cx - w * (1 - f) + a * 0.02, y);
        ctx.lineTo(cx + w * (1 - f) - a * 0.02, y);
      }
      ctx.stroke();
      if (dx === 0) pol(ctx, [[cx - w * 0.08, piso - h * a * 0.92], [cx, piso - h * a], [cx + w * 0.08, piso - h * a * 0.92]], '#fff2c8');
    }
    // Esfinge chiquita adelante.
    const sx = x - a * 1.75;
    rect(ctx, sx - a * 0.28, piso - a * 0.14, a * 0.46, a * 0.14, '#d9ad66');
    rect(ctx, sx + a * 0.1, piso - a * 0.3, a * 0.14, a * 0.2, '#d9ad66');
    rect(ctx, sx + a * 0.08, piso - a * 0.32, a * 0.18, a * 0.06, '#b48443');
    rect(ctx, sx - a * 0.28, piso - a * 0.14, a * 0.12, a * 0.14, '#b48443');
    PIEZAS.palmera(ctx, x + a * 1.95, piso, a * 0.72);
    PIEZAS.palmera(ctx, x + a * 2.3, piso, a * 0.55);
    return 1.5;
  },
  kilimanjaro(ctx, x, piso, a) {
    pol(ctx, [[x - a * 2.2, piso], [x - a * 0.5, piso - a * 1.35], [x + a * 0.5, piso - a * 1.4], [x + a * 2.2, piso]], '#9c7a62');
    pol(ctx, [[x - a * 2.2, piso], [x - a * 0.5, piso - a * 1.35], [x - a * 0.1, piso - a * 1.37], [x - a * 0.6, piso]], '#7a5c48');
    // Meseta nevada con chorreaduras.
    const nieve = [[x - a * 0.68, piso - a * 1.18], [x - a * 0.5, piso - a * 1.35], [x + a * 0.5, piso - a * 1.4], [x + a * 0.7, piso - a * 1.2]];
    for (let f = 0.7; f >= -0.68; f -= 0.12) nieve.push([x + f * a, piso - a * (1.2 + (Math.round(f * 10) % 2 ? 0.05 : -0.04))]);
    pol(ctx, nieve, '#ffffff');
    pol(ctx, [[x - a * 0.68, piso - a * 1.18], [x - a * 0.5, piso - a * 1.35], [x - a * 0.1, piso - a * 1.37], [x - a * 0.2, piso - a * 1.2]], '#d4e0f2');
    PIEZAS.acacia(ctx, x - a * 1.3, piso, a * 0.7);
    PIEZAS.acacia(ctx, x + a * 1.5, piso, a * 0.62);
    PIEZAS.jirafa(ctx, x + a * 0.6, piso, a * 0.75);
    return 1.4;
  },
  tajmahal(ctx, x, piso, a) {
    const blanco = '#f7f1e8';
    const sombra = '#dccbc0';
    // Espejo de agua con su reflejo y cipreses.
    rect(ctx, x - a * 1.3, piso - a * 0.06, a * 2.6, a * 0.06, '#7fb8e0');
    rect(ctx, x - a * 1.1, piso - a * 0.18, a * 2.2, a * 0.12, '#e8ddd0');
    rect(ctx, x - a * 0.62, piso - a * 0.8, a * 1.24, a * 0.62, blanco);
    rect(ctx, x - a * 0.62, piso - a * 0.8, a * 0.3, a * 0.62, sombra);
    // Arco principal y arcos laterales.
    for (const [dx, w, h] of [[0, 0.3, 0.46], [-0.42, 0.13, 0.22], [0.42, 0.13, 0.22], [-0.42, 0.13, -0.05], [0.42, 0.13, -0.05]]) {
      const base = h > 0 ? piso - a * 0.22 : piso - a * 0.5;
      const alto = Math.abs(h) || 0.22;
      ctx.fillStyle = '#b9a698';
      ctx.beginPath();
      ctx.roundRect(x + dx * a - (w * a) / 2, base - alto * a, w * a, alto * a, [(w * a) / 2, (w * a) / 2, 0, 0]);
      ctx.fill();
    }
    // Cúpula de cebolla con remate dorado y cupulitas.
    rect(ctx, x - a * 0.3, piso - a * 0.9, a * 0.6, a * 0.1, blanco);
    ctx.fillStyle = blanco;
    ctx.beginPath();
    ctx.moveTo(x - a * 0.36, piso - a * 0.9);
    ctx.bezierCurveTo(x - a * 0.52, piso - a * 1.35, x - a * 0.06, piso - a * 1.38, x, piso - a * 1.6);
    ctx.bezierCurveTo(x + a * 0.06, piso - a * 1.38, x + a * 0.52, piso - a * 1.35, x + a * 0.36, piso - a * 0.9);
    ctx.fill();
    ctx.fillStyle = sombra;
    ctx.beginPath();
    ctx.moveTo(x - a * 0.36, piso - a * 0.9);
    ctx.bezierCurveTo(x - a * 0.52, piso - a * 1.35, x - a * 0.06, piso - a * 1.38, x, piso - a * 1.6);
    ctx.lineTo(x - a * 0.1, piso - a * 0.9);
    ctx.fill();
    rect(ctx, x - a * 0.012, piso - a * 1.72, a * 0.025, a * 0.13, '#d9a93a');
    for (const dx of [-0.48, 0.48]) {
      rect(ctx, x + dx * a - a * 0.07, piso - a * 0.98, a * 0.14, a * 0.18, blanco);
      ctx.fillStyle = blanco;
      ctx.beginPath();
      ctx.arc(x + dx * a, piso - a * 0.98, a * 0.08, Math.PI, 0);
      ctx.fill();
    }
    // Cuatro minaretes con anillos.
    for (const dx of [-1.05, -0.82, 0.82, 1.05]) {
      const mx = x + dx * a;
      rect(ctx, mx - a * 0.04, piso - a * 1.1, a * 0.08, a * 1.04, blanco);
      rect(ctx, mx - a * 0.04, piso - a * 1.1, a * 0.025, a * 1.04, sombra);
      for (const f of [0.35, 0.65, 0.95]) rect(ctx, mx - a * 0.055, piso - a * f * 1.1, a * 0.11, a * 0.025, sombra);
      ctx.fillStyle = blanco;
      ctx.beginPath();
      ctx.arc(mx, piso - a * 1.1, a * 0.06, Math.PI, 0);
      ctx.fill();
    }
    PIEZAS.cipres(ctx, x - a * 1.45, piso, a * 0.62);
    PIEZAS.cipres(ctx, x + a * 1.45, piso, a * 0.62);
    return 1.72;
  },
  muralla(ctx, x, piso, a) {
    const cresta = (f) => piso - (0.55 + Math.sin(f * 2.6) * 0.22 + Math.sin(f * 6.1 + 1) * 0.06) * a;
    // Colinas verdes con sombra.
    ctx.fillStyle = '#4f9a5a';
    ctx.beginPath();
    ctx.moveTo(x - a * 2.6, piso);
    for (let f = -2.6; f <= 2.6; f += 0.1) ctx.lineTo(x + f * a, cresta(f) + a * 0.05);
    ctx.lineTo(x + a * 2.6, piso);
    ctx.fill();
    for (let f = -2.5; f <= 2.5; f += 0.5) circ(ctx, x + f * a, cresta(f) + a * 0.32, a * 0.1, '#3d8048');
    // Muralla siguiendo la cresta, con almenas.
    ctx.strokeStyle = '#a99273';
    ctx.lineWidth = a * 0.09;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let f = -2.6; f <= 2.6; f += 0.1) f === -2.6 ? ctx.moveTo(x + f * a, cresta(f)) : ctx.lineTo(x + f * a, cresta(f));
    ctx.stroke();
    for (let f = -2.55; f <= 2.55; f += 0.12) rect(ctx, x + f * a - a * 0.02, cresta(f) - a * 0.085, a * 0.04, a * 0.04, '#c7b18e');
    // Torres de vigilancia con techo.
    for (const f of [-1.9, -0.5, 0.9, 2.2]) {
      const tx = x + f * a;
      const ty = cresta(f);
      rect(ctx, tx - a * 0.12, ty - a * 0.32, a * 0.24, a * 0.32, '#bba37f');
      rect(ctx, tx - a * 0.12, ty - a * 0.32, a * 0.07, a * 0.32, '#93805f');
      rect(ctx, tx - a * 0.03, ty - a * 0.24, a * 0.06, a * 0.08, '#4a3c2a');
      pol(ctx, [[tx - a * 0.17, ty - a * 0.32], [tx, ty - a * 0.45], [tx + a * 0.17, ty - a * 0.32]], '#7a3b2e');
    }
    return 1.15;
  },
  fuji(ctx, x, piso, a) {
    pol(ctx, [[x - a * 2.3, piso], [x - a * 0.32, piso - a * 1.72], [x + a * 0.32, piso - a * 1.72], [x + a * 2.3, piso]], '#6f7fb0');
    pol(ctx, [[x - a * 2.3, piso], [x - a * 0.32, piso - a * 1.72], [x - a * 0.05, piso - a * 1.72], [x - a * 0.9, piso]], '#55639a');
    const nieve = [[x - a * 0.32, piso - a * 1.72], [x + a * 0.32, piso - a * 1.72]];
    for (let f = 0.68; f >= -0.68; f -= 0.17) nieve.push([x + f * a, piso - a * (1.25 + (Math.round(f * 6) % 2 ? 0.1 : -0.05))]);
    pol(ctx, nieve, '#ffffff');
    pol(ctx, [[x - a * 0.32, piso - a * 1.72], [x - a * 0.05, piso - a * 1.72], [x - a * 0.25, piso - a * 1.3], [x - a * 0.68, piso - a * 1.22]], '#cdd8f0');
    // Torii rojo y cerezos.
    const tx = x + a * 1.45;
    rect(ctx, tx - a * 0.3, piso - a * 0.62, a * 0.07, a * 0.62, '#d23c48');
    rect(ctx, tx + a * 0.23, piso - a * 0.62, a * 0.07, a * 0.62, '#d23c48');
    rect(ctx, tx - a * 0.42, piso - a * 0.7, a * 0.84, a * 0.08, '#e8505c');
    rect(ctx, tx - a * 0.46, piso - a * 0.74, a * 0.92, a * 0.04, '#3a2a2e');
    rect(ctx, tx - a * 0.32, piso - a * 0.52, a * 0.64, a * 0.05, '#d23c48');
    PIEZAS.cerezo(ctx, x - a * 1.3, piso, a * 0.6);
    PIEZAS.cerezo(ctx, x + a * 2.1, piso, a * 0.55);
    return 1.72;
  },
  opera(ctx, x, piso, a) {
    // Harbour Bridge atrás.
    ctx.strokeStyle = '#7d8696';
    ctx.lineWidth = a * 0.06;
    ctx.beginPath();
    ctx.moveTo(x - a * 2.4, piso - a * 0.2);
    ctx.quadraticCurveTo(x - a * 1.6, piso - a * 1.1, x - a * 0.8, piso - a * 0.2);
    ctx.stroke();
    rect(ctx, x - a * 2.5, piso - a * 0.42, a * 1.8, a * 0.05, '#7d8696');
    for (const dx of [-2.5, -0.82]) rect(ctx, x + dx * a, piso - a * 0.6, a * 0.12, a * 0.6, '#b9b1a0');
    // Base y velas con nervaduras.
    rect(ctx, x - a * 1.25, piso - a * 0.18, a * 2.5, a * 0.18, '#d8c5a6');
    rect(ctx, x - a * 1.25, piso - a * 0.18, a * 2.5, a * 0.03, '#efe0c4');
    for (const [dx, h, w] of [[-0.85, 0.6, 0.55], [-0.38, 0.92, 0.66], [0.22, 0.82, 0.6], [0.7, 0.55, 0.48]]) {
      const bx = x + dx * a;
      ctx.fillStyle = '#fbfaf3';
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.5 * a, piso - a * 0.18);
      ctx.quadraticCurveTo(bx - w * 0.2 * a, piso - (0.18 + h) * a, bx + w * 0.5 * a, piso - (0.18 + h) * a);
      ctx.lineTo(bx + w * 0.22 * a, piso - a * 0.18);
      ctx.fill();
      ctx.fillStyle = '#d4dae6';
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.5 * a, piso - a * 0.18);
      ctx.quadraticCurveTo(bx - w * 0.2 * a, piso - (0.18 + h) * a, bx + w * 0.5 * a, piso - (0.18 + h) * a);
      ctx.lineTo(bx - w * 0.1 * a, piso - a * 0.18);
      ctx.fill();
      ctx.strokeStyle = '#c3cad8';
      ctx.lineWidth = a * 0.015;
      ctx.beginPath();
      for (let f = 0.25; f < 1; f += 0.25) {
        ctx.moveTo(bx - w * 0.5 * a + f * w * a * 0.6, piso - a * 0.18);
        ctx.lineTo(bx + w * 0.5 * a - (1 - f) * w * a * 0.2, piso - (0.18 + h * (1 - f * 0.1)) * a);
      }
      ctx.stroke();
    }
    return 1.12;
  },
  uluru(ctx, x, piso, a) {
    ctx.fillStyle = '#c4572e';
    ctx.beginPath();
    ctx.moveTo(x - a * 1.7, piso);
    ctx.bezierCurveTo(x - a * 1.5, piso - a * 0.85, x + a * 1.3, piso - a * 0.9, x + a * 1.7, piso);
    ctx.fill();
    ctx.fillStyle = '#e07a45';
    ctx.beginPath();
    ctx.moveTo(x - a * 1.2, piso - a * 0.55);
    ctx.bezierCurveTo(x - a * 0.8, piso - a * 0.72, x + a * 0.9, piso - a * 0.74, x + a * 1.35, piso - a * 0.45);
    ctx.lineTo(x + a * 1.2, piso - a * 0.38);
    ctx.bezierCurveTo(x + a * 0.6, piso - a * 0.62, x - a * 0.6, piso - a * 0.6, x - a * 1.2, piso - a * 0.48);
    ctx.fill();
    ctx.strokeStyle = '#8f3a1e';
    ctx.lineWidth = a * 0.03;
    ctx.beginPath();
    for (let i = -3; i <= 3; i++) {
      ctx.moveTo(x + i * 0.4 * a, piso - a * 0.62 + Math.abs(i) * a * 0.08);
      ctx.lineTo(x + i * 0.46 * a, piso);
    }
    ctx.stroke();
    for (const [dx, dy] of [[-0.6, -0.3], [0.35, -0.25], [0.9, -0.2]]) elip(ctx, x + dx * a, piso + dy * a, a * 0.07, a * 0.04, '#7a2a14');
    PIEZAS.arbusto(ctx, x - a * 2.0, piso, a * 0.5);
    PIEZAS.arbusto(ctx, x + a * 2.0, piso, a * 0.45);
    return 0.88;
  },
  pinguinos(ctx, x, piso, a, v) {
    pol(ctx, [[x - a * 2.2, piso], [x - a * 1.8, piso - a * 0.95], [x - a * 1.1, piso - a * 1.12], [x - a * 0.65, piso]], '#e8f6ff');
    pol(ctx, [[x - a * 1.1, piso - a * 1.12], [x - a * 0.65, piso], [x - a * 1.25, piso]], '#ffffff');
    pol(ctx, [[x - a * 2.2, piso], [x - a * 1.8, piso - a * 0.95], [x - a * 1.6, piso]], '#a9d4f0');
    for (let i = 0; i < 5; i++) {
      const px = x + (i * 0.3 - 0.1) * a;
      const balanceo = v.reducido ? 0 : Math.round(Math.sin(v.reloj * 3 + i)) * a * 0.02;
      elip(ctx, px + balanceo, piso - a * 0.25, a * 0.11, a * 0.25, '#1f2236');
      elip(ctx, px + balanceo + a * 0.035, piso - a * 0.21, a * 0.065, a * 0.17, '#fff8ea');
      circ(ctx, px + balanceo + a * 0.04, piso - a * 0.4, a * 0.018, '#ffffff');
      rect(ctx, px + balanceo + a * 0.07, piso - a * 0.43, a * 0.08, a * 0.03, '#f18a52');
      rect(ctx, px + balanceo - a * 0.06, piso - a * 0.02, a * 0.12, a * 0.03, '#f18a52');
    }
    return 1.12;
  },
  base(ctx, x, piso, a) {
    for (const [dx, w, h] of [[-1.1, 0.9, 0.48], [0.05, 0.8, 0.36]]) {
      rect(ctx, x + dx * a, piso - h * a, w * a, h * a, '#f18a52');
      rect(ctx, x + dx * a, piso - h * a, w * a * 0.22, h * a, '#c8673a');
      rect(ctx, x + dx * a, piso - h * a, w * a, a * 0.04, '#ffb07a');
      for (let i = 0; i < 3; i++) rect(ctx, x + (dx + 0.28 + i * 0.2) * a, piso - h * a + a * 0.12, a * 0.11, a * 0.1, '#fff3c4');
    }
    // Antena, radar y bandera argentina.
    rect(ctx, x + a * 1.1, piso - a * 1.25, a * 0.035, a * 1.25, '#9aa3bd');
    circ(ctx, x + a * 0.5, piso - a * 0.5, a * 0.1, '#dfe7ee');
    const bx = x + a * 1.135;
    const by = piso - a * 1.22;
    rect(ctx, bx, by, a * 0.45, a * 0.1, '#74acdf');
    rect(ctx, bx, by + a * 0.1, a * 0.45, a * 0.1, '#ffffff');
    rect(ctx, bx, by + a * 0.2, a * 0.45, a * 0.1, '#74acdf');
    circ(ctx, bx + a * 0.225, by + a * 0.15, a * 0.035, '#f6c94c');
    return 1.3;
  },
};

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function crearPaisajeGeografia() {
  const nubes = Array.from({ length: 34 }, (_, i) => {
    const azar = generador(i * 53 + 11);
    return { x: azar() * 2400, y: azar(), escala: 0.6 + azar() * 0.9, capa: azar() < 0.55 ? 0.25 : 0.5, forma: azar() };
  });
  const nubesCerca = Array.from({ length: 12 }, (_, i) => {
    const azar = generador(i * 97 + 5);
    return { x: azar() * 3200, y: azar(), escala: 0.8 + azar() * 0.6, forma: azar() };
  });
  const noche = (x) => limitar((x - 6050) / 250, 0, 1);

  // ───── Fondo ─────
  function cielo(ctx, v, piso) {
    const [arriba, medio, horizonte] = [1, 2, 3].map((c) => interpolar(CIELOS, v.x, c));
    const g = ctx.createLinearGradient(0, 0, 0, piso);
    g.addColorStop(0, rgb(arriba));
    g.addColorStop(0.55, rgb(medio));
    g.addColorStop(1, rgb(horizonte));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, v.W, v.H);
    // Sol (alto en América, bajo en el atardecer africano) o luna, con su halo.
    const bajo = limitar((v.x - 3000) / 1000, 0, 1) - limitar((v.x - 5000) / 700, 0, 1);
    const sx = v.W * 0.82;
    const sy = lerp(v.H * 0.16, piso - v.alto * 1.2, Math.max(0, bajo) * 0.8);
    const r = v.alto * 0.17;
    const esNoche = noche(v.x) > 0.5;
    const halo = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, r * 4);
    halo.addColorStop(0, esNoche ? 'rgb(220 230 255 / .35)' : 'rgb(255 244 190 / .55)');
    halo.addColorStop(1, 'rgb(255 244 190 / 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
    circ(ctx, sx, sy, r, esNoche ? '#eef3ff' : bajo > 0.4 ? '#ffb36d' : '#fff1a0');
    if (esNoche) {
      circ(ctx, sx - r * 0.3, sy - r * 0.2, r * 0.22, '#cfd7ef');
      circ(ctx, sx + r * 0.35, sy + r * 0.3, r * 0.15, '#cfd7ef');
    }
    const n = noche(v.x);
    if (n > 0) {
      ctx.save();
      ctx.globalAlpha = n;
      for (let i = 0; i < 70; i++) {
        const azar = generador(i * 17 + 3);
        const t = v.reducido ? 1 : 0.6 + 0.4 * Math.sin(v.reloj * 2 + i);
        ctx.fillStyle = `rgb(255 255 255 / ${t})`;
        ctx.fillRect(azar() * v.W, azar() * piso * 0.65, azar() < 0.2 ? 5 : 3, azar() < 0.2 ? 5 : 3);
      }
      // Aurora austral: cortinas verdes y celestes que ondulan.
      ctx.globalCompositeOperation = 'lighter';
      for (let banda = 0; banda < 4; banda++) {
        const y0 = piso * (0.14 + banda * 0.07);
        for (let x = 0; x < v.W; x += 8) {
          const fase = v.reducido ? 0 : v.reloj * 0.5;
          const y = y0 + Math.sin(x * 0.006 + banda * 1.3 + fase) * v.alto * 0.18;
          const alto = v.alto * (0.35 + 0.25 * Math.sin(x * 0.013 + banda));
          const grad = ctx.createLinearGradient(0, y, 0, y + alto);
          grad.addColorStop(0, banda % 2 ? 'rgb(120 237 242 / 0)' : 'rgb(95 211 141 / 0)');
          grad.addColorStop(0.4, banda % 2 ? 'rgb(120 237 242 / .22)' : 'rgb(95 211 141 / .28)');
          grad.addColorStop(1, 'rgb(95 211 141 / 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, 8, alto);
        }
      }
      ctx.restore();
    }
  }

  /** Nube de tres tonos: panza en sombra, cuerpo claro y brillo arriba. */
  function nube(ctx, x, y, r, forma, [luz, cuerpo, sombra]) {
    const copos = [[-1.35, 0.05, 0.75], [-0.6, -0.35, 1.0], [0.3, -0.55 - forma * 0.3, 1.15], [1.15, -0.1, 0.85], [1.8, 0.15, 0.55]];
    ctx.fillStyle = sombra;
    ctx.beginPath();
    ctx.roundRect(x - r * 2.2, y - r * 0.1, r * 4.6, r * 0.75, r * 0.38);
    ctx.fill();
    ctx.fillStyle = cuerpo;
    ctx.beginPath();
    for (const [dx, dy, rr] of copos) ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sombra;
    ctx.beginPath();
    ctx.roundRect(x - r * 2.1, y + r * 0.15, r * 4.4, r * 0.45, r * 0.22);
    ctx.fill();
    ctx.fillStyle = luz;
    ctx.beginPath();
    for (const [dx, dy, rr] of copos) ctx.arc(x + dx * r + rr * r * 0.18, y + dy * r - rr * r * 0.22, rr * r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }

  function tonosNube(v) {
    if (noche(v.x) > 0.5) return ['#7c86b8', '#5a6496', '#3d4675'];
    const horizonte = interpolar(CIELOS, v.x, 3);
    return ['#ffffff', rgb(mezcla([246, 250, 255], horizonte, 0.25)), rgb(mezcla(interpolar(CIELOS, v.x, 2), [120, 140, 190], 0.35))];
  }

  function nubesLejanas(ctx, v, piso) {
    const tonos = tonosNube(v);
    for (const n of nubes) {
      const ancho = 2400;
      const cx = ((n.x - v.x * n.capa) % ancho + ancho) % ancho;
      const x = v.anclaX + (cx - ancho / 2) * v.k;
      if (x < -300 || x > v.W + 300) continue;
      const y = (piso - v.alto * 0.9) * n.y * 0.85 + v.alto * 0.25;
      nube(ctx, x, y, v.alto * 0.12 * n.escala, n.forma, tonos);
    }
  }

  // Dos cordones de sierras con ruido fractal: el lejano se funde con el cielo; el cercano tiene
  // laderas con luz y sombra y nieve en las cumbres más altas.
  function sierras(ctx, v, piso) {
    const P = v.P * 2;
    const horizonte = interpolar(CIELOS, v.x, 3);
    const luz = interpolar(SIERRAS, v.x, 1);
    const sombra = interpolar(SIERRAS, v.x, 2);
    const nieveSombra = rgb(interpolar(SIERRAS, v.x, 3));
    for (const [par, frecuencia, altoBase, bruma, conNieve] of [[0.15, 0.011, 1.3, 0.55, false], [0.32, 0.016, 1.05, 0.2, true]]) {
      const alturaEn = (sx) => {
        const m = (sx - v.anclaX) / v.k + v.x * par;
        const mar = enMar(m / par) ? 0.35 : 1;
        return (0.2 + cordillera(m * frecuencia) * altoBase) * v.alto * mar;
      };
      const vecindad = P * 4;
      for (let sx = 0; sx < v.W + P; sx += P) {
        const h = alturaEn(sx);
        // La ladera que sube hacia la derecha mira a la izquierda: queda en sombra.
        const sube = alturaEn(sx + vecindad) > alturaEn(sx - vecindad);
        const color = mezcla(sube ? sombra : luz, horizonte, bruma);
        ctx.fillStyle = rgb(color);
        ctx.fillRect(sx, piso - h, P, h + P);
        if (conNieve && h > v.alto * 0.95) {
          const nieve = (h - v.alto * 0.95) * 0.7 + P;
          ctx.fillStyle = sube ? nieveSombra : '#f4f8fc';
          ctx.fillRect(sx, piso - h, P, nieve);
        }
      }
    }
    // Bruma sobre el horizonte.
    const g = ctx.createLinearGradient(0, piso - v.alto * 0.5, 0, piso);
    g.addColorStop(0, `rgb(${horizonte.join(' ')} / 0)`);
    g.addColorStop(1, `rgb(${horizonte.join(' ')} / .55)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, piso - v.alto * 0.5, v.W, v.alto * 0.5);
  }

  // ───── Medio ─────
  // Colinas cercanas (solo sobre tierra), con borde iluminado y manchas de arbustos.
  function colinas(ctx, v, piso) {
    const P = v.P;
    const par = 0.65;
    for (let sx = 0; sx < v.W + P; sx += P) {
      const m = (sx - v.anclaX) / v.k + v.x * par;
      const mundo = v.x + (sx - v.anclaX) / v.k;
      if (enMar(mundo) || mundo < 80) continue;
      const h = Math.round(((0.12 + fractal(m * 0.035) * 0.42) * v.alto) / P) * P;
      const [base, claro, oscuro] = [1, 2, 3].map((c) => interpolar(SUELOS, mundo, c));
      const tono = mezcla(base, oscuro, 0.35);
      ctx.fillStyle = rgb(tono);
      ctx.fillRect(sx, piso - h, P, h);
      ctx.fillStyle = rgb(mezcla(claro, tono, 0.4));
      ctx.fillRect(sx, piso - h, P, P);
      if (Math.floor(m * 0.9) % 7 === 0) {
        ctx.fillStyle = rgb(mezcla(oscuro, [20, 40, 30], 0.3));
        ctx.fillRect(sx, piso - h + P * 3, P, P * 2);
      }
    }
  }

  function decorado(ctx, v, piso) {
    const paso = 24;
    const i0 = Math.floor((v.x - v.anclaX / v.k) / paso) - 2;
    const i1 = Math.ceil((v.x + (v.W - v.anclaX) / v.k) / paso) + 2;
    for (let i = i0; i <= i1; i++) {
      const azar = generador(i * 7349 + 13);
      const xm = i * paso + azar() * paso * 0.7;
      if (enMar(xm) || LUGARES.some((l) => Math.abs(l.x - xm) < 110)) continue;
      const region = DECORADO.find(([d, h]) => xm >= d && xm < h);
      if (!region || azar() > region[3]) continue;
      const tipo = region[2][Math.floor(azar() * region[2].length)];
      const s = v.alto * (0.32 + azar() * 0.3) * (tipo === 'casita' || tipo === 'pagoda' ? 0.9 : 1);
      PIEZAS[tipo](ctx, v.anclaX + (xm - v.x) * v.k, piso + v.P, s);
    }
  }

  function monumentos(ctx, v, piso) {
    const margen = v.alto * 3;
    const carteles = [];
    for (const lugar of LUGARES) {
      const x = v.anclaX + (lugar.x - v.x) * v.k;
      if (x < -margen || x > v.W + margen) continue;
      const alto = MONUMENTOS[lugar.tipo](ctx, x, piso + v.P, v.alto, v);
      carteles.push({ lugar, x, y: piso - (alto + 0.25) * v.alto });
    }
    return carteles;
  }

  // Suelo: pasto con matas y flores, arena con ondas, hielo con grietas o mar con espuma y veleros.
  function suelo(ctx, v, piso) {
    const P = v.P;
    const base = v.snap(piso);
    const ola = v.reducido ? 0 : v.reloj * 2.5;
    for (let sx = 0; sx < v.W + P; sx += P) {
      const m = v.x + (sx - v.anclaX) / v.k;
      const col = Math.round((m * v.k) / P); // columna del mundo: los detalles se mueven con el paisaje
      const azar = hash(col);
      if (enMar(m)) {
        const costa = MARES.some(([a2, b]) => Math.abs(m - a2) < 9 || Math.abs(m - b) < 9);
        const cresta = base + P * Math.round(1 + Math.sin(col * 0.18 + ola) * 1.2);
        const franjas = [['#5aa6e0', 2], ['#3b8cd2', 3], ['#2a73bb', 4], ['#215fa3', 6], ['#1b4f8c', 40]];
        let y = cresta;
        rect(ctx, sx, base, P, cresta - base, '#7fc0ec');
        for (const [color, filas] of franjas) {
          rect(ctx, sx, y, P, filas * P, color);
          y += filas * P;
        }
        rect(ctx, sx, cresta, P, P, '#ffffff');
        if ((col + Math.floor(ola * 3)) % 9 < 2) rect(ctx, sx, cresta + P, P, P, '#d8efff');
        // Destellos del sol sobre el agua.
        if (azar < 0.06 && Math.sin(v.reloj * 3 + col) > 0.3) rect(ctx, sx, cresta + P * (4 + Math.floor(azar * 80) % 8), P, P, '#e6f6ff');
        if (costa) {
          rect(ctx, sx, base - P, P, P * 3, '#f1dfae');
          rect(ctx, sx, base + P * 2, P, P, '#ffffff');
        }
        continue;
      }
      const [pasto, claro, oscuro] = [1, 2, 3].map((c) => rgb(interpolar(SUELOS, m, c)));
      const desierto = m > 3080 && m < 3550;
      const hielo = m > 6280;
      // Matas de pasto que sobresalen del borde.
      if (!desierto && !hielo && m > 70 && azar < 0.3) rect(ctx, sx, base - P, P, P, claro);
      rect(ctx, sx, base, P, P, claro);
      rect(ctx, sx, base + P, P, P * 3, pasto);
      rect(ctx, sx, base + P * 4, P, v.H, oscuro);
      // Surcos y tierra más abajo, para que el suelo no sea un bloque liso.
      const surco = rgb(mezcla(interpolar(SUELOS, m, 3), [20, 30, 30], 0.18));
      for (let fila = 7; fila < 40; fila += 5) if ((col + fila * 3) % 11 < 8) rect(ctx, sx, base + P * fila, P, P, surco);
      if (desierto && Math.sin(col * 0.25) > 0.75) rect(ctx, sx, base + P * 2, P, P, claro);
      else if (hielo && azar < 0.08) rect(ctx, sx, base + P * 2, P, P * 2, '#a9cde8');
      else if (!desierto && !hielo && m > 70 && azar > 0.97) rect(ctx, sx, base - P, P, P, ['#ffe45f', '#ff7882', '#ffffff'][col % 3]);
      if (azar > 0.6 && azar < 0.64) rect(ctx, sx, base + P * 6, P, P, pasto);
    }
    // Veleros en los tramos de mar.
    for (const [a2, b] of MARES) {
      const xm = (a2 + b) / 2;
      const x = v.anclaX + (xm - v.x) * v.k;
      if (x < -v.alto || x > v.W + v.alto || Math.abs(x - v.anclaX) < v.alto * 0.8) continue;
      const s = v.alto * 0.5;
      const y = base + P * Math.round(1 + Math.sin(xm * 0.18 + ola) * 1.2);
      pol(ctx, [[x - s * 0.35, y - s * 0.12], [x + s * 0.35, y - s * 0.12], [x + s * 0.25, y + P], [x - s * 0.25, y + P]], '#a8452f');
      rect(ctx, x - s * 0.01, y - s * 0.9, s * 0.03, s * 0.8, '#5a3a26');
      pol(ctx, [[x + s * 0.03, y - s * 0.88], [x + s * 0.34, y - s * 0.2], [x + s * 0.03, y - s * 0.2]], '#ffffff');
      pol(ctx, [[x - s * 0.02, y - s * 0.75], [x - s * 0.26, y - s * 0.2], [x - s * 0.02, y - s * 0.2]], '#e8eef6');
    }
  }

  // ───── Cerca (frente, sin contorno) ─────
  function nubesCercanas(ctx, v, piso) {
    if (noche(v.x) > 0.5) return;
    const tonos = tonosNube(v);
    for (const n of nubesCerca) {
      const ancho = 3200;
      const cx = ((n.x - v.x * 0.85) % ancho + ancho) % ancho;
      const x = v.anclaX + (cx - ancho / 2) * v.k;
      if (x < -300 || x > v.W + 300 || Math.abs(x - v.anclaX) < v.alto * 1.3) continue;
      const y = piso - v.alto * (0.8 + n.y * 1.5);
      nube(ctx, x, y, v.alto * 0.1 * n.escala, n.forma, tonos);
    }
  }

  // Bandadas de pájaros de día (y alguna gaviota sobre el mar).
  function pajaros(ctx, v, piso) {
    if (noche(v.x) > 0.3 || v.x < 60) return;
    const P = v.P;
    for (let b = 0; b < 2; b++) {
      const ancho = v.W + v.alto * 4;
      const avance = v.reducido ? 0 : v.reloj * v.alto * 0.25;
      const bx = ((b * ancho * 0.55 - v.x * v.k * 0.9 - avance) % ancho + ancho) % ancho - v.alto * 2;
      const by = piso - v.alto * (1.6 + b * 0.5);
      for (let i = 0; i < 4; i++) {
        const x = v.snap(bx + i * v.alto * 0.18);
        const y = v.snap(by + (i % 2) * v.alto * 0.08);
        const aleteo = !v.reducido && Math.floor(v.reloj * 6 + i) % 2;
        ctx.fillStyle = '#2e2a44';
        ctx.fillRect(x - P * 2, y - (aleteo ? P : 0), P * 2, P);
        ctx.fillRect(x + P, y - (aleteo ? P : 0), P * 2, P);
        ctx.fillRect(x, y + P - (aleteo ? 0 : P), P, P);
      }
    }
  }

  return {
    fondo(ctx, v, piso) {
      cielo(ctx, v, piso);
      nubesLejanas(ctx, v, piso);
      sierras(ctx, v, piso);
    },
    medio(ctx, v, piso) {
      colinas(ctx, v, piso);
      decorado(ctx, v, piso);
      const carteles = monumentos(ctx, v, piso);
      suelo(ctx, v, piso);
      return carteles;
    },
    cerca(ctx, v, piso) {
      nubesCercanas(ctx, v, piso);
      pajaros(ctx, v, piso);
    },
  };
}
