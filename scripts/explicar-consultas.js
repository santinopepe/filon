#!/usr/bin/env node
// EXPLAIN QUERY PLAN de las consultas principales: evidencia de que usan índices.
//   node scripts/explicar-consultas.js            # base temporal con el esquema actual
//   RUTA_BD=datos/filon.db node scripts/explicar-consultas.js
// Las pruebas (pruebas/consultas.test.js) fallan si alguna recorre una tabla grande completa.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirBD } from '../servidor/db.js';

const ID = 'x';
export const CONSULTAS = [
  { nombre: 'partida del jugador en el desafío', sql: 'SELECT * FROM partidas WHERE jugador_id = ? AND desafio_id = ?', args: [ID, 1] },
  {
    nombre: 'partida pendiente de un día anterior',
    sql: `SELECT p.* FROM partidas p JOIN desafios d ON d.id = p.desafio_id
          WHERE p.jugador_id = ? AND p.terminada_en IS NULL AND d.fecha < ? ORDER BY d.fecha DESC LIMIT 1`,
    args: [ID, '2026-10-05'],
  },
  { nombre: 'rondas de una partida', sql: 'SELECT * FROM rondas WHERE partida_id = ? ORDER BY posicion', args: [ID] },
  {
    nombre: 'intentos de una ronda (tope, dentro de la transacción)',
    sql: 'SELECT COUNT(*) AS n, COALESCE(SUM(normalizado = ?), 0) AS iguales FROM intentos WHERE partida_id = ? AND posicion = ?',
    args: ['a', ID, 1],
  },
  { nombre: 'intentos fallidos de una partida', sql: 'SELECT posicion, texto, motivo FROM intentos WHERE partida_id = ? AND aceptado = 0 ORDER BY id', args: [ID] },
  { nombre: 'histograma de puntajes del día', sql: 'SELECT puntos, cantidad FROM puntajes_desafio WHERE desafio_id = ? AND cantidad > 0 ORDER BY puntos DESC', args: [1] },
  {
    nombre: 'cantidad de respuestas por pregunta',
    sql: 'SELECT r.pregunta_id, COUNT(*) AS n FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id WHERE p.desafio_id = ? GROUP BY r.pregunta_id',
    args: [1],
  },
  { nombre: 'índice de variantes de una pregunta', sql: 'SELECT normalizada, respuesta_id FROM variantes WHERE pregunta_id = ?', args: [ID] },
  { nombre: 'respuestas aceptadas por id', sql: 'SELECT * FROM respuestas WHERE id IN (?, ?)', args: [1, 2] },
  { nombre: 'partidas de un desafío (borrado / confirmación)', sql: 'SELECT COUNT(*) AS n FROM partidas WHERE desafio_id = ?', args: [1] },
  {
    nombre: 'serie diaria del panel',
    sql: `SELECT d.fecha, COUNT(p.id) AS jugadores, COALESCE(SUM(p.terminada_en IS NOT NULL), 0) AS terminadas
          FROM desafios d LEFT JOIN partidas p ON p.desafio_id = d.id WHERE d.fecha BETWEEN ? AND ? GROUP BY d.id`,
    args: ['2026-09-01', '2026-10-05'],
  },
  { nombre: 'visitantes nuevos por período', sql: 'SELECT creado_en FROM jugadores WHERE creado_en >= ? AND creado_en < ?', args: [0, 1] },
  {
    nombre: 'resultados por pregunta del día (panel)',
    sql: `SELECT r.posicion, r.estado, COUNT(*) AS n FROM rondas r JOIN partidas p ON p.id = r.partida_id
          WHERE p.desafio_id = ? GROUP BY r.posicion, r.estado`,
    args: [1],
  },
  { nombre: 'reportes pendientes', sql: "SELECT COUNT(*) AS n FROM reportes WHERE estado = 'pendiente'", args: [] },
  {
    nombre: 'reportes de un jugador en una partida',
    sql: 'SELECT COUNT(*) AS n FROM reportes WHERE jugador_id = ? AND pregunta_id IN (SELECT pregunta_id FROM rondas WHERE partida_id = ?)',
    args: [ID, ID],
  },
  { nombre: 'sesión del panel', sql: 'SELECT ultima_actividad, vence_en, vida_hasta FROM admin_sesiones WHERE hash = ?', args: [ID] },
  { nombre: 'límite de solicitudes', sql: 'SELECT cuenta FROM limites WHERE clave = ?', args: [ID] },
  { nombre: 'limpieza: intentos viejos', sql: 'SELECT rowid FROM intentos WHERE en < ? LIMIT 5000', args: [0] },
  { nombre: 'limpieza: límites vencidos', sql: 'SELECT rowid FROM limites WHERE vence_en < ?', args: [0] },
  { nombre: 'limpieza: sesiones vencidas', sql: 'SELECT rowid FROM admin_sesiones WHERE vence_en <= ?', args: [0] },
  {
    nombre: 'limpieza: visitantes sin partidas',
    sql: `SELECT rowid FROM jugadores WHERE creado_en < ? AND NOT EXISTS (SELECT 1 FROM partidas p WHERE p.jugador_id = jugadores.id) LIMIT 5000`,
    args: [0],
  },
  { nombre: 'llamadas a la IA del día', sql: 'SELECT COALESCE(SUM(llamadas_ia), 0) AS n FROM corridas WHERE iniciada_en >= ?', args: [0] },
];

export async function explicar(db) {
  const salida = [];
  for (const c of CONSULTAS) {
    const plan = (await db.all(`EXPLAIN QUERY PLAN ${c.sql}`, ...c.args)).map((f) => f.detail);
    salida.push({ ...c, plan });
  }
  return salida;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const temporal = process.env.RUTA_BD ? null : mkdtempSync(join(tmpdir(), 'filon-explain-'));
  const db = await abrirBD(process.env.RUTA_BD || join(temporal, 'f.db'));
  for (const c of await explicar(db)) {
    console.log(`\n▸ ${c.nombre}`);
    for (const linea of c.plan) console.log(`    ${linea}`);
  }
  db.close();
  if (temporal) rmSync(temporal, { recursive: true, force: true });
}
