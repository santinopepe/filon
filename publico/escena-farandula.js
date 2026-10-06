// Filón — Farándula Argentina, en pixel art: Filón baja de una limusina y camina por la alfombra roja.
// El avance de la partida (0 a 7.000 m) lo lleva por la alfombra: cuanto más lejos llega, más fans y
// paparazzi se juntan detrás de las vallas, más flashes saltan y más reflectores barren el cielo.
// Al final lo espera la entrada de la gala.
import { generador, limitar, mezcla, rgb } from './escena.js';
import { anchoTexto, cartelPixel, textoPixel } from './pixel.js';

export const ETAPAS_FARANDULA = [
  { hasta: 0, nombre: 'la limusina', titulo: 'Limusina' },
  { hasta: 600, nombre: 'la llegada', titulo: 'Llegada', barra: '#c93a5a', acento: '#ff7882' },
  { hasta: 1600, nombre: 'los primeros flashes', titulo: 'Primeros flashes', barra: '#e0627e', acento: '#ffd166' },
  { hasta: 3000, nombre: 'la zona de prensa', titulo: 'Zona de prensa', barra: '#b46bd0', acento: '#e5eff4' },
  { hasta: 4500, nombre: 'la tribuna de fans', titulo: 'Tribuna de fans', barra: '#8a73f0', acento: '#ff93a5' },
  { hasta: 6000, nombre: 'el furor total', titulo: 'Furor total', barra: '#f0a24a', acento: '#ffe45f' },
  { hasta: Infinity, nombre: 'la entrada de la gala', titulo: 'Entrada de la gala', barra: '#ffd76a', acento: '#95f2ff' },
];

const ROPA = [[230, 70, 100], [80, 200, 230], [255, 214, 70], [140, 110, 240], [255, 140, 90], [80, 200, 120], [244, 234, 216], [70, 80, 140]];
const PIEL = [[244, 200, 160], [222, 164, 120], [176, 112, 72], [120, 74, 48], [250, 216, 186]];
const PELO = [[44, 28, 32], [98, 60, 36], [210, 150, 64], [236, 206, 120], [26, 22, 44], [160, 60, 84]];
const CARTELES = ['FILÓN', '♥', '★', '¡FILÓN!', 'TE AMO', '♥ ♥'];
const OSCURO = [30, 20, 56];
const LINEA = '#1c1230';

const FIN = 7000;
const PASO_FILA = 15.5; // metros entre lugares de una fila de público
const PASO_POSTE = 58;

// Público: casi vacío al bajar de la limusina, repleto cerca de la gala.
const densidad = (x) => 0.08 + 0.92 * limitar((x - 150) / 5600, 0, 1) ** 0.85;
// Los paparazzi abundan en la zona de prensa; los carteles, en la tribuna de fans y después.
const partePrensa = (x) => 0.16 + 0.5 * Math.exp(-(((x - 2300) / 900) ** 2));

function lugar(fila, i) {
  const azar = generador(i * 7919 + fila * 104729 + 17);
  const x = i * PASO_FILA + (azar() - 0.5) * PASO_FILA * 0.5 + (fila ? PASO_FILA / 2 : 0);
  const presente = azar();
  const prensa = azar() < partePrensa(x);
  return {
    x,
    presente,
    tipo: prensa ? 'paparazzi' : 'fan',
    cartel: !prensa && x > 2600 && azar() < 0.45 ? CARTELES[Math.floor(azar() * CARTELES.length)] : null,
    celular: !prensa && azar() < 0.3,
    ropa: ROPA[Math.floor(azar() * ROPA.length)],
    piel: PIEL[Math.floor(azar() * PIEL.length)],
    pelo: PELO[Math.floor(azar() * PELO.length)],
    alto: 0.9 + azar() * 0.2,
    fase: azar() * 6.3,
    ritmo: azar(),
  };
}

