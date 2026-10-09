import { descargarBinario, limpiarAlias, sha } from './comun.mjs';
import { extraerCeldasPdf } from './pdf_texto.mjs';
import { exigir, enLotes } from './ayudas.mjs';
import { sparql } from './wikidata.mjs';
const URL='https://www.argentina.gob.ar/sites/default/files/capitulo_xi_vegetales_actualiz_2025-12.pdf';
const categorias = {RAÍCESYTUBÉRCULOS:'hortalizas de raíz y tubérculo',BULBOSYHOJASENVAINADORAS:'hortalizas de bulbo y hojas envainadoras',TALLOSYPECÍOLOS:'hortalizas de tallo y pecíolo','HORTALIZASDEHOJAS(EXCEPTOLASDELGÉNEROBRASSICA)':'hortalizas de hoja (excepto Brassica)','INFLORESCENCIAS,FLORESOPIMPOLLOS':'flores comestibles',HORTALIZASDEFRUTO:'hortalizas de fruto',LEGUMBRES:'legumbres',CÍTRICOS:'frutas cítricas',PEPITA:'frutas de pepita',CAROZO:'frutas de carozo',BAYASYOTRASFRUTASPEQUEÑAS:'bayas y otras frutas pequeñas',SECAS:'frutas secas'};
/**
 * Nombres de taxón de una celda del CAA, del más específico al más general: «Citrus limon(L.) Burm. f.»
 * → [«Citrus limon»]; «Allium cepa L. var. aggregatum» → [«Allium cepa var. aggregatum», «Allium cepa»,
 * «Allium»]; se prueba también la escritura de híbrido («Citrus × limon»). Una celda con varios nombres («… // Citrus aurantiifolia Swingle») da una lista por nombre.
 */
// Nombres de taxón que no se pueden buscar tal como quedan en el texto: espacios perdidos al extraer el
// PDF, erratas de la tabla, un género abreviado y un sinónimo. Solo se corrigen para buscar el taxón; el
// texto original del CAA se conserva en el catálogo.
const TAXON_CORREGIDO = [
  [/^Cyperusesculentus\b/, 'Cyperus esculentus', 'espacio perdido al extraer el PDF'],
  [/^Prunuspersica\b/, 'Prunus persica', 'espacio perdido al extraer el PDF'],
  [/^Spinacea oleracea\b/, 'Spinacia oleracea', 'errata de la tabla (el género es Spinacia)'],
  [/^Caléndula officinalis\b/, 'Calendula officinalis', 'errata de la tabla (sin tilde en latín)'],
  [/^C\. pepo\b/, 'Cucurbita pepo', 'género abreviado en la tabla'],
  [/^Ahipa Pachyrrhizus ahipa\b/, 'Pachyrhizus ahipa', 'la celda repite el nombre común y escribe Pachyrrhizus'],
  [/^Rorippa nasturtium-aquaticum\b/, 'Nasturtium officinale', 'sinónimo: Wikidata usa el nombre aceptado'],
  [/^Zea maiz\b/, 'Zea mays', 'errata de la tabla (la especie es mays)'],
  [/^Citrus paradisii\b/, 'Citrus paradisi', 'errata de la tabla (la especie es paradisi)'],
];
export const correccionesDeTaxon = [];

function nombresDeTaxon(celda) {
  return celda.split(/\/\/|;/).map((parte)=>{
    let t=parte.replace(/^[^:]*:\s*/,'').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim();
    for(const [re,nombre,motivo] of TAXON_CORREGIDO) if(re.test(t)) { correccionesDeTaxon.push({entidad:t,detalle:`se busca el taxón «${nombre}»`,motivo}); t=t.replace(re,nombre); }
    const m=t.match(/^([A-Z][a-z]+)\s+(?:([x×])\s*)?([a-z][a-z-]+)(?:.*?\b(var\.|subsp\.)\s*([a-z][a-z-]+))?/);
    if(!m) return [t.match(/^[A-Z][a-z]+/)?.[0]].filter(Boolean);
    const [,genero,hibrido,especie,rango,infra]=m;
    const sp=`${genero} ${hibrido?'× ':''}${especie}`;
    // Wikidata registra muchos frutales como híbridos («Citrus × limon»): se prueban las dos escrituras
    // antes de caer en el género.
    const escrituras=[`${genero} ${especie}`,`${genero} × ${especie}`,`${genero} ×${especie}`];
    return [...(rango?[`${sp} ${rango} ${infra}`]:[]),...escrituras,genero];
  }).filter(l=>l.length);
}

