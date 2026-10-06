// Convierte una consulta SPARQL acotada en un banco local de respuestas.
// Wikidata se consulta al preparar el desafío, nunca durante una partida.
import { normalizar } from '../normalizar.js';

export const MIN_RESPUESTAS_WIKIDATA = 1000;
export const MAX_RESPUESTAS_WIKIDATA = 1500;
const ENDPOINT = 'https://query.wikidata.org/sparql';
const ITEM = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/;
const OPERACIONES_PROHIBIDAS = /\b(ASK|CONSTRUCT|DESCRIBE|INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD|WITH)\b/i;

function consultaSegura(texto) {
  let consulta = String(texto || '').trim();
  if (!/^SELECT\b/i.test(consulta)) throw new Error('La consulta de Wikidata debe ser SELECT.');
  if (!/^SELECT\s+DISTINCT\b/i.test(consulta)) throw new Error('La consulta de Wikidata debe usar SELECT DISTINCT.');
  if (consulta.length > 12_000 || OPERACIONES_PROHIBIDAS.test(consulta)) throw new Error('La consulta de Wikidata contiene una operación no permitida.');
  if (/\bSERVICE\b/i.test(consulta)) throw new Error('La consulta no puede acceder a servicios externos.');
  if (/\bORDER\s+BY\b/i.test(consulta)) throw new Error('La consulta no debe ordenar remotamente; Filón ordena los resultados localmente.');
  for (const variable of ['item', 'popularidad']) {
    if (!new RegExp(`\\?${variable}\\b`).test(consulta)) throw new Error(`La consulta debe devolver ?${variable}.`);
  }
  const limites = [...consulta.matchAll(/\bLIMIT\s+(\d+)/gi)];
  if (limites.length > 1) throw new Error('La consulta debe tener un solo LIMIT.');
  if (!limites.length) consulta += `\nLIMIT ${MAX_RESPUESTAS_WIKIDATA}`;
  else {
    const limite = Number(limites[0][1]);
    if (limite < MIN_RESPUESTAS_WIKIDATA || limite > MAX_RESPUESTAS_WIKIDATA) {
      throw new Error(`El LIMIT debe estar entre ${MIN_RESPUESTAS_WIKIDATA} y ${MAX_RESPUESTAS_WIKIDATA}.`);
    }
  }
  return consulta;
}

function rarezaPorPosicion(indice, total) {
  const proporcion = indice / Math.max(1, total);
  if (proporcion < 0.05) return 'grava';
  if (proporcion < 0.2) return 'cobre';
  if (proporcion < 0.5) return 'plata';
  if (proporcion < 0.8) return 'oro';
  return 'diamante';
}

function valor(binding, clave) {
  return String(binding?.[clave]?.value || '').trim();
}

