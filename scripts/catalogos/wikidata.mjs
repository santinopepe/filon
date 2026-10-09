// Cliente mínimo de Wikidata (SPARQL) para importar catálogos. Solo se usa al importar: el juego y la
// generación diaria leen los archivos de datos/catalogos/, nunca la red.
// Datos de Wikidata: CC0 1.0 (https://www.wikidata.org/wiki/Wikidata:Licensing).
import { pedir } from './comun.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const LOTE = 80;

export const qid = (uri) => String(uri).split('/').pop();
export const urlEntidad = (id) => `https://www.wikidata.org/wiki/${id}`;

/**
 * Ejecuta una consulta SPARQL (GET, con caché, intervalo entre consultas y reintentos acotados: un 504 o
 * un 429 se reintentan; un error de sintaxis, no).
 */
export async function sparql(consulta, { intentos = 4 } = {}) {
  const texto = await pedir(`${ENDPOINT}?${new URLSearchParams({ query: consulta, format: 'json' })}`, {
    cabeceras: { accept: 'application/sparql-results+json' },
    intentos,
    clave: `sparql:${consulta}`,
    validar: (t) => { if (!Array.isArray(JSON.parse(t)?.results?.bindings)) throw new Error('SPARQL devolvió una respuesta sin bindings'); },
  });
  const datos = JSON.parse(texto);
  return datos.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

const valores = (ids) => ids.map((id) => `wd:${id}`).join(' ');
async function porLotes(ids, armar) {
  const filas = [];
  for (let i = 0; i < ids.length; i += LOTE) filas.push(...(await sparql(armar(valores(ids.slice(i, i + LOTE))))));
  return filas;
}

/**
 * Nombre en español, alias en español, nombre en inglés y cantidad de artículos de Wikipedia
 * (sitelinks: la medida de popularidad que usa la rareza) de cada entidad. Si no hay etiqueta en
 * español se usa la etiqueta «mul» (Wikidata la usa cuando el nombre es el mismo en todos los idiomas,
 * como «Oslo») y se informa en `deMul`.
 */
export async function etiquetas(ids) {
  const res = new Map(ids.map((id) => [id, { id, es: null, en: null, alias: [], enlaces: 0, deMul: false }]));
  for (const f of await porLotes(ids, (v) => `SELECT ?e ?es ?mul ?en ?n WHERE { VALUES ?e { ${v} }
      OPTIONAL { ?e wikibase:sitelinks ?n }
      OPTIONAL { ?e rdfs:label ?es . FILTER(LANG(?es) = "es") }
      OPTIONAL { ?e rdfs:label ?mul . FILTER(LANG(?mul) = "mul") }
      OPTIONAL { ?e rdfs:label ?en . FILTER(LANG(?en) = "en") } }`)) {
    const e = res.get(qid(f.e));
    e.es = f.es ?? f.mul ?? e.es;
    e.deMul = !f.es && Boolean(f.mul);
    e.en = f.en ?? e.en;
    e.enlaces = Number(f.n ?? 0);
  }
  for (const f of await porLotes(ids, (v) => `SELECT ?e ?a WHERE { VALUES ?e { ${v} } ?e skos:altLabel ?a . FILTER(LANG(?a) = "es") }`)) {
    res.get(qid(f.e)).alias.push(f.a);
  }
  for (const e of res.values()) e.alias.sort();
  return res;
}

/**
 * Valores de una propiedad (sin rango «obsoleto»), con sus calificadores de fecha y la etiqueta en
 * español del valor si es otra entidad. `vigentes` descarta los que tienen fecha de fin (P582) y, si
 * alguno tiene rango preferido, se queda solo con esos.
 */
export async function propiedad(ids, prop, { vigentes = false } = {}) {
  const res = new Map(ids.map((id) => [id, []]));
  for (const f of await porLotes(ids, (v) => `SELECT ?e ?v ?vl ?vm ?t ?ini ?fin ?rango WHERE { VALUES ?e { ${v} }
      ?e p:${prop} ?st . ?st ps:${prop} ?v . ?st wikibase:rank ?rango .
      FILTER (?rango != wikibase:DeprecatedRank)
      OPTIONAL { ?st pq:P585 ?t } OPTIONAL { ?st pq:P580 ?ini } OPTIONAL { ?st pq:P582 ?fin }
      OPTIONAL { ?v rdfs:label ?vl . FILTER(LANG(?vl) = "es") } OPTIONAL { ?v rdfs:label ?vm . FILTER(LANG(?vm) = "mul") } }`)) {
    if (vigentes && f.fin) continue;
    const valor = /^http:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(f.v) ? { id: qid(f.v), nombre: f.vl ?? f.vm ?? null } : f.v;
    res.get(qid(f.e)).push({ valor, momento: f.t ?? null, inicio: f.ini ?? null, fin: f.fin ?? null, preferido: f.rango.endsWith('PreferredRank') });
  }
  // Si hay valores con rango «preferido», son los que valen (Wikidata marca así el valor actual).
  if (vigentes) for (const [id, lista] of res) if (lista.some((x) => x.preferido)) res.set(id, lista.filter((x) => x.preferido));
  return res;
}

/** Año (número) de una fecha de Wikidata, o null. */
export const anio = (fecha) => {
  // Las fechas «desconocidas» de Wikidata llegan como nodos anónimos, no como fechas: valen null.
  const m = fecha ? String(fecha).match(/^(-?\d+)-/) : null;
  return m ? Number(m[1]) : null;
};
