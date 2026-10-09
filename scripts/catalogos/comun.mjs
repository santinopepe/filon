// Utilidades de importación de catálogos: descarga con caché local, límite de solicitudes por servidor,
// reintentos acotados, limpieza de alias y armado del archivo.
//
// Caché: cada respuesta se guarda en .cache/importacion/ (fuera del repositorio) con su URL. Una
// reimportación dentro de `IMPORTAR_CACHE_HORAS` (24 por omisión) no vuelve a pedir lo mismo; con
// `--refrescar` (o IMPORTAR_CACHE_HORAS=0) se ignora. Así un catálogo grande (MusicBrainz pide de a una
// solicitud por segundo) se puede reintentar sin repetir cientos de descargas.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { normalizar } from '../../servidor/normalizar.js';
import { RAIZ } from '../../servidor/config.js';

const AGENTE = 'FilonImportador/1.0 (https://filon-five.vercel.app; importación de catálogos)';
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const sha = (texto) => createHash('sha256').update(texto).digest('hex');

const DIR_CACHE = join(RAIZ, '.cache', 'importacion');
const horasCache = () => (process.argv.includes('--refrescar') ? 0 : Number(process.env.IMPORTAR_CACHE_HORAS ?? 24));
// Intervalo mínimo entre solicitudes a un mismo servidor (cortesía y límites publicados: MusicBrainz pide
// una por segundo; Wikidata, consultas espaciadas).
const INTERVALO_MS = { 'musicbrainz.org': 1100, 'query.wikidata.org': 400, 'www.wikidata.org': 300, 'api.gbif.org': 200 };
const ultimaSolicitud = new Map();
export const estadisticasDescarga = { red: 0, cache: 0 };

async function turno(host) {
  const minimo = INTERVALO_MS[host] ?? 150;
  const espera = (ultimaSolicitud.get(host) ?? 0) + minimo - Date.now();
  ultimaSolicitud.set(host, Date.now() + Math.max(0, espera));
  if (espera > 0) await esperar(espera);
}

/** Lee de la caché si hay una copia vigente de la clave. */
export function leerCache(clave) {
  const ruta = join(DIR_CACHE, `${sha(clave).slice(0, 40)}.txt`);
  const horas = horasCache();
  if (!horas || !existsSync(ruta) || Date.now() - statSync(ruta).mtimeMs > horas * 3_600_000) return null;
  estadisticasDescarga.cache++;
  return readFileSync(ruta, 'utf8');
}
export function guardarCache(clave, texto) {
  mkdirSync(DIR_CACHE, { recursive: true });
  writeFileSync(join(DIR_CACHE, `${sha(clave).slice(0, 40)}.txt`), texto);
}

/**
 * Pide un recurso respetando el intervalo del servidor, con caché y hasta `intentos` reintentos (espera
 * creciente; un 4xx que no sea 429 no se reintenta). Devuelve el texto.
 */
