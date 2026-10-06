// Verificación factual contra fuentes externas (no contra otra IA).
// Cada respuesta debe aparecer —por su nombre canónico o una variante— en el texto de alguna de las
// fuentes que delimitan el alcance de la pregunta (por ejemplo, el artículo que enumera el conjunto).
// Las respuestas que no se encuentran se descartan. Si ninguna fuente se puede leer, la pregunta no
// se considera verificada.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizar } from './normalizar.js';
import { dominioPermitido } from './validacion.js';

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlATexto(html) {
  return String(html)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const cod = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cod) ? String.fromCodePoint(cod) : ' ';
      }
      return ENTIDADES[e.toLowerCase()] ?? ' ';
    });
}

const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);

/** ¿Es una dirección privada, de loopback, link-local (metadata 169.254.169.254) o reservada? */
export function ipPrivada(ip) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = v.startsWith('::ffff:') ? v.slice(7) : v;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || // «esta» red, privada, loopback, multicast y reservadas
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / metadata de nubes
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(v) === 6) return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
  return true; // lo que no es una IP válida no se acepta
}

const resolverDns = async (host) => lookup(host, { all: true, verbatim: true });

/**
 * obtener: fetch (inyectable en pruebas). resolver(host) → [{ address }]: por defecto el DNS real; si se
 * inyecta un `obtener` de prueba y no un resolver, se omite la resolución (no hay red de verdad).
 */
export function crearVerificador({
  dominios,
  tiempoLimiteMs = 15_000,
  userAgent,
  obtener = globalThis.fetch,
  resolver = obtener === globalThis.fetch ? resolverDns : null,
  maxBytes = 3_000_000,
  maxRedirecciones = 3,
  modo = 'estricta',
}) {
  const cache = new Map();

  /** Valida un destino antes de cada solicitud (también después de cada redirección). */
  async function validarDestino(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error(`URL inválida: ${url}`);
    }
    if (u.protocol !== 'https:') throw new Error(`solo se permite HTTPS: ${u.protocol}`);
    if (u.port && u.port !== '443') throw new Error(`puerto no permitido: ${u.port}`);
    if (u.username || u.password) throw new Error('la URL no puede llevar credenciales');
    if (isIP(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error(`no se aceptan IPs literales: ${u.hostname}`);
    if (!dominioPermitido(u.href, dominios)) throw new Error(`dominio no permitido: ${u.hostname}`);
    if (resolver) {
      const direcciones = await resolver(u.hostname);
      if (!direcciones?.length) throw new Error(`no resuelve: ${u.hostname}`);
      if (direcciones.some((d) => ipPrivada(d.address))) throw new Error(`resuelve a una red privada: ${u.hostname}`);
    }
    return u.href;
  }

  /** Lee el cuerpo de a pedazos y corta apenas supera el máximo (no lo descarga entero). */
  async function leerConLimite(res, controlador) {
    const declarado = Number(res.headers.get('content-length'));
    if (declarado > maxBytes) {
      controlador.abort();
      throw new Error(`respuesta demasiado grande (${declarado} bytes)`);
    }
    if (!res.body?.getReader) {
      const texto = await res.text();
      if (Buffer.byteLength(texto) > maxBytes) throw new Error('respuesta demasiado grande');
      return texto;
    }
    const lector = res.body.getReader();
    const partes = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await lector.cancel().catch(() => {});
        controlador.abort();
        throw new Error(`respuesta demasiado grande (más de ${maxBytes} bytes)`);
      }
      partes.push(value);
    }
    return Buffer.concat(partes.map((p) => Buffer.from(p))).toString('utf8');
  }

  async function descargar(url, senalExterna) {
    const controlador = new AbortController();
    const senal = AbortSignal.any([controlador.signal, AbortSignal.timeout(tiempoLimiteMs), ...(senalExterna ? [senalExterna] : [])]);
    let actual = await validarDestino(url);
    for (let salto = 0; ; salto++) {
      const res = await obtener(actual, {
        headers: { 'user-agent': userAgent, accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
        redirect: 'manual', // cada salto se vuelve a validar acá
        signal: senal,
      });
      if (REDIRECCIONES.has(res.status)) {
        await res.body?.cancel?.().catch(() => {});
        if (salto >= maxRedirecciones) throw new Error(`demasiadas redirecciones desde ${url}`);
        const destino = res.headers.get('location');
        if (!destino) throw new Error(`redirección sin destino en ${actual}`);
        actual = await validarDestino(new URL(destino, actual).href);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${actual}`);
      const tipo = res.headers.get('content-type') || '';
      if (tipo && !/text\/|html|xml|json/i.test(tipo)) throw new Error(`tipo de contenido no textual: ${tipo}`);
      return leerConLimite(res, controlador);
    }
  }

  async function textoDeFuente(url, { signal } = {}) {
    if (!cache.has(url)) {
      const promesa = descargar(url, signal).then((cuerpo) => ` ${normalizar(htmlATexto(cuerpo))} `);
      promesa.catch(() => cache.delete(url)); // un fallo (o una cancelación) no queda cacheado
      cache.set(url, promesa);
    }
    return cache.get(url);
  }

  /**
   * Verifica una pregunta ya validada estructuralmente.
   * Devuelve { verificada, respuestas (conservadas), descartadas, fuentesLeidas, errores }.
   */
  async function verificarPregunta(p, { signal } = {}) {
    if (p.datosEstructurados === 'wikidata') {
      const validas = p.respuestas.filter((r) => /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/.test(r.fuente?.url || ''));
      return {
        verificada: validas.length === p.respuestas.length,
        estructurada: true,
        respuestas: validas,
        descartadas: [],
        fuentesLeidas: 1,
        errores: validas.length === p.respuestas.length ? [] : ['Hay respuestas sin una entidad verificable de Wikidata.'],
      };
    }
    if (modo === 'desactivada') {
      return { verificada: true, omitida: true, respuestas: p.respuestas, descartadas: [], fuentesLeidas: 0, errores: [] };
    }
    const errores = [];
    const textos = [];
    for (const f of p.fuentes) {
      try {
        textos.push(await textoDeFuente(f.url, { signal }));
      } catch (e) {
        errores.push(`${f.url}: ${e.message}`);
      }
    }
    if (!textos.length) return { verificada: false, respuestas: [], descartadas: [], fuentesLeidas: 0, errores };

    const corpus = textos.join(' ');
    const conservadas = [];
    const descartadas = [];
    for (const r of p.respuestas) {
      const formas = [r.canonica, ...r.variantes].map(normalizar).filter((f) => f.length >= 3);
      const encontrada = formas.some((f) => corpus.includes(` ${f} `));
      if (encontrada) conservadas.push(r);
      else descartadas.push({ canonica: r.canonica, motivo: 'no aparece en las fuentes que delimitan el alcance' });
    }
    return { verificada: true, respuestas: conservadas, descartadas, fuentesLeidas: textos.length, errores };
  }

  return { verificarPregunta, textoDeFuente };
}
