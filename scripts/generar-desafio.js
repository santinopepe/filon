#!/usr/bin/env node
// Tarea diaria para cron/systemd/programadores externos. Es idempotente: si el desafío ya existe, no hace nada.
//
// Uso:
//   node scripts/generar-desafio.js                 # asegura el desafío de hoy (00:00 en Buenos Aires)
//   node scripts/generar-desafio.js --manana        # prepara el de mañana
//   node scripts/generar-desafio.js --fecha 2026-10-10
//   node scripts/generar-desafio.js --manana --sin-reserva   # solo IA (solo Normal); si falla, queda pendiente (código 2)
//   node scripts/generar-desafio.js --solo-reserva  # publica sin llamar a la IA
//   node scripts/generar-desafio.js --modo farandula  # un solo modo (por defecto: todos)
//
// Códigos de salida (el peor de los modos): 0 publicado o ya existía · 2 pendiente/ocupado · 1 fallo.
import { cargarConfig } from '../servidor/config.js';
import { abrirBD } from '../servidor/db.js';
import { crearContextoGeneracion } from '../servidor/generador/contexto.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { fechaLocal, sumarDias, esFechaValida } from '../servidor/tiempo.js';
import { CLAVES_MODOS, MODOS, esModo } from '../servidor/dominio.js';

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
// Una corrida «solo IA» no tiene nada que hacer en los modos sin IA automática (se completan con la reserva).
const modos = (modoPedido ? [modoPedido] : CLAVES_MODOS).filter((m) => !tiene('--sin-reserva') || MODOS[m].iaAutomatica);

const db = await abrirBD(config.rutaBD, { token: config.tokenBD });
const contexto = crearContextoGeneracion(config);
if (tiene('--solo-reserva')) contexto.proveedor = null;

console.log(`[generar] ${new Date(ahora()).toISOString()} · fecha objetivo ${fecha} · IA: ${contexto.proveedor ? contexto.proveedor.modelo : 'no'}`);
let codigo = 0;
for (const modo of modos) {
  const r = await asegurarDesafio({ db, config, fecha, modo, ...contexto, permitirReserva: !tiene('--sin-reserva'), ahora });
  console.log(JSON.stringify(r));
  if (r.corridaId) {
    const fila = await db.get('SELECT detalle FROM corridas WHERE id = ?', r.corridaId);
    const d = fila?.detalle ? JSON.parse(fila.detalle) : null;
    if (d) {
      console.log(`[generar] ${modo}: preguntas rechazadas: ${d.rechazadas.length} · respuestas descartadas: ${d.descartes.length}`);
      for (const a of d.avisos) console.log(`[generar] ${modo}: aviso: ${a}`);
      if (d.errorIA) console.log(`[generar] ${modo}: error de IA: ${d.errorIA}`);
    }
  }
  if (r.resultado === 'fallo') codigo = 1;
  else if (r.resultado !== 'publicado' && r.resultado !== 'ya_existia' && codigo === 0) codigo = 2;
}
db.close();
process.exit(codigo);
