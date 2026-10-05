#!/usr/bin/env node
// Valida el banco de reserva en modo estricto.
//   node scripts/validar-reserva.js            # estructura, duplicados y contradicciones
//   node scripts/validar-reserva.js --fuentes  # además, comprueba cada respuesta contra sus fuentes (requiere internet)
import { cargarConfig } from '../servidor/config.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { crearVerificador } from '../servidor/verificacion.js';
import { CATEGORIAS } from '../servidor/dominio.js';

const config = cargarConfig();
const reserva = cargarReserva(config.rutaReserva, { dominios: config.fuentes.dominios });

console.log(`Banco de reserva v${reserva.version} (revisado ${reserva.revisado})`);
const porCategoria = {};
for (const p of reserva.preguntas) porCategoria[p.categoria] = (porCategoria[p.categoria] || 0) + 1;
for (const [clave, nombre] of Object.entries(CATEGORIAS)) console.log(`  ${nombre.padEnd(11)} ${porCategoria[clave] || 0} pregunta(s)`);
console.log(`Válidas: ${reserva.preguntas.length} · Inválidas: ${reserva.invalidas.length}`);
for (const i of reserva.invalidas) {
  console.log(`\n✗ ${i.id}`);
  for (const e of i.errores) console.log(`   error: ${e}`);
  for (const d of i.descartadas) console.log(`   descartada: ${d.canonica} (${d.motivo})`);
  for (const a of i.advertencias) console.log(`   aviso: ${a}`);
}

let problemas = reserva.invalidas.length;
if (process.argv.includes('--fuentes')) {
  const verificador = crearVerificador({ ...config.fuentes, modo: 'estricta' });
  console.log('\nVerificando contra las fuentes…');
  for (const p of reserva.preguntas) {
    const r = await verificador.verificarPregunta(p);
    if (!r.verificada) {
      problemas++;
      console.log(`✗ ${p.id}: no se pudo leer ninguna fuente (${r.errores.join('; ')})`);
    } else if (r.descartadas.length) {
      problemas++;
      console.log(`△ ${p.id}: sin confirmar en la fuente → ${r.descartadas.map((d) => d.canonica).join(', ')}`);
    } else {
      console.log(`✓ ${p.id}: ${r.respuestas.length} respuestas confirmadas`);
    }
  }
}
process.exit(problemas ? 1 : 0);
