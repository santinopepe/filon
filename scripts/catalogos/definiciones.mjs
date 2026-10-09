// Definición de cada catálogo: de dónde salen los datos, cómo se transforman y qué se verifica antes de
// aceptarlos. Si una verificación falla, el importador no escribe el archivo (se conserva el anterior).
// Solo se ejecuta al importar (npm run importar-catalogos); el juego lee los JSON de datos/catalogos/.
import { sparql, etiquetas, propiedad, qid, anio, urlEntidad } from './wikidata.mjs';
import { descargar, capitalizar, limpiarAlias, sinParentesis, sha } from './comun.mjs';
import { normalizar } from '../../servidor/normalizar.js';
import { leerAfijos, expandir } from './hunspell.mjs';
import { WIKIDATA, POPULARIDAD_WIKIPEDIA, exigir, iguales, rango, nombreYAlias, wikitexto, plano } from './ayudas.mjs';
import { NUEVAS } from './nuevos.mjs';

const CLDR = '48.2.3';
const CLDR_URL = `https://raw.githubusercontent.com/unicode-org/cldr-json/${CLDR}/cldr-json`;

// ───────────────────────── Geografía ─────────────────────────

const REGIONES = { '002': 'África', '019': 'América', 142: 'Asia', 150: 'Europa', '009': 'Oceanía' };
// Nombre canónico: el nombre común en español de CLDR, salvo cuando CLDR usa la forma no castellana
// o una perífrasis y ofrece una variante habitual en español.
const NOMBRE_PREFERIDO = {
  CI: ['alt-variant', 'CLDR usa «Côte d’Ivoire»; en español se dice «Costa de Marfil».'],
  TL: ['alt-variant', 'CLDR usa «Timor-Leste»; en español se dice «Timor Oriental».'],
  PS: ['alt-short', 'CLDR usa «Territorios Palestinos»; el Estado observador de la ONU es «Palestina».'],
};

async function datosCldr() {
  const [contencion, territorios, info, idiomas, monedas] = await Promise.all([
    descargar(`${CLDR_URL}/cldr-core/supplemental/territoryContainment.json`, { json: true }),
    descargar(`${CLDR_URL}/cldr-localenames-full/main/es/territories.json`, { json: true }),
    descargar(`${CLDR_URL}/cldr-core/supplemental/territoryInfo.json`, { json: true }),
    descargar(`${CLDR_URL}/cldr-localenames-full/main/es/languages.json`, { json: true }),
    descargar(`${CLDR_URL}/cldr-numbers-full/main/es/currencies.json`, { json: true }),
  ]);
  return {
    contencion: contencion.supplemental.territoryContainment,
    nombres: territorios.main.es.localeDisplayNames.territories,
    territorios: info.supplemental.territoryInfo,
    idiomas: idiomas.main.es.localeDisplayNames.languages,
    monedas: monedas.main.es.numbers.currencies,
  };
}

const GEONAMES = 'https://download.geonames.org/export/dump/countryInfo.txt';
/** countryInfo.txt de GeoNames: código ISO → { moneda, vecinos }. */
async function datosGeonames() {
  const texto = await descargar(GEONAMES);
  const filas = new Map();
  for (const linea of texto.split('\n')) {
    if (!linea || linea.startsWith('#')) continue;
    const c = linea.split('\t');
    filas.set(c[0], { moneda: c[10], vecinos: c[17] ? c[17].split(',').filter(Boolean) : [] });
  }
  return { filas, huella: sha(texto).slice(0, 12) };
}
// Idiomas oficiales: estado «official» u «official de hecho» en CLDR (el inglés de Estados Unidos es «de
// hecho»); no los oficiales regionales.
const ESTADOS_OFICIALES = new Set(['official', 'de_facto_official']);

const paises = {
  id: 'paises',
  nombre: 'Países (miembros y observadores de la ONU)',
  descripcion: 'Los 193 Estados miembros de la ONU y los 2 Estados observadores, con su región (M49) y su capital.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: {
    tipo: 'completa',
    criterio: '193 Estados miembros de la ONU (agrupación «UN» de Unicode CLDR, contrastada con la membresía vigente en Wikidata) más Ciudad del Vaticano y Palestina.',
  },
  atributos: {
    iso: { tipo: 'texto', etiqueta: 'código ISO 3166-1' },
    continente: { tipo: 'texto', etiqueta: 'continente (M49)' },
    subregion: { tipo: 'texto', etiqueta: 'región (M49)' },
    capitales: { tipo: 'lista', etiqueta: 'capital' },
    vecinos: { tipo: 'lista', etiqueta: 'país limítrofe' },
    moneda: { tipo: 'texto', etiqueta: 'moneda' },
    idiomas: { tipo: 'lista', etiqueta: 'idioma oficial' },
  },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    const { contencion, nombres, territorios, idiomas, monedas } = await datosCldr();
    const geonames = await datosGeonames();
    const miembrosCldr = contencion.UN._contains;
    exigir(miembrosCldr.length === 193, `CLDR lista ${miembrosCldr.length} miembros de la ONU (se esperan 193)`, verificacion);

    // Contraste con Wikidata: miembros con membresía sin fecha de fin y su código ISO.
    const wd = await sparql(`SELECT ?e ?fin ?iso WHERE { ?m ps:P463 wd:Q1065 . ?e p:P463 ?m . OPTIONAL { ?m pq:P582 ?fin } OPTIONAL { ?e wdt:P297 ?iso } }`);
    const isoWd = new Set(wd.filter((f) => !f.fin && f.iso).map((f) => f.iso));
    // El miembro de la ONU es el Reino de Dinamarca (Q756617), que en Wikidata no tiene código ISO.
    if (wd.some((f) => !f.fin && qid(f.e) === 'Q756617')) {
      isoWd.add('DK');
      correcciones.push({ entidad: 'DK', detalle: 'Reino de Dinamarca (Q756617) → Dinamarca (DK)', motivo: 'El miembro de la ONU en Wikidata es el reino, sin código ISO.' });
    }
    const soloCldr = miembrosCldr.filter((c) => !isoWd.has(c));
    const soloWd = [...isoWd].filter((c) => !miembrosCldr.includes(c));
    exigir(!soloCldr.length && !soloWd.length, `CLDR y Wikidata coinciden en los 193 miembros (diferencias: ${[...soloCldr, ...soloWd].join(', ') || 'ninguna'})`, verificacion);
    const codigos = [...miembrosCldr, 'VA', 'PS'];

    // Región: la subregión M49 que contiene al país y el continente que contiene a la subregión.
    const padre = new Map();
    for (const [codigo, v] of Object.entries(contencion)) {
      if (!/^\d{3}$/.test(codigo) || codigo === '001' || codigo === '419' || v._grouping) continue;
      for (const hijo of v._contains) padre.set(hijo, codigo);
    }
    const regionDe = (iso) => {
      const sub = padre.get(iso);
      const cont = padre.get(sub);
      return { subregion: nombres[sub], continente: REGIONES[cont] };
    };

    // Ítem de Wikidata con cada código (si hay varios, el de más artículos: Chipre tiene dos).
    const items = await sparql(`SELECT ?e ?iso ?n WHERE { VALUES ?iso { ${codigos.map((c) => `"${c}"`).join(' ')} } ?e wdt:P297 ?iso ; wikibase:sitelinks ?n }`);
    const itemDe = new Map();
    for (const f of items) if (!itemDe.has(f.iso) || Number(f.n) > itemDe.get(f.iso).n) itemDe.set(f.iso, { id: qid(f.e), n: Number(f.n) });
    exigir(codigos.every((c) => itemDe.has(c)), 'cada país tiene su ítem en Wikidata (por código ISO)', verificacion);
    const ids = codigos.map((c) => itemDe.get(c).id);
    const [et, caps] = await Promise.all([etiquetas(ids), propiedad(ids, 'P36', { vigentes: true })]);

    // Capital provisional mal marcada como vigente en Wikidata.
    const EXCLUIR_CAPITAL = { Q93230: 'Rawalpindi fue capital provisional de Pakistán (1959–1967); la capital es Islamabad.' };
    const entidades = codigos.map((iso) => {
      const id = itemDe.get(iso).id;
      const e = et.get(id);
      const [variante, motivo] = NOMBRE_PREFERIDO[iso] ?? [];
      const cldr = nombres[variante ? `${iso}-${variante}` : iso];
      if (variante) correcciones.push({ entidad: iso, detalle: `nombre «${cldr}» en vez de «${nombres[iso]}»`, motivo });
      const { base, extras } = sinParentesis(cldr); // «Myanmar (Birmania)» → «Myanmar» y alias «Birmania»
      const otros = Object.entries(nombres).filter(([k]) => k.startsWith(`${iso}-alt`)).map(([, v]) => v);
      const { continente, subregion } = regionDe(iso);
      const geo = geonames.filas.get(iso) ?? { moneda: null, vecinos: [] };
      const oficiales = Object.entries(territorios[iso]?.languagePopulation ?? {})
        .filter(([, v]) => ESTADOS_OFICIALES.has(v._officialStatus))
        .map(([codigo]) => idiomas[codigo.replace(/_.*/, '')] ?? null)
        .filter(Boolean);
      const capitales = [];
      for (const c of caps.get(id)) {
        if (EXCLUIR_CAPITAL[c.valor.id]) {
          correcciones.push({ entidad: iso, detalle: `se quita la capital ${c.valor.nombre}`, motivo: EXCLUIR_CAPITAL[c.valor.id] });
          continue;
        }
        if (c.valor.nombre && !capitales.some((x) => x.id === c.valor.id)) capitales.push({ id: c.valor.id, nombre: c.valor.nombre });
      }
      return {
        id: iso,
        nombre: base,
        alias: limpiarAlias(base, [...extras.slice(0, 1), nombres[iso], ...otros, e.es, ...e.alias].filter((a) => !/[()]/.test(a))),
        popularidad: e.enlaces,
        atributos: {
          iso, continente, subregion,
          capitales: capitales.map((c) => c.nombre), capitalesId: capitales.map((c) => c.id), wikidata: id,
          vecinosIso: geo.vecinos, moneda: geo.moneda ? (monedas[geo.moneda]?.displayName ?? null) : null, monedaIso: geo.moneda,
          idiomas: [...new Set(oficiales)].sort(),
        },
        fuente: urlEntidad(id),
      };
    });
    exigir(entidades.length === 195, `${entidades.length} países (193 miembros + 2 observadores)`, verificacion);
    exigir(entidades.every((e) => e.atributos.continente && e.atributos.subregion), 'todos tienen continente y región M49', verificacion);
    const sinCapital = entidades.filter((e) => !e.atributos.capitales.length).map((e) => e.nombre);
    exigir(!sinCapital.length, `todos tienen al menos una capital vigente (sin capital: ${sinCapital.join(', ') || 'ninguno'})`, verificacion);
    exigir(new Set(entidades.map((e) => normalizar(e.nombre))).size === entidades.length, 'los nombres son únicos', verificacion);

    // Países limítrofes (GeoNames), solo entre los 195. La Guayana Francesa es parte de Francia: sus
    // fronteras (Brasil, Surinam) son de Francia.
    const porIso = new Map(entidades.map((e) => [e.id, e]));
    const ultramar = { GF: 'FR' };
    for (const [territorio, pais] of Object.entries(ultramar)) {
      for (const v of geonames.filas.get(territorio)?.vecinos ?? []) {
        if (!porIso.has(v)) continue;
        porIso.get(pais).atributos.vecinosIso.push(v);
        porIso.get(v).atributos.vecinosIso.push(pais);
        correcciones.push({ entidad: pais, detalle: `limita con ${v} por la Guayana Francesa`, motivo: 'La Guayana Francesa es un departamento de Francia; GeoNames la lista aparte.' });
      }
    }
    for (const e of entidades) {
      e.atributos.vecinosIso = [...new Set(e.atributos.vecinosIso.filter((v) => porIso.has(v)))].sort();
      e.atributos.vecinos = e.atributos.vecinosIso.map((v) => porIso.get(v).nombre);
    }
    const asimetricos = entidades.flatMap((e) => e.atributos.vecinosIso.filter((v) => !porIso.get(v).atributos.vecinosIso.includes(e.id)).map((v) => `${e.id}–${v}`));
    exigir(!asimetricos.length, `las fronteras son simétricas (A limita con B ⇔ B con A; diferencias: ${asimetricos.join(', ') || 'ninguna'})`, verificacion);
    const esperados = { AR: 'BO,BR,CL,PY,UY', BR: 'AR,BO,CO,FR,GY,PE,PY,SR,UY,VE', CN: 'AF,BT,IN,KG,KP,KZ,LA,MM,MN,NP,PK,RU,TJ,VN', DE: 'AT,BE,CH,CZ,DK,FR,LU,NL,PL' };
    for (const [iso, lista] of Object.entries(esperados)) exigir(porIso.get(iso).atributos.vecinosIso.join(',') === lista, `fronteras de ${porIso.get(iso).nombre}: ${lista}`, verificacion);
    exigir(entidades.every((e) => e.atributos.moneda), 'todos tienen moneda (GeoNames, nombre de CLDR)', verificacion);
    exigir(porIso.get('ES').atributos.moneda === 'euro' && porIso.get('AR').atributos.moneda === 'peso argentino', 'monedas: España usa el euro y Argentina el peso argentino', verificacion);
    exigir(entidades.every((e) => e.atributos.idiomas.length), 'todos tienen al menos un idioma oficial (CLDR)', verificacion);
    exigir(porIso.get('US').atributos.idiomas.includes('inglés') && ['alemán', 'francés', 'italiano'].every((i) => porIso.get('CH').atributos.idiomas.includes(i)), 'idiomas: inglés en Estados Unidos; alemán, francés e italiano en Suiza', verificacion);
    return {
      entidades,
      correcciones,
      verificacion,
      fuentes: [
        { nombre: `Unicode CLDR ${CLDR}`, url: 'https://cldr.unicode.org', licencia: 'Unicode License v3', detalle: 'nombres en español, agrupación ONU, regiones M49, idiomas oficiales y nombres de monedas' },
        { ...WIKIDATA, detalle: 'membresía en la ONU (contraste), capitales, alias y popularidad' },
        { nombre: 'GeoNames', url: 'https://www.geonames.org', licencia: 'CC BY 4.0', detalle: `countryInfo.txt: fronteras y moneda (huella ${geonames.huella})` },
      ],
      hoy,
    };
  },
};

