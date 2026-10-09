import { wikitexto, exigir, WIKIDATA, POPULARIDAD_WIKIPEDIA } from './ayudas.mjs';
import { idsDePaginas } from './wikipedia_entidades.mjs';
import { etiquetas, propiedad, urlEntidad } from './wikidata.mjs';
import { limpiarAlias } from './comun.mjs';
export const DEPORTISTAS=[{
 id:'deportistas',nombre:'Campeones argentinos y ganadores del Balón de Oro',descripcion:'Planteles finales argentinos de 1978, 1986 y 2022, y ganadores del Balón de Oro masculino 1956–2025.',popularidad:POPULARIDAD_WIKIPEDIA,
 cobertura:{tipo:'parcial',criterio:'Planteles finales de Argentina campeona en los Mundiales 1978, 1986 y 2022: 22, 22 y 26 futbolistas. No todos los deportistas ni todas las distinciones de estas personas.'},
 atributos:{deporte:{tipo:'texto',etiqueta:'deporte'},nacionalidades:{tipo:'lista',etiqueta:'nacionalidad'},logros:{tipo:'lista',etiqueta:'competición y edición'},premios:{tipo:'lista',etiqueta:'premio'},anios_balon:{tipo:'lista_numeros',etiqueta:'año del Balón de Oro'}},
 async importar({hoy}){
  const filas=[],fuentes=[],verificacion=[];
  for(const [edicion,n]of [[1978,22],[1986,22],[2022,26]]){
   const d=await wikitexto(`${edicion} FIFA World Cup squads`,'en');fuentes.push({nombre:`Wikipedia: planteles ${edicion}`,url:d.url,licencia:'CC BY-SA 4.0; revisión registrada'});
   const seccion=d.texto.split('===Argentina===')[1]?.split(/\n===/)[0];exigir(Boolean(seccion),`sección Argentina ${edicion}`,verificacion);
   const jugadores=[...seccion.matchAll(/\{\{nat fs(?: g)? player\|[^\n]*?\bname=\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(m=>({pagina:m[1],nombre:m[2]??m[1],edicion}));
   exigir(jugadores.length===n && new Set(jugadores.map(j=>j.pagina)).size===n,`Argentina ${edicion}: ${n} convocados finales`,verificacion);filas.push(...jugadores);
  }
  const balon=await wikitexto("Ballon d'Or",'en');
  fuentes.push({nombre:'Wikipedia: Balón de Oro masculino, 1956–2025',url:balon.url,licencia:'CC BY-SA 4.0; revisión registrada'});
  const tabla=balon.texto.split('== Winners ==')[1]?.split('=== Wins by player ===')[0];
  exigir(Boolean(tabla),'tabla de ganadores del Balón de Oro',verificacion);
  const premiados=[];
  for(const fila of tabla.split(/\n\|-/)){
   const anio=fila.match(/\[\[(\d{4}) (?:FIFA )?Ballon d'Or\|\d{4}\]\]/)?.[1];
   if(!anio || Number(anio)>2025)continue;
   const ganador=fila.split(/\n/).findIndex(l=>l.includes("'''1st'''"));
   const persona=ganador>=0?fila.split(/\n/)[ganador+1]?.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/):null;
   if(persona)premiados.push({pagina:persona[1],nombre:persona[2]??persona[1],balon:Number(anio)});
  }
  const anios=premiados.map(f=>f.balon);
  exigir(anios.length===69 && new Set(anios).size===69 && anios.every(a=>a>=1956&&a<=2025&&a!==2020),'69 ediciones adjudicadas 1956–2025; 2020 cancelada, 2026 aún no adjudicada',verificacion);
  filas.push(...premiados);
  const ids=await idsDePaginas(filas.map(f=>f.pagina));exigir([...ids.values()].every(Boolean),'todos los jugadores enlazados a Wikidata',verificacion);
  const et=await etiquetas([...new Set(ids.values())]), nacs=await propiedad([...new Set(ids.values())],'P27');const entidades=new Map();
  for(const f of filas){const id=ids.get(f.pagina),w=et.get(id),nombre=w.es??f.nombre;const n=nacs.get(id);const e=entidades.get(id)??{id,nombre,alias:limpiarAlias(nombre,[...w.alias,f.nombre]),popularidad:w.enlaces,atributos:{deporte:'fútbol',nacionalidades:n?.length && n.every(v=>v.valor.nombre)?[...new Set(n.map(v=>v.valor.nombre))]:null,logros:[],premios:[],anios_balon:[]},fuente:urlEntidad(id)};
   if(f.balon){e.atributos.logros.push(`Balón de Oro ${f.balon}`);e.atributos.premios=['Balón de Oro'];e.atributos.anios_balon.push(f.balon);}else e.atributos.logros.push(`Mundial ${f.edicion} con Argentina`);
   entidades.set(id,e);}
  exigir([...entidades.values()].some(e=>e.nombre==='Lionel Messi'&&e.atributos.logros.includes('Mundial 2022 con Argentina')),'Messi en el plantel campeón 2022',verificacion);
  exigir(entidades.get(ids.get('Lionel Messi')).atributos.anios_balon.length===8 && entidades.get(ids.get('Cristiano Ronaldo')).atributos.anios_balon.length===5,'Messi: ocho Balones de Oro; Cristiano Ronaldo: cinco',verificacion);
  return {entidades:[...entidades.values()],verificacion,cobertura:{criterio:'Planteles argentinos campeones 1978, 1986 y 2022 (22, 22 y 26), y 69 ediciones adjudicadas del Balón de Oro masculino 1956–2025, incluidas las seis FIFA Ballon d’Or 2010–2015. 2020 cancelada; no son todos los logros de los jugadores.',completoPor:{logros:[1978,1986,2022].map(a=>`Mundial ${a} con Argentina`),premios:['Balón de Oro']}},fuentes:[...fuentes,WIKIDATA],hoy};
 }
}];
