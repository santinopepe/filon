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
  gramatica: 'Gramática',
  informatica: 'Informática',
  astronomia: 'Astronomía',
  videojuegos: 'Videojuegos',
  idiomas: 'Idiomas',
  naturaleza: 'Naturaleza',
  gastronomia: 'Gastronomía',
  television: 'Televisión',
  arte: 'Arte',
});

/** Las siete categorías clásicas: la reserva de Normal arma el día con una pregunta de cada una. */
export const CLAVES_CATEGORIAS = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];
/** Categorías que admite Normal: las clásicas, Gramática (preguntas sobre palabras) y las del generador. */
export const CATEGORIAS_NORMAL = [...CLAVES_CATEGORIAS, 'gramatica', 'informatica', 'astronomia', 'videojuegos', 'idiomas', 'naturaleza', 'gastronomia', 'television', 'arte'];
/**
 * Normal son siete preguntas generales: variadas, pero no hace falta una por categoría. Ninguna categoría
 * puede tener más de `maxPorCategoria` y tiene que haber al menos `minCategorias` distintas.
 */
export const VARIEDAD_NORMAL = Object.freeze({ maxPorCategoria: 2, minCategorias: 4 });

export const PREGUNTAS_POR_DESAFIO = 7;

// Modos de juego. Cada uno tiene su propio desafío diario (una partida por persona, modo y día),
// su banco de reserva y su prompt. Normal mezcla categorías; los temáticos usan una sola.
export const MODOS = Object.freeze({
  normal: { clave: 'normal', nombre: 'Normal', categorias: CATEGORIAS_NORMAL },
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
  // Normal: la reserva arma el día con una pregunta de cada categoría clásica.
  const { categorias } = MODOS[modo];
  if (modo === 'normal') return [...CLAVES_CATEGORIAS];
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
