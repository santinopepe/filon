// Catálogos de informática: propiedades de CSS (MDN), lenguajes de programación, formatos de archivo y
// sistemas operativos (Wikidata), y tipos de periféricos, componentes y conectores (clases de Wikidata con
// exclusiones explícitas). Solo se ejecuta al importar.
import { sparql, etiquetas, propiedad, qid, anio, urlEntidad } from './wikidata.mjs';
import { descargar, limpiarAlias } from './comun.mjs';
import { normalizar } from '../../servidor/normalizar.js';
import { WIKIDATA, POPULARIDAD_WIKIPEDIA, exigir, nombresRepetidos, wikitexto, plano, enLotes } from './ayudas.mjs';

/** Nombre desde Wikidata: la etiqueta en español (o «mul»); si no hay, la inglesa, y se registra. */
function nombreConRespaldo(e, correcciones) {
  const nombre = e.es ?? e.en;
  if (!nombre) return null;
  if (!e.es) correcciones.push({ entidad: e.id, detalle: `nombre «${e.en}» (etiqueta en inglés)`, motivo: 'Wikidata no tiene etiqueta en español.' });
  return { nombre, alias: limpiarAlias(nombre, [...e.alias, e.en].filter(Boolean)) };
}

/** Ítems que son instancia de la clase (o de una subclase), con al menos `minimo` artículos de Wikipedia. */
async function instanciasDe(clase, minimo, extra = '') {
  const filas = await sparql(`SELECT DISTINCT ?i WHERE { ?i wdt:P31/wdt:P279* wd:${clase} ; wikibase:sitelinks ?s . FILTER(?s >= ${minimo}) ${extra} }`);
  return [...new Set(filas.map((f) => qid(f.i)))].sort();
}

// ───────────────────────── Propiedades de CSS ─────────────────────────

const MDN_DATA = 'mdn-data';
const BCD = '@mdn/browser-compat-data';
// Nombre en español de cada módulo de la especificación (traducción editorial del nombre del grupo de MDN).
const MODULOS_CSS = {
  'CSS Backgrounds and Borders': 'fondos y bordes', 'CSS Logical Properties and Values': 'propiedades lógicas', 'Scalable Vector Graphics': 'SVG',
  'CSS Scroll Snap': 'scroll snap', 'CSS Fonts': 'fuentes', 'CSS Text': 'texto', 'CSS Animations': 'animaciones', 'CSS Basic User Interface': 'interfaz de usuario',
  'CSS Masking': 'máscaras y recortes', 'CSS Box Sizing': 'tamaño de cajas', 'CSS Positioned Layout': 'posicionamiento', 'CSS Grid Layout': 'Grid',
  'CSS Text Decoration': 'decoración de texto', 'CSS Overflow': 'desbordamiento', 'CSS Box Alignment': 'alineación de cajas', 'CSS Flexible Box Layout': 'Flexbox',
  'CSS Multi-column Layout': 'columnas múltiples', 'CSS Inline': 'diseño en línea', 'CSS Transforms': 'transformaciones', 'CSS Box Model': 'modelo de caja',
  'CSS Anchor Positioning': 'posicionamiento con anclas', 'CSS Lists and Counters': 'listas y contadores', 'Filter Effects': 'filtros', 'CSS Fragmentation': 'fragmentación',
  'CSS Color': 'color', 'Motion Path': 'trayectorias de movimiento', 'CSS Transitions': 'transiciones', 'CSS Table': 'tablas', 'CSS Writing Modes': 'modos de escritura',
  'CSS Display': 'display', 'CSS Overscroll Behavior': 'sobredesplazamiento', 'CSS Images': 'imágenes', 'Compositing and Blending': 'composición y mezcla',
  'CSS Conditional Rules': 'reglas condicionales', 'MathML': 'MathML', 'CSS Ruby': 'ruby', 'CSS Shapes': 'formas', 'CSS View Transitions': 'transiciones de vista',
  'CSS Containment': 'contención', 'CSS Generated Content': 'contenido generado', 'CSS Scrollbars Styling': 'barras de desplazamiento',
  'CSS Cascading and Inheritance': 'cascada y herencia', 'CSS Scroll Anchoring': 'anclaje de desplazamiento', 'CSS Paged Media': 'medios paginados',
  'Pointer Events': 'eventos de puntero', 'CSS Will Change': 'will-change', 'CSS Viewport': 'viewport',
};

