// Fuentes oficiales del Nobel y Wikidata; solo se ejecuta al importar.
import { descargar, limpiarAlias } from './comun.mjs';
import { sparql, etiquetas, propiedad, qid, urlEntidad, anio } from './wikidata.mjs';
import { exigir, WIKIDATA, POPULARIDAD_WIKIPEDIA, familiaridadPorEnlaces } from './ayudas.mjs';
const disciplinas = { phy: 'Física', che: 'Química', med: 'Medicina o Fisiología' };
const cientificos = {
  id: 'cientificos', nombre: 'Científicos premiados con el Nobel',
  descripcion: 'Personas laureadas en Física, Química y Medicina o Fisiología; datos oficiales del Nobel sin modificar las motivaciones.',
  popularidad: POPULARIDAD_WIKIPEDIA,
  cobertura: { tipo: 'completa', criterio: 'Todas las personas laureadas en Física, Química y Medicina o Fisiología que devuelve la API oficial del Nobel al importar.' },
  depende: ['paises'],
  atributos: { disciplinas: { tipo: 'lista', etiqueta: 'disciplina' }, premios_phy: { tipo:'lista_numeros', etiqueta:'años de Nobel de Física' }, premios_che: { tipo:'lista_numeros', etiqueta:'años de Nobel de Química' }, premios_med: { tipo:'lista_numeros', etiqueta:'años de Nobel de Medicina o Fisiología' }, anios: { tipo: 'lista_numeros', etiqueta: 'años de premio' }, pais_nacimiento: { tipo: 'texto', etiqueta: 'país actual de nacimiento' }, aportes: { tipo: 'lista', etiqueta: 'motivaciones oficiales en inglés' }, nacionalidades: { tipo: 'lista', etiqueta: 'nacionalidades' } },
  async importar({ hoy, catalogos }) {
    const todos = new Map(); const verificacion = []; const correcciones = [];
    for (const categoria of Object.keys(disciplinas)) {
      let url = `https://api.nobelprize.org/2.1/laureates?${new URLSearchParams({ nobelPrizeCategory: categoria, limit: '1000' })}`;
      while (url) { const d = await descargar(url, { json: true }); for (const l of d.laureates) todos.set(l.id, l); url = d.links?.next ?? null; }
    }
    const lista = [...todos.values()].filter(l => l.givenName && l.nobelPrizes.some(p => disciplinas[p.category?.en === 'Physics' ? 'phy' : p.category?.en === 'Chemistry' ? 'che' : p.category?.en === 'Physiology or Medicine' ? 'med' : '']));
    const ids = lista.map(l => l.wikidata?.id).filter(Boolean); const et = await etiquetas(ids);
    const nacs = await propiedad(ids, 'P27');
    const paises = new Set(catalogos.paises.entidades.map(p => p.nombre));
    const idPais = p => [p?.wikidata, ...[p?.sameAs ?? []].flat()].find(u => u?.includes('wikidata.org'))?.split('/').pop();
    const porWd = new Map(catalogos.paises.entidades.map(p => [p.atributos.wikidata, p.nombre]));
    // El catálogo países guarda su vínculo Wikidata como fuente, no como atributo en todas las versiones.
    for (const p of catalogos.paises.entidades) if (p.fuente) porWd.set(qid(p.fuente), p.nombre);
    const paisIds = [...new Set(lista.map(l => idPais(l.birth?.place?.countryNow)).filter(Boolean))];
    const paisEt = await etiquetas(paisIds);
    const entidades = lista.map(l => {
      const id = l.wikidata?.id; const e = et.get(id);
      const vandalizado = /McBurger/i.test(e?.es ?? '');
      if(vandalizado)correcciones.push({ entidad: id, detalle: `Nombre español corrupto «${e.es}»: se usa «${l.knownName.en}» de la API oficial del Nobel.`, motivo: 'Contraste de etiqueta con fuente oficial; no se acepta el alias vandalizado.' });
      const nombre = (vandalizado ? l.knownName.en : e?.es) ?? l.knownName?.en ?? `${l.givenName.en} ${l.familyName?.en ?? ''}`.trim();
      const premios = l.nobelPrizes.filter(p => ['Physics', 'Chemistry', 'Physiology or Medicine'].includes(p.category.en));
      const pais = l.birth?.place?.countryNow;
      const wdPais = idPais(pais);
      const nacionalidades = nacs.get(id)?.map(n => n.valor.nombre ?? porWd.get(n.valor.id)).filter(Boolean) ?? [];
      return { id: `nobel-${l.id}`, nombre, alias: limpiarAlias(nombre, [...(e?.alias ?? []).filter(a=>!/McBurger/i.test(a)), l.knownName?.en]), popularidad: e?.enlaces ?? 0,
        atributos: { ...Object.fromEntries(Object.keys(disciplinas).map((k,i)=>['premios_'+k,premios.filter(p=>p.category.en===['Physics','Chemistry','Physiology or Medicine'][i]).map(p=>Number(p.awardYear))])), disciplinas: [...new Set(premios.map(p => Object.values(disciplinas)[['Physics','Chemistry','Physiology or Medicine'].indexOf(p.category.en)]))], anios: premios.map(p => Number(p.awardYear)), aportes: premios.map(p => p.motivation.en), pais_nacimiento: porWd.get(wdPais) ?? (paises.has(paisEt.get(wdPais)?.es) ? paisEt.get(wdPais).es : null), nacionalidades: nacionalidades.length && nacionalidades.length === nacs.get(id)?.length ? nacionalidades : null }, fuente: l.links?.find(x => x.rel === 'external')?.href ?? `https://www.nobelprize.org/laureate/${l.id}` };
    });
    // Resolver también por etiqueta española exacta del país, sin inferir fronteras históricas.
    const nombresPaises = new Set(catalogos.paises.entidades.map(p=>p.nombre));
    for (let i=0;i<lista.length;i++) if (!entidades[i].atributos.pais_nacimiento) { const v = paisEt.get(idPais(lista[i].birth?.place?.countryNow))?.es; if(nombresPaises.has(v)) entidades[i].atributos.pais_nacimiento=v; }
    exigir(entidades.length > 600 && entidades.length === lista.length, `${entidades.length} laureados científicos sin perder personas de la API`, verificacion);
    for (const nombre of ['Marie Curie','Frederick Sanger','John Bardeen']) exigir(entidades.some(e=>e.nombre===nombre && e.atributos.anios.length===2), `${nombre}: dos premios`, verificacion);
    verificacion.push(`${entidades.filter(e=>e.atributos.pais_nacimiento===null).length} países de nacimiento desconocidos; no habilitar filtros globales si falta alguno`);
    const esquema={...cientificos.atributos};
    if(entidades.some(e=>e.atributos.nacionalidades===null)){delete esquema.nacionalidades;for(const e of entidades)delete e.atributos.nacionalidades;verificacion.push('P27 incompleto: no se importa la nacionalidad como atributo.');}
    return { entidades, atributos:esquema, verificacion, correcciones, fuentes: [{ nombre:'Nobel Prize API', url:'https://api.nobelprize.org/2.1/laureates', licencia:'CC0 1.0; motivaciones oficiales conservadas sin alteraciones' }, WIKIDATA], hoy };
  },
};
const obrasArte = {
  id:'obras_arte', nombre:'Pinturas de Wikidata', descripcion:'Pinturas con nombre en español y al menos 20 enlaces a ediciones Wikimedia, según Wikidata.', popularidad:POPULARIDAD_WIKIPEDIA,
  cobertura:{tipo:'parcial',completoPor:{autores:true,ubicaciones:true},criterio:'Todos los ítems de Wikidata que están clasificadas directamente como pinturas (P31 Q3305213), tienen nombre español o mul y al menos 20 sitelinks al importar. Se garantizan los grupos con autor o colección/ubicación declarados; Los años faltantes impiden consignas globales por siglo.'},
  atributos:{autores:{tipo:'lista',etiqueta:'autor'},anio:{tipo:'numero',etiqueta:'año'},tecnicas:{tipo:'lista',etiqueta:'técnica'},ubicaciones:{tipo:'lista',etiqueta:'colección o ubicación'},referencia:{tipo:'texto',etiqueta:'fecha de consulta'}},
  async importar({hoy}) {
    const filas=await sparql('SELECT DISTINCT ?i WHERE { ?i wdt:P31 wd:Q3305213 ; wikibase:sitelinks ?n . FILTER(?n>=20) }');
    const ids=[...new Set(filas.map(f=>qid(f.i)))]; const et=await etiquetas(ids);
    const autor=await propiedad(ids,'P170'), fecha=await propiedad(ids,'P571'), tecnica=await propiedad(ids,'P186'), coleccion=await propiedad(ids,'P195',{vigentes:true}), lugar=await propiedad(ids,'P276',{vigentes:true});
    const valores=(m,id)=>{const v=m.get(id);return v?.length && v.every(x=>x.valor.nombre) ? [...new Set(v.map(x=>x.valor.nombre))] : null;};
    const entidades=ids.filter(id=>et.get(id)?.es).map(id=>{const e=et.get(id);return {id,nombre:e.es,alias:limpiarAlias(e.es,[...e.alias,e.en]),popularidad:e.enlaces,atributos:{autores:valores(autor,id),anio:fecha.get(id)?.length===1?anio(fecha.get(id)[0].valor):null,tecnicas:valores(tecnica,id),ubicaciones:[...new Set([...(valores(coleccion,id)??[]),...(valores(lugar,id)??[])])].length ? [...new Set([...(valores(coleccion,id)??[]),...(valores(lugar,id)??[])])] : null,referencia:hoy},fuente:urlEntidad(id)};});
    const verificacion=[]; for(const campo of ['autores','anio','ubicaciones','tecnicas'])verificacion.push(`${campo}: ${entidades.filter(e=>e.atributos[campo]===null).length} sin dato`); exigir(entidades.length>300,`${entidades.length} pinturas con nombre y umbral de notoriedad`,verificacion);
    const autorIds=[...new Set([...autor.values()].flat().map(v=>v.valor.id).filter(Boolean))]; const autorEt=await etiquetas(autorIds);
    const autores=Object.fromEntries([...autorEt.values()].filter(e=>e.es).map(e=>[e.es,e.enlaces]));
    return {entidades,verificacion,temas:{autores:familiaridadPorEnlaces(autores)},fuentes:[WIKIDATA],hoy};
  },
};
export const CIENCIA_ARTE=[cientificos,obrasArte];
