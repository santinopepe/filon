// Utilidades HTTP mínimas: archivos estáticos, JSON, cookies firmadas y límite de solicitudes.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export const CABECERAS_SEGURIDAD = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

export function enviarJson(res, estado, cuerpo, extra = {}) {
  const datos = JSON.stringify(cuerpo);
  res.writeHead(estado, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...CABECERAS_SEGURIDAD,
    ...extra,
  });
  res.end(datos);
}

export async function leerJson(req, limite = 4096) {
  const tipo = req.headers['content-type'] || '';
  if (!tipo.includes('application/json')) {
    const e = new Error('Se esperaba JSON.');
    e.estado = 415;
    throw e;
  }
  // Los helpers de Node de Vercel pueden haber leído el cuerpo ya (req.body).
  let cuerpo;
  try {
    cuerpo = req.body;
  } catch {
    const e = new Error('JSON inválido.');
    e.estado = 400;
    throw e;
  }
  if (cuerpo !== undefined) {
    if (Buffer.isBuffer(cuerpo)) cuerpo = cuerpo.toString('utf8');
    if (typeof cuerpo === 'string') {
      if (Buffer.byteLength(cuerpo) > limite) {
        const e = new Error('Solicitud demasiado grande.');
        e.estado = 413;
        throw e;
      }
      if (!cuerpo) return {};
      try {
        return JSON.parse(cuerpo);
      } catch {
        const e = new Error('JSON inválido.');
        e.estado = 400;
        throw e;
      }
    }
    if (cuerpo && JSON.stringify(cuerpo).length > limite) {
      const e = new Error('Solicitud demasiado grande.');
      e.estado = 413;
      throw e;
    }
    return cuerpo ?? {};
  }
  let total = 0;
  const partes = [];
  for await (const trozo of req) {
    total += trozo.length;
    if (total > limite) {
      const e = new Error('Solicitud demasiado grande.');
      e.estado = 413;
      throw e;
    }
    partes.push(trozo);
  }
  if (!total) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    const e = new Error('JSON inválido.');
    e.estado = 400;
    throw e;
  }
}

export function leerCookies(req) {
  const salida = {};
  for (const par of String(req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i <= 0) continue;
    const valor = par.slice(i + 1).trim();
    try {
      salida[par.slice(0, i).trim()] = decodeURIComponent(valor);
    } catch {
      // Percent-encoding inválido («%E0%A4%A»): se ignora esa cookie en vez de responder 500.
    }
  }
  return salida;
}

/**
 * IP del cliente sin confiar en encabezados que cualquiera puede inventar.
 *  - En Vercel: x-real-ip (Vercel lo sobrescribe con la IP que ve; un cliente no puede fijarlo).
 *  - Detrás de un proxy propio (CONFIAR_PROXY=1): la entrada de X-Forwarded-For que agregó ese proxy,
 *    es decir, la última (las anteriores las puede haber escrito el cliente).
 *  - Sin proxy: la dirección del socket.
 */
export function ipCliente(req, { enVercel = false, confiarProxy = false } = {}) {
  const h = req.headers;
  if (enVercel) {
    const real = String(h['x-real-ip'] || '').trim();
    if (real) return real;
  }
  if (enVercel || confiarProxy) {
    const xff = String(h['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (xff.length) return enVercel ? xff[0] : xff.at(-1);
  }
  return req.socket?.remoteAddress || 'desconocida';
}

export function crearFirmador(secreto) {
  const firmar = (valor) => createHmac('sha256', secreto).update(valor).digest('base64url').slice(0, 22);
  return {
    firmar: (valor) => `${valor}.${firmar(valor)}`,
    verificar(cadena) {
      if (typeof cadena !== 'string') return null;
      const i = cadena.lastIndexOf('.');
      if (i <= 0) return null;
      const valor = cadena.slice(0, i);
      const a = Buffer.from(cadena.slice(i + 1));
      const b = Buffer.from(firmar(valor));
      return a.length === b.length && timingSafeEqual(a, b) ? valor : null;
    },
  };
}

/** Limitador por IP con balde de fichas. */
export function crearLimitador({ capacidad = 40, porSegundo = 8 } = {}) {
  const baldes = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, b] of baldes) if (t - b.t > 120_000) baldes.delete(k);
  }, 60_000).unref();
  return function permitir(clave) {
    const t = Date.now();
    const b = baldes.get(clave) || { fichas: capacidad, t };
    b.fichas = Math.min(capacidad, b.fichas + ((t - b.t) / 1000) * porSegundo);
    b.t = t;
    baldes.set(clave, b);
    if (b.fichas < 1) return false;
    b.fichas -= 1;
    return true;
  };
}

/** Servidor de archivos estáticos con ETag y gzip en memoria. */
export function crearEstaticos(dir) {
  const cache = new Map();
  const raiz = normalize(dir + sep);

  return function servir(req, res, ruta) {
    let relativa = decodeURIComponent(ruta.split('?')[0]);
    if (relativa === '/' || relativa === '') relativa = '/index.html';
    const completa = normalize(join(dir, relativa));
    if (!completa.startsWith(raiz)) return false;
    let info;
    try {
      info = statSync(completa);
      if (!info.isFile()) return false;
    } catch {
      return false;
    }
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const ext = extname(completa).toLowerCase();
    const cabeceras = {
      'content-type': TIPOS[ext] || 'application/octet-stream',
      etag,
      'cache-control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...CABECERAS_SEGURIDAD,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cabeceras);
      res.end();
      return true;
    }
    let entrada = cache.get(completa);
    if (!entrada || entrada.etag !== etag) {
      const datos = readFileSync(completa);
      const comprimible = /text|json|svg|javascript/.test(cabeceras['content-type']);
      entrada = { etag, datos, gz: comprimible ? gzipSync(datos) : null };
      cache.set(completa, entrada);
    }
    const aceptaGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (entrada.gz && aceptaGzip) {
      res.writeHead(200, { ...cabeceras, 'content-encoding': 'gzip', vary: 'accept-encoding' });
      res.end(req.method === 'HEAD' ? undefined : entrada.gz);
    } else {
      res.writeHead(200, cabeceras);
      res.end(req.method === 'HEAD' ? undefined : entrada.datos);
    }
    return true;
  };
}
