import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno, publicarHoy, respuestasDe } from './ayuda.js';
import { crearJuego, ErrorJuego } from '../servidor/juego.js';
import { conciliarPuntajes } from '../servidor/banco.js';

async function armar(opciones) {
  const e = await prepararEntorno(opciones);
  const juego = crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora });
  return { ...e, juego };
}

test('flujo completo: 7 rondas, puntos por rareza y profundidad', async () => {
  const e = await armar();
  await publicarHoy(e);
  const yo = '11111111-1111-4111-8111-111111111111';
  let p = await e.juego.iniciarPartida(yo);
  assert.equal(p.siguiente, 1);
  let esperado = 0;
  for (let n = 1; n <= 7; n++) {
    p = await e.juego.iniciarRonda(yo, p.id, n);
    assert.equal(p.rondaActiva, n);
    const activa = p.rondas[n - 1];
    assert.ok(activa.enunciado);
    assert.equal(activa.respuesta, undefined, 'no se revela la respuesta durante la ronda');
    assert.equal(activa.respuestasValidas, undefined, 'no se revela el banco durante la ronda');
    const respuestas = await respuestasDe(e.db, '2026-10-05', n);
    const elegida = respuestas[respuestas.length - 1]; // la más rara
    e.reloj.avanzar(3000);
    const r = await e.juego.responder(yo, p.id, n, `  ${elegida.canonica.toUpperCase()}  `);
    assert.equal(r.resultado, 'aceptada');
    esperado += elegida.puntos;
    p = r.partida;
    assert.equal(p.rondas[n - 1].respuesta.canonica, elegida.canonica);
    assert.ok(p.rondas[n - 1].respuesta.explicacion.length > 5);
  }
  assert.ok(p.terminada);
  assert.equal(p.puntos, esperado);
  assert.equal(p.profundidad, esperado * 10);
  assert.ok(p.profundidad <= 7000);
  assert.equal(p.estadisticas.total, 1);
  assert.equal(p.estadisticas.puesto, 1);
  assert.equal(p.estadisticas.percentil, null);
  assert.ok(p.rondas.every((r) => r.totalRespuestas >= 5));
  const { respuestas: respuestasValidas } = await e.juego.respuestasValidas(yo, p.id, 1);
  assert.ok(
    respuestasValidas.every((respuesta, i, todas) => i === 0 || todas[i - 1].puntos >= respuesta.puntos),
    'las respuestas válidas se entregan ordenadas de mayor a menor puntaje',
  );
});

test('el resultado final calcula ranking y distribución entre partidas terminadas', async () => {
  const e = await armar();
  await publicarHoy(e);
  const yo = '10101010-1010-4010-8010-101010101010';
  let p = await e.juego.iniciarPartida(yo);
  for (let n = 1; n <= 7; n++) {
    p = await e.juego.iniciarRonda(yo, p.id, n);
    p = await e.juego.pasar(yo, p.id, n);
  }
  assert.ok(p.terminada);
  const desafioId = (await e.db.get('SELECT desafio_id AS id FROM partidas WHERE id = ?', p.id)).id;
  for (const [i, puntos] of [100, 300, 0, 200, 400].entries()) {
    const jugador = `ranking-jugador-${i}`;
    await e.db.run('INSERT INTO jugadores (id, creado_en) VALUES (?, ?)', jugador, e.reloj.ahora());
    await e.db.run(
      'INSERT INTO partidas (id, jugador_id, desafio_id, iniciada_en, terminada_en, puntos) VALUES (?, ?, ?, ?, ?, ?)',
      `ranking-partida-${i}`, jugador, desafioId, e.reloj.ahora(), e.reloj.ahora(), puntos,
    );
  }
  // Las partidas se insertaron a mano (sin pasar por el juego): se concilia el histograma agregado,
  // como hace la limpieza diaria.
  await conciliarPuntajes(e.db, desafioId);

  p = await e.juego.verPartida(yo, p.id);
  assert.equal(p.estadisticas.total, 6);
  assert.equal(p.estadisticas.puesto, 5);
  assert.equal(p.estadisticas.empatados, 2);
  assert.equal(p.estadisticas.percentil, 10);
  assert.equal(p.estadisticas.distribucion.reduce((suma, tramo) => suma + tramo.cantidad, 0), 6);
  assert.equal(p.estadisticas.distribucion[0].cantidad, 2);
  assert.equal(p.estadisticas.suficientesDatos, true);
});

