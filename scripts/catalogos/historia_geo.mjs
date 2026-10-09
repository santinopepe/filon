// Catálogos de historia y geografía: presidentes argentinos (anexo de Wikipedia, con el tipo de cada
// mandato), parques nacionales (Sistema Nacional de Áreas Protegidas) y ciudades (GeoNames). Solo se
// ejecuta al importar.
import { sparql, etiquetas, qid, urlEntidad } from './wikidata.mjs';
import { descargar, descargarBinario, extraerDeZip, limpiarAlias, sha } from './comun.mjs';
import { normalizar } from '../../servidor/normalizar.js';
import { WIKIDATA, POPULARIDAD_WIKIPEDIA, exigir, wikitexto, plano, enLotes, leerCsv } from './ayudas.mjs';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Fecha ISO de una celda: {{Fecha|d|m|aaaa}} o «5 de marzo de 1854». */
function fechaDeCelda(celda) {
  const c = celda.replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '');
  let m = c.match(/\{\{Fecha\|(\d+)\|(\d+)\|(\d{4})\}\}/i);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = c.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (m && MESES.includes(m[2].toLowerCase())) return `${m[3]}-${String(MESES.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const sinAtributos = (celda) => celda.replace(/^\s*(?:(?:rowspan|colspan|style|class|align|bgcolor|width|scope)\s*=\s*("[^"]*"|\S+)\s*)+\|/, '');

/** Ítem de Wikidata de cada página de Wikipedia (siguiendo redirecciones). */
async function itemsDePaginas(titulos, idioma = 'es') {
  const item = new Map();
  for (const lote of enLotes([...new Set(titulos)], 50)) {
    const d = await descargar(`https://${idioma}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: lote.join('|'), format: 'json', formatversion: '2' })}`, { json: true });
    const destino = new Map(lote.map((t) => [t, t]));
    for (const x of [...(d.query.normalized ?? []), ...(d.query.redirects ?? [])]) for (const [t, v] of destino) if (v === x.from) destino.set(t, x.to);
    const porTitulo = new Map(d.query.pages.map((p) => [p.title, p.pageprops?.wikibase_item]));
    for (const [t, v] of destino) if (porTitulo.get(v)) item.set(t, porTitulo.get(v));
  }
  return item;
}

// ───────────────────────── Presidentes argentinos ─────────────────────────

const ANEXO_PRESIDENTES = 'Anexo:Presidentes de la Nación Argentina';
// Tipo de cada mandato, según cómo llegó al cargo: con elecciones presidenciales (la fila trae el enlace a
// la elección), de facto (el anexo lo marca) o por sucesión o designación (vicepresidentes que completaron
// un mandato, presidentes provisionales del Senado, elegidos por la Asamblea Legislativa y gobiernos
// provisionales).
const TIPOS_MANDATO = { electo: 'electo en elecciones', defacto: 'de facto', sucesion: 'por sucesión o designación' };

