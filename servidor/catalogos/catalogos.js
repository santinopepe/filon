// Carga y valida los catálogos de datos/catalogos/ (generados por scripts/importar-catalogos.mjs).
// - Completa los campos omitidos (id = nombre, alias y atributos vacíos, fuente común).
// - Calcula qué atributos están completos: un filtro solo puede usar un atributo que no le falte a nadie.
// - Detecta colisiones de alias: un alias que también nombra a otra entidad del catálogo («Congo» para
//   dos países) se descarta, para que ninguna respuesta acepte a otra entidad ni infle el conjunto.
// - Vistas: un catálogo puede ser un subconjunto filtrado de otro («peliculas_argentinas» = las películas de
//   «peliculas» con Argentina entre sus países). La vista no copia entidades: las toma del catálogo base al
//   cargar, así los dos nunca divergen. Su `universo` es el del base (entra en la firma de las consignas).
// No usa la red: si falta un archivo, el catálogo simplemente no está disponible.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formasRegistrables, normalizar } from '../normalizar.js';
import { validarFiltro, evaluar } from './filtros.js';

const TIPOS = new Set(['texto', 'lista', 'numero', 'lista_numeros']);
const cache = new Map();

function validarCatalogo(c, archivo) {
  const errores = [];
  if (!c || typeof c !== 'object') return ['no es un objeto JSON'];
  if (`${c.id}.json` !== archivo) errores.push(`el id «${c.id}» no coincide con el archivo`);
  if (!['completa', 'parcial'].includes(c.cobertura?.tipo)) errores.push('cobertura inválida');
  if (c.vista) {
    // Una vista declara su base y su filtro; lo demás lo hereda del catálogo base.
    if (typeof c.vista.catalogo !== 'string' || !c.vista.filtro) errores.push('vista sin «catalogo» o «filtro»');
    if (c.entidades) errores.push('una vista no tiene entidades propias');
    return errores;
  }
  for (const k of ['id', 'nombre', 'version', 'importado']) if (typeof c[k] !== 'string' || !c[k]) errores.push(`falta «${k}»`);
  if (!Array.isArray(c.fuentes) || !c.fuentes.length || !c.fuentes.every((f) => f?.url && f?.licencia)) errores.push('faltan fuentes con url y licencia');
  for (const [k, a] of Object.entries(c.atributos ?? {})) if (!TIPOS.has(a?.tipo)) errores.push(`atributo «${k}» con tipo inválido`);
  const completoPor = c.cobertura?.completoPor ?? [];
  const grupos = typeof completoPor === 'object' && !Array.isArray(completoPor) ? Object.keys(completoPor) : [completoPor].flat();
  if (grupos.some((g) => !c.atributos?.[g])) errores.push('«completoPor» nombra un atributo que no existe');
  if (typeof completoPor === 'object' && !Array.isArray(completoPor) && Object.values(completoPor).some((v) => v !== true && (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string')))) errores.push('«completoPor»: cada grupo es true o una lista no vacía de valores');
  if (!Array.isArray(c.entidades) || !c.entidades.length) errores.push('sin entidades');
  return errores;
}

function prepararEntidades(c) {
  const ids = new Set();
  const errores = [];
  const entidades = c.entidades.map((e) => {
    const id = String(e.id ?? e.nombre);
    if (ids.has(id)) errores.push(`id repetido «${id}»`);
    ids.add(id);
    if (typeof e.nombre !== 'string' || !normalizar(e.nombre)) errores.push(`entidad «${id}» sin nombre`);
    if (typeof e.popularidad !== 'number') errores.push(`entidad «${id}» sin popularidad`);
    return { id, nombre: e.nombre, alias: e.alias ?? [], popularidad: e.popularidad, atributos: e.atributos ?? {}, fuente: e.fuente ?? c.fuenteEntidades };
  });
  return { entidades, errores };
}

/**
 * Colisiones de nombres y alias dentro de un catálogo. Un alias que comparte una forma con el nombre o
 * un alias de otra entidad se quita (de todas). Dos entidades con el mismo nombre quedan marcadas como
 * ambiguas: el generador no arma preguntas que las incluyan a ambas.
 */
function resolverColisiones(entidades) {
  const duenios = new Map(); // forma → Set(id)
  const formasDe = (texto) => formasRegistrables(texto);
  for (const e of entidades) for (const t of [e.nombre, ...e.alias]) for (const f of formasDe(t)) (duenios.get(f) ?? duenios.set(f, new Set()).get(f)).add(e.id);
  const colisiones = [];
  for (const e of entidades) {
    const conservados = [];
    for (const a of e.alias) {
      const ajenos = formasDe(a).flatMap((f) => [...duenios.get(f)].filter((id) => id !== e.id));
      if (ajenos.length) colisiones.push({ entidad: e.id, alias: a, con: [...new Set(ajenos)] });
      else conservados.push(a);
    }
    e.alias = conservados;
  }
  const porNombre = new Map();
  for (const e of entidades) (porNombre.get(normalizar(e.nombre)) ?? porNombre.set(normalizar(e.nombre), []).get(normalizar(e.nombre))).push(e.id);
  const ambiguas = new Set([...porNombre.values()].filter((l) => l.length > 1).flat());
  for (const e of entidades) e.ambigua = ambiguas.has(e.id);
  return { colisiones, ambiguas: [...ambiguas] };
}

/** Valores distintos de cada atributo de texto o lista (los únicos que un filtro «es» puede pedir). */
function valoresDe(c) {
  const valores = new Map();
  for (const [campo, def] of Object.entries(c.atributos ?? {})) {
    if (def.tipo !== 'texto' && def.tipo !== 'lista') continue;
    const s = new Set();
    for (const e of c.entidades) for (const v of [e.atributos[campo]].flat()) if (typeof v === 'string' && v) s.add(v);
    valores.set(campo, s);
  }
  return valores;
}

// Una lista vacía es un dato (una isla no tiene países limítrofes); null o ausente es un dato que falta.
export const tieneDato = (v) => v !== null && v !== undefined && v !== '';

/** Atributos que tienen valor en todas las entidades (los únicos filtrables sin perder respuestas). */
function completos(c) {
  return new Set(Object.keys(c.atributos ?? {}).filter((campo) => c.entidades.every((e) => tieneDato(e.atributos[campo]))));
}

/** Completa lo que cualquier catálogo (propio o vista) necesita para el generador. */
function prepararCatalogo(catalogo) {
  catalogo.universo ??= catalogo.id;
  catalogo.valores = valoresDe(catalogo);
  catalogo.completos = completos(catalogo);
  // Percentil de popularidad de cada entidad dentro de su catálogo (0 = la menos conocida, 1 = la más).
  const orden = [...catalogo.entidades].sort((a, b) => a.popularidad - b.popularidad);
  const percentiles = new Map(orden.map((e, i) => [e.id, catalogo.entidades.length > 1 ? i / (catalogo.entidades.length - 1) : 1]));
  catalogo.percentil = (e) => percentiles.get(e.id) ?? 0;
  return catalogo;
}

/**
 * Arma una vista: las entidades del catálogo base que cumplen su filtro (las mismas, no copias). Hereda
 * atributos, fuentes y popularidad; la versión combina la del base con la del filtro.
 */
function armarVista(c, base) {
  const { ok, errores, filtro } = validarFiltro(c.vista.filtro, base);
  if (!ok) return { errores: [`filtro de la vista inválido: ${errores.join(' ')}`] };
  const entidades = base.entidades.filter((e) => evaluar(filtro, e));
  if (!entidades.length) return { errores: ['la vista no tiene entidades'] };
  const huella = createHash('sha256').update(JSON.stringify(filtro)).digest('hex').slice(0, 8);
  const vista = {
    ...base,
    ...c,
    nombre: c.nombre ?? base.nombre,
    version: `${base.version}+${huella}`,
    importado: base.importado,
    fuentes: base.fuentes,
    atributos: base.atributos,
    cobertura: { ...base.cobertura, ...c.cobertura, tipo: base.cobertura.tipo, completoPor: base.cobertura.completoPor, completoEn: base.cobertura.completoEn },
    temas: c.temas ?? base.temas,
    fuenteEntidades: base.fuenteEntidades,
    entidades,
    base,
    filtroVista: filtro,
    universo: base.universo ?? base.id,
    colisiones: base.colisiones,
    ambiguas: base.ambiguas.filter((id) => entidades.some((e) => e.id === id)),
  };
  return { vista: prepararCatalogo(vista) };
}

/**
 * Carga todos los catálogos de un directorio. Devuelve { catalogos: Map(id → catálogo), problemas }.
 * Cada catálogo trae además `valores`, `completos`, `colisiones`, `ambiguas` y `percentil(e)`.
 */
export function cargarCatalogos(dir) {
  let archivos;
  try {
    archivos = readdirSync(dir).filter((a) => a.endsWith('.json')).sort();
  } catch {
    return { catalogos: new Map(), problemas: [`No existe el directorio de catálogos ${dir}.`] };
  }
  const huella = archivos.map((a) => `${a}:${statSync(join(dir, a)).mtimeMs}`).join('|');
  const previo = cache.get(dir);
  if (previo?.huella === huella) return previo.resultado;

  const catalogos = new Map();
  const problemas = [];
  const vistas = [];
  for (const archivo of archivos) {
    let c;
    try {
      c = JSON.parse(readFileSync(join(dir, archivo), 'utf8'));
    } catch (e) {
      problemas.push(`${archivo}: JSON inválido (${e.message})`);
      continue;
    }
    const errores = validarCatalogo(c, archivo);
    if (errores.length) {
      problemas.push(`${archivo}: ${errores.join('; ')}`);
      continue;
    }
    if (c.vista) {
      vistas.push(c);
      continue;
    }
    const { entidades, errores: deEntidades } = prepararEntidades(c);
    if (deEntidades.length) {
      problemas.push(`${archivo}: ${deEntidades.slice(0, 5).join('; ')}`);
      continue;
    }
    const catalogo = { ...c, entidades };
    Object.assign(catalogo, resolverColisiones(entidades));
    catalogos.set(c.id, prepararCatalogo(catalogo));
  }
  // Las vistas, después de sus catálogos base (una vista de una vista no está permitida).
  for (const c of vistas) {
    const base = catalogos.get(c.vista.catalogo);
    if (!base || base.base) {
      problemas.push(`${c.id}.json: la vista necesita el catálogo «${c.vista.catalogo}», que no está disponible`);
      continue;
    }
    const { vista, errores } = armarVista(c, base);
    if (errores) problemas.push(`${c.id}.json: ${errores.join('; ')}`);
    else catalogos.set(c.id, vista);
  }
  const resultado = { catalogos, problemas };
  cache.set(dir, { huella, resultado });
  return resultado;
}

/** Versión combinada de los catálogos (entra en la semilla: otros datos, otro sorteo). */
export const versionDeCatalogos = (catalogos) => [...catalogos.values()].map((c) => `${c.id}@${c.version}`).sort().join(',');
