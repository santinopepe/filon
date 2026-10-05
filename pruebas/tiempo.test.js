import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaLocal, inicioDeFecha, proximaMedianoche, sumarDias, diasEntre, esFechaValida } from '../servidor/tiempo.js';

const ZONA = 'America/Argentina/Buenos_Aires';

test('el día de juego cambia a las 00:00 de Buenos Aires', () => {
  assert.equal(fechaLocal(Date.parse('2026-10-05T23:59:59-03:00'), ZONA), '2026-10-05');
  assert.equal(fechaLocal(Date.parse('2026-10-06T00:00:00-03:00'), ZONA), '2026-10-06');
  // 02:30 UTC todavía es el día anterior en Buenos Aires
  assert.equal(fechaLocal(Date.parse('2026-10-06T02:30:00Z'), ZONA), '2026-10-05');
});

test('inicio de fecha y próxima medianoche', () => {
  assert.equal(new Date(inicioDeFecha('2026-10-06', ZONA)).toISOString(), '2026-10-06T03:00:00.000Z');
  assert.equal(new Date(proximaMedianoche(Date.parse('2026-10-05T18:00:00-03:00'), ZONA)).toISOString(), '2026-10-06T03:00:00.000Z');
});

test('aritmética de fechas', () => {
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(diasEntre('2026-10-01', '2026-10-05'), 4);
  assert.ok(esFechaValida('2026-02-28'));
  assert.ok(!esFechaValida('2026-02-30'));
  assert.ok(!esFechaValida('05/10/2026'));
});
