import { descargarBinario, limpiarAlias, sha } from './comun.mjs';
import { extraerCeldasPdf } from './pdf_texto.mjs';
import { exigir } from './ayudas.mjs';
const URL='https://www.argentina.gob.ar/sites/default/files/capitulo_xi_vegetales_actualiz_2025-12.pdf';
const categorias = {RAÍCESYTUBÉRCULOS:'hortalizas de raíz y tubérculo',BULBOSYHOJASENVAINADORAS:'hortalizas de bulbo y hojas envainadoras',TALLOSYPECÍOLOS:'hortalizas de tallo y pecíolo','HORTALIZASDEHOJAS(EXCEPTOLASDELGÉNEROBRASSICA)':'hortalizas de hoja (excepto Brassica)','INFLORESCENCIAS,FLORESOPIMPOLLOS':'flores comestibles',HORTALIZASDEFRUTO:'hortalizas de fruto',LEGUMBRES:'legumbres',CÍTRICOS:'frutas cítricas',PEPITA:'frutas de pepita',CAROZO:'frutas de carozo',BAYASYOTRASFRUTASPEQUEÑAS:'bayas y otras frutas pequeñas',SECAS:'frutas secas'};
export const GASTRONOMIA=[{
  id:'frutas_verduras',nombre:'Frutas, hortalizas y legumbres del CAA',descripcion:'Tablas cerradas de ANMAT; no es una lista de todas las especies comestibles.',
  popularidad:{criterio:'0: el CAA no publica notoriedad; desempate estable por id, sin inventar popularidad.'},
  cobertura:{tipo:'completa',criterio:'Filas completas de las tablas del CAA XI: raíces/tubérculos, bulbos/hojas envainadoras, tallos/pecíolos, hojas excepto Brassica, flores, frutos, legumbres, cítricos, pepita, carozo, bayas y frutas secas. Excluye coles, cucúrbitas y «otras frutas».'},
  atributos:{categorias:{tipo:'lista',etiqueta:'categoría del CAA'},cientifico:{tipo:'lista',etiqueta:'nombre taxonómico original'},fila:{tipo:'lista',etiqueta:'texto original del CAA'}},
  async importar({hoy}) {
    const pdf=await descargarBinario(URL), paginas=extraerCeldasPdf(pdf); const porNombre=new Map(), conteo={}; const verificacion=[],correcciones=[];
    let categoria=null;
    for(let i=0;i<25;i++) {
      if(![0,1,2,3,4,5,6,14,15,18,19,20,21,22,23,24].includes(i))continue;
      if(i===14)categoria='legumbres'; if(i===24)categoria='frutas secas';
      const celdas=paginas[i];
      for(const c of celdas) {
        const [x,y,w]=c.rect??[];
        if(w>400 && w<500) {categoria=categorias[c.texto.replace(/\s/g,'')]??null;continue;}
        if(!categoria || !(x<150 && w<220) || /Nombre|Categoría/.test(c.texto))continue;
        const taxon=celdas.find(t=>t.rect?.[0]>150 && Math.abs(t.rect[1]-y)<0.01);
        if(!taxon)continue;
        const original=c.texto;
        let comun=original.replace(/,?\s*(?:raíz|raíces|tubérculo|pequeño tubérculo|bulbo|bulbillos|hojas|pecíolos|pecíolo|brote|brotes|frutos)\b.*$/i,'').replace(/\.$/,'');
        const alias=comun.split(/,\s*|\s+o\s+|\s+y\s+|\//).map(t=>t.trim()).filter(t=>t && !t.startsWith('('));
        // Estas celdas tienen subtipos, o un paréntesis que es un nombre regional.
        if(comun.startsWith('Azahar:')) { comun='Azahar';alias.length=0; }
        if(comun.startsWith('Lupino o altramuz')) {comun='Lupino';alias.splice(0,alias.length,'Altramuz','Lupino común','Lupino amarillo','Lupino azul');}
        if(comun==='Kumquat (Quinoto)') {comun='Quinoto';alias.splice(0,alias.length,'Kumquat');}
        let nombre=comun.split(/,\s*|\s+o\s+/)[0].trim();
        if(original.startsWith('Castaña o Nuez de Pará')){nombre='Nuez de Pará';correcciones.push({entidad:original,detalle:'Nombre canónico Nuez de Pará, tomado de la misma fila.',motivo:'Es distinta de la Castaña (Castanea sativa); no fusionar dos filas de especies diferentes.'});}
        if(original==='ChileHabanero'){nombre='Chile Habanero';correcciones.push({entidad:original,detalle:'Separación de palabras Chile Habanero.',motivo:'Espacio visible en la tabla oficial perdido entre operadores TJ.'});}
        if(original.startsWith('Mora o Zarzamora')){nombre='Zarzamora';correcciones.push({entidad:original,detalle:'Nombre canónico Zarzamora, de la misma fila; descriptor arbustiva no es un alias.',motivo:'Distinguir Rubus de la mora arbórea (Morus).'});}
        if(original==='Mora (arbórea)')alias.push('Mora');
        const clave=nombre.toLocaleLowerCase('es');
        const e=porNombre.get(clave)??{id:`caa-${sha(clave).slice(0,12)}`,nombre,alias:[],popularidad:0,atributos:{categorias:[],cientifico:[],fila:[]},fuente:URL};
        e.alias=limpiarAlias(nombre,[...e.alias,...alias],{siglas:true});e.atributos.categorias.push(categoria);e.atributos.cientifico.push(taxon.texto);e.atributos.fila.push(original);porNombre.set(clave,e);
        conteo[categoria]=(conteo[categoria]??0)+1;
      }
    }
    const cantidades=[26,7,6,19,14,19,15,14,6,12,32,8];
    for(const [i,[cat,n]]of Object.entries(conteo).entries())exigir(n===cantidades[i],`${cat}: ${n} filas (esperadas ${cantidades[i]})`,verificacion);
    exigir(Object.keys(conteo).length===12,'12 tablas completas seleccionadas',verificacion);
    exigir(porNombre.get('batata')?.alias.includes('Boniato') && porNombre.get('batata')?.alias.includes('Camote'),'Batata: Boniato y Camote como alias regionales',verificacion);
    return {entidades:[...porNombre.values()],verificacion,correcciones,fuentes:[{nombre:'ANMAT, Código Alimentario Argentino, capítulo XI (12/2025)',url:URL,licencia:'CC BY 4.0 (Argentina.gob.ar, términos y condiciones); nombres y datos de las tablas con atribución.'}],hoy};
  },
}];