/** Año de la primera versión de un navegador principal que soportó la propiedad (BCD), o null. */
function primerSoporte(compat, versiones) {
  const anios = [];
  for (const [navegador, datos] of Object.entries(compat?.support ?? {})) {
    if (!['chrome', 'firefox', 'safari', 'edge'].includes(navegador)) continue;
    for (const d of [datos].flat()) {
      if (typeof d?.version_added !== 'string' || d.prefix || d.alternative_name || d.flags) continue;
      const fecha = versiones[navegador]?.[d.version_added.replace(/^≤/, '')]?.release_date;
      if (fecha) anios.push(Number(fecha.slice(0, 4)));
    }
  }
  return anios.length ? Math.min(...anios) : null;
}

const propiedadesCss = {
  id: 'propiedades_css',
  nombre: 'Propiedades de CSS',
  descripcion: 'Las propiedades estándar de CSS (sin prefijos ni obsoletas), con el módulo de la especificación al que pertenecen.',
  popularidad: { criterio: 'Antigüedad del soporte: año de la primera versión de Chrome, Firefox, Safari o Edge que la soportó sin prefijo (MDN browser-compat-data); más antigua, más conocida.', nota: 'Es una aproximación reproducible, no una estadística de uso.' },
  cobertura: { tipo: 'completa', criterio: 'Todas las propiedades con estado «standard» en mdn-data (sin prefijos de proveedor ni propiedades obsoletas o experimentales).' },
  atributos: { modulos: { tipo: 'lista', etiqueta: 'módulo de CSS' }, soporte: { tipo: 'numero', etiqueta: 'año del primer soporte' } },
  async importar({ hoy }) {
    const verificacion = [];
    const version = (await descargar(`https://registry.npmjs.org/${MDN_DATA}/latest`, { json: true })).version;
    const versionBcd = (await descargar(`https://registry.npmjs.org/${BCD}/latest`, { json: true })).version;
    const propiedades = await descargar(`https://cdn.jsdelivr.net/npm/${MDN_DATA}@${version}/css/properties.json`, { json: true });
    const bcd = await descargar(`https://cdn.jsdelivr.net/npm/${BCD}@${versionBcd}/data.json`, { json: true });
    const versiones = Object.fromEntries(Object.entries(bcd.browsers).map(([n, b]) => [n, b.releases]));
    const estandar = Object.entries(propiedades).filter(([nombre, p]) => p.status === 'standard' && !nombre.startsWith('-'));
    const sinModulo = estandar.filter(([, p]) => !p.groups?.length || p.groups.some((g) => !MODULOS_CSS[g])).map(([n]) => n);
    exigir(!sinModulo.length, `todas tienen módulo con nombre en español (sin traducir: ${sinModulo.join(', ') || 'ninguna'})`, verificacion);
    const entidades = estandar.map(([nombre, p]) => {
      const soporte = primerSoporte(bcd.css.properties[nombre]?.__compat, versiones);
      return {
        id: nombre,
        nombre,
        alias: [],
        popularidad: soporte ? 2030 - soporte : 0,
        atributos: { modulos: [...new Set(p.groups.map((g) => MODULOS_CSS[g]))].sort(), soporte },
        fuente: p.mdn_url ?? `https://developer.mozilla.org/docs/Web/CSS/${nombre}`,
      };
    });
    exigir(entidades.length >= 400, `${entidades.length} propiedades estándar (mdn-data ${version})`, verificacion);
    const flex = entidades.filter((e) => e.atributos.modulos.includes('Flexbox')).map((e) => e.nombre);
    exigir(['flex-direction', 'flex-wrap', 'justify-content'].every((n) => flex.includes(n)), 'Flexbox incluye flex-direction, flex-wrap y justify-content', verificacion);
    exigir(['color', 'display', 'margin', 'padding', 'font-size'].every((n) => entidades.some((e) => e.nombre === n)), 'están color, display, margin, padding y font-size', verificacion);
    verificacion.push(`${entidades.filter((e) => e.atributos.soporte === null).length} sin año de soporte en BCD ${versionBcd} (popularidad 0; el año no se usa como filtro)`);
    return {
      entidades,
      verificacion,
      fuentes: [
        { nombre: `MDN mdn-data ${version}`, url: 'https://github.com/mdn/data', licencia: 'CC0 1.0', detalle: 'propiedades, estado y módulo (groups)' },
        { nombre: `MDN browser-compat-data ${versionBcd}`, url: 'https://github.com/mdn/browser-compat-data', licencia: 'CC0 1.0', detalle: 'primera versión con soporte (popularidad)' },
      ],
      hoy,
    };
  },
};

// ───────────────────────── Lenguajes de programación ─────────────────────────

