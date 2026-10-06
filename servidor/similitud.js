// Similitud entre preguntas nuevas (JSON importado) y las de los últimos días.
// Dos señales: el enunciado (raíces de palabras en común) y las respuestas (cuántas comparten).
//   «repetida»: se bloquea la importación.  «parecida»: se avisa y se deja pasar.
import { normalizar, sinArticulo } from './normalizar.js';

const VACIAS = new Set(
  'nombra nombre nombres menciona escribi deci un una uno unos unas de del la el los las lo que en y a al por con para alguien haya hayan sido sea fue algun alguna cualquier se su sus o como mas sobre entre cuyo cuya cuyos cuyas letra letras palabra palabras'.split(' '),
);

/** Raíz rústica en español: sin plural y recortada (termina/termine → termi; países/país → pais). */
function raiz(palabra) {
  let p = palabra;
  if (p.length > 5 && p.endsWith('es')) p = p.slice(0, -2); // países → pais, capitales → capital
  else if (p.length > 4 && p.endsWith('s')) p = p.slice(0, -1); // letras → letra; país queda igual
  return p.slice(0, 5);
}

export function raicesDe(texto) {
  return new Set(
    normalizar(texto || '')
      .split(' ')
      .filter((t) => t.length > 2 && !VACIAS.has(t))
      .map(raiz),
  );
}

const clave = (texto) => sinArticulo(normalizar(texto || ''));

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export const UMBRALES = Object.freeze({
  // «combinado»: enunciado parecido Y conjunto en buena parte igual (no alcanza con 2 respuestas en común:
  // campeonas del Mundial masculino y femenino comparten Alemania y España pero son conjuntos distintos).
  repetida: { enunciado: 0.6, solapamiento: 0.6, minimoCompartidas: 4, combinado: { enunciado: 0.45, solapamiento: 0.5, minimoCompartidas: 3 } },
  parecida: { enunciado: 0.35, compartidas: 3, solapamiento: 0.3 },
});

/** Compara dos preguntas ya preparadas ({ raices, claves, mapa }). */
export function comparar(a, b) {
  const similitudEnunciado = jaccard(a.raices, b.raices);
  const compartidas = [...a.claves].filter((k) => b.claves.has(k));
  const menor = Math.min(a.claves.size, b.claves.size);
  const solapamiento = menor ? compartidas.length / menor : 0;
  const r = UMBRALES.repetida;
  const p = UMBRALES.parecida;
  let nivel = null;
  if (
    similitudEnunciado >= r.enunciado ||
    (solapamiento >= r.solapamiento && compartidas.length >= r.minimoCompartidas) ||
    (similitudEnunciado >= r.combinado.enunciado && solapamiento >= r.combinado.solapamiento && compartidas.length >= r.combinado.minimoCompartidas)
  ) {
    nivel = 'repetida';
  } else if (similitudEnunciado >= p.enunciado || compartidas.length >= p.compartidas || solapamiento >= p.solapamiento) {
    nivel = 'parecida';
  }
  return { nivel, similitudEnunciado, solapamiento, compartidas: compartidas.map((k) => a.mapa.get(k)) };
}

function preparar(p) {
  const respuestas = Array.isArray(p?.respuestas) ? p.respuestas : [];
  const nombres = respuestas.map((r) => (typeof r === 'string' ? r : r?.canonica)).filter((x) => typeof x === 'string' && x.trim());
  const mapa = new Map(nombres.map((n) => [clave(n), n]));
  return { raices: raicesDe(p?.enunciado), claves: new Set(mapa.keys()), mapa };
}

const describir = (c) =>
  [
    `enunciado ${Math.round(c.similitudEnunciado * 100)} % parecido`,
    c.compartidas.length ? `${c.compartidas.length} respuesta${c.compartidas.length === 1 ? '' : 's'} en común (${c.compartidas.slice(0, 5).join(', ')}${c.compartidas.length > 5 ? '…' : ''})` : null,
  ]
    .filter(Boolean)
    .join(', ');

/**
 * nuevas: preguntas del JSON (crudas). historial: [{ fecha, categoria, enunciado, respuestas: [canónicas] }].
 * Compara cada nueva con el historial y con las demás del mismo lote.
 * Devuelve [{ posicion, enunciado, coincidencias: [{ origen, fecha, categoria, enunciado, nivel, similitudEnunciado, solapamiento, compartidas, motivo }] }].
 */
export function analizarSimilitud(nuevas, historial, { maximo = 3 } = {}) {
  const previas = historial.map((h) => ({ ...h, origen: 'historial', prep: preparar(h) }));
  const propias = nuevas.map((p, i) => ({ posicion: i + 1, categoria: p?.categoria, enunciado: String(p?.enunciado || ''), prep: preparar(p) }));
  return propias.map((n) => {
    const candidatas = [
      ...previas,
      ...propias.filter((o) => o.posicion !== n.posicion).map((o) => ({ ...o, origen: 'lote', fecha: null })),
    ];
    const coincidencias = candidatas
      .map((o) => ({ o, c: comparar(n.prep, o.prep) }))
      .filter(({ c }) => c.nivel)
      .sort((x, y) => (x.c.nivel === y.c.nivel ? y.c.similitudEnunciado + y.c.solapamiento - (x.c.similitudEnunciado + x.c.solapamiento) : x.c.nivel === 'repetida' ? -1 : 1))
      .slice(0, maximo)
      .map(({ o, c }) => ({
        origen: o.origen,
        fecha: o.fecha,
        posicion: o.origen === 'lote' ? o.posicion : undefined,
        categoria: o.categoria,
        enunciado: o.enunciado,
        nivel: c.nivel,
        similitudEnunciado: Math.round(c.similitudEnunciado * 100),
        solapamiento: Math.round(c.solapamiento * 100),
        compartidas: c.compartidas,
        motivo: describir(c),
      }));
    return { posicion: n.posicion, enunciado: n.enunciado, coincidencias };
  });
}
