#!/usr/bin/env node
// Capacidad del generador por catálogos: cuántas consignas distintas y utilizables hay, sin contar
// combinaciones teóricas ni equivalentes. Un candidato cuenta si su filtro es válido, el tamaño está en
// rango, el catálogo lo cubre, no tiene nombres ambiguos y la pregunta pasa la validación. Dos candidatos
// con el mismo conjunto de respuestas (en el mismo catálogo) son la misma consigna y cuentan una vez.
//
//   npm run capacidad-catalogos            # resumen por categoría, familia y cuellos de botella
//   npm run capacidad-catalogos -- --json  # todo el detalle
import { cargarConfig } from '../servidor/config.js';
import { cargarCatalogos } from '../servidor/catalogos/catalogos.js';
import { cargarPlantillas } from '../servidor/catalogos/plantillas.js';
import { prepararCandidatos } from '../servidor/catalogos/generador.js';
import { CATEGORIAS } from '../servidor/dominio.js';

const config = cargarConfig({ sinArchivoEnv: true, env: {} });
const { catalogos, problemas } = cargarCatalogos(config.catalogos.dir);
const plantillas = cargarPlantillas(config.catalogos.rutaPlantillas);
const ventana = Number(process.argv[process.argv.indexOf('--dias') + 1]) || config.catalogos.diasSinRepetir;
const t0 = Date.now();

const unicos = new Map(); // conjunto → candidato
const porPlantilla = [];
for (const p of plantillas.plantillas) {
  const catalogo = catalogos.get(p.catalogo);
  if (!catalogo) {
    porPlantilla.push({ plantilla: p.id, familia: p.familia, categoria: p.categoria, utilizables: 0, motivo: 'falta el catálogo' });
    continue;
  }
  const { candidatos, combinaciones, descartes } = prepararCandidatos(p, catalogo, { dominios: config.fuentes.dominios, maxRespuestas: config.catalogos.maxRespuestas, validar: true, completo: true });
  for (const c of candidatos) if (!unicos.has(c.conjunto)) unicos.set(c.conjunto, c);
  porPlantilla.push({ plantilla: p.id, familia: p.familia, categoria: p.categoria, combinaciones, utilizables: candidatos.length, descartes });
}

const resumen = (clave) => {
  const m = new Map();
  for (const c of unicos.values()) m.set(clave(c), (m.get(clave(c)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const porCategoria = resumen((c) => c.categoria);
const porFamilia = resumen((c) => c.familia);
const sinGramatica = [...unicos.values()].filter((c) => c.categoria !== 'gramatica').length;
// Cada familia aporta como mucho una pregunta por día: en una ventana de N días, min(candidatos, N).
const aporteVentana = porFamilia.filter(([f]) => ![...unicos.values()].some((c) => c.familia === f && c.categoria === 'gramatica')).reduce((s, [, n]) => s + Math.min(n, ventana), 0);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ventana, total: unicos.size, sinGramatica, aporteVentana, porCategoria, porFamilia, porPlantilla, problemas }, null, 2));
} else {
  console.log(`Catálogos: ${catalogos.size} · plantillas: ${plantillas.plantillas.length} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`Consignas distintas utilizables: ${unicos.size} (sin Gramática: ${sinGramatica})`);
  console.log(`Ventana de ${ventana} días: hacen falta ≥ ${ventana * 6} fuera de Gramática; con una por familia y por día, las familias aportan ${aporteVentana}.`);
  console.log('\nPor categoría:');
  for (const [c, n] of porCategoria) console.log(`  ${(CATEGORIAS[c] ?? c).padEnd(14)} ${String(n).padStart(5)}`);
  console.log('\nPor familia (aporte en la ventana = mín(candidatos, días)):');
  for (const [f, n] of porFamilia) console.log(`  ${f.padEnd(28)} ${String(n).padStart(5)}${n < ventana ? `   (se agota: ${n}/${ventana})` : ''}`);
  console.log('\nPlantillas:');
  for (const p of porPlantilla) {
    const motivos = p.descartes ? Object.entries(p.descartes).map(([m, n]) => `${n} ${m}`).join(', ') : p.motivo;
    console.log(`  ${p.plantilla.padEnd(28)} ${String(p.utilizables).padStart(5)} de ${String(p.combinaciones ?? 0).padStart(5)} · ${motivos}`);
  }
  for (const x of problemas) console.log(`! ${x}`);
}
