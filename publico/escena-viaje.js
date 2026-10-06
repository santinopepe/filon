// Filón — motor de las escenas «de viaje» (Farándula y Geografía), en pixel art.
// Misma interfaz que la mina (escena.js): el avance de la partida (0 a 7.000 «metros») mueve el mundo
// en horizontal alrededor de Filón, que se queda en su lugar.
//
// Cada cuadro se dibuja en dos lienzos chicos y se agranda sin suavizado:
//  - el fondo (cielo, nubes, sierras, ciudad) a la mitad de resolución y desenfocado: pixel art borroso;
//  - el medio (opcional: paisaje cercano, monumentos, árboles) nítido y con contorno de un pixel;
//  - el frente (suelo, público, avión, Filón) nítido: cada pixel queda opaco o vacío, y lo que tiene que
//    verse translúcido (humo, flashes, la hélice) usa una trama de pixeles (vista.trama).
// Filón se pixela a partir del mismo SVG del juego (con el vestuario del modo), con contorno oscuro.
import { calcularAncla, acercarA, limitar, suave, COLORES_RAREZA } from './escena.js';

// Cuántos metros de avance ocupa en pantalla la altura de Filón: el decorado se dibuja en esa unidad
// (vista.alto), así la composición es la misma en un celular y en un monitor grande.
const METROS_POR_ALTURA = 52;
// Pixeles de pantalla por pixel de la escena: Filón mide unos 52 pixeles de alto.
const PIXELES_POR_ALTURA = 52;

// Matriz de Bayer 4×4, para las tramas de las cosas translúcidas.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Bordes duros: cada pixel queda opaco o vacío (sin el suavizado de las formas vectoriales). */
function endurecer(ctx, ancho, alto) {
  if (!ancho || !alto) return;
  const imagen = ctx.getImageData(0, 0, ancho, alto);
  const d = imagen.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) d[i] = d[i] >= 128 ? 255 : 0;
  ctx.putImageData(imagen, 0, 0);
}

function capa() {
  const c = document.createElement('canvas');
  return { c, ctx: c.getContext('2d', { willReadFrequently: true }), escala: 1 };
}

/** Imagen de Filón con el vestuario del modo, a partir del SVG del gusano del juego. */
function spriteDeFilon(vestuario) {
  const original = document.querySelector('#minero svg');
  const img = new Image();
  if (!original) return img;
  const svg = original.cloneNode(true);
  // Sin halo, sin sombra difusa y sin la ondulación del contorno: en pixeles queda una silueta limpia.
  svg.querySelector('.halo-organico')?.remove();
  svg.querySelector('use[filter]')?.remove();
  svg.querySelector('.gusano-cuerpo')?.removeAttribute('filter');
  for (const g of svg.querySelectorAll('.accesorio')) {
    if (g.classList.contains(`de-${vestuario}`)) g.removeAttribute('class');
    else g.remove();
  }
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  return img;
}

/** Contorno de un pixel alrededor de todo lo opaco de una capa (como el delineado del pixel art). */
function contornear(ctx, ancho, alto, [r, g, b]) {
  if (!ancho || !alto) return;
  const imagen = ctx.getImageData(0, 0, ancho, alto);
  const d = imagen.data;
  const opaco = new Uint8Array(ancho * alto);
  for (let i = 0; i < opaco.length; i++) opaco[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x;
      const j = i * 4;
      if (opaco[i]) {
        d[j + 3] = 255;
        continue;
      }
      if ((x > 0 && opaco[i - 1]) || (x < ancho - 1 && opaco[i + 1]) || (y > 0 && opaco[i - ancho]) || (y < alto - 1 && opaco[i + ancho])) {
        d[j] = r;
        d[j + 1] = g;
        d[j + 2] = b;
        d[j + 3] = 255;
      } else d[j + 3] = 0;
    }
  }
  ctx.putImageData(imagen, 0, 0);
}

