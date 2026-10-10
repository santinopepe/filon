import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarConfig } from '../servidor/config.js';
import { evaluarAccesibilidad, esFamiliar } from '../servidor/catalogos/familiaridad.js';
import { prepararCandidatos, asignarRarezas, generarLote } from '../servidor/catalogos/generador.js';
import { cargarCatalogos } from '../servidor/catalogos/catalogos.js';
import { cargarPlantillas } from '../servidor/catalogos/plantillas.js';

const conocidas = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, nombre: `Respuesta ${i}`, popularidad: i, familiaridadEditorial: i < 4 ? 2 : 0, atributos: {} }));
const catalogo = { id: 'sintetico', universo: 'sintetico', version: '1', entidades: conocidas, atributos: {}, cobertura: { tipo: 'completa' }, completos: new Set(), percentil: () => 1 };
const plantilla = { id: 'sintetica', familia: 'sintetica', categoria: 'ciencia', enunciado: 'Nombrá algo', filtro: { y: [] }, todos: true, parametros: {}, respuestas: { min: 5, max: 20 }, dificultad: 0.1, prioridad: 3, alcance: 'SINTÉTICO: prueba, no contenido del juego.', explicacion: '{nombre}.' };

test('la dificultad usa familiaridad y condiciones; un percentil alto en un nicho no la vuelve fácil', () => {
  const c = prepararCandidatos(plantilla, catalogo).candidatos[0];
  assert.equal(c.dificultad.nivel, 'facil');
  assert.equal(c.dificultad.familiares, 4);
  assert.equal(c.entidades.length, 8, 'conserva las desconocidas correctas');
  const nicho = { ...catalogo, id: 'nicho', version: '2', entidades: conocidas.map(e => ({ ...e, familiaridadEditorial: 0 })) };
  assert.equal(prepararCandidatos(plantilla, nicho).candidatos[0].dificultad.nivel, 'dificil');
  for (const filtro of [
    { y: [{ campo: 'nombre', op: 'tiene', letras: ['a', 'b'] }] },
    { y: [{ campo: 'anio', op: 'entre', desde: 1990, hasta: 1999 }] },
    { y: [{ campo: 'logros', op: 'es', valores: ['Campeón 1978'] }] },
    { y: [{ campo: 'tecnica', op: 'es', valores: ['acuarela'] }] },
  ]) assert.equal(evaluarAccesibilidad(plantilla, catalogo, conocidas, filtro).facil, false);
  assert.equal(evaluarAccesibilidad(plantilla, catalogo, conocidas, { y: [] }, 5).facil, false);
  assert.equal(new Set(asignarRarezas(c.entidades).values()).size, 5, 'una pregunta fácil conserva oro y diamante');
  assert.equal(evaluarAccesibilidad(plantilla, { ...catalogo, universo: 'albumes' }, conocidas, { y: [] }).facil, false, 'reconocer al artista no implica recordar sus discos');
});

test('datos reales: el perfil selecciona cinco fáciles y dos intermedias, conserva variedad, filtros y todo el conjunto', () => {
  const config = cargarConfig({ sinArchivoEnv: true, env: {} });
  const { catalogos, problemas } = cargarCatalogos(config.catalogos.dir);
  const p = cargarPlantillas(config.catalogos.rutaPlantillas);
  assert.deepEqual([...problemas, ...p.problemas], []);
  for (const modo of ['normal','geografia']) {
    const opciones = { catalogos, plantillas: { version: p.version, lista: p.plantillas }, fecha: '2026-11-01', modo, dominios: config.fuentes.dominios, opciones: config.catalogos };
    const r = generarLote(opciones);
    assert.equal(r.ok, true, r.errores.join(' '));
    assert.deepEqual(r.elegidas.map(x => x.dificultad.nivel), config.catalogos.planDificultad);
    assert.deepEqual(generarLote(opciones).preguntas, r.preguntas, 'reproducible');
    assert.equal(new Set(r.elegidas.map(x => x.familia)).size, 7);
    if (modo === 'normal') {
      assert.ok(new Set(r.elegidas.map(x => x.categoria)).size >= 4);
      assert.equal(new Set(r.preguntas.map(x => x.generacion.universo ?? x.generacion.catalogo.id)).size, 7);
    }
    for (const q of r.preguntas) {
      const cat = catalogos.get(q.generacion.catalogo.id);
      const pl = p.plantillas.find(x => x.id === q.generacion.plantilla);
      const candidato = prepararCandidatos(pl, cat, { dominios: config.fuentes.dominios }).candidatos.find(x => x.firma === q.firma);
      assert.equal(q.respuestas.length, candidato.entidades.length, 'no recorta a las familiares');
      assert.equal(new Set(q.respuestas.map(x => x.rareza)).size, 5);
      if (q.generacion.dificultad.nivel === 'facil') {
        assert.equal(q.generacion.dificultad.simple, true);
        assert.ok(q.generacion.dificultad.familiares >= 3);
      }
    }
  }
});

test('la familiaridad por alias respeta la condición y no reutiliza rasgos del nombre científico', () => {
  const e = { nombre: 'Ursus maritimus', alias: ['oso polar'], atributos: {}, _rasgos: { nombre: { forma: 'ursus maritimus' } } };
  assert.equal(esFamiliar({ id: 'animales' }, e, { y: [{ campo: 'nombre', op: 'empieza', textos: ['o'] }] }), true);
  assert.equal(esFamiliar({ id: 'animales' }, e, { y: [{ campo: 'nombre', op: 'empieza', textos: ['u'] }] }), false);
});

test('perfil de prueba: cinco fáciles, dos intermedias y las primeras dos fáciles; configuración validada', () => {
  const c = cargarConfig({ sinArchivoEnv: true, env: { CATALOGOS_PERFIL: 'casual', CATALOGOS_FACILES: '5', CATALOGOS_MIN_FAMILIARES: '3' } });
  assert.deepEqual(c.catalogos.planDificultad, ['facil','facil','media','facil','facil','media','facil']);
  assert.throws(() => cargarConfig({ sinArchivoEnv: true, env: { CATALOGOS_FACILES: '1' } }));
  assert.throws(() => cargarConfig({ sinArchivoEnv: true, env: { CATALOGOS_MIN_FAMILIARES: '2' } }));
  assert.equal(cargarConfig({ sinArchivoEnv: true, env: { CATALOGOS_PERFIL: 'clasico' } }).catalogos.planDificultad, null);
});
