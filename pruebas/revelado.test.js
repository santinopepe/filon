import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno, publicarHoy, respuestasDe } from './ayuda.js';
import { crearJuego } from '../servidor/juego.js';
import { publicarDesafio, sincronizarCaches, paginaDeRespuestas, preguntasDeDesafio, CATALOGO_EN_MEMORIA } from '../servidor/banco.js';
import { prepararRevelado } from '../servidor/revelado.js';
import { abrirBD } from '../servidor/db.js';
import { normalizar } from '../servidor/normalizar.js';
import { RAREZAS, ORDEN_RAREZAS } from '../servidor/dominio.js';

const jugador = 'revelado-jugador';
async function preparar(entorno) {
  const e = entorno ?? (await prepararEntorno());
  if (!entorno) await publicarHoy(e);
  return { ...e, juego: crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora }) };
}
async function terminar(e) {
  const p = await e.juego.iniciarPartida(jugador);
  for (let n = 1; n <= 7; n++) {
    await e.juego.iniciarRonda(jugador, p.id, n);
    await e.juego.pasar(jugador, p.id, n);
  }
  return p;
}
const subirVersion = (db) =>
  db.run(`INSERT INTO meta (clave, valor) VALUES ('version_banco', '1') ON CONFLICT(clave) DO UPDATE SET valor = CAST(meta.valor AS INTEGER) + 1`);
const ordenEsperado = (filas) =>
  filas
    .map((r) => ({ canonica: r.canonica, rareza: r.rareza, nombreRareza: RAREZAS[r.rareza].nombre, puntos: r.puntos, id: r.id }))
    .sort((a, b) => b.puntos - a.puntos || a.canonica.localeCompare(b.canonica, 'es') || a.id - b.id)
    .map(({ id, ...r }) => r); // eslint-disable-line no-unused-vars

// Una pregunta SINTÉTICA (solo para pruebas) con n respuestas, ya en el formato que guarda la base.
function preguntaSintetica(categoria, n) {
  return {
    categoria,
    enunciado: `Nombrá una entidad sintética de ${categoria}.`,
    alcance: 'Lista sintética de prueba.',
    huella: `sintetica-${categoria}`,
    origen: 'ia',
    fuentes: [{ url: 'https://es.wikipedia.org/wiki/Prueba', titulo: 'Prueba' }],
    rechazos: [],
    respuestas: Array.from({ length: n }, (_, i) => {
      const rareza = ORDEN_RAREZAS[(i * 7) % 5];
      // Nombres con tildes, ñ y empates de puntaje, en un orden de inserción que no es el del revelado.
      const canonica = `${['Ñu', 'Ála', 'Nu', 'Avión', 'Zeta'][i % 5]} ${String((i * 7919) % n).padStart(5, '0')}`;
      return { canonica, rareza, puntos: RAREZAS[rareza].puntos, explicacion: 'Sintética.', variantes: [], formas: [normalizar(canonica)] };
    }),
  };
}

test('al publicar se prepara el revelado: orden contiguo, forma de búsqueda y conteos por pregunta', async () => {
  const e = await preparar();
  try {
    const filas = await respuestasDe(e.db, '2026-10-05', 1);
    const preguntaId = filas[0].pregunta_id;
    const guardadas = await e.db.all('SELECT canonica, rareza, puntos, orden, normalizada, id FROM respuestas WHERE pregunta_id = ? ORDER BY orden', preguntaId);
    assert.deepEqual(guardadas.map((r) => r.orden), guardadas.map((_, i) => i), 'orden de 0 a n-1, sin huecos');
    assert.deepEqual(guardadas.map((r) => r.canonica), ordenEsperado(guardadas).map((r) => r.canonica));
    assert.ok(guardadas.every((r) => r.normalizada === normalizar(r.canonica)));
    const conteos = JSON.parse((await e.db.get('SELECT conteos FROM preguntas WHERE id = ?', preguntaId)).conteos);
    assert.equal(conteos.total, guardadas.length);
    for (const r of ORDEN_RAREZAS) assert.equal(conteos[r], guardadas.filter((x) => x.rareza === r).length);
    const plan = await e.db.all('EXPLAIN QUERY PLAN SELECT canonica FROM respuestas WHERE pregunta_id = ? AND orden >= ? AND orden < ? ORDER BY orden', preguntaId, 0, 100);
    assert.ok(plan.some((r) => /respuestas_revelado/.test(r.detail)) && plan.every((r) => !/TEMP B-TREE/.test(r.detail)), 'una página es un rango del índice, sin ordenar');
  } finally {
    e.db.close();
  }
});