/** Filón a `alto` pixeles: bordes duros y contorno oscuro de un pixel, como un sprite. */
function pixelarFilon(sprite, alto) {
  const ancho = Math.round((alto * 120) / 224);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho + 2;
  lienzo.height = alto + 2;
  const g = lienzo.getContext('2d', { willReadFrequently: true });
  g.drawImage(sprite, 1, 1, ancho, alto);
  const imagen = g.getImageData(0, 0, lienzo.width, lienzo.height);
  const d = imagen.data;
  const opaco = new Uint8Array(lienzo.width * lienzo.height);
  for (let i = 0; i < opaco.length; i++) opaco[i] = d[i * 4 + 3] >= 110 ? 1 : 0;
  for (let y = 0; y < lienzo.height; y++) {
    for (let x = 0; x < lienzo.width; x++) {
      const i = y * lienzo.width + x;
      if (opaco[i]) {
        d[i * 4 + 3] = 255;
        continue;
      }
      const vecino = (x > 0 && opaco[i - 1]) || (x < lienzo.width - 1 && opaco[i + 1]) || (y > 0 && opaco[i - lienzo.width]) || (y < lienzo.height - 1 && opaco[i + lienzo.width]);
      if (vecino) {
        d.set([28, 18, 48, 255], i * 4);
      } else d[i * 4 + 3] = 0;
    }
  }
  g.putImageData(imagen, 0, 0);
  return lienzo;
}

const soportaFiltro = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'blur(1px)';
    return c.filter === 'blur(1px)';
  } catch {
    return false;
  }
})();

/**
 * mundo = {
 *   entrada,                          // metros desde los que arranca la animación de entrada (negativo)
 *   vestuario,                        // accesorios de Filón: 'farandula' | 'geografia'
 *   dibujarFondo(ctx, vista),         // capa de fondo (se desenfoca)
 *   dibujarMedio?(ctx, vista),        // capa intermedia nítida, con contorno de color `contorno`
 *   dibujarFrente(ctx, vista, emitir),// capa nítida; dibuja a Filón con vista.filon(ctx, opciones)
 *   golpe?(vista, emitir), descubrir?(vista, emitir, rareza, color),
 * }
 */