const MIN_LENGUAJES = 15;
const lenguajesProgramacion = {
  id: 'lenguajes_programacion',
  nombre: 'Lenguajes de programación',
  descripcion: `Lenguajes de programación con artículo en al menos ${MIN_LENGUAJES} ediciones de Wikipedia.`,
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: `Todos los ítems de Wikidata que son instancia de «lenguaje de programación» (Q9143, o una subclase) con artículo en al menos ${MIN_LENGUAJES} ediciones de Wikipedia, salvo los lenguajes de marcado y de hojas de estilo (XML, CSS, TeX).` },
  atributos: { anio: { tipo: 'numero', etiqueta: 'año de la primera versión' }, paradigmas: { tipo: 'lista', etiqueta: 'paradigma' } },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    // Sin lenguajes de marcado ni de hojas de estilo (XML, CSS, TeX), que Wikidata también cuelga de Q9143.
    const ids = await instanciasDe('Q9143', MIN_LENGUAJES, 'FILTER NOT EXISTS { VALUES ?marcado { wd:Q37045 wd:Q1029123 } ?i wdt:P31/wdt:P279* ?marcado }');
    const [et, fechas, paradigmas, inicio] = await Promise.all([etiquetas(ids), propiedad(ids, 'P577'), propiedad(ids, 'P3966'), propiedad(ids, 'P571')]);
    const entidades = ids.map((id) => {
      const e = et.get(id);
      const n = nombreConRespaldo(e, correcciones);
      const anios = [...fechas.get(id), ...inicio.get(id)].map((f) => anio(f.valor)).filter((a) => a && a > 1940);
      const p = [...new Set(paradigmas.get(id).map((x) => x.valor.nombre).filter(Boolean))].sort();
      return { id, ...n, popularidad: e.enlaces, atributos: { anio: anios.length ? Math.min(...anios) : null, paradigmas: p.length ? p : null }, fuente: urlEntidad(id) };
    }).filter((e) => e.nombre);
    exigir(entidades.length === ids.length, `${entidades.length} lenguajes, todos con nombre`, verificacion);
    exigir(['Python', 'JavaScript', 'C', 'Java', 'Rust', 'Haskell', 'COBOL'].every((n) => entidades.some((e) => e.nombre === n)), 'están Python, JavaScript, C, Java, Rust, Haskell y COBOL', verificacion);
    const repetidos = nombresRepetidos(entidades);
    verificacion.push(`${repetidos.length} nombres repetidos (las preguntas que incluyan a los dos se descartan): ${repetidos.join(', ') || 'ninguno'}`);
    verificacion.push(`${entidades.filter((e) => e.atributos.anio === null).length} sin año y ${entidades.filter((e) => e.atributos.paradigmas === null).length} sin paradigma: esos atributos no se usan como filtro`);
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'lenguajes (P31 Q9143), fecha (P571/P577), paradigma (P3966), alias y popularidad' }], hoy };
  },
};

// ───────────────────────── Formatos de archivo ─────────────────────────

const TIPOS_MIME = { image: 'imagen', audio: 'audio', video: 'video' };

/**
 * Formatos de imagen, audio y video: los tipos MIME de mime-db (registro de la IANA más los de Apache y
 * nginx) que tienen extensión. Los tipos que comparten una extensión son el mismo formato (audio/wav,
 * audio/wave y audio/x-wav) y forman una sola entidad, con todas sus extensiones como alias.
 */
