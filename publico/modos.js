// Filón — modos de juego en la interfaz: escena, etapas, unidades y textos de cada uno.
// La mecánica es la misma en los tres (siete preguntas, rarezas, 0 a 7.000 «metros» de avance);
// cambia la ambientación: la mina (Normal), la alfombra roja (Farándula) y la vuelta al mundo (Geografía).
import { crearEscena, ESTRATOS, estratoDe } from './escena.js';
import { crearEscenaViaje } from './escena-viaje.js';
import { crearMundoFarandula, ETAPAS_FARANDULA } from './escena-farandula.js';
import { crearMundoGeografia, ETAPAS_GEOGRAFIA } from './escena-geografia.js';

const etapaEn = (etapas) => (m) => (m <= 0 ? etapas[0] : etapas.find((e) => m < e.hasta) ?? etapas.at(-1));

export const MODOS = {
  normal: {
    clave: 'normal',
    nombre: 'Normal',
    titulo: 'Filón · siete vetas por día',
    etapas: ESTRATOS,
    etapaDe: estratoDe,
    crearEscena: (canvas, opciones) => crearEscena(canvas, opciones),
    unidad: { factor: 1, sufijo: 'm', palabra: 'metros' },
    sonidoGolpe: 'pico',
    textos: {
      bajada: 'Siete preguntas por día. Las respuestas que nadie dice te llevan más hondo.',
      reglaAvance: 'Cuanto más rara la respuesta, más puntos. Cada punto es un descenso de 10 metros; el fondo está a 7.000.',
      ayudaAvance: 'Cada punto es un descenso de 10 metros.',
      comenzar: 'Comenzar excavación',
      seguir: 'Seguir excavando',
      siguiente: 'Seguir bajando',
      preparando: 'La expedición de hoy se está preparando. Probá de nuevo en unos minutos.',
      progreso: (hechas, d) => `Llevás ${hechas} de 7 rondas y estás a ${d}.`,
      pendiente: (n, fecha, hora) => `Te quedó una excavación sin terminar del desafío #${n} (${fecha}). Podés terminarla hasta las ${hora}.`,
      retomar: 'Terminar esa excavación',
      yaJugaste: 'Ya excavaste hoy',
      avance: (d) => `${d} más abajo`,
      quieto: 'te quedaste en el mismo nivel',
      anuncioAvance: (d) => `bajás ${d}`,
      finalCero: 'Te quedaste en la superficie. Mañana hay otra bajada.',
      finalMaximo: '¡Llegaste al corazón de la Tierra! 7.000 de 7.000 metros.',
      finalLlegaste: (etapa, d) => `Llegaste hasta ${etapa.nombre}: ${d} de 7.000 metros posibles.`,
      despedida: (m) => (m >= 5000 ? '¡Qué bajada! Pocos llegan tan hondo.' : m >= 2500 ? 'Gran túnel. Mañana, más hondo.' : '¡Mañana seguimos cavando!'),
      recorridoTitulo: 'Recorré tu excavación',
      recorridoTexto: 'Seguí bajando para explorar desde la superficie hasta donde llegaste.',
      compartir: (n, fecha, d) => `Filón #${n} · ${fecha}\nBajé ${d} de 7.000 ⛏️`,
    },
    frases: {
      inicio: ['¡Buenas! Soy Lito. Hoy vamos a atravesar siete capas.', 'La tierra está húmeda. ¿Bajamos?'],
      ronda: ['Pensá en lo que nadie diría.', 'Las obvias valen poco. ¡Arriesgá!', 'Bajo tierra, lo raro brilla más.', 'Ojo con la mecha.'],
      rechazo: ['Esa no abrió camino. ¡Otra!', 'Tierra dura. Probá otra respuesta.'],
      grava: ['Grava. Algo es algo.', 'Grava… hay más abajo, ¿eh?'],
      cobre: ['¡Cobre! Vamos bien.', 'Cobre del bueno.'],
      plata: ['¡Plata! Eso ya brilla.', 'Plata. Se nota que sabés.'],
      oro: ['¡Oro! Pocos llegan ahí.', '¡Una pepita de oro!'],
      diamante: ['¡Un diamante! ¿Viste cómo brilla?', '¡Diamante! Eso no lo dice nadie.'],
      vencida: ['Se apagó la mecha. A la próxima.', 'Uy, se nos fue el tiempo.'],
      pasada: ['Hay vetas que conviene dejar.'],
    },
  },
  farandula: {
    clave: 'farandula',
    nombre: 'Farándula Argentina',
    titulo: 'Filón · Farándula Argentina',
    etapas: ETAPAS_FARANDULA,
    etapaDe: etapaEn(ETAPAS_FARANDULA),
    crearEscena: (canvas, opciones) => crearEscenaViaje(canvas, { ...opciones, mundo: crearMundoFarandula() }),
    unidad: { factor: 1, sufijo: 'm', palabra: 'metros' },
    sonidoGolpe: 'flash',
    textos: {
      bajada: 'Siete preguntas de la farándula argentina. Las respuestas que nadie dice te llevan más lejos por la alfombra roja.',
      reglaAvance: 'Cuanto más rara la respuesta, más puntos. Cada punto son 10 metros de alfombra roja; la entrada de la gala está a 7.000.',
      ayudaAvance: 'Cada punto son 10 metros de alfombra roja.',
      comenzar: 'Bajar de la limusina',
      seguir: 'Seguir desfilando',
      siguiente: 'Seguir caminando',
      preparando: 'La alfombra roja de hoy se está preparando. Probá de nuevo en unos minutos.',
      progreso: (hechas, d) => `Llevás ${hechas} de 7 rondas y caminaste ${d} de alfombra.`,
      pendiente: (n, fecha, hora) => `Te quedó un desfile sin terminar del desafío #${n} (${fecha}). Podés terminarlo hasta las ${hora}.`,
      retomar: 'Terminar ese desfile',
      yaJugaste: 'Ya desfilaste hoy',
      avance: (d) => `${d} más de alfombra`,
      quieto: 'te quedaste en el mismo lugar',
      anuncioAvance: (d) => `caminás ${d} más`,
      finalCero: 'Te quedaste junto a la limusina. Mañana hay otra alfombra.',
      finalMaximo: '¡Llegaste a la entrada de la gala! 7.000 de 7.000 metros de alfombra.',
      finalLlegaste: (etapa, d) => `Llegaste hasta ${etapa.nombre}: ${d} de 7.000 metros de alfombra.`,
      despedida: (m) => (m >= 5000 ? '¡Qué desfile! Las revistas no hablan de otra cosa.' : m >= 2500 ? 'Cuántos flashes. Mañana, más lejos.' : '¡Mañana volvemos a la alfombra!'),
      recorridoTitulo: 'Recorré tu alfombra roja',
      recorridoTexto: 'Seguí bajando para revivir el desfile desde la limusina hasta donde llegaste.',
      compartir: (n, fecha, d) => `Filón Farándula #${n} · ${fecha}\nCaminé ${d} de alfombra roja de 7.000 🌟`,
    },
    frases: {
      inicio: ['¡Llegamos! Bajo de la limusina y empieza la alfombra roja.', 'Sonrisa para las cámaras. ¿Vamos?'],
      ronda: ['Lo obvio no sale en las revistas.', 'Los flashes buscan respuestas raras.', '¡Arriesgá, que esto es un estreno!', 'Ojo con la mecha.'],
      rechazo: ['Esa no está en la lista de invitados. ¡Otra!', 'Ni un flash. Probá otra respuesta.'],
      grava: ['Grava. Un par de flashes.', 'Grava… la alfombra sigue, ¿eh?'],
      cobre: ['¡Cobre! Ya me piden fotos.', 'Cobre. Vamos bien.'],
      plata: ['¡Plata! Mirá cómo se juntan los fans.', 'Plata. Eso es de revista.'],
      oro: ['¡Oro! Los paparazzi enloquecen.', '¡Oro! Esto sale en tapa.'],
      diamante: ['¡Un diamante! ¡Estrella absoluta!', '¡Diamante! Eso no lo sabe nadie.'],
      vencida: ['Se apagó la mecha. Me quedé posando.', 'Uy, se nos fue el tiempo.'],
      pasada: ['Hay preguntas que conviene esquivar, como a la prensa.'],
    },
  },
  geografia: {
    clave: 'geografia',
    nombre: 'Geografía',
    titulo: 'Filón · Geografía',
    etapas: ETAPAS_GEOGRAFIA,
    etapaDe: etapaEn(ETAPAS_GEOGRAFIA),
    crearEscena: (canvas, opciones) => crearEscenaViaje(canvas, { ...opciones, mundo: crearMundoGeografia() }),
    // Cada punto son 60 km: el máximo (700 puntos) es una vuelta al mundo de 42.000 km.
    unidad: { factor: 6, sufijo: 'km', palabra: 'kilómetros' },
    sonidoGolpe: 'helice',
    textos: {
      bajada: 'Siete preguntas de geografía. Las respuestas que nadie dice te llevan más lejos en tu vuelta al mundo.',
      reglaAvance: 'Cuanto más rara la respuesta, más puntos. Cada punto son 60 kilómetros de vuelo; la vuelta al mundo son 42.000.',
      ayudaAvance: 'Cada punto son 60 kilómetros de vuelo.',
      comenzar: 'Despegar',
      seguir: 'Seguir volando',
      siguiente: 'Seguir volando',
      preparando: 'El vuelo de hoy se está preparando. Probá de nuevo en unos minutos.',
      progreso: (hechas, d) => `Llevás ${hechas} de 7 rondas y volaste ${d}.`,
      pendiente: (n, fecha, hora) => `Te quedó un vuelo sin terminar del desafío #${n} (${fecha}). Podés terminarlo hasta las ${hora}.`,
      retomar: 'Terminar ese vuelo',
      yaJugaste: 'Ya volaste hoy',
      avance: (d) => `${d} más de vuelo`,
      quieto: 'el avión no avanzó',
      anuncioAvance: (d) => `volás ${d} más`,
      finalCero: 'El avión no despegó. Mañana hay otro vuelo.',
      finalMaximo: '¡Diste la vuelta al mundo! 42.000 de 42.000 kilómetros.',
      finalLlegaste: (etapa, d) => `Llegaste hasta ${etapa.nombre}: ${d} de 42.000 kilómetros posibles.`,
      despedida: (m) => (m >= 5000 ? '¡Qué viaje! Casi damos la vuelta al mundo.' : m >= 2500 ? 'Buen vuelo. Mañana, más lejos.' : '¡Mañana despegamos otra vez!'),
      recorridoTitulo: 'Recorré tu vuelo',
      recorridoTexto: 'Seguí bajando para repasar el viaje desde Buenos Aires hasta donde llegaste.',
      compartir: (n, fecha, d) => `Filón Geografía #${n} · ${fecha}\nVolé ${d} de 42.000 ✈️`,
    },
    frases: {
      inicio: ['¡Buenas! Hoy piloteo yo. Abróchense los cinturones.', 'Pista libre. ¿Despegamos?'],
      ronda: ['Pensá en el rincón más lejano del mapa.', 'Las obvias no nos sacan del país. ¡Arriesgá!', 'Desde acá arriba, lo raro se ve mejor.', 'Ojo con la mecha.'],
      rechazo: ['Ese destino no figura en el mapa. ¡Otra!', 'Turbulencia. Probá otra respuesta.'],
      grava: ['Grava. Un vuelo de cabotaje.', 'Grava… el mundo es grande, ¿eh?'],
      cobre: ['¡Cobre! Ganamos altura.', 'Cobre. Buen rumbo.'],
      plata: ['¡Plata! Cruzamos otra frontera.', 'Plata. Se nota que viajaste.'],
      oro: ['¡Oro! Pocos llegan tan lejos.', '¡Oro! Eso no está en las guías.'],
      diamante: ['¡Un diamante! ¡Qué destino!', '¡Diamante! Eso no lo sabe nadie.'],
      vencida: ['Se apagó la mecha. Seguimos en la sala de espera.', 'Uy, se nos fue el tiempo.'],
      pasada: ['Hay destinos que conviene dejar para otro viaje.'],
    },
  },
};

export const CLAVES_MODOS = Object.keys(MODOS);
export const esModo = (m) => Object.hasOwn(MODOS, m);

/** Distancia para mostrar: «2.350 m» o, en Geografía, «14.100 km». */
export function crearFormato(modo, fmt) {
  const { factor, sufijo } = MODOS[modo].unidad;
  return {
    valor: (metros) => fmt(metros * factor),
    dist: (metros) => `${fmt(metros * factor)} ${sufijo}`,
    total: `${fmt(7000 * factor)} ${sufijo}`,
  };
}
