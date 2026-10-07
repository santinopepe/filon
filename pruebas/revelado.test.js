import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno, publicarHoy, respuestasDe } from './ayuda.js';
import { crearJuego } from '../servidor/juego.js';
import { catalogoParaRevelar, sincronizarCaches } from '../servidor/banco.js';
import { normalizar } from '../servidor/normalizar.js';
import { RAREZAS } from '../servidor/dominio.js';

const jugador = 'revelado-jugador';
async function preparar() {
  const e = await prepararEntorno();
  await publicarHoy(e);
  return { ...e, juego: crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora }) };
}

test('revelado final: dos consultas en frío, una en caché; conserva orden, datos y autorización', async () => {
  const e = await preparar();
  try {
    const p = await e.juego.iniciarPartida(jugador);
    for (let n = 1; n <= 7; n++) {
      await e.juego.iniciarRonda(jugador, p.id, n);
      await e.juego.pasar(jugador, p.id, n);
    }
    const filas = await respuestasDe(e.db, '2026-10-05', 1);
    const nombres = ['Zorro', 'Ñandú', 'Águila', 'Nandu', 'Avión', 'Álvaro'];
    for (const [i, nombre] of nombres.entries()) {
      await e.db.run('UPDATE respuestas SET canonica = ?, puntos = 100, rareza = ? WHERE id = ?', nombre, 'diamante', filas[i].id);
    }
    const esperadas = (await respuestasDe(e.db, '2026-10-05', 1))
      .map((r) => ({ canonica: r.canonica, rareza: r.rareza, nombreRareza: RAREZAS[r.rareza].nombre, puntos: r.puntos }))
      .sort((a, b) => b.puntos - a.puntos || a.canonica.localeCompare(b.canonica, 'es'));
    let consultas = [];
    for (const metodo of ['get', 'all']) {
      const original = e.db[metodo].bind(e.db);
      e.db[metodo] = (sql, ...args) => {
        consultas.push(sql);
        return original(sql, ...args);
      };
    }
    const primera = await e.juego.respuestasValidas(jugador, p.id, 1, { limite: 3 });
    assert.deepEqual(primera.respuestas, esperadas.slice(0, 3));
    assert.equal(primera.total, esperadas.length);
    assert.equal(primera.siguiente, 3);
    assert.equal(consultas.length, 2, 'una consulta de autorización/ronda y una del catálogo');
    assert.match(consultas[0], /LEFT JOIN rondas/);
    assert.match(consultas[1], /SELECT canonica, rareza, puntos/);
    consultas = [];
    const segunda = await e.juego.respuestasValidas(jugador, p.id, 1, { desde: 3, limite: 100 });
    assert.deepEqual(segunda.respuestas, esperadas.slice(3));
    assert.equal(segunda.siguiente, null);
    assert.equal(consultas.length, 1, 'el catálogo ya está ordenado en caché');
    const buscar = await e.juego.respuestasValidas(jugador, p.id, 1, { buscar: '  AVIÓN! ' });
    assert.deepEqual(buscar.respuestas, esperadas.filter((r) => normalizar(r.canonica).includes('avion')));
    const enie = await e.juego.respuestasValidas(jugador, p.id, 1, { buscar: 'nandu' });
    assert.deepEqual(enie.respuestas.map((r) => r.canonica), ['Nandu']);
    await assert.rejects(e.juego.respuestasValidas('intruso', p.id, 1), { codigo: 'partida_inexistente' });
    await assert.rejects(e.juego.respuestasValidas(jugador, 'inexistente', 1), { codigo: 'partida_inexistente' });
    consultas = [];
    const catalogo = await catalogoParaRevelar(e.db, filas[0].pregunta_id);
    const plan = await e.db.all(`EXPLAIN QUERY PLAN SELECT canonica, rareza, puntos FROM respuestas WHERE pregunta_id = ? ORDER BY id`, filas[0].pregunta_id);
    assert.ok(plan.some((r) => /USING INDEX respuestas_pregunta/.test(r.detail)));
    assert.ok(plan.every((r) => !/TEMP B-TREE/.test(r.detail)), 'no hay un ordenamiento SQL adicional');
    assert.deepEqual(catalogo.respuestas, esperadas);
  } finally {
    e.db.close();
  }
});

test('el catálogo liviano se invalida cuando cambia la versión del banco', async () => {
  const e = await preparar();
  try {
    const filas = await respuestasDe(e.db, '2026-10-05', 1);
    const pregunta = filas[0].pregunta_id;
    await sincronizarCaches(e.db);
    const anterior = await catalogoParaRevelar(e.db, pregunta);
    await e.db.run('UPDATE respuestas SET canonica = ? WHERE id = ?', 'Árbol nuevo', filas[0].id);
    await e.db.run(`INSERT INTO meta (clave, valor) VALUES ('version_banco', '1')
                   ON CONFLICT(clave) DO UPDATE SET valor = CAST(meta.valor AS INTEGER) + 1`);
    await sincronizarCaches(e.db);
    const siguiente = await catalogoParaRevelar(e.db, pregunta);
    assert.notEqual(siguiente, anterior);
    assert.ok(siguiente.respuestas.some((r) => r.canonica === 'Árbol nuevo'));
    assert.ok(siguiente.normalizadas.includes('arbol nuevo'));
    assert.ok(!siguiente.respuestas.some((r) => r.canonica === filas[0].canonica));
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
