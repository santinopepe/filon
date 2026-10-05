// Filón — corte vertical de la Tierra dibujado en canvas.
// El mundo se desplaza alrededor de Lito: y = 0 es la superficie y y > 0 baja hacia el centro.

const BLOQUE = 52;

export const ESTRATOS = [
  { hasta: 0, nombre: 'la superficie', titulo: 'Superficie' },
  { hasta: 500, nombre: 'la tierra y la arcilla', titulo: 'Tierra y arcilla', base: [130, 78, 70], piedra: [180, 111, 82], acento: '#ffb36d' },
  { hasta: 1500, nombre: 'la arenisca', titulo: 'Arenisca', base: [189, 111, 67], piedra: [230, 154, 85], acento: '#ffd166', fosiles: true },
  { hasta: 3000, nombre: 'la pizarra', titulo: 'Pizarra', base: [73, 79, 116], piedra: [113, 124, 160], acento: '#80d9e6', laminas: true },
  { hasta: 4500, nombre: 'el granito', titulo: 'Granito', base: [128, 89, 111], piedra: [183, 133, 145], acento: '#ff93a5', motas: true },
  { hasta: 6000, nombre: 'el basalto', titulo: 'Basalto', base: [49, 50, 76], piedra: [83, 83, 111], acento: '#ff765f', magma: true },
  { hasta: Infinity, nombre: 'la cámara de cristales', titulo: 'Cámara de cristales', base: [47, 34, 83], piedra: [85, 63, 127], acento: '#78edf2', cristales: true },
];

// Minerales que aparecen a medida que se baja. Cada uno abunda alrededor de `pico` y se va
// raleando hasta `desde`/`hasta`; `densidad` es la cantidad de yacimientos por bloque en el pico.
// `tinte` colorea el terreno de la zona para que el cambio se note aunque no haya un yacimiento a la vista.
export const MINERALES = [
  { tipo: 'carbon', nombre: 'Carbón', desde: 120, pico: 750, hasta: 1700, densidad: 13, color: '#3a3440', tinte: [34, 28, 38] },
  { tipo: 'hierro', nombre: 'Hierro', desde: 900, pico: 1850, hasta: 2900, densidad: 12, color: '#b5532f', tinte: [150, 52, 34] },
  { tipo: 'cobre', nombre: 'Cobre', desde: 1800, pico: 2700, hasta: 3700, densidad: 11, color: '#e0874a', tinte: [176, 104, 56] },
  { tipo: 'plata', nombre: 'Plata', desde: 2800, pico: 3550, hasta: 4400, densidad: 10, color: '#dfe7ee', tinte: [150, 160, 176] },
  { tipo: 'oro', nombre: 'Oro', desde: 3600, pico: 4450, hasta: 5400, densidad: 10, color: '#ffd23f', tinte: [176, 140, 50] },
  { tipo: 'esmeralda', nombre: 'Esmeraldas', desde: 4500, pico: 5350, hasta: 6300, densidad: 10, color: '#3ee08f', tinte: [30, 120, 80] },
  { tipo: 'rubi', nombre: 'Rubíes', desde: 5300, pico: 6050, hasta: 6800, densidad: 9, color: '#ff4d6d', tinte: [130, 30, 52] },
  { tipo: 'diamante', nombre: 'Diamantes', desde: 6000, pico: 6750, hasta: 9000, densidad: 11, color: '#bff8ff', tinte: [96, 170, 200] },
];

function pesoMineral(m, y) {
  if (y < m.desde || y > m.hasta) return 0;
  return y < m.pico ? (y - m.desde) / (m.pico - m.desde) : 1 - ((y - m.pico) / (m.hasta - m.pico)) * .85;
}

/** Color del terreno con el tinte de las zonas minerales que lo atraviesan. */
function tenirPorMinerales(c, y) {
  let r = c;
  for (const m of MINERALES) {
    const w = pesoMineral(m, y);
    if (w > 0) r = mezcla(r, m.tinte, Math.min(.42, w * .42));
  }
  return r;
}

export const COLORES_RAREZA = { grava: '#b7b5bb', cobre: '#f18a52', plata: '#e5eff4', oro: '#ffe45f', diamante: '#78edf2' };

export function estratoDe(m) {
  if (m <= 0) return ESTRATOS[0];
  return ESTRATOS.find((e) => m < e.hasta) ?? ESTRATOS[ESTRATOS.length - 1];
}