const capitales = {
  id: 'capitales',
  nombre: 'Capitales de los países',
  descripcion: 'Capitales vigentes de los 195 países del catálogo «paises» (algunos países tienen más de una).',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Todas las capitales vigentes (propiedad P36 de Wikidata, valor preferido o sin fecha de fin) de los 195 países.' },
  atributos: {
    pais: { tipo: 'texto', etiqueta: 'país' },
    continente: { tipo: 'texto', etiqueta: 'continente (M49)' },
    subregion: { tipo: 'texto', etiqueta: 'región (M49)' },
    // Del país de la capital (los mismos datos verificados del catálogo «paises»).
    vecinos: { tipo: 'lista', etiqueta: 'país vecino' },
    idiomas: { tipo: 'lista', etiqueta: 'idioma oficial' },
    moneda: { tipo: 'texto', etiqueta: 'moneda' },
  },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const porCapital = new Map();
    for (const p of catalogos.paises.entidades) {
      p.atributos.capitalesId.forEach((id) => {
        if (porCapital.has(id)) throw new Error(`La capital ${id} aparece en dos países.`);
        porCapital.set(id, p);
      });
    }
    const ids = [...porCapital.keys()];
    const et = await etiquetas(ids);
    const entidades = ids.map((id) => {
      const p = porCapital.get(id);
      const n = nombreYAlias(et.get(id));
      const { continente, subregion, vecinos, idiomas, moneda } = p.atributos;
      return { id, ...n, popularidad: et.get(id).enlaces, atributos: { pais: p.nombre, continente, subregion, vecinos, idiomas, moneda }, fuente: urlEntidad(id) };
    });
    exigir(entidades.every((e) => e.nombre), 'todas las capitales tienen nombre en español', verificacion);
    exigir(new Set(entidades.map((e) => e.atributos.pais)).size === 195, 'hay capital para los 195 países', verificacion);
    exigir(new Set(entidades.map((e) => normalizar(e.nombre))).size === entidades.length, 'los nombres de capitales son únicos', verificacion);
    exigir(entidades.find((e) => e.nombre === 'Buenos Aires')?.atributos.vecinos.includes('Chile'), 'el país de Buenos Aires limita con Chile (vecinos tomados del catálogo «paises»)', verificacion);
    return { entidades, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'capitales (P36), alias y popularidad' }, { nombre: 'Catálogo «paises»', url: 'https://www.geonames.org', licencia: 'CC BY 4.0 (GeoNames) y Unicode License v3 (CLDR)', detalle: 'fronteras, idiomas y moneda del país de cada capital' }], hoy };
  },
};

// ───────────────────────── Ciencia ─────────────────────────

const elementos = {
  id: 'elementos',
  nombre: 'Elementos químicos',
  descripcion: 'Los 118 elementos de la tabla periódica, con su símbolo y su número atómico.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Los 118 elementos reconocidos por la IUPAC (números atómicos 1 a 118).' },
  atributos: { simbolo: { tipo: 'texto', etiqueta: 'símbolo' }, numero: { tipo: 'numero', etiqueta: 'número atómico' } },
  async importar({ hoy }) {
    const verificacion = [];
    const filas = await sparql(`SELECT ?e ?z ?s WHERE { ?e wdt:P31 wd:Q11344 ; wdt:P1086 ?z ; wdt:P246 ?s . FILTER(?z >= 1 && ?z <= 118) }`);
    const porZ = new Map();
    for (const f of filas) if (!porZ.has(Number(f.z))) porZ.set(Number(f.z), f);
    exigir(iguales([...porZ.keys()].sort((a, b) => a - b), rango(1, 118)), 'están los números atómicos 1 a 118, sin huecos', verificacion);
    const ids = [...porZ.values()].map((f) => qid(f.e));
    const et = await etiquetas(ids);
    const entidades = [...porZ.values()].map((f) => {
      const id = qid(f.e);
      const n = nombreYAlias(et.get(id), { capital: true });
      // Se pide el nombre: los símbolos (actuales o viejos, como «Cb») y «Elemento 40» no son alias.
      n.alias = n.alias.filter((a) => !/^[A-Z][a-z]{0,2}$/.test(a) && !/^elemento \d+$/i.test(a));
      return { id, ...n, popularidad: et.get(id).enlaces, atributos: { simbolo: f.s, numero: Number(f.z) }, fuente: urlEntidad(id) };
    });
    exigir(entidades.every((e) => e.nombre), 'todos tienen nombre en español', verificacion);
    exigir(new Set(entidades.map((e) => e.atributos.simbolo)).size === 118, 'los 118 símbolos son distintos', verificacion);
    return { entidades, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'elementos (P1086 número atómico, P246 símbolo)' }], hoy };
  },
};

// ───────────────────────── Historia ─────────────────────────

/** Titulares de un cargo con ordinal entero (P1545): verifica que los ordinales sean 1…N sin huecos. */
async function titulares(cargo, { minimo, personas }, verificacion) {
  const filas = await sparql(`SELECT ?w ?o ?ini WHERE { ?st ps:P39 wd:${cargo} ; pq:P1545 ?o . ?w p:P39 ?st .
    FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } OPTIONAL { ?st pq:P580 ?ini } }`);
  const validas = filas.filter((f) => /^\d+$/.test(f.o));
  const descartadas = filas.length - validas.length;
  const ordinales = [...new Set(validas.map((f) => Number(f.o)))].sort((a, b) => a - b);
  const n = ordinales.at(-1);
  exigir(n >= minimo && iguales(ordinales, rango(1, n)), `ordinales 1 a ${n} sin huecos (mínimo esperado ${minimo}; ${descartadas} declaraciones con ordinal no entero descartadas)`, verificacion);
  const porPersona = new Map();
  for (const f of validas) {
    const id = qid(f.w);
    const p = porPersona.get(id) ?? { id, ordinales: new Set(), inicios: [] };
    p.ordinales.add(Number(f.o));
    if (f.ini) p.inicios.push(anio(f.ini));
    porPersona.set(id, p);
  }
  const ordinalesPorPersona = [...porPersona.values()].reduce((s, p) => s + p.ordinales.size, 0);
  exigir(ordinalesPorPersona === n, `cada ordinal corresponde a una sola persona (${porPersona.size} personas)`, verificacion);
  if (personas) exigir(personas(porPersona.size, n), `cantidad de personas coherente con ${n} períodos`, verificacion);
  return [...porPersona.values()];
}

function cargo({ id, nombre, descripcion, wikidata, minimo, personas, criterio, nombreBase = false, nombresEsperados = {} }) {
  return {
    id,
    nombre,
    descripcion,
    popularidad: POPULARIDAD_WIKIPEDIA,
    cobertura: { tipo: 'completa', criterio },
    atributos: {
      inicio: { tipo: 'numero', etiqueta: 'año en que asumió' },
      ordinales: { tipo: 'lista_numeros', etiqueta: 'número de orden' },
      ...(nombreBase ? { nombrePapal: { tipo: 'texto', etiqueta: 'nombre papal' } } : {}),
    },
    async importar({ hoy }) {
      const verificacion = [];
      const lista = await titulares(wikidata, { minimo, personas }, verificacion);
      const et = await etiquetas(lista.map((p) => p.id));
      const entidades = lista.map((p) => {
        const n = nombreYAlias(et.get(p.id));
        const atributos = { inicio: p.inicios.length ? Math.min(...p.inicios) : null, ordinales: [...p.ordinales].sort((a, b) => a - b) };
        // Nombre papal sin el número, para «un papa llamado Pío»: del primer nombre o alias con número
        // ordinal («Juan Pablo II» → «Juan Pablo»; «Gregorio Magno», alias «Gregorio I» → «Gregorio»).
        if (nombreBase && n) {
          const conNumero = [n.nombre, ...n.alias].map((t) => t.match(/^(.+?)\s+[IVXLC]+\b/)).find(Boolean);
          atributos.nombrePapal = conNumero ? conNumero[1] : n.nombre;
        }
        return { id: p.id, ...n, popularidad: et.get(p.id).enlaces, atributos, fuente: urlEntidad(p.id) };
      });
      exigir(entidades.every((e) => e.nombre), 'todos tienen nombre en español', verificacion);
      for (const [nombrePapal, n] of Object.entries(nombresEsperados)) {
        const hay = entidades.filter((e) => e.atributos.nombrePapal === nombrePapal).length;
        exigir(hay === n, `${hay} papas llamados ${nombrePapal} (se esperan ${n})`, verificacion);
      }
      const sinInicio = entidades.filter((e) => e.atributos.inicio == null).length;
      verificacion.push(`${sinInicio} sin año de inicio (los filtros por año no se usan si falta alguno)`);
      return { entidades, verificacion, fuentes: [{ ...WIKIDATA, detalle: `cargo ${wikidata} (P39 con ordinal P1545)` }], hoy };
    },
  };
}

const papas = cargo({
  id: 'papas',
  nombre: 'Papas de la Iglesia católica',
  descripcion: 'Todos los papas, de Pedro a la actualidad, con el año en que asumieron.',
  wikidata: 'Q19546',
  minimo: 267,
  nombreBase: true,
  // Cantidad de papas de cada nombre (sin antipapas): verifica que los que no llevan número en su nombre
  // («Gregorio Magno», «León I el Magno») queden con su nombre papal.
  nombresEsperados: { Gregorio: 16, Clemente: 14, León: 14, Pío: 12, Juan: 21, Benedicto: 15, Inocencio: 13 },
  // Benedicto IX tuvo tres pontificados: hay dos personas menos que pontificados.
  personas: (personas, n) => personas === n - 2,
  criterio: 'Todos los pontificados numerados (P39 papa con ordinal), de 1 al último, sin huecos.',
});
const presidentesEeuu = cargo({
  id: 'presidentes_eeuu',
  nombre: 'Presidentes de los Estados Unidos',
  descripcion: 'Todas las personas que fueron presidentes de los Estados Unidos.',
  wikidata: 'Q11696',
  minimo: 47,
  // Grover Cleveland y Donald Trump tuvieron dos presidencias no consecutivas.
  personas: (personas, n) => personas === n - 2,
  criterio: 'Todas las presidencias numeradas (P39 con ordinal), de la 1 a la última, sin huecos.',
});
const secretariosOnu = cargo({
  id: 'secretarios_onu',
  nombre: 'Secretarios generales de la ONU',
  descripcion: 'Todas las personas que fueron secretario general de las Naciones Unidas.',
  wikidata: 'Q81066',
  minimo: 9,
  personas: (personas, n) => personas === n,
  criterio: 'Todos los secretarios generales numerados (P39 con ordinal), sin huecos.',
});

// ───────────────────────── Deportes ─────────────────────────

// Campeón y sedes de cada Mundial 1930–2022 (para verificar lo que dice Wikidata; Inglaterra figura
// con su código de subdivisión). 2026 se toma de la fuente y se marca como no verificado a mano.
const MUNDIALES = {
  1930: ['UY', ['UY']], 1934: ['IT', ['IT']], 1938: ['IT', ['FR']], 1950: ['UY', ['BR']], 1954: ['DE', ['CH']], 1958: ['BR', ['SE']],
  1962: ['BR', ['CL']], 1966: ['GB-ENG', ['GB']], 1970: ['BR', ['MX']], 1974: ['DE', ['DE']], 1978: ['AR', ['AR']], 1982: ['IT', ['ES']],
  1986: ['AR', ['MX']], 1990: ['DE', ['IT']], 1994: ['BR', ['US']], 1998: ['FR', ['FR']], 2002: ['BR', ['KR', 'JP']], 2006: ['IT', ['DE']],
  2010: ['ES', ['ZA']], 2014: ['DE', ['BR']], 2018: ['FR', ['RU']], 2022: ['AR', ['QA']],
};

async function edicionesMundial(verificacion, sinVerificar) {
  const filas = await sparql(`SELECT ?ed ?t ?t2 ?gan ?pg ?ig ?sede ?isede WHERE { ?ed wdt:P3450 wd:Q19317 .
    OPTIONAL { ?ed wdt:P585 ?t } OPTIONAL { ?ed wdt:P580 ?t2 }
    OPTIONAL { ?ed wdt:P1346 ?gan . OPTIONAL { ?gan wdt:P1532 ?pg . OPTIONAL { ?pg wdt:P297 ?ig1 } OPTIONAL { ?pg wdt:P300 ?ig2 } } }
    BIND(COALESCE(?ig1, ?ig2) AS ?ig)
    OPTIONAL { ?ed wdt:P17 ?sede . OPTIONAL { ?sede wdt:P297 ?isede } } }`);
  const ediciones = new Map();
  for (const f of filas) {
    const a = anio(f.t ?? f.t2);
    if (!a || a > 2026 || (!f.gan && !f.sede)) continue;
    const e = ediciones.get(a) ?? { anio: a, campeones: new Map(), sedes: new Map() };
    if (f.gan && f.ig) e.campeones.set(f.ig, { equipo: qid(f.gan), pais: qid(f.pg) });
    if (f.sede && f.isede) e.sedes.set(f.isede, qid(f.sede));
    ediciones.set(a, e);
  }
  for (const [a, [campeon, sedes]] of Object.entries(MUNDIALES)) {
    const e = ediciones.get(Number(a));
    exigir(e && e.campeones.size === 1 && e.campeones.has(campeon), `Mundial ${a}: campeón ${campeon}`, verificacion);
    exigir(iguales([...e.sedes.keys()].sort(), [...sedes].sort()), `Mundial ${a}: sede ${sedes.join(' y ')}`, verificacion);
  }
  const de2026 = ediciones.get(2026);
  exigir(de2026 && iguales([...de2026.sedes.keys()].sort(), ['CA', 'MX', 'US']), 'Mundial 2026: sedes Canadá, Estados Unidos y México', verificacion);
  if (de2026?.campeones.size === 1) sinVerificar.push(`Campeón del Mundial 2026 según Wikidata: ${[...de2026.campeones.keys()][0]} (posterior a la verificación manual)`);
  else exigir(false, 'Mundial 2026: un solo campeón en la fuente', verificacion);
  return [...ediciones.values()].filter((e) => MUNDIALES[e.anio] || e.anio === 2026).sort((a, b) => a.anio - b.anio);
}

