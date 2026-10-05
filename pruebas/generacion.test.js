import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno, paginaCon } from './ayuda.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { crearProveedorSimulado } from '../servidor/generador/ia.js';
import { crearVerificador } from '../servidor/verificacion.js';
import { crearProgramador } from '../servidor/programador.js';
import { publicarDesafio, preguntasDeDesafio, desafioPorFecha, respuestasDePregunta } from '../servidor/banco.js';
import { sumarDias } from '../servidor/tiempo.js';
import { crearCatalogoWikidata, _interno as wikidataInterno } from '../servidor/generador/wikidata.js';
import { validarPregunta } from '../servidor/validacion.js';

const contar = async (db) => (await db.get('SELECT COUNT(*) AS n FROM desafios')).n;

test('Wikidata hidrata preguntas globales con al menos 1000 respuestas y rarezas', async () => {
  const bindings = Array.from({ length: 1000 }, (_, i) => ({
    item: { value: `https://www.wikidata.org/entity/Q${i + 1}` },
    itemLabel: { value: `Entidad global ${i + 1}` },
    itemAltLabel: { value: `Alias ${i + 1}` },
    popularidad: { value: String(10_000 - i) },
  }));
  const catalogo = crearCatalogoWikidata({
    obtener: async () => new Response(JSON.stringify({ results: { bindings } }), { status: 200, headers: { 'content-type': 'application/sparql-results+json' } }),
  });
  const pregunta = await catalogo.hidratar({
    categoria: 'ciencia',
    enunciado: 'Nombrá una persona dedicada a la ciencia.',
    alcance: 'Personas registradas en Wikidata con una ocupación científica.',
    consulta_wikidata: 'SELECT DISTINCT ?item ?popularidad WHERE { ?item ?p ?o. BIND(1 AS ?popularidad) } LIMIT 1000',
    rechazos: [],
  });
  assert.equal(pregunta.datosEstructurados, 'wikidata');
  assert.equal(pregunta.respuestas.length, 1000);
  assert.equal(pregunta.respuestas[0].rareza, 'grava');
  assert.equal(pregunta.respuestas.at(-1).rareza, 'diamante');
  assert.match(pregunta.respuestas[0].fuente.url, /wikidata\.org\/wiki\/Q1$/);
  assert.ok(validarPregunta(pregunta, { dominios: ['wikidata.org'] }).ok, 'el validador admite el catálogo estructurado completo');
  assert.throws(
    () => wikidataInterno.consultaSegura('DELETE WHERE { ?item ?p ?o }'),
    /SELECT/,
  );
});

function verificadorFalso(entorno, excluir = []) {
  const textos = entorno.reserva.preguntas.flatMap((p) => p.respuestas.map((r) => r.canonica)).filter((t) => !excluir.includes(t));
  let lecturas = 0;
  const v = crearVerificador({
    dominios: entorno.config.fuentes.dominios,
    modo: 'estricta',
    obtener: async () => {
      lecturas++;
      return new Response(paginaCon(textos), { status: 200, headers: { 'content-type': 'text/html' } });
    },
  });
  return { v, lecturas: () => lecturas };
}

test('la tarea es idempotente: una segunda ejecución no duplica ni reemplaza', async () => {
  const e = await prepararEntorno();
  const args = { db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: e.verificador, ahora: e.reloj.ahora };
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
  const { v } = verificadorFalso(e);
  const proveedor = crearProveedorSimulado({ banco: e.reserva.preguntas });
  const args = { db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: v, proveedor, ahora: e.reloj.ahora };
  const resultados = await Promise.all([asegurarDesafio({ ...args, titular: 'a' }), asegurarDesafio({ ...args, titular: 'b' }), asegurarDesafio({ ...args, titular: 'c' })]);
  assert.equal(resultados.filter((r) => r.resultado === 'publicado').length, 1);
  assert.ok(resultados.filter((r) => r.resultado === 'ocupado').length >= 1);
  assert.equal(await contar(e.db), 1);
  assert.equal((await asegurarDesafio(args)).resultado, 'ya_existia');
});

