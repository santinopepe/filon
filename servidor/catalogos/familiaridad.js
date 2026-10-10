// Política editorial independiente de los datos factuales y de la rareza. No usa la red.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizar } from '../normalizar.js';
import { evaluar } from './filtros.js';
const contenido = readFileSync(new URL('../../datos/familiaridad.json', import.meta.url), 'utf8');
const politica = JSON.parse(contenido);
export const VERSION_FAMILIARIDAD = `${politica.version}.${createHash('sha256').update(contenido).digest('hex').slice(0, 10)}`;
const referencias = new Map(Object.entries(politica.catalogos).map(([id, c]) => [id, new Set(c.conocidas.map(normalizar))]));
const cacheFormas = new WeakMap();
export function nombreFamiliar(catalogo, entidad, filtro = null) {
  if (entidad.familiaridadEditorial !== undefined) return entidad.familiaridadEditorial >= 2 ? entidad.nombre : null;
  const conocidas = referencias.get(catalogo.universo ?? catalogo.id);
  if (!conocidas) return null;
  let formas = cacheFormas.get(entidad);
  if (!formas) {
    formas = [entidad.nombre, ...(entidad.alias ?? [])].filter(n => conocidas.has(normalizar(n))).map(nombre => ({ ...entidad, nombre, _rasgos: {} }));
    cacheFormas.set(entidad, formas);
  }
  return formas.find(e => !filtro || evaluar(filtro, e))?.nombre ?? null;
}
export function esFamiliar(catalogo, entidad, filtro = null) {
  return nombreFamiliar(catalogo, entidad, filtro) !== null;
}

/** La cantidad de condiciones incluye varios valores/letras dentro de una misma cláusula. */
export function complejidadDe(filtro) {
  return filtro.y.reduce((n, c) => n + Math.max(1, (c.letras ?? c.textos ?? c.valores ?? []).length), 0);
}
export function evaluarAccesibilidad(plantilla, catalogo, entidades, filtro, minFamiliares = 3) {
  const familiares = entidades.filter(e => esFamiliar(catalogo, e, filtro)).length;
  const complejidad = complejidadDe(filtro);
  const temporal = filtro.y.some(c => c.op === 'entre' || /anio|fecha|siglo|edicion/.test(c.campo) || /\b\d{4}\b/.test((c.valores ?? []).join(' ')));
  const tecnica = filtro.y.some(c => /tecnica|codigos|paradigma|clasificacion/.test(c.campo) || (c.campo === 'familias' && catalogo.id === 'instrumentos_musicales') || (c.campo === 'categorias' && catalogo.id === 'frutas_verduras') || /brassica|hornbostel/.test(normalizar((c.valores ?? []).join(' '))));
  // Reconocer a un artista no implica recordar tres títulos de sus discos.
  const recuerdoEspecializado = (catalogo.universo ?? catalogo.id) === 'albumes';
  const conocida = filtro.y.every(c => c.campo !== 'nombre' || ['empieza','termina','tiene','contiene','letras','palabras'].includes(c.op));
  const simple = complejidad <= 1 && !temporal && !tecnica && !recuerdoEspecializado && conocida;
  return { familiares, minFamiliares, complejidad, simple, temporal, tecnica, recuerdoEspecializado, facil: simple && familiares >= minFamiliares, base: 'hipotesis-editorial', version: VERSION_FAMILIARIDAD };
}