export function crearMundoFarandula() {
  const estrellas = Array.from({ length: 60 }, (_, i) => {
    const azar = generador(i * 31 + 5);
    return { x: azar(), y: azar() * 0.6, fase: azar() * 6.3 };
  });

  // ───── Fondo (se desenfoca) ─────
  function cielo(ctx, v, prog) {
    const arriba = [18, 12, 46];
    const abajo = mezcla([84, 34, 98], [150, 56, 110], prog);
    const franjas = 8;
    for (let i = 0; i < franjas; i++) {
      ctx.fillStyle = rgb(mezcla(arriba, abajo, (i / (franjas - 1)) ** 1.4));
      ctx.fillRect(0, (v.anclaY * i) / franjas, v.W, v.H);
    }
    for (const e of estrellas) {
      const brillo = v.reducido ? 0.7 : 0.5 + 0.45 * Math.sin(v.reloj * 1.8 + e.fase);
      ctx.fillStyle = `rgb(255 248 220 / ${brillo * (1 - prog * 0.5)})`;
      ctx.fillRect(e.x * v.W, e.y * v.anclaY, 4, 4);
    }
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(v.W * 0.12, v.anclaY * 0.22, v.alto * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // Reflectores: uno al llegar; hasta seis cerca de la gala.
  function reflectores(ctx, v, prog) {
    const n = 1 + Math.floor(prog * 5.5);
    const base = v.anclaY - v.alto * 0.6;
    const bases = [0.16, 0.84, 0.36, 0.64, 0.05, 0.95];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const bx = bases[i] * v.W;
      const angulo = -Math.PI / 2 + (v.reducido ? (i % 2 ? 0.35 : -0.35) : Math.sin(v.reloj * 0.45 + i * 1.7) * 0.55);
      const largo = v.H * 1.4;
      const abre = 0.07;
      ctx.fillStyle = 'rgb(255 236 190 / .2)';
      ctx.beginPath();
      ctx.moveTo(bx, base);
      ctx.lineTo(bx + Math.cos(angulo - abre) * largo, base + Math.sin(angulo - abre) * largo);
      ctx.lineTo(bx + Math.cos(angulo + abre) * largo, base + Math.sin(angulo + abre) * largo);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Ciudad de fondo, con el Obelisco al principio (paralaje lento).
  function ciudad(ctx, v) {
    const par = 0.18;
    const { alto } = v;
    const piso = v.anclaY - alto * 0.3;
    const sx = (b) => v.anclaX + (b - v.x * par) * v.k;
    const desde = Math.floor((v.x * par - v.anclaX / v.k) / 26) - 1;
    const hasta = Math.ceil((v.x * par + (v.W - v.anclaX) / v.k) / 26) + 1;
    const ventana = alto * 0.045;
    for (let i = desde; i <= hasta; i++) {
      const azar = generador(i * 977 + 3);
      const ancho = (12 + azar() * 14) * v.k;
      const h = alto * (0.5 + azar() * 1.1);
      const x = sx(i * 26);
      ctx.fillStyle = azar() < 0.5 ? '#2a1d52' : '#33235f';
      ctx.fillRect(x, piso - h, ancho, h + alto * 0.4);
      ctx.fillStyle = '#ffd27a';
      for (let fy = piso - h + ventana * 2; fy < piso - ventana * 2; fy += ventana * 2.6) {
        for (let fx = x + ventana * 1.5; fx < x + ancho - ventana * 2; fx += ventana * 2.4) if (azar() > 0.7) ctx.fillRect(fx, fy, ventana, ventana * 1.3);
      }
    }
    const ox = sx(70);
    if (ox > -60 && ox < v.W + 60) {
      const h = alto * 2.3;
      ctx.fillStyle = '#4a3580';
      ctx.beginPath();
      ctx.moveTo(ox - alto * 0.09, piso + 2);
      ctx.lineTo(ox - alto * 0.06, piso - h * 0.93);
      ctx.lineTo(ox, piso - h);
      ctx.lineTo(ox + alto * 0.06, piso - h * 0.93);
      ctx.lineTo(ox + alto * 0.09, piso + 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ───── Frente (pixeles nítidos) ─────

  /** Una persona en pixeles. `n` es su altura en pixeles de la escena; `contorno` le pone línea oscura. */
  function persona(ctx, v, p, x, pie, n, prog, { oscurecer = 0, contorno = false } = {}) {
    const P = v.P;
    const color = (c) => rgb(oscurecer ? mezcla(c, OSCURO, oscurecer) : c);
    const mirar = x < v.anclaX ? 1 : -1;
    const euforia = 0.25 + prog * 0.75;
    const salto = v.reducido ? 0 : Math.round(Math.max(0, Math.sin(v.reloj * (3.5 + p.ritmo * 2.5) + p.fase)) * n * 0.07 * euforia * (p.tipo === 'fan' ? 1 : 0.3));
    const X = v.snap(x);
    const Y = v.snap(pie) - salto * P;
    // Piezas en pixeles desde los pies: [dx, dy (hacia arriba), ancho, alto, color].
    const piezas = [];
    const B = (dx, dy, w, h, c) => piezas.push([dx, dy, w, h, c]);

    const piernas = Math.round(n * 0.28);
    const torso = Math.round(n * 0.36);
    const cabeza = Math.max(5, Math.round(n * 0.24));
    const ancho = Math.max(6, Math.round(n * 0.3));
    const media = Math.floor(ancho / 2);
    const hombro = piernas + torso;
    const pantalon = mezcla(p.ropa, [30, 30, 60], 0.55);
    const hx = -Math.floor(cabeza / 2);

    B(-media + 1, 0, media - 1, piernas, color(pantalon));
    B(1, 0, media - 1, piernas, color(pantalon));
    B(-media, piernas, ancho, torso, color(p.ropa));
    B(mirar > 0 ? -media : media - 1, piernas, 1, torso, color(mezcla(p.ropa, [0, 0, 0], 0.25)));
    B(hx, hombro, cabeza, cabeza, color(p.piel));
    B(hx, hombro + cabeza - 2, cabeza, 2, color(p.pelo));
    B(mirar > 0 ? hx : hx + cabeza - 1, hombro + cabeza - 4, 1, 3, color(p.pelo));
    B(mirar > 0 ? hx + cabeza - 2 : hx + 1, hombro + Math.floor(cabeza / 2), 1, 1, '#1b1020');

    let flash = null;
    let cartel = null;
    if (p.tipo === 'fan') {
      // Brazos en alto, más agitados cuanto más avanza la partida.
      const brazo = Math.round(n * 0.3);
      const vaiven = v.reducido ? 0 : Math.round(Math.sin(v.reloj * (5 + p.ritmo * 3) + p.fase) * 1.4 * euforia);
      const izq = -media - 2 + vaiven;
      const der = media - vaiven;
      B(izq, hombro - 2, 2, brazo, color(p.ropa));
      B(der, hombro - 2, 2, brazo, color(p.ropa));
      B(izq, hombro - 2 + brazo, 2, 2, color(p.piel));
      B(der, hombro - 2 + brazo, 2, 2, color(p.piel));
      if (p.cartel) cartel = { dy: hombro + brazo, texto: p.cartel };
      else if (p.celular) B(der, hombro + brazo, 2, 3, oscurecer ? '#5fb4c4' : '#a8f6ff');
    } else {
      // Paparazzo: cámara frente a la cara, apuntando a Filón, con su flash.
      const cx = mirar > 0 ? hx + cabeza - 1 : hx - 4;
      B(mirar > 0 ? media - 1 : -media - 1, hombro - 3, 2, 4, color(p.ropa));
      B(cx, hombro + 1, 5, 4, oscurecer ? '#14121f' : '#1b1b26');
      B(mirar > 0 ? cx + 4 : cx - 1, hombro + 2, 2, 2, '#5a5a78');
      B(cx + 1, hombro + 5, 2, 1, '#d8d8e0');
      const ciclo = (v.reloj * (0.22 + prog * 1.1) * (0.7 + p.ritmo * 0.6) + p.fase) % 1;
      if (!v.reducido && ciclo < 0.07) flash = { dx: cx + 2, dy: hombro + 6, fuerza: 1 - ciclo / 0.07 };
    }

    if (contorno) {
      ctx.fillStyle = LINEA;
      for (const [dx, dy, w, h] of piezas) ctx.fillRect(X + (dx - 1) * P, Y - (dy + h + 1) * P, (w + 2) * P, (h + 2) * P);
    }
    for (const [dx, dy, w, h, c] of piezas) {
      ctx.fillStyle = c;
      ctx.fillRect(X + dx * P, Y - (dy + h) * P, w * P, h * P);
    }
    if (cartel) {
      const w = anchoTexto(cartel.texto) + 4;
      const x0 = X - Math.floor(w / 2) * P;
      const y0 = Y - (cartel.dy + 8) * P;
      ctx.fillStyle = LINEA;
      ctx.fillRect(x0 - P, y0 - P, (w + 2) * P, 10 * P);
      ctx.fillStyle = color([255, 248, 220]);
      ctx.fillRect(x0, y0, w * P, 8 * P);
      textoPixel(ctx, cartel.texto, x0 + 2 * P, y0 + 2 * P, P, { color: color([230, 57, 70]) });
    }
    if (flash) {
      const fx = X + flash.dx * P;
      const fy = Y - flash.dy * P;
      ctx.fillStyle = v.trama(ctx, '#fffbe6', 0.5 * flash.fuerza);
      ctx.beginPath();
      ctx.arc(fx, fy, n * P * (oscurecer ? 0.3 : 0.45), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      const s = Math.round(3 + flash.fuerza * 3) * P;
      ctx.fillRect(fx - s, fy, s * 2 + P, P);
      ctx.fillRect(fx, fy - s, P, s * 2 + P);
    }
  }

  function filaDePublico(ctx, v, fila, prog) {
    const n = Math.round((v.alto * (fila ? 0.6 : 0.74)) / v.P);
    const pie = v.anclaY - v.alto * (fila ? 0.2 : 0.06);
    const desdeM = v.x - (v.anclaX + v.alto) / v.k;
    const hastaM = v.x + (v.W - v.anclaX + v.alto) / v.k;
    const i0 = Math.max(0, Math.floor(desdeM / PASO_FILA) - 1);
    const i1 = Math.ceil(hastaM / PASO_FILA) + 1;
    for (let i = i0; i <= i1; i++) {
      const p = lugar(fila, i);
      if (p.x < 30 || p.x > FIN + 10) continue; // junto a la limusina y en la escalinata no hay nadie
      const lleno = densidad(p.x) * (fila ? limitar((p.x - 1200) / 1800, 0, 1) : 1);
      if (p.presente > lleno) continue;
      const x = v.anclaX + (p.x - v.x) * v.k;
      // Lugar libre en la primera fila, detrás de Filón: la estrella se ve sola contra la valla.
      if (!fila && Math.abs(x - v.anclaX) < v.alto * 0.42) continue;
      persona(ctx, v, p, x, pie, Math.round(n * p.alto), prog, fila ? { oscurecer: 0.45 } : { contorno: true });
    }
  }

  function vallas(ctx, v) {
    const P = v.P;
    const arriba = v.snap(v.anclaY - v.alto * 0.2);
    const pie = v.snap(v.anclaY - v.alto * 0.03);
    const caida = Math.round((v.alto * 0.07) / P);
    const i0 = Math.max(0, Math.floor((v.x - v.anclaX / v.k) / PASO_POSTE) - 1);
    const i1 = Math.min(Math.ceil(FIN / PASO_POSTE), Math.ceil((v.x + (v.W - v.anclaX) / v.k) / PASO_POSTE) + 1);
    let anterior = null;
    for (let i = i0; i <= i1; i++) {
      const x = v.snap(v.anclaX + (i * PASO_POSTE - v.x) * v.k);
      if (anterior !== null) {
        // Cordón de terciopelo que cuelga entre los postes, en escalones de un pixel.
        const pasos = Math.max(1, Math.round((x - anterior) / P));
        for (let j = 0; j < pasos; j++) {
          const y = arriba + P + Math.round(Math.sin((Math.PI * j) / pasos) * caida) * P;
          ctx.fillStyle = LINEA;
          ctx.fillRect(anterior + j * P, y - P, P, P * 4);
          ctx.fillStyle = '#b3173f';
          ctx.fillRect(anterior + j * P, y, P, P * 2);
        }
      }
      ctx.fillStyle = LINEA;
      ctx.fillRect(x - 2 * P, arriba - 2 * P, 5 * P, pie - arriba + 3 * P);
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(x - P, arriba - P, 3 * P, pie - arriba + P);
      ctx.fillStyle = '#fff1a8';
      ctx.fillRect(x - P, arriba, P, pie - arriba);
      anterior = x;
    }
  }

  function alfombra(ctx, v) {
    const P = v.P;
    const { W, H, alto } = v;
    const arriba = v.snap(v.anclaY - alto * 0.03);
    const abajo = v.snap(v.anclaY + alto * 0.12);
    const ini = Math.max(-P * 4, v.snap(v.anclaX + (-12 - v.x) * v.k));
    const fin = Math.min(W + P * 4, v.snap(v.anclaX + (FIN + 40 - v.x) * v.k));
    ctx.fillStyle = '#1d1636';
    ctx.fillRect(0, arriba, W, H - arriba);
    if (ini > 0) {
      // Vereda donde para la limusina.
      ctx.fillStyle = '#2f2a48';
      ctx.fillRect(0, arriba, ini, H - arriba);
      ctx.fillStyle = '#4c4670';
      ctx.fillRect(0, arriba, ini, P * 2);
    }
    if (fin > ini) {
      ctx.fillStyle = '#d8283f';
      ctx.fillRect(ini, arriba, fin - ini, abajo - arriba);
      ctx.fillStyle = '#b51c33';
      ctx.fillRect(ini, abajo - P * 3, fin - ini, P * 3);
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(ini, arriba, fin - ini, P);
      ctx.fillRect(ini, abajo, fin - ini, P);
      // Pelo de la alfombra: rayitas que se corren al caminar.
      const paso = P * 12;
      const corr = ((v.x * v.k) % paso + paso) % paso;
      ctx.fillStyle = '#ef4a5c';
      for (let x = ini - corr; x < fin; x += paso) {
        if (x < ini) continue;
        ctx.fillRect(v.snap(x), arriba + P * 3, P * 4, P);
        ctx.fillRect(v.snap(x) - P * 3, arriba + P * 7, P * 4, P);
      }
    }
  }

  // Público de adelante: siluetas con celulares en alto (aparecen a medida que se avanza).
  function siluetas(ctx, v) {
    const filaY = v.anclaY + v.alto * 0.55;
    if (filaY > v.H + v.alto * 0.2) return;
    const i0 = Math.max(0, Math.floor((v.x - v.anclaX / v.k) / 21) - 1);
    const i1 = Math.ceil((v.x + (v.W - v.anclaX) / v.k) / 21) + 1;
    for (let i = i0; i <= i1; i++) {
      const azar = generador(i * 613 + 9);
      const xm = i * 21 + azar() * 8;
      if (xm < 120 || xm > FIN + 60 || azar() > densidad(xm) * 0.9) continue;
      const x = v.anclaX + (xm - v.x) * v.k;
      const r = v.alto * (0.13 + azar() * 0.03);
      ctx.fillStyle = '#0e0920';
      ctx.beginPath();
      ctx.arc(x, filaY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, filaY + r * 2.2, r * 1.9, r * 1.4, 0, Math.PI, 0);
      ctx.fill();
      if (azar() < 0.4) v.rect(ctx, x + r * 0.9, filaY - r * 2.2, r * 0.5, r * 0.85, '#a8f6ff');
    }
  }

  function limusina(ctx, v) {
    const { alto } = v;
    const x0 = v.anclaX + (-140 - v.x) * v.k;
    const x1 = v.anclaX + (-16 - v.x) * v.k;
    if (x1 < -20 || x0 > v.W + 20) return;
    const P = v.P;
    const piso = v.anclaY - alto * 0.02;
    const techo = piso - alto * 0.5;
    const largo = x1 - x0;
    const R = (x, y, w, h, c) => v.rect(ctx, x, y, w, h, c);
    // Contorno y carrocería negra con brillo y línea cromada.
    R(x0 - P, techo + alto * 0.12 - P, largo + 2 * P, alto * 0.3 + 2 * P, LINEA);
    R(x0 + largo * 0.12 - P, techo - P, largo * 0.74 + 2 * P, alto * 0.16 + 2 * P, LINEA);
    R(x0, techo + alto * 0.12, largo, alto * 0.3, '#16121f');
    R(x0 + largo * 0.12, techo, largo * 0.74, alto * 0.16, '#16121f');
    R(x0 + largo * 0.12, techo, largo * 0.74, P, '#4a4466');
    R(x0, techo + alto * 0.12, largo, P, '#3a3550');
    for (let i = 0; i < 4; i++) R(x0 + largo * (0.16 + i * 0.18), techo + alto * 0.035, largo * 0.14, alto * 0.1, '#4d6a9a');
    R(x0 + P, techo + alto * 0.27, largo - 2 * P, P, '#c8cfdf');
    // Puerta trasera abierta, con la luz cálida del interior: de acá baja Filón.
    const px = v.anclaX + (-42 - v.x) * v.k;
    R(px - alto * 0.12, techo + alto * 0.05, alto * 0.24, alto * 0.34, '#ffcf8a');
    R(px + alto * 0.12, techo + alto * 0.05, alto * 0.16, alto * 0.38, LINEA);
    R(px + alto * 0.13, techo + alto * 0.07, alto * 0.13, alto * 0.33, '#221c33');
    // Ruedas y luces.
    for (const f of [0.13, 0.86]) {
      const rx = x0 + largo * f;
      R(rx - alto * 0.1, piso - alto * 0.2, alto * 0.2, alto * 0.2, LINEA);
      R(rx - alto * 0.05, piso - alto * 0.15, alto * 0.1, alto * 0.1, '#9aa3bd');
    }
    R(x1 - P * 2, techo + alto * 0.18, P * 2, P * 2, '#fff3b0');
    R(x0, techo + alto * 0.18, P * 2, P * 2, '#ff4d6d');
  }

  // La entrada de la gala: escalinata, columnas, puerta iluminada y un cartel con lamparitas.
  function gala(ctx, v) {
    const { alto } = v;
    const P = v.P;
    const x0 = v.anclaX + (FIN + 15 - v.x) * v.k;
    if (x0 > v.W + 20) return;
    const R = (x, y, w, h, c) => v.rect(ctx, x, y, w, h, c);
    const piso = v.anclaY - alto * 0.03;
    const ancho = alto * 2.8;
    R(x0 - P, piso - alto * 1.9 - P, ancho + 2 * P, alto * 1.9 + P, LINEA);
    R(x0, piso - alto * 1.9, ancho, alto * 1.9, '#3a2a60');
    for (let i = 0; i < 4; i++) R(x0 + alto * 0.2 + i * alto * 0.72, piso - alto * 1.15, alto * 0.2, alto * 1.15, '#57458c');
    R(x0 + alto * 1.05, piso - alto * 0.95, alto * 0.7, alto * 0.95, '#ffcf8a');
    for (let i = 0; i < 4; i++) R(x0 - alto * 0.12 * (4 - i), piso - alto * 0.07 * (i + 1), ancho + alto * 0.12 * (4 - i), alto * 0.07, i % 2 ? '#b51c33' : '#d8283f');
    const texto = 'GALA FILÓN';
    const escala = 2;
    const tw = anchoTexto(texto) * escala * P;
    const cx = x0 + ancho / 2;
    const cy = piso - alto * 1.55;
    R(cx - tw / 2 - P * 4, cy - P * 8, tw + P * 8, P * 16, LINEA);
    R(cx - tw / 2 - P * 3, cy - P * 7, tw + P * 6, P * 14, '#20163a');
    textoPixel(ctx, texto, cx - tw / 2, cy - P * 5, P, { escala, color: '#ffe45f' });
    for (let i = 0; i < 12; i++) {
      const prendida = v.reducido || Math.floor(v.reloj * 6 + i) % 3 !== 0;
      const lx = cx - tw / 2 - P * 2 + (i * (tw + P * 4)) / 11;
      R(lx, cy - P * 6, P, P, prendida ? '#fff3b0' : '#7a6440');
      R(lx, cy + P * 5, P, P, prendida ? '#fff3b0' : '#7a6440');
    }
  }

  function carteles(ctx, v) {
    let desde = 0;
    for (let i = 1; i < ETAPAS_FARANDULA.length; i++) {
      const e = ETAPAS_FARANDULA[i];
      const x = v.anclaX + (desde + 40 - v.x) * v.k;
      if (x > -200 && x < v.W + 200 && Math.abs(x - v.anclaX) > v.alto * 0.6) {
        cartelPixel(ctx, `★ ${e.titulo}`, x, v.anclaY - v.alto * 1.3, v.P, { acento: e.acento, limites: [v.W < 860 ? v.P * 2 : 80, v.W - v.P * 2] });
      }
      desde = Math.min(e.hasta, FIN);
    }
  }

  return {
    entrada: -42,
    vestuario: 'farandula',
    dibujarFondo(ctx, v) {
      const prog = limitar(v.x / FIN, 0, 1);
      cielo(ctx, v, prog);
      reflectores(ctx, v, prog);
      ciudad(ctx, v);
    },
    dibujarFrente(ctx, v, emitir) {
      const prog = limitar(v.x / FIN, 0, 1);
      gala(ctx, v);
      filaDePublico(ctx, v, 1, prog);
      filaDePublico(ctx, v, 0, prog);
      vallas(ctx, v);
      limusina(ctx, v);
      alfombra(ctx, v);
      // Cerca de la gala cae papel picado de tanto en tanto.
      if (!v.reducido && prog > 0.75 && Math.random() < (prog - 0.7) * 0.25) {
        emitir('confeti', Math.random() * v.W, -10, 1, ['#ffe45f', '#ff7882', '#77edf2', '#fff8dc'], { fuerza: 0.3, gravedad: 40 });
      }
    },
    dibujarPersonaje(ctx, v) {
      v.filon(ctx);
    },
    dibujarPrimerPlano(ctx, v) {
      siluetas(ctx, v);
      carteles(ctx, v);
    },
    golpe(v, emitir) {
      // Ráfaga de flashes alrededor de Filón.
      const x = v.anclaX + (Math.random() - 0.5) * v.alto * 1.6;
      const y = v.anclaY - v.alto * (0.4 + Math.random() * 0.6);
      emitir('brillo', x, y, 8, '#ffffff', { fuerza: 0.6 });
    },
    descubrir(v, emitir, rareza, color) {
      emitir('confeti', v.anclaX, v.anclaY - v.alto * 0.7, rareza === 'diamante' ? 60 : rareza === 'oro' ? 40 : 24, [color, '#fff8dc', '#ff7882'], { fuerza: 1.4 });
    },
  };
}