const campeonesMundial = {
  id: 'campeones_mundial',
  nombre: 'Selecciones campeonas del Mundial de fútbol',
  descripcion: 'Selecciones masculinas que ganaron la Copa Mundial de la FIFA, con los años de sus títulos.',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Campeones de todas las ediciones disputadas, 1930–2026 (1930–2022 verificadas una por una).' },
  atributos: { titulos: { tipo: 'lista_numeros', etiqueta: 'año del título' } },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const sinVerificar = [];
    const ediciones = await edicionesMundial(verificacion, sinVerificar);
    const porPais = new Map();
    for (const e of ediciones) for (const [iso, c] of e.campeones) porPais.set(iso, { ...c, iso, titulos: [...(porPais.get(iso)?.titulos ?? []), e.anio] });
    const paisesPorIso = new Map(catalogos.paises.entidades.map((p) => [p.id, p]));
    const et = await etiquetas([...porPais.values()].map((c) => c.pais));
    const entidades = [...porPais.values()].map((c) => {
      const pais = paisesPorIso.get(c.iso);
      const nombre = pais?.nombre ?? et.get(c.pais).es; // Inglaterra no es un país de la ONU
      return { id: c.iso, nombre, alias: limpiarAlias(nombre, [...(pais?.alias ?? []), ...et.get(c.pais).alias]), popularidad: et.get(c.pais).enlaces, atributos: { titulos: c.titulos }, fuente: urlEntidad(c.equipo) };
    });
    exigir(entidades.length >= 8, `${entidades.length} selecciones campeonas`, verificacion);
    return { entidades, verificacion, sinVerificar, fuentes: [{ ...WIKIDATA, detalle: 'ediciones de la Copa Mundial (P1346 ganador, P17 sede)' }], hoy };
  },
};

const sedesMundial = {
  id: 'sedes_mundial',
  nombre: 'Países sede del Mundial de fútbol',
  descripcion: 'Países que organizaron (o coorganizaron) la Copa Mundial de la FIFA, con los años.',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Sedes de todas las ediciones 1930–2026 (verificadas una por una).' },
  atributos: { anios: { tipo: 'lista_numeros', etiqueta: 'año en que fue sede' } },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const ediciones = await edicionesMundial(verificacion, []);
    const paisesPorIso = new Map(catalogos.paises.entidades.map((p) => [p.id, p]));
    const porPais = new Map();
    for (const e of ediciones) for (const iso of e.sedes.keys()) porPais.set(iso, [...(porPais.get(iso) ?? []), e.anio]);
    const correcciones = [];
    const entidades = [...porPais].map(([iso, anios]) => {
      const p = paisesPorIso.get(iso);
      const extras = [];
      if (iso === 'GB') {
        extras.push('Inglaterra');
        correcciones.push({ entidad: 'GB', detalle: 'alias «Inglaterra»', motivo: 'La sede de 1966 fue Inglaterra; en la fuente figura el Reino Unido.' });
      }
      return { id: iso, nombre: p.nombre, alias: limpiarAlias(p.nombre, [...extras, ...p.alias]), popularidad: p.popularidad, atributos: { anios }, fuente: p.fuente };
    });
    exigir(entidades.length === 19, `${entidades.length} países sede (se esperan 19 hasta 2026)`, verificacion);
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'ediciones de la Copa Mundial (P17 país sede)' }], hoy };
  },
};

// Campeón de pilotos de cada temporada 1950–2024, para verificar (apellido tal como aparece en el nombre).
const CAMPEONES_F1 = 'Farina Fangio Ascari Ascari Fangio Fangio Fangio Fangio Hawthorn Brabham Brabham Hill Hill Clark Surtees Clark Brabham Hulme Hill Stewart Rindt Stewart Fittipaldi Stewart Fittipaldi Lauda Hunt Lauda Andretti Scheckter Jones Piquet Rosberg Piquet Lauda Prost Prost Piquet Senna Prost Senna Senna Mansell Prost Schumacher Schumacher Hill Villeneuve Häkkinen Häkkinen Schumacher Schumacher Schumacher Schumacher Schumacher Alonso Alonso Räikkönen Hamilton Button Vettel Vettel Vettel Vettel Hamilton Hamilton Rosberg Hamilton Hamilton Hamilton Hamilton Verstappen Verstappen Verstappen Verstappen'.split(' ');

const campeonesF1 = {
  id: 'campeones_f1',
  nombre: 'Campeones mundiales de Fórmula 1',
  descripcion: 'Pilotos que ganaron el campeonato mundial de Fórmula 1, con los años de sus títulos.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  // A Wikidata le faltan los campeones de algunas temporadas (2018, 2022 y 2024 al importar): el catálogo
  // es completo solo en el tramo continuo verificado desde 1950, y las preguntas no pueden salir de ahí.
  cobertura: { tipo: 'parcial', criterio: 'Campeón de pilotos de cada temporada en el tramo continuo verificado desde 1950; las temporadas sin campeón en la fuente quedan fuera.' },
  atributos: { titulos: { tipo: 'lista_numeros', etiqueta: 'año del título' } },
  async importar({ hoy }) {
    const verificacion = [];
    const sinVerificar = [];
    const filas = await sparql(`SELECT ?s ?t ?w WHERE { ?s wdt:P31 wd:Q108861375 . OPTIONAL { ?s wdt:P585 ?t } ?s wdt:P1346 ?w . ?w wdt:P31 wd:Q5 }`);
    const porAnio = new Map();
    const anioDe = new Map((await sparql(`SELECT ?s ?l WHERE { ?s wdt:P31 wd:Q108861375 ; rdfs:label ?l . FILTER(LANG(?l) = 'es') }`)).map((f) => [f.s, Number((f.l.match(/\b(19|20)\d{2}\b/) ?? [])[0])]));
    for (const f of filas) {
      const a = anio(f.t) ?? anioDe.get(f.s);
      if (!a) continue;
      porAnio.set(a, new Set([...(porAnio.get(a) ?? []), qid(f.w)]));
    }
    const ids = [...new Set([...porAnio.values()].flatMap((s) => [...s]))];
    const et = await etiquetas(ids);
    const faltan = [];
    CAMPEONES_F1.forEach((apellido, i) => {
      const a = 1950 + i;
      const ganadores = [...(porAnio.get(a) ?? [])];
      if (!ganadores.length) return void faltan.push(a);
      exigir(ganadores.length === 1 && (et.get(ganadores[0])?.es ?? '').includes(apellido), `F1 ${a}: ${apellido}`, verificacion);
    });
    const ultimo = Math.max(...porAnio.keys());
    for (let a = 2025; a <= ultimo; a++) {
      const g = [...(porAnio.get(a) ?? [])];
      if (!g.length) faltan.push(a);
      else if (g.length > 1) throw new Error(`Verificación fallida: F1 ${a} tiene ${g.length} campeones en la fuente`);
      else sinVerificar.push(`Campeón de F1 ${a} según Wikidata: ${et.get(g[0]).es} (posterior a la verificación manual)`);
    }
    const hasta = (faltan.length ? Math.min(...faltan) : ultimo + 1) - 1;
    exigir(hasta >= 2000, `tramo completo 1950–${hasta}; temporadas sin campeón en la fuente: ${faltan.join(', ') || 'ninguna'}`, verificacion);
    this.cobertura = { ...this.cobertura, completoEn: [{ campo: 'titulos', desde: 1950, hasta }] };
    const titulos = new Map();
    for (const [a, s] of porAnio) if (a <= ultimo) for (const id of s) titulos.set(id, [...(titulos.get(id) ?? []), a].sort((x, y) => x - y));
    const entidades = [...titulos].map(([id, anios]) => ({ id, ...nombreYAlias(et.get(id)), popularidad: et.get(id).enlaces, atributos: { titulos: anios }, fuente: urlEntidad(id) }));
    return { entidades, verificacion, sinVerificar, fuentes: [{ ...WIKIDATA, detalle: 'temporadas de Fórmula 1 (P1346 ganador, personas)' }], hoy };
  },
};

// ───────────────────────── Cine ─────────────────────────

const oscarPelicula = {
  id: 'oscar_pelicula',
  nombre: 'Ganadoras del Óscar a la mejor película',
  descripcion: 'Películas que ganaron el Óscar a la mejor película, con el año de la ceremonia y su dirección.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Una ganadora por ceremonia desde 1929 (en 1930 hubo dos ceremonias y en 1933 ninguna), sin huecos.' },
  atributos: { ceremonia: { tipo: 'numero', etiqueta: 'año de la ceremonia' }, direccion: { tipo: 'lista', etiqueta: 'dirección' } },
  async importar({ hoy }) {
    const verificacion = [];
    const filas = await sparql(`SELECT DISTINCT ?w ?t WHERE { ?st ps:P166 wd:Q102427 ; pq:P585 ?t . ?w p:P166 ?st . ?w wdt:P31/wdt:P279* wd:Q11424 .
      FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } }`);
    const porPelicula = new Map();
    for (const f of filas) porPelicula.set(qid(f.w), anio(f.t));
    const anios = [...porPelicula.values()].sort((a, b) => a - b);
    const ultimo = anios.at(-1);
    // Dos ceremonias en 1930 y ninguna en 1933 (la sexta fue en marzo de 1934).
    exigir(iguales(anios, [1929, 1930, ...rango(1930, ultimo, [1933])]), `una ganadora por ceremonia de 1929 a ${ultimo} (dos en 1930, ninguna en 1933)`, verificacion);
    const ids = [...porPelicula.keys()];
    const [et, dir] = await Promise.all([etiquetas(ids), propiedad(ids, 'P57')]);
    const correcciones = [];
    const entidades = ids.map((id) => {
      const e = et.get(id);
      // Sin título en español registrado: se usa el original (el inglés), como se estrenó en la región.
      if (!e.es && e.en) {
        correcciones.push({ entidad: id, detalle: `título original «${e.en}»`, motivo: 'Wikidata no tiene título en español para esta película.' });
        e.es = e.en;
      }
      return { id, ...nombreYAlias(e, { extras: [e.en].filter(Boolean) }), popularidad: e.enlaces, atributos: { ceremonia: porPelicula.get(id), direccion: [...new Set(dir.get(id).map((d) => d.valor.nombre).filter(Boolean))] }, fuente: urlEntidad(id) };
    });
    exigir(entidades.every((e) => e.nombre), 'todas tienen título', verificacion);
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'Óscar a la mejor película (P166 con fecha P585), dirección (P57)' }], hoy };
  },
};

// ───────────────────────── Música ─────────────────────────

// Discos conocidos (ids de «release group» de MusicBrainz, fijos para que la importación sea reproducible).
// De cada uno se toma la lista de temas de su primera edición oficial.
const DISCOS = [
  ['Soda Stereo', 'Canción animal'], ['Charly García', 'Clics modernos'], ['Fito Páez', 'El amor después del amor'],
  ['Patricio Rey y sus Redonditos de Ricota', 'Oktubre'], ['Sui Generis', 'Vida'], ['Serú Girán', 'La grasa de las capitales'],
  ['Los Fabulosos Cadillacs', 'Rey Azúcar'], ['Maná', '¿Dónde jugarán los niños?'], ['Shakira', 'Pies descalzos'],
  ['Bad Bunny', 'Un verano sin ti'], ['The Beatles', 'Abbey Road'], ['The Beatles', "Sgt. Pepper's Lonely Hearts Club Band"],
  ['The Beatles', 'Revolver'], ['Michael Jackson', 'Thriller'], ['Queen', 'A Night at the Opera'], ['Pink Floyd', 'The Dark Side of the Moon'],
  ['Nirvana', 'Nevermind'], ['AC/DC', 'Back in Black'], ['Fleetwood Mac', 'Rumours'], ['Eagles', 'Hotel California'],
  ["Guns N' Roses", 'Appetite for Destruction'], ['Adele', '21'], ['Bob Marley & The Wailers', 'Exodus'], ['U2', 'The Joshua Tree'],
  ['Madonna', 'Like a Prayer'], ['Oasis', "(What's the Story) Morning Glory?"], ['Radiohead', 'OK Computer'], ['Taylor Swift', '1989'],
  ['Soda Stereo', 'Signos'], ['Soda Stereo', 'Sueño Stereo'], ['Charly García', 'Yendo de la cama al living'], ['Charly García', 'Piano bar'],
  ['Pescado Rabioso', 'Artaud'], ['Patricio Rey y sus Redonditos de Ricota', 'Bang! Bang!! Estás liquidado'], ['Sumo', 'Divididos por la felicidad'],
  ['Divididos', 'La era de la boludez'], ['Los Fabulosos Cadillacs', 'Fabulosos Calavera'], ['Babasónicos', 'Jessico'], ['Gustavo Cerati', 'Bocanada'],
  ['Los Piojos', 'Azul'], ['Bersuit Vergarabat', 'Libertinaje'], ['Andrés Calamaro', 'Alta suciedad'], ['Café Tacvba', 'Re'], ['Juanes', 'Un día normal'],
  ['Rosalía', 'El mal querer'], ['Luis Miguel', 'Romance'], ['Shakira', 'Laundry Service'], ['Mecano', 'Entre el cielo y el suelo'],
  ['Héroes del Silencio', 'Senderos de traición'], ['Michael Jackson', 'Bad'], ['The Beatles', 'Rubber Soul'], ['The Beatles', 'Let It Be'],
  ['Queen', 'News of the World'], ['Pink Floyd', 'Wish You Were Here'], ['The Rolling Stones', 'Sticky Fingers'], ['Bob Dylan', 'Highway 61 Revisited'],
  ['Prince and The Revolution', 'Purple Rain'], ['Coldplay', 'A Rush of Blood to the Head'], ['Amy Winehouse', 'Back to Black'], ['Daft Punk', 'Discovery'],
  ['Dua Lipa', 'Future Nostalgia'], ['The Weeknd', 'After Hours'], ['Red Hot Chili Peppers', 'Californication'], ['Bruce Springsteen', 'Born in the U.S.A.'],
  ['ABBA', 'Arrival'], ['Linkin Park', 'Hybrid Theory'], ['Green Day', 'American Idiot'], ['Billie Eilish', 'When We All Fall Asleep, Where Do We Go?'],
];
const MB = 'https://musicbrainz.org/ws/2';
const mb = (ruta) => descargar(`${MB}/${ruta}${ruta.includes('?') ? '&' : '?'}fmt=json`, { json: true, cabeceras: { accept: 'application/json' } });

/** Variantes de un título con paréntesis: «I Want You (She's So Heavy)» → «I Want You», «She's So Heavy». */
function aliasDeTitulo(titulo) {
  const { base, extras } = sinParentesis(titulo);
  return [base, ...extras].filter((t) => normalizar(t).length >= 2);
}

