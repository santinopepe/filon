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
  const bloques = new Map();

  function disponer() {
    W = innerWidth;
    H = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    const z = zonaLibre();
    const clave = [W, H, dpr, Math.round(z.izquierda), Math.round(z.derecha), Math.round(z.arriba), Math.round(z.abajo), z.movil].join(':');
    if (clave === claveDisposicion) return;
    claveDisposicion = clave;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    esc = z.movil ? limitar((z.abajo - z.arriba) / 250, 0.66, 0.82) : limitar(H / 900, 0.82, 1.08);
    ppm = limitar(H / 126, 5.4, 8.6);
    anclaX = (z.izquierda + z.derecha) / 2;
    anclaY = z.movil ? z.abajo - 3 : z.arriba + (z.abajo - z.arriba) * 0.62;
    const raiz = document.documentElement.style;
    raiz.setProperty('--minero-x', `${anclaX}px`);
    raiz.setProperty('--minero-y', `${anclaY}px`);
    raiz.setProperty('--escala-minero', esc.toFixed(3));
    bloques.clear();
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
      ctx.fillStyle = rgb(colorDeTierra(Math.max(1, y)));
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

  function dibujarRotulos(yTop, yBot) {
    let desde = 0;
    for (let i = 1; i < ESTRATOS.length; i++) {
      const e = ESTRATOS[i];
      if (desde >= yTop - 30 && desde <= yBot + 30) {
        const y = sy(desde + 12);
        const izquierda = i % 2 === 0;
        const x = izquierda ? 74 : W - 74;
        if (x > 110 && (!izquierda || x < anclaX - 90) && (izquierda || x > anclaX + 90)) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.font = `900 ${Math.round(limitar(ppm * 1.6, 12, 17))}px "Big Shoulders Stencil Display", Impact, sans-serif`;
          const texto = e.titulo.toUpperCase();
          const ancho = ctx.measureText(texto).width + 22;
          ctx.fillStyle = 'rgb(24 22 47 / .68)';
          ctx.beginPath();
          ctx.roundRect(x - ancho / 2, y - 13, ancho, 26, 8);
          ctx.fill();
          ctx.strokeStyle = e.acento;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = '#fff8dc';
          ctx.textBaseline = 'middle';
          ctx.fillText(texto, x, y + 1);
          ctx.restore();
        }
      }
      desde = Math.min(e.hasta, 7000);
    }
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
