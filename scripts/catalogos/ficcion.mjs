import { wikitexto, exigir, WIKIDATA, POPULARIDAD_WIKIPEDIA } from './ayudas.mjs';
import { idsDePaginas } from './wikipedia_entidades.mjs';
import { etiquetas, urlEntidad } from './wikidata.mjs';
import { limpiarAlias } from './comun.mjs';
const MIEMBROS=['Frodo Baggins','Samwise Gamgee','Merry Brandybuck','Pippin Took','Gandalf','Aragorn','Legolas','Gimli','Boromir'];
export const FICCION=[{id:'personajes_ficcion',nombre:'Comunidad del Anillo',descripcion:'Los nueve integrantes de la Comunidad del Anillo; no todos los personajes de Tolkien.',popularidad:POPULARIDAD_WIKIPEDIA,cobertura:{tipo:'completa',criterio:'Los nueve miembros originales de la Comunidad del Anillo, según la lista de The Fellowship of the Ring. Solo este plantel cerrado; no todos los personajes de la obra.'},atributos:{grupo:{tipo:'texto',etiqueta:'plantel cerrado'}},async importar({hoy}){
 const fuente=await wikitexto('The Fellowship of the Ring','en');
 for(const m of MIEMBROS)exigir(fuente.texto.includes(`[[${m}`),`${m} enlazado en la fuente del plantel`,[]);
 const ids=await idsDePaginas(MIEMBROS);exigir([...ids.values()].every(Boolean),'los nueve personajes enlazados a Wikidata',[]);const et=await etiquetas([...ids.values()]);
 const entidades=MIEMBROS.map(m=>{const id=ids.get(m),e=et.get(id);if(!e.es)throw Error(`${m}: sin nombre español`);return {id,nombre:e.es,alias:limpiarAlias(e.es,[...e.alias,m]),popularidad:e.enlaces,atributos:{grupo:'Comunidad del Anillo'},fuente:urlEntidad(id)};});const verificacion=[];exigir(entidades.length===9 && new Set(entidades.map(e=>e.id)).size===9,'los nueve miembros distintos de la Comunidad del Anillo',verificacion);
 return {entidades,verificacion,fuentes:[{nombre:'Wikipedia: The Fellowship of the Ring',url:fuente.url,licencia:'CC BY-SA 4.0; revisión registrada'},WIKIDATA],hoy};
}}];
