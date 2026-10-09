// Resuelve títulos enlazados de Wikipedia a Wikidata en lotes; nunca por semejanza del nombre.
import { descargar } from './comun.mjs';
import { enLotes } from './ayudas.mjs';
export async function idsDePaginas(titulos, idioma='en') {
  const salida=new Map();
  for(const lote of enLotes([...new Set(titulos)],40)) {
    const d=await descargar(`https://${idioma}.wikipedia.org/w/api.php?${new URLSearchParams({action:'query',titles:lote.join('|'),prop:'pageprops',ppprop:'wikibase_item',redirects:'1',format:'json',formatversion:'2'})}`,{json:true});
    const renombre=new Map([...(d.query.normalized??[]),...(d.query.redirects??[])].map(v=>[v.from,v.to]));
    for(const original of lote){let nombre=original;const vistos=new Set();while(renombre.has(nombre)&&!vistos.has(nombre)){vistos.add(nombre);nombre=renombre.get(nombre);}const pagina=d.query.pages.find(p=>p.title===nombre);salida.set(original,pagina?.pageprops?.wikibase_item??null);}
  }
  return salida;
}
