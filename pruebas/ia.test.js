// Control de costos de la IA: cancelación real por tiempo, topes de llamadas, bloqueo global y registro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno } from './ayuda.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { crearProveedorAnthropic, crearProveedorSimulado } from '../servidor/generador/ia.js';
import { tomarBloqueo } from '../servidor/db.js';

const FECHA = '2026-10-05';
const registroEn = (lista) => ({ info: (evento, datos) => lista.push({ evento, ...datos }), warn() {}, error() {} });

test('al agotarse el presupuesto, la solicitud real al proveedor se aborta y se publica la reserva', async () => {
  const e = await prepararEntorno({ env: { IA_PRESUPUESTO_MS: '80' } });
  const senales = [];
  // fetch falso que nunca responde por su cuenta: solo termina si lo abortan.
  const obtener = (url, { signal }) =>
    new Promise((_, mal) => {
      senales.push(signal);
      signal.addEventListener('abort', () => mal(signal.reason ?? new Error('abortada')));
    });
  const proveedor = crearProveedorAnthropic({ claveApi: 'sk-prueba', urlApi: 'https://api.anthropic.com/v1/messages', modelo: 'm', modeloRevisor: 'r', obtener, tiempoLimiteMs: 60_000 });
  const t0 = Date.now();
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: FECHA, proveedor, verificador: e.verificador, reserva: e.reserva, ahora: e.reloj.ahora });
  assert.equal(r.resultado, 'publicado');
  assert.equal(r.origen, 'reserva');
  assert.ok(senales.length > 0, 'llegó a llamar al proveedor');
  assert.ok(senales.every((s) => s.aborted), 'todas las solicitudes en curso quedaron abortadas');
  assert.ok(Date.now() - t0 < 5000, `no espera el timeout de 60 s (${Date.now() - t0} ms)`);
  const detalle = JSON.parse((await e.db.get('SELECT detalle FROM corridas WHERE id = ?', r.corridaId)).detalle);
  assert.ok(detalle.avisos.some((a) => /presupuesto/.test(a)));
});

test('tope de llamadas por corrida y por día; sin cupo se usa la reserva', async () => {
  const e = await prepararEntorno({ env: { IA_MAX_LLAMADAS_POR_CORRIDA: '3', IA_MAX_LLAMADAS_POR_DIA: '5', IA_REVISION_ADVERSARIAL: '1' } });
  let llamadas = 0;
  const base = crearProveedorSimulado({ banco: e.reserva.preguntas });
  const proveedor = { ...base, generarPreguntas: async (a) => (llamadas++, base.generarPreguntas(a)), revisarPreguntas: async (a) => (llamadas++, base.revisarPreguntas(a)) };
  const eventos = [];
  const r1 = await asegurarDesafio({ db: e.db, config: e.config, fecha: FECHA, proveedor, verificador: e.verificador, reserva: e.reserva, ahora: e.reloj.ahora, registro: registroEn(eventos) });
  assert.equal(llamadas, 3, 'no pasa del tope de la corrida');
  assert.ok(['publicado'].includes(r1.resultado));
  const corrida = await e.db.get('SELECT llamadas_ia FROM corridas WHERE id = ?', r1.corridaId);
  assert.equal(corrida.llamadas_ia, 3, 'las llamadas quedan registradas en la corrida');
  const log = eventos.find((x) => x.evento === 'ia');
  assert.ok(log && log.llamadas === 3 && 'duracionMs' in log && 'tokensEntrada' in log);
  assert.ok(!JSON.stringify(eventos).includes('Nombrá'), 'el log no incluye prompts ni preguntas');

  // Segunda fecha del mismo día: quedan 2 llamadas del tope diario (5).
  await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-06', proveedor, verificador: e.verificador, reserva: e.reserva, ahora: e.reloj.ahora });
  assert.equal(llamadas, 5);
  // Tercera: sin cupo diario, no llama y publica la reserva.
  const r3 = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-07', proveedor, verificador: e.verificador, reserva: e.reserva, ahora: e.reloj.ahora });
  assert.equal(llamadas, 5, 'no se hizo ninguna llamada más');
  assert.equal(r3.origen, 'reserva');
  const detalle = JSON.parse((await e.db.get('SELECT detalle FROM corridas WHERE id = ?', r3.corridaId)).detalle);
  assert.ok(detalle.avisos.some((a) => /tope diario/.test(a)));
});

test('una sola generación con IA a la vez', async () => {
  const e = await prepararEntorno();
  let llamadas = 0;
  const base = crearProveedorSimulado({ banco: e.reserva.preguntas });
  const proveedor = { ...base, generarPreguntas: async (a) => (llamadas++, base.generarPreguntas(a)) };
  assert.ok(await tomarBloqueo(e.db, 'generacion:ia', 'otra-instancia', 60_000, e.reloj.ahora()));
  const soloIA = await asegurarDesafio({ db: e.db, config: e.config, fecha: FECHA, proveedor, verificador: e.verificador, reserva: e.reserva, permitirReserva: false, ahora: e.reloj.ahora });
  assert.equal(soloIA.resultado, 'ocupado');
  const conReserva = await asegurarDesafio({ db: e.db, config: e.config, fecha: FECHA, proveedor, verificador: e.verificador, reserva: e.reserva, ahora: e.reloj.ahora });
  assert.equal(conReserva.resultado, 'publicado');
  assert.equal(conReserva.origen, 'reserva');
  assert.equal(llamadas, 0, 'no duplicó la generación paga');
});