const canciones = {
  id: 'canciones',
  nombre: 'Canciones de discos conocidos',
  descripcion: 'Lista completa de temas de la primera edición oficial de discos conocidos.',
  popularidad: { criterio: 'Artículos de Wikipedia sobre la canción (sitelinks del ítem de Wikidata enlazado a la obra o grabación de MusicBrainz); 0 si no tiene.', nota: 'Es una medida de notoriedad, no una estadística de jugadores.' },
  cobertura: { tipo: 'parcial', completoPor: 'disco', criterio: 'No están todas las canciones del mundo: cada disco tiene su lista de temas completa (primera edición oficial en MusicBrainz).' },
  atributos: { disco: { tipo: 'texto', etiqueta: 'disco' }, artista: { tipo: 'texto', etiqueta: 'artista' }, anio: { tipo: 'numero', etiqueta: 'año del disco' } },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    const entidades = [];
    const noEncontrados = [];
    const obras = new Map(); // id de obra o grabación → entidad
    for (const [artista, disco] of DISCOS) {
      const busqueda = await mb(`release-group?query=${encodeURIComponent(`releasegroup:"${disco}" AND artist:"${artista}" AND primarytype:album`)}&limit=5`);
      const rg = busqueda['release-groups'].find((g) => normalizar(g.title) === normalizar(disco) && !(g['secondary-types'] ?? []).length);
      if (!rg) {
        // No se inventa ni se completa: el disco queda afuera y se informa.
        noEncontrados.push(`${disco} (${artista})`);
        continue;
      }
      const grupo = await mb(`release-group/${rg.id}?inc=releases+media`);
      // Primera edición oficial; si hay varias de la misma fecha, la de menos temas (sin bonus).
      const temasDe = (r) => (r.media ?? []).reduce((n, m) => n + (m['track-count'] ?? 0), 0);
      const oficial = grupo.releases
        .filter((r) => r.status === 'Official' && r.date)
        .sort((a, b) => a.date.localeCompare(b.date) || temasDe(a) - temasDe(b) || a.id.localeCompare(b.id))[0];
      const edicion = await mb(`release/${oficial.id}?inc=recordings+work-rels+recording-level-rels`);
      const temas = edicion.media.flatMap((m) => m.tracks);
      exigir(temas.length >= 5, `«${disco}» (${artista}, ${rg['first-release-date'].slice(0, 4)}): ${temas.length} temas de la edición ${oficial.id}`, verificacion);
      const vistos = new Set();
      for (const t of temas) {
        // El mismo tema dos veces en un disco («Someone Like You» y «Someone Like You (live acoustic)»)
        // es una sola canción: no infla el conjunto.
        const clave = normalizar(sinParentesis(t.title).base);
        if (vistos.has(clave)) {
          verificacion.push(`«${disco}»: «${t.title}» es otra versión de un tema ya incluido`);
          continue;
        }
        vistos.add(clave);
        if (!clave) {
          // «!!!!!!!» (Billie Eilish): un título sin letras ni números no se puede escribir como respuesta.
          correcciones.push({ entidad: `${rg.id}:${t.recording.id}`, detalle: `se quita «${t.title}» de «${disco}»`, motivo: 'El título no tiene letras ni números: nadie puede escribirlo como respuesta.' });
          continue;
        }
        const obra = (t.recording.relations ?? []).find((r) => r.work)?.work.id;
        const [nombre, ...alias] = [t.title, ...aliasDeTitulo(t.title)];
        const e = {
          id: `${rg.id}:${t.recording.id}`,
          nombre,
          alias: limpiarAlias(nombre, alias),
          popularidad: 0,
          atributos: { disco: rg.title, artista, anio: Number(rg['first-release-date'].slice(0, 4)), posicion: t.position, grabacion: t.recording.id, obra: obra ?? null },
          fuente: `https://musicbrainz.org/release/${oficial.id}`,
        };
        entidades.push(e);
        if (obra) obras.set(`obra:${obra}`, e);
        obras.set(`grabacion:${t.recording.id}`, e);
      }
    }
    // Popularidad: ítems de Wikidata enlazados por id de obra (P435) o de grabación (P4404) de MusicBrainz.
    for (const [tipo, propiedadMb] of [['obra', 'P435'], ['grabacion', 'P4404']]) {
      const claves = [...obras.keys()].filter((k) => k.startsWith(`${tipo}:`)).map((k) => k.split(':')[1]);
      for (let i = 0; i < claves.length; i += 60) {
        const filas = await sparql(`SELECT ?id ?n WHERE { VALUES ?id { ${claves.slice(i, i + 60).map((c) => `"${c}"`).join(' ')} } ?w wdt:${propiedadMb} ?id ; wikibase:sitelinks ?n }`);
        for (const f of filas) {
          const e = obras.get(`${tipo}:${f.id}`);
          if (e) e.popularidad = Math.max(e.popularidad, Number(f.n));
        }
      }
    }
    const discos = new Set(entidades.map((e) => e.atributos.disco)).size;
    exigir(discos >= DISCOS.length - 5, `${discos} discos con su lista completa${noEncontrados.length ? `; no se encontraron como álbum en MusicBrainz: ${noEncontrados.join(', ')}` : ''}`, verificacion);
    exigir(new Set(entidades.map((e) => `${e.atributos.artista}|${e.atributos.disco}`)).size === discos, 'no hay dos discos con el mismo título', verificacion);
    verificacion.push(`${entidades.filter((e) => e.popularidad > 0).length} de ${entidades.length} canciones con artículo en Wikipedia`);
    return {
      entidades,
      verificacion,
      correcciones,
      fuentes: [
        { nombre: 'MusicBrainz', url: 'https://musicbrainz.org', licencia: 'CC0 1.0 (datos centrales)', detalle: 'listas de temas' },
        { ...WIKIDATA, detalle: 'popularidad de las canciones (P435 / P4404)' },
      ],
      hoy,
    };
  },
};

// ───────────────────────── Literatura ─────────────────────────

/** Ganadores de un premio con año (P585), verificando qué años tienen premio. */
function premio({ id, nombre, descripcion, wikidata, anios, cantidad, criterio }) {
  return {
    id,
    nombre,
    descripcion,
    depende: ['paises'],
    popularidad: POPULARIDAD_WIKIPEDIA,
    cobertura: { tipo: 'completa', criterio },
    atributos: { anios: { tipo: 'lista_numeros', etiqueta: 'año del premio' }, paises: { tipo: 'lista', etiqueta: 'nacionalidad' }, continentes: { tipo: 'lista', etiqueta: 'continente' } },
    async importar({ hoy, catalogos }) {
      const verificacion = [];
      const filas = await sparql(`SELECT ?w ?t WHERE { ?st ps:P166 wd:${wikidata} . ?w p:P166 ?st . OPTIONAL { ?st pq:P585 ?t } FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank } }`);
      const porPersona = new Map();
      for (const f of filas) {
        const previos = porPersona.get(qid(f.w)) ?? [];
        porPersona.set(qid(f.w), f.t ? [...new Set([...previos, anio(f.t)])].sort((a, b) => a - b) : previos);
      }
      const conPremio = [...new Set([...porPersona.values()].flat())].sort((a, b) => a - b);
      const ultimo = Math.max(...conPremio);
      const esperados = anios(ultimo);
      const sinAnio = [...porPersona].filter(([, a]) => !a.length).map(([id]) => id);
      exigir(porPersona.size === cantidad(ultimo), `${porPersona.size} premiados (${esperados.length} ediciones hasta ${ultimo})`, verificacion);
      exigir(conPremio.every((a) => esperados.includes(a)), 'ningún año fuera de las ediciones esperadas', verificacion);
      const faltan = esperados.filter((a) => !conPremio.includes(a));
      verificacion.push(faltan.length ? `${sinAnio.length} premiados sin año en la fuente (años sin dato: ${faltan.join(', ')}): las preguntas por año no se usan` : 'todos los premiados tienen su año');
      const ids = [...porPersona.keys()];
      const [et, nac] = await Promise.all([etiquetas(ids), propiedad(ids, 'P27')]);
      const paisesPorItem = new Map(catalogos.paises.entidades.map((p) => [p.atributos.wikidata, p]));
      const entidades = ids.map((pid) => {
        const p = [...new Set(nac.get(pid).map((n) => paisesPorItem.get(n.valor.id)).filter(Boolean))];
        return {
          id: pid,
          ...nombreYAlias(et.get(pid)),
          popularidad: et.get(pid).enlaces,
          atributos: { anios: porPersona.get(pid).length ? porPersona.get(pid) : null, paises: p.map((x) => x.nombre), continentes: [...new Set(p.map((x) => x.atributos.continente))] },
          fuente: urlEntidad(pid),
        };
      });
      exigir(entidades.every((e) => e.nombre), 'todos tienen nombre en español', verificacion);
      const sinPais = entidades.filter((e) => !e.atributos.paises.length);
      for (const e of sinPais) e.atributos.paises = e.atributos.continentes = null;
      verificacion.push(`${sinPais.length} sin nacionalidad de un país actual (los filtros por país solo se usan si no falta ninguna)`);
      return { entidades, verificacion, fuentes: [{ ...WIKIDATA, detalle: `${wikidata} (P166 con fecha P585), nacionalidad (P27)` }], hoy };
    },
  };
}

const nobelLiteratura = premio({
  id: 'nobel_literatura',
  nombre: 'Premio Nobel de Literatura',
  descripcion: 'Escritoras y escritores que ganaron el Premio Nobel de Literatura.',
  wikidata: 'Q37922',
  // Años sin entrega: 1914, 1918, 1935 y 1940–1943.
  anios: (ultimo) => rango(1901, ultimo, [1914, 1918, 1935, 1940, 1941, 1942, 1943]),
  // Cuatro ediciones compartidas (1904, 1917, 1966, 1974): una persona más que ediciones en cada una.
  cantidad: (ultimo) => rango(1901, ultimo, [1914, 1918, 1935, 1940, 1941, 1942, 1943]).length + 4,
  criterio: 'Todos los premiados desde 1901 (los años sin entrega se verifican).',
});
const cervantes = premio({
  id: 'premio_cervantes',
  nombre: 'Premio Cervantes',
  descripcion: 'Escritoras y escritores que ganaron el Premio Miguel de Cervantes.',
  wikidata: 'Q81466',
  anios: (ultimo) => rango(1976, ultimo),
  // 1979 fue compartido (Borges y Gerardo Diego).
  cantidad: (ultimo) => rango(1976, ultimo).length + 1,
  criterio: 'Todos los premiados desde 1976, un año por edición (1979 compartido).',
});

// ───────────────────────── Gramática ─────────────────────────

const DICCIONARIO = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/es/es_AR.dic';
const AFIJOS = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/es/es_AR.aff';
const FRECUENCIAS = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt';

const palabras = {
  id: 'palabras',
  nombre: 'Palabras del español (diccionario rioplatense)',
  descripcion: 'Palabras comunes del diccionario es_AR de LibreOffice, tal como figuran (singular, infinitivo).',
  popularidad: {
    criterio: 'Frecuencia de uso en subtítulos en español (OpenSubtitles 2018, lista FrequencyWords de 50.000 palabras); 0 si no figura.',
    nota: 'Es una medida de uso del idioma, no una estadística de jugadores.',
  },
  cobertura: {
    tipo: 'completa',
    criterio: 'Las entradas en minúscula del diccionario es_AR (RLA-ES) con reglas de flexión (forma de diccionario: singular, infinitivo), más las entradas sueltas frecuentes de tres letras o más que no son formas flexionadas de otra ni adverbios en -mente; sin nombres propios ni siglas.',
  },
  atributos: {},
  async importar({ hoy }) {
    const verificacion = [];
    const [dic, aff, frec] = await Promise.all([descargar(DICCIONARIO), descargar(AFIJOS), descargar(FRECUENCIAS)]);
    const lineas = dic.split('\n');
    const declaradas = Number(lineas[0]);
    const frecuencia = new Map(frec.split('\n').map((l) => l.trim().split(' ')).filter((x) => x.length === 2).map(([p, n]) => [p, Number(n)]));
    // Las entradas sin reglas de flexión que salen de expandir otra entrada son formas flexionadas
    // (conjugaciones, enclíticos: «hágalas», «desandaríamos») y no forma de diccionario.
    const reglas = leerAfijos(aff);
    const entradas = lineas.slice(1).map((l) => l.trim().split('/')).filter(([p]) => p);
    const sueltas = new Set(entradas.filter(([, b]) => !b).map(([p]) => p));
    const flexionadas = new Set();
    for (const [p, b] of entradas) if (b) expandir(p, [...b], reglas, (forma) => sueltas.has(forma) && forma !== p && flexionadas.add(forma));
    const vistas = new Map();
    for (const [palabra, banderas] of entradas) {
      // Solo palabras comunes: en minúscula, únicamente letras del español, al menos dos.
      if (!/^[a-zñáéíóúü]{2,}$/.test(palabra)) continue;
      // Entradas sueltas (sin reglas de flexión): mezclan palabras invariables («ayer», «crisis», «ir»)
      // con conjugaciones de verbos defectivos, formas con pronombres pegados, siglas y adverbios en
      // -mente. Se conservan solo si no son una forma flexionada de otra entrada, figuran en la lista de
      // frecuencias, tienen alguna vocal, no terminan en «-mente» (la RAE tampoco los lista) y no llevan
      // pronombres enclíticos («dámelo», «échale», «darla», «irse»).
      const enclitico = /[áéíóú][a-zñ]*(me|te|se|le|les|lo|los|la|las|nos|os)$/.test(palabra) || /[aeií]r(me|te|se|le|les|lo|los|la|las|nos|os)$/.test(palabra);
      if (!banderas && (flexionadas.has(palabra) || !frecuencia.has(palabra) || !/[aeiouáéíóú]/.test(palabra) || palabra.endsWith('mente') || enclitico)) continue;
      vistas.set(palabra, frecuencia.get(palabra) ?? 0);
    }
    verificacion.push(`${flexionadas.size} entradas sueltas son formas flexionadas de otra y se descartaron; de las demás sueltas quedan ${[...vistas.keys()].filter((p) => sueltas.has(p)).length}`);
    exigir(
      ['hágalas', 'dámelo', 'atañerían', 'doctamente'].every((p) => !vistas.has(p)) && ['hacer', 'casa', 'ayer', 'crisis', 'ir'].every((p) => vistas.has(p)),
      'se descartan «hágalas», «dámelo», «atañerían» y «doctamente»; quedan «hacer», «casa», «ayer», «crisis» e «ir»',
      verificacion,
    );
    exigir(declaradas > 50_000 && lineas.length - 1 >= declaradas, `el diccionario declara ${declaradas} entradas y tiene ${lineas.length - 1}`, verificacion);
    exigir(vistas.size > 20_000, `${vistas.size} palabras comunes`, verificacion);
    exigir(frecuencia.size >= 49_000, `${frecuencia.size} palabras con frecuencia`, verificacion);
    // Dos entradas que solo difieren en tildes («solo» y «sólo») son la misma forma para el juego: se
    // conserva la más frecuente y la otra queda como alias.
    const porForma = new Map();
    for (const [palabra, n] of vistas) {
      const forma = normalizar(palabra);
      const previa = porForma.get(forma);
      if (!previa) porForma.set(forma, { palabra, n, otras: [] });
      else if (n > previa.n) porForma.set(forma, { palabra, n, otras: [...previa.otras, previa.palabra] });
      else previa.otras.push(palabra);
    }
    const entidades = [...porForma.values()].map(({ palabra, n, otras }) => ({ id: palabra, nombre: palabra, alias: otras, popularidad: n, atributos: {} }));
    verificacion.push(`${vistas.size - porForma.size} entradas que solo difieren en tildes se unieron como alias`);
    return {
      entidades,
      verificacion,
      fuentes: [
        { nombre: 'Diccionario es_AR de LibreOffice (proyecto RLA-ES)', url: 'https://github.com/LibreOffice/dictionaries/tree/master/es', licencia: 'GPL 3+ / LGPL 3+ / MPL 1.1+ (a elección)', detalle: `es_AR.dic (huella ${sha(dic).slice(0, 12)}) y es_AR.aff (huella ${sha(aff).slice(0, 12)})` },
        { nombre: 'FrequencyWords (OpenSubtitles 2018)', url: 'https://github.com/hermitdave/FrequencyWords', licencia: 'CC BY-SA 4.0', detalle: `es_50k.txt (huella ${sha(frec).slice(0, 12)})` },
      ],
      fuenteEntidades: 'https://github.com/LibreOffice/dictionaries/tree/master/es',
      hoy,
    };
  },
};

