// Gráficos del panel en SVG, sin dependencias. Marcas finas, grilla tenue, texto en tinta (nunca en
// el color de la serie) y tooltip al pasar el mouse o al enfocar con el teclado.
const SVG = 'http://www.w3.org/2000/svg';
const numero = new Intl.NumberFormat('es-AR');
export const fmt = (n) => numero.format(Math.round(n));

export function s(etiqueta, atributos = {}, texto) {
  const el = document.createElementNS(SVG, etiqueta);
  for (const [k, v] of Object.entries(atributos)) if (v != null) el.setAttribute(k, v);
  if (texto != null) el.textContent = texto;
  return el;
}

// ───────── Tooltip ─────────

const tip = () => document.getElementById('tooltip');

/** filas: [{ valor, etiqueta, clave? }] — el valor manda, la etiqueta acompaña. */
export function mostrarTooltip(titulo, filas, x, y) {
  const t = tip();
  const cabeza = document.createElement('p');
  cabeza.className = 'tooltip-titulo';
  cabeza.textContent = titulo;
  t.replaceChildren(
    cabeza,
    ...filas.map((f) => {
      const p = document.createElement('p');
      if (f.clave) {
        const i = document.createElement('i');
        i.className = `clave-linea ${f.clave}`;
        p.append(i);
      }
      const b = document.createElement('b');
      b.textContent = f.valor;
      const span = document.createElement('span');
      span.textContent = ` ${f.etiqueta}`;
      p.append(b, span);
      return p;
    }),
  );
  t.hidden = false;
  const ancho = t.offsetWidth;
  const alto = t.offsetHeight;
  const izquierda = Math.min(innerWidth - ancho - 8, Math.max(8, x + 14));
  const arriba = y - alto - 12 < 8 ? y + 16 : y - alto - 12;
  t.style.left = `${izquierda}px`;
  t.style.top = `${arriba}px`;
}

export function ocultarTooltip() {
  tip().hidden = true;
}

/** Vuelve interactiva una zona: tooltip con mouse y teclado, y acción opcional al hacer clic/Enter. */
export function interactivo(el, { titulo, filas, alElegir, etiqueta }) {
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', alElegir ? 'button' : 'img');
  el.setAttribute('aria-label', etiqueta || `${titulo}: ${filas.map((f) => `${f.valor} ${f.etiqueta}`).join(', ')}`);
  el.classList.add('activo');
  el.addEventListener('pointermove', (ev) => mostrarTooltip(titulo, filas, ev.clientX, ev.clientY));
  el.addEventListener('pointerleave', ocultarTooltip);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    mostrarTooltip(titulo, filas, r.left + r.width / 2, r.top);
  });
  el.addEventListener('blur', ocultarTooltip);
  if (alElegir) {
    el.addEventListener('click', alElegir);
    el.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), alElegir()));
  }
}

// ───────── Utilidades de ejes ─────────

/** Marcas «redondas» para el eje Y (0, 5, 10… / 0, 200, 400…). */
export function marcasY(maximo, cantidad = 4) {
  if (maximo <= 0) return { tope: 1, marcas: [0, 1] };
  const crudo = maximo / cantidad;
  const potencia = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 5, 10].map((m) => m * potencia).find((p) => p >= crudo) || 10 * potencia;
  const pasoEntero = Math.max(1, paso);
  const tope = Math.ceil(maximo / pasoEntero) * pasoEntero;
  const marcas = [];
  for (let v = 0; v <= tope + 1e-9; v += pasoEntero) marcas.push(v);
  return { tope, marcas };
}

/** Barra con el extremo superior redondeado (4 px) y la base recta. */
function barra(x, y, ancho, alto, radio = 4) {
  const r = Math.min(radio, ancho / 2, alto);
  return `M${x},${y + alto}V${y + r}Q${x},${y} ${x + r},${y}H${x + ancho - r}Q${x + ancho},${y} ${x + ancho},${y + r}V${y + alto}Z`;
}