export function crearCatalogoWikidata({ obtener = globalThis.fetch, userAgent = 'FilonBot/1.0', tiempoLimiteMs = 45_000 } = {}) {
  const senal = (externa) => (externa ? AbortSignal.any([AbortSignal.timeout(tiempoLimiteMs), externa]) : AbortSignal.timeout(tiempoLimiteMs));

  async function etiquetasDe(ids, externa) {
    const lotes = [];
    for (let i = 0; i < ids.length; i += 300) lotes.push(ids.slice(i, i + 300));
    const salida = new Map();
    for (const lote of lotes) {
      const consulta = `SELECT ?item ?itemLabel ?itemAltLabel WHERE {
  VALUES ?item { ${lote.map((id) => `wd:${id}`).join(' ')} }
  OPTIONAL { ?item rdfs:label ?labelEs. FILTER(LANG(?labelEs) = "es") }
  OPTIONAL { ?item rdfs:label ?labelEn. FILTER(LANG(?labelEn) = "en") }
  OPTIONAL { ?item skos:altLabel ?itemAltLabel. FILTER(LANG(?itemAltLabel) IN ("es", "en")) }
  BIND(COALESCE(?labelEs, ?labelEn) AS ?itemLabel)
}`;
      let res;
      for (let intento = 1; intento <= 3; intento++) {
        res = await obtener(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            accept: 'application/sparql-results+json',
            'user-agent': userAgent,
          },
          body: new URLSearchParams({ query: consulta }),
          signal: senal(externa),
        });
        if (res.ok || (res.status !== 429 && res.status < 500)) break;
        const espera = Math.min(10_000, Number(res.headers.get('retry-after')) * 1000 || intento * 1500);
        await new Promise((ok) => setTimeout(ok, espera));
      }
      if (!res?.ok) throw new Error(`La consulta de etiquetas de Wikidata respondió HTTP ${res?.status || 'desconocido'}.`);
      const datos = await res.json();
      for (const binding of datos?.results?.bindings || []) {
        const coincidencia = valor(binding, 'item').match(ITEM);
        const canonica = valor(binding, 'itemLabel');
        if (!coincidencia || !canonica) continue;
        const id = coincidencia[1];
        const entidad = salida.get(id) || { canonica, variantes: new Set() };
        const alias = valor(binding, 'itemAltLabel');
        if (alias && alias.length <= 90 && normalizar(alias) !== normalizar(canonica)) entidad.variantes.add(alias);
        salida.set(id, entidad);
      }
    }
    return salida;
  }

  async function hidratar(candidata, { signal: externa } = {}) {
    const consulta = consultaSegura(candidata.consulta_wikidata ?? candidata.consultaWikidata);
    const cuerpo = new URLSearchParams({ query: consulta });
    const res = await obtener(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        accept: 'application/sparql-results+json',
        'accept-encoding': 'gzip,deflate',
        'user-agent': userAgent,
      },
      body: cuerpo,
      signal: senal(externa),
    });
    if (!res.ok) throw new Error(`Wikidata respondió HTTP ${res.status}.`);
    const datos = await res.json();
    const porEntidad = new Map();
    for (const binding of datos?.results?.bindings || []) {
      const coincidencia = valor(binding, 'item').match(ITEM);
      const popularidad = Number(valor(binding, 'popularidad'));
      if (!coincidencia || !Number.isFinite(popularidad)) continue;
      const id = coincidencia[1];
      const canonica = valor(binding, 'itemLabel');
      const actual = porEntidad.get(id) || { id, canonica, popularidad, variantes: new Set() };
      actual.popularidad = Math.max(actual.popularidad, popularidad);
      const alias = valor(binding, 'itemAltLabel');
      for (const variante of alias.split('|').map((x) => x.trim()).filter(Boolean).slice(0, 12)) {
        if (variante.length <= 90 && normalizar(variante) !== normalizar(canonica)) actual.variantes.add(variante);
      }
      porEntidad.set(id, actual);
    }

    const sinEtiqueta = [...porEntidad.values()].filter((entidad) => !entidad.canonica).map((entidad) => entidad.id);
    if (sinEtiqueta.length) {
      const etiquetas = await etiquetasDe(sinEtiqueta, externa);
      for (const entidad of porEntidad.values()) {
        const etiqueta = etiquetas.get(entidad.id);
        if (!entidad.canonica && etiqueta) entidad.canonica = etiqueta.canonica;
        for (const variante of etiqueta?.variantes || []) {
          if (variante.length <= 90) entidad.variantes.add(variante);
        }
      }
    }

    const unicas = [];
    const canonicas = new Set();
    for (const entidad of [...porEntidad.values()].sort((a, b) => b.popularidad - a.popularidad || (a.canonica || '').localeCompare(b.canonica || '', 'es'))) {
      entidad.clave = normalizar(entidad.canonica);
      if (!entidad.clave || entidad.canonica.length > 90) continue;
      if (canonicas.has(entidad.clave)) continue;
      canonicas.add(entidad.clave);
      unicas.push(entidad);
      if (unicas.length === MAX_RESPUESTAS_WIKIDATA) break;
    }
    if (unicas.length < MIN_RESPUESTAS_WIKIDATA) {
      throw new Error(`La consulta devolvió ${unicas.length} respuestas únicas; hacen falta al menos ${MIN_RESPUESTAS_WIKIDATA}.`);
    }

    const fuenteGeneral = {
      url: 'https://www.wikidata.org/wiki/Wikidata:Main_Page',
      titulo: 'Wikidata',
    };
    const respuestas = unicas.map((entidad, indice) => ({
      canonica: entidad.canonica,
      variantes: [...entidad.variantes],
      rareza: rarezaPorPosicion(indice, unicas.length),
      explicacion: 'Entrada del conjunto global verificada en Wikidata al publicar el desafío.',
      fuente: { url: `https://www.wikidata.org/wiki/${entidad.id}`, titulo: `${entidad.canonica} — Wikidata` },
    }));
    return {
      ...candidata,
      consultaWikidata: consulta,
      datosEstructurados: 'wikidata',
      fuentes: [fuenteGeneral],
      respuestas,
      rechazos: Array.isArray(candidata.rechazos) ? candidata.rechazos : [],
    };
  }

  return { hidratar };
}

export const _interno = { consultaSegura, rarezaPorPosicion };
