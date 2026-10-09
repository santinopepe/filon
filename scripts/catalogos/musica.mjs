// Catálogos de música: instrumentos (Wikidata, clasificación Hornbostel-Sachs), y discografías, artistas e
// integrantes de bandas (MusicBrainz, CC0). «bandas_argentinas» es una vista de «artistas_musicales».
// Solo se ejecuta al importar.
import { sparql, etiquetas, qid, urlEntidad } from './wikidata.mjs';
import { descargar, limpiarAlias } from './comun.mjs';
import { normalizar } from '../../servidor/normalizar.js';
import { WIKIDATA, POPULARIDAD_WIKIPEDIA, exigir, familiaridadPorEnlaces, enLotes } from './ayudas.mjs';

// ───────────────────────── Instrumentos ─────────────────────────

const MIN_INSTRUMENTOS = 15;
// Primera cifra de la clasificación Hornbostel-Sachs (P1762) → familia, con su nombre de uso común.
const FAMILIAS_HS = { 1: 'idiófonos', 2: 'membranófonos', 3: 'cordófonos', 4: 'aerófonos', 5: 'electrófonos' };

const instrumentosMusicales = {
  id: 'instrumentos_musicales',
  nombre: 'Instrumentos musicales',
  descripcion: `Instrumentos con clasificación Hornbostel-Sachs en Wikidata y artículo en al menos ${MIN_INSTRUMENTOS} ediciones de Wikipedia.`,
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: `Todos los ítems de Wikidata con clasificación Hornbostel-Sachs (P1762), nombre en español y artículo en al menos ${MIN_INSTRUMENTOS} ediciones de Wikipedia, salvo las categorías genéricas («instrumento de viento»).` },
  atributos: { familias: { tipo: 'lista', etiqueta: 'familia (Hornbostel-Sachs)' }, codigos: { tipo: 'lista', etiqueta: 'código Hornbostel-Sachs' } },
  async importar({ hoy }) {
    const verificacion = [];
    const correcciones = [];
    const filas = await sparql(`SELECT DISTINCT ?i ?hs WHERE { ?i wdt:P1762 ?hs ; wikibase:sitelinks ?s . FILTER(?s >= ${MIN_INSTRUMENTOS}) }`);
    const codigos = new Map();
    for (const f of filas) codigos.set(qid(f.i), [...(codigos.get(qid(f.i)) ?? []), f.hs]);
    const et = await etiquetas([...codigos.keys()]);
    const entidades = [];
    for (const [id, cs] of codigos) {
      const e = et.get(id);
      if (!e.es) {
        correcciones.push({ entidad: id, detalle: `se omite «${e.en}»`, motivo: 'Sin nombre en español en Wikidata.' });
        continue;
      }
      // Las categorías («instrumento de viento», «instrumentos de cuerda») no son instrumentos.
      if (/^instrumentos?\b/i.test(e.es)) {
        correcciones.push({ entidad: id, detalle: `se omite «${e.es}»`, motivo: 'Es una categoría de instrumentos, no un instrumento.' });
        continue;
      }
      const familias = [...new Set(cs.map((c) => FAMILIAS_HS[String(c).trim()[0]]).filter(Boolean))].sort();
      entidades.push({ id, nombre: e.es, alias: limpiarAlias(e.es, e.alias), popularidad: e.enlaces, atributos: { familias, codigos: [...new Set(cs)].sort() }, fuente: urlEntidad(id) });
    }
    const familia = (n) => entidades.find((e) => e.nombre === n)?.atributos.familias ?? [];
    exigir(familia('guitarra').includes('cordófonos') && familia('trompeta').includes('aerófonos') && familia('xilófono').includes('idiófonos'), 'guitarra: cordófono; trompeta: aerófono; xilófono: idiófono', verificacion);
    exigir(entidades.every((e) => e.atributos.familias.length), `${entidades.length} instrumentos, todos con familia`, verificacion);
    for (const f of Object.values(FAMILIAS_HS)) verificacion.push(`${entidades.filter((e) => e.atributos.familias.includes(f)).length} ${f}`);
    return { entidades, correcciones, verificacion, fuentes: [{ ...WIKIDATA, detalle: 'instrumentos con clasificación Hornbostel-Sachs (P1762), alias y popularidad' }], hoy };
  },
};

// ───────────────────────── MusicBrainz ─────────────────────────

