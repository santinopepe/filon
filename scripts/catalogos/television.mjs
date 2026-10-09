import { wikitexto, exigir, WIKIDATA, POPULARIDAD_WIKIPEDIA } from './ayudas.mjs';
import { idsDePaginas } from './wikipedia_entidades.mjs';
import { etiquetas, urlEntidad } from './wikidata.mjs';
import { limpiarAlias } from './comun.mjs';
// Planteles de series: cada lista está cerrada y tiene una cantidad contrastada.
async function plantelesFranquicia(hoy, fuentes, verificacion) {
 const listas=[];
 const trek=await wikitexto('List of Star Trek television series','en');
 const nombres=[...trek.texto.matchAll(/^===\s*''([^']+)''\s*\((\d{4})[–-]([^)]*)\)\s*===/gm)].filter(m=>Number(m[2])<=Number(hoy.slice(0,4))).map(m=>`Star Trek: ${m[1]}`);
 exigir(nombres.length===13,'Star Trek: 13 series con período emitido (incluye Short Treks; no promociones ni proyectos sin período)',verificacion);
 listas.push(...nombres.map(pagina=>({pagina,franquicia:'Star Trek'})));fuentes.push({nombre:'Wikipedia: series de Star Trek',url:trek.url,licencia:'CC BY-SA 4.0; revisión registrada'});
 const csi=await wikitexto('CSI (franchise)','en');
 const campo=csi.texto.match(/\|\s*tv\s*=([^]*?)\n\|/)?.[1]??'';
 const csis=[...campo.matchAll(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g)].map(m=>m[1]);
 exigir(csis.length===6,'CSI: seis series del campo TV, incluida la documental The Real CSI: Miami',verificacion);
 listas.push(...csis.map(pagina=>({pagina,franquicia:'CSI'})));fuentes.push({nombre:'Wikipedia: franquicia CSI',url:csi.url,licencia:'CC BY-SA 4.0; revisión registrada'});
 const ncis=await wikitexto('NCIS (franchise)','en');
 const seccionNCIS=ncis.texto.split('==Series==')[1]?.split('==Main cast==')[0]??'';
 const nciss=[...seccionNCIS.matchAll(/^===\s*''(NCIS[^']*)''\s*\((\d{4})(?:[–-][^)]*)?\)\s*===/gm)].filter(m=>Number(m[2])<=Number(hoy.slice(0,4))).map(m=>m[1]==='NCIS'?'NCIS (TV series)':m[1]);
 exigir(nciss.length===7,'NCIS: siete series con período emitido; New York sin período confirmado queda fuera',verificacion);
 listas.push(...nciss.map(pagina=>({pagina,franquicia:'NCIS'})));fuentes.push({nombre:'Wikipedia: franquicia NCIS',url:ncis.url,licencia:'CC BY-SA 4.0; revisión registrada'});
 return listas;
}
export const TELEVISION=[{id:'series',nombre:'Series premiadas y planteles de franquicias',descripcion:'Ganadoras de Emmy y planteles completos de Star Trek, CSI y NCIS.',popularidad:POPULARIDAD_WIKIPEDIA,cobertura:{tipo:'completa',criterio:'Todas las ganadoras de serie dramática y comedia entre 1966 y 2025 en las tablas de Wikipedia verificadas por año. Premios: 1966–2025. Se agregan 13 series de Star Trek, 6 de CSI (incluida The Real CSI) y 7 estrenadas de NCIS de las listas verificadas; no proyectos sin período.'},atributos:{franquicias:{tipo:'lista',etiqueta:'franquicia de los planteles admitidos'},premios:{tipo:'lista',etiqueta:'premio'},anios_drama:{tipo:'lista_numeros',etiqueta:'años de Emmy drama'},anios_comedia:{tipo:'lista_numeros',etiqueta:'años de Emmy comedia'}},async importar({hoy}){
 const filas=[],fuentes=[],verificacion=[],enlacesTitulos=new Map();
 for(const [tipo,titulo]of [['drama','Primetime Emmy Award for Outstanding Drama Series'],['comedia','Primetime Emmy Award for Outstanding Comedy Series']]){
  const d=await wikitexto(titulo,'en');fuentes.push({nombre:`Wikipedia: Emmy ${tipo}`,url:d.url,licencia:'CC BY-SA 4.0; revisión registrada'});
  let anio=null;const porAnio=new Map();
  for(const fila of d.texto.split(/\n\|-/)){
   const y=fila.match(/\[\[(\d{4}) in (?:American )?television\|/);if(y)anio=Number(y[1]);
   if(anio<1966||anio>2025||!anio)continue;
   const ganadora=fila.match(/\n\|\s*'{5}([^]*?)\n\|/);if(!ganadora)continue;
   const celda=ganadora[1].split(/<br\s*\/?>|<small/)[0];const enlace=celda.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);const pagina=enlace?.[1]??celda.replace(/'/g,'').trim();
   if(enlace)enlacesTitulos.set((enlace[2]??enlace[1]),enlace[1]);
   porAnio.set(anio,[...(porAnio.get(anio)??[]),{pagina,tipo,anio}]);
  }
  exigir(porAnio.size===60 && Array.from({length:60},(_,i)=>1966+i).every(y=>porAnio.has(y)),`${tipo}: 60 ediciones 1966–2025 sin huecos`,verificacion);filas.push(...[...porAnio.values()].flat());
  verificacion.push(`${tipo}: ${[...porAnio.values()].flat().length} premios, incluidos los empates`);
 }
 for(const f of filas)f.pagina=enlacesTitulos.get(f.pagina)??f.pagina;
 filas.push(...await plantelesFranquicia(hoy,fuentes,verificacion));
 const ids=await idsDePaginas(filas.map(f=>f.pagina));exigir([...ids.values()].every(Boolean),'ganadoras enlazadas a Wikidata',verificacion);const et=await etiquetas([...new Set(ids.values())]),entidades=new Map();
 for(const f of filas){const id=ids.get(f.pagina),w=et.get(id),nombre=w.es??w.en;exigir(Boolean(nombre),`${id}: título`,[]);const e=entidades.get(id)??{id,nombre,alias:limpiarAlias(nombre,[...w.alias,w.en]),popularidad:w.enlaces,atributos:{franquicias:[],premios:[],anios_drama:[],anios_comedia:[]},fuente:urlEntidad(id)};if(f.tipo){if(!e.atributos.premios.includes(`Emmy a serie de ${f.tipo}`))e.atributos.premios.push(`Emmy a serie de ${f.tipo}`);e.atributos[`anios_${f.tipo}`].push(f.anio);}if(f.franquicia&&!e.atributos.franquicias.includes(f.franquicia))e.atributos.franquicias.push(f.franquicia);entidades.set(id,e);}
 for(const [titulo,tipo,anio]of [['Breaking Bad','drama',2014],['Friends','comedia',2002]])exigir([...entidades.values()].some(e=>e.alias.concat(e.nombre).includes(titulo)&&e.atributos[`anios_${tipo}`].includes(anio)),`${titulo}: Emmy ${tipo} ${anio}`,verificacion);
 return {entidades:[...entidades.values()],fuentes:[...fuentes,WIKIDATA],verificacion,hoy};
}}];
