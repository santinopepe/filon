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