const MB = 'https://musicbrainz.org/ws/2';
const mb = (ruta) => descargar(`${MB}/${ruta}${ruta.includes('?') ? '&' : '?'}fmt=json`, { json: true, cabeceras: { accept: 'application/json' } });
const MUSICBRAINZ = { nombre: 'MusicBrainz', url: 'https://musicbrainz.org', licencia: 'CC0 1.0 (datos centrales)' };

// Artistas semilla (con el país de MusicBrainz para desambiguar): sus discografías y, si son bandas, sus
// integrantes con los períodos documentados. Mezcla de rock y pop argentino, latinoamericano e internacional.
const ARTISTAS = [
  ['Soda Stereo', 'AR'], ['Charly García', 'AR'], ['Luis Alberto Spinetta', 'AR'], ['Fito Páez', 'AR'], ['Gustavo Cerati', 'AR'],
  ['Patricio Rey y sus Redonditos de Ricota', 'AR'], ['Indio Solari', 'AR'], ['Sui Generis', 'AR'], ['Serú Girán', 'AR'], ['Almendra', 'AR'],
  ['Pescado Rabioso', 'AR'], ['Sumo', 'AR'], ['Divididos', 'AR'], ['Los Fabulosos Cadillacs', 'AR'], ['Los Auténticos Decadentes', 'AR'],
  ['La Renga', 'AR'], ['Los Piojos', 'AR'], ['Bersuit Vergarabat', 'AR'], ['Babasónicos', 'AR'], ['Andrés Calamaro', 'AR'],
  ['Los Abuelos de la Nada', 'AR'], ['Virus', 'AR'], ['Los Pericos', 'AR'], ['Attaque 77', 'AR'], ['Callejeros', 'AR'],
  ['Mercedes Sosa', 'AR'], ['Atahualpa Yupanqui', 'AR'], ['León Gieco', 'AR'], ['Abel Pintos', 'AR'], ['Ciro y los Persas', 'AR'],
  ['Miranda!', 'AR'], ['Tan Biónica', 'AR'], ['Airbag', 'AR'], ['Vicentico', 'AR'], ['Diego Torres', 'AR'], ['Enanitos Verdes', 'AR'],
  ['Ratones Paranoicos', 'AR'], ['Rata Blanca', 'AR'], ['Hermética', 'AR'], ['V8', 'AR'], ['Los Twist', 'AR'], ['Turf', 'AR'],
  ['Catupecu Machu', 'AR'], ['Intoxicados', 'AR'], ['Las Pastillas del Abuelo', 'AR'], ['El Mató a un Policía Motorizado', 'AR'],
  ['Duki', 'AR'], ['Tini', 'AR'], ['Lali', 'AR'], ['Nicki Nicole', 'AR'], ['Gilda', 'AR'], ['Rodrigo', 'AR'],
  ['No Te Va Gustar', 'UY'], ['Jaime Roos', 'UY'], ['Shakira', 'CO'], ['Juanes', 'CO'], ['Maná', 'MX'], ['Café Tacvba', 'MX'], ['Luis Miguel', 'MX'],
  ['Bad Bunny', 'PR'], ['Rosalía', 'ES'], ['Joaquín Sabina', 'ES'], ['Joan Manuel Serrat', 'ES'], ['Mecano', 'ES'], ['Héroes del Silencio', 'ES'],
  ['Enrique Iglesias', 'ES'], ['Ricky Martin', 'PR'], ['Los Prisioneros', 'CL'], ['Los Jaivas', 'CL'], ['Los Bunkers', 'CL'],
  ['The Beatles', 'GB'], ['The Rolling Stones', 'GB'], ['Queen', 'GB'], ['Pink Floyd', 'GB'], ['Led Zeppelin', 'GB'], ['AC/DC', 'AU'],
  ['Metallica', 'US'], ['Nirvana', 'US'], ['U2', 'IE'], ['Coldplay', 'GB'], ['Radiohead', 'GB'], ['Oasis', 'GB'], ["Guns N' Roses", 'US'],
  ['Red Hot Chili Peppers', 'US'], ['Michael Jackson', 'US'], ['Madonna', 'US'], ['Prince', 'US'], ['David Bowie', 'GB'], ['Elton John', 'GB'],
  ['ABBA', 'SE'], ['Bob Marley & The Wailers', 'JM'], ['Bob Dylan', 'US'], ['Bruce Springsteen', 'US'], ['The Doors', 'US'], ['The Who', 'GB'],
  ['Kiss', 'US'], ['Iron Maiden', 'GB'], ['Black Sabbath', 'GB'], ['Deep Purple', 'GB'], ['Aerosmith', 'US'], ['Bon Jovi', 'US'],
  ['Green Day', 'US'], ['Linkin Park', 'US'], ['Foo Fighters', 'US'], ['Arctic Monkeys', 'GB'], ['The Killers', 'US'], ['Muse', 'GB'],
  ['Daft Punk', 'FR'], ['Taylor Swift', 'US'], ['Adele', 'GB'], ['Beyoncé', 'US'], ['Rihanna', 'BB'], ['Lady Gaga', 'US'], ['Bruno Mars', 'US'],
  ['Ed Sheeran', 'GB'], ['Billie Eilish', 'US'], ['Dua Lipa', 'GB'], ['The Weeknd', 'CA'], ['Eminem', 'US'], ['Amy Winehouse', 'GB'],
  ['Whitney Houston', 'US'], ['Frank Sinatra', 'US'], ['Elvis Presley', 'US'], ['The Police', 'GB'], ['Dire Straits', 'GB'], ['Depeche Mode', 'GB'],
  ['The Cure', 'GB'], ['Duran Duran', 'GB'], ['Eagles', 'US'], ['Fleetwood Mac', 'GB'], ['Bee Gees', 'GB'], ['Spice Girls', 'GB'],
  ['Backstreet Boys', 'US'], ['One Direction', 'GB'], ['BTS', 'KR'], ['Ramones', 'US'], ['The Clash', 'GB'], ['Sex Pistols', 'GB'],
  ['Genesis', 'GB'], ['Supertramp', 'GB'], ['The Beach Boys', 'US'], ['Creedence Clearwater Revival', 'US'], ['Bob Marley', 'JM'],
];

