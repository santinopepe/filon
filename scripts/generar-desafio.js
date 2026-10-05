#!/usr/bin/env node
// Tarea diaria para cron/systemd/programadores externos. Es idempotente: si el desafío ya existe, no hace nada.
//
// Uso:
//   node scripts/generar-desafio.js                 # asegura el desafío de hoy (00:00 en Buenos Aires)
//   node scripts/generar-desafio.js --manana        # prepara el de mañana
//   node scripts/generar-desafio.js --fecha 2026-10-10
//   node scripts/generar-desafio.js --manana --sin-reserva   # solo IA; si falla, queda pendiente (código 2)
//   node scripts/generar-desafio.js --solo-reserva  # publica sin llamar a la IA
//
// Códigos de salida: 0 publicado o ya existía · 2 pendiente/ocupado · 1 fallo.
import { cargarConfig } from '../servidor/config.js';
import { abrirBD } from '../servidor/db.js';
import { crearContextoGeneracion } from '../servidor/generador/contexto.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { fechaLocal, sumarDias, esFechaValida } from '../servidor/tiempo.js';

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

const db = await abrirBD(config.rutaBD, { token: config.tokenBD });
const contexto = crearContextoGeneracion(config);
if (tiene('--solo-reserva')) contexto.proveedor = null;

console.log(`[generar] ${new Date(ahora()).toISOString()} · fecha objetivo ${fecha} · IA: ${contexto.proveedor ? contexto.proveedor.modelo : 'no'}`);
const r = await asegurarDesafio({ db, config, fecha, ...contexto, permitirReserva: !tiene('--sin-reserva'), ahora });
console.log(JSON.stringify(r));
if (r.corridaId) {
  const fila = await db.get('SELECT detalle FROM corridas WHERE id = ?', r.corridaId);
  const d = fila?.detalle ? JSON.parse(fila.detalle) : null;
  if (d) {
    console.log(`[generar] preguntas rechazadas: ${d.rechazadas.length} · respuestas descartadas: ${d.descartes.length}`);
    for (const a of d.avisos) console.log(`[generar] aviso: ${a}`);
    if (d.errorIA) console.log(`[generar] error de IA: ${d.errorIA}`);
  }
}
db.close();
process.exit(r.resultado === 'publicado' || r.resultado === 'ya_existia' ? 0 : r.resultado === 'fallo' ? 1 : 2);