test('la base rechaza publicar dos veces la misma fecha', async () => {
  const e = await prepararEntorno();
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: e.verificador, ahora: e.reloj.ahora });
  const preguntas = await preguntasDeDesafio(e.db, r.desafioId);
  const intento = await publicarDesafio(e.db, { fecha: '2026-10-05', preguntas, origen: 'reserva' });
  assert.equal(intento.publicado, false);
  await assert.rejects(() => e.db.run("INSERT INTO desafios (fecha, numero, origen, publicado_en) VALUES ('2026-10-05', 9, 'ia', 0)"), /UNIQUE/);
});

test('se publican las 7 preguntas juntas, con sus datos completos', async () => {
  const e = await prepararEntorno();
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: e.verificador, ahora: e.reloj.ahora });
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
    const r = await asegurarDesafio({ db: e.db, config: e.config, fecha, reserva: e.reserva, verificador: e.verificador, ahora: e.reloj.ahora });
    assert.equal(r.resultado, 'publicado');
    for (const p of await preguntasDeDesafio(e.db, r.desafioId)) {
      assert.ok(!usadas.has(p.reserva_id), `${p.reserva_id} se repitió`);
      usadas.add(p.reserva_id);
    }
  }
  assert.equal(usadas.size, 21);
});

test('con IA: depura respuestas falsas por fuentes y por revisión, y publica el lote', async () => {
  const e = await prepararEntorno();
  const { v } = verificadorFalso(e);
  const proveedor = crearProveedorSimulado({ banco: e.reserva.preguntas });
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: v, proveedor, ahora: e.reloj.ahora });
  assert.equal(r.resultado, 'publicado');
  assert.equal(r.origen, 'ia');
  const canonicas = (await e.db.all('SELECT canonica FROM respuestas')).map((x) => x.canonica);
  assert.ok(!canonicas.includes('Atlántida'));
  const detalle = JSON.parse((await e.db.get('SELECT detalle FROM corridas WHERE id = ?', r.corridaId)).detalle);
  assert.ok(detalle.descartes.some((d) => d.canonica === 'Atlántida' && d.etapa === 'fuentes'));
});

test('con IA: la revisión adversarial solo puede quitar respuestas', async () => {
  const e = await prepararEntorno();
  const { v } = verificadorFalso(e);
  const simulado = crearProveedorSimulado({ banco: e.reserva.preguntas, respuestaFalsa: false });
  const proveedor = {
    ...simulado,
    async revisarPreguntas({ preguntas }) {
      const { revisiones } = await simulado.revisarPreguntas({ preguntas });
      for (const rev of revisiones) {
        const marte = rev.respuestas.find((x) => x.canonica === 'Marte');
        if (marte) marte.veredicto = 'dudosa';
      }
      return { revisiones };
    },
  };
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: v, proveedor, ahora: e.reloj.ahora });
  assert.equal(r.resultado, 'publicado');
  const canonicas = (await e.db.all('SELECT canonica FROM respuestas')).map((x) => x.canonica);
  assert.ok(!canonicas.includes('Marte'));
});

test('si la IA falla, se usa la reserva validada', async () => {
  const e = await prepararEntorno();
  const proveedor = crearProveedorSimulado({ banco: [], fallar: true });
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: e.verificador, proveedor, ahora: e.reloj.ahora });
  assert.equal(r.resultado, 'publicado');
  assert.equal(r.origen, 'reserva');
});

test('si las fuentes no se pueden leer, la pregunta de IA no se publica', async () => {
  const e = await prepararEntorno();
  const v = crearVerificador({ dominios: e.config.fuentes.dominios, modo: 'estricta', obtener: async () => new Response('', { status: 503 }) });
  const proveedor = crearProveedorSimulado({ banco: e.reserva.preguntas });
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, verificador: v, proveedor, ahora: e.reloj.ahora });
  assert.equal(r.origen, 'reserva');
});