// Tipo del álbum según sus tipos secundarios en MusicBrainz.
function tipoDeAlbum(secundarios) {
  if (!secundarios.length) return 'estudio';
  if (secundarios.includes('Live')) return 'en vivo';
  if (secundarios.includes('Compilation')) return 'recopilación';
  if (secundarios.includes('Soundtrack')) return 'banda sonora';
  if (secundarios.some((s) => s === 'Remix' || s === 'DJ-mix')) return 'remezclas';
  return 'otro';
}

/** Busca el artista por nombre exacto (y país); devuelve su ficha con relaciones, géneros y URL. */
async function artistaSemilla(nombre, pais) {
  const r = await mb(`artist?query=${encodeURIComponent(`artist:"${nombre}"`)}&limit=10`);
  const exactos = r.artists.filter((a) => normalizar(a.name) === normalizar(nombre) || (a.aliases ?? []).some((x) => normalizar(x.name) === normalizar(nombre)));
  const elegido = exactos.find((a) => a.country === pais) ?? exactos.find((a) => !a.country) ?? exactos[0];
  if (!elegido) return null;
  return mb(`artist/${elegido.id}?inc=artist-rels+url-rels+genres+aliases`);
}

// País de MusicBrainz; null si no lo tiene (un dato que falta, no «ningún país»).
const paisDe = (a, porIso) => {
  const iso = a.country ?? a.area?.['iso-3166-1-codes']?.[0] ?? null;
  return iso && porIso.get(iso) ? [porIso.get(iso)] : null;
};
const wikidataDe = (a) => (a.relations ?? []).find((r) => r.type === 'wikidata')?.url?.resource?.split('/').pop() ?? null;
const anioDe = (fecha) => (fecha ? Number(String(fecha).slice(0, 4)) : null);

/**
 * Datos de MusicBrainz compartidos por «albumes» y «artistas_musicales»: las semillas, sus integrantes
 * (si son bandas) y, para cada integrante, todas las bandas de las que fue parte. Se calcula una vez por
 * importación (y las respuestas quedan en la caché).
 */