export async function pedir(url, { cabeceras = {}, intentos = 5, metodo = 'GET', cuerpo = null, clave = url, validar = () => {} } = {}) {
  const guardado = leerCache(clave);
  if (guardado !== null) {
    try { validar(guardado); return guardado; } catch { /* Reintentar una copia inválida sin propagarla. */ }
  }
  const host = new URL(url).hostname;
  for (let i = 1; ; i++) {
    try {
      await turno(host);
      estadisticasDescarga.red++;
      const res = await fetch(url, { method: metodo, body: cuerpo, headers: { 'user-agent': AGENTE, ...cabeceras }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) {
        const error = new Error(`${res.status} al descargar ${url}: ${(await res.text()).slice(0, 200)}`);
        error.definitivo = res.status >= 400 && res.status < 500 && res.status !== 429;
        throw error;
      }
      const texto = await res.text();
      validar(texto);
      guardarCache(clave, texto);
      return texto;
    } catch (e) {
      if (e.definitivo || i >= intentos) throw new Error(`${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`, { cause: e });
      await esperar(2000 * 2 ** (i - 1));
    }
  }
}

/** Descarga un archivo binario (con caché en disco, límite por servidor y reintentos acotados). */
export async function descargarBinario(url, { intentos = 5 } = {}) {
  const ruta = join(DIR_CACHE, `${sha(url).slice(0, 40)}.bin`);
  const horas = horasCache();
  if (horas && existsSync(ruta) && Date.now() - statSync(ruta).mtimeMs <= horas * 3_600_000) {
    estadisticasDescarga.cache++;
    return readFileSync(ruta);
  }
  const host = new URL(url).hostname;
  for (let i = 1; ; i++) {
    try {
      await turno(host);
      estadisticasDescarga.red++;
      const res = await fetch(url, { headers: { 'user-agent': AGENTE }, signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`${res.status} al descargar ${url}`);
      const datos = Buffer.from(await res.arrayBuffer());
      mkdirSync(DIR_CACHE, { recursive: true });
      writeFileSync(ruta, datos);
      return datos;
    } catch (e) {
      if (i >= intentos) throw e;
      await esperar(2000 * 2 ** (i - 1));
    }
  }
}

/** Extrae un archivo de un ZIP (sin dependencias: lee el directorio central e infla con zlib). */
export function extraerDeZip(zip, nombre) {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error('ZIP sin directorio central');
  let p = zip.readUInt32LE(fin + 16);
  const total = zip.readUInt16LE(fin + 10);
  for (let i = 0; i < total; i++) {
    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const largoNombre = zip.readUInt16LE(p + 28);
    const largoExtra = zip.readUInt16LE(p + 30);
    const largoComentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const archivo = zip.toString('utf8', p + 46, p + 46 + largoNombre);
    if (archivo === nombre) {
      const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const datos = zip.subarray(inicio, inicio + comprimido);
      return metodo === 0 ? datos : inflateRawSync(datos);
    }
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  throw new Error(`El ZIP no tiene «${nombre}»`);
}

/** Descarga un recurso (texto o JSON) con caché, límite por servidor y reintentos acotados. */
export async function descargar(url, { json = false, cabeceras = {} } = {}) {
  const texto = await pedir(url, { cabeceras, ...(json ? { validar: (t) => JSON.parse(t) } : {}) });
  return json ? JSON.parse(texto) : texto;
}

/** Primera letra en mayúscula (los nombres de elementos vienen en minúscula en Wikidata). */
export const capitalizar = (t) => (t ? t[0].toLocaleUpperCase('es') + t.slice(1) : t);

/**
 * Limpia los alias de una entidad: sin repetir el nombre ni entre sí (por forma normalizada), sin
 * emojis ni códigos en mayúsculas de hasta cuatro letras (EAU, RPDC, MXN), sin textos larguísimos.
 */
// Alias erróneos que aparecen en varios ítems de Wikidata (vandalismo): nunca son una respuesta válida.
const ALIAS_ERRONEOS = new Set(['ripping', 'educense', 'discotecas flexibles', 'aeropuerto ps 2']);

export function limpiarAlias(nombre, alias, { siglas = false } = {}) {
  const vistos = new Set([normalizar(nombre)]);
  const limpios = [];
  for (const a of alias) {
    const t = String(a ?? '').trim().replace(/\s+/g, ' ');
    const n = normalizar(t);
    if (!n || vistos.has(n) || t.length > 60 || ALIAS_ERRONEOS.has(n)) continue;
    // Las siglas de hasta cuatro letras suelen ser códigos (EAU, MXN); con `siglas`, valen (USB, HDMI).
    if (/\p{Extended_Pictographic}/u.test(t) || (!siglas && /^[A-Z.]{1,4}$/.test(t.replace(/\s/g, '')))) continue;
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
export function armarCatalogo(def, { entidades, fuentes, correcciones = [], verificacion = [], sinVerificar = [], fuenteEntidades = null, temas = null, cobertura = null, atributos: esquemaAtributos = null, hoy }) {
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
    cobertura: { ...def.cobertura, ...(cobertura ?? {}), verificacion, ...(sinVerificar.length ? { sinVerificarManualmente: sinVerificar } : {}) },
    atributos: esquemaAtributos ?? def.atributos,
    ...(temas ? { temas } : {}),
    ...(fuenteEntidades ? { fuenteEntidades } : {}),
    correcciones,
    entidades: ordenadas,
  };
}