const formatosArchivo = {
  id: 'formatos_archivo',
  nombre: 'Formatos de archivo de imagen, audio y video',
  descripcion: 'Formatos con un tipo MIME image/*, audio/* o video/* y extensión de archivo registrada.',
  popularidad: { criterio: 'Mayor cantidad de artículos de Wikipedia (sitelinks de Wikidata) entre los formatos de Wikidata que declaran alguna de sus extensiones (P1195) y los ítems cuya etiqueta es una de sus extensiones («JPEG», «FLAC»); 0 si ninguno.', nota: 'Es una medida de notoriedad, no una estadística de uso.' },
  cobertura: { tipo: 'completa', criterio: 'Todos los tipos MIME image/*, audio/* y video/* de mime-db con al menos una extensión, agrupados por extensión compartida.' },
  atributos: { tipos: { tipo: 'lista', etiqueta: 'tipo de contenido' }, extensiones: { tipo: 'lista', etiqueta: 'extensión' }, mime: { tipo: 'lista', etiqueta: 'tipo MIME' } },
  async importar({ hoy }) {
    const verificacion = [];
    const version = (await descargar('https://registry.npmjs.org/mime-db/latest', { json: true })).version;
    const db = await descargar(`https://cdn.jsdelivr.net/npm/mime-db@${version}/db.json`, { json: true });
    const tipos = Object.entries(db).filter(([m, v]) => TIPOS_MIME[m.split('/')[0]] && v.extensions?.length);
    // Unión de los tipos que comparten extensión.
    const grupoDe = new Map(); // extensión → grupo
    const grupos = [];
    for (const [mime, v] of tipos) {
      const tocados = [...new Set(v.extensions.map((x) => grupoDe.get(x)).filter(Boolean))];
      const g = tocados[0] ?? { mimes: [], extensiones: [] };
      if (!tocados.length) grupos.push(g);
      for (const otro of tocados.slice(1)) {
        g.mimes.push(...otro.mimes);
        g.extensiones.push(...otro.extensiones);
        grupos.splice(grupos.indexOf(otro), 1);
      }
      g.mimes.push(mime);
      g.extensiones.push(...v.extensions);
      for (const x of g.extensiones) grupoDe.set(x, g);
    }
    // Popularidad y nombres desde Wikidata, por extensión declarada (P1195).
    const buscadas = new Set(grupoDe.keys());
    const porExtension = new Map();
    // Sin lenguajes de programación: «TypeScript» también declara la extensión «ts».
    const filas = (await sparql('SELECT ?f ?e ?s WHERE { ?f wdt:P1195 ?e ; wikibase:sitelinks ?s . FILTER NOT EXISTS { ?f wdt:P31/wdt:P279* wd:Q9143 } }')).filter((f) => buscadas.has(String(f.e).toLowerCase().replace(/^\./, '')));
    const et = await etiquetas([...new Set(filas.map((f) => qid(f.f)))]);
    for (const f of filas) {
      const ext = String(f.e).toLowerCase().replace(/^\./, '');
      const previo = porExtension.get(ext);
      const e = et.get(qid(f.f));
      if (!previo || Number(f.s) > previo.enlaces) porExtension.set(ext, { id: qid(f.f), enlaces: Number(f.s), etiquetas: [e.es, e.en].filter(Boolean) });
    }
    // Segundo cruce, por nombre: el ítem cuya etiqueta es la extensión («JPEG», «FLAC», «MIDI»; Wikidata no
    // siempre les carga la extensión).
    const porNombre = new Map();
    const etiquetasBuscadas = [...buscadas].filter((x) => x.length >= 3).map((x) => x.toUpperCase());
    for (let i = 0; i < etiquetasBuscadas.length; i += 80) {
      const valores = etiquetasBuscadas.slice(i, i + 80).flatMap((x) => [`"${x}"@en`, `"${x}"@es`]).join(' ');
      // Clases admitidas: formato de archivo, códec de audio o de video, especificación técnica y el ítem
      // «confusión» con el que Wikidata modela JPEG (estándar y formato a la vez).
      for (const f of await sparql(`SELECT ?f ?l ?s WHERE { VALUES ?l { ${valores} } ?f rdfs:label ?l ; wikibase:sitelinks ?s .
          FILTER EXISTS { VALUES ?clase { wd:Q235557 wd:Q2481505 wd:Q1758683 wd:Q20819677 wd:Q14946528 } ?f wdt:P31/wdt:P279* ?clase } }`)) {
        const ext = String(f.l).toLowerCase();
        porNombre.set(ext, Math.max(porNombre.get(ext) ?? 0, Number(f.s)));
      }
    }
    const enlacesDe = (x) => Math.max(porExtension.get(x)?.enlaces ?? 0, porNombre.get(x) ?? 0);
    const entidades = grupos.map((g) => {
      const extensiones = [...new Set(g.extensiones)];
      // Nombre: la extensión que coincide con el nombre del formato en Wikidata («djvu» para DjVu, «tiff»
      // para TIFF); si no hay, la del formato más conocido; a igual popularidad, la de tres letras y,
      // después, la primera que lista mime-db («mov» antes que «qt»; «jpg» antes que «jpe»).
      const nombres = new Set(extensiones.flatMap((x) => porExtension.get(x)?.etiquetas ?? []).map((t) => normalizar(t).replace(/ /g, '')));
      const orden = extensiones
        .map((x, i) => ({ x, i, enlaces: enlacesDe(x), comoNombre: nombres.has(x) || porNombre.has(x) }))
        .sort((a, b) => b.comoNombre - a.comoNombre || b.enlaces - a.enlaces || (b.x.length === 3) - (a.x.length === 3) || a.i - b.i);
      const nombre = orden[0].x.toUpperCase();
      // Alias: las extensiones y el nombre del formato principal en Wikidata (el más conocido del grupo).
      const wd = extensiones.map((x) => porExtension.get(x)).filter(Boolean).sort((a, b) => b.enlaces - a.enlaces)[0];
      const etiquetasWd = wd?.etiquetas ?? [];
      return {
        id: [...g.mimes].sort()[0],
        nombre,
        alias: limpiarAlias(nombre, [...extensiones.map((x) => x.toUpperCase()), ...etiquetasWd.filter((t) => t.length <= 40)], { siglas: true }),
        popularidad: Math.max(0, ...extensiones.map(enlacesDe)),
        atributos: { tipos: [...new Set(g.mimes.map((m) => TIPOS_MIME[m.split('/')[0]]))].sort(), extensiones: extensiones.sort(), mime: [...g.mimes].sort() },
        fuente: wd ? urlEntidad(wd.id) : `https://www.iana.org/assignments/media-types/${[...g.mimes].sort()[0]}`,
      };
    });
    const nombre = (ext) => entidades.find((e) => e.atributos.extensiones.includes(ext))?.nombre;
    exigir(entidades.find(e=>e.nombre==='JPEG')?.alias.includes('JPG'), 'JPEG acepta JPG como alias de extensión', verificacion);
    exigir(nombre('jpg') === 'JPEG' && nombre('png') === 'PNG' && nombre('gif') === 'GIF', 'imagen: JPEG (con JPG como alias), PNG y GIF', verificacion);
    exigir(nombre('mp3') === 'MP3' && nombre('wav') === 'WAV' && nombre('flac') === 'FLAC', 'audio: MP3, WAV y FLAC', verificacion);
    exigir(nombre('mp4') === 'MP4' && nombre('mov') === 'MOV' && nombre('mkv') === 'MKV', 'video: MP4, MOV y MKV', verificacion);
    exigir(entidades.filter((e) => e.atributos.extensiones.includes('wav')).length === 1, 'audio/wav, audio/wave y audio/x-wav son un solo formato', verificacion);
    for (const t of Object.values(TIPOS_MIME)) verificacion.push(`${entidades.filter((e) => e.atributos.tipos.includes(t)).length} formatos de ${t}`);
    return {
      entidades,
      verificacion,
      fuentes: [
        { nombre: `mime-db ${version}`, url: 'https://github.com/jshttp/mime-db', licencia: 'MIT', detalle: 'tipos MIME (IANA, Apache, nginx) y sus extensiones' },
        { ...WIKIDATA, detalle: 'nombres de los formatos y popularidad (P1195)' },
      ],
      hoy,
    };
  },
};