let datosMb = null;
async function musicBrainz() {
  if (datosMb) return datosMb;
  const semillas = [];
  const noEncontradas = [];
  const vistas = new Set();
  for (const [nombre, pais] of ARTISTAS) {
    const a = await artistaSemilla(nombre, pais);
    if (!a) noEncontradas.push(nombre);
    else if (!vistas.has(a.id)) {
      vistas.add(a.id);
      semillas.push(a);
    }
  }
  // Integrantes de las bandas semilla (relación «member of band», con sus períodos) y solistas semilla.
  console.log(`    MusicBrainz: ${semillas.length} semillas resueltas; ${noEncontradas.length} no encontradas`);
  const personas = new Map(semillas.filter((a) => a.type === 'Person').map((a) => [a.id, a]));
  for (const banda of semillas.filter((a) => a.type === 'Group')) {
    for (const r of (banda.relations ?? []).filter((x) => x.type === 'member of band' && x.direction === 'backward' && x.artist)) {
      if (!personas.has(r.artist.id)) personas.set(r.artist.id, await mb(`artist/${r.artist.id}?inc=artist-rels+url-rels+aliases`));
    }
  }
  // Todas las bandas de esos integrantes (cierre: «bandas en las que tocó X» queda completo).
  console.log(`    MusicBrainz: ${personas.size} personas; buscando el cierre de sus bandas`);
  const bandas = new Map(semillas.filter((a) => a.type === 'Group').map((a) => [a.id, a]));
  for (const p of personas.values()) {
    for (const r of (p.relations ?? []).filter((x) => x.type === 'member of band' && x.direction === 'forward' && x.artist)) {
      if (!bandas.has(r.artist.id)) bandas.set(r.artist.id, await mb(`artist/${r.artist.id}?inc=artist-rels+url-rels+genres+aliases`));
    }
  }
  console.log(`    MusicBrainz: cierre completo (${personas.size} personas, ${bandas.size} bandas)`);
  datosMb = { semillas, personas, bandas, noEncontradas };
  return datosMb;
}

/** Artículos de Wikipedia de los ítems de Wikidata enlazados desde MusicBrainz. */
async function enlacesWikidata(ids) {
  const enlaces = new Map();
  for (const lote of enLotes([...new Set(ids.filter(Boolean))], 150)) {
    for (const f of await sparql(`SELECT ?i ?s WHERE { VALUES ?i { ${lote.map((i) => `wd:${i}`).join(' ')} } ?i wikibase:sitelinks ?s }`)) enlaces.set(qid(f.i), Number(f.s));
  }
  return enlaces;
}

const albumes = {
  id: 'albumes',
  nombre: 'Álbumes',
  descripcion: 'Discografía completa (álbumes) de artistas seleccionados, con su tipo: estudio, en vivo, recopilación, banda sonora o remezclas.',
  popularidad: { criterio: 'Artículos de Wikipedia del álbum (sitelinks del ítem de Wikidata enlazado al grupo de lanzamientos de MusicBrainz, P436); 0 si no tiene.', nota: 'Es una medida de notoriedad, no de ventas ni de escuchas.' },
  cobertura: { tipo: 'parcial', criterio: 'No están todos los discos del mundo: cada artista semilla tiene su discografía completa de álbumes oficiales en MusicBrainz (grupos de lanzamientos de tipo «Album»); los demás artistas que figuran en los créditos no.' },
  atributos: { artistas: { tipo: 'lista', etiqueta: 'artista' }, anio: { tipo: 'numero', etiqueta: 'año' }, tipo: { tipo: 'texto', etiqueta: 'tipo de álbum' } },
  async importar({ hoy }) {
    const verificacion = [];
    const { semillas, noEncontradas } = await musicBrainz();
    if (noEncontradas.length) verificacion.push(`semillas no encontradas en MusicBrainz (quedan afuera): ${noEncontradas.join(', ')}`);
    const porGrupo = new Map();
    for (const a of semillas) {
      for (let offset = 0; ; offset += 100) {
        const r = await mb(`release-group?artist=${a.id}&type=album&release-group-status=website-default&limit=100&offset=${offset}`);
        for (const g of r['release-groups']) {
          const previo = porGrupo.get(g.id) ?? { g, artistas: new Set() };
          previo.artistas.add(a.name);
          porGrupo.set(g.id, previo);
        }
        if (offset + 100 >= r['release-group-count']) break;
      }
    }
    // Popularidad: ítems de Wikidata con el id del grupo de lanzamientos (P436).
    const ids = [...porGrupo.keys()];
    const enlaces = new Map();
    for (const lote of enLotes(ids, 150)) {
      for (const f of await sparql(`SELECT ?id ?s WHERE { VALUES ?id { ${lote.map((i) => `"${i}"`).join(' ')} } ?w wdt:P436 ?id ; wikibase:sitelinks ?s }`)) enlaces.set(f.id, Math.max(enlaces.get(f.id) ?? 0, Number(f.s)));
    }
    const entidades = [...porGrupo.values()]
      .filter(({ g }) => g.title && normalizar(g.title))
      .map(({ g, artistas }) => ({
        id: g.id,
        nombre: g.title,
        alias: limpiarAlias(g.title, []),
        popularidad: enlaces.get(g.id) ?? 0,
        atributos: { artistas: [...artistas].sort(), anio: anioDe(g['first-release-date']), tipo: Array.isArray(g['secondary-types']) ? tipoDeAlbum(g['secondary-types']) : null },
        fuente: `https://musicbrainz.org/release-group/${g.id}`,
      }));
    const estudio = (artista) => entidades.filter((e) => e.atributos.artistas.includes(artista) && e.atributos.tipo === 'estudio').map((e) => e.nombre).sort();
    exigir(estudio('Soda Stereo').join('|') === ['Canción animal', 'Doble vida', 'Dynamo', 'Nada personal', 'Signos', 'Soda Stereo', 'Sueño Stereo'].join('|'), 'Soda Stereo: sus 7 discos de estudio', verificacion);
    exigir(['Abbey Road', 'Revolver', 'Let It Be'].every((t) => estudio('The Beatles').includes(t)), 'The Beatles: Abbey Road, Revolver y Let It Be son de estudio', verificacion);
    const sinAnio = entidades.filter((e) => e.atributos.anio === null).length;
    verificacion.push(`${entidades.length} álbumes de ${semillas.length} artistas; ${sinAnio} sin año (el año solo se filtra donde no falte)`);
    const enlacesArtistas = await enlacesWikidata(semillas.map(wikidataDe));
    const temas = { artistas: familiaridadPorEnlaces(Object.fromEntries(semillas.map((a) => [a.name, enlacesArtistas.get(wikidataDe(a)) ?? 0])), { alta: 70, media: 30 }) };
    const cobertura = { completoPor: { artistas: semillas.map((a) => a.name).sort() } };
    return { entidades, verificacion, temas, cobertura, fuentes: [{ ...MUSICBRAINZ, detalle: 'discografías (grupos de lanzamientos oficiales)' }, { ...WIKIDATA, detalle: 'popularidad (P436)' }], hoy };
  },
};

