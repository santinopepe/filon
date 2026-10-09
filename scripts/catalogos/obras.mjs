// Universos cerrados por valores semilla. Los colaboradores nunca se declaran grupos completos.
import { sparql, etiquetas, propiedad, qid, anio, urlEntidad } from './wikidata.mjs';
import { limpiarAlias } from './comun.mjs';
import { WIKIDATA, POPULARIDAD_WIKIPEDIA, exigir, familiaridadPorEnlaces } from './ayudas.mjs';
import { idsDePaginas } from './wikipedia_entidades.mjs';
const DIRECTORES=['Steven Spielberg','Christopher Nolan','Hayao Miyazaki','James Cameron','Quentin Tarantino','Spike Lee','Francis Ford Coppola','Martin Scorsese','Stanley Kubrick','Alfred Hitchcock','Pedro Almodóvar','Tim Burton','Juan José Campanella','Damián Szifron','Lucrecia Martel'];
const AUTORES=['Gabriel García Márquez','Stephen King','J. R. R. Tolkien','Jorge Luis Borges','Julio Cortázar','Pablo Neruda','Agatha Christie','Jane Austen','Isabel Allende','Mario Vargas Llosa','Ursula K. Le Guin','J. K. Rowling','Ernest Hemingway'];
async function semillasDe(nombres) { const ids=await idsDePaginas(nombres); if([...ids.values()].some(id=>!id))throw Error('Semilla sin Wikidata: '+[...ids].filter(([,id])=>!id).map(([n])=>n));return [...ids.values()]; }
const lista=(m,id)=> {const v=m.get(id)??[];return v.length && v.every(x=>x.valor?.nombre) ? [...new Set(v.map(x=>x.valor.nombre))] : null;};
async function obras({hoy,semillas,prop,consulta,campos,verificar,duplicados={}}) {
  const ids=[...new Set((await sparql(consulta)).map(f=>qid(f.i)))]; const et=await etiquetas(ids), sem=await etiquetas(semillas);
  const props=new Map(); for(const p of [prop,...Object.values(campos)])if(!props.has(p))props.set(p,await propiedad(ids,p));
  const titulos=await propiedad(ids,'P1476');const creditos=props.get(prop);
  const completas=semillas.map(id=>sem.get(id)?.es); exigir(completas.every(Boolean),'semillas con nombre español/mul',[]);
  let entidades=ids.map(id=>{
    const e=et.get(id), nombre=e.es ?? titulos.get(id)?.[0]?.valor ?? e.en;
    if(!nombre)throw Error(`${id} sin título; no declarar completo el grupo`);
    const atributos={};for(const [campo,p]of Object.entries(campos)){ if(['anio'].includes(campo)) {const fechas=(props.get(p).get(id)??[]).map(v=>anio(v.valor)).filter(v=>v!==null);atributos[campo]=fechas.length?Math.min(...fechas):null;}else atributos[campo]=lista(props.get(p),id); }
    atributos[prop==='P57'?'directores':'autores']=lista(creditos,id);
    return {id,nombre,alias:limpiarAlias(nombre,[...e.alias,e.en,...(titulos.get(id)??[]).map(v=>v.valor)].filter(v=>typeof v==='string')),popularidad:e.enlaces,atributos,fuente:urlEntidad(id)};
  });
  const correcciones=[];
  for(const [duplicado,principal]of Object.entries(duplicados)){
    const d=entidades.find(e=>e.id===duplicado),p=entidades.find(e=>e.id===principal);
    if(!d||!p)continue;
    p.alias=limpiarAlias(p.nombre,[...p.alias,d.nombre,...d.alias]);
    entidades=entidades.filter(e=>e!==d);
    correcciones.push({entidad:duplicado,detalle:`Misma obra que ${principal}: una sola respuesta.`,motivo:'Poirot Investigates: variantes de edición británica y estadounidense del mismo libro, contrastadas con el artículo enlazado; no dos obras distintas.'});
  }
  const porTitulo=new Map();for(const e of entidades)porTitulo.set(e.nombre,(porTitulo.get(e.nombre)??0)+1);
  for(const e of entidades)if(porTitulo.get(e.nombre)>1 && e.atributos.anio!==null){const original=e.nombre;e.nombre=`${original} (${e.atributos.anio})`;e.alias=limpiarAlias(e.nombre,[original,...e.alias]);}
  const verificacion=[];exigir(entidades.length>=5,`${entidades.length} obras; grupos semilla consultados completos`,verificacion);
  if(verificar)verificar(entidades,verificacion);
  const campo=prop==='P57'?'directores':'autores';
  return {entidades,verificacion,correcciones,cobertura:{completoPor:{[campo]:completas}},temas:{[campo]:familiaridadPorEnlaces(Object.fromEntries([...sem.values()].map(e=>[e.es,e.enlaces])))},fuentes:[WIKIDATA],hoy};
}
const peliculas={id:'peliculas',nombre:'Películas por director y saga',descripcion:'Filmografías en Wikidata de directores seleccionados y las ocho películas de Harry Potter; incluidos cortos y telefilmes.',popularidad:POPULARIDAD_WIKIPEDIA,cobertura:{tipo:'parcial',criterio:'Obras cinematográficas registradas en Wikidata por P57 para los directores semilla o por P179 para Harry Potter. Solo se declaran completos los directores semilla y esta saga verificada. Incluye cortos y telefilmes con estreno registrado no posterior a la importación; excluye series, episodios y películas sin estreno confirmado.'},atributos:{directores:{tipo:'lista',etiqueta:'director'},anio:{tipo:'numero',etiqueta:'primera fecha de estreno'},paises:{tipo:'lista',etiqueta:'país de origen'},estudios:{tipo:'lista',etiqueta:'productora'},sagas:{tipo:'lista',etiqueta:'saga'}},async importar({hoy}){
  const semillas=await semillasDe(DIRECTORES), [saga]=await semillasDe(['Harry Potter (film series)']);
  const r=await obras({hoy,semillas,prop:'P57',consulta:`SELECT DISTINCT ?i WHERE { { VALUES ?d { ${semillas.map(id=>`wd:${id}`).join(' ')} } ?i wdt:P57 ?d } UNION { ?i wdt:P179 wd:${saga} } ?i wdt:P31/wdt:P279* wd:Q11424 ; wdt:P577 ?estreno . FILTER(?estreno <= "${hoy}T23:59:59Z"^^xsd:dateTime) FILTER NOT EXISTS { ?i wdt:P31/wdt:P279* wd:Q5398426 } FILTER NOT EXISTS { ?i wdt:P31/wdt:P279* wd:Q21191270 } }`,campos:{anio:'P577',paises:'P495',estudios:'P272',sagas:'P179'},verificar:(es,vs)=>exigir(es.some(e=>e.id==='Q181541' || e.nombre==='Duel'),'Spielberg: Duel (telefilme) conservado',vs)});
  const nombreSaga=(await etiquetas([saga])).get(saga).es;
  exigir(r.entidades.filter(e=>e.atributos.sagas?.includes(nombreSaga)).length===8,'Harry Potter: ocho películas; colección oficial HarryPotter.com/WB contrastada al 2026-10-08',r.verificacion);
  r.cobertura.completoPor.sagas=[nombreSaga];
  r.fuentes.push({nombre:'HarryPotter.com: colección oficial de películas (contraste de cantidad)',url:'https://www.harrypotter.com/discover/films',licencia:'Datos factuales de títulos y cantidad como verificación; texto y marcas reservados, no reproducidos.'});
  return r;
}};
const argentinas={id:'peliculas_argentinas',nombre:'Películas argentinas',descripcion:'Vista de películas cuyo país incluye Argentina.',vista:{catalogo:'peliculas',filtro:{op:'es',campo:'paises',valores:['Argentina']}},cobertura:{tipo:'parcial',criterio:'Filmografías semilla del catálogo base, filtradas por Argentina; no todas las películas argentinas.'}};
const libros={id:'libros',nombre:'Libros por autor',descripcion:'Novelas (incluidas novelas cortas), libros de cuentos y poemarios de autores semilla registrados en Wikidata.',popularidad:POPULARIDAD_WIKIPEDIA,cobertura:{tipo:'parcial',criterio:'Todos los ítems de autores semilla (P50) que Wikidata clasifica explícitamente como novelas, novelas cortas, colecciones de cuentos o poemarios (P31/P136/P7937 y subclases). Solo obras (no ediciones) con título es/mul o P1476 en español; no son bibliografías exhaustivas fuera de esa clasificación. No incluye cuentos sueltos ni afirma todos los libros en un idioma.'},atributos:{autores:{tipo:'lista',etiqueta:'autor'},anio:{tipo:'numero',etiqueta:'primera publicación'},idiomas:{tipo:'lista',etiqueta:'idioma original'},generos:{tipo:'lista',etiqueta:'género'},sagas:{tipo:'lista',etiqueta:'saga'}},async importar({hoy}){
  const semillas=await semillasDe(AUTORES), tipos=['Q8261','Q149537','Q1279564','Q12106333'];
  const r=await obras({hoy,semillas,prop:'P50',duplicados:{Q2375224:'Q1418731'},consulta:`SELECT DISTINCT ?i WHERE { VALUES ?a { ${semillas.map(id=>`wd:${id}`).join(' ')} } VALUES ?tipo { ${tipos.map(id=>`wd:${id}`).join(' ')} } ?i wdt:P50 ?a . { ?i wdt:P31/wdt:P279* ?tipo } UNION { ?i wdt:P136/wdt:P279* ?tipo } UNION { ?i wdt:P7937/wdt:P279* ?tipo } FILTER NOT EXISTS { ?i wdt:P31/wdt:P279* wd:Q3331189 }
 FILTER NOT EXISTS { ?coleccion wdt:P527 ?i ; wdt:P7937 wd:Q1279564 }
 FILTER NOT EXISTS { ?i (wdt:P31|wdt:P7937) wd:Q49084 . FILTER NOT EXISTS { ?i (wdt:P31|wdt:P136|wdt:P7937)/wdt:P279* wd:Q149537 } }
 FILTER EXISTS { { ?i rdfs:label ?nombre . FILTER(LANG(?nombre) IN ("es","mul")) } UNION { ?i wdt:P1476 ?titulo . FILTER(LANG(?titulo)="es") } } }`,campos:{anio:'P577',idiomas:'P407',generos:'P136',sagas:'P179'},verificar:(es,vs)=>exigir(es.some(e=>e.nombre==='Cien años de soledad') && es.some(e=>e.nombre==='El hobbit') && es.some(e=>e.nombre==='El viejo y el mar'),'Cien años de soledad, El hobbit y El viejo y el mar: obras incluidas, no ediciones ni cuentos sueltos',vs)});
  const fuente=await (await import('./ayudas.mjs')).wikitexto('Poirot Investigates','en');
  r.fuentes.push({nombre:'Wikipedia: Poirot Investigates (contraste de ediciones)',url:fuente.url,licencia:'CC BY-SA 4.0; revisión registrada'});
  return r;
}};
export const OBRAS=[peliculas,argentinas,libros];