test('al preparar mañana sin permitir reserva, una falla de IA deja la fecha pendiente', async () => {
  const e = await prepararEntorno();
  const proveedor = crearProveedorSimulado({ banco: [], fallar: true });
  const args = { db: e.db, config: e.config, fecha: '2026-10-06', reserva: e.reserva, verificador: e.verificador, proveedor, ahora: e.reloj.ahora, permitirReserva: false };
  const r = await asegurarDesafio(args);
  assert.equal(r.resultado, 'pendiente');
  assert.equal(await desafioPorFecha(e.db, '2026-10-06'), null);
  // agotados los intentos, ni siquiera se crea otra corrida
  await asegurarDesafio(args);
  await asegurarDesafio(args);
  const corridas = (await e.db.get('SELECT COUNT(*) AS n FROM corridas')).n;
  assert.equal((await asegurarDesafio(args)).resultado, 'pendiente');
  assert.equal((await e.db.get('SELECT COUNT(*) AS n FROM corridas')).n, corridas);
  // con la reserva habilitada, se publica
  assert.equal((await asegurarDesafio({ ...args, permitirReserva: true })).resultado, 'publicado');
});

test('el programador asegura hoy y prepara mañana; cerca de medianoche usa la reserva', async () => {
  const e = await prepararEntorno({ inicio: '2026-10-05T10:00:00-03:00' });
  const proveedor = crearProveedorSimulado({ banco: [], fallar: true });
  const silencioso = { info() {}, warn() {}, error() {} };
  const prog = crearProgramador({ db: e.db, config: e.config, contexto: { proveedor, verificador: e.verificador, reserva: e.reserva }, ahora: e.reloj.ahora, log: silencioso });
  await prog.revisar();
  assert.ok(await desafioPorFecha(e.db, '2026-10-05'), 'hoy debe existir');
  assert.equal(await desafioPorFecha(e.db, '2026-10-06'), null, 'mañana espera a la IA');
  e.reloj.fijar('2026-10-05T23:45:00-03:00');
  await prog.revisar();
  assert.ok(await desafioPorFecha(e.db, '2026-10-06'), 'mañana se completa con la reserva');
  e.reloj.fijar('2026-10-06T00:00:02-03:00');
  await prog.revisar();
  assert.ok(await desafioPorFecha(e.db, '2026-10-07') === null);
  assert.equal(await contar(e.db), 2);
  prog.detener();
});

test('cliente de Anthropic: formato de la solicitud, reintento y lectura de la herramienta', async () => {
  const { crearProveedorAnthropic } = await import('../servidor/generador/ia.js');
  const solicitudes = [];
  let llamadas = 0;
  const obtener = async (url, opciones) => {
    llamadas++;
    solicitudes.push({ url, opciones, cuerpo: JSON.parse(opciones.body) });
    if (llamadas === 1) return new Response(JSON.stringify({ error: { message: 'saturado' } }), { status: 529, headers: { 'retry-after': '0' } });
    return new Response(
      JSON.stringify({
        model: 'claude-opus-5-5',
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'entregar_preguntas', input: { preguntas: [{ enunciado: 'Nombrá algo.', alcance: 'x', fuentes: [], respuestas: [], rechazos: [] }] } }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      { status: 200 },
    );
  };
  const p = crearProveedorAnthropic({ claveApi: 'sk-prueba', urlApi: 'https://api.anthropic.com/v1/messages', modelo: 'claude-opus-5-5', modeloRevisor: 'claude-sonnet-5-5', obtener });
  const r = await p.generarPreguntas({ categoria: 'ciencia', cantidad: 2, recientes: [{ enunciado: 'Nombrá un planeta.' }], fecha: '2026-10-05' });
  assert.equal(r.preguntas.length, 1);
  assert.equal(llamadas, 2, 'reintenta ante 529');
  const { opciones, cuerpo } = solicitudes[1];
  assert.equal(opciones.headers['x-api-key'], 'sk-prueba');
  assert.equal(opciones.headers['anthropic-version'], '2023-06-01');
  assert.equal(cuerpo.model, 'claude-opus-5-5');
  assert.deepEqual(cuerpo.tool_choice, { type: 'tool', name: 'entregar_preguntas' });
  assert.match(cuerpo.messages[0].content, /Nombrá un planeta/);
  assert.match(cuerpo.messages[0].content, /Ciencia/);
});
