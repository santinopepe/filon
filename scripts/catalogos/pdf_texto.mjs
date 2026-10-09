// Extractor acotado a los PDF de ANMAT con fuentes WinAnsi y operadores Tj/TJ.
// Devuelve celdas según su rectángulo de recorte, conserva el texto original de cada tabla.
import { inflateSync } from 'node:zlib';
const literal = t => t.replace(/\\([0-7]{1,3}|[nrtbf()\\]|\r?\n)/g, (_,c) => /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c,8)) : ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[c] ?? c));
export function extraerCeldasPdf(buffer) {
  const s=buffer.toString('latin1'), paginas=[];
  for (const m of s.matchAll(/<<([^]*?)>>\s*stream\r?\n/g)) {
    if(!m[1].includes('FlateDecode')) continue;
    let t; try { t=inflateSync(buffer.subarray(m.index+m[0].length,s.indexOf('endstream',m.index+m[0].length))).toString('latin1'); } catch { continue; }
    if(!/\bT[Jj]\b/.test(t)) continue;
    const celdas=new Map(); let rect=null, x=0,y=0;
    const operadores= /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re|1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|(\[(?:[^]*?)\]|\((?:\\.|[^\\)])*\)) T[Jj]/g;
    for(const op of t.matchAll(operadores)) {
      if(op[1]!==undefined) { rect=op.slice(1,5).map(Number); continue; }
      if(op[5]!==undefined) {x=Number(op[5]);y=Number(op[6]);continue;}
      let texto=''; for(const token of op[7].matchAll(/\((?:\\.|[^\\)])*\)|<([A-Fa-f0-9]+)>/g)) {
        if(token[1]) continue; // Símbolos en fuentes CID; las tablas usan literales WinAnsi.
        texto+=literal(token[0].slice(1,-1));
      }
      if(!texto.trim()) continue;
      const clave=rect?.join(',') ?? `${x},${y}`;
      const c=celdas.get(clave) ?? {rect,x,y,lineas:new Map()};
      c.lineas.set(y,(c.lineas.get(y)??'')+texto);celdas.set(clave,c);
    }
    paginas.push([...celdas.values()].map(c=>({...c,texto:[...c.lineas].sort((a,b)=>b[0]-a[0]).map(([,t])=>t.trim()).join(' ').replace(/\s+/g,' ').trim(),lineas:undefined})));
  }
  if(!paginas.length) throw Error('PDF sin texto WinAnsi Tj/TJ; requiere revisar el extractor antes de importar');
  return paginas;
}