export const GASTRONOMIA=[{
  id:'frutas_verduras',nombre:'Frutas, hortalizas y legumbres del CAA',descripcion:'Tablas cerradas de ANMAT; no es una lista de todas las especies comestibles.',
  popularidad:{criterio:'Artículos de Wikipedia (sitelinks de Wikidata) del taxón con el nombre científico de la tabla del CAA (P225) o de su producto (P1672: la manzana como fruta), el mayor: primero el nombre completo con variedad o subespecie, si no la especie y, como último recurso, el género. Con varios taxones en la fila, el de más artículos.',nota:'Es una medida de notoriedad, no de consumo.'},
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
    // Popularidad: el taxón de Wikidata con el nombre científico de la fila (sin el autor).
    const entidades=[...porNombre.values()];
    const niveles=new Map(entidades.map(e=>[e.id,e.atributos.cientifico.flatMap(nombresDeTaxon)]));
    const buscados=[...new Set([...niveles.values()].flat().flat())];
    const enlaces=new Map();
    // Del taxón y de lo que Wikidata dice que sale de él (P1672, «este taxón es fuente de»): la manzana
    // como fruta (Q89) tiene muchos más artículos que el manzano (Malus domestica).
    for(const lote of enLotes(buscados,150)) for(const f of await sparql(`SELECT ?n ?s ?ps WHERE { VALUES ?n { ${lote.map(n=>JSON.stringify(n)).join(' ')} } ?i wdt:P225 ?n ; wikibase:sitelinks ?s . OPTIONAL { ?i wdt:P1672 ?p . ?p wikibase:sitelinks ?ps } }`)) enlaces.set(f.n,Math.max(enlaces.get(f.n)??0,Number(f.s),Number(f.ps??0)));
    for(const e of entidades) {
      // Por cada taxón de la fila, el máximo entre variedad, especie (en sus escrituras) y productos; el
      // género solo si no hay nada más específico. Después, el máximo entre los taxones de la fila.
      e.popularidad=Math.max(0,...niveles.get(e.id).map(candidatos=>{
        const especificos=candidatos.slice(0,-1).filter(n=>enlaces.has(n)).map(n=>enlaces.get(n));
        return especificos.length?Math.max(...especificos):(enlaces.get(candidatos.at(-1))??0);
      }));
    }
    correcciones.push(...correccionesDeTaxon.filter((c,i,l)=>l.findIndex(x=>x.entidad===c.entidad)===i));
    const pop=n=>porNombre.get(n)?.popularidad??0;
    const sinTaxon=entidades.filter(e=>!e.popularidad).map(e=>e.nombre);
    verificacion.push(`${entidades.length-sinTaxon.length} de ${entidades.length} con su taxón en Wikidata; sin taxón (popularidad 0): ${sinTaxon.join(', ')||'ninguno'}`);
    exigir(pop('limón')>pop('lima dulce de palestina') && pop('papa')>pop('ahipa') && pop('manzana')>pop('membrillo'),'limón, papa y manzana son más conocidos que lima dulce de Palestina, ahipa y membrillo',verificacion);
    return {entidades,verificacion,correcciones,fuentes:[{nombre:'ANMAT, Código Alimentario Argentino, capítulo XI (12/2025)',url:URL,licencia:'CC BY 4.0 (Argentina.gob.ar, términos y condiciones); nombres y datos de las tablas con atribución.'}],hoy};
  },
}];