// ───────────────────────── Sistemas operativos ─────────────────────────

const MIN_SO = 30;
// Familia: la del sistema del que deriva, la serie a la que pertenece o la clase (en Wikidata), o el
// comienzo del nombre («Windows 7», «Mac OS X v10.6»: Wikidata no siempre enlaza las versiones).
// Solo relaciones directas (P144 «basado en», P179 «serie») y la jerarquía de clases: seguir «basado en»
// de forma transitiva mezclaría familias (macOS → NeXTSTEP → BSD…).
const FAMILIAS_SO = [
  ['Android', ['Q94'], /^Android\b/], ['iOS', ['Q48493'], /^(iOS|iPhone OS)\b/i], ['macOS', ['Q14116', 'Q43627'], /^(macOS|Mac OS X|OS X)\b/i],
  ['Windows', ['Q1406', 'Q486487'], /^Windows\b/], ['Linux', ['Q131669', 'Q14579'], null], ['BSD', ['Q34264'], /\bBSD\b/],
];

const sistemasOperativos = {
  id: 'sistemas_operativos',
  nombre: 'Sistemas operativos',
  descripcion: `Sistemas operativos (y versiones con artículo propio) con artículo en al menos ${MIN_SO} ediciones de Wikipedia.`,
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: `Todos los ítems de Wikidata que son instancia de «sistema operativo» (Q9135, o una subclase) con artículo en al menos ${MIN_SO} ediciones de Wikipedia; incluye versiones con artículo propio (Windows 7, Android Lollipop).` },
  atributos: {
    familias: { tipo: 'lista', etiqueta: 'familia' },
    dispositivos: { tipo: 'lista', etiqueta: 'dispositivo' },
    anio: { tipo: 'numero', etiqueta: 'año de publicación' },
  },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    const ids = await instanciasDe('Q9135', MIN_SO);
    const relaciones = await sparql(`SELECT ?i ?o WHERE { VALUES ?i { ${ids.map((i) => `wd:${i}`).join(' ')} } { ?i wdt:P144|wdt:P179 ?o } UNION { ?i wdt:P31/wdt:P279* ?o } }`);
    const relacionados = new Map(ids.map((i) => [i, new Set([i])]));
    for (const f of relaciones) relacionados.get(qid(f.i)).add(qid(f.o));
    const [et, fechas, inicio] = await Promise.all([etiquetas(ids), propiedad(ids, 'P577'), propiedad(ids, 'P571')]);
    const entidades = ids.map((id) => {
      const e = et.get(id);
      const n = nombreConRespaldo(e, correcciones);
      const r = relacionados.get(id);
      // Si el nombre dice la familia («iOS 14», «Windows 7»), es la única; si no, la de sus relaciones.
      const porNombre = FAMILIAS_SO.filter(([, , prefijo]) => prefijo && [e.es, e.en].some((t) => t && prefijo.test(t))).map(([f]) => f);
      const familias = porNombre.length ? porNombre : FAMILIAS_SO.filter(([, qs]) => qs.some((q) => r.has(q))).map(([f]) => f);
      // Dispositivo: celular o tableta si es un sistema operativo móvil (Q920890); si no, computadora.
      const dispositivos = r.has('Q920890') ? ['celulares y tabletas'] : ['computadoras'];
      const anios = [...fechas.get(id), ...inicio.get(id)].map((f) => anio(f.valor)).filter((a) => a && a > 1950);
      return { id, ...n, popularidad: e.enlaces, atributos: { familias, dispositivos, anio: anios.length ? Math.min(...anios) : null }, fuente: urlEntidad(id) };
    }).filter((e) => e.nombre);
    exigir(entidades.length === ids.length, `${entidades.length} sistemas operativos con nombre`, verificacion);
    const de = (f) => entidades.filter((e) => e.atributos.familias.includes(f)).map((e) => e.nombre);
    exigir(['Ubuntu', 'Debian'].every((n) => de('Linux').includes(n)), 'Ubuntu y Debian son de la familia Linux', verificacion);
    exigir(de('Windows').some((n) => /Windows 7/.test(n)), 'Windows 7 es de la familia Windows', verificacion);
    exigir(entidades.find((e) => e.nombre === 'Android')?.atributos.dispositivos.includes('celulares y tabletas'), 'Android es un sistema operativo para celulares y tabletas', verificacion);
    for (const [f] of FAMILIAS_SO) verificacion.push(`${de(f).length} de la familia ${f}`);
    verificacion.push(`${entidades.filter((e) => e.atributos.anio === null).length} sin año: el año no se usa como filtro si falta alguno`);
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'sistemas operativos (P31 Q9135), derivación (P144/P179/P361), fechas (P571/P577), alias y popularidad' }], hoy };
  },
};

