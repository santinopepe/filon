#!/usr/bin/env node
// Chequeo estático complementario al lint: compila (sin ejecutar) cada archivo .js/.mjs del proyecto
// con `node --check` y verifica que todos los imports relativos apunten a archivos existentes.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const RAIZ = resolve(dirname(new URL(import.meta.url).pathname), '..');
const IGNORAR = new Set(['node_modules', '.git', 'filon', 'test-results', 'playwright-report', 'cobertura', '.vercel']);

function* archivos(dir) {
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) yield* archivos(ruta);
    else if (/\.(m?js)$/.test(nombre)) yield ruta;
  }
}

let errores = 0;
let revisados = 0;
for (const archivo of archivos(RAIZ)) {
  revisados++;
  const r = spawnSync(process.execPath, ['--check', archivo], { encoding: 'utf8' });
  if (r.status !== 0) {
    errores++;
    console.error(`✗ ${relative(RAIZ, archivo)}\n${r.stderr}`);
  }
  const codigo = readFileSync(archivo, 'utf8');
  for (const [, ruta] of codigo.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (!existsSync(resolve(dirname(archivo), ruta))) {
      errores++;
      console.error(`✗ ${relative(RAIZ, archivo)}: no existe el import «${ruta}»`);
    }
  }
}
console.log(`${revisados} archivos revisados, ${errores} errores.`);
process.exit(errores ? 1 : 0);
