// Verificación factual contra fuentes externas (no contra otra IA).
// Cada respuesta debe aparecer —por su nombre canónico o una variante— en el texto de alguna de las
// fuentes que delimitan el alcance de la pregunta (por ejemplo, el artículo que enumera el conjunto).
// Las respuestas que no se encuentran se descartan. Si ninguna fuente se puede leer, la pregunta no
// se considera verificada.
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

export function crearVerificador({ dominios, tiempoLimiteMs = 15_000, userAgent, obtener = globalThis.fetch, modo = 'estricta' }) {
  const cache = new Map();

  async function textoDeFuente(url) {
    if (!dominioPermitido(url, dominios)) throw new Error(`dominio no permitido: ${url}`);
    if (!cache.has(url)) {
      cache.set(
        url,
        (async () => {
          const res = await obtener(url, {
            headers: { 'user-agent': userAgent, accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
            redirect: 'follow',
            signal: AbortSignal.timeout(tiempoLimiteMs),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
          const cuerpo = await res.text();
          return ` ${normalizar(htmlATexto(cuerpo))} `;
        })(),
      );
    }
    return cache.get(url);
  }

  /**
   * Verifica una pregunta ya validada estructuralmente.
   * Devuelve { verificada, respuestas (conservadas), descartadas, fuentesLeidas, errores }.
   */
  async function verificarPregunta(p) {
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
        textos.push(await textoDeFuente(f.url));
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
