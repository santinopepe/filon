#!/usr/bin/env node
// Tarea diaria para cron/systemd/programadores externos: publica el día de cada modo (Normal con el
// generador elegido en GENERADOR_NORMAL; los temáticos con su reserva). Es idempotente: si el desafío
// ya existe, no hace nada.
//
// Uso:
//   node scripts/generar-desafio.js                 # asegura el desafío de hoy (00:00 en Buenos Aires)
//   node scripts/generar-desafio.js --manana        # prepara el de mañana
//   node scripts/generar-desafio.js --fecha 2026-10-10
//   node scripts/generar-desafio.js --modo farandula  # un solo modo (por defecto: todos)
//   node scripts/generar-desafio.js --generador catalogos   # Normal con el generador por catálogos (o «reserva»)
//   node scripts/generar-desafio.js --vista-previa --fecha 2026-10-10   # qué armaría el generador, sin publicar
//   node scripts/generar-desafio.js --vista-previa --json               # lo mismo, en JSON (enunciados, descartes…)
//
// Códigos de salida (el peor de los modos): 0 publicado o ya existía · 2 ocupado · 1 fallo.
import { cargarConfig } from '../servidor/config.js';
import { abrirBD } from '../servidor/db.js';
import { crearContextoGeneracion } from '../servidor/generador/contexto.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { generarConCatalogos, resumirDescartes } from '../servidor/generador/catalogos.js';
import { fechaLocal, sumarDias, esFechaValida } from '../servidor/tiempo.js';
import { CLAVES_MODOS, esModo } from '../servidor/dominio.js';

const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const valor = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const config = cargarConfig();
const ahora = () => Date.now() + config.relojDesfaseMs;
let fecha = valor('--fecha') || fechaLocal(ahora(), config.zona);
if (tiene('--manana')) fecha = sumarDias(fechaLocal(ahora(), config.zona), 1);
if (!esFechaValida(fecha)) {
  console.error(`Fecha inválida: ${fecha}`);
  process.exit(1);
}
const modoPedido = valor('--modo');
if (modoPedido !== undefined && !esModo(modoPedido)) {
  console.error(`Modo desconocido: ${modoPedido}. Los válidos son ${CLAVES_MODOS.join(', ')}.`);
  process.exit(1);
}
const modos = modoPedido ? [modoPedido] : CLAVES_MODOS;
const generador = valor('--generador');
if (generador !== undefined && !['catalogos', 'reserva'].includes(generador)) {
  console.error('--generador es «catalogos» o «reserva».');
  process.exit(1);
}

const db = await abrirBD(config.rutaBD, { token: config.tokenBD });
const contexto = crearContextoGeneracion(config);

if (tiene('--vista-previa')) {
  // Revisión del generador por catálogos: enunciados, cantidades, fuentes, versiones y descartes.
  const g = await generarConCatalogos({ db, config, fecha, modo: 'normal' });
  db.close();
  if (tiene('--json')) {
    console.log(JSON.stringify({ fecha, ok: g.ok, semilla: g.semilla, versiones: g.versiones, elegidas: g.elegidas, errores: g.errores, problemas: g.problemas, descartes: g.descartes }, null, 2));
  } else {
    console.log(`Vista previa del ${fecha} (no se publica nada) · semilla ${g.semilla}`);
    console.log(`Versiones: plantillas ${g.versiones.plantillas} · filtros ${g.versiones.filtros} · texto ${g.versiones.texto} · generador ${g.versiones.generador}`);
    console.log(`Catálogos: ${g.versiones.catalogos.split(',').join(' · ')}\n`);
    g.elegidas.forEach((e, i) => {
      console.log(`${i + 1}. [${e.nombreCategoria} · ${e.dificultad.nivel} ${e.dificultad.valor}] ${e.enunciado}`);
      console.log(`   ${e.respuestas} respuestas · ${e.rechazos} rechazos con motivo · coincidencia ${e.coincidencia} · plantilla ${e.plantilla}`);
      console.log(`   ${e.catalogo} · ${e.fuentes.join(' · ')}`);
      console.log(`   las más valiosas: ${e.ejemplos.join(', ')}`);
    });
    for (const x of [...g.errores, ...g.problemas]) console.log(`! ${x}`);
    const r = resumirDescartes(g.descartes, 15);
    console.log(`\nDescartes: ${r.total}`);
    for (const [m, n] of Object.entries(r.porMotivo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} × ${m}`);
    for (const d of r.muestra) console.log(`  - ${d.plantilla}: ${d.enunciado ?? '(sin enunciado)'} → ${d.motivo}`);
  }
  process.exit(g.ok ? 0 : 2);
}

console.log(`[generar] ${new Date(ahora()).toISOString()} · fecha objetivo ${fecha}`);
let codigo = 0;
for (const modo of modos) {
  const r = await asegurarDesafio({ db, config, fecha, modo, ...contexto, ahora, generador: generador ?? null });
  console.log(JSON.stringify(r));
  if (r.corridaId) {
    const fila = await db.get('SELECT detalle FROM corridas WHERE id = ?', r.corridaId);
    const d = fila?.detalle ? JSON.parse(fila.detalle) : null;
    if (d) {
      for (const a of d.avisos || []) console.log(`[generar] ${modo}: aviso: ${a}`);
      if (d.errorLote) console.log(`[generar] ${modo}: lote inválido: ${d.errorLote.join(' ')}`);
    }
  }
  if (r.resultado === 'fallo') codigo = 1;
  else if (r.resultado !== 'publicado' && r.resultado !== 'ya_existia' && codigo === 0) codigo = 2;
}
db.close();
process.exit(codigo);