export function crearEscenaViaje(canvas, { mundo, alCambiarProfundidad = () => {}, zonaLibre }) {
  const ctx = canvas.getContext('2d');
  const vista = { W: 0, H: 0, ppm: 7, k: 4, P: 4, alto: 224, anclaX: 0, anclaY: 0, esc: 1, x: 0, reloj: 0, reducido: false, velocidad: 0, dt: 0, pose: null, mostrarFilon: true };
  const fondo = capa();
  const medio = capa();
  const frente = capa();
  const sprite = spriteDeFilon(mundo.vestuario);
  let filonPixelado = null;
  const minero = document.getElementById('minero');
  const patrones = new Map();
  let dpr = 1;
  let animacion = null;
  let ultimo = performance.now();
  let particulas = [];
  let claveDisposicion = '';
  let objetivo = null;
  let marco = null;

  // Alinea una coordenada de pantalla a la cuadrícula de pixeles de la escena.
  vista.snap = (n) => Math.round(n / vista.P) * vista.P;
  // Rectángulo alineado a la cuadrícula (todo lo que sea «sprite» se dibuja así, sin bordes suaves).
  vista.rect = (c, x, y, w, h, color) => {
    const P = vista.P;
    const x0 = Math.round(x / P) * P;
    const y0 = Math.round(y / P) * P;
    c.fillStyle = color;
    c.fillRect(x0, y0, Math.max(P, Math.round((x + w) / P) * P - x0), Math.max(P, Math.round((y + h) / P) * P - y0));
  };

  /** Trama de pixeles de un color con cierta densidad (0 a 1): la forma pixelada de algo translúcido. */
  vista.trama = (c, color, densidad) => {
    const P = vista.P;
    const nivel = Math.round(limitar(densidad, 0, 1) * 16);
    const clave = `${color}|${nivel}|${P}`;
    if (!patrones.has(clave)) {
      const lienzo = document.createElement('canvas');
      lienzo.width = lienzo.height = 4 * P;
      const g = lienzo.getContext('2d');
      g.fillStyle = color;
      for (let i = 0; i < 16; i++) if (BAYER[i] < nivel) g.fillRect((i % 4) * P, Math.floor(i / 4) * P, P, P);
      patrones.set(clave, c.createPattern(lienzo, 'repeat'));
    }
    return patrones.get(clave);
  };

  /** Dibuja a Filón (pies en x, y) con su pose del momento; `recorte` oculta lo que quede debajo de esa altura. */
  vista.filon = (c, { x = vista.anclaX, y = vista.anclaY, recorte = null, saltar = true } = {}) => {
    if (!vista.mostrarFilon || !sprite.complete || !sprite.naturalWidth) return;
    const P = vista.P;
    const altoPx = Math.round(vista.alto / P);
    if (filonPixelado?.alto !== altoPx) filonPixelado = { alto: altoPx, lienzo: pixelarFilon(sprite, altoPx) };
    const l = filonPixelado.lienzo;
    const a = vista.alto;
    const t = vista.reloj;
    const quieto = vista.reducido;
    let dy = 0;
    let sx = 1;
    let sy = 1;
    let giro = 0;
    const p = vista.pose;
    if (!quieto && saltar && (p === 'bajando' || Math.abs(vista.velocidad) > 30)) {
      dy = -Math.abs(Math.sin(t * 11)) * a * 0.035;
      giro = Math.sin(t * 11) * 0.03;
    } else if (!quieto && p === 'festejando') {
      dy = -Math.abs(Math.sin(t * 8)) * a * 0.12;
    } else if (!quieto && p === 'cavando') {
      sy = 1 - Math.abs(Math.sin(t * 18)) * 0.06;
      sx = 2 - sy;
    } else if (p === 'triste') {
      sy = 0.95;
      giro = 0.06;
    }
    c.save();
    if (recorte != null) {
      c.beginPath();
      c.rect(x - a, recorte - a * 2, a * 2, a * 2);
      c.clip();
    }
    c.translate(vista.snap(x), vista.snap(y + dy));
    c.rotate(giro);
    c.scale(sx, sy);
    c.imageSmoothingEnabled = false;
    if (p === 'triste') c.filter = 'brightness(.75)';
    c.drawImage(l, -Math.floor(l.width / 2) * P, -(l.height - 1) * P, l.width * P, l.height * P);
    c.restore();
  };

  function aplicarAncla() {
    const raiz = document.documentElement.style;
    raiz.setProperty('--minero-x', `${vista.anclaX.toFixed(1)}px`);
    raiz.setProperty('--minero-y', `${vista.anclaY.toFixed(1)}px`);
    raiz.setProperty('--escala-minero', vista.esc.toFixed(3));
  }

  function disponer() {
    vista.W = innerWidth;
    vista.H = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    const z = zonaLibre();
    const clave = [vista.W, vista.H, dpr, Math.round(z.izquierda), Math.round(z.derecha), Math.round(z.arriba), Math.round(z.abajo), z.movil, z.centrado].join(':');
    if (clave === claveDisposicion) return;
    const primera = !claveDisposicion;
    claveDisposicion = clave;
    if (canvas.width !== Math.round(vista.W * dpr) || canvas.height !== Math.round(vista.H * dpr)) {
      canvas.width = Math.round(vista.W * dpr);
      canvas.height = Math.round(vista.H * dpr);
    }
    vista.ppm = limitar(vista.H / 126, 5.4, 8.6);
    objetivo = calcularAncla(z, vista.H);
    if (primera || vista.reducido) {
      vista.anclaX = objetivo.x;
      vista.anclaY = objetivo.y;
      vista.esc = objetivo.esc;
      aplicarAncla();
    }
  }

  function acercarAncla(dt) {
    if (!objetivo) return;
    const actual = { x: vista.anclaX, y: vista.anclaY, esc: vista.esc };
    if (!acercarA(actual, objetivo, dt, vista.reducido)) return;
    ({ x: vista.anclaX, y: vista.anclaY, esc: vista.esc } = actual);
    aplicarAncla();
  }

  function emitir(tipo, x, y, n, color, { fuerza = 1, gravedad = null } = {}) {
    if (vista.reducido) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (25 + Math.random() * 95) * fuerza;
      particulas.push({
        tipo,
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (tipo === 'confeti' ? 70 : tipo === 'humo' ? 10 : 35),
        vida: 0,
        max: (tipo === 'confeti' ? 1.1 : tipo === 'humo' ? 1.2 : 0.55) + Math.random() * 0.85,
        color: Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color || '#ffca7a',
        tam: tipo === 'humo' ? 2.5 + Math.random() * 2 : 1 + Math.random() * 1.5, // en pixeles de la escena
        gravedad: gravedad ?? (tipo === 'humo' ? -6 : tipo === 'confeti' ? 60 : 90),
      });
    }
  }

  // Partículas en pixeles: cuadraditos, cruces para los brillos y bolas tramadas para el humo.
  function actualizarParticulas(c, dt) {
    const P = vista.P;
    particulas = particulas.filter((p) => (p.vida += dt) < p.max);
    c.save();
    for (const p of particulas) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.975;
      p.vy += p.gravedad * dt;
      const t = 1 - p.vida / p.max;
      const x = Math.round(p.x / P) * P;
      const y = Math.round(p.y / P) * P;
      c.fillStyle = p.color;
      if (p.tipo === 'humo') {
        c.fillStyle = vista.trama(c, p.color, t * 0.8);
        c.beginPath();
        c.arc(x, y, p.tam * P * (1.6 - t * 0.6), 0, Math.PI * 2);
        c.fill();
      } else if (p.tipo === 'brillo') {
        const s = Math.max(1, Math.round(p.tam * t + 0.4)) * P;
        c.fillRect(x - s, y, s * 3 - (s - P), P);
        c.fillRect(x, y - s, P, s * 3 - (s - P));
      } else {
        const s = Math.max(1, Math.round(p.tam * (p.tipo === 'confeti' ? 1 : t))) * P;
        c.fillRect(x, y, s, p.tipo === 'confeti' && Math.sin(p.vida * 14) > 0 ? P : s);
      }
    }
    c.restore();
  }

  function preparar(l, escala) {
    const w = Math.ceil(vista.W / escala) + 1;
    const h = Math.ceil(vista.H / escala) + 1;
    if (l.c.width !== w || l.c.height !== h) {
      l.c.width = w;
      l.c.height = h;
    }
    l.escala = escala;
    l.ctx.setTransform(1 / escala, 0, 0, 1 / escala, 0, 0);
    l.ctx.clearRect(0, 0, vista.W + escala, vista.H + escala);
    return l.ctx;
  }

  function cuadro(ahora) {
    const dt = Math.min(0.05, (ahora - ultimo) / 1000);
    ultimo = ahora;
    vista.reloj += dt;
    vista.dt = dt;
    acercarAncla(dt);
    vista.alto = 224 * vista.esc; // altura de Filón en pixeles de pantalla
    vista.k = vista.alto / METROS_POR_ALTURA; // pixeles de pantalla por metro de avance
    vista.P = limitar(Math.round(vista.alto / PIXELES_POR_ALTURA), 2, 6);
    vista.pose = ['bajando', 'festejando', 'cavando', 'triste'].find((c) => minero?.classList.contains(c)) ?? null;
    const cuerpo = document.body.classList;
    vista.mostrarFilon = !cuerpo.contains('en-final') || cuerpo.contains('en-recorrido');
    if (animacion) {
      const p = limitar((ahora - animacion.inicio) / animacion.duracion, 0, 1);
      const anterior = vista.x;
      vista.x = animacion.desde + (animacion.hasta - animacion.desde) * (animacion.lineal ? p : suave(p));
      vista.velocidad = dt ? (vista.x - anterior) / dt : 0;
      alCambiarProfundidad(Math.max(0, vista.x));
      if (p >= 1) {
        const resolver = animacion.resolver;
        animacion = null;
        vista.velocidad = 0;
        resolver();
      }
    }

    const P = vista.P;
    const escalaFondo = P * 2;
    mundo.dibujarFondo(preparar(fondo, escalaFondo), vista);
    if (mundo.dibujarMedio) {
      mundo.dibujarMedio(preparar(medio, P), vista);
      contornear(medio.ctx, medio.c.width, medio.c.height, mundo.contorno ?? [28, 18, 48]);
    }
    const cf = preparar(frente, P);
    mundo.dibujarFrente(cf, vista, emitir);
    actualizarParticulas(cf, dt);
    endurecer(frente.ctx, frente.c.width, frente.c.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#15152b';
    ctx.fillRect(0, 0, vista.W, vista.H);
    // Fondo: pixeles grandes y un poco desenfocados (profundidad). Se agranda un borde para que el
    // desenfoque no oscurezca los costados.
    if (soportaFiltro) ctx.filter = `blur(${(P * 0.55 * dpr).toFixed(1)}px)`;
    const borde = escalaFondo * 2;
    ctx.drawImage(fondo.c, -borde, -borde, fondo.c.width * escalaFondo + borde * 2, fondo.c.height * escalaFondo + borde * 2);
    ctx.filter = 'none';
    if (mundo.dibujarMedio) ctx.drawImage(medio.c, 0, 0, medio.c.width * P, medio.c.height * P);
    ctx.drawImage(frente.c, 0, 0, frente.c.width * P, frente.c.height * P);
    marco = requestAnimationFrame(cuadro);
  }

  disponer();
  addEventListener('resize', disponer);
  marco = requestAnimationFrame((t) => {
    ultimo = t;
    cuadro(t);
  });

  const duracion = (metros) => limitar(850 + Math.abs(metros) * 2.2, 850, 3200);
  const punto = () => ({ x: vista.anclaX, y: vista.anclaY - 60 * vista.esc });

  function animar(desde, hasta, ms, lineal = false) {
    if (animacion) {
      vista.x = animacion.hasta;
      animacion.resolver();
      animacion = null;
    }
    vista.x = desde;
    return new Promise((resolver) => {
      animacion = { desde, hasta, inicio: performance.now(), duracion: ms, resolver, lineal };
    });
  }

  return {
    disponer,
    detener() {
      cancelAnimationFrame(marco);
      removeEventListener('resize', disponer);
      if (animacion) animacion.resolver();
      animacion = null;
    },
    get profundidad() {
      return vista.x;
    },
    set reducido(v) {
      vista.reducido = Boolean(v);
      if (vista.reducido) particulas = [];
    },
    fijarProfundidad(destino, { animar: conAnimacion = true } = {}) {
      if (!conAnimacion || vista.reducido || Math.abs(destino - vista.x) < 0.01) {
        if (animacion) {
          animacion.resolver();
          animacion = null;
        }
        vista.x = destino;
        vista.velocidad = 0;
        alCambiarProfundidad(Math.max(0, destino));
        return Promise.resolve();
      }
      return animar(vista.x, destino, duracion(destino - vista.x));
    },
    /** Pequeña escena de arranque: Filón sale de la limusina o carretea por la pista. */
    entrada() {
      if (vista.reducido || !mundo.entrada || vista.x > 0) return Promise.resolve();
      return animar(mundo.entrada, 0, 1400, true);
    },
    golpe() {
      const p = punto();
      if (mundo.golpe) mundo.golpe(vista, emitir);
      else emitir('polvo', p.x, p.y, 8, '#fff0dc');
    },
    descubrir(rareza) {
      const p = punto();
      const color = COLORES_RAREZA[rareza] || '#ffffff';
      if (mundo.descubrir) mundo.descubrir(vista, emitir, rareza, color);
      emitir('brillo', p.x, p.y, rareza === 'diamante' ? 40 : rareza === 'oro' ? 28 : 18, color);
      return p;
    },
    duracionDescenso(metros) {
      return vista.reducido ? 0 : duracion(metros);
    },
  };
}
