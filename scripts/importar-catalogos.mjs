#!/usr/bin/env node
// Importa (o actualiza) los catálogos del generador desde sus fuentes y los guarda en datos/catalogos/.
// Solo este comando usa la red; el juego y la generación diaria leen los archivos guardados.
//
//   npm run importar-catalogos                 # todos
//   npm run importar-catalogos -- paises papas # algunos (los que dependen de otros usan el archivo guardado)
//   npm run importar-catalogos -- --seco       # verifica sin escribir
//
// Cada catálogo verifica su cobertura antes de guardarse; si algo no cierra, se informa y se conserva
// el archivo anterior. Revisá el diff (git diff datos/catalogos) antes de commitear.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFINICIONES } from './catalogos/definiciones.mjs';
import { armarCatalogo } from './catalogos/comun.mjs';
import { RAIZ } from '../servidor/config.js';

const DIR = resolve(RAIZ, 'datos/catalogos');
const args = process.argv.slice(2);
const seco = args.includes('--seco');
const pedidos = args.filter((a) => !a.startsWith('--'));
const desconocidos = pedidos.filter((p) => !DEFINICIONES.some((d) => d.id === p));
if (desconocidos.length) {
  console.error(`Catálogos desconocidos: ${desconocidos.join(', ')}. Disponibles: ${DEFINICIONES.map((d) => d.id).join(', ')}`);
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });
const hoy = new Date().toISOString().slice(0, 10);
const catalogos = {};
const cargarGuardado = (id) => {
  const ruta = join(DIR, `${id}.json`);
  if (!existsSync(ruta)) throw new Error(`Falta datos/catalogos/${id}.json: importalo primero.`);
  return JSON.parse(readFileSync(ruta, 'utf8'));
};

/** JSON legible y con diffs chicos: una entidad por línea. */
function serializar(catalogo) {
  const { entidades, ...meta } = catalogo;
  const cabeza = JSON.stringify(meta, null, 2).replace(/\n}$/, '');
  return `${cabeza},\n  "entidades": [\n${entidades.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]\n}\n`;
}

let fallas = 0;
for (const def of DEFINICIONES) {
  const elegido = !pedidos.length || pedidos.includes(def.id);
  if (!elegido) continue;
  for (const dep of def.depende ?? []) catalogos[dep] ??= cargarGuardado(dep);
  const inicio = Date.now();
  try {
    const r = await def.importar({ hoy, catalogos });
    const catalogo = armarCatalogo(def, r);
    catalogos[def.id] = catalogo;
    console.log(`✓ ${def.id}: ${catalogo.entidades.length} entidades · versión ${catalogo.version} · ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
    for (const v of catalogo.cobertura.verificacion) console.log(`    · ${v}`);
    for (const v of catalogo.cobertura.sinVerificarManualmente ?? []) console.log(`    ! ${v}`);
    for (const c of catalogo.correcciones) console.log(`    ~ ${c.entidad}: ${c.detalle} (${c.motivo})`);
    if (!seco) writeFileSync(join(DIR, `${def.id}.json`), serializar(catalogo));
  } catch (e) {
    fallas++;
    console.error(`✗ ${def.id}: ${e.message}`);
  }
}
if (seco) console.log('\n(--seco: no se escribió nada)');
process.exit(fallas ? 1 : 0);
