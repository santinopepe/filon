// Arma las piezas de la generación (proveedor de IA, verificador de fuentes y reserva) según la configuración.
import { crearProveedorAnthropic, crearProveedorOpenAI, crearProveedorSimulado } from './ia.js';
import { crearVerificador } from '../verificacion.js';
import { cargarReserva } from './reserva.js';
import { crearCatalogoWikidata } from './wikidata.js';

export function crearContextoGeneracion(config, { obtener = globalThis.fetch, log = console } = {}) {
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

  let proveedor = null;
  const { ia } = config;
  if (ia.proveedor === 'anthropic') {
    if (ia.claveApi) {
      proveedor = crearProveedorAnthropic({ ...ia, obtener });
    } else {
      log.warn('[ia] IA_PROVEEDOR=anthropic pero falta ANTHROPIC_API_KEY: se usará solo la reserva.');
    }
  } else if (ia.proveedor === 'openai') {
    if (ia.claveApi) {
      proveedor = crearProveedorOpenAI({ ...ia, obtener });
    } else {
      log.warn('[ia] IA_PROVEEDOR=openai pero falta OPENAI_API_KEY: se usará solo la reserva.');
    }
  } else if (ia.proveedor === 'simulado') {
    proveedor = crearProveedorSimulado({ banco: reserva.preguntas.map((p) => ({ ...p, rechazos: p.rechazos })) });
  }

  const verificador = crearVerificador({
    dominios: config.fuentes.dominios,
    tiempoLimiteMs: config.fuentes.tiempoLimiteMs,
    maxBytes: config.fuentes.maxBytes,
    maxRedirecciones: config.fuentes.maxRedirecciones,
    userAgent: config.fuentes.userAgent,
    modo: config.fuentes.modo,
    obtener,
  });

  const catalogo = crearCatalogoWikidata({
    obtener,
    userAgent: config.fuentes.userAgent,
    tiempoLimiteMs: config.wikidata.tiempoLimiteMs,
  });

  return { proveedor, verificador, reserva, reservas, catalogo };
}