// ───────────────────────── Idiomas ─────────────────────────

const idiomas = {
  id: 'idiomas',
  nombre: 'Idiomas oficiales',
  descripcion: 'Idiomas oficiales (o de hecho) de algún país del catálogo «paises», con los países donde lo son.',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Todos los idiomas con estado oficial u oficial de hecho en alguno de los 195 países según Unicode CLDR (sin los oficiales regionales).' },
  atributos: { paises: { tipo: 'lista', etiqueta: 'país donde es oficial' }, continentes: { tipo: 'lista', etiqueta: 'continente donde es oficial' } },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const porIdioma = new Map();
    for (const p of catalogos.paises.entidades) {
      for (const idioma of p.atributos.idiomas) {
        const i = porIdioma.get(idioma) ?? { paises: new Set(), continentes: new Set() };
        i.paises.add(p.nombre);
        i.continentes.add(p.atributos.continente);
        porIdioma.set(idioma, i);
      }
    }
    // Popularidad: ítem de Wikidata del idioma por su nombre en español (etiqueta exacta); si no hay, 0.
    const nombres = [...porIdioma.keys()];
    const filas = await sparql(`SELECT ?l ?n WHERE { VALUES ?l { ${nombres.map((n) => `"${n}"@es`).join(' ')} } ?i rdfs:label ?l ; wdt:P31/wdt:P279* wd:Q34770 ; wikibase:sitelinks ?n }`);
    const enlaces = new Map();
    for (const f of filas) enlaces.set(f.l, Math.max(enlaces.get(f.l) ?? 0, Number(f.n)));
    const entidades = nombres.map((nombre) => {
      const i = porIdioma.get(nombre);
      return { id: normalizar(nombre).replace(/ /g, '-'), nombre: capitalizar(nombre), alias: [], popularidad: enlaces.get(nombre) ?? 0, atributos: { paises: [...i.paises].sort(), continentes: [...i.continentes].sort() } };
    });
    exigir(entidades.length > 80, `${entidades.length} idiomas oficiales`, verificacion);
    exigir(['Español', 'Inglés', 'Francés', 'Árabe', 'Portugués'].every((n) => entidades.some((e) => e.nombre === n)), 'están español, inglés, francés, árabe y portugués', verificacion);
    exigir(porIdioma.get('español').paises.size >= 18, `el español es oficial en ${porIdioma.get('español').paises.size} países`, verificacion);
    verificacion.push(`${entidades.filter((e) => e.popularidad > 0).length} con popularidad de Wikidata`);
    return {
      entidades,
      verificacion,
      fuentes: [{ nombre: `Unicode CLDR ${CLDR}`, url: 'https://cldr.unicode.org', licencia: 'Unicode License v3', detalle: 'idiomas oficiales por territorio (territoryInfo) y nombres en español' }, { ...WIKIDATA, detalle: 'popularidad' }],
      fuenteEntidades: 'https://cldr.unicode.org',
      hoy,
    };
  },
};

// ───────────────────────── Astronomía ─────────────────────────

const IAU = 'And Ant Aps Aqr Aql Ara Ari Aur Boo Cae Cam Cnc CVn CMa CMi Cap Car Cas Cen Cep Cet Cha Cir Col Com CrA CrB Crv Crt Cru Cyg Del Dor Dra Equ Eri For Gem Gru Her Hor Hya Hyi Ind Lac Leo LMi Lep Lib Lup Lyn Lyr Men Mic Mon Mus Nor Oct Oph Ori Pav Peg Per Phe Pic Psc PsA Pup Pyx Ret Sge Sgr Sco Scl Sct Ser Sex Tau Tel Tri TrA Tuc UMa UMi Vel Vir Vol Vul'.split(' ');
const ZODIACO = ['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc'];


const constelaciones = {
  id: 'constelaciones',
  nombre: 'Constelaciones',
  descripcion: 'Las 88 constelaciones de la Unión Astronómica Internacional, con su nombre en español.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Las 88 constelaciones oficiales de la IAU (verificadas contra sus 88 abreviaturas); nombres en español del anexo de Wikipedia (según J. L. Comellas, «Astronomía»).' },
  atributos: {
    latin: { tipo: 'texto', etiqueta: 'nombre en latín' },
    autor: { tipo: 'texto', etiqueta: 'quién la describió' },
    zodiacal: { tipo: 'texto', etiqueta: 'zodíaco' },
    origen: { tipo: 'texto', etiqueta: 'origen' },
  },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    const { texto, revision } = await wikitexto('Anexo:Constelaciones');
    const tabla = texto.slice(texto.indexOf('{|'), texto.indexOf('|}', texto.indexOf('{|')));
    const filas = tabla.split(/\n\|-\n/).slice(1).map((f) => f.split('\n').filter((l) => l.startsWith('|')).map((l) => plano(l.slice(1))));
    const validas = filas.filter((f) => f.length >= 6 && IAU.includes(f[2]));
    exigir(validas.length === 88 && iguales(validas.map((f) => f[2]).sort(), [...IAU].sort()), `88 filas con las 88 abreviaturas de la IAU (revisión ${revision} del anexo)`, verificacion);
    // Popularidad: ítem de Wikidata con esa abreviatura (P1813) o, si no la tiene, con el nombre latino.
    const enlaces = new Map();
    for (const f of await sparql(`SELECT ?a ?l ?n WHERE { ?c wdt:P31 wd:Q8928 ; wikibase:sitelinks ?n . OPTIONAL { ?c wdt:P1813 ?a } OPTIONAL { ?c rdfs:label ?l FILTER(LANG(?l) = 'en') } }`)) {
      for (const clave of [f.a, f.l]) if (clave) enlaces.set(clave, Math.max(enlaces.get(clave) ?? 0, Number(f.n)));
    }
    const entidades = validas.map(([latin, espanol, abreviatura, , origen, autor]) => {
      // «Acuario («aguador»)» → «Acuario»; «Aries o Carnero» → «Aries» y alias «Carnero»; sin artículo inicial.
      const limpio = espanol.replace(/\s*\(.*?\)/g, '').trim();
      const [principal, ...otros] = limpio.split(/\s+o\s+/);
      const sinArticulo = (t) => t.replace(/^(El|La|Los|Las)\s+/, '');
      const nombre = sinArticulo(principal);
      if (nombre !== principal) correcciones.push({ entidad: abreviatura, detalle: `«${nombre}» sin el artículo de «${principal}»`, motivo: 'El artículo no forma parte del nombre (igual se acepta escrito con él).' });
      return {
        id: abreviatura,
        nombre,
        alias: limpiarAlias(nombre, [...otros.map(sinArticulo), latin]),
        popularidad: enlaces.get(abreviatura) ?? enlaces.get(latin) ?? enlaces.get(`${latin} (constellation)`) ?? 0,
        atributos: { latin, autor: autor || 'desconocido', zodiacal: ZODIACO.includes(abreviatura) ? 'zodiacal' : 'no zodiacal', origen: /antig/i.test(origen) ? 'antigua' : 'moderna' },
        fuente: `https://es.wikipedia.org/wiki/Anexo:Constelaciones?oldid=${revision}`,
      };
    });
    const porAutor = (a) => entidades.filter((e) => e.atributos.autor === a).length;
    // Lacaille introdujo 14 constelaciones nuevas y dividió Argo Navis en Carina, Puppis y Vela (el anexo
    // le atribuye las tres).
    const deLacaille = entidades.filter((e) => e.atributos.autor === 'Nicolas-Louis de Lacaille').map((e) => e.id);
    exigir(deLacaille.length === 17 && ['Car', 'Pup', 'Vel'].every((a) => deLacaille.includes(a)), `Lacaille: 14 nuevas más Carina, Puppis y Vela (hay ${deLacaille.length})`, verificacion);
    exigir(porAutor('Claudio Ptolomeo') >= 45, `${porAutor('Claudio Ptolomeo')} de Ptolomeo`, verificacion);
    exigir(entidades.find((e) => e.id === 'Cyg').nombre === 'Cisne' && entidades.find((e) => e.id === 'CMa').nombre === 'Can Mayor', 'nombres en español: Cisne, Can Mayor (no los latinos)', verificacion);
    exigir(new Set(entidades.map((e) => normalizar(e.nombre))).size === 88, 'los 88 nombres en español son distintos', verificacion);
    verificacion.push(`${entidades.filter((e) => e.popularidad > 0).length} con popularidad de Wikidata`);
    return {
      entidades,
      correcciones,
      verificacion,
      fuentes: [
        { nombre: 'Wikipedia en español: Anexo:Constelaciones', url: `https://es.wikipedia.org/wiki/Anexo:Constelaciones?oldid=${revision}`, licencia: 'CC BY-SA 4.0', detalle: 'nombres en español, origen y autor (cita IAU y Comellas)' },
        { nombre: 'Unión Astronómica Internacional', url: 'https://www.iau.org/public/themes/constellations/', licencia: 'lista pública', detalle: '88 abreviaturas oficiales (verificación)' },
        { ...WIKIDATA, detalle: 'popularidad' },
      ],
      hoy,
    };
  },
};

// Planetas y planetas enanos reconocidos por la IAU (definición de 2006 y reconocimientos posteriores).
const CUERPOS = { Q308: ['Mercurio', 'planeta'], Q313: ['Venus', 'planeta'], Q2: ['Tierra', 'planeta'], Q111: ['Marte', 'planeta'], Q319: ['Júpiter', 'planeta'], Q193: ['Saturno', 'planeta'], Q324: ['Urano', 'planeta'], Q332: ['Neptuno', 'planeta'], Q596: ['Ceres', 'planeta enano'], Q339: ['Plutón', 'planeta enano'], Q601: ['Haumea', 'planeta enano'], Q604: ['Makemake', 'planeta enano'] };

const sistemaSolar = {
  id: 'sistema_solar',
  nombre: 'Planetas y planetas enanos',
  descripcion: 'Los 8 planetas del sistema solar y los 5 planetas enanos reconocidos por la IAU.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Los 8 planetas y los 5 planetas enanos reconocidos por la Unión Astronómica Internacional (Ceres, Plutón, Haumea, Makemake y Eris).' },
  atributos: { clase: { tipo: 'texto', etiqueta: 'clase' } },
  async importar({ hoy }) {
    const verificacion = [];
    // Eris se busca por su clase (planeta enano) y su designación 136199.
    const eris = await sparql(`SELECT ?e WHERE { ?e wdt:P31 wd:Q2199 ; rdfs:label ?l . FILTER(LANG(?l) = 'en' && STRSTARTS(?l, 'Eris')) }`);
    exigir(eris.length === 1, 'Eris: un único planeta enano con ese nombre', verificacion);
    const ids = [...Object.keys(CUERPOS), qid(eris[0].e)];
    const esperado = { ...CUERPOS, [qid(eris[0].e)]: ['Eris', 'planeta enano'] };
    const et = await etiquetas(ids);
    const entidades = ids.map((id) => {
      const [nombre, clase] = esperado[id];
      const e = et.get(id);
      if (normalizar(e.es ?? '') !== normalizar(nombre)) throw new Error(`Verificación fallida: ${id} se llama «${e.es}» en Wikidata (se esperaba «${nombre}»)`);
      return { id, nombre, alias: limpiarAlias(nombre, e.alias), popularidad: e.enlaces, atributos: { clase }, fuente: urlEntidad(id) };
    });
    exigir(entidades.filter((e) => e.atributos.clase === 'planeta').length === 8 && entidades.length === 13, '8 planetas y 5 planetas enanos, con su nombre en Wikidata', verificacion);
    return { entidades, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'nombres, alias y popularidad' }, { nombre: 'Unión Astronómica Internacional', url: 'https://www.iau.org/public/themes/pluto/', licencia: 'lista pública', detalle: 'definición de planeta y planetas enanos' }], hoy };
  },
};

// ───────────────────────── Más deportes ─────────────────────────

// Campeón de cada Copa de Europa / Champions League (por año de la final), para verificar la fuente.
const CHAMPIONS = 'Real Madrid,Real Madrid,Real Madrid,Real Madrid,Real Madrid,Benfica,Benfica,Milan,Inter,Inter,Real Madrid,Celtic,Manchester United,Milan,Feyenoord,Ajax,Ajax,Ajax,Bayern,Bayern,Bayern,Liverpool,Liverpool,Nottingham,Nottingham,Liverpool,Aston Villa,Hamburgo,Liverpool,Juventus,Steaua,Oporto,PSV,Milan,Milan,Estrella Roja,Barcelona,Marsella,Milan,Ajax,Juventus,Dortmund,Real Madrid,Manchester United,Real Madrid,Bayern,Real Madrid,Milan,Oporto,Liverpool,Barcelona,Milan,Manchester United,Barcelona,Inter,Barcelona,Chelsea,Bayern,Real Madrid,Barcelona,Real Madrid,Real Madrid,Real Madrid,Liverpool,Bayern,Chelsea,Real Madrid,Manchester City,Real Madrid,Paris Saint-Germain'.split(',');
const sinTildes = (t) => normalizar(t);

