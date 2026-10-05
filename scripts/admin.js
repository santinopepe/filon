#!/usr/bin/env node
// Consultas de administración sobre la base local.
//   node scripts/admin.js reportes                 # respuestas reportadas como faltantes
//   node scripts/admin.js reporte <id> <estado>    # marca un reporte (aceptado | descartado | pendiente)
//   node scripts/admin.js corridas [n]             # últimas corridas de la tarea diaria
//   node scripts/admin.js desafio <AAAA-MM-DD>     # banco completo de un desafío
//   node scripts/admin.js desafios                 # lista de desafíos publicados
import { cargarConfig } from '../servidor/config.js';
import { abrirBD } from '../servidor/db.js';
import { desafioPorFecha, preguntasDeDesafio, respuestasDePregunta } from '../servidor/banco.js';

const [comando, ...resto] = process.argv.slice(2);
const config = cargarConfig();
const db = await abrirBD(config.rutaBD, { token: config.tokenBD });
const fechaHora = (ms) => (ms ? new Date(ms).toLocaleString('es-AR', { timeZone: config.zona, hourCycle: 'h23' }) : '—');

switch (comando) {
  case 'reportes': {
    const filas = await db.all(
      `SELECT r.id, r.pregunta_id, p.enunciado, r.texto, r.comentario, r.estado, r.creado_en,
              (SELECT COUNT(*) FROM reportes r2 WHERE r2.pregunta_id = r.pregunta_id AND r2.normalizado = r.normalizado) AS veces
       FROM reportes r JOIN preguntas p ON p.id = r.pregunta_id ORDER BY veces DESC, r.creado_en DESC LIMIT 200`,
    );
    if (!filas.length) console.log('No hay reportes.');
    for (const f of filas) {
      console.log(`#${f.id} [${f.estado}] ×${f.veces} · ${f.pregunta_id} · «${f.texto}»${f.comentario ? ` — ${f.comentario}` : ''}\n    ${f.enunciado} (${fechaHora(f.creado_en)})`);
    }
    break;
  }
  case 'reporte': {
    const [id, estado] = resto;
    if (!id || !['aceptado', 'descartado', 'pendiente'].includes(estado)) {
      console.error('Uso: admin.js reporte <id> <aceptado|descartado|pendiente>');
      process.exit(1);
    }
    const r = await db.run('UPDATE reportes SET estado = ? WHERE id = ?', estado, Number(id));
    console.log(r.changes ? 'Actualizado.' : 'No existe ese reporte.');
    break;
  }
  case 'corridas': {
    const n = Number(resto[0]) || 15;
    for (const c of await db.all('SELECT * FROM corridas ORDER BY id DESC LIMIT ?', n)) {
      const d = c.detalle ? JSON.parse(c.detalle) : {};
      console.log(
        `#${c.id} ${c.fecha_objetivo} · ${c.resultado} · IA:${c.uso_ia ? 'sí' : 'no'} · ${fechaHora(c.iniciada_en)}` +
          (d.rechazadas?.length ? ` · preguntas rechazadas ${d.rechazadas.length}` : '') +
          (d.descartes?.length ? ` · respuestas descartadas ${d.descartes.length}` : '') +
          (d.errorIA ? ` · error IA: ${d.errorIA}` : ''),
      );
    }
    break;
  }
  case 'desafios': {
    for (const d of await db.all('SELECT * FROM desafios ORDER BY fecha DESC LIMIT 60')) {
      console.log(`#${d.numero} ${d.fecha} · ${d.origen}${d.modelo ? ` (${d.modelo})` : ''} · publicado ${fechaHora(d.publicado_en)}`);
    }
    break;
  }
  case 'desafio': {
    const d = await desafioPorFecha(db, resto[0]);
    if (!d) {
      console.error('No hay desafío para esa fecha.');
      process.exit(1);
    }
    console.log(`Desafío #${d.numero} · ${d.fecha} · origen ${d.origen}`);
    for (const p of await preguntasDeDesafio(db, d.id)) {
      console.log(`\n${p.posicion}. [${p.categoria}] ${p.enunciado}\n   Alcance: ${p.alcance}`);
      for (const r of await respuestasDePregunta(db, p.id)) {
        const v = JSON.parse(r.variantes);
        console.log(`   ${String(r.puntos).padStart(3)} ${r.rareza.padEnd(8)} ${r.canonica}${v.length ? ` (${v.join(', ')})` : ''}`);
      }
    }
    break;
  }
  default:
    console.log('Comandos: reportes · reporte <id> <estado> · corridas [n] · desafios · desafio <AAAA-MM-DD>');
}
db.close();
