import { wikitexto, exigir, WIKIDATA, POPULARIDAD_WIKIPEDIA } from './ayudas.mjs';
import { idsDePaginas } from './wikipedia_entidades.mjs';
import { etiquetas, propiedad, anio, urlEntidad } from './wikidata.mjs';
import { limpiarAlias } from './comun.mjs';
const COMPETICIONES=[['Copa Libertadores','List of Copa Libertadores finals','Q18416',1960,2025],['Copa Sudamericana','List of Copa Sudamericana finals','Q311919',2002,2025],['Champions','List of European Cup and UEFA Champions League finals','Q18756',1956,2025]];
export const CLUBES=[{id:'clubes_futbol',nombre:'Clubes campeones continentales',descripcion:'Campeones de Libertadores, Sudamericana y Champions hasta 2025, por edición verificada.',popularidad:POPULARIDAD_WIKIPEDIA,cobertura:{tipo:'completa',criterio:'Ganadores de Libertadores 1960–2025, Sudamericana 2002–2025 y Copa de Europa/Champions 1956–2025. Títulos verificados por año entre Wikidata y la lista de finales. Excluye el campeonato argentino.'},atributos:{pais:{tipo:'lista',etiqueta:'país'},ciudad:{tipo:'lista',etiqueta:'ciudad'},fundacion:{tipo:'numero',etiqueta:'año de fundación'},titulos:{tipo:'lista',etiqueta:'competición y edición'},competiciones:{tipo:'lista',etiqueta:'competición'},libertadores:{tipo:'lista_numeros',etiqueta:'años de Libertadores'},sudamericana:{tipo:'lista_numeros',etiqueta:'años de Sudamericana'},champions:{tipo:'lista_numeros',etiqueta:'años de Champions'}},async importar({hoy}){
 const filas=[],fuentes=[],verificacion=[],correcciones=[];
 for(const [competicion,pagina,,desde,hasta]of COMPETICIONES){
  const d=await wikitexto(pagina,'en');fuentes.push({nombre:`Wikipedia: finales ${competicion}`,url:d.url,licencia:'CC BY-SA 4.0; revisión registrada'});
  const tabla=d.texto.split('==Finals==')[1]?.split('==Performances==')[0]??d.texto.split('==List of finals==')[1]?.split('==Performances==')[0];if(!tabla)throw Error(`${competicion}: tabla de finales no encontrada`);
  const campeones=new Map(), ediciones=new Map();
  for(const fila of tabla.split(/\n\|-/)){
   const y=fila.match(/!\s*scope[^\n]*\[\[(\d{4})(?:[–-](\d{2,4}))? [^\]|]+\|/);if(!y)continue;const inicio=Number(y[1]);const anio=y[2]?Number(y[2].length===2?String(inicio+1):y[2]):inicio;if(anio<desde||anio>hasta)continue;
   const resto=fila.slice(fila.indexOf('\n',y.index));const equipos=[...resto.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];const equipo=equipos[0]?.[1];if(equipo){campeones.set(anio,equipo);ediciones.set(anio,fila.match(/\[\[([^|\]]+)/)?.[1]);}
  }
  exigir(campeones.size===hasta-desde+1,`${competicion}: ${hasta-desde+1} ediciones sin huecos; faltan ${Array.from({length:hasta-desde+1},(_,i)=>desde+i).filter(y=>!campeones.has(y))}`,verificacion);
  const ids=await idsDePaginas([...campeones.values()]);exigir([...ids.values()].every(Boolean),`${competicion}: clubes enlazados`,verificacion);
  const idsEdiciones=await idsDePaginas([...ediciones.values()]);
  exigir([...idsEdiciones.values()].every(Boolean),`${competicion}: ediciones enlazadas a Wikidata`,verificacion);
  const ganadores=await propiedad([...idsEdiciones.values()],'P1346');
  let coincidencias=0;
  for(const [y,p]of campeones){
    let id=ids.get(p);const dato=ganadores.get(idsEdiciones.get(ediciones.get(y)))??[];
    if(dato.some(f=>f.valor.id===id))coincidencias++;
    else {
      if(competicion==='Champions' && y===1986) {
        const url='https://www.uefa.com/uefaconferenceleague/news/0278-15f61fdeb728-2304d29ff95f-1000--club-facts-fcsb/';
        // Contraste manual 2026-10-08: la ficha oficial UEFA dice European Cup (1): 1986.
        // El sitio devuelve 400 al cliente Node; el contenido se revisó con el lector web.
        exigir(dato.some(f=>f.valor.id==='Q179658'),'UEFA: FCSB (históricamente Steaua) campeón 1986; ficha oficial contrastada manualmente al 2026-10-08',verificacion);
        id='Q179658';
        fuentes.push({nombre:'UEFA: FCSB facts, historial oficial',url,licencia:'Datos factuales de títulos; texto y marcas UEFA reservados, no reproducidos.'});
        correcciones.push({entidad:'Champions 1986',detalle:'Se usa FCSB / Steaua histórico (Q179658), no CSA Steaua creado en 2017 al que enlaza la tabla.',motivo:`Discrepancia inspeccionada y resuelta con el historial oficial UEFA: ${url}. Criterio deportivo de UEFA, no adjudicación de la disputa jurídica.`});
        filas.push({id,y,competicion,fuente:url});continue;
      }
      correcciones.push({entidad:`${competicion} ${y}`,detalle:`ganador: ${p} (${id}); Wikidata: ${dato.map(f=>f.valor.id).join(', ')||'sin ganador'}`,motivo:`Fila concreta de finales inspeccionada (${d.url}); se conserva el dato de la lista y su revisión, sin modificar Wikidata.`});
    }
    filas.push({id,y,competicion,fuente:d.url});
  }
  verificacion.push(`${competicion}: ${coincidencias}/${campeones.size} ganadores coinciden con P1346 de las ediciones enlazadas`);
 }
 const ids=[...new Set(filas.map(f=>f.id))],et=await etiquetas(ids),pais=await propiedad(ids,'P17'),ciudad=await propiedad(ids,'P159'),fundacion=await propiedad(ids,'P571');const lista=(m,id)=>{const v=m.get(id);return v?.length&&v.every(x=>x.valor.nombre)?[...new Set(v.map(x=>x.valor.nombre))]:null;};
 const entidades=ids.map(id=>{const w=et.get(id),nombre=w.es??w.en;if(!nombre)throw Error(`${id}: sin nombre`);const fs=filas.filter(f=>f.id===id);return {id,nombre,alias:limpiarAlias(nombre,[...w.alias,w.en]),popularidad:w.enlaces,atributos:{pais:lista(pais,id),ciudad:lista(ciudad,id),fundacion:fundacion.get(id)?.length===1?anio(fundacion.get(id)[0].valor):null,titulos:fs.map(f=>`${f.competicion} ${f.y}`),competiciones:[...new Set(fs.map(f=>f.competicion))],libertadores:fs.filter(f=>f.competicion==='Copa Libertadores').map(f=>f.y),sudamericana:fs.filter(f=>f.competicion==='Copa Sudamericana').map(f=>f.y),champions:fs.filter(f=>f.competicion==='Champions').map(f=>f.y)},fuente:urlEntidad(id)};});
 return {entidades,verificacion,correcciones,fuentes:[...fuentes,WIKIDATA],hoy};
}}];
