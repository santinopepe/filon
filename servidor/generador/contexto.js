// Arma las piezas de la generación (proveedor de IA, verificador de fuentes y reserva) según la configuración.
import { crearProveedorAnthropic, crearProveedorSimulado } from './ia.js';
import { crearVerificador } from '../verificacion.js';
import { cargarReserva } from './reserva.js';
import { crearCatalogoWikidata } from './wikidata.js';

export function crearContextoGeneracion(config, { obtener = globalThis.fetch, log = console } = {}) {
  const reserva = cargarReserva(config.rutaReserva, { dominios: config.fuentes.dominios });
  if (reserva.invalidas.length) {
    log.warn(`[reserva] ${reserva.invalidas.length} pregunta(s) de reserva no pasan la validación y no se usarán: ${reserva.invalidas.map((i) => i.id).join(', ')}`);
  }

  let proveedor = null;
  const { ia } = config;
  if (ia.proveedor === 'anthropic') {
    if (ia.claveApi) {
      proveedor = crearProveedorAnthropic({ ...ia, obtener });
    } else {
      log.warn('[ia] IA_PROVEEDOR=anthropic pero falta ANTHROPIC_API_KEY: se usará solo la reserva.');
    }
  } else if (ia.proveedor === 'simulado') {
    proveedor = crearProveedorSimulado({ banco: reserva.preguntas.map((p) => ({ ...p, rechazos: p.rechazos })) });
  }

  const verificador = crearVerificador({
    dominios: config.fuentes.dominios,
    tiempoLimiteMs: config.fuentes.tiempoLimiteMs,
    userAgent: config.fuentes.userAgent,
    modo: config.fuentes.modo,
    obtener,
  });

  const catalogo = crearCatalogoWikidata({
    obtener,
    userAgent: config.fuentes.userAgent,
    tiempoLimiteMs: config.wikidata.tiempoLimiteMs,
  });

  return { proveedor, verificador, reserva, catalogo };
}
