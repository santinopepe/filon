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
});

export const CLAVES_CATEGORIAS = Object.keys(CATEGORIAS);

export const PREGUNTAS_POR_DESAFIO = 7;
export const METROS_POR_PUNTO = 10;
export const PUNTOS_MAXIMOS = PREGUNTAS_POR_DESAFIO * RAREZAS.diamante.puntos; // 700
export const PROFUNDIDAD_MAXIMA = PUNTOS_MAXIMOS * METROS_POR_PUNTO; // 7000 m

export function puntosDeRareza(rareza) {
  const r = RAREZAS[rareza];
  if (!r) throw new Error(`Rareza desconocida: ${rareza}`);
  return r.puntos;
}