const campeonesChampions = {
  id: 'campeones_champions',
  nombre: 'Campeones de la Copa de Europa / Champions League',
  descripcion: 'Clubes que ganaron la Copa de Campeones de Europa o la Liga de Campeones de la UEFA, con los años de sus títulos.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Campeones de todas las ediciones desde 1956 (1956–2025 verificadas una por una).' },
  atributos: { titulos: { tipo: 'lista_numeros', etiqueta: 'año del título' } },
  async importar({ hoy }) {
    const verificacion = [];
    const sinVerificar = [];
    const filas = await sparql(`SELECT ?e ?t ?w WHERE { ?e wdt:P3450 wd:Q18756 ; wdt:P582 ?t ; wdt:P1346 ?w }`);
    const porAnio = new Map();
    for (const f of filas) porAnio.set(anio(f.t), new Set([...(porAnio.get(anio(f.t)) ?? []), qid(f.w)]));
    const ids = [...new Set(filas.map((f) => qid(f.w)))];
    const et = await etiquetas(ids);
    CHAMPIONS.forEach((club, i) => {
      const a = 1956 + i;
      const g = [...(porAnio.get(a) ?? [])];
      exigir(g.length === 1 && sinTildes(`${et.get(g[0]).es} ${et.get(g[0]).alias.join(' ')}`).includes(sinTildes(club)), `Champions ${a}: ${club}`, verificacion);
    });
    const ultimo = Math.max(...porAnio.keys());
    for (let a = 1956 + CHAMPIONS.length; a <= ultimo; a++) {
      const g = [...(porAnio.get(a) ?? [])];
      if (g.length !== 1) throw new Error(`Verificación fallida: Champions ${a} tiene ${g.length} campeones en la fuente`);
      sinVerificar.push(`Campeón de la Champions ${a} según Wikidata: ${et.get(g[0]).es} (posterior a la verificación manual)`);
    }
    const titulos = new Map();
    for (const [a, s] of porAnio) for (const id of s) titulos.set(id, [...(titulos.get(id) ?? []), a].sort((x, y) => x - y));
    const entidades = [...titulos].map(([id, anios]) => ({ id, ...nombreYAlias(et.get(id)), popularidad: et.get(id).enlaces, atributos: { titulos: anios }, fuente: urlEntidad(id) }));
    return { entidades, verificacion, sinVerificar, fuentes: [{ ...WIKIDATA, detalle: 'ediciones de la Liga de Campeones (P1346 ganador, P582 fin)' }], hoy };
  },
};

// Mundial femenino: campeona y sedes de cada edición (1991–2023), para verificar la fuente.
const MUNDIAL_FEMENINO = { 1991: ['US', ['CN']], 1995: ['NO', ['SE']], 1999: ['US', ['US']], 2003: ['DE', ['US']], 2007: ['DE', ['CN']], 2011: ['JP', ['DE']], 2015: ['US', ['CA']], 2019: ['US', ['FR']], 2023: ['ES', ['AU', 'NZ']] };

const mundialFemenino = {
  id: 'mundial_femenino',
  nombre: 'Campeonas del Mundial femenino de fútbol',
  descripcion: 'Selecciones campeonas de la Copa Mundial Femenina de la FIFA, con los años de sus títulos.',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  // Las sedes no se incluyen: a la edición 2007 le falta el país sede en la fuente.
  cobertura: { tipo: 'completa', criterio: 'Campeonas de todas las ediciones disputadas, 1991–2023 (verificadas una por una).' },
  atributos: { titulos: { tipo: 'lista_numeros', etiqueta: 'año del título' } },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const filas = await sparql(`SELECT ?ed ?t ?t2 ?ig ?isede WHERE { ?ed wdt:P3450 wd:Q19323 .
      OPTIONAL { ?ed wdt:P585 ?t } OPTIONAL { ?ed wdt:P580 ?t2 }
      OPTIONAL { ?ed wdt:P1346 ?gan . ?gan wdt:P1532 ?pg . ?pg wdt:P297 ?ig }
      OPTIONAL { ?ed wdt:P17 ?sede . ?sede wdt:P297 ?isede } }`);
    const ediciones = new Map();
    for (const f of filas) {
      const a = anio(f.t ?? f.t2);
      if (!MUNDIAL_FEMENINO[a]) continue;
      const e = ediciones.get(a) ?? { campeones: new Set(), sedes: new Set() };
      if (f.ig) e.campeones.add(f.ig);
      if (f.isede) e.sedes.add(f.isede);
      ediciones.set(a, e);
    }
    for (const [a, [campeon, sedes]] of Object.entries(MUNDIAL_FEMENINO)) {
      const e = ediciones.get(Number(a));
      exigir(e && iguales([...e.campeones], [campeon]), `Mundial femenino ${a}: campeón ${campeon}`, verificacion);
      void sedes;
    }
    const paisesPorIso = new Map(catalogos.paises.entidades.map((p) => [p.id, p]));
    const porPais = new Map();
    for (const [a, e] of ediciones) for (const iso of e.campeones) (porPais.get(iso) ?? porPais.set(iso, { titulos: [] }).get(iso)).titulos.push(a);
    const entidades = [...porPais].map(([iso, d]) => {
      const p = paisesPorIso.get(iso);
      return { id: iso, nombre: p.nombre, alias: p.alias, popularidad: p.popularidad, atributos: { titulos: d.titulos.sort() }, fuente: p.fuente };
    });
    return { entidades, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'ediciones de la Copa Mundial Femenina (P1346 ganador, P17 sede)' }], hoy };
  },
};

// ───────────────────────── Argentina ─────────────────────────

// Provincias con frontera internacional (para verificar P47 de Wikidata).
const FRONTERAS_AR = {
  Chile: ['Jujuy', 'Salta', 'Catamarca', 'La Rioja', 'San Juan', 'Mendoza', 'Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego'],
  Bolivia: ['Jujuy', 'Salta'],
  Paraguay: ['Salta', 'Formosa', 'Chaco', 'Corrientes', 'Misiones'],
  Brasil: ['Misiones', 'Corrientes'],
  Uruguay: ['Entre Ríos', 'Corrientes', 'Buenos Aires'],
};

async function jurisdiccionesArgentinas(verificacion) {
  const filas = await sparql(`SELECT DISTINCT ?p WHERE { ?p wdt:P31 wd:Q44753 . FILTER NOT EXISTS { ?p wdt:P576 [] } }`);
  const ids = [...new Set(filas.map((f) => qid(f.p))), 'Q1486'];
  const [et, caps] = await Promise.all([etiquetas(ids), propiedad(ids, 'P36', { vigentes: true })]);
  exigir(ids.length === 24, `${ids.length} jurisdicciones (23 provincias y la Ciudad de Buenos Aires)`, verificacion);
  // Límites (P47): con otras jurisdicciones argentinas o con subdivisiones de otro país (su país, P17).
  const limites = new Map(ids.map((id) => [id, { internos: new Set(), paises: new Set() }]));
  for (const f of await sparql(`SELECT ?p ?v ?pais ?paisl WHERE { VALUES ?p { ${ids.map((i) => `wd:${i}`).join(' ')} } ?p wdt:P47 ?v . OPTIONAL { ?v wdt:P17 ?pais . ?pais rdfs:label ?paisl FILTER(LANG(?paisl) = 'es') } }`)) {
    const v = qid(f.v);
    if (ids.includes(v)) limites.get(qid(f.p)).internos.add(v);
    else if (f.pais && qid(f.pais) !== 'Q414') limites.get(qid(f.p)).paises.add(f.paisl);
  }
  return { ids, et, caps, limites };
}
const nombreProvincia = (t) => t.replace(/^Provincia de(l)?\s+/i, '').replace(/^Tierra del Fuego,.*$/, 'Tierra del Fuego');

const provinciasArgentinas = {
  id: 'provincias_argentinas',
  nombre: 'Provincias argentinas',
  descripcion: 'Las 23 provincias argentinas, con sus provincias vecinas y sus límites internacionales.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  // La Ciudad de Buenos Aires no es una provincia: no es entidad del catálogo ni cuenta como vecina.
  cobertura: { tipo: 'completa', criterio: 'Las 23 provincias argentinas; límites entre provincias simétricos y límites con países vecinos verificados contra el mapa político.' },
  atributos: { limitrofes: { tipo: 'lista', etiqueta: 'país limítrofe' }, vecinas: { tipo: 'lista', etiqueta: 'jurisdicción vecina' } },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    const { ids, et, limites } = await jurisdiccionesArgentinas(verificacion);
    const nombres = new Map(ids.map((id) => [id, id === 'Q1486' ? 'Ciudad de Buenos Aires' : nombreProvincia(et.get(id).es)]));
    const asimetricos = ids.flatMap((a) => [...limites.get(a).internos].filter((b) => !limites.get(b).internos.has(a)).map((b) => `${nombres.get(a)}–${nombres.get(b)}`));
    exigir(!asimetricos.length, `los límites entre jurisdicciones son simétricos (diferencias: ${asimetricos.join(', ') || 'ninguna'})`, verificacion);
    const entidades = ids.filter((id) => id !== 'Q1486').map((id) => {
      const e = et.get(id);
      const nombre = nombres.get(id);
      if (nombre !== e.es) correcciones.push({ entidad: id, detalle: `«${nombre}» en vez de «${e.es}»`, motivo: 'Nombre corto habitual de la jurisdicción.' });
      return { id, nombre, alias: limpiarAlias(nombre, [e.es, ...e.alias]), popularidad: e.enlaces, atributos: { limitrofes: [...limites.get(id).paises].sort(), vecinas: [...limites.get(id).internos].filter((v) => v !== 'Q1486').map((v) => nombres.get(v)).sort() }, fuente: urlEntidad(id) };
    });
    for (const [pais, provincias] of Object.entries(FRONTERAS_AR)) {
      const segun = entidades.filter((e) => e.atributos.limitrofes.includes(pais)).map((e) => e.nombre).sort();
      exigir(iguales(segun, [...provincias].sort()), `limitan con ${pais}: ${provincias.join(', ')}${iguales(segun, [...provincias].sort()) ? '' : ` (la fuente dice: ${segun.join(', ')})`}`, verificacion);
    }
    const cordoba = entidades.find((e) => e.nombre === 'Córdoba').atributos.vecinas;
    exigir(iguales(cordoba, ['Buenos Aires', 'Catamarca', 'La Pampa', 'La Rioja', 'San Luis', 'Santa Fe', 'Santiago del Estero']), `Córdoba limita con ${cordoba.join(', ')}`, verificacion);
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'provincias (P31 Q44753), límites (P47) y país de cada vecino (P17)' }], hoy };
  },
};

const capitalesArgentinas = {
  id: 'capitales_argentinas',
  nombre: 'Capitales de las provincias argentinas',
  descripcion: 'Las capitales de las 23 provincias argentinas.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Las capitales vigentes (P36) de las 23 provincias argentinas.' },
  atributos: { provincia: { tipo: 'texto', etiqueta: 'provincia' } },
  async importar({ hoy }) {
    const verificacion = [];
    const { ids, et, caps } = await jurisdiccionesArgentinas(verificacion);
    const provincias = ids.filter((id) => id !== 'Q1486');
    const capitales = provincias.map((id) => [id, [...new Map(caps.get(id).map((c) => [c.valor.id, c.valor])).values()]]);
    exigir(capitales.every(([, c]) => c.length === 1), 'cada provincia tiene una sola capital vigente', verificacion);
    const capIds = capitales.map(([, [c]]) => c.id);
    const etc = await etiquetas(capIds);
    const entidades = capitales.map(([prov, [c]]) => ({ id: c.id, ...nombreYAlias(etc.get(c.id)), popularidad: etc.get(c.id).enlaces, atributos: { provincia: nombreProvincia(et.get(prov).es) }, fuente: urlEntidad(c.id) }));
    const esperadas = ['La Plata', 'Córdoba', 'Rosario'].slice(0, 2);
    exigir(esperadas.every((n) => entidades.some((e) => e.nombre === n)) && !entidades.some((e) => e.nombre === 'Rosario'), 'La Plata y Córdoba son capitales; Rosario no', verificacion);
    exigir(entidades.length === 23 && new Set(entidades.map((e) => normalizar(e.nombre))).size === 23, '23 capitales distintas', verificacion);
    return { entidades, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'capitales (P36) de las provincias' }], hoy };
  },
};

// ───── Divisiones de primer nivel de otros países ─────

