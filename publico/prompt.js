// Armado del prompt para una IA externa (sin DOM: se prueba con node:test).

/** Reemplaza el bloque «Historial reciente:» del prompt por el historial (o lo agrega al final). */
export function insertarHistorial(prompt, historial) {
  const json = historial.length ? `[\n${historial.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n]` : '[]';
  const patron = /(Historial reciente:[ \t]*\r?\n)[\s\S]*?(?=\r?\n[ \t]*\r?\nFuentes verificadas disponibles:)/;
  if (patron.test(prompt)) return prompt.replace(patron, (_, cabeza) => `${cabeza}${json}`);
  return `${prompt.trimEnd()}\n\nHistorial reciente:\n${json}\n`;
}
