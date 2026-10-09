#!/usr/bin/env node
// Capacidad del generador por catálogos: cuántas consignas distintas y utilizables hay, sin contar
// combinaciones teóricas ni equivalentes. Un candidato cuenta si su filtro es válido, el tamaño está en
// rango, el catálogo lo cubre, no tiene nombres ambiguos y la pregunta pasa la validación. Dos candidatos
// con el mismo conjunto de respuestas (en el mismo catálogo) son la misma consigna y cuentan una vez.
//
//   npm run capacidad-catalogos                    # Normal: resumen por categoría, familia y cuellos de botella
//   npm run capacidad-catalogos -- --modo geografia # las plantillas que usa el modo Geografía
//   npm run capacidad-catalogos -- --json          # todo el detalle
import { cargarConfig } from '../servidor/config.js';
import { cargarCatalogos } from '../servidor/catalogos/catalogos.js';
import { cargarPlantillas } from '../servidor/catalogos/plantillas.js';
import { prepararCandidatos, REGLAS_LOTE } from '../servidor/catalogos/generador.js';
import { CATEGORIAS } from '../servidor/dominio.js';

const config = cargarConfig({ sinArchivoEnv: true, env: {} });
const { catalogos, problemas } = cargarCatalogos(config.catalogos.dir);
const plantillas = cargarPlantillas(config.catalogos.rutaPlantillas);
const ventana = Number(process.argv[process.argv.indexOf('--dias') + 1]) || config.catalogos.diasSinRepetir;
const modo = process.argv.includes('--modo') ? process.argv[process.argv.indexOf('--modo') + 1] : 'normal';
const reglas = REGLAS_LOTE[modo];
if (!reglas) throw new Error(`El modo «${modo}» no tiene generador (válidos: ${Object.keys(REGLAS_LOTE).join(', ')}).`);
const t0 = Date.now();

const unicos = new Map(); // conjunto → candidato
const propios = new Map(); // catálogo → conjuntos utilizables (las vistas se informan aunque dedupliquen)
const porPlantilla = [];
const delModo = plantillas.plantillas.filter((p) => reglas.categorias.includes(p.categoria) && (!p.modos || p.modos.includes(modo)));
for (const p of delModo) {
  const catalogo = catalogos.get(p.catalogo);
  if (!catalogo) {
    porPlantilla.push({ plantilla: p.id, familia: p.familia, categoria: p.categoria, utilizables: 0, motivo: 'falta el catálogo' });
    continue;
  }
  const { candidatos, combinaciones, descartes } = prepararCandidatos(p, catalogo, { dominios: config.fuentes.dominios, maxRespuestas: config.catalogos.maxRespuestas, validar: true, completo: true });
  const conjuntos = propios.get(catalogo.id) ?? new Set();
  candidatos.forEach(c => conjuntos.add(c.conjunto));
  propios.set(catalogo.id, conjuntos);
  for (const c of candidatos) if (!unicos.has(c.conjunto)) unicos.set(c.conjunto, c);
  porPlantilla.push({ plantilla: p.id, familia: p.familia, categoria: p.categoria, combinaciones, utilizables: candidatos.length, descartes });
}