test('revelado de una pregunta chica: orden español, búsqueda con ñ y tildes, filtro de rareza y autorización', async () => {
  const e = await preparar();
  try {
    const p = await terminar(e);
    await sincronizarCaches(e.db); // como la API en cada solicitud: registra la versión vigente
    const filas = await respuestasDe(e.db, '2026-10-05', 1);
    const nombres = ['Zorro', 'Ñandú', 'Águila', 'Nandu', 'Avión', 'Álvaro'];
    for (const [i, nombre] of nombres.entries()) {
      await e.db.run('UPDATE respuestas SET canonica = ?, puntos = 100, rareza = ? WHERE id = ?', nombre, 'diamante', filas[i].id);
    }
    await prepararRevelado(e.db, filas[0].pregunta_id); // lo que hace editar una pregunta desde el panel
    await subirVersion(e.db);
    await sincronizarCaches(e.db);
    const esperadas = ordenEsperado(await respuestasDe(e.db, '2026-10-05', 1));
    let consultas = [];
    for (const metodo of ['get', 'all']) {
      const original = e.db[metodo].bind(e.db);
      e.db[metodo] = (sql, ...args) => (consultas.push(sql), original(sql, ...args));
    }
    const primera = await e.juego.respuestasValidas(jugador, p.id, 1, { limite: 3 });
    assert.deepEqual(primera.respuestas, esperadas.slice(0, 3));
    assert.equal(primera.total, esperadas.length);
    assert.equal(primera.siguiente, 3);
    assert.equal(primera.anterior, null);
    assert.ok(consultas.length <= 3, `autorización, preguntas del día (caché vencida) y catálogo: ${consultas.length}`);
    consultas = [];
    const segunda = await e.juego.respuestasValidas(jugador, p.id, 1, { desde: 3, limite: 100 });
    assert.deepEqual(segunda.respuestas, esperadas.slice(3));
    assert.equal(segunda.siguiente, null);
    assert.equal(segunda.anterior, 0);
    assert.equal(consultas.length, 1, 'con caché, solo la autorización');
    const buscar = await e.juego.respuestasValidas(jugador, p.id, 1, { buscar: '  AVIÓN! ' });
    assert.deepEqual(buscar.respuestas, esperadas.filter((r) => normalizar(r.canonica).includes('avion')));
    const enie = await e.juego.respuestasValidas(jugador, p.id, 1, { buscar: 'nandu' });
    assert.deepEqual(enie.respuestas.map((r) => r.canonica), ['Nandu'], 'ñ ≠ n');
    const diamantes = await e.juego.respuestasValidas(jugador, p.id, 1, { rareza: 'diamante' });
    assert.deepEqual(diamantes.respuestas, esperadas.filter((r) => r.rareza === 'diamante'));
    assert.equal(diamantes.conteos.diamante, diamantes.coincidencias);
    assert.equal(ORDEN_RAREZAS.reduce((s, r) => s + diamantes.conteos[r], 0), esperadas.length, 'los conteos son del conjunto completo');
    await assert.rejects(e.juego.respuestasValidas('intruso', p.id, 1), { codigo: 'partida_inexistente' });
    await assert.rejects(e.juego.respuestasValidas(jugador, 'inexistente', 1), { codigo: 'partida_inexistente' });
  } finally {
    e.db.close();
  }
});