const presidentesArgentinos = {
  id: 'presidentes_argentinos',
  nombre: 'Presidentes de la Nación Argentina',
  descripcion: 'Quienes fueron presidentes de la Argentina (incluidos los de facto), con cada mandato, su fecha y cómo llegaron al cargo.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: {
    tipo: 'completa',
    criterio: 'Todas las personas de la tabla «Presidentes de la Nación Argentina» del anexo de Wikipedia en español (incluye a los presidentes de facto). No incluye a quienes ejercieron el Poder Ejecutivo sin el título de presidente (Luder, Puerta, Camaño, Liendo, Lacoste, Saint-Jean, Pinedo).',
  },
  atributos: {
    tipos: { tipo: 'lista', etiqueta: 'cómo llegó al cargo' },
    inicios: { tipo: 'lista_numeros', etiqueta: 'año en que asumió' },
    iniciosElecto: { tipo: 'lista_numeros', etiqueta: 'año en que asumió tras ser elegido' },
    iniciosDeFacto: { tipo: 'lista_numeros', etiqueta: 'año en que asumió de facto' },
    mandatos: { tipo: 'lista', etiqueta: 'mandato' },
  },
  async importar({ hoy }) {
    const verificacion = [];
    const { texto, revision, url } = await wikitexto(ANEXO_PRESIDENTES);
    const tabla = texto.slice(texto.indexOf('{| class="wikitable"'), texto.indexOf('\n|}', texto.indexOf('{| class="wikitable"')));
    const mandatos = [];
    let actual = null;
    for (const fila of tabla.split(/\n\|-[^\n]*\n/)) {
      const celdas = fila.split('\n').filter((l) => /^\|[^-}]/.test(l)).map((l) => sinAtributos(l.slice(1)));
      // La celda del presidente trae su nombre y sus años de vida («(1895-1974)» o «(n. 1931)»); la de
      // un vicepresidente, su período entre <small><small>.
      const celdaNombre = celdas.find((c) => /^\s*\[\[[^\]]+\]\][\s\S]*<small>\((?:n\. )?\d{4}/.test(c));
      if (celdaNombre) {
        const m = celdaNombre.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
        actual = { titulo: m[1].trim(), nombre: (m[2] ?? m[1]).trim(), defacto: /de facto/i.test(celdaNombre) };
      }
      if (!actual) continue;
      const fechas = celdas.filter((c) => !/<small><small>/.test(c) && !/Edad en/.test(c)).map(fechaDeCelda).filter(Boolean);
      if (!fechas.length) continue;
      const electo = /\[\[Elecciones presidenciales de Argentina/.test(fila);
      const tipo = actual.defacto ? 'defacto' : electo ? 'electo' : 'sucesion';
      const previo = mandatos.at(-1);
      // Una fila que solo cambia al vicepresidente (sin elección nueva) continúa el mandato anterior.
      if (previo && previo.titulo === actual.titulo && previo.fin === fechas[0] && !electo && previo.tipo === 'electo') previo.fin = fechas[1] ?? null;
      else mandatos.push({ ...actual, tipo, inicio: fechas[0], fin: fechas[1] ?? null });
    }
    const personas = [...new Set(mandatos.map((m) => m.titulo))];
    const item = await itemsDePaginas(personas);
    const sinItem = personas.filter((p) => !item.has(p));
    exigir(!sinItem.length, `cada presidente tiene su ítem en Wikidata (sin ítem: ${sinItem.join(', ') || 'ninguno'})`, verificacion);
    const et = await etiquetas([...item.values()]);
    const anio = (f) => Number(f.slice(0, 4));
    const entidades = personas.map((titulo) => {
      const q = item.get(titulo);
      const e = et.get(q);
      const propios = mandatos.filter((m) => m.titulo === titulo);
      const nombre = propios[0].nombre;
      return {
        id: q,
        nombre,
        alias: limpiarAlias(nombre, [e.es, ...e.alias].filter(Boolean)),
        popularidad: e.enlaces,
        atributos: {
          tipos: [...new Set(propios.map((m) => TIPOS_MANDATO[m.tipo]))].sort(),
          inicios: [...new Set(propios.map((m) => anio(m.inicio)))],
          iniciosElecto: [...new Set(propios.filter((m) => m.tipo === 'electo').map((m) => anio(m.inicio)))],
          iniciosDeFacto: [...new Set(propios.filter((m) => m.tipo === 'defacto').map((m) => anio(m.inicio)))],
          mandatos: propios.map((m) => `${m.inicio} a ${m.fin ?? 'hoy'} (${TIPOS_MANDATO[m.tipo]})`),
        },
        fuente: urlEntidad(q),
      };
    });
    const deFacto = entidades.filter((e) => e.atributos.tipos.includes('de facto'));
    exigir(deFacto.length === 12, `${deFacto.length} presidentes de facto (el anexo declara 12)`, verificacion);
    exigir(entidades.length >= 50, `${entidades.length} personas en la tabla (el texto del anexo cuenta 50 «que gobernaron sobre el total del territorio»)`, verificacion);
    const tipoDe = (n) => entidades.find((e) => e.nombre === n)?.atributos.tipos ?? [];
    exigir(tipoDe('Carlos Pellegrini').includes('por sucesión o designación') && tipoDe('Eduardo Duhalde').includes('por sucesión o designación') && tipoDe('Raúl Alfonsín').includes('electo en elecciones'), 'Pellegrini y Duhalde llegaron por sucesión o designación; Alfonsín, por elecciones', verificacion);
    exigir(entidades.find((e) => e.nombre === 'Juan Domingo Perón')?.atributos.inicios.join(',') === '1946,1952,1973', 'Perón asumió en 1946, 1952 y 1973', verificacion);
    exigir(mandatos.at(-1).fin === null, `el último mandato sigue en curso (${mandatos.at(-1).nombre}, desde ${mandatos.at(-1).inicio})`, verificacion);
    return {
      entidades,
      verificacion,
      sinVerificar: [`mandato en curso al ${hoy}: ${mandatos.at(-1).nombre}`],
      fuentes: [{ nombre: `Wikipedia en español, «${ANEXO_PRESIDENTES}» (revisión ${revision})`, url, licencia: 'CC BY-SA 4.0', detalle: 'presidentes, fechas de cada mandato y tipo (de facto, electo, sucesión)' }, { ...WIKIDATA, detalle: 'alias y popularidad' }],
      hoy,
    };
  },
};