function lienzo(contenedor, alto) {
  const ancho = Math.max(280, contenedor.clientWidth);
  const svg = s('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, class: 'svg-grafico' });
  contenedor.replaceChildren(svg);
  return { svg, ancho };
}

function ejeY(svg, { izq, der, arriba, abajo, marcas, tope }) {
  for (const v of marcas) {
    const y = abajo - (v / tope) * (abajo - arriba);
    svg.append(s('line', { x1: izq, x2: der, y1: y, y2: y, class: 'grilla' }));
    svg.append(s('text', { x: izq - 8, y: y + 4, class: 'eje', 'text-anchor': 'end' }, fmt(v)));
  }
}

// ───────── Columnas apiladas: jugadores por día ─────────

/**
 * dias: [{ fecha, etiqueta, desafio, segmentos: [{ valor, clase, nombre }], filas (tooltip) }]
 * elegida: fecha resaltada; alElegir(fecha) al hacer clic en una columna.
 */
export function columnasApiladas(contenedor, { dias, elegida, alElegir, alto = 250, vacio = 'Sin datos en el período.' }) {
  const { svg, ancho } = lienzo(contenedor, alto);
  const izq = 44;
  const der = ancho - 8;
  const arriba = 14;
  const abajo = alto - 28;
  const total = (d) => d.segmentos.reduce((s, x) => s + x.valor, 0);
  const maximo = Math.max(0, ...dias.map(total));
  const { tope, marcas } = marcasY(maximo || 1);
  ejeY(svg, { izq, der, arriba, abajo, marcas, tope });
  const banda = (der - izq) / Math.max(1, dias.length);
  const anchoBarra = Math.max(3, Math.min(24, banda * 0.66));
  const cadaCuanto = Math.max(1, Math.ceil(dias.length / Math.max(1, (der - izq) / 54)));
  dias.forEach((d, i) => {
    const x0 = izq + i * banda;
    const centro = x0 + banda / 2;
    if (d.fecha === elegida) svg.append(s('rect', { x: x0, y: arriba - 6, width: banda, height: abajo - arriba + 6, class: 'banda-elegida', rx: 4 }));
    let y = abajo;
    const visibles = d.segmentos.filter((x) => x.valor > 0);
    visibles.forEach((seg, j) => {
      const h = (seg.valor / tope) * (abajo - arriba);
      const gap = j > 0 ? 2 : 0; // separación en el color de la superficie entre segmentos
      const alturaVisible = Math.max(1, h - gap);
      const ultimo = j === visibles.length - 1;
      const yTop = y - h;
      svg.append(
        ultimo
          ? s('path', { d: barra(centro - anchoBarra / 2, yTop, anchoBarra, alturaVisible), class: `marca ${seg.clase}` })
          : s('rect', { x: centro - anchoBarra / 2, y: yTop + 0, width: anchoBarra, height: alturaVisible, class: `marca ${seg.clase}` }),
      );
      y = yTop;
    });
    if (!d.desafio) svg.append(s('line', { x1: centro - 4, x2: centro + 4, y1: abajo - 3, y2: abajo - 3, class: 'sin-dato' }));
    // Rótulos espaciados; el del día elegido siempre, sin que choque con un vecino.
    const indiceElegido = dias.findIndex((x) => x.fecha === elegida);
    const cercaDelElegido = indiceElegido >= 0 && i !== indiceElegido && Math.abs(i - indiceElegido) < cadaCuanto;
    if ((i % cadaCuanto === 0 && !cercaDelElegido) || d.fecha === elegida) {
      svg.append(s('text', { x: centro, y: alto - 8, class: `eje${d.fecha === elegida ? ' eje-fuerte' : ''}`, 'text-anchor': 'middle' }, d.etiqueta));
    }
    const zona = s('rect', { x: x0, y: arriba - 6, width: banda, height: abajo - arriba + 6, class: 'zona' });
    interactivo(zona, { titulo: d.titulo, filas: d.filas, alElegir: alElegir && d.desafio ? () => alElegir(d.fecha) : null });
    svg.append(zona);
  });
  svg.append(s('line', { x1: izq, x2: der, y1: abajo, y2: abajo, class: 'base' }));
  if (!maximo) svg.append(s('text', { x: (izq + der) / 2, y: (arriba + abajo) / 2, class: 'eje', 'text-anchor': 'middle' }, vacio));
}

// ───────── Histograma + campana normal ─────────

const densidadNormal = (x, media, desvio) => Math.exp(-0.5 * ((x - media) / desvio) ** 2) / (desvio * Math.sqrt(2 * Math.PI));

// Los valores pueden venir sueltos (números) o como histograma ({ valor, cantidad }).
const valorDe = (v) => (typeof v === 'number' ? v : v.valor);
const pesoDe = (v) => (typeof v === 'number' ? 1 : v.cantidad);

/** Cuenta los valores en tramos de `ancho` entre 0 y `maximo` (el máximo entra en el último tramo). */
export function tramos(valores, maximo, ancho) {
  const n = Math.ceil(maximo / ancho);
  const cuentas = Array.from({ length: n }, (_, i) => ({ desde: i * ancho, hasta: (i + 1) * ancho - 1, cantidad: 0 }));
  for (const v of valores) cuentas[Math.min(n - 1, Math.max(0, Math.floor(valorDe(v) / ancho)))].cantidad += pesoDe(v);
  return cuentas;
}

export function campana(contenedor, { valores, resumen, maximo = 7000, ancho = 500, alto = 260, unidad = 'm' }) {
  const { svg, ancho: anchoSvg } = lienzo(contenedor, alto);
  const izq = 40;
  const der = anchoSvg - 12;
  const arriba = 26;
  const abajo = alto - 28;
  const cuentas = tramos(valores, maximo, ancho);
  const n = valores.reduce((s, v) => s + pesoDe(v), 0);
  const conCurva = n >= 3 && resumen?.desviacion > 0;
  const curva = [];
  if (conCurva) {
    for (let x = 0; x <= maximo; x += maximo / 140) curva.push([x, n * ancho * densidadNormal(x, resumen.promedio, resumen.desviacion)]);
  }
  const pico = Math.max(1, ...cuentas.map((c) => c.cantidad), ...curva.map((p) => p[1]));
  const { tope, marcas } = marcasY(pico);
  ejeY(svg, { izq, der, arriba, abajo, marcas, tope });
  const px = (x) => izq + (x / maximo) * (der - izq);
  const py = (v) => abajo - (v / tope) * (abajo - arriba);
  const banda = (der - izq) / cuentas.length;
  const anchoBarra = Math.min(24, banda - 2);
  cuentas.forEach((c, i) => {
    const centro = izq + i * banda + banda / 2;
    if (c.cantidad) svg.append(s('path', { d: barra(centro - anchoBarra / 2, py(c.cantidad), anchoBarra, abajo - py(c.cantidad)), class: 'marca s1' }));
  });
  if (conCurva) {
    svg.append(s('path', { d: curva.map(([x, v], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(v).toFixed(1)}`).join(''), class: 'curva s2' }));
  }
  const pasoRotulo = der - izq < 420 ? 2000 : 1000;
  for (let km = 0; km <= maximo; km += pasoRotulo) {
    svg.append(s('text', { x: px(km), y: alto - 8, class: 'eje', 'text-anchor': km === 0 ? 'start' : km === maximo ? 'end' : 'middle' }, fmt(km)));
  }
  if (resumen && n) {
    // Marcador del promedio: línea fina en tinta con su rótulo.
    const x = px(resumen.promedio);
    svg.append(s('line', { x1: x, x2: x, y1: arriba - 8, y2: abajo, class: 'marcador-media' }));
    const derecha = x > (izq + der) / 2;
    svg.append(s('text', { x: x + (derecha ? -6 : 6), y: arriba - 12, class: 'rotulo', 'text-anchor': derecha ? 'end' : 'start' }, `Promedio ${fmt(resumen.promedio)} ${unidad}`));
  }
  cuentas.forEach((c, i) => {
    const zona = s('rect', { x: izq + i * banda, y: arriba, width: banda, height: abajo - arriba, class: 'zona' });
    const filas = [{ valor: fmt(c.cantidad), etiqueta: c.cantidad === 1 ? 'partida' : 'partidas', clave: 's1' }];
    if (n) filas.push({ valor: `${Math.round((c.cantidad / n) * 100)}%`, etiqueta: 'del total' });
    if (conCurva) {
      const esperado = n * ancho * densidadNormal(c.desde + ancho / 2, resumen.promedio, resumen.desviacion);
      filas.push({ valor: esperado.toFixed(1), etiqueta: 'según la campana', clave: 's2' });
    }
    interactivo(zona, { titulo: `${fmt(c.desde)}–${fmt(c.hasta)} ${unidad}`, filas });
    svg.append(zona);
  });
  svg.append(s('line', { x1: izq, x2: der, y1: abajo, y2: abajo, class: 'base' }));
  if (!n) svg.append(s('text', { x: (izq + der) / 2, y: (arriba + abajo) / 2, class: 'eje', 'text-anchor': 'middle' }, 'Todavía nadie terminó la partida de este día.'));
  return { cuentas, conCurva };
}

// ───────── Barra apilada horizontal (resultado de una pregunta) ─────────

/** segmentos: [{ valor, clase, nombre }] — devuelve un div con segmentos y tooltip por segmento. */
export function barraResultado(segmentos, titulo) {
  const total = segmentos.reduce((a, x) => a + x.valor, 0);
  const caja = document.createElement('div');
  caja.className = 'barra-resultado';
  if (!total) {
    caja.classList.add('vacia');
    return caja;
  }
  for (const seg of segmentos) {
    if (!seg.valor) continue;
    const parte = document.createElement('span');
    parte.className = `segmento ${seg.clase}`;
    parte.style.flexGrow = String(seg.valor);
    interactivo(parte, {
      titulo,
      filas: [{ valor: `${fmt(seg.valor)} (${Math.round((seg.valor / total) * 100)}%)`, etiqueta: seg.nombre, clave: seg.clase }],
    });
    caja.append(parte);
  }
  return caja;
}
