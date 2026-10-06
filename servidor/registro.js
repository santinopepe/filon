// Logs estructurados (una línea JSON por evento) para Vercel/consola.
// Nunca se registran credenciales, cookies, tokens ni IPs en claro: los campos con nombres sensibles
// se reemplazan por «[oculto]» antes de escribir.
const SENSIBLE = /token|secret|secreto|clave|password|contrasena|cookie|authorization|autorizacion|^ip$|prompt|cuerpo/i;
const MAX_TEXTO = 500;

function limpiar(valor, profundidad = 0) {
  if (valor == null || typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') return valor.length > MAX_TEXTO ? `${valor.slice(0, MAX_TEXTO)}…` : valor;
  if (valor instanceof Error) return { nombre: valor.name, mensaje: limpiar(valor.message), codigo: valor.code };
  if (profundidad > 3) return '[…]';
  if (Array.isArray(valor)) return valor.slice(0, 20).map((v) => limpiar(v, profundidad + 1));
  if (typeof valor === 'object') {
    const salida = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = SENSIBLE.test(k) ? '[oculto]' : limpiar(v, profundidad + 1);
    return salida;
  }
  return String(valor);
}

/**
 * Crea un registrador. `destino` es compatible con console ({ info, warn, error }).
 * registro.info('cron', { ruta: 'hoy', resultado: 'publicado' })
 */
export function crearRegistro(destino = console) {
  const escribir = (nivel, evento, datos = {}) => {
    const linea = JSON.stringify({ t: new Date().toISOString(), nivel, evento, ...limpiar(datos) });
    (destino[nivel] || destino.info || console.log).call(destino, linea);
  };
  return {
    info: (evento, datos) => escribir('info', evento, datos),
    warn: (evento, datos) => escribir('warn', evento, datos),
    error: (evento, datos) => escribir('error', evento, datos),
  };
}

export const _interno = { limpiar };