// ───────────────────────── Parques nacionales ─────────────────────────

const ARTICULO_SNAP = 'Sistema Nacional de Áreas Protegidas (Argentina)';
// Regiones de la Administración de Parques Nacionales por provincia (las del dataset «Áreas protegidas
// nacionales» del Ministerio de Ambiente; se verifican contra él).
// (Con su preposición, para que el enunciado diga «del noroeste (NOA)» o «de la Patagonia».)
const NOA = 'del noroeste (NOA)';
const NEA = 'del noreste (NEA)';
const CENTRO = 'del centro';
const CENTRO_ESTE = 'del centro-este';
const PATAGONIA = 'de la Patagonia';
const REGION_APN = {
  Jujuy: NOA, Salta: NOA, Tucumán: NOA, Catamarca: NOA, 'Santiago del Estero': NOA,
  Misiones: NEA, Corrientes: NEA, Chaco: NEA, Formosa: NEA,
  Córdoba: CENTRO, 'San Luis': CENTRO, 'San Juan': CENTRO, 'La Rioja': CENTRO, Mendoza: CENTRO,
  'Buenos Aires': CENTRO_ESTE, 'Entre Ríos': CENTRO_ESTE, 'Santa Fe': CENTRO_ESTE,
  Neuquén: PATAGONIA, 'Río Negro': PATAGONIA, Chubut: PATAGONIA, 'La Pampa': PATAGONIA, 'Santa Cruz': PATAGONIA, 'Tierra del Fuego': PATAGONIA,
};
const REGION_CIAM = { Noa: NOA, Nea: NEA, Centro: CENTRO, 'Centro este': CENTRO_ESTE, 'Patagonia norte': PATAGONIA, 'Patagonia austral': PATAGONIA };
const CIAM = 'https://ciam.ambiente.gob.ar/dt_csv.php?dt_id=460';
const INTERNACIONALES = [['patrimonio mundial', /patrimonio (mundial|de la humanidad)/i], ['sitio Ramsar', /ramsar/i], ['reserva de biosfera', /reserva de (la )?bi[oó]sfera/i]];

