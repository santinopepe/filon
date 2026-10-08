// Expansión mínima de un diccionario Hunspell (sufijos y prefijos, con banderas de continuación), solo
// para importar: sirve para saber qué entradas sueltas del .dic son en realidad formas flexionadas de
// otra entrada («hágalas» sale de «hacer»), y dejar en el catálogo solo formas de diccionario.

/** Lee las reglas de afijos de un .aff con FLAG UTF-8 (cada carácter es una bandera). */
export function leerAfijos(aff) {
  const reglas = new Map();
  for (const linea of aff.split('\n')) {
    const p = linea.trim().split(/\s+/);
    if (p[0] !== 'SFX' && p[0] !== 'PFX') continue;
    const [tipo, bandera] = p;
    if (p.length === 4 && /^\d+$/.test(p[3])) {
      reglas.set(bandera, { tipo, cruzado: p[2] === 'Y', reglas: [] });
      continue;
    }
    const grupo = reglas.get(bandera);
    if (!grupo) continue;
    const quitar = p[2] === '0' ? '' : p[2];
    const [agregar, continuacion = ''] = (p[3] === '0' ? '' : p[3]).split('/');
    const condicion = p[4] && p[4] !== '.' ? new RegExp(tipo === 'SFX' ? `${p[4]}$` : `^${p[4]}`) : null;
    grupo.reglas.push({ quitar, agregar: agregar === '0' ? '' : agregar, continuacion: [...continuacion], condicion });
  }
  return reglas;
}

/** Recorre las formas que genera una palabra con sus banderas (hasta dos niveles de continuación). */
export function expandir(palabra, banderas, reglas, visitar, nivel = 0) {
  if (nivel > 2) return;
  const sufijadas = [];
  for (const b of banderas) {
    const grupo = reglas.get(b);
    if (!grupo) continue;
    for (const r of grupo.reglas) {
      if (r.condicion && !r.condicion.test(palabra)) continue;
      let forma;
      if (grupo.tipo === 'SFX') {
        if (!palabra.endsWith(r.quitar)) continue;
        forma = palabra.slice(0, palabra.length - r.quitar.length) + r.agregar;
        if (grupo.cruzado) sufijadas.push(forma);
      } else {
        if (!palabra.startsWith(r.quitar)) continue;
        forma = r.agregar + palabra.slice(r.quitar.length);
      }
      visitar(forma);
      if (r.continuacion.length) expandir(forma, r.continuacion, reglas, visitar, nivel + 1);
    }
  }
  // Producto cruzado: prefijos (que lo permiten) sobre las formas con sufijo.
  for (const b of banderas) {
    const grupo = reglas.get(b);
    if (grupo?.tipo !== 'PFX' || !grupo.cruzado) continue;
    for (const s of sufijadas) for (const r of grupo.reglas) if ((!r.condicion || r.condicion.test(s)) && s.startsWith(r.quitar)) visitar(r.agregar + s.slice(r.quitar.length));
  }
}
