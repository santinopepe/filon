#!/usr/bin/env node
// Consultas de administración sobre la base local.
//   node scripts/admin.js reportes                 # respuestas reportadas como faltantes
//   node scripts/admin.js reporte <id> <estado>    # marca un reporte (aceptado | descartado | pendiente)
//   node scripts/admin.js corridas [n]             # últimas corridas de la tarea diaria
//   node scripts/admin.js desafio <AAAA-MM-DD> [modo]   # banco completo de un desafío (modo: normal por defecto)
//   node scripts/admin.js desafios [modo]          # lista de desafíos publicados (todos los modos si no se indica)
//   node scripts/admin.js copiar-reserva [modo] [--seco]   # copia a la reserva de la base las preguntas ya publicadas
import { cargarConfig } from '../servidor/config.js';
import { abrirBD } from '../servidor/db.js';
import { desafioPorFecha, preguntasDeDesafio, respuestasDePregunta } from '../servidor/banco.js';
import { CLAVES_MODOS, esModo } from '../servidor/dominio.js';
import { cargarReserva, copiarPublicadasAReserva } from '../servidor/generador/reserva.js';

function modoArgumento(valor, porDefecto) {
  if (valor === undefined) return porDefecto;
  if (!esModo(valor)) {
    console.error(`Modo desconocido: ${valor}. Los válidos son ${CLAVES_MODOS.join(', ')}.`);
    process.exit(1);
  }
  return valor;
}

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
        `#${c.id} ${c.fecha_objetivo} · ${c.modo} · ${c.resultado} · IA:${c.uso_ia ? 'sí' : 'no'} · ${fechaHora(c.iniciada_en)}` +
          (d.rechazadas?.length ? ` · preguntas rechazadas ${d.rechazadas.length}` : '') +
          (d.descartes?.length ? ` · respuestas descartadas ${d.descartes.length}` : '') +
          (d.errorIA ? ` · error IA: ${d.errorIA}` : ''),
      );
    }
    break;
  }
  case 'desafios': {
    const modo = modoArgumento(resto[0], null);
    const filas = modo
      ? await db.all('SELECT * FROM desafios WHERE modo = ? ORDER BY fecha DESC LIMIT 60', modo)
      : await db.all('SELECT * FROM desafios ORDER BY fecha DESC, modo LIMIT 180');
    for (const d of filas) {
      console.log(`#${d.numero} ${d.fecha} · ${d.modo} · ${d.origen}${d.modelo ? ` (${d.modelo})` : ''} · publicado ${fechaHora(d.publicado_en)}`);
    }
    break;
  }
  case 'desafio': {
    const modo = modoArgumento(resto[1], 'normal');
    const d = await desafioPorFecha(db, resto[0], modo);
    if (!d) {
      console.error(`No hay desafío de ${modo} para esa fecha.`);
      process.exit(1);
    }
    console.log(`Desafío #${d.numero} · ${d.fecha} · ${d.modo} · origen ${d.origen}`);
    for (const p of await preguntasDeDesafio(db, d.id)) {
      console.log(`\n${p.posicion}. [${p.categoria}] ${p.enunciado}\n   Alcance: ${p.alcance}`);
      for (const r of await respuestasDePregunta(db, p.id)) {
        const v = JSON.parse(r.variantes);
        console.log(`   ${String(r.puntos).padStart(3)} ${r.rareza.padEnd(8)} ${r.canonica}${v.length ? ` (${v.join(', ')})` : ''}`);
      }
    }
    break;
  }
  case 'copiar-reserva': {
    const seco = resto.includes('--seco');
    const modo = modoArgumento(resto.find((x) => !x.startsWith('--')), null);
    for (const m of modo ? [modo] : CLAVES_MODOS) {
      const ruta = m === 'normal' ? config.rutaReserva : config.rutasReserva[m];
      const idsArchivo = new Set(cargarReserva(ruta, { dominios: config.fuentes.dominios, modo: m }).preguntas.map((p) => p.id));
      const r = await copiarPublicadasAReserva(db, m, { idsArchivo, dominios: config.fuentes.dominios, seco });
      console.log(`${m}: ${r.revisadas} publicadas · ${r.copiadas} ${seco ? 'se copiarían' : 'copiadas'} · ${r.yaEstaban} ya estaban · ${r.delArchivo} del archivo · ${r.invalidas.length} no validan`);
      for (const i of r.invalidas) console.log(`   ✗ ${i.id} (${i.fecha}): ${i.errores.join(' ')}`);
    }
    break;
  }
  default:
    console.log('Comandos: reportes · reporte <id> <estado> · corridas [n] · desafios [modo] · desafio <AAAA-MM-DD> [modo] · copiar-reserva [modo] [--seco]');
}
db.close();
