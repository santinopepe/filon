#!/usr/bin/env node
// Valida en modo estricto el banco de reserva de cada modo de juego.
//   node scripts/validar-reserva.js            # estructura, duplicados y contradicciones
import { cargarConfig } from '../servidor/config.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { CATEGORIAS, MODOS, CLAVES_MODOS, PREGUNTAS_POR_DESAFIO } from '../servidor/dominio.js';

const config = cargarConfig();
const reservas = CLAVES_MODOS.map((modo) => ({
  modo,
  reserva: cargarReserva(modo === 'normal' ? config.rutaReserva : config.rutasReserva[modo], { dominios: config.fuentes.dominios, modo }),
}));

let problemas = 0;
for (const { modo, reserva } of reservas) {
  console.log(`\n${MODOS[modo].nombre}: banco de reserva v${reserva.version} (revisado ${reserva.revisado})`);
  const porCategoria = {};
  for (const p of reserva.preguntas) porCategoria[p.categoria] = (porCategoria[p.categoria] || 0) + 1;
  for (const clave of MODOS[modo].categorias) console.log(`  ${CATEGORIAS[clave].padEnd(11)} ${porCategoria[clave] || 0} pregunta(s)`);
  console.log(`Válidas: ${reserva.preguntas.length} · Inválidas: ${reserva.invalidas.length}`);
  // Un modo temático arma el día con siete preguntas distintas de su única categoría.
  if (MODOS[modo].categorias.length === 1 && reserva.preguntas.length < PREGUNTAS_POR_DESAFIO) {
    problemas++;
    console.log(`✗ Hacen falta al menos ${PREGUNTAS_POR_DESAFIO} preguntas válidas para completar un día.`);
  }
  for (const i of reserva.invalidas) {
    console.log(`\n✗ ${i.id}`);
    for (const e of i.errores) console.log(`   error: ${e}`);
    for (const d of i.descartadas) console.log(`   descartada: ${d.canonica} (${d.motivo})`);
    for (const a of i.advertencias) console.log(`   aviso: ${a}`);
  }
  problemas += reserva.invalidas.length;
}

process.exit(problemas ? 1 : 0);
