// Reglas fijas del juego: rarezas, categorías y conversiones.

export const RAREZAS = Object.freeze({
  grava: { clave: 'grava', nombre: 'Grava', puntos: 10, descripcion: 'Respuesta muy conocida' },
  cobre: { clave: 'cobre', nombre: 'Cobre', puntos: 30, descripcion: 'Respuesta común' },
  plata: { clave: 'plata', nombre: 'Plata', puntos: 60, descripcion: 'Respuesta menos evidente' },
  oro: { clave: 'oro', nombre: 'Oro', puntos: 85, descripcion: 'Respuesta poco conocida' },
  diamante: { clave: 'diamante', nombre: 'Diamante', puntos: 100, descripcion: 'Respuesta excepcional' },
});

export const ORDEN_RAREZAS = ['grava', 'cobre', 'plata', 'oro', 'diamante'];

export const CATEGORIAS = Object.freeze({
  geografia: 'Geografía',
  historia: 'Historia',
  ciencia: 'Ciencia',
  deportes: 'Deportes',
  cine: 'Cine',
  musica: 'Música',
  literatura: 'Literatura',
  farandula: 'Farándula',
});

/** Las siete categorías del modo Normal (una pregunta de cada una por día). */
export const CLAVES_CATEGORIAS = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];

export const PREGUNTAS_POR_DESAFIO = 7;

// Modos de juego. Cada uno tiene su propio desafío diario (una partida por persona, modo y día),
// su banco de reserva y su prompt. Normal mezcla las siete categorías; los temáticos usan una sola.
export const MODOS = Object.freeze({
  normal: { clave: 'normal', nombre: 'Normal', categorias: CLAVES_CATEGORIAS },
  farandula: { clave: 'farandula', nombre: 'Farándula Argentina', categorias: ['farandula'] },
  geografia: { clave: 'geografia', nombre: 'Geografía', categorias: ['geografia'] },
});
export const CLAVES_MODOS = Object.keys(MODOS);
export const MODO_POR_DEFECTO = 'normal';
export const esModo = (modo) => Object.hasOwn(MODOS, modo);

/**
 * Las siete «ranuras» de un día: en Normal, una por categoría; en los temáticos, siete de la misma
 * categoría («farandula#1» … «farandula#7»). La parte antes de «#» es la categoría.
 */
export function ranurasDeModo(modo) {
  const { categorias } = MODOS[modo];
  if (categorias.length === PREGUNTAS_POR_DESAFIO) return [...categorias];
  return Array.from({ length: PREGUNTAS_POR_DESAFIO }, (_, i) => `${categorias[0]}#${i + 1}`);
}
export const categoriaDeRanura = (ranura) => ranura.split('#')[0];
export const METROS_POR_PUNTO = 10;
export const PUNTOS_MAXIMOS = PREGUNTAS_POR_DESAFIO * RAREZAS.diamante.puntos; // 700
export const PROFUNDIDAD_MAXIMA = PUNTOS_MAXIMOS * METROS_POR_PUNTO; // 7000 m

export function puntosDeRareza(rareza) {
  const r = RAREZAS[rareza];
  if (!r) throw new Error(`Rareza desconocida: ${rareza}`);
  return r.puntos;
}

// Límites explícitos de tamaño (protegen memoria, base y DOM).
export const LIMITES = Object.freeze({
  cuerpoJson: 4096, // bytes de una solicitud normal del juego
  cuerpoImportacion: 512_000, // bytes del JSON de carga manual (siete preguntas)
  respuestasPorPregunta: 1500, // tope absoluto (preguntas de Wikidata); las editoriales, 80
  paginaRevelado: 100, // respuestas válidas por página al revelarlas
  paginaReportes: 500,
  respuestasEnDetalleAdmin: 200, // por pregunta, en el detalle de un desafío del panel
  paginaCorridas: 50,
});
