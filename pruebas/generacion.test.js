import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno } from './ayuda.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { crearProgramador } from '../servidor/programador.js';
import { publicarDesafio, preguntasDeDesafio, desafioPorFecha, respuestasDePregunta } from '../servidor/banco.js';
import { sumarDias } from '../servidor/tiempo.js';

const contar = async (db, modo = 'normal') => (await db.get('SELECT COUNT(*) AS n FROM desafios WHERE modo = ?', modo)).n;

test('la tarea es idempotente: una segunda ejecución no duplica ni reemplaza', async () => {
  const e = await prepararEntorno();
  const args = { db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, ahora: e.reloj.ahora };
  const r1 = await asegurarDesafio(args);
  assert.equal(r1.resultado, 'publicado');
  assert.equal(r1.origen, 'reserva');
  const antes = (await preguntasDeDesafio(e.db, r1.desafioId)).map((p) => p.enunciado);
  const r2 = await asegurarDesafio(args);
  assert.equal(r2.resultado, 'ya_existia');
  assert.equal(await contar(e.db), 1);
  assert.deepEqual((await preguntasDeDesafio(e.db, r1.desafioId)).map((p) => p.enunciado), antes);
});

test('dos ejecuciones simultáneas publican un solo desafío', async () => {
  const e = await prepararEntorno();
  const args = { db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, ahora: e.reloj.ahora };
  const resultados = await Promise.all([asegurarDesafio({ ...args, titular: 'a' }), asegurarDesafio({ ...args, titular: 'b' }), asegurarDesafio({ ...args, titular: 'c' })]);
  assert.equal(resultados.filter((r) => r.resultado === 'publicado').length, 1);
  assert.ok(resultados.filter((r) => r.resultado === 'ocupado').length >= 1);
  assert.equal(await contar(e.db), 1);
  assert.equal((await asegurarDesafio(args)).resultado, 'ya_existia');
});

test('la base rechaza publicar dos veces la misma fecha', async () => {
  const e = await prepararEntorno();
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, ahora: e.reloj.ahora });
  const preguntas = await preguntasDeDesafio(e.db, r.desafioId);
  const intento = await publicarDesafio(e.db, { fecha: '2026-10-05', preguntas, origen: 'reserva' });
  assert.equal(intento.publicado, false);
  await assert.rejects(() => e.db.run("INSERT INTO desafios (fecha, numero, origen, publicado_en) VALUES ('2026-10-05', 9, 'ia', 0)"), /UNIQUE/);
});

test('se publican las 7 preguntas juntas, con sus datos completos', async () => {
  const e = await prepararEntorno();
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, ahora: e.reloj.ahora });
  const preguntas = await preguntasDeDesafio(e.db, r.desafioId);
  assert.equal(preguntas.length, 7);
  assert.equal(new Set(preguntas.map((p) => p.categoria)).size, 7);
  for (const p of preguntas) {
    assert.ok(p.id && p.enunciado && p.alcance && p.categoria);
    assert.ok(JSON.parse(p.fuentes).length >= 1);
    for (const resp of await respuestasDePregunta(e.db, p.id)) {
      assert.ok(resp.canonica && resp.explicacion && resp.fuente_url.startsWith('https://'));
      assert.ok([10, 30, 60, 85, 100].includes(resp.puntos));
    }
  }
});

test('publicación remota: guarda el lote completo con un presupuesto acotado de viajes a la base', async () => {
  const e = await prepararEntorno();
  try {
    const primero = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva });
    const entradas = await e.db.all('SELECT categoria, reserva_id FROM preguntas WHERE desafio_id=? ORDER BY posicion', primero.desafioId);
    const preguntas = entradas.map(p => e.reserva.preguntas.find(r => r.id === p.reserva_id));
    let viajes = 0;
    const db = { transaccion: fn => e.db.transaccion(tx => fn(Object.fromEntries(['get', 'all', 'run', 'batch'].map(k => [k, async (...args) => {
      if (++viajes > 8) throw new Error('La transacción agotó el presupuesto de viajes remotos.');
      return tx[k](...args);
    }])))) };
    const r = await publicarDesafio(db, { fecha: '2026-10-06', preguntas, origen: 'reserva' });
    assert.ok(r.publicado);
    assert.equal((await preguntasDeDesafio(e.db, r.desafioId)).length, 7);
    assert.equal((await e.db.get('SELECT COUNT(*) AS n FROM respuestas WHERE pregunta_id LIKE ?', '2026-10-06-p%')).n, preguntas.reduce((n,p) => n + p.respuestas.length, 0));
  } finally { e.db.close(); }
});

test('una sentencia fallida del batch revierte todo y conserva el desafío anterior', async () => {
  const e = await prepararEntorno();
  try {
    const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva });
    const originales = await e.db.all('SELECT * FROM preguntas WHERE desafio_id=? ORDER BY posicion', r.desafioId);
    const respuestas = await e.db.all('SELECT * FROM respuestas WHERE pregunta_id LIKE ? ORDER BY id', '2026-10-05-p%');
    const preguntas = originales.map(p => structuredClone(e.reserva.preguntas.find(x => x.id === p.reserva_id)));
    preguntas.at(-1).respuestas[1].formas = preguntas.at(-1).respuestas[0].formas;
    await assert.rejects(() => publicarDesafio(e.db, { fecha: '2026-10-05', preguntas, origen: 'reserva', reemplazar: true }), /UNIQUE/);
    assert.deepEqual(await e.db.all('SELECT * FROM preguntas WHERE desafio_id=? ORDER BY posicion', r.desafioId), originales);
    assert.deepEqual(await e.db.all('SELECT * FROM respuestas WHERE pregunta_id LIKE ? ORDER BY id', '2026-10-05-p%'), respuestas);
  } finally { e.db.close(); }
});

test('la reserva no repite preguntas en días consecutivos', async () => {
  const e = await prepararEntorno();
  const usadas = new Set();
  for (let i = 0; i < 3; i++) {
    const fecha = sumarDias('2026-10-05', i);
    const r = await asegurarDesafio({ db: e.db, config: e.config, fecha, reserva: e.reserva, ahora: e.reloj.ahora });
    assert.equal(r.resultado, 'publicado');
    for (const p of await preguntasDeDesafio(e.db, r.desafioId)) {
      assert.ok(!usadas.has(p.reserva_id), `${p.reserva_id} se repitió`);
      usadas.add(p.reserva_id);
    }
  }
  assert.equal(usadas.size, 21);
});

test('el programador asegura hoy y prepara mañana recién cerca de medianoche', async () => {
  const e = await prepararEntorno({ inicio: '2026-10-05T10:00:00-03:00' });
  const silencioso = { info() {}, warn() {}, error() {} };
  const prog = crearProgramador({ db: e.db, config: e.config, contexto: { reserva: e.reserva, reservas: e.reservas }, ahora: e.reloj.ahora, log: silencioso });
  await prog.revisar();
  assert.ok(await desafioPorFecha(e.db, '2026-10-05'), 'hoy debe existir');
  assert.equal(await desafioPorFecha(e.db, '2026-10-06'), null, 'mañana espera a la ventana previa a medianoche');
  e.reloj.fijar('2026-10-05T23:45:00-03:00');
  await prog.revisar();
  assert.ok(await desafioPorFecha(e.db, '2026-10-06'), 'mañana se prepara con la reserva');
  e.reloj.fijar('2026-10-06T00:00:02-03:00');
  await prog.revisar();
  assert.equal(await desafioPorFecha(e.db, '2026-10-07'), null);
  assert.equal(await contar(e.db, 'normal'), 2);
  prog.detener();
});