const parquesNacionales = {
  id: 'parques_nacionales_argentinos',
  nombre: 'Parques nacionales de la Argentina',
  descripcion: 'Los parques nacionales de la Argentina, con sus provincias, su región, el año de la norma que los declaró parque nacional y sus designaciones internacionales.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Todas las áreas de categoría «parque nacional» de la tabla «Parques nacionales» del artículo «Sistema Nacional de Áreas Protegidas (Argentina)» de Wikipedia en español, contrastada con el dataset oficial de áreas protegidas nacionales.' },
  atributos: {
    categoria: { tipo: 'texto', etiqueta: 'categoría de protección' },
    provincias: { tipo: 'lista', etiqueta: 'provincia' },
    regiones: { tipo: 'lista', etiqueta: 'región' },
    anio: { tipo: 'numero', etiqueta: 'año de su declaración como parque nacional' },
    internacionales: { tipo: 'lista', etiqueta: 'designación internacional' },
  },
  depende: ['provincias_argentinas'],
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const correcciones = [];
    const { texto, revision, url } = await wikitexto(ARTICULO_SNAP);
    const desde = texto.indexOf('=== Parques nacionales y reservas nacionales contiguas ===');
    const tabla = texto.slice(texto.indexOf('{|', desde), texto.indexOf('\n|}', desde));
    const provincias = catalogos.provincias_argentinas.entidades.map((p) => p.nombre);
    const filas = [];
    for (const fila of tabla.split(/\n\|-[^\n]*\n/).slice(1)) {
      const celdas = fila.replace(/^\|/, '').split('||').map((c) => sinAtributos(c));
      if (celdas.length < 7) continue;
      const enlace = celdas[1].match(/\[\[([^\]|]*[Pp]arque nacional[^\]|]*)(?:\|[^\]]*)?\]\]/);
      if (!enlace) continue;
      const corto = enlace[1].trim().replace(/^[Pp]arque nacional\s+/, '').replace(/\s*\([^)]*\)$/, '');
      // Año: el de la norma que lo declaró parque nacional con su nombre actual («Como parque nacional
      // Los Arrayanes: ley 19292 de 1971»), no el de una categoría anterior (reserva nacional, parte de
      // otro parque). Si hay una sola norma, la de la celda. Con sanción y promulgación, la sanción.
      const norma = celdas[2].replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '');
      const vinetas = norma.split(/<br\s*\/?>|\n/).filter((v) => /Como\s*'*\s*parque nacional/i.test(v));
      const elegida = vinetas.find((v) => normalizar(v).includes(normalizar(corto))) ?? vinetas.at(-1) ?? norma;
      const anio = Number(elegida.match(/'''(1[89]\d\d|20\d\d)'''/)?.[1]) || null;
      // Provincias: solo los enlaces en negrita («'''[[Provincia de Río Negro|Río Negro]]'''»); el texto
      // puede nombrar otros lugares («departamento Lago Buenos Aires»).
      const enNegrita = [...celdas[3].matchAll(/'''\s*\[\[(?:[^\]|]*\|)?([^\]]+)\]\]\s*'''/g)].map((m) => m[1].trim());
      const deLaFila = provincias.filter((p) => enNegrita.includes(p));
      const internacional = plano(celdas[6]);
      filas.push({ titulo: enlace[1].trim(), corto, anio, provincias: deLaFila, internacionales: INTERNACIONALES.filter(([, re]) => re.test(internacional)).map(([n]) => n) });
    }
    exigir(filas.length === 39, `${filas.length} parques nacionales en la tabla (el anexo de parques nacionales declara 39)`, verificacion);
    exigir(filas.every((f) => f.provincias.length && f.anio), 'todos tienen provincia y año de creación', verificacion);
    const item = await itemsDePaginas(filas.map((f) => f.titulo));
    // Respaldo: un parque sin artículo enlazado se busca por su nombre en Wikidata.
    for (const f of filas.filter((x) => !item.has(x.titulo))) {
      const r = await sparql(`SELECT ?i ?s WHERE { VALUES ?l { "${f.titulo}"@es "${f.titulo.replace(/^[Pp]arque nacional/, 'Parque Nacional')}"@es } ?i rdfs:label ?l ; wikibase:sitelinks ?s } ORDER BY DESC(?s) LIMIT 1`);
      if (r[0]) {
        item.set(f.titulo, qid(r[0].i));
        verificacion.push(`${f.titulo}: sin artículo enlazado; ítem por nombre ${qid(r[0].i)}`);
      }
    }
    const sinItem = filas.filter((f) => !item.has(f.titulo)).map((f) => f.titulo);
    verificacion.push(`sin ítem en Wikidata (popularidad 0, fuente: la tabla): ${sinItem.join(', ') || 'ninguno'}`);
    const et = await etiquetas([...item.values()]);
    // Contraste con el dataset oficial del Ministerio de Ambiente (región de cada parque).
    const oficial = leerCsv(await descargar(CIAM), ';');
    const regionOficial = new Map(oficial.filter((o) => /^Parque Nacional /.test(o['área_protegida'])).map((o) => [normalizar(o['área_protegida'].replace(/^Parque Nacional /, '')), REGION_CIAM[o['región']]]));
    const entidades = filas.map((f) => {
      const q = item.get(f.titulo);
      const e = q ? et.get(q) : { es: null, alias: [], enlaces: 0 };
      const { corto } = f;
      const regiones = [...new Set(f.provincias.map((p) => REGION_APN[p]))].sort();
      const enOficial = regionOficial.get(normalizar(corto));
      if (enOficial && !regiones.includes(enOficial)) throw new Error(`Verificación fallida: ${corto} es de ${regiones.join(', ')} por provincia y de ${enOficial} en el dataset oficial`);
      return {
        id: q ?? `snap:${normalizar(corto).replace(/ /g, '-')}`,
        nombre: corto,
        alias: limpiarAlias(corto, [`Parque Nacional ${corto}`, e.es, ...e.alias].filter(Boolean)),
        popularidad: e.enlaces,
        atributos: { categoria: 'parque nacional', provincias: f.provincias.sort(), regiones, anio: f.anio, internacionales: f.internacionales },
        fuente: q ? urlEntidad(q) : url,
      };
    });
    const faltanEnOficial = entidades.filter((e) => !regionOficial.has(normalizar(e.nombre))).map((e) => e.nombre);
    verificacion.push(`la región coincide con el dataset oficial en los ${entidades.length - faltanEnOficial.length} parques que figuran en él (no figuran: ${faltanEnOficial.join(', ') || 'ninguno'})`);
    const de = (n) => entidades.find((e) => e.nombre === n);
    exigir(de('Iguazú')?.atributos.internacionales.includes('patrimonio mundial') && de('Nahuel Huapi')?.atributos.provincias.join() === 'Neuquén,Río Negro', 'Iguazú es patrimonio mundial y Nahuel Huapi está en Neuquén y Río Negro', verificacion);
    exigir(de('Nahuel Huapi')?.atributos.anio === 1934 && de('Los Arrayanes')?.atributos.anio === 1971 && de('Los Glaciares')?.atributos.anio === 1945 && de('Patagonia')?.atributos.provincias.join() === 'Santa Cruz', 'años como parque nacional: Nahuel Huapi 1934, Los Arrayanes 1971, Los Glaciares 1945; Patagonia está solo en Santa Cruz', verificacion);
    return {
      entidades,
      correcciones,
      verificacion,
      fuentes: [
        { nombre: `Wikipedia en español, «${ARTICULO_SNAP}» (revisión ${revision})`, url, licencia: 'CC BY-SA 4.0', detalle: 'parques, norma de creación, provincias y categorías internacionales' },
        { nombre: 'Ministerio de Ambiente, «Áreas protegidas nacionales» (datos.gob.ar)', url: CIAM, licencia: 'CC BY 4.0', detalle: 'región de la APN (contraste)' },
        { ...WIKIDATA, detalle: 'alias y popularidad' },
      ],
      hoy,
    };
  },
};

