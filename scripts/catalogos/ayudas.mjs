// Ayudas compartidas por las definiciones de catálogos: verificación, nombres y alias desde Wikidata,
// wikitexto de Wikipedia, CSV y familiaridad editorial de los temas. Solo se usan al importar.
import { descargar, capitalizar, limpiarAlias } from './comun.mjs';
import { normalizar } from '../../servidor/normalizar.js';

export const WIKIDATA = { nombre: 'Wikidata', url: 'https://www.wikidata.org', licencia: 'CC0 1.0' };
export const POPULARIDAD_WIKIPEDIA = {
  criterio: 'Cantidad de ediciones de Wikipedia con artículo sobre la entidad (sitelinks de Wikidata) al importar.',
  nota: 'Es una medida de notoriedad, no una estadística de jugadores.',
};

/** Si la condición no se cumple, la importación se corta (y se conserva el archivo anterior). */
export function exigir(condicion, mensaje, verificacion) {
  if (!condicion) throw new Error(`Verificación fallida: ${mensaje}`);
  verificacion.push(mensaje);
}
export const iguales = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export const rango = (desde, hasta, menos = []) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i).filter((a) => !menos.includes(a));

/** Nombre y alias desde Wikidata (etiqueta en español; si no hay, se informa y no se importa). */
export function nombreYAlias(e, { capital = false, extras = [] } = {}) {
  if (!e?.es) return null;
  const nombre = capital ? capitalizar(e.es) : e.es;
  return { nombre, alias: limpiarAlias(nombre, [...extras, ...e.alias.map((a) => (capital ? capitalizar(a) : a))]) };
}

/** Wikitexto de una página de Wikipedia, con su número de revisión (queda registrado en la fuente). */
export async function wikitexto(pagina, idioma = 'es') {
  const d = await descargar(`https://${idioma}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'parse', page: pagina, prop: 'wikitext|revid', format: 'json', formatversion: '2', redirects: '1' })}`, { json: true });
  if (!d.parse) throw new Error(`No se encontró la página «${pagina}» en ${idioma}.wikipedia.org`);
  return { texto: d.parse.wikitext, revision: d.parse.revid, url: `https://${idioma}.wikipedia.org/w/index.php?oldid=${d.parse.revid}` };
}

/** Texto plano de una celda de wikitexto: sin enlaces, cursivas, plantillas ni referencias. */
export const plano = (celda) =>
  celda
    .replace(/^\s*(?:rowspan|colspan|style|class|align)[^|[\]]*\|\s*/, '')
    .replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;|&thinsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** CSV con comillas (separador configurable). */
export function leerCsv(texto, separador = ',') {
  const filas = [];
  let fila = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else actual += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === separador) {
      fila.push(actual);
      actual = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(actual);
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
      actual = '';
    } else actual += ch;
  }
  if (actual || fila.length) filas.push([...fila, actual]);
  const [cabecera, ...resto] = filas;
  return resto.map((f) => Object.fromEntries(cabecera.map((c, i) => [c.trim(), (f[i] ?? '').trim()])));
}

/**
 * Familiaridad editorial de los temas (1 poco conocido, 3 muy conocido) a partir de los artículos de
 * Wikipedia del tema (un director, una saga, un autor): una regla reproducible, no una opinión. Sirve para
 * elegir consignas accesibles; nunca quita respuestas.
 */
export function familiaridadPorEnlaces(enlaces, { alta = 80, media = 35 } = {}) {
  return Object.fromEntries(Object.entries(enlaces).map(([valor, n]) => [valor, n >= alta ? 3 : n >= media ? 2 : 1]));
}

/** ¿Hay dos entidades con el mismo nombre normalizado? Devuelve los repetidos. */
export function nombresRepetidos(entidades) {
  const vistos = new Map();
  const repetidos = new Set();
  for (const e of entidades) {
    const n = normalizar(e.nombre);
    if (vistos.has(n) && vistos.get(n) !== e.id) repetidos.add(e.nombre);
    vistos.set(n, e.id);
  }
  return [...repetidos];
}

/** Agrupa en lotes (para consultas con VALUES). */
export function enLotes(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}