// País (ISO) → tipo de división, clases de Wikidata (P31) y cantidad oficial. Solo las divisiones con ese
// nombre: el Distrito Federal de Brasil o la Ciudad de México no son estados, los territorios de Canadá
// no son provincias. Además, cada una tiene que tener su código ISO 3166-2: así quedan afuera ítems
// históricos sin fecha de fin (departamento de Panamá en Colombia) y reclamos (Guayana Esequiba).
// `agregar` suma, con su motivo, divisiones vigentes que Wikidata tiene incompletas.
const DIVISIONES = {
  US: { tipo: 'estado', clases: ['Q35657'], cantidad: 50 },
  MX: { tipo: 'estado', clases: ['Q15149663'], cantidad: 31 },
  BR: { tipo: 'estado', clases: ['Q485258'], cantidad: 26, excluir: { 'BR-DF': 'El Distrito Federal no es un estado.' } },
  VE: { tipo: 'estado', clases: ['Q501094'], cantidad: 23 },
  DE: { tipo: 'estado', clases: ['Q1221156'], cantidad: 16 },
  AU: { tipo: 'estado', clases: ['Q5852411'], cantidad: 6 },
  IN: { tipo: 'estado', clases: ['Q12443800'], cantidad: 28 },
  UY: { tipo: 'departamento', clases: ['Q56059'], cantidad: 19 },
  CO: { tipo: 'departamento', clases: ['Q215655'], cantidad: 32 },
  PY: { tipo: 'departamento', clases: ['Q815068'], cantidad: 17 },
  BO: { tipo: 'departamento', clases: ['Q250050'], cantidad: 9 },
  CL: { tipo: 'región', clases: ['Q590080'], cantidad: 16 },
  IT: { tipo: 'región', clases: ['Q16110', 'Q1710033'], cantidad: 20 },
  FR: { tipo: 'región', clases: ['Q36784'], cantidad: 18 },
  ES: {
    tipo: 'provincia', clases: ['Q162620'], cantidad: 50,
    agregar: {
      Q31844097: 'La provincia de La Rioja (ES-LO) no tiene su código ISO 3166-2 en Wikidata.',
      Q107356469: 'Wikidata clasifica la provincia de Baleares (ES-PM) como histórica, pero sigue siendo una de las 50 provincias (INE).',
    },
  },
  CA: { tipo: 'provincia', clases: ['Q11828004'], cantidad: 10 },
  EC: { tipo: 'provincia', clases: ['Q719987'], cantidad: 24 },
  JP: { tipo: 'prefectura', clases: ['Q50337'], cantidad: 47 },
};
// Formas cortas habituales que no están como alias en Wikidata (además, se acepta el nombre en inglés).
const ALIAS_DIVISION = { 'Magallanes y de la Antártica Chilena': ['Magallanes'], 'Aysén del General Carlos Ibáñez del Campo': ['Aysén'], 'Región Metropolitana de Santiago': ['Región Metropolitana', 'Metropolitana'], 'Libertador General Bernardo O\'Higgins': ['O\'Higgins'] };
// Capitales que no se usan: la de Tokio es la propia metrópolis (Wikidata da Shinjuku, que es un barrio).
const SIN_CAPITALES = { JP: 'La capital de la prefectura de Tokio es la propia metrópolis; Wikidata da un barrio (Shinjuku).' };
// Se quita el tipo de división delante del nombre («Provincia de La Coruña» → «La Coruña», «Estado
// Barinas» → «Barinas», «Departamento Central» → «Central»). «Estado de México» es el nombre del estado.
const PREFIJO_DIVISION = /^(?:(?:estado|departamento|región|provincia|prefectura)\s+(?:del?\s+)(?!México$)|(?:estado|departamento)\s+(?!de\s))/i;

async function divisionesDePaises(verificacion, correcciones, paises) {
  const porIso = new Map(paises.entidades.map((p) => [p.id, p]));
  const divisiones = [];
  for (const [iso, d] of Object.entries(DIVISIONES)) {
    const item = porIso.get(iso).atributos.wikidata;
    const filas = await sparql(`SELECT DISTINCT ?i ?cod WHERE { VALUES ?clase { ${d.clases.map((c) => `wd:${c}`).join(' ')} } ?i wdt:P31 ?clase ; wdt:P17 wd:${item} . OPTIONAL { ?i wdt:P300 ?cod } FILTER NOT EXISTS { ?i wdt:P576 [] } }`);
    const excluida = (f) => d.excluir?.[f.cod];
    for (const f of filas.filter(excluida)) correcciones.push({ entidad: qid(f.i), detalle: 'se excluye', motivo: excluida(f) });
    const conCodigo = new Set(filas.filter((f) => f.cod?.startsWith(`${iso}-`)).map((f) => qid(f.i)));
    const sinCodigo = [...new Set(filas.filter((f) => !conCodigo.has(qid(f.i))).map((f) => qid(f.i)))].filter((id) => !d.agregar?.[id]);
    if (sinCodigo.length) verificacion.push(`${porIso.get(iso).nombre}: se descartan ${sinCodigo.length} ítem(s) sin código ISO 3166-2 (${sinCodigo.join(', ')})`);
    for (const [id, motivo] of Object.entries(d.agregar ?? {})) correcciones.push({ entidad: id, detalle: 'se agrega', motivo });
    const ids = [...new Set([...filas.filter((f) => conCodigo.has(qid(f.i)) && !excluida(f)).map((f) => qid(f.i)), ...Object.keys(d.agregar ?? {})])];
    const pais = porIso.get(iso).nombre;
    exigir(ids.length === d.cantidad, `${pais}: ${ids.length} ${d.tipo === 'región' ? 'regiones' : `${d.tipo}s`} (se esperan ${d.cantidad})`, verificacion);
    for (const id of ids) divisiones.push({ id, iso, pais, tipo: d.tipo });
  }
  const ids = divisiones.map((x) => x.id);
  const [et, caps] = await Promise.all([etiquetas(ids), propiedad(ids, 'P36', { vigentes: true })]);
  const sinNombre = divisiones.filter((x) => !et.get(x.id).es).map((x) => `${x.id} (${x.pais})`);
  exigir(!sinNombre.length, `todas tienen nombre en español${sinNombre.length ? ` (faltan: ${sinNombre.join(', ')})` : ''}`, verificacion);
  for (const x of divisiones) {
    const e = et.get(x.id);
    x.nombre = e.es.replace(PREFIJO_DIVISION, '');
    if (x.nombre !== e.es) correcciones.push({ entidad: x.id, detalle: `«${x.nombre}» en vez de «${e.es}»`, motivo: 'Sin el tipo de división delante (igual se acepta escrito con él).' });
    x.alias = limpiarAlias(x.nombre, [e.es, ...(ALIAS_DIVISION[x.nombre] ?? []), ...e.alias, ...(e.en ? [e.en] : [])]);
    x.popularidad = e.enlaces;
    x.capitales = [...new Map(caps.get(x.id).map((c) => [c.valor.id, c.valor])).values()].filter((c) => c.id);
  }
  return divisiones;
}

const subdivisiones = {
  id: 'subdivisiones',
  nombre: 'Estados, provincias, regiones y departamentos de otros países',
  descripcion: 'Las divisiones de primer nivel de 18 países (estados de Estados Unidos, México, Brasil…; departamentos de Uruguay, Colombia…; regiones de Chile, Italia y Francia; provincias de España, Canadá y Ecuador; prefecturas de Japón).',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Todas las divisiones de primer nivel vigentes de cada uno de los 18 países (clase de Wikidata de ese tipo de división), con la cantidad oficial verificada país por país.' },
  atributos: { pais: { tipo: 'texto', etiqueta: 'país' }, tipo: { tipo: 'texto', etiqueta: 'tipo de división' } },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const correcciones = [];
    const divisiones = await divisionesDePaises(verificacion, correcciones, catalogos.paises);
    for (const iso of Object.keys(DIVISIONES)) {
      const nombres = divisiones.filter((x) => x.iso === iso).map((x) => normalizar(x.nombre));
      exigir(new Set(nombres).size === nombres.length, `${catalogos.paises.entidades.find((p) => p.id === iso).nombre}: los nombres no se repiten`, verificacion);
    }
    const esperados = { US: ['Texas', 'California', 'Alaska'], MX: ['Jalisco', 'Estado de México', 'Yucatán'], ES: ['Barcelona', 'Asturias', 'Navarra'], CL: ['Biobío', 'Magallanes'] };
    for (const [iso, lista] of Object.entries(esperados)) {
      const de = divisiones.filter((x) => x.iso === iso);
      const faltan = lista.filter((n) => !de.some((x) => x.nombre.includes(n)));
      exigir(!faltan.length, `${de[0]?.pais}: incluye ${lista.join(', ')}${faltan.length ? ` (faltan ${faltan.join(', ')})` : ''}`, verificacion);
    }
    const entidades = divisiones.map((x) => ({ id: x.id, nombre: x.nombre, alias: x.alias, popularidad: x.popularidad, atributos: { pais: x.pais, tipo: x.tipo }, fuente: urlEntidad(x.id) }));
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'divisiones de primer nivel (P31 por país), nombres y popularidad' }], hoy };
  },
};

const capitalesSubdivisiones = {
  id: 'capitales_subdivisiones',
  nombre: 'Capitales de estados, provincias, regiones y departamentos',
  descripcion: 'Las capitales de las divisiones de primer nivel del catálogo «subdivisiones» (salvo las prefecturas de Japón).',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'La capital vigente (P36) de cada división de primer nivel de 17 países: si a una división le falta, o tiene más de una, ese país queda afuera entero.' },
  atributos: { pais: { tipo: 'texto', etiqueta: 'país' }, tipo: { tipo: 'texto', etiqueta: 'tipo de división' }, division: { tipo: 'texto', etiqueta: 'división' } },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const divisiones = await divisionesDePaises(verificacion, [], catalogos.paises);
    const correcciones = Object.entries(SIN_CAPITALES).map(([iso, motivo]) => ({ entidad: iso, detalle: 'sin capitales', motivo }));
    const paises = [...new Set(divisiones.map((x) => x.iso))].filter((iso) => !SIN_CAPITALES[iso]);
    const usados = [];
    for (const iso of paises) {
      const de = divisiones.filter((x) => x.iso === iso);
      const malas = de.filter((x) => x.capitales.length !== 1).map((x) => `${x.nombre} (${x.capitales.length})`);
      if (malas.length) {
        verificacion.push(`${de[0].pais} queda afuera: capital faltante o múltiple en ${malas.join(', ')}`);
        continue;
      }
      usados.push(iso);
    }
    const elegidas = divisiones.filter((x) => usados.includes(x.iso));
    const ids = [...new Set(elegidas.map((x) => x.capitales[0].id))];
    exigir(ids.length === elegidas.length, 'ninguna ciudad es capital de dos divisiones', verificacion);
    const et = await etiquetas(ids);
    const entidades = elegidas.map((x) => {
      const c = x.capitales[0];
      const n = nombreYAlias(et.get(c.id));
      return { id: c.id, ...n, popularidad: et.get(c.id).enlaces, atributos: { pais: x.pais, tipo: x.tipo, division: x.nombre }, fuente: urlEntidad(c.id) };
    });
    exigir(entidades.every((e) => e.nombre), 'todas las capitales tienen nombre en español', verificacion);
    exigir(usados.length >= 12, `${usados.length} países con todas sus capitales (se esperan al menos 12)`, verificacion);
    for (const [division, capital] of [['Texas', 'Austin'], ['Jalisco', 'Guadalajara'], ['Córdoba', 'Montería']]) {
      const e = entidades.find((x) => x.atributos.division === division);
      if (e) exigir(e.nombre === capital, `la capital de ${division} es ${capital}`, verificacion);
    }
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'capitales (P36) de las divisiones de primer nivel' }], hoy };
  },
};

// ───── Departamentos y partidos de la Argentina ─────

const GEOREF = 'https://apis.datos.gob.ar/georef/api/departamentos?max=1000&campos=id,nombre,provincia.nombre,categoria&formato=json';
// Cantidad por provincia según el Servicio de Normalización de Datos Geográficos (IGN), sin las 15 comunas porteñas.
const DEPARTAMENTOS_POR_PROVINCIA = { 'Buenos Aires': 135, Catamarca: 16, Chaco: 25, Chubut: 15, Córdoba: 26, Corrientes: 25, 'Entre Ríos': 17, Formosa: 9, Jujuy: 16, 'La Pampa': 22, 'La Rioja': 18, Mendoza: 18, Misiones: 17, Neuquén: 16, 'Río Negro': 13, Salta: 23, 'San Juan': 19, 'San Luis': 9, 'Santa Cruz': 7, 'Santa Fe': 19, 'Santiago del Estero': 27, 'Tierra del Fuego': 5, Tucumán: 17 };

const departamentosArgentinos = {
  id: 'departamentos_argentinos',
  nombre: 'Departamentos y partidos de la Argentina',
  descripcion: 'Los 135 partidos de la provincia de Buenos Aires y los 379 departamentos de las otras 22 provincias.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Todas las unidades de segundo nivel de las 23 provincias según el Servicio de Normalización de Datos Geográficos (fuente: IGN), con la cantidad verificada provincia por provincia. La Ciudad de Buenos Aires (comunas) no es provincia.' },
  atributos: { provincia: { tipo: 'texto', etiqueta: 'provincia' }, tipo: { tipo: 'texto', etiqueta: 'tipo' } },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    const datos = await descargar(GEOREF, { json: true });
    const filas = datos.departamentos.filter((d) => d.categoria !== 'Comuna');
    const provinciaDe = (n) => nombreProvincia(n);
    const porProvincia = {};
    for (const d of filas) porProvincia[provinciaDe(d.provincia.nombre)] = (porProvincia[provinciaDe(d.provincia.nombre)] ?? 0) + 1;
    for (const [p, n] of Object.entries(DEPARTAMENTOS_POR_PROVINCIA)) exigir(porProvincia[p] === n, `${p}: ${porProvincia[p] ?? 0} ${p === 'Buenos Aires' ? 'partidos' : 'departamentos'} (se esperan ${n})`, verificacion);
    exigir(filas.length === 514, `${filas.length} departamentos y partidos (135 + 379)`, verificacion);
    exigir(filas.filter((d) => d.categoria === 'Partido').every((d) => provinciaDe(d.provincia.nombre) === 'Buenos Aires'), 'los partidos son todos de Buenos Aires', verificacion);
    // Popularidad: artículos en Wikipedia del ítem de Wikidata con el mismo nombre en la misma provincia.
    const wd = await sparql(`SELECT ?i ?l ?pl ?n WHERE { VALUES ?clase { wd:Q952274 wd:Q13997861 } ?i wdt:P31 ?clase ; wdt:P131 ?p ; rdfs:label ?l ; wikibase:sitelinks ?n . FILTER(LANG(?l) = "es") ?p rdfs:label ?pl . FILTER(LANG(?pl) = "es") }`);
    const clave = (prov, nombre) => `${normalizar(provinciaDe(prov))}|${normalizar(nombre.replace(/^(partido|departamento)\s+(de\s+)?/i, '').replace(/\s*\(.*\)$/, ''))}`;
    const enlaces = new Map();
    for (const f of wd) enlaces.set(clave(f.pl, f.l), { n: Math.max(Number(f.n), enlaces.get(clave(f.pl, f.l))?.n ?? 0), id: qid(f.i) });
    const entidades = filas.map((d) => {
      const provincia = provinciaDe(d.provincia.nombre);
      const w = enlaces.get(clave(d.provincia.nombre, d.nombre));
      return { id: d.id, nombre: d.nombre, alias: [], popularidad: w?.n ?? 0, atributos: { provincia, tipo: d.categoria.toLowerCase() }, fuente: w ? urlEntidad(w.id) : `https://apis.datos.gob.ar/georef/api/departamentos?id=${d.id}` };
    });
    const conPopularidad = entidades.filter((e) => e.popularidad > 0).length;
    verificacion.push(`${conPopularidad} de ${entidades.length} con artículo en Wikipedia (el resto, popularidad 0)`);
    exigir(conPopularidad >= entidades.length * 0.8, 'al menos el 80 % se encontró en Wikidata', verificacion);
    exigir(entidades.some((e) => e.nombre === 'La Matanza' && e.atributos.provincia === 'Buenos Aires') && entidades.some((e) => e.nombre === 'Capital' && e.atributos.provincia === 'Córdoba'), 'incluye La Matanza (Buenos Aires) y Capital (Córdoba)', verificacion);
    return {
      entidades,
      correcciones,
      verificacion,
      fuentes: [
        { nombre: 'Servicio de Normalización de Datos Geográficos de Argentina (Georef)', url: 'https://apis.datos.gob.ar/georef/api/departamentos', licencia: 'CC BY 4.0', detalle: 'departamentos y partidos (fuente: Instituto Geográfico Nacional)' },
        { ...WIKIDATA, detalle: 'popularidad (artículos en Wikipedia)' },
      ],
      hoy,
    };
  },
};