// ───────────── Periféricos, componentes y puertos (plantilla «Basic computer components») ─────────────

// La plantilla de navegación de Wikipedia en inglés es una lista cerrada y curada, con grupos: dispositivos
// de entrada, de salida, almacenamiento extraíble, gabinete y puertos (actuales y obsoletos). Se toma tal
// cual (con su revisión) y los nombres en español salen de Wikidata.
const PLANTILLA_HARDWARE = 'Template:Basic computer components';

async function plantillaHardware() {
  const { texto, revision, url } = await wikitexto(PLANTILLA_HARDWARE, 'en');
  // Cada artículo queda con su grupo principal y, si está en una sub-plantilla, con su subgrupo.
  const entradas = [];
  const grupos = []; // pila: [principal, subgrupo]
  let profundidad = 0;
  for (const linea of texto.split('\n')) {
    if (/\{\{Navbox/.test(linea)) profundidad++;
    const g = linea.match(/^\s*\|\s*group\d+\s*=\s*(.*)$/);
    if (g) {
      grupos[profundidad - 1] = plano(g[1]).replace(/s$/, '').trim();
      grupos.length = profundidad;
    }
    const m = linea.match(/^\*+\s*\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/);
    if (m) entradas.push({ titulo: m[1].replace(/_/g, ' ').trim(), texto: (m[2] ?? m[1]).trim(), grupos: grupos.slice(0, profundidad) });
    if (/^\s*\}\}\s*$/.test(linea)) profundidad--;
  }
  // Ítem de Wikidata de cada artículo (siguiendo redirecciones). Un enlace a una sección
  // («Serial ATA#eSATA») se busca por su texto («eSATA»).
  const titulos = [...new Set(entradas.map((e) => (e.titulo.includes('#') ? e.texto : e.titulo)))];
  const item = new Map();
  for (const lote of enLotes(titulos, 50)) {
    const d = await descargar(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: lote.join('|'), format: 'json', formatversion: '2' })}`, { json: true });
    const destino = new Map(lote.map((t) => [t, t]));
    for (const x of [...(d.query.normalized ?? []), ...(d.query.redirects ?? [])]) for (const [t, v] of destino) if (v === x.from) destino.set(t, x.to);
    const porTitulo = new Map(d.query.pages.map((p) => [p.title, p.pageprops?.wikibase_item]));
    // Respaldo: algunas páginas no exponen su ítem («FireWire»); se busca por el sitelink en Wikidata.
    const faltan = [...new Set([...destino].filter(([, v]) => !porTitulo.get(v)).flat())];
    if (faltan.length) {
      const w = await descargar(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'wbgetentities', sites: 'enwiki', titles: faltan.join('|'), props: 'sitelinks', sitefilter: 'enwiki', format: 'json' })}`, { json: true });
      for (const e of Object.values(w.entities ?? {})) if (e.id && e.sitelinks?.enwiki) porTitulo.set(e.sitelinks.enwiki.title, e.id);
    }
    for (const [t, v] of destino) if (porTitulo.get(v) ?? porTitulo.get(t)) item.set(t, porTitulo.get(v) ?? porTitulo.get(t));
  }
  // Último respaldo: páginas desconectadas de Wikidata (la de «FireWire», en 2026): el ítem más conocido
  // con la etiqueta en inglés del título o del texto del enlace.
  const porEtiqueta = [];
  for (const e of entradas) {
    const clave = e.titulo.includes('#') ? e.texto : e.titulo;
    if (item.has(clave)) continue;
    const filas = await sparql(`SELECT ?i ?s WHERE { VALUES ?l { ${[e.titulo, e.texto].map((t) => `"${t.replace(/"/g, '')}"@en`).join(' ')} } ?i rdfs:label ?l ; wikibase:sitelinks ?s } ORDER BY DESC(?s) LIMIT 1`);
    if (filas[0]) {
      item.set(clave, qid(filas[0].i));
      porEtiqueta.push(`${clave} → ${qid(filas[0].i)}`);
    }
  }
  return { entradas: entradas.map((e) => ({ ...e, item: item.get(e.titulo.includes('#') ? e.texto : e.titulo) })), revision, url, porEtiqueta };
}

