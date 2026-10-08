// Utilidades de importación de catálogos: descarga con caché local, limpieza de alias y armado del archivo.
import { createHash } from 'node:crypto';
import { normalizar } from '../../servidor/normalizar.js';

const AGENTE = 'FilonImportador/1.0 (https://filon-five.vercel.app; importación de catálogos)';
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Descarga un recurso (texto o JSON) con reintentos. */
export async function descargar(url, { json = false, pausa = 0, cabeceras = {} } = {}) {
  for (let i = 1; ; i++) {
    try {
      if (pausa) await esperar(pausa);
      const res = await fetch(url, { headers: { 'user-agent': AGENTE, ...cabeceras }, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`${res.status} al descargar ${url}`);
      return json ? res.json() : res.text();
    } catch (e) {
      if (i >= 6) throw new Error(`${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''} — ${url}`, { cause: e });
      await esperar(3000 * i);
    }
  }
}

export const sha = (texto) => createHash('sha256').update(texto).digest('hex');

/** Primera letra en mayúscula (los nombres de elementos vienen en minúscula en Wikidata). */
export const capitalizar = (t) => (t ? t[0].toLocaleUpperCase('es') + t.slice(1) : t);

/**
 * Limpia los alias de una entidad: sin repetir el nombre ni entre sí (por forma normalizada), sin
 * emojis ni códigos en mayúsculas de hasta cuatro letras (EAU, RPDC, MXN), sin textos larguísimos.
 */
export function limpiarAlias(nombre, alias) {
  const vistos = new Set([normalizar(nombre)]);
  const limpios = [];
  for (const a of alias) {
    const t = String(a ?? '').trim().replace(/\s+/g, ' ');
    const n = normalizar(t);
    if (!n || vistos.has(n) || t.length > 60) continue;
    if (/\p{Extended_Pictographic}/u.test(t) || /^[A-Z.]{1,4}$/.test(t.replace(/\s/g, ''))) continue;
    vistos.add(n);
    limpios.push(t);
  }
  return limpios;
}

/** Alias que surgen de un paréntesis: «Myanmar (Birmania)» → «Myanmar», «Birmania». */
export function sinParentesis(texto) {
  const m = String(texto).match(/^(.*?)\s*\(([^)]+)\)\s*(.*)$/);
  if (!m) return { base: texto, extras: [] };
  const base = `${m[1]} ${m[3]}`.trim();
  return { base: base || m[2], extras: [m[2].trim(), `${m[1]} ${m[2]} ${m[3]}`.replace(/\s+/g, ' ').trim()] };
}

/** Arma el archivo de un catálogo con su versión (fecha de importación + huella del contenido). */
export function armarCatalogo(def, { entidades, fuentes, correcciones = [], verificacion = [], sinVerificar = [], fuenteEntidades = null, hoy }) {
  // Campos que se omiten si no aportan (el cargador completa los valores por omisión): id igual al
  // nombre, alias y atributos vacíos, fuente igual a la común del catálogo.
  const compactas = entidades.map(({ id, nombre, alias, popularidad, atributos, fuente }) => ({
    ...(id !== nombre ? { id } : {}),
    nombre,
    ...(alias?.length ? { alias } : {}),
    popularidad,
    ...(atributos && Object.keys(atributos).length ? { atributos } : {}),
    ...(fuente && fuente !== fuenteEntidades ? { fuente } : {}),
  }));
  const clave = (e) => e.id ?? e.nombre;
  const ordenadas = compactas.sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0));
  const huella = sha(JSON.stringify(ordenadas)).slice(0, 10);
  return {
    id: def.id,
    nombre: def.nombre,
    descripcion: def.descripcion,
    version: `${hoy}.${huella}`,
    importado: hoy,
    fuentes,
    popularidad: def.popularidad,
    cobertura: { ...def.cobertura, verificacion, ...(sinVerificar.length ? { sinVerificarManualmente: sinVerificar } : {}) },
    atributos: def.atributos,
    ...(fuenteEntidades ? { fuenteEntidades } : {}),
    correcciones,
    entidades: ordenadas,
  };
}