test('una respuesta rechazada permite reintentar; la primera aceptada cierra la ronda', async () => {
  const e = await armar();
  await publicarHoy(e);
  const yo = '22222222-2222-4222-8222-222222222222';
  let p = await e.juego.iniciarPartida(yo);
  p = await e.juego.iniciarRonda(yo, p.id, 1);
  const [comun, , rara] = await respuestasDe(e.db, '2026-10-05', 1);
  const mal = await e.juego.responder(yo, p.id, 1, 'zzzz respuesta inexistente');
  assert.equal(mal.resultado, 'rechazada');
  assert.equal((await e.juego.responder(yo, p.id, 1, 'ZZZZ respuesta inexistente')).repetida, true);
  assert.equal((await e.juego.responder(yo, p.id, 1, '')).resultado, 'vacia');
  const bien = await e.juego.responder(yo, p.id, 1, comun.canonica);
  assert.equal(bien.resultado, 'aceptada');
  const otra = await e.juego.responder(yo, p.id, 1, rara.canonica);
  assert.equal(otra.resultado, 'cerrada');
  assert.equal(otra.partida.puntos, comun.puntos);
});

test('las variantes se reescriben y, al confirmarlas, reciben los mismos puntos que la respuesta canónica', async () => {
  const e = await armar();
  await publicarHoy(e);
  const fila = await e.db.get(`SELECT p.posicion, r.canonica, r.variantes, r.puntos FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id WHERE r.variantes <> '[]' LIMIT 1`);
  const variante = JSON.parse(fila.variantes).at(-1);
  const puntos = [];
  for (const [i, texto] of [fila.canonica, variante].entries()) {
    const yo = `3333333${i}-3333-4333-8333-333333333333`;
    let p = await e.juego.iniciarPartida(yo);
    for (let n = 1; n < fila.posicion; n++) {
      p = await e.juego.iniciarRonda(yo, p.id, n);
      p = await e.juego.pasar(yo, p.id, n);
    }
    p = await e.juego.iniciarRonda(yo, p.id, fila.posicion);
    let r = await e.juego.responder(yo, p.id, fila.posicion, texto);
    if (i === 1) {
      assert.equal(r.resultado, 'sugerida');
      assert.equal(r.sugerencia, fila.canonica);
      assert.equal(r.partida.rondaActiva, fila.posicion, 'la sugerencia no cierra la ronda');
      r = await e.juego.responder(yo, p.id, fila.posicion, r.sugerencia);
    }
    assert.equal(r.resultado, 'aceptada', `«${texto}» debería aceptarse al confirmar`);
    puntos.push(r.partida.rondas[fila.posicion - 1].puntos);
  }
  assert.equal(puntos[0], fila.puntos);
  assert.equal(puntos[1], fila.puntos);
});

test('un error de tipeo inequívoco se completa y requiere un segundo envío', async () => {
  const e = await armar();
  await publicarHoy(e);
  const yo = '34343434-3434-4434-8434-343434343434';
  let p = await e.juego.iniciarPartida(yo);
  p = await e.juego.iniciarRonda(yo, p.id, 1);
  const respuesta = (await respuestasDe(e.db, '2026-10-05', 1)).find((r) => r.canonica.length >= 7);
  const tipeada = `${respuesta.canonica.slice(0, -1)}x`;
  let r = await e.juego.responder(yo, p.id, 1, tipeada);
  assert.equal(r.resultado, 'sugerida');
  assert.equal(r.sugerencia, respuesta.canonica);
  assert.equal(r.partida.rondas[0].estado, 'activa');
  assert.deepEqual(r.partida.rondas[0].intentos, [], 'completar no consume un intento');
  r = await e.juego.responder(yo, p.id, 1, r.sugerencia);
  assert.equal(r.resultado, 'aceptada');
  assert.equal(r.partida.rondas[0].respuesta.canonica, respuesta.canonica);
});