// Ítems sin etiqueta en español en Wikidata: nombre en español (traducción del nombre, documentada como
// corrección; el nombre en inglés queda como alias).
const NOMBRES_HARDWARE = {
  Q364747: ['mouse óptico', ['ratón óptico']], Q7098899: ['trackpad óptico', []], Q2286319: ['cámara web virtual', ['softcam']],
  Q1209975: ['parlantes de computadora', ['parlantes', 'altavoces', 'parlante']], Q5282316: ['paquete de discos', []], Q570553: ['MOSFET de potencia', []],
  Q15052114: ['eSATA', []],
};
// Etiquetas erróneas en Wikidata (corregidas a mano, con la fuente a la vista).
const CORRECCIONES_HARDWARE = { Q847473: ['PS/2', 'La etiqueta en español de Wikidata es «PS/ñ», un error de tipeo del nombre «PS/2».'] };
// Sigla con la que se conoce el componente («USB», «HDMI», «GPU»): el texto del enlace en la plantilla.
const esSiglaHardware = (t) => /^[A-Z][A-Za-z0-9/+.-]{1,7}$/.test(t) && (t.match(/[A-Z]/g) ?? []).length >= 2;


function hardwareDesdePlantilla({ id, nombre, descripcion, criterio, atributo, etiqueta, grupos: elegir, verificar }) {
  return {
    id,
    nombre,
    descripcion,
    popularidad: POPULARIDAD_WIKIPEDIA,
    cobertura: { tipo: 'completa', criterio },
    atributos: { [atributo]: { tipo: 'lista', etiqueta } },
    async importar({ hoy }) {
      const verificacion = [];
      const correcciones = [];
      const { entradas, revision, url, porEtiqueta } = await plantillaHardware();
      if (porEtiqueta.length) verificacion.push(`artículos sin enlace a Wikidata, resueltos por etiqueta: ${porEtiqueta.join(', ')}`);
      const valores = new Map(); // ítem → valores del atributo
      for (const [grupo, valor] of Object.entries(elegir)) {
        const del = entradas.filter((e) => e.grupos.includes(grupo));
        exigir(del.length, `la plantilla tiene el grupo «${grupo}» (${del.length} artículos)`, verificacion);
        for (const e of del) {
          if (!e.item) throw new Error(`Verificación fallida: «${e.titulo}» no tiene ítem en Wikidata`);
          valores.set(e.item, [...new Set([...(valores.get(e.item) ?? []), valor])].sort());
        }
      }
      const ids = [...valores.keys()];
      const et = await etiquetas(ids);
      const textos = new Map(ids.map((q) => [q, [...new Set(entradas.filter((x) => x.item === q).map((x) => x.texto))]]));
      const entidades = ids.map((q) => {
        const e = et.get(q);
        const sigla = textos.get(q).find(esSiglaHardware);
        let nombre = e.es;
        let extras = [];
        if (CORRECCIONES_HARDWARE[q]) {
          [nombre] = CORRECCIONES_HARDWARE[q];
          correcciones.push({ entidad: q, detalle: `nombre «${nombre}»`, motivo: CORRECCIONES_HARDWARE[q][1] });
        } else if (sigla) {
          nombre = sigla;
          extras = [e.es];
        } else if (!e.es && NOMBRES_HARDWARE[q]) {
          [nombre, extras] = NOMBRES_HARDWARE[q];
          if (nombre !== e.en) correcciones.push({ entidad: q, detalle: `nombre «${nombre}» (en Wikidata solo «${e.en}», que queda como alias)`, motivo: 'Wikidata no tiene etiqueta en español: se traduce el nombre.' });
        }
        const alias = limpiarAlias(nombre ?? e.en, [...extras, ...e.alias, e.en, ...textos.get(q)].filter(Boolean), { siglas: true }).filter((a) => !/^\p{Ll}*\/\p{Ll}$/u.test(a));
        return { id: q, nombre: nombre ?? e.en, alias, popularidad: e.enlaces, atributos: { [atributo]: valores.get(q) }, fuente: urlEntidad(q) };
      });
      const sinTraducir = entidades.filter((x) => !et.get(x.id).es && !NOMBRES_HARDWARE[x.id] && !esSiglaHardware(x.nombre)).map((x) => x.nombre);
      exigir(!sinTraducir.length, `todos tienen nombre en español (sin traducir: ${sinTraducir.join(', ') || 'ninguno'})`, verificacion);
      verificar(entidades, verificacion);
      return { entidades, correcciones, verificacion, fuentes: [{ nombre: `Wikipedia en inglés, «${PLANTILLA_HARDWARE}» (revisión ${revision})`, url, licencia: 'CC BY-SA 4.0', detalle: 'lista y grupos' }, { ...WIKIDATA, detalle: 'nombres en español, alias y popularidad' }], hoy };
    },
  };
}