test('más de 10.000 respuestas (sintéticas): páginas, búsqueda y rareza exactas, sin duplicados ni faltantes, en frío y con caché', async () => {
  const e = await prepararEntorno();
  try {
    const N = 10_500;
    const categorias = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];
    await publicarDesafio(e.db, { fecha: '2026-10-05', preguntas: categorias.map((c, i) => preguntaSintetica(c, i === 0 ? N : 12)), origen: 'ia' });
    const j = await preparar(e);
    const p = await terminar(j);
    const todas = ordenEsperado(await respuestasDe(e.db, '2026-10-05', 1));
    assert.ok(todas.length > CATALOGO_EN_MEMORIA, 'se sirve paginada desde la base');

    // Recorrido completo, página por página: concatenado da exactamente la lista ordenada.
    const vistas = [];
    for (let desde = 0; desde != null; ) {
      const pagina = await j.juego.respuestasValidas(jugador, p.id, 1, { desde });
      assert.ok(pagina.respuestas.length <= 100);
      vistas.push(...pagina.respuestas);
      desde = pagina.siguiente;
    }
    assert.equal(vistas.length, N);
    assert.deepEqual(vistas, todas, 'mismo orden, sin duplicados ni faltantes');

    // Búsqueda y rareza (separadas y combinadas) contra un filtro hecho en memoria.
    for (const [buscar, rareza] of [['00042', null], ['avion', null], ['ñu', null], [null, 'oro'], ['zeta 01', 'plata']]) {
      const esperadas = todas.filter((r) => (!buscar || normalizar(r.canonica).includes(normalizar(buscar))) && (!rareza || r.rareza === rareza));
      const obtenidas = [];
      let pagina;
      for (let desde = 0; desde != null; desde = pagina.siguiente) {
        pagina = await j.juego.respuestasValidas(jugador, p.id, 1, { desde, buscar: buscar ?? '', rareza });
        obtenidas.push(...pagina.respuestas);
      }
      assert.deepEqual(obtenidas, esperadas, `buscar=${buscar} rareza=${rareza}`);
      assert.equal(pagina.coincidencias, esperadas.length);
      const conBusqueda = todas.filter((r) => !buscar || normalizar(r.canonica).includes(normalizar(buscar)));
      for (const r of ORDEN_RAREZAS) assert.equal(pagina.conteos[r], conBusqueda.filter((x) => x.rareza === r).length, `conteo ${r}`);
    }
    const fuera = await j.juego.respuestasValidas(jugador, p.id, 1, { desde: N + 50 });
    assert.deepEqual(fuera.respuestas, []);
    assert.equal(fuera.siguiente, null);

    // En frío (otra conexión, cachés vacías) da lo mismo que con caché.
    const otra = await abrirBD(e.config.rutaBD);
    try {
      const fria = crearJuego({ db: otra, config: e.config, ahora: e.reloj.ahora });
      for (const opciones of [{ desde: 5000 }, { buscar: '00042' }, { rareza: 'diamante', desde: 300 }]) {
        assert.deepEqual(await fria.respuestasValidas(jugador, p.id, 1, opciones), await j.juego.respuestasValidas(jugador, p.id, 1, opciones));
      }
    } finally {
      otra.close();
    }
  } finally {
    e.db.close();
  }
});

test('respuestas del final: una solicitud para las siete preguntas, solo con la partida terminada y para su dueño', async () => {
  const e = await prepararEntorno();
  try {
    const categorias = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];
    await publicarDesafio(e.db, { fecha: '2026-10-05', preguntas: categorias.map((c, i) => preguntaSintetica(c, i === 0 ? 1500 : 12 + i)), origen: 'ia' });
    const j = await preparar(e);
    const p = await j.juego.iniciarPartida(jugador);
    await j.juego.iniciarRonda(jugador, p.id, 1);
    await j.juego.pasar(jugador, p.id, 1);
    await assert.rejects(j.juego.respuestasDelFinal(jugador, p.id), { codigo: 'partida_en_curso' });
    for (let n = 2; n <= 7; n++) {
      await j.juego.iniciarRonda(jugador, p.id, n);
      await j.juego.pasar(jugador, p.id, n);
    }
    await assert.rejects(j.juego.respuestasDelFinal('intruso', p.id), { codigo: 'partida_inexistente' });
    let consultas = 0;
    for (const metodo of ['get', 'all']) {
      const original = e.db[metodo].bind(e.db);
      e.db[metodo] = (...args) => (consultas++, original(...args));
    }
    const final = await j.juego.respuestasDelFinal(jugador, p.id);
    assert.ok(consultas <= 2, `autorización y una consulta para las siete preguntas: ${consultas}`);
    assert.equal(final.preguntas.length, 7);
    for (const q of final.preguntas) {
      const pagina = await j.juego.respuestasValidas(jugador, p.id, q.posicion, { limite: 100 });
      assert.equal(q.total, pagina.total);
      assert.deepEqual(q.conteos, pagina.conteos);
      assert.deepEqual(q.respuestas, pagina.respuestas.map((r) => [r.canonica, r.rareza]));
    }
    assert.equal(final.preguntas[0].total, 1500);
    assert.equal(final.preguntas[0].respuestas.length, 100);
    assert.equal(final.rarezas.diamante.puntos, 100);
    consultas = 0;
    await j.juego.respuestasDelFinal(jugador, p.id);
    assert.equal(consultas, 1, 'con caché, solo la autorización');
  } finally {
    e.db.close();
  }
});

