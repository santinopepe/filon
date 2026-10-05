import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarPregunta, validarLote, esSubjetiva } from '../servidor/validacion.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { cargarConfig } from '../servidor/config.js';
import { CLAVES_CATEGORIAS } from '../servidor/dominio.js';

const config = cargarConfig({ sinArchivoEnv: true });
const dominios = config.fuentes.dominios;

function base(extra = {}) {
  return {
    categoria: 'ciencia',
    enunciado: 'Nombrá un planeta del sistema solar.',
    alcance: 'Los 8 planetas reconocidos por la UAI.',
    fuentes: [{ url: 'https://es.wikipedia.org/wiki/Sistema_solar', titulo: 'Sistema solar' }],
    respuestas: [
      { canonica: 'Marte', variantes: [], rareza: 'grava', explicacion: 'El planeta rojo.' },
      { canonica: 'Júpiter', variantes: [], rareza: 'cobre', explicacion: 'El más grande del sistema.' },
      { canonica: 'Saturno', variantes: [], rareza: 'cobre', explicacion: 'Famoso por sus anillos.' },
      { canonica: 'Mercurio', variantes: [], rareza: 'plata', explicacion: 'El más cercano al Sol.' },
      { canonica: 'Neptuno', variantes: [], rareza: 'plata', explicacion: 'El más lejano del Sol.' },
      { canonica: 'Tierra', variantes: ['Planeta Tierra'], rareza: 'diamante', explicacion: 'Nuestro planeta.' },
    ],
    rechazos: [{ textos: ['Plutón'], motivo: 'Es un planeta enano.' }],
    ...extra,
  };
}

test('una pregunta bien formada pasa y asigna puntos por rareza', () => {
  const r = validarPregunta(base(), { dominios });
  assert.ok(r.ok, r.errores.join(' '));
  const tierra = r.pregunta.respuestas.find((x) => x.canonica === 'Tierra');
  assert.equal(tierra.puntos, 100);
  assert.deepEqual(tierra.formas.sort(), ['planeta tierra', 'tierra']);
});

test('sin una respuesta Diamante la pregunta no pasa (el máximo sería inalcanzable)', () => {
  const p = base();
  p.respuestas.find((x) => x.canonica === 'Tierra').rareza = 'oro';
  const r = validarPregunta(p, { dominios });
  assert.ok(!r.ok);
  assert.ok(r.errores.some((e) => /Diamante/.test(e)), r.errores.join(' '));
});

test('detecta enunciados subjetivos', () => {
  assert.ok(esSubjetiva('Nombrá el mejor jugador de la historia'));
  assert.ok(esSubjetiva('Nombrá tu película favorita'));
  assert.ok(esSubjetiva('Nombrá la banda más famosa de los 80'));
  assert.ok(!esSubjetiva('Nombrá a alguien que haya ganado el Óscar a mejor dirección'));
  const r = validarPregunta(base({ enunciado: 'Nombrá tu planeta favorito del sistema solar.' }), { dominios });
  assert.ok(!r.ok);
});

test('descarta duplicados y marca contradicciones de rareza', () => {
  const p = base();
  p.respuestas.push({ canonica: 'MARTE', variantes: [], rareza: 'grava', explicacion: 'Repetida en otra forma.' });
  p.respuestas.push({ canonica: 'neptuno', variantes: [], rareza: 'diamante', explicacion: 'Repetida con otra rareza.' });
  const r = validarPregunta(p, { dominios });
  assert.equal(r.pregunta.respuestas.filter((x) => x.canonica.toLowerCase() === 'marte').length, 1);
  assert.ok(r.descartadas.some((d) => /duplicada/.test(d.motivo)));
  assert.ok(r.descartadas.some((d) => /contradicción/.test(d.motivo)));
  assert.equal(r.contradicciones, 1);
  assert.ok(!validarPregunta(p, { dominios, estricta: true }).ok);
});

test('una variante que apunta a dos respuestas se elimina como contradicción', () => {
  const p = base();
  p.respuestas[0].variantes = ['Rojo'];
  p.respuestas[1].variantes = ['Rojo'];
  const r = validarPregunta(p, { dominios });
  assert.ok(r.advertencias.some((a) => /rojo/.test(a)));
  assert.ok(r.pregunta.respuestas.every((x) => !x.formas.includes('rojo')));
  assert.equal(r.contradicciones, 1);
});

test('un rechazo que coincide con una respuesta válida se descarta', () => {
  const p = base({ rechazos: [{ textos: ['Marte'], motivo: 'Error del generador.' }] });
  const r = validarPregunta(p, { dominios });
  assert.equal(r.pregunta.rechazos.length, 0);
  assert.equal(r.contradicciones, 1);
});

test('exige variedad de rarezas, mínimo de respuestas y fuentes permitidas', () => {
  const todasGrava = base();
  todasGrava.respuestas.forEach((x) => (x.rareza = 'grava'));
  assert.ok(!validarPregunta(todasGrava, { dominios }).ok);

  const pocas = base();
  pocas.respuestas = pocas.respuestas.slice(0, 3);
  assert.ok(!validarPregunta(pocas, { dominios }).ok);

  const sinFuente = base({ fuentes: [{ url: 'http://blog-cualquiera.example/lista', titulo: 'Blog' }] });
  assert.ok(!validarPregunta(sinFuente, { dominios }).ok);

  const rarezaMala = base();
  rarezaMala.respuestas[0].rareza = 'platino';
  const r = validarPregunta(rarezaMala, { dominios });
  assert.ok(r.descartadas.some((d) => /rareza inválida/.test(d.motivo)));
});

test('rechaza preguntas que repiten enunciado o conjunto de respuestas recientes', () => {
  const recientes = [{ fecha: '2026-10-01', enunciado: 'Nombrá un planeta del Sistema Solar', huella: 'planeta sistema solar', claves: [] }];
  assert.ok(!validarPregunta(base(), { dominios, recientes }).ok);
  const mismoConjunto = [{ fecha: '2026-10-02', enunciado: 'Otra redacción', huella: 'otra', claves: ['marte', 'jupiter', 'saturno', 'mercurio', 'neptuno', 'tierra'] }];
  assert.ok(!validarPregunta(base({ enunciado: 'Nombrá un mundo que gire alrededor del Sol.' }), { dominios, recientes: mismoConjunto }).ok);
});

test('el banco de reserva completo pasa la validación estricta', () => {
  const reserva = cargarReserva(config.rutaReserva, { dominios });
  assert.deepEqual(reserva.invalidas, []);
  assert.ok(reserva.preguntas.length >= 21);
  for (const c of CLAVES_CATEGORIAS) {
    assert.ok(reserva.preguntas.filter((p) => p.categoria === c).length >= 3, `faltan preguntas de ${c}`);
  }
});

test('el lote diario necesita 7 preguntas de categorías distintas', () => {
  const reserva = cargarReserva(config.rutaReserva, { dominios });
  const unaPorCategoria = CLAVES_CATEGORIAS.map((c) => reserva.preguntas.find((p) => p.categoria === c));
  assert.ok(validarLote(unaPorCategoria).ok);
  assert.ok(!validarLote(unaPorCategoria.slice(0, 6)).ok);
  const repetida = [...unaPorCategoria.slice(0, 6), reserva.preguntas.filter((p) => p.categoria === 'geografia')[1]];
  assert.ok(!validarLote(repetida).ok);
});