test('el tiempo vence en el servidor: 25 s más un margen de red', async () => {
  const e = await armar();
  await publicarHoy(e);
  const yo = '44444444-4444-4444-8444-444444444444';
  let p = await e.juego.iniciarPartida(yo);
  p = await e.juego.iniciarRonda(yo, p.id, 1);
  const r1 = (await respuestasDe(e.db, '2026-10-05', 1))[0];
  // dentro del margen de red (llegó tarde por latencia): se acepta
  e.reloj.avanzar(25_000 + 1000);
  assert.equal((await e.juego.responder(yo, p.id, 1, r1.canonica)).resultado, 'aceptada');

  p = await e.juego.iniciarRonda(yo, p.id, 2);
  const r2 = (await respuestasDe(e.db, '2026-10-05', 2))[0];
  e.reloj.avanzar(25_000 + e.config.graciaRedMs + 1);
  const tarde = await e.juego.responder(yo, p.id, 2, r2.canonica);
  assert.equal(tarde.resultado, 'vencida');
  assert.equal(tarde.partida.rondas[1].puntos, 0);
  assert.equal(tarde.partida.rondas[1].estado, 'vencida');
  assert.equal(tarde.partida.rondas[1].joya, undefined, 'no revela la mejor respuesta de la ronda');
});

test('recargar no reinicia el reloj ni permite repetir rondas', async () => {
  const e = await armar();
  await publicarHoy(e);
  const yo = '55555555-5555-4555-8555-555555555555';
  let p = await e.juego.iniciarPartida(yo);
  p = await e.juego.iniciarRonda(yo, p.id, 1);
  const limite = p.rondas[0].limiteEn;
  e.reloj.avanzar(10_000);
  // «recarga»: se vuelve a pedir el estado y se intenta reiniciar la ronda
  const estado = await e.juego.estado(yo);
  assert.equal(estado.partidaHoy.rondaActiva, 1);
  assert.equal(estado.partidaHoy.rondas[0].limiteEn, limite);
  const otraVez = await e.juego.iniciarRonda(yo, p.id, 1);
  assert.equal(otraVez.rondas[0].limiteEn, limite);
  // una nueva partida del mismo jugador es la misma partida
  assert.equal((await e.juego.iniciarPartida(yo)).id, p.id);
  // no se puede saltar ni volver atrás
  await assert.rejects(() => e.juego.iniciarRonda(yo, p.id, 2), (err) => err instanceof ErrorJuego && err.codigo === 'ronda_activa');
  await e.juego.pasar(yo, p.id, 1);
  await assert.rejects(() => e.juego.iniciarRonda(yo, p.id, 3), (err) => err.codigo === 'orden_invalido');
  const repetir = await e.juego.responder(yo, p.id, 1, (await respuestasDe(e.db, '2026-10-05', 1))[0].canonica);
  assert.equal(repetir.resultado, 'cerrada');
  assert.equal(repetir.partida.puntos, 0);
});

