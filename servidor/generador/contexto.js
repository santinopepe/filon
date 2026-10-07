// Carga los bancos de reserva de archivo de cada modo (datos/reserva*.json), validados en modo estricto.
import { cargarReserva } from './reserva.js';

export function crearContextoGeneracion(config, { log = console } = {}) {
  const cargar = (ruta, modo) => {
    const r = cargarReserva(ruta, { dominios: config.fuentes.dominios, modo });
    if (r.invalidas.length) {
      log.warn(`[reserva] ${modo}: ${r.invalidas.length} pregunta(s) de reserva no pasan la validación y no se usarán: ${r.invalidas.map((i) => i.id).join(', ')}`);
    }
    return r;
  };
  const reserva = cargar(config.rutaReserva, 'normal');
  // Una reserva por modo: cada modo publica solo preguntas de su categoría.
  const reservas = { normal: reserva, ...Object.fromEntries(Object.entries(config.rutasReserva).map(([modo, ruta]) => [modo, cargar(ruta, modo)])) };
  return { reserva, reservas };
}