test('el catálogo se invalida cuando cambia la versión del banco', async () => {
  const e = await preparar();
  try {
    const p = await terminar(e);
    const filas = await respuestasDe(e.db, '2026-10-05', 1);
    await sincronizarCaches(e.db);
    const anterior = await e.juego.respuestasValidas(jugador, p.id, 1);
    await e.db.run('UPDATE respuestas SET canonica = ? WHERE id = ?', 'Árbol nuevo', filas[0].id);
    await prepararRevelado(e.db, filas[0].pregunta_id);
    await subirVersion(e.db);
    await sincronizarCaches(e.db);
    const siguiente = await e.juego.respuestasValidas(jugador, p.id, 1);
    assert.ok(siguiente.respuestas.some((r) => r.canonica === 'Árbol nuevo'));
    assert.ok(!siguiente.respuestas.some((r) => r.canonica === filas[0].canonica));
    assert.ok(anterior.respuestas.some((r) => r.canonica === filas[0].canonica));
    assert.deepEqual((await e.juego.respuestasValidas(jugador, p.id, 1, { buscar: 'arbol' })).respuestas.map((r) => r.canonica), ['Árbol nuevo']);
  } finally {
    e.db.close();
  }
});

test('lo publicado sin preparar (instancia anterior o base vieja) se prepara al leerlo, y la migración lo completa', async () => {
  const e = await preparar();
  try {
    const p = await terminar(e);
    await sincronizarCaches(e.db);
    await e.db.run('UPDATE respuestas SET orden = NULL, normalizada = NULL');
    await e.db.run('UPDATE preguntas SET conteos = NULL');
    await subirVersion(e.db);
    await sincronizarCaches(e.db);
    const pagina = await e.juego.respuestasValidas(jugador, p.id, 2);
    assert.equal(pagina.respuestas.length, pagina.total);
    assert.ok(pagina.total > 0);
    assert.equal((await e.db.get('SELECT COUNT(*) AS n FROM preguntas WHERE conteos IS NULL')).n, 6, 'se preparó la que se leyó');

    // La migración 9 completa el resto al reabrir (como en un despliegue).
    await e.db.run('DELETE FROM migraciones WHERE version = 9');
    const reabierta = await abrirBD(e.config.rutaBD);
    try {
      assert.equal((await reabierta.get('SELECT COUNT(*) AS n FROM preguntas WHERE conteos IS NULL')).n, 0);
      assert.equal((await reabierta.get('SELECT COUNT(*) AS n FROM respuestas WHERE orden IS NULL OR normalizada IS NULL')).n, 0);
      const preguntas = await preguntasDeDesafio(reabierta, (await reabierta.get('SELECT id FROM desafios')).id);
      const enMemoria = await paginaDeRespuestas(reabierta, preguntas[0]);
      assert.equal(enMemoria.respuestas.length, enMemoria.total);
    } finally {
      reabierta.close();
    }
  } finally {
    e.db.close();
  }
});

test('revelado en curso: conserva vencimientos y rechaza rondas activas, pendientes y caducadas', async () => {
  const e = await preparar();
  try {
    const p = await e.juego.iniciarPartida(jugador);
    await assert.rejects(e.juego.respuestasValidas(jugador, p.id, 1), { codigo: 'ronda_no_iniciada' });
    await e.juego.iniciarRonda(jugador, p.id, 1);
    await assert.rejects(e.juego.respuestasValidas(jugador, p.id, 1), { codigo: 'ronda_activa' });
    e.reloj.avanzar(e.config.segundosPorPregunta * 1000 + e.config.graciaRedMs + 1);
    const vencida = await e.juego.respuestasValidas(jugador, p.id, 1);
    assert.ok(vencida.respuestas.length > 0, 'mantener cierra la ronda vencida antes de revelar');
    e.reloj.avanzar(3 * 86_400_000);
    await assert.rejects(e.juego.respuestasValidas(jugador, p.id, 2), { codigo: 'ronda_caducada' });
    await assert.rejects(e.juego.respuestasValidas(jugador, p.id, 2), { codigo: 'ronda_caducada' });
  } finally {
    e.db.close();
  }
});