function generador(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rgb = (c, a = 1) => `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${a})`;
const mezcla = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function colorDeTierra(y) {
  for (let i = 1; i < ESTRATOS.length; i++) {
    const actual = ESTRATOS[i];
    if (y < actual.hasta) {
      const anterior = ESTRATOS[i - 1];
      const siguiente = ESTRATOS[i + 1];
      if (anterior.base && y - anterior.hasta < 42) return mezcla(anterior.base, actual.base, 0.55 + ((y - anterior.hasta) / 42) * 0.45);
      if (siguiente?.base && actual.hasta - y < 42) return mezcla(actual.base, siguiente.base, ((42 - actual.hasta + y) / 42) * 0.45);
      return actual.base;
    }
  }
  return ESTRATOS.at(-1).base;
}

export function crearEscena(canvas, { alCambiarProfundidad = () => {}, zonaLibre = () => ({ izquierda: 0, derecha: innerWidth, arriba: 0, abajo: innerHeight, movil: false }) } = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let ppm = 7;
  let anclaX = 0;
  let anclaY = 0;
  let esc = 1;
  let camY = 0;
  let velocidad = 0;
  let animacion = null;
  let reducido = false;
  let ultimo = performance.now();
  let reloj = 0;
  let particulas = [];
  let claveDisposicion = '';
  let objetivo = null; // posición de Lito hacia la que se desliza al cambiar de pantalla
  const bloques = new Map();
  const yacimientos = new Map();

  function aplicarAncla() {
    const raiz = document.documentElement.style;
    raiz.setProperty('--minero-x', `${anclaX.toFixed(1)}px`);
    raiz.setProperty('--minero-y', `${anclaY.toFixed(1)}px`);
    raiz.setProperty('--escala-minero', esc.toFixed(3));
  }

  function disponer() {
    W = innerWidth;
    H = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    const z = zonaLibre();
    const clave = [W, H, dpr, Math.round(z.izquierda), Math.round(z.derecha), Math.round(z.arriba), Math.round(z.abajo), z.movil, z.centrado].join(':');
    if (clave === claveDisposicion) return;
    const primera = !claveDisposicion;
    claveDisposicion = clave;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ppm = limitar(H / 126, 5.4, 8.6);
    let destino;
    if (z.centrado) {
      // Lito (224 px de alto a escala 1) queda centrado en el hueco entre la pregunta y la respuesta.
      const hueco = Math.max(80, z.abajo - z.arriba);
      const e = limitar((hueco - 16) / 236, z.movil ? 0.42 : 0.55, z.movil ? 0.8 : 1.05);
      destino = { x: (z.izquierda + z.derecha) / 2, y: (z.arriba + z.abajo) / 2 + 112 * e, esc: e };
    } else {
      const e = z.movil ? limitar((z.abajo - z.arriba) / 250, 0.66, 0.82) : limitar(H / 900, 0.82, 1.08);
      destino = { x: (z.izquierda + z.derecha) / 2, y: z.movil ? z.abajo - 3 : z.arriba + (z.abajo - z.arriba) * 0.62, esc: e };
    }
    objetivo = destino;
    if (primera || reducido) {
      anclaX = destino.x;
      anclaY = destino.y;
      esc = destino.esc;
      aplicarAncla();
    }
  }

  // Desliza a Lito (y con él todo el corte) hacia su nueva posición.
  function acercarAncla(dt) {
    if (!objetivo) return;
    const dx = objetivo.x - anclaX;
    const dy = objetivo.y - anclaY;
    const de = objetivo.esc - esc;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(de) < .002) {
      if (dx || dy || de) {
        anclaX = objetivo.x;
        anclaY = objetivo.y;
        esc = objetivo.esc;
        aplicarAncla();
      }
      return;
    }
    const k = reducido ? 1 : 1 - Math.exp(-dt * 9);
    anclaX += dx * k;
    anclaY += dy * k;
    esc += de * k;
    aplicarAncla();
  }

  const sx = (x) => anclaX + x * ppm;
  const sy = (y) => anclaY + (y - camY) * ppm;

  function datosBloque(k) {
    if (bloques.has(k)) return bloques.get(k);
    const azar = generador(k * 6271 + 9137);
    const inicio = k * BLOQUE;
    const objetos = [];
    for (let i = 0; i < 68; i++) {
      const y = inicio + azar() * BLOQUE;
      const e = estratoDe(Math.max(1, y));
      const x = (azar() - 0.5) * 280;
      const tipoRnd = azar();
      let tipo = 'piedra';
      if (e.fosiles && tipoRnd > 0.88) tipo = 'fosil';
      else if (e.laminas && tipoRnd > 0.7) tipo = 'lamina';
      else if (e.magma && tipoRnd > 0.9) tipo = 'magma';
      else if (e.cristales && tipoRnd > 0.67) tipo = 'cristal';
      else if (e.motas && tipoRnd > 0.64) tipo = 'mota';
      objetos.push({ x, y, tipo, r: 0.3 + Math.pow(azar(), 2) * 2.2, giro: azar() * Math.PI * 2, tono: azar(), fase: azar() * 8 });
    }
    bloques.set(k, objetos);
    if (bloques.size > 90) bloques.delete(bloques.keys().next().value);
    return objetos;
  }

  function datosYacimientos(k) {
    if (yacimientos.has(k)) return yacimientos.get(k);
    const azar = generador(k * 9173 + 271);
    const lista = [];
    const centro = k * BLOQUE + BLOQUE / 2;
    for (const m of MINERALES) {
      const esperado = m.densidad * Math.max(pesoMineral(m, k * BLOQUE), pesoMineral(m, centro), pesoMineral(m, (k + 1) * BLOQUE));
      if (esperado <= 0) continue;
      const cantidad = Math.floor(esperado + azar());
      for (let i = 0; i < cantidad; i++) {
        const y = k * BLOQUE + azar() * BLOQUE;
        if (azar() > pesoMineral(m, y) + .15) continue;
        const piezas = [];
        const n = m.tipo === 'carbon' ? 1 : 3 + Math.floor(azar() * 4);
        for (let j = 0; j < n; j++) {
          piezas.push({ dx: (azar() - .5) * 2, dy: (azar() - .5) * 2, tam: .8 + azar() * .9, giro: (azar() - .5) * 1.4, fase: azar() * 6.3 });
        }
        lista.push({ m, x: (azar() - .5) * 280, y, largo: 6 + azar() * 12, piezas, fase: azar() * 6.3, giro: (azar() - .5) * .5 });
      }
    }
    yacimientos.set(k, lista);
    if (yacimientos.size > 90) yacimientos.delete(yacimientos.keys().next().value);
    return lista;
  }

  // Brillo de cuatro puntas (oro, plata, diamantes).
  function destello(x, y, tam, fase, color = '#ffffff') {
    const t = reducido ? .6 : (Math.sin(reloj * 3 + fase) + 1) / 2;
    if (t < .35) return;
    const s = tam * (.5 + t * .7);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * .2, y - s * .2);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x + s * .2, y + s * .2);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * .2, y + s * .2);
    ctx.lineTo(x - s, y);
    ctx.lineTo(x - s * .2, y - s * .2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function pepita(r, colores, puntas = 7, semilla = 0) {
    ctx.fillStyle = colores[0];
    ctx.beginPath();
    for (let i = 0; i < puntas; i++) {
      const a = (i / puntas) * Math.PI * 2;
      const rr = r * (.72 + .28 * Math.abs(Math.sin(i * 2.3 + semilla)));
      i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * .8) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * .8);
    }
    ctx.closePath();
    ctx.fill();
    if (colores[1]) {
      ctx.fillStyle = colores[1];
      ctx.beginPath();
      ctx.ellipse(-r * .25, -r * .25, r * .38, r * .22, -.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function cristal(alto, ancho, cara, luz, borde) {
    ctx.fillStyle = cara;
    ctx.beginPath();
    ctx.moveTo(0, -alto);
    ctx.lineTo(ancho, -alto * .55);
    ctx.lineTo(ancho, alto * .25);
    ctx.lineTo(0, alto * .45);
    ctx.lineTo(-ancho, alto * .25);
    ctx.lineTo(-ancho, -alto * .55);
    ctx.closePath();
    ctx.fill();
    if (borde) {
      ctx.strokeStyle = borde;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = luz;
    ctx.beginPath();
    ctx.moveTo(0, -alto);
    ctx.lineTo(0, alto * .45);
    ctx.lineTo(-ancho, alto * .25);
    ctx.lineTo(-ancho, -alto * .55);
    ctx.closePath();
    ctx.fill();
  }

  function dibujarYacimiento(d) {
    const x = sx(d.x);
    const y = sy(d.y);
    const escala = (ppm / 7) * 1.7;
    if (x < -120 || x > W + 120 || y < -60 || y > H + 60) return;
    if (Math.abs(x - anclaX) < 62 + (d.m.tipo === 'carbon' || d.m.tipo === 'plata' || d.m.tipo === 'oro' ? d.largo * ppm * .5 : 0)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(d.giro);
    switch (d.m.tipo) {
      case 'carbon': {
        // Manto de carbón: lente negra y brillosa con vetas.
        const l = d.largo * ppm * .5;
        const g = 4 + d.piezas[0].tam * 5 * escala;
        ctx.fillStyle = '#1f1b24';
        ctx.beginPath();
        ctx.moveTo(-l, 0);
        ctx.bezierCurveTo(-l * .5, -g, l * .5, -g * 1.2, l, 0);
        ctx.bezierCurveTo(l * .5, g, -l * .5, g * .9, -l, 0);
        ctx.fill();
        ctx.strokeStyle = 'rgb(160 170 200 / .28)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-l * .6, -g * .25);
        ctx.lineTo(l * .4, -g * .4);
        ctx.moveTo(-l * .3, g * .3);
        ctx.lineTo(l * .55, g * .15);
        ctx.stroke();
        break;
      }
      case 'plata':
      case 'oro': {
        // Veta metálica serpenteante con pepitas y destellos.
        const oro = d.m.tipo === 'oro';
        const l = d.largo * ppm * .5;
        ctx.strokeStyle = oro ? '#f2b928' : '#c9d3dc';
        ctx.lineWidth = 3 * escala;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let t = -1; t <= 1.001; t += .125) {
          const px = t * l;
          const py = Math.sin(t * 5 + d.fase) * 4 * escala;
          t === -1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (oro) {
          ctx.shadowColor = '#ffcf40';
          ctx.shadowBlur = 8;
        }
        for (const p of d.piezas) {
          ctx.save();
          ctx.translate(p.dx * l * .45, Math.sin(p.dx * 2.2 + d.fase) * 4 * escala + p.dy * 2);
          pepita(4.5 * p.tam * escala, oro ? ['#ffd23f', '#fff3b0'] : ['#e3eaf0', '#ffffff'], 7, p.fase);
          ctx.restore();
        }
        ctx.shadowBlur = 0;
        destello(l * .3, -5 * escala, 7 * escala, d.fase, oro ? '#fff7cf' : '#ffffff');
        break;
      }
      case 'hierro':
        // Nódulos de hierro oxidado con una mancha rojiza alrededor.
        ctx.fillStyle = 'rgb(170 70 40 / .22)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 22 * escala, 12 * escala, 0, 0, Math.PI * 2);
        ctx.fill();
        for (const p of d.piezas) {
          ctx.save();
          ctx.translate(p.dx * 9 * escala, p.dy * 7 * escala);
          ctx.rotate(p.giro);
          pepita(5 * p.tam * escala, ['#7a3524', '#c4643a'], 6, p.fase);
          ctx.fillStyle = 'rgb(220 220 230 / .55)';
          ctx.fillRect(-1, -1, 2, 2);
          ctx.restore();
        }
        break;
      case 'cobre':
        // Cobre nativo con pátina verde de malaquita.
        for (const p of d.piezas) {
          ctx.save();
          ctx.translate(p.dx * 9 * escala, p.dy * 7 * escala);
          ctx.rotate(p.giro);
          pepita(4.6 * p.tam * escala, ['#c8693a', '#f4a56a'], 8, p.fase);
          ctx.fillStyle = '#3fbf9b';
          ctx.beginPath();
          ctx.arc(2.5 * escala, 2 * escala, 1.8 * escala * p.tam, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      case 'esmeralda':
      case 'rubi':
      case 'diamante': {
        const colores = {
          esmeralda: ['#1fae6a', 'rgb(190 255 220 / .5)', '#3ee08f'],
          rubi: ['#d61f45', 'rgb(255 200 210 / .5)', '#ff4d6d'],
          diamante: ['#c9f6ff', 'rgb(255 255 255 / .75)', '#9ff3ff'],
        }[d.m.tipo];
        ctx.shadowColor = colores[2];
        ctx.shadowBlur = reducido ? 8 : 9 + 5 * Math.sin(reloj * 1.6 + d.fase);
        for (const p of d.piezas) {
          ctx.save();
          ctx.translate(p.dx * 8 * escala, p.dy * 5 * escala);
          ctx.rotate(p.giro * .6);
          const alto = (d.m.tipo === 'diamante' ? 8 : 11) * p.tam * escala;
          const ancho = (d.m.tipo === 'esmeralda' ? 3.6 : 5) * p.tam * escala;
          cristal(alto, ancho, colores[0], colores[1], d.m.tipo === 'diamante' ? 'rgb(120 220 255 / .8)' : null);
          ctx.restore();
        }
        ctx.shadowBlur = 0;
        if (d.m.tipo === 'diamante') destello(4 * escala, -9 * escala, 9 * escala, d.fase);
        break;
      }
    }
    ctx.restore();
  }

  function dibujarCielo(suelo) {
    if (suelo <= 0) return;
    const cielo = ctx.createLinearGradient(0, 0, 0, suelo);
    cielo.addColorStop(0, '#bdebf3');
    cielo.addColorStop(0.72, '#e8f5df');
    cielo.addColorStop(1, '#fff0bd');
    ctx.fillStyle = cielo;
    ctx.fillRect(0, 0, W, Math.min(H, suelo));
    ctx.fillStyle = 'rgb(255 255 238 / .72)';
    for (let i = 0; i < 8; i++) {
      const x = (i * 173 + 47) % Math.max(W, 1);
      const y = 42 + (i % 3) * 48;
      ctx.beginPath();
      ctx.ellipse(x, y, 42 + (i % 2) * 16, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 30, y - 5, 28, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f8d45a';
    ctx.beginPath();
    ctx.arc(W * 0.18, Math.min(suelo * 0.34, 120), 34, 0, Math.PI * 2);
    ctx.fill();
    const colina = (alto, color, fase) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, suelo);
      for (let x = 0; x <= W + 40; x += 40) ctx.lineTo(x, suelo - alto - Math.sin(x * 0.009 + fase) * alto * 0.42);
      ctx.lineTo(W, suelo);
      ctx.closePath();
      ctx.fill();
    };
    colina(54, '#82bf85', 1.7);
    colina(24, '#4f9c72', 0.3);
    ctx.fillStyle = '#397259';
    ctx.fillRect(0, suelo - 5, W, 7);
    const azar = generador(51);
    for (let x = 0; x < W; x += 15 + azar() * 18) {
      const h = 5 + azar() * 10;
      ctx.strokeStyle = '#397259';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, suelo);
      ctx.lineTo(x + (azar() - 0.5) * 4, suelo - h);
      ctx.stroke();
      if (azar() > 0.72) {
        ctx.fillStyle = azar() > 0.5 ? '#ff7882' : '#ffe45f';
        ctx.beginPath();
        ctx.arc(x, suelo - h, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#8a4f47';
    ctx.beginPath();
    ctx.ellipse(anclaX, suelo + 3, 48, 16, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#35253e';
    ctx.beginPath();
    ctx.ellipse(anclaX, suelo + 1, 17, 7, 0, Math.PI, 0);
    ctx.fill();
  }

  function dibujarFondoTierra(yTop, yBot) {
    const desde = Math.max(0, yTop);
    if (yBot <= 0) return;
    const paso = 3;
    for (let py = Math.max(0, sy(desde)); py < H + paso; py += paso) {
      const y = camY + (py - anclaY) / ppm;
      const c = tenirPorMinerales(colorDeTierra(Math.max(1, y)), y);
      // Capas de sedimento: el color sube y baja un poco con la profundidad.
      const f = 1 + Math.sin(y * .52) * .05 + Math.sin(y * .137 + 1.3) * .08 + Math.sin(y * .031 + 4) * .06;
      ctx.fillStyle = rgb([c[0] * f, c[1] * f, c[2] * f]);
      ctx.fillRect(0, py, W, paso + 1);
    }
    for (let i = 1; i < ESTRATOS.length - 1; i++) {
      const limite = ESTRATOS[i].hasta;
      const yy = sy(limite);
      if (yy < -30 || yy > H + 30) continue;
      const siguiente = ESTRATOS[i + 1];
      ctx.strokeStyle = rgb(siguiente.base, .5);
      ctx.lineWidth = 13;
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 20) {
        const y = yy + Math.sin(x * 0.025 + limite) * 8 + Math.sin(x * 0.071) * 3;
        x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgb(255 247 220 / .16)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function dibujarPiedra(o, e) {
    const x = sx(o.x);
    const y = sy(o.y);
    const r = Math.max(2, o.r * ppm);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(o.giro);
    const c = mezcla(e.piedra, e.base, o.tono * .45);
    ctx.fillStyle = 'rgb(34 23 44 / .2)';
    ctx.beginPath();
    ctx.ellipse(2, 3, r * 1.25, r * .72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(c, .88);
    ctx.beginPath();
    ctx.moveTo(-r * 1.15, 0);
    ctx.lineTo(-r * .45, -r * .7);
    ctx.lineTo(r * .65, -r * .55);
    ctx.lineTo(r * 1.15, .1 * r);
    ctx.lineTo(r * .4, r * .65);
    ctx.lineTo(-r * .75, r * .5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgb(255 245 220 / .15)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function dibujarObjeto(o) {
    const e = estratoDe(Math.max(1, o.y));
    const x = sx(o.x);
    const y = sy(o.y);
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) return;
    if (Math.abs(x - anclaX) < 56) return;
    if (o.tipo === 'piedra') return dibujarPiedra(o, e);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(o.giro);
    if (o.tipo === 'fosil') {
      ctx.strokeStyle = 'rgb(255 220 150 / .62)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4.2; a += .16) {
        const r = a * 1.45;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        a ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    } else if (o.tipo === 'lamina') {
      ctx.strokeStyle = 'rgb(160 213 224 / .44)';
      ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-13, i * 4);
        ctx.lineTo(13, i * 4 + 2);
        ctx.stroke();
      }
    } else if (o.tipo === 'mota') {
      ctx.fillStyle = o.tono > .5 ? '#ffe45f' : '#f6dfe7';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc((i - 1.5) * 5, Math.sin(i) * 4, 2 + (i % 2), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (o.tipo === 'magma') {
      const brillo = reducido ? .7 : .62 + Math.sin(reloj * 2 + o.fase) * .2;
      ctx.shadowColor = '#ff704f';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = `rgb(255 116 76 / ${brillo})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-17, -9);
      ctx.lineTo(-5, -2);
      ctx.lineTo(2, -8);
      ctx.lineTo(8, 4);
      ctx.lineTo(18, 10);
      ctx.stroke();
    } else if (o.tipo === 'cristal') {
      const alto = 16 + o.r * 10;
      ctx.shadowColor = e.acento;
      ctx.shadowBlur = reducido ? 7 : 10 + 5 * Math.sin(reloj * 1.4 + o.fase);
      ctx.fillStyle = o.tono > .5 ? '#78edf2' : '#ca9cff';
      ctx.beginPath();
      ctx.moveTo(0, -alto);
      ctx.lineTo(8, -alto * .34);
      ctx.lineTo(6, alto * .3);
      ctx.lineTo(-6, alto * .3);
      ctx.lineTo(-8, -alto * .34);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgb(255 255 255 / .42)';
      ctx.beginPath();
      ctx.moveTo(0, -alto);
      ctx.lineTo(1, alto * .3);
      ctx.lineTo(-6, alto * .3);
      ctx.lineTo(-8, -alto * .34);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function dibujarRaices(yTop, yBot) {
    if (yTop > 130 || yBot < 0) return;
    const suelo = sy(0);
    ctx.strokeStyle = '#633f46';
    ctx.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const x = ((i * 137 + 31) % (W + 80)) - 40;
      const largo = 18 + (i % 6) * 11;
      ctx.lineWidth = 2 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(x, suelo);
      ctx.bezierCurveTo(x - 9, suelo + largo * .3, x + 15, suelo + largo * .68, x + (i % 2 ? 6 : -7), suelo + largo);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 2, suelo + largo * .58);
      ctx.lineTo(x + (i % 2 ? -14 : 14), suelo + largo * .8);
      ctx.stroke();
    }
  }

  function anchoTunel(y) {
    return 4.5 + Math.sin(y * .055) * .42 + Math.sin(y * .017 + 2) * .3;
  }

  function dibujarTunel(yTop, yBot) {
    const desde = Math.max(0, yTop - 3);
    // El túnel es una consecuencia del avance: nunca se dibuja por debajo
    // de la profundidad que ya alcanzó la cabeza del gusano.
    const hasta = Math.min(Math.max(0, camY), yBot + 3);
    if (hasta <= desde) return;
    const puntosIzq = [];
    const puntosDer = [];
    const agregarBorde = (y) => {
      const centro = Math.sin(y * .021) * .45;
      const distanciaAlFrente = hasta - y;
      const apertura = lerp(.56, 1, limitar(distanciaAlFrente / 6, 0, 1));
      const ancho = anchoTunel(y) * apertura;
      puntosIzq.push([sx(centro - ancho), sy(y)]);
      puntosDer.push([sx(centro + ancho), sy(y)]);
    };
    for (let y = desde; y < hasta; y += 3) agregarBorde(y);
    agregarBorde(hasta);
    ctx.fillStyle = '#30243a';
    ctx.strokeStyle = 'rgb(255 220 180 / .16)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    puntosIzq.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    [...puntosDer].reverse().forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const inicioMarca = Math.ceil(desde / 13) * 13;
    for (let y = inicioMarca; y <= hasta - 6; y += 13) {
      const py = sy(y);
      const ancho = anchoTunel(y) * ppm;
      ctx.strokeStyle = 'rgb(255 235 205 / .08)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(anclaX + Math.sin(y * .021) * .45 * ppm, py, ancho * .84, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function dibujarFrenteExcavacion() {
    if (camY <= 0) return;
    const x = sx(Math.sin(camY * .021) * .45);
    const y = sy(camY);
    const e = estratoDe(camY);
    const pulso = reducido ? 0 : Math.min(1, Math.abs(velocidad) / 90);
    ctx.save();
    ctx.strokeStyle = rgb(mezcla(e.base, [31, 22, 35], .48), .72);
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const lado = i % 2 ? 1 : -1;
      const origenX = x + lado * (17 + (i % 3) * 5);
      const largo = 6 + (i % 4) * 3 + pulso * 5;
      ctx.beginPath();
      ctx.moveTo(origenX, y - 2 + (i % 3) * 3);
      ctx.lineTo(origenX + lado * largo * .45, y + largo * .55);
      ctx.lineTo(origenX + lado * largo, y + largo);
      ctx.stroke();
    }
    const borde = ctx.createRadialGradient(x, y - 2, 3, x, y - 2, 39);
    borde.addColorStop(0, 'rgb(48 34 55 / .34)');
    borde.addColorStop(.58, 'rgb(48 34 55 / .08)');
    borde.addColorStop(1, 'rgb(48 34 55 / 0)');
    ctx.fillStyle = borde;
    ctx.fillRect(x - 42, y - 40, 84, 82);
    ctx.restore();
  }

  function rotulo(texto, yMetros, izquierda, acento, yTop, yBot) {
    if (yMetros < yTop - 30 || yMetros > yBot + 30) return;
    const y = sy(yMetros);
    ctx.save();
    ctx.font = `900 ${Math.round(limitar(ppm * 1.6, 12, 17))}px "Big Shoulders Stencil Display", Impact, sans-serif`;
    const ancho = ctx.measureText(texto).width + 22;
    // Cerca de los bordes, pero sin tapar el túnel ni la barra de profundidad.
    const x = izquierda ? Math.max(ancho / 2 + 96, anclaX - 150 - ancho / 2) : Math.min(W - ancho / 2 - 24, anclaX + 150 + ancho / 2);
    if ((izquierda && x + ancho / 2 > anclaX - 60) || (!izquierda && x - ancho / 2 < anclaX + 60)) return ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgb(24 22 47 / .7)';
    ctx.beginPath();
    ctx.roundRect(x - ancho / 2, y - 13, ancho, 26, 8);
    ctx.fill();
    ctx.strokeStyle = acento;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff8dc';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, x, y + 1);
    ctx.restore();
  }

  function dibujarRotulos(yTop, yBot) {
    let desde = 0;
    for (let i = 1; i < ESTRATOS.length; i++) {
      const e = ESTRATOS[i];
      rotulo(e.titulo.toUpperCase(), desde + 12, i % 2 === 0, e.acento, yTop, yBot);
      desde = Math.min(e.hasta, 7000);
    }
    MINERALES.forEach((m, i) => rotulo(`◆ ${m.nombre.toUpperCase()}`, m.pico, i % 2 === 1, m.color, yTop, yBot));
  }

  function dibujarIluminacion() {
    const lx = anclaX;
    const ly = anclaY - 25 * esc;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, 150);
    halo.addColorStop(0, 'rgb(255 206 153 / .18)');
    halo.addColorStop(.45, 'rgb(255 153 117 / .07)');
    halo.addColorStop(1, 'rgb(255 153 117 / 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(lx - 160, ly - 160, 320, 320);
    ctx.restore();
    const vi = ctx.createRadialGradient(anclaX, anclaY - 70 * esc, Math.min(W, H) * .18, anclaX, anclaY - 70 * esc, Math.max(W, H) * .82);
    vi.addColorStop(0, 'rgb(17 16 39 / 0)');
    vi.addColorStop(1, 'rgb(17 16 39 / .23)');
    ctx.fillStyle = vi;
    ctx.fillRect(0, 0, W, H);
  }

  function emitir(tipo, x, y, n, color) {
    if (reducido) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 25 + Math.random() * 95;
      particulas.push({ tipo, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (tipo === 'polvo' ? 10 : 35), vida: 0, max: .55 + Math.random() * .85, color: color || '#ffca7a', tam: 2 + Math.random() * 4 });
    }
  }

  function actualizarParticulas(dt) {
    particulas = particulas.filter((p) => (p.vida += dt) < p.max);
    ctx.save();
    for (const p of particulas) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= .975;
      p.vy += (p.tipo === 'polvo' ? -4 : 90) * dt;
      const t = 1 - p.vida / p.max;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.globalCompositeOperation = p.tipo === 'brillo' ? 'lighter' : 'source-over';
      if (p.tipo === 'brillo') {
        const s = p.tam * (1 + .2 * Math.sin(p.vida * 22));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 1.8);
        ctx.lineTo(p.x + s * .55, p.y);
        ctx.lineTo(p.x, p.y + s * 1.8);
        ctx.lineTo(p.x - s * .55, p.y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.tam * t, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function cuadro(ahora) {
    const dt = Math.min(.05, (ahora - ultimo) / 1000);
    ultimo = ahora;
    reloj += dt;
    acercarAncla(dt);
    if (animacion) {
      const p = limitar((ahora - animacion.inicio) / animacion.duracion, 0, 1);
      const anterior = camY;
      camY = animacion.desde + (animacion.hasta - animacion.desde) * suave(p);
      velocidad = dt ? (camY - anterior) / dt : 0;
      alCambiarProfundidad(camY);
      if (!reducido && Math.abs(velocidad) > 55 && Math.random() > .78) emitir('polvo', anclaX + (Math.random() - .5) * 54, anclaY + 1, 2, 'rgb(225 167 120 / .64)');
      if (p >= 1) {
        const resolver = animacion.resolver;
        animacion = null;
        velocidad = 0;
        resolver();
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#15152b';
    ctx.fillRect(0, 0, W, H);
    const yTop = camY - anclaY / ppm;
    const yBot = camY + (H - anclaY) / ppm;
    const suelo = sy(0);
    if (yTop < 0) dibujarCielo(suelo);
    dibujarFondoTierra(yTop, yBot);
    dibujarRaices(yTop, yBot);
    const k0 = Math.floor(Math.max(0, yTop - 8) / BLOQUE);
    const k1 = Math.floor(Math.max(0, yBot + 8) / BLOQUE);
    for (let k = k0; k <= k1; k++) for (const objeto of datosBloque(k)) dibujarObjeto(objeto);
    for (let k = k0; k <= k1; k++) for (const yacimiento of datosYacimientos(k)) dibujarYacimiento(yacimiento);
    dibujarTunel(yTop, yBot);
    dibujarFrenteExcavacion();
    dibujarRotulos(yTop, yBot);
    if (!reducido && Math.abs(velocidad) > 70) {
      ctx.strokeStyle = 'rgb(255 248 220 / .12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const x = anclaX + (Math.random() - .5) * 150;
        const y = Math.random() * H;
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + Math.min(70, Math.abs(velocidad) * .018));
      }
      ctx.stroke();
    }
    dibujarIluminacion();
    actualizarParticulas(dt);
    requestAnimationFrame(cuadro);
  }

  disponer();
  addEventListener('resize', disponer);
  requestAnimationFrame((t) => {
    ultimo = t;
    cuadro(t);
  });

  const puntoExcavacion = () => ({ x: anclaX, y: anclaY - 5 * esc });

  return {
    disponer,
    get profundidad() {
      return camY;
    },
    set reducido(v) {
      reducido = Boolean(v);
      if (reducido) particulas = [];
    },
    fijarProfundidad(destino, { animar = true } = {}) {
      if (animacion) {
        camY = animacion.hasta;
        animacion.resolver();
        animacion = null;
      }
      if (!animar || reducido || Math.abs(destino - camY) < .01) {
        camY = destino;
        velocidad = 0;
        alCambiarProfundidad(camY);
        return Promise.resolve();
      }
      const distancia = Math.abs(destino - camY);
      return new Promise((resolver) => {
        animacion = { desde: camY, hasta: destino, inicio: performance.now(), duracion: limitar(850 + distancia * 2.2, 850, 3200), resolver };
      });
    },
    golpe() {
      const p = puntoExcavacion();
      emitir('polvo', p.x, p.y, 8, 'rgb(236 175 126 / .68)');
    },
    descubrir(rareza) {
      const p = puntoExcavacion();
      emitir('brillo', p.x, p.y, rareza === 'diamante' ? 48 : rareza === 'oro' ? 34 : 22, COLORES_RAREZA[rareza] || '#ffffff');
      return p;
    },
    duracionDescenso(metros) {
      return reducido ? 0 : limitar(850 + Math.abs(metros) * 2.2, 850, 3200);
    },
  };
}