test('una partida que cruza la medianoche termina con su desafío original', async () => {
  const e = await armar({ inicio: '2026-10-05T23:58:00-03:00' });
  await publicarHoy(e);
  await publicarHoy(e, '2026-10-06');
  const yo = '66666666-6666-4666-8666-666666666666';
  let p = await e.juego.iniciarPartida(yo);
  assert.equal(p.fecha, '2026-10-05');
  p = await e.juego.iniciarRonda(yo, p.id, 1);
  const enunciadoOriginal = p.rondas[0].enunciado;
  e.reloj.fijar('2026-10-06T00:00:05-03:00');
  const r = await e.juego.responder(yo, p.id, 1, (await respuestasDe(e.db, '2026-10-05', 1))[0].canonica);
  assert.equal(r.resultado, 'vencida', 'la ronda de 23:58 ya venció');
  p = await e.juego.iniciarRonda(yo, p.id, 2);
  assert.equal(p.fecha, '2026-10-05');
  const r2 = await e.juego.responder(yo, p.id, 2, (await respuestasDe(e.db, '2026-10-05', 2))[0].canonica);
  assert.equal(r2.resultado, 'aceptada', 'se valida contra el banco del desafío original');
  assert.equal(r2.partida.rondas[0].enunciado, enunciadoOriginal);
  // en el estado aparece como pendiente y el desafío del día nuevo es otro
  const estado = await e.juego.estado(yo);
  assert.equal(estado.desafio.fecha, '2026-10-06');
  assert.equal(estado.partidaHoy, null);
  assert.equal(estado.partidaPendiente.id, p.id);
  const nueva = await e.juego.iniciarPartida(yo);
  assert.notEqual(nueva.id, p.id);
  assert.equal(nueva.fecha, '2026-10-06');
});

test('una partida abandonada caduca después del margen para retomar', async () => {
  const e = await armar({ inicio: '2026-10-05T20:00:00-03:00' });
  await publicarHoy(e);
  const yo = '77777777-7777-4777-8777-777777777777';
  let p = await e.juego.iniciarPartida(yo);
  p = await e.juego.iniciarRonda(yo, p.id, 1);
  e.reloj.fijar('2026-10-06T12:00:01-03:00'); // 12 h después del fin del día
  p = await e.juego.verPartida(yo, p.id);
  assert.ok(p.terminada);
  assert.deepEqual(p.rondas.map((r) => r.estado), ['vencida', 'caducada', 'caducada', 'caducada', 'caducada', 'caducada', 'caducada']);
});

test('sin desafío publicado no se puede jugar (y el juego no genera nada)', async () => {
  const e = await armar();
  await assert.rejects(() => e.juego.iniciarPartida('88888888-8888-4888-8888-888888888888'), (err) => err.codigo === 'sin_desafio');
  assert.equal((await e.juego.estado('88888888-8888-4888-8888-888888888888')).desafio, null);
  assert.equal((await e.db.get('SELECT COUNT(*) AS n FROM desafios')).n, 0);
});

test('reportar una respuesta faltante', async () => {
  const e = await armar();
  await publicarHoy(e);
  const yo = '99999999-9999-4999-8999-999999999999';
  let p = await e.juego.iniciarPartida(yo);
  await assert.rejects(() => e.juego.reportar(yo, p.id, 1, 'algo'), (err) => err.codigo === 'ronda_no_iniciada');
  p = await e.juego.iniciarRonda(yo, p.id, 1);
  assert.deepEqual(await e.juego.reportar(yo, p.id, 1, 'Respuesta Nueva', 'Está en tal libro'), { ok: true, duplicado: false });
  assert.deepEqual(await e.juego.reportar(yo, p.id, 1, 'respuesta nueva'), { ok: true, duplicado: true });
  const valida = (await respuestasDe(e.db, '2026-10-05', 1))[0].canonica;
  assert.equal((await e.juego.reportar(yo, p.id, 1, valida)).yaValida, true);
  assert.equal((await e.db.get('SELECT COUNT(*) AS n FROM reportes')).n, 1);
});

test('la partida nunca consulta a la IA', async () => {
  const e = await armar();
  await publicarHoy(e);
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    throw new Error('no debería usarse');
  };
  try {
    const yo = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let p = await e.juego.iniciarPartida(yo);
    p = await e.juego.iniciarRonda(yo, p.id, 1);
    await e.juego.responder(yo, p.id, 1, 'cualquier cosa');
    await e.juego.responder(yo, p.id, 1, (await respuestasDe(e.db, '2026-10-05', 1))[0].canonica);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(llamadas, 0);
});
