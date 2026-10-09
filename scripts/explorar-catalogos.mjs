// Exploración reproducible de fuentes que NO certifica ni publica un catálogo.
import { idsDePaginas } from './catalogos/wikipedia_entidades.mjs';
import { sparql, qid } from './catalogos/wikidata.mjs';
import { writeFileSync } from 'node:fs';
import { fechaLocal } from '../servidor/tiempo.js';
const hoy=fechaLocal(Date.now(),'America/Argentina/Buenos_Aires');
const nombres=['Pixar','Studio Ghibli','Walt Disney Animation Studios','Harry Potter (film series)','The Lord of the Rings (film series)','Star Wars','Toy Story (franchise)','Shrek (franchise)'];
const ids=await idsDePaginas(nombres);const resultados=[];
for(const [nombre,id]of ids){
 try {
  const propiedad=nombres.indexOf(nombre)<3?'P272':'P179';
  const filas=await sparql(`SELECT DISTINCT ?i WHERE { ?i wdt:${propiedad} wd:${id} ; wdt:P31/wdt:P279* wd:Q11424 ; wdt:P577 ?fecha . FILTER(?fecha <= "${hoy}T23:59:59Z"^^xsd:dateTime) FILTER NOT EXISTS { ?i wdt:P31/wdt:P279* wd:Q5398426 } FILTER NOT EXISTS { ?i wdt:P31/wdt:P279* wd:Q21191270 } }`);
  resultados.push({nombre,id,propiedad,cantidad:filas.length,ids:filas.map(f=>qid(f.i)),habilitado:false,motivo:'La cantidad por esta relación no certifica una filmografía: requiere contrastar la lista completa, incluidos cortos y telefilmes.'});
 } catch(e){resultados.push({nombre,id,habilitado:false,error:e.message});}
 console.log(nombre,resultados.at(-1).cantidad??resultados.at(-1).error);
}
writeFileSync(process.argv[2]??'/private/tmp/exploracion-cine.json',JSON.stringify({fecha:hoy,resultados},null,2)+'\n');
