// Especies actuales con evaluación, sin duplicar sinónimos taxonómicos como respuestas.
import { sparql, etiquetas, qid, urlEntidad } from './wikidata.mjs';
import { idsDePaginas } from './wikipedia_entidades.mjs';
import { descargar, limpiarAlias } from './comun.mjs';
import { WIKIDATA, POPULARIDAD_WIKIPEDIA, exigir } from './ayudas.mjs';

export const NATURALEZA = [{
  id: 'animales', nombre: 'Especies de familias zoológicas con evaluación UICN',
  descripcion: 'Especies de familias zoológicas seleccionadas con evaluación no extinta, contrastadas con la taxonomía de GBIF.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Ítems de Wikidata de rango especie, ancestro de los grupos seleccionados (osos, felinos, camélidos, pingüinos, cánidos, cérvidos, rinocerontes y tortugas marinas), estado UICN no extinto y nombre es/mul. Solo coincidencias taxonómicas exactas de rango especie en GBIF; sinónimos del mismo taxón aceptado forman una respuesta. No todas las especies vivientes.' },
  atributos: {
    grupos: { tipo: 'lista', etiqueta: 'grupo zoológico' },
    cientifico: { tipo: 'texto', etiqueta: 'nombre científico aceptado por GBIF' },
    taxon: { tipo: 'texto', etiqueta: 'taxón aceptado en GBIF' },
    estado: { tipo: 'lista', etiqueta: 'estado UICN' },
    habitat: { tipo: 'lista', etiqueta: 'hábitat' },
    alimentacion: { tipo: 'lista', etiqueta: 'alimentación' },
  },
  async importar({ hoy }) {
    const familias = await idsDePaginas(['Ursidae', 'Felidae', 'Camelidae', 'Spheniscidae', 'Canidae', 'Cervidae', 'Rhinocerotidae', 'Cheloniidae', 'Dermochelyidae']);
    exigir([...familias.values()].every(Boolean), 'familias y grupos resueltos por páginas taxonómicas', []);
    const nombres = ['osos', 'felinos', 'camélidos', 'pingüinos', 'cánidos', 'cérvidos', 'rinocerontes', 'tortugas marinas', 'tortugas marinas'];
    const filas = [];
    let j = 0;
    for (const id of familias.values()) {
      const grupo = nombres[j++];
      const fs = await sparql(`SELECT DISTINCT ?i ?nombre ?estado WHERE {
        ?i wdt:P105 wd:Q7432 ; wdt:P171* wd:${id} ; wdt:P225 ?nombre ; wdt:P141 ?estado .
        VALUES ?estado { wd:Q211005 wd:Q719675 wd:Q278113 wd:Q219127 wd:Q11394 wd:Q3245245 }
        FILTER NOT EXISTS { ?i wdt:P141 wd:Q237350 }
      }`);
      filas.push(...fs.map(f => ({ ...f, grupo })));
    }
    const ids = [...new Set(filas.map(f => qid(f.i)))];
    const et = await etiquetas(ids), est = await etiquetas([...new Set(filas.map(f => qid(f.estado)))]);
    const comunes = new Map(ids.map(id => [id, []]));
    for (const f of await sparql(`SELECT ?i ?nombre WHERE { VALUES ?i { ${ids.map(id => `wd:${id}`).join(' ')} } ?i wdt:P1843 ?nombre . FILTER(LANG(?nombre)="es") }`)) comunes.get(qid(f.i)).push(f.nombre);
    const porTaxon = new Map(), correcciones = [], sinVerificar = [], cotejos = new Map();
    for (const f of filas) {
      const id = qid(f.i), w = et.get(id);
      if (!w.es) continue;
      if (!cotejos.has(f.nombre)) cotejos.set(f.nombre, await descargar(`https://api.gbif.org/v1/species/match?${new URLSearchParams({ name: f.nombre, rank: 'SPECIES', strict: 'true' })}`, { json: true }));
      const taxon = cotejos.get(f.nombre);
      if (taxon.matchType !== 'EXACT' || taxon.rank !== 'SPECIES' || taxon.confidence < 95) {
        if (!sinVerificar.some(s => s.startsWith(id))) sinVerificar.push(`${id} (${f.nombre}): ${taxon.matchType}/${taxon.rank}/${taxon.confidence}; no se importa sin identidad exacta.`);
        continue;
      }
      const clave = String(taxon.acceptedUsageKey ?? taxon.usageKey);
      const verificados = [...new Set(comunes.get(id))].sort((a,b) => a.localeCompare(b,'es'));
      const nombre = w.es === f.nombre && verificados.length ? verificados[0][0].toLocaleLowerCase('es')+verificados[0].slice(1) : w.es;
      const nueva = { id, nombre, alias: limpiarAlias(nombre, [...w.alias, ...verificados, f.nombre, taxon.species]), popularidad: w.enlaces,
        atributos: { grupos: [f.grupo], cientifico: taxon.species ?? taxon.canonicalName, taxon: clave, estado: [est.get(qid(f.estado))?.es].filter(Boolean), habitat: null, alimentacion: null }, fuente: urlEntidad(id) };
      const anterior = porTaxon.get(clave);
      if (!anterior) porTaxon.set(clave, nueva);
      else {
        if (anterior.id !== id) correcciones.push({ entidad: id, detalle: `Mismo taxón GBIF ${clave} que ${anterior.id}: una sola respuesta.`, motivo: 'Sinónimos científicos no son especies distintas.' });
        const principal = nueva.popularidad > anterior.popularidad ? nueva : anterior;
        principal.alias = limpiarAlias(principal.nombre, [anterior.nombre, nueva.nombre, ...anterior.alias, ...nueva.alias]);
        principal.atributos.grupos = [...new Set([...anterior.atributos.grupos, ...nueva.atributos.grupos])];
        principal.atributos.estado = [...new Set([...anterior.atributos.estado, ...nueva.atributos.estado])];
        porTaxon.set(clave, principal);
      }
    }
    const entidades = [...porTaxon.values()], verificacion = [];
    const nombresContados = new Map();
    for (const e of entidades) nombresContados.set(e.nombre.toLocaleLowerCase('es'), (nombresContados.get(e.nombre.toLocaleLowerCase('es')) ?? 0) + 1);
    for (const e of entidades) if (nombresContados.get(e.nombre.toLocaleLowerCase('es')) > 1) {
      const original = e.nombre;
      e.nombre = `${original} (${e.atributos.cientifico})`;
      e.alias = limpiarAlias(e.nombre, [original, ...e.alias]);
      correcciones.push({ entidad: e.id, detalle: `Nombre común compartido «${original}»: se identifica con el nombre científico.`, motivo: 'Son taxones distintos, no se elimina ninguna especie por compartir nombre común.' });
    }
    for (const grupo of new Set(nombres)) verificacion.push(`${grupo}: ${entidades.filter(e => e.atributos.grupos.includes(grupo)).length} especies con evaluación, nombre e identidad exacta`);
    exigir(entidades.filter(e => e.atributos.grupos.includes('osos')).length === 8, '8 especies de osos vivientes', verificacion);
    exigir(entidades.some(e => e.alias.concat(e.nombre).some(n=>n.toLocaleLowerCase('es')==='oso polar')), 'oso polar presente como nombre común', verificacion);
    exigir(new Set(entidades.map(e => e.atributos.taxon)).size === entidades.length, 'una respuesta por taxón aceptado; sin especies duplicadas', verificacion);
    return { entidades, verificacion, correcciones, sinVerificar, fuentes: [WIKIDATA, { nombre: 'GBIF Backbone Taxonomy (identidad y sinónimos)', url: 'https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c', licencia: 'CC BY 4.0' }], hoy };
  },
}];