// ───────────────────────── Informática ─────────────────────────

const elementosHtml = {
  id: 'elementos_html',
  nombre: 'Elementos de HTML',
  descripcion: 'Los elementos del estándar HTML vigente (índice de elementos de WHATWG).',
  popularidad: { criterio: 'Sin dato de popularidad: todos valen 0 y la rareza sigue el orden alfabético (estable).', nota: 'No es una estadística de uso.' },
  cobertura: { tipo: 'completa', criterio: 'Todos los elementos de la tabla «List of elements» del HTML Living Standard (sin los obsoletos).' },
  atributos: { descripcion: { tipo: 'texto', etiqueta: 'descripción' } },
  async importar({ hoy }) {
    const verificacion = [];
    const html = await descargar('https://html.spec.whatwg.org/multipage/indices.html');
    const i = html.indexOf('<caption>List of elements');
    const tabla = html.slice(i, html.indexOf('</table>', i));
    const entidades = [];
    for (const fila of tabla.split('<tr>').slice(1)) {
      const th = fila.match(/<th>([\s\S]*?)<td>([\s\S]*?)<td>/);
      if (!th) continue;
      const descripcion = th[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      for (const [, nombre] of th[1].matchAll(/>([a-z][a-z0-9]*)<\/a><\/code>/g)) entidades.push({ id: nombre, nombre, alias: [`<${nombre}>`], popularidad: 0, atributos: { descripcion } });
    }
    exigir(entidades.length >= 100 && ['a', 'div', 'span', 'table', 'h1', 'h6', 'img', 'video', 'template'].every((n) => entidades.some((e) => e.nombre === n)), `${entidades.length} elementos (incluidos a, div, span, table, h1–h6, img, video, template)`, verificacion);
    exigir(!entidades.some((e) => ['font', 'center', 'marquee', 'blink'].includes(e.nombre)), 'sin elementos obsoletos (font, center, marquee)', verificacion);
    return {
      entidades,
      verificacion,
      fuentes: [{ nombre: 'WHATWG HTML Living Standard', url: 'https://html.spec.whatwg.org/multipage/indices.html#elements-3', licencia: 'CC BY 4.0', detalle: `índice de elementos (huella ${sha(tabla).slice(0, 12)})` }],
      fuenteEntidades: 'https://html.spec.whatwg.org/multipage/indices.html#elements-3',
      hoy,
    };
  },
};

const CLASES_HTTP = { 1: 'información', 2: 'éxito', 3: 'redirección', 4: 'error del cliente', 5: 'error del servidor' };
const codigosHttp = {
  id: 'codigos_http',
  nombre: 'Códigos de estado HTTP',
  descripcion: 'Los códigos de estado HTTP registrados por la IANA, con su clase.',
  popularidad: { criterio: 'Sin dato de popularidad: todos valen 0 y la rareza sigue el número de código (estable).', nota: 'No es una estadística de uso.' },
  cobertura: { tipo: 'completa', criterio: 'Todos los códigos asignados en el registro «HTTP Status Code Registry» de la IANA (sin los rangos sin asignar ni los temporales).' },
  atributos: { clase: { tipo: 'texto', etiqueta: 'clase' } },
  async importar({ hoy }) {
    const verificacion = [];
    const csv = await descargar('https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv');
    const entidades = leerCsv(csv)
      .filter((f) => /^\d{3}$/.test(f.Value) && f.Description && !/^(Unassigned|\(Unused\))$/.test(f.Description) && !/TEMPORARY/i.test(f.Description))
      .map((f) => ({ id: f.Value, nombre: `${f.Value} ${f.Description}`, alias: [f.Value, f.Description], popularidad: 0, atributos: { clase: CLASES_HTTP[f.Value[0]] } }));
    exigir(['200 OK', '301 Moved Permanently', '404 Not Found', '500 Internal Server Error', '418 (Unused)'].filter((n) => entidades.some((e) => e.nombre === n)).length === 4, 'están 200, 301, 404 y 500 (y no los marcados como sin uso)', verificacion);
    exigir(entidades.every((e) => e.atributos.clase), 'todos tienen clase (1xx a 5xx)', verificacion);
    return {
      entidades,
      verificacion,
      fuentes: [{ nombre: 'IANA HTTP Status Code Registry', url: 'https://www.iana.org/assignments/http-status-codes/', licencia: 'registro público de la IANA', detalle: `http-status-codes-1.csv (huella ${sha(csv).slice(0, 12)})` }],
      fuenteEntidades: 'https://www.iana.org/assignments/http-status-codes/',
      hoy,
    };
  },
};

// ───────────────────────── Monedas ─────────────────────────

const monedas = {
  id: 'monedas',
  nombre: 'Monedas de los países',
  descripcion: 'Las monedas que usan los 195 países del catálogo «paises», con dónde se usan.',
  depende: ['paises'],
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'La moneda de cada uno de los 195 países según GeoNames, con su nombre en español de CLDR.' },
  atributos: { paises: { tipo: 'lista', etiqueta: 'país donde se usa' }, continentes: { tipo: 'lista', etiqueta: 'continente donde se usa' } },
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const porMoneda = new Map();
    for (const p of catalogos.paises.entidades) {
      const m = porMoneda.get(p.atributos.monedaIso) ?? { nombre: p.atributos.moneda, paises: new Set(), continentes: new Set() };
      m.paises.add(p.nombre);
      m.continentes.add(p.atributos.continente);
      porMoneda.set(p.atributos.monedaIso, m);
    }
    const nombres = [...porMoneda.values()].map((m) => m.nombre);
    const enlaces = new Map();
    for (const f of await sparql(`SELECT ?c ?n WHERE { VALUES ?c { ${[...porMoneda.keys()].map((c) => `"${c}"`).join(' ')} } ?m wdt:P498 ?c ; wikibase:sitelinks ?n }`)) enlaces.set(f.c, Math.max(enlaces.get(f.c) ?? 0, Number(f.n)));
    const entidades = [...porMoneda].map(([iso, m]) => ({ id: iso, nombre: capitalizar(m.nombre), alias: [], popularidad: enlaces.get(iso) ?? 0, atributos: { paises: [...m.paises].sort(), continentes: [...m.continentes].sort() } }));
    exigir(new Set(nombres).size === nombres.length, `${entidades.length} monedas con nombres distintos`, verificacion);
    exigir(porMoneda.get('EUR').paises.size >= 20, `el euro se usa en ${porMoneda.get('EUR').paises.size} países del catálogo`, verificacion);
    return {
      entidades,
      verificacion,
      fuentes: [{ nombre: 'GeoNames', url: 'https://www.geonames.org', licencia: 'CC BY 4.0', detalle: 'moneda de cada país' }, { nombre: `Unicode CLDR ${CLDR}`, url: 'https://cldr.unicode.org', licencia: 'Unicode License v3', detalle: 'nombres en español' }, { ...WIKIDATA, detalle: 'popularidad (P498, código ISO 4217)' }],
      fuenteEntidades: 'https://www.geonames.org/countries/',
      hoy,
    };
  },
};

// ───────────────────────── Videojuegos ─────────────────────────

const POKEAPI = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const GENERACIONES = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena'];
const POR_GENERACION = [151, 100, 135, 107, 156, 72, 88, 96, 120];

function leerCsv(texto) {
  const [cabecera, ...filas] = texto.trim().split('\n');
  const columnas = cabecera.split(',');
  return filas.map((linea) => {
    const valores = [];
    let actual = '';
    let comillas = false;
    for (const ch of linea) {
      if (ch === '"') comillas = !comillas;
      else if (ch === ',' && !comillas) {
        valores.push(actual);
        actual = '';
      } else actual += ch;
    }
    valores.push(actual);
    return Object.fromEntries(columnas.map((c, i) => [c, valores[i] ?? '']));
  });
}

const pokemon = {
  id: 'pokemon',
  nombre: 'Pokémon',
  descripcion: 'Todas las especies de Pokémon de las nueve generaciones, con sus tipos.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Las 1025 especies de la Pokédex Nacional (generaciones 1 a 9), con nombre y tipos en español según PokeAPI.' },
  atributos: {
    generacion: { tipo: 'texto', etiqueta: 'generación' },
    tipos: { tipo: 'lista', etiqueta: 'tipo' },
    especial: { tipo: 'texto', etiqueta: 'clase' },
  },
  async importar({ hoy }) {
    const verificacion = [];
    const [especies, nombres, tipos, nombresTipo] = await Promise.all(['pokemon_species', 'pokemon_species_names', 'pokemon_types', 'type_names'].map((f) => descargar(`${POKEAPI}/${f}.csv`).then(leerCsv)));
    const ES = '7';
    const EN = '9';
    const nombreEs = new Map(nombres.filter((n) => n.local_language_id === ES).map((n) => [n.pokemon_species_id, n.name]));
    const nombreEn = new Map(nombres.filter((n) => n.local_language_id === EN).map((n) => [n.pokemon_species_id, n.name]));
    const tipoEs = new Map(nombresTipo.filter((n) => n.local_language_id === ES).map((n) => [n.type_id, n.name]));
    exigir(nombreEs.get('1') === 'Bulbasaur' && tipoEs.get('10') === 'Fuego' && tipoEs.get('11') === 'Agua', 'idioma 7 de PokeAPI es el español (Bulbasaur, Fuego, Agua)', verificacion);
    const tiposDe = new Map();
    for (const t of tipos) {
      if (Number(t.pokemon_id) > 1025) continue; // formas alternativas: se usa la forma por defecto de cada especie
      tiposDe.set(t.pokemon_id, [...(tiposDe.get(t.pokemon_id) ?? []), [Number(t.slot), tipoEs.get(t.type_id)]]);
    }
    exigir(especies.length === 1025, `${especies.length} especies`, verificacion);
    const conteo = GENERACIONES.map((_, i) => especies.filter((e) => Number(e.generation_id) === i + 1).length);
    exigir(iguales(conteo, POR_GENERACION), `especies por generación: ${conteo.join(', ')}`, verificacion);
    // Popularidad: artículos de Wikipedia del ítem de Wikidata con ese número en la Pokédex Nacional
    // (P1685 «índice Pokémon» con catálogo P972 = Pokédex Nacional, Q20005020).
    const enlaces = new Map();
    for (const f of await sparql(`SELECT ?n ?s WHERE { ?p p:P1685 ?st . ?st ps:P1685 ?n ; pq:P972 wd:Q20005020 . ?p wikibase:sitelinks ?s }`)) {
      const n = String(Number(f.n));
      enlaces.set(n, Math.max(enlaces.get(n) ?? 0, Number(f.s)));
    }
    // Nidoran♀ y Nidoran♂ se escriben igual sin el símbolo: se nombran por su sexo.
    const correcciones = [];
    const RENOMBRAR = { 29: 'Nidoran hembra', 32: 'Nidoran macho' };
    const entidades = especies.map((e) => {
      let nombre = nombreEs.get(e.id);
      if (RENOMBRAR[e.id]) {
        correcciones.push({ entidad: e.id, detalle: `«${RENOMBRAR[e.id]}» en vez de «${nombre}»`, motivo: 'Sin el símbolo ♀/♂ los dos nombres son iguales.' });
        nombre = RENOMBRAR[e.id];
      }
      const ts = (tiposDe.get(e.id) ?? []).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
      const especial = e.is_mythical === '1' ? 'singular' : e.is_legendary === '1' ? 'legendario' : 'común';
      return { id: e.id, nombre, alias: limpiarAlias(nombre ?? '', [nombreEn.get(e.id)]), popularidad: enlaces.get(e.id) ?? 0, atributos: { generacion: GENERACIONES[Number(e.generation_id) - 1], tipos: ts, especial }, fuente: `https://pokeapi.co/api/v2/pokemon-species/${e.id}` };
    });
    exigir(entidades.every((e) => e.nombre && e.atributos.tipos.length >= 1 && e.atributos.tipos.length <= 2 && e.atributos.tipos.every(Boolean)), 'todas tienen nombre en español y uno o dos tipos', verificacion);
    exigir(new Set(entidades.flatMap((e) => e.atributos.tipos)).size === 18, '18 tipos', verificacion);
    const pikachu = entidades.find((e) => e.id === '25');
    exigir(pikachu.nombre === 'Pikachu' && pikachu.atributos.tipos.join() === 'Eléctrico' && pikachu.atributos.generacion === 'primera', 'Pikachu: eléctrico, primera generación', verificacion);
    exigir(entidades.filter((e) => e.popularidad > 0).length > 1000, `${entidades.filter((e) => e.popularidad > 0).length} con popularidad de Wikidata (P1685, Pokédex Nacional)`, verificacion);
    exigir(new Set(entidades.map((e) => normalizar(e.nombre))).size === 1025, 'los 1025 nombres son distintos', verificacion);
    return {
      entidades,
      correcciones,
      verificacion,
      fuentes: [
        { nombre: 'PokeAPI', url: 'https://github.com/PokeAPI/pokeapi', licencia: 'BSD 3-Clause (datos del repositorio)', detalle: 'pokemon_species, pokemon_species_names, pokemon_types, type_names' },
        { ...WIKIDATA, detalle: 'popularidad (P1685 en la Pokédex Nacional)' },
      ],
      hoy,
    };
  },
};

export const DEFINICIONES = [paises, capitales, elementos, papas, presidentesEeuu, secretariosOnu, campeonesMundial, sedesMundial, campeonesF1, oscarPelicula, canciones, nobelLiteratura, cervantes, palabras, idiomas, pokemon, constelaciones, sistemaSolar, campeonesChampions, mundialFemenino, provinciasArgentinas, capitalesArgentinas, subdivisiones, capitalesSubdivisiones, departamentosArgentinos, elementosHtml, codigosHttp, monedas, ...NUEVAS];