const artistasMusicales = {
  id: 'artistas_musicales',
  nombre: 'Artistas e integrantes de bandas',
  descripcion: 'Artistas seleccionados, los integrantes de sus bandas y todas las bandas en las que tocaron esos integrantes.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: {
    tipo: 'parcial',
    criterio: 'No están todos los artistas del mundo: cada banda semilla tiene todos sus integrantes (relación «member of band» de MusicBrainz, con sus períodos) y cada uno de esos integrantes (y cada solista semilla), todas sus bandas.',
  },
  atributos: {
    tipo: { tipo: 'texto', etiqueta: 'tipo' },
    paises: { tipo: 'lista', etiqueta: 'país' },
    origen: { tipo: 'texto', etiqueta: 'origen' },
    generos: { tipo: 'lista', etiqueta: 'género' },
    bandas: { tipo: 'lista', etiqueta: 'banda que integró' },
    miembros: { tipo: 'lista', etiqueta: 'integrante' },
    periodos: { tipo: 'lista', etiqueta: 'período como integrante' },
    inicio: { tipo: 'numero', etiqueta: 'año de inicio' },
  },
  depende: ['paises'],
  async importar({ hoy, catalogos }) {
    const verificacion = [];
    const { semillas, personas, bandas, noEncontradas } = await musicBrainz();
    if (noEncontradas.length) verificacion.push(`semillas no encontradas en MusicBrainz (quedan afuera): ${noEncontradas.join(', ')}`);
    const porIso = new Map(catalogos.paises.entidades.map((p) => [p.atributos.iso, p.nombre]));
    const todos = new Map([...semillas.map((a) => [a.id, a]), ...bandas, ...personas]);
    const bandasSemilla = semillas.filter((a) => a.type === 'Group').map((a) => a.name);
    const enlaces = await enlacesWikidata([...todos.values()].map(wikidataDe));
    const periodo = (r) => (r.begin || r.end ? `${anioDe(r.begin) ?? '?'}–${r.ended || r.end ? (anioDe(r.end) ?? '?') : 'hoy'}` : 'sin fechas');
    const semillaIds = new Set(semillas.map((a) => a.id));
    const entidades = [...todos.values()].map((a) => {
      const esBanda = a.type === 'Group' || a.type === 'Orchestra' || a.type === 'Choir';
      const rels = (a.relations ?? []).filter((r) => r.type === 'member of band' && r.artist);
      const deBanda = rels.filter((r) => r.direction === 'backward');
      const propias = rels.filter((r) => r.direction === 'forward' && bandas.has(r.artist.id));
      return {
        id: a.id,
        nombre: a.name,
        alias: limpiarAlias(a.name, (a.aliases ?? []).filter((x) => !x.locale || x.locale === 'es' || x.primary).map((x) => x.name), { siglas: true }),
        popularidad: enlaces.get(wikidataDe(a)) ?? 0,
        atributos: {
          tipo: esBanda ? 'banda' : a.type === 'Person' ? 'solista o músico' : a.type ? 'otro' : null,
          paises: paisDe(a, porIso),
          origen: a['begin-area']?.name ?? a.area?.name ?? null,
          generos: a.genres?.length ? [...new Set(a.genres.map(g => g.name))].sort() : null,
          bandas: esBanda ? [] : [...new Set(propias.map((r) => r.artist.name))].sort(),
          miembros: esBanda ? [...new Set(deBanda.map((r) => r.artist.name))].sort() : [],
          periodos: esBanda ? deBanda.map((r) => `${r.artist.name}: ${periodo(r)}`) : propias.map((r) => `${r.artist.name}: ${periodo(r)}`),
          inicio: anioDe(a['life-span']?.begin),
          semilla: semillaIds.has(a.id),
        },
        fuente: `https://musicbrainz.org/artist/${a.id}`,
      };
    });
    const integrantes = (banda) => entidades.filter((e) => e.atributos.bandas.includes(banda)).map((e) => e.nombre).sort();
    exigir(['Charly Alberti', 'Gustavo Cerati', 'Zeta Bosio'].every((n) => integrantes('Soda Stereo').includes(n)), 'Soda Stereo: Cerati, Bosio y Alberti', verificacion);
    exigir(['John Lennon', 'Paul McCartney', 'George Harrison', 'Ringo Starr'].every((n) => integrantes('The Beatles').includes(n)), 'The Beatles: Lennon, McCartney, Harrison y Starr', verificacion);
    const conPeriodo = entidades.flatMap((e) => e.atributos.periodos).filter((p) => !p.endsWith('sin fechas')).length;
    verificacion.push(`${entidades.length} artistas (${semillas.length} semillas, ${personas.size} integrantes, ${bandas.size} bandas); ${conPeriodo} períodos de integrantes con fechas`);
    // Grupos completos: los integrantes de cada banda semilla y las bandas de cada integrante conocido.
    const cobertura = { completoPor: { bandas: [...new Set(bandasSemilla)].sort(), miembros: [...new Set([...personas.values()].map((p) => p.name))].sort() } };
    // Familiaridad de cada banda (para elegir consignas sobre bandas conocidas).
    const temas = { bandas: familiaridadPorEnlaces(Object.fromEntries(entidades.filter((e) => e.atributos.tipo === 'banda').map((e) => [e.nombre, e.popularidad])), { alta: 60, media: 25 }) };
    return { entidades, verificacion, temas, cobertura, fuentes: [{ ...MUSICBRAINZ, detalle: 'artistas, integrantes y períodos («member of band»), país y géneros' }, { ...WIKIDATA, detalle: 'popularidad' }], hoy };
  },
};