// ───────────────────────── Ciudades ─────────────────────────

const GEONAMES_CIUDADES = 'https://download.geonames.org/export/dump/cities15000.zip';
const UMBRAL_MUNDO = 1_000_000;
const UMBRAL_ARGENTINA = 100_000;
const TAMANOS = { millon: '1.000.000 o más', cienMil: '100.000 o más' };

const ciudades = {
  id: 'ciudades',
  nombre: 'Ciudades',
  descripcion: `Ciudades del mundo con ${UMBRAL_MUNDO.toLocaleString('es-AR')} habitantes o más y ciudades argentinas con ${UMBRAL_ARGENTINA.toLocaleString('es-AR')} o más, según GeoNames.`,
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: {
    tipo: 'parcial',
    completoPor: { tamano: [TAMANOS.millon], paises: ['Argentina'] },
    criterio: `Las localidades pobladas de GeoNames (cities15000) con ${UMBRAL_MUNDO.toLocaleString('es-AR')} habitantes o más en todo el mundo y, en la Argentina, con ${UMBRAL_ARGENTINA.toLocaleString('es-AR')} o más. La población es la que registra GeoNames a la fecha de la descarga (no siempre del mismo año ni con el mismo criterio de ciudad o aglomerado).`,
  },
  atributos: {
    paises: { tipo: 'lista', etiqueta: 'país' },
    continente: { tipo: 'texto', etiqueta: 'continente' },
    subregion: { tipo: 'texto', etiqueta: 'región' },
    subdivision: { tipo: 'texto', etiqueta: 'subdivisión' },
    poblacion: { tipo: 'numero', etiqueta: 'población' },
    tamano: { tipo: 'lista', etiqueta: 'tamaño' },
    fechaPoblacion: { tipo: 'texto', etiqueta: 'fecha de la cifra de población' },
  },
  depende: ['paises'],
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const zip = await descargarBinario(GEONAMES_CIUDADES);
    const texto = extraerDeZip(zip, 'cities15000.txt').toString('utf8');
    const admin1 = new Map(
      (await descargar('https://download.geonames.org/export/dump/admin1CodesASCII.txt'))
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t'))
        .map(([codigo, nombre]) => [codigo, nombre]),
    );
    const porIso = new Map(catalogos.paises.entidades.map((p) => [p.atributos.iso, p]));
    const elegidas = [];
    for (const linea of texto.split('\n')) {
      if (!linea) continue;
      const c = linea.split('\t');
      const [geonameid, nombre, , , , , clase, codigo, iso, , a1, , , , poblacion, , , , modificada] = c;
      const n = Number(poblacion);
      if (clase !== 'P' || codigo === 'PPLX' || codigo === 'PPLH' || !porIso.has(iso)) continue;
      if (n >= UMBRAL_MUNDO || (iso === 'AR' && n >= UMBRAL_ARGENTINA)) elegidas.push({ geonameid, nombre, iso, a1, poblacion: n, modificada });
    }
    // Nombres en español: el ítem de Wikidata con el mismo id de GeoNames (P1566).
    const item = new Map();
    for (const lote of enLotes(elegidas.map((e) => e.geonameid), 200)) {
      // Si varios ítems tienen el mismo id («Madrid» y «Ciudad de Madrid»), el de más artículos.
      const mejor = new Map();
      for (const f of await sparql(`SELECT ?g ?i ?s WHERE { VALUES ?g { ${lote.map((g) => `"${g}"`).join(' ')} } ?i wdt:P1566 ?g ; wikibase:sitelinks ?s }`)) {
        if (!mejor.has(f.g) || Number(f.s) > mejor.get(f.g).s) mejor.set(f.g, { q: qid(f.i), s: Number(f.s) });
      }
      for (const [g, { q }] of mejor) item.set(g, q);
    }
    const et = await etiquetas([...new Set(item.values())]);
    const sinItem = [];
    const entidades = elegidas.map((c) => {
      const q = item.get(c.geonameid);
      const e = q ? et.get(q) : null;
      if (!e?.es) sinItem.push(c.nombre);
      // «Ciudad de Madrid» → «Madrid» (el nombre completo queda como alias).
      const nombre = (e?.es ?? c.nombre).replace(/^(Ciudad|Municipio) de (?=\p{Lu})/u, '');
      const pais = porIso.get(c.iso);
      return {
        id: `geonames:${c.geonameid}`,
        nombre,
        alias: limpiarAlias(nombre, [c.nombre, e?.es, ...(e?.alias ?? [])].filter(Boolean)),
        popularidad: e?.enlaces ?? 0,
        atributos: {
          paises: [pais.nombre],
          continente: pais.atributos.continente,
          subregion: pais.atributos.subregion,
          subdivision: admin1.get(`${c.iso}.${c.a1}`) ?? null,
          poblacion: c.poblacion,
          tamano: [c.poblacion >= UMBRAL_MUNDO ? TAMANOS.millon : null, c.poblacion >= UMBRAL_ARGENTINA ? TAMANOS.cienMil : null].filter(Boolean),
          fechaPoblacion: c.modificada,
        },
        fuente: q ? urlEntidad(q) : `https://www.geonames.org/${c.geonameid}`,
      };
    });
    verificacion.push(`${entidades.filter((e) => e.atributos.tamano.includes(TAMANOS.millon)).length} ciudades de 1.000.000 o más y ${entidades.filter((e) => e.atributos.paises[0] === 'Argentina').length} argentinas de 100.000 o más (GeoNames, descarga del ${hoy})`);
    verificacion.push(`${sinItem.length} sin nombre en español en Wikidata (queda el de GeoNames): ${sinItem.slice(0, 15).join(', ')}${sinItem.length > 15 ? '…' : ''}`);
    const argentinas = entidades.filter((e) => e.atributos.paises[0] === 'Argentina').map((e) => e.nombre);
    exigir(['Córdoba', 'Rosario', 'Mar del Plata', 'La Plata'].every((n) => argentinas.includes(n)), 'están Córdoba, Rosario, Mar del Plata y La Plata', verificacion);
    const faltan = ['Tokio', 'São Paulo', 'Madrid', 'Londres'].filter((n) => !entidades.some((e) => e.nombre === n));
    exigir(!faltan.length, `están Tokio, São Paulo, Madrid y Londres (faltan: ${faltan.join(', ') || 'ninguna'})`, verificacion);
    return {
      entidades,
      verificacion,
      sinVerificar: ['La población de GeoNames mezcla cifras de distintos años y, en algunas ciudades, del aglomerado: las preguntas dicen «según GeoNames».'],
      fuentes: [
        { nombre: 'GeoNames, cities15000', url: 'https://www.geonames.org', licencia: 'CC BY 4.0', detalle: `ciudades, país, subdivisión y población (descarga ${hoy}, huella ${sha(texto).slice(0, 12)})` },
        { ...WIKIDATA, detalle: 'nombres en español, alias y popularidad (P1566)' },
      ],
      hoy,
    };
  },
};

export const HISTORIA_GEO = [presidentesArgentinos, parquesNacionales, ciudades];