const perifericos = hardwareDesdePlantilla({
  id: 'perifericos',
  nombre: 'Periféricos',
  descripcion: 'Dispositivos de entrada, de salida y de almacenamiento extraíble de la plantilla «Basic computer components» de Wikipedia.',
  criterio: 'Los artículos de los grupos «Input devices», «Output devices» y «Removable data storage» de la plantilla de navegación «Basic computer components» de Wikipedia en inglés (con sus subelementos).',
  atributo: 'funciones',
  etiqueta: 'función',
  grupos: { 'Input device': 'entrada', 'Output device': 'salida', 'Removable data storage': 'almacenamiento' },
  verificar(entidades, verificacion) {
    const de = (f) => entidades.filter((e) => e.atributos.funciones.includes(f));
    exigir(de('entrada').length >= 10 && de('salida').length >= 5, `${de('entrada').length} de entrada y ${de('salida').length} de salida`, verificacion);
    verificacion.push(`${entidades.filter((e) => e.atributos.funciones.length > 1).map((e) => e.nombre).join(', ')}: de entrada y de salida a la vez (figuran en los dos grupos)`);
  },
});

const componentesPc = hardwareDesdePlantilla({
  id: 'componentes_pc',
  nombre: 'Componentes internos de una computadora',
  descripcion: 'Los componentes del grupo «Computer case» de la plantilla «Basic computer components» de Wikipedia.',
  criterio: 'Los artículos del grupo «Computer case» de la plantilla de navegación «Basic computer components» de Wikipedia en inglés (con sus subelementos).',
  atributo: 'ubicacion',
  etiqueta: 'ubicación',
  grupos: { 'Computer case': 'gabinete' },
  verificar(entidades, verificacion) {
    exigir(entidades.length >= 12, `${entidades.length} componentes`, verificacion);
  },
});

const conectores = hardwareDesdePlantilla({
  id: 'conectores',
  nombre: 'Puertos y conectores de computadora',
  descripcion: 'Los puertos (actuales y obsoletos) de la plantilla «Basic computer components» de Wikipedia.',
  criterio: 'Los artículos del grupo «Ports» de la plantilla de navegación «Basic computer components» de Wikipedia en inglés, con su vigencia (actual u obsoleto) tal como los agrupa la plantilla.',
  atributo: 'vigencia',
  etiqueta: 'vigencia',
  grupos: { Current: 'actual', Obsolete: 'obsoleto' },
  verificar(entidades, verificacion) {
    const de = (v) => entidades.filter((e) => e.atributos.vigencia.includes(v)).map((e) => e.nombre);
    exigir(de('actual').length >= 5 && de('obsoleto').length >= 5, `${de('actual').length} actuales y ${de('obsoleto').length} obsoletos`, verificacion);
  },
});

export const INFORMATICA = [propiedadesCss, lenguajesProgramacion, formatosArchivo, sistemasOperativos, perifericos, componentesPc, conectores];