const resumen = (clave) => {
  const m = new Map();
  for (const c of unicos.values()) m.set(clave(c), (m.get(clave(c)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const porCategoria = resumen((c) => c.categoria);
const conectados = new Set([...propios.keys(), ...[...propios.keys()].map(id => catalogos.get(id).universo)]);
const porCatalogo = [...conectados].map(id => {
  const c = catalogos.get(id), porVistas = new Set();
  for (const [vista, conjuntos] of propios) if (vista !== id && catalogos.get(vista).universo === id) for (const conjunto of conjuntos) porVistas.add(conjunto);
  return { catalogo: id, universo: c.universo, registros: c.entidades.length, vista: Boolean(c.base), utilizables: propios.get(id)?.size ?? 0, utilizablesViaVistas: porVistas.size };
});
const registrosPorCategoria = porCategoria.map(([categoria]) => [categoria, new Set(delModo.filter(p => p.categoria === categoria).flatMap(p => (catalogos.get(p.catalogo)?.entidades ?? []).map(e => `${catalogos.get(p.catalogo).universo}:${e.id}`))).size]);
const porFamilia = resumen((c) => c.familia);
const sinGramatica = [...unicos.values()].filter((c) => c.categoria !== 'gramatica').length;
// Cada familia aporta como mucho una pregunta por día: en una ventana de N días, min(candidatos, N).
const aporteVentana = porFamilia.filter(([f]) => ![...unicos.values()].some((c) => c.familia === f && c.categoria === 'gramatica')).reduce((s, [, n]) => s + Math.min(n, ventana), 0);

// Cota por flujo: categoría (2/día; Gramática 1), universo (2/3), conjunto (1/ventana)
// y familia (1/día). No prueba el reparto diario ni la rotación: eso lo verifica simular-calendario.
const red = new Map();
const conectar = (a, b, capacidad) => {
  if (!red.has(a)) red.set(a, []);
  if (!red.has(b)) red.set(b, []);
  const ida = { a: b, capacidad, reverso: red.get(b).length };
  const vuelta = { a, capacidad: 0, reverso: red.get(a).length };
  red.get(a).push(ida); red.get(b).push(vuelta);
};
for (const [c] of porCategoria) conectar('inicio', `categoria:${c}`, ventana * (modo === 'normal' && c === 'gramatica' ? 1 : reglas.maxPorCategoria));
const universos = new Map();
let alternativasOmitidas = 0;
for (const c of unicos.values()) {
  const u = c.catalogo.universo;
  if (!universos.has(u)) { conectar(`categoria:${c.categoria}`, `universo:${u}`, ventana * reglas.maxPorCatalogo); universos.set(u, c.categoria); }
  if (universos.get(u) !== c.categoria) { alternativasOmitidas++; continue; } // Subconjunto conservador: asignar el universo a una categoría.
  conectar(`universo:${u}`, `conjunto:${c.conjunto}`, 1);
  conectar(`conjunto:${c.conjunto}`, `familia:${c.familia}`, 1);
}
for (const [f] of porFamilia) conectar(`familia:${f}`, 'fin', ventana);
let cota = 0;
while (red.has('inicio') && red.has('fin')) {
  const camino = new Map([['inicio', null]]), cola = ['inicio'];
  for (let i = 0; i < cola.length && !camino.has('fin'); i++) for (const e of red.get(cola[i])) if (e.capacidad && !camino.has(e.a)) { camino.set(e.a, { desde: cola[i], e }); cola.push(e.a); }
  if (!camino.has('fin')) break;
  let capacidad = Infinity;
  for (let n = 'fin'; n !== 'inicio'; n = camino.get(n).desde) capacidad = Math.min(capacidad, camino.get(n).e.capacidad);
  for (let n = 'fin'; n !== 'inicio'; n = camino.get(n).desde) { const { e } = camino.get(n); e.capacidad -= capacidad; red.get(e.a)[e.reverso].capacidad += capacidad; }
  cota += capacidad;
}
const capacidadVentana = { necesarias: ventana * 7, cotaConTopes: cota, compatibleConTopes: cota >= ventana * 7, alternativasOmitidas, rotacion: 'Preferencia; verificar distribución y ventanas en simular-calendario. La cota no garantiza el reparto diario ni descarta solapamientos.' };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ modo, ventana, total: unicos.size, sinGramatica, aporteVentana, capacidadVentana, porCategoria, registrosPorCategoria, porCatalogo, porFamilia, porPlantilla, problemas: [...problemas, ...plantillas.problemas] }, null, 2));
} else {
  console.log(`Modo ${modo} · catálogos: ${catalogos.size} · plantillas del modo: ${delModo.length} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`Consignas distintas utilizables: ${unicos.size} (sin Gramática: ${sinGramatica})`);
  console.log(`Cota con topes de categoría, universo y familia: ${cota}/${ventana * 7}; ${capacidadVentana.compatibleConTopes ? 'compatible' : 'insuficiente'}. El reparto diario y la rotación se comprueban con la simulación.`);
  // Normal: como mucho una de Gramática por día (6 de las 7 son de otras categorías). Geografía: las 7.
  const porDia = modo === 'normal' ? 6 : 7;
  console.log(`Ventana de ${ventana} días: hacen falta ≥ ${ventana * porDia} fuera de Gramática; con una por familia y por día, las familias aportan ${aporteVentana}.`);
  console.log('\nPor categoría:');
  for (const [c, n] of porCategoria) console.log(`  ${(CATEGORIAS[c] ?? c).padEnd(14)} ${String(n).padStart(5)}`);
  console.log('\nPor catálogo (registros; consignas propias, antes de deduplicar base/vista):');
  for (const c of porCatalogo) console.log(`  ${c.catalogo.padEnd(32)} ${c.registros} registros · ${c.utilizables} consignas propias${c.utilizablesViaVistas ? ` · ${c.utilizablesViaVistas} conectadas por vistas (no sumar)` : ''}${c.vista ? ` · vista de ${c.universo}` : ''}`);
  console.log('\nPor familia (aporte en la ventana = mín(candidatos, días)):');
  for (const [f, n] of porFamilia) console.log(`  ${f.padEnd(28)} ${String(n).padStart(5)}${n < ventana ? `   (se agota: ${n}/${ventana})` : ''}`);
  console.log('\nPlantillas:');
  for (const p of porPlantilla) {
    const motivos = p.descartes ? Object.entries(p.descartes).map(([m, n]) => `${n} ${m}`).join(', ') : p.motivo;
    console.log(`  ${p.plantilla.padEnd(28)} ${String(p.utilizables).padStart(5)} de ${String(p.combinaciones ?? 0).padStart(5)} · ${motivos}`);
  }
  for (const x of problemas) console.log(`! ${x}`);
}