// Vista: las bandas argentinas del catálogo de artistas (no es una copia: se filtra al cargar).
const bandasArgentinas = {
  id: 'bandas_argentinas',
  nombre: 'Bandas argentinas',
  descripcion: 'Las bandas argentinas del catálogo «artistas_musicales» (vista filtrada).',
  vista: { catalogo: 'artistas_musicales', filtro: { y: [{ op: 'es', campo: 'tipo', valores: ['banda'] }, { op: 'es', campo: 'paises', valores: ['Argentina'] }] } },
  cobertura: { tipo: 'parcial', criterio: 'Las bandas argentinas de «artistas_musicales»: para cada integrante de una banda semilla (y cada solista semilla), todas las bandas en las que tocó (MusicBrainz). La cobertura es la del catálogo base.' },
};

const vistasAlbumes = ['estudio', 'en vivo'].map(tipo => ({ id: tipo === 'estudio' ? 'albumes_estudio' : 'albumes_en_vivo', nombre: `Álbumes ${tipo}`, descripcion: 'Vista por tipo de los álbumes del catálogo base.', vista: { catalogo: 'albumes', filtro: { op: 'es', campo: 'tipo', valores: [tipo] } }, cobertura: { tipo: 'parcial', criterio: 'Hereda la cobertura por artista del catálogo de álbumes; solo este tipo de álbum.' } }));

export const MUSICA = [instrumentosMusicales, albumes, artistasMusicales, bandasArgentinas, ...vistasAlbumes];
