import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarServidor } from '../servidor/index.js';

const silencioso = { info() {}, warn() {}, error() {} };
let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'filon-api-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function levantar(env = {}) {
  return iniciarServidor({
    sinArchivoEnv: true,
    log: silencioso,
    env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, `${Math.random().toString(36).slice(2)}.db`), TURSO_DATABASE_URL: '', BD_URL: '', TOKEN_ADMIN: 'secreto-admin', ...env },
  });
}

function cliente(puerto) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    async pedir(metodo, ruta, cuerpo, cabeceras = {}) {
      const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
        method: metodo,
        headers: { ...(cookie ? { cookie } : {}), ...(metodo === 'POST' ? { 'content-type': 'application/json' } : {}), ...cabeceras },
        body: metodo === 'POST' ? JSON.stringify(cuerpo ?? {}) : undefined,
      });
      const nueva = res.headers.get('set-cookie');
      if (nueva) cookie = nueva.split(';')[0];
      return { estado: res.status, datos: await res.json().catch(() => null), res };
    },
  };
}

test('abrir la página no genera desafíos', async () => {
  const app = await levantar({ PROGRAMADOR_INTERNO: '0' });
  try {
    const c = cliente(app.puerto);
    const html = await fetch(`http://127.0.0.1:${app.puerto}/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
    const { datos } = await c.pedir('GET', '/api/estado');
    assert.equal(datos.desafio, null);
    const r = await c.pedir('POST', '/api/partidas');
    assert.equal(r.estado, 503);
    assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM desafios')).n, 0);
  } finally {
    await app.cerrar();
  }
});

test('identificador anónimo persistente, firmado y una partida por día', async () => {
  const app = await levantar();
  try {
    const c = cliente(app.puerto);
    const e1 = await c.pedir('GET', '/api/estado');
    assert.ok(e1.datos.desafio, 'el programador publicó el desafío de hoy al iniciar');
    assert.match(e1.res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    const p1 = (await c.pedir('POST', '/api/partidas')).datos.partida;
    const p2 = (await c.pedir('POST', '/api/partidas')).datos.partida;
    assert.equal(p1.id, p2.id);
    // cookie adulterada: se trata como jugador nuevo y no puede ver la partida ajena
    const intruso = cliente(app.puerto);
    intruso.cookie = c.cookie.replace(/.$/, (x) => (x === 'a' ? 'b' : 'a'));
    const ajena = await intruso.pedir('GET', `/api/partidas/${p1.id}`);
    assert.equal(ajena.estado, 404);
  } finally {
    await app.cerrar();
  }
});

test('el cliente nunca recibe el banco de respuestas de una ronda en juego', async () => {
  const app = await levantar();
  try {
    const c = cliente(app.puerto);
    const p = (await c.pedir('POST', '/api/partidas')).datos.partida;
    assert.ok(p.rondas.every((r) => r.enunciado === undefined), 'las preguntas no se revelan antes de empezar');
    const iniciada = (await c.pedir('POST', `/api/partidas/${p.id}/rondas/1/iniciar`)).datos.partida;
    const texto = JSON.stringify(iniciada);
    const canonicas = (await app.db.all("SELECT r.canonica FROM respuestas r JOIN preguntas q ON q.id = r.pregunta_id WHERE q.posicion = 1"))
      .map((x) => x.canonica)
      .filter((x) => !iniciada.rondas[0].enunciado.includes(x) && !iniciada.rondas[0].alcance.includes(x));
    for (const canonica of canonicas) assert.ok(!texto.includes(`"${canonica}"`), `se filtró ${canonica}`);
    assert.ok(iniciada.rondas[1].enunciado === undefined);
  } finally {
    await app.cerrar();
  }
});

test('el catálogo de respuestas se descarga aparte y solo después de cerrar la ronda', async () => {
  const app = await levantar();
  try {
    const c = cliente(app.puerto);
    const p = (await c.pedir('POST', '/api/partidas')).datos.partida;
    await c.pedir('POST', `/api/partidas/${p.id}/rondas/1/iniciar`);
    assert.equal((await c.pedir('GET', `/api/partidas/${p.id}/rondas/1/respuestas`)).estado, 409);
    const cerrada = (await c.pedir('POST', `/api/partidas/${p.id}/rondas/1/pasar`)).datos.partida;
    assert.equal(cerrada.rondas[0].respuestasValidas, undefined, 'el estado liviano no incluye el catálogo completo');
    const catalogo = await c.pedir('GET', `/api/partidas/${p.id}/rondas/1/respuestas`);
    assert.equal(catalogo.estado, 200);
    assert.equal(catalogo.datos.respuestas.length, cerrada.rondas[0].totalRespuestas);
    assert.ok(catalogo.datos.respuestas.every((r, i, todas) => i === 0 || todas[i - 1].puntos >= r.puntos));
  } finally {
    await app.cerrar();
  }
});

test('revelado final: versión de caché y limitador se consultan en paralelo sin perder los permisos', async () => {
  const app = await levantar();
  try {
    const c = cliente(app.puerto);
    const p = (await c.pedir('POST', '/api/partidas')).datos.partida;
    for (let n = 1; n <= 7; n++) {
      await c.pedir('POST', `/api/partidas/${p.id}/rondas/${n}/iniciar`);
      await c.pedir('POST', `/api/partidas/${p.id}/rondas/${n}/pasar`);
    }
    const eventos = [];
    const get = app.db.get.bind(app.db);
    app.db.get = async (sql, ...args) => {
      const nombre = sql.includes('version_banco') ? 'version' : sql.includes('INSERT INTO limites') ? 'limite' : null;
      if (nombre) eventos.push(`inicio:${nombre}`);
      const resultado = await get(sql, ...args);
      if (nombre) eventos.push(`fin:${nombre}`);
      return resultado;
    };
    const ruta = `/api/partidas/${p.id}/rondas/1/respuestas`;
    const catalogo = await c.pedir('GET', ruta);
    assert.equal(catalogo.estado, 200);
    assert.equal(catalogo.res.headers.get('cache-control'), 'no-store');
    assert.ok(catalogo.datos.respuestas.length > 0);
    assert.ok(eventos.indexOf('inicio:limite') < eventos.indexOf('fin:version'), 'ambas consultas comienzan antes de terminar la primera');
    assert.equal(eventos.filter((e) => e === 'inicio:limite').length, 1, 'el contador se consume una sola vez');
    assert.equal((await cliente(app.puerto).pedir('GET', ruta)).estado, 404, 'la caché no permite ver la partida ajena');
  } finally {
    await app.cerrar();
  }
});

test('validaciones HTTP: JSON obligatorio, rutas inexistentes y administración protegida', async () => {
  const app = await levantar();
  try {
    const c = cliente(app.puerto);
    await c.pedir('GET', '/api/estado');
    const sinJson = await fetch(`http://127.0.0.1:${app.puerto}/api/partidas`, { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'text/plain' }, body: 'hola' });
    assert.equal(sinJson.status, 415);
    assert.equal((await c.pedir('GET', '/api/nada')).estado, 404);
    assert.equal((await c.pedir('GET', '/api/admin/reportes')).estado, 401);
    const admin = await c.pedir('GET', '/api/admin/corridas', null, { authorization: 'Bearer secreto-admin' });
    assert.equal(admin.estado, 200);
    assert.ok(admin.datos.corridas.length >= 1);
    const traversal = await fetch(`http://127.0.0.1:${app.puerto}/..%2f..%2fpackage.json`);
    assert.notEqual(traversal.status, 200);
  } finally {
    await app.cerrar();
  }
});

test('tarea diaria por HTTP (Vercel Cron): protegida e idempotente', async () => {
  const app = await levantar({ PROGRAMADOR_INTERNO: '0', CRON_SECRET: 'secreto-cron' });
  try {
    const c = cliente(app.puerto);
    assert.equal((await c.pedir('GET', '/api/cron/hoy')).estado, 401);
    assert.equal((await c.pedir('GET', '/api/cron/hoy', null, { authorization: 'Bearer otro' })).estado, 401);
    const cron = { authorization: 'Bearer secreto-cron' };
    assert.equal((await c.pedir('GET', '/api/cron/manana-ia', null, cron)).estado, 404);
    const hoy = await c.pedir('GET', '/api/cron/hoy', null, cron);
    assert.equal(hoy.datos.resultado, 'publicado');
    assert.equal((await c.pedir('GET', '/api/cron/hoy', null, cron)).datos.resultado, 'ya_existia');
    assert.equal((await c.pedir('GET', '/api/salud')).datos.desafioPublicado, true);
  } finally {
    await app.cerrar();
  }
});

test('administración: generar y regenerar días a mano', async () => {
  const app = await levantar({ PROGRAMADOR_INTERNO: '0' });
  const admin = { authorization: 'Bearer secreto-admin' };
  try {
    const c = cliente(app.puerto);
    const generar = (fecha, cuerpo) => c.pedir('POST', `/api/admin/desafios/${fecha}/generar`, cuerpo, admin);
    const hoy = (await c.pedir('GET', '/api/salud')).datos.fecha;

    assert.equal((await c.pedir('POST', `/api/admin/desafios/${hoy}/generar`, {})).estado, 401);

    const primero = await generar(hoy, {});
    assert.equal(primero.datos.resultado, 'publicado');
    assert.equal((await generar(hoy, {})).datos.error, 'ya_existe');

    const verPreguntas = async () => (await c.pedir('GET', `/api/admin/desafios/${hoy}`, null, admin)).datos.preguntas.map((p) => p.enunciado);
    const antes = await verPreguntas();
    // el juego cachea el desafío: se juega una ronda para llenar las cachés
    const p = (await c.pedir('POST', '/api/partidas')).datos.partida;
    const iniciada = (await c.pedir('POST', `/api/partidas/${p.id}/rondas/1/iniciar`)).datos.partida;
    assert.equal(iniciada.rondas[0].enunciado, antes[0]);

    const conPartidas = await generar(hoy, { reemplazar: true });
    assert.equal(conPartidas.estado, 409);
    assert.equal(conPartidas.datos.error, 'hay_partidas');

    const regenerado = await generar(hoy, { reemplazar: true, forzar: true });
    assert.equal(regenerado.datos.resultado, 'reemplazado');
    const despues = await verPreguntas();
    assert.equal(despues.length, 7);
    assert.ok(despues.every((e) => !antes.includes(e)), 'las preguntas reemplazadas no se repiten');

    // la partida vieja se borró y el juego ve el desafío nuevo
    assert.equal((await c.pedir('GET', `/api/partidas/${p.id}`)).estado, 404);
    const estado = (await c.pedir('GET', '/api/estado')).datos;
    assert.equal(estado.partidaHoy, null);
    const nueva = (await c.pedir('POST', '/api/partidas')).datos.partida;
    const ronda = (await c.pedir('POST', `/api/partidas/${nueva.id}/rondas/1/iniciar`)).datos.partida;
    assert.equal(ronda.rondas[0].enunciado, despues[0]);

    const lista = (await c.pedir('GET', '/api/admin/desafios', null, admin)).datos;
    assert.equal(lista.hoy, hoy);
    assert.equal(lista.desafios.length, 1);
    assert.equal(lista.desafios[0].partidas, 1);
  } finally {
    await app.cerrar();
  }
});

test('administración: importa un desafío manual desde JSON', async () => {
  const app = await levantar({ PROGRAMADOR_INTERNO: '0' });
  const admin = { authorization: 'Bearer secreto-admin' };
  try {
    const c = cliente(app.puerto);
    const fecha = (await c.pedir('GET', '/api/salud')).datos.fecha;
    const banco = JSON.parse(readFileSync(new URL('../datos/reserva.json', import.meta.url), 'utf8'));
    const categorias = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];
    const preguntas = categorias.map((categoria) => banco.preguntas.find((p) => p.categoria === categoria));
    const ruta = `/api/admin/desafios/${fecha}/importar`;

    assert.equal((await c.pedir('POST', ruta, { preguntas })).estado, 401);
    const incompleto = await c.pedir('POST', ruta, { preguntas: preguntas.slice(0, 6) }, admin);
    assert.equal(incompleto.estado, 422);
    assert.equal(incompleto.datos.error, 'desafio_invalido');
    assert.ok(incompleto.datos.detalles.errores.some((e) => /7 preguntas/.test(e)));
    assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM desafios')).n, 0, 'una importación inválida no guarda nada');

    const importado = await c.pedir('POST', ruta, { preguntas }, admin);
    assert.equal(importado.estado, 200);
    assert.equal(importado.datos.resultado, 'publicado');
    assert.equal(importado.datos.origen, 'manual');
    assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM corridas')).n, 0, 'la carga manual no crea corridas');

    const detalle = await c.pedir('GET', `/api/admin/desafios/${fecha}`, null, admin);
    assert.equal(detalle.datos.desafio.modelo, 'manual');
    assert.equal(detalle.datos.preguntas.length, 7);
    assert.ok(detalle.datos.preguntas.every((p) => p.respuestas.length >= 5));

    const repetido = await c.pedir('POST', ruta, { preguntas }, admin);
    assert.equal(repetido.estado, 409);
    assert.equal(repetido.datos.error, 'ya_existe');
    const reemplazado = await c.pedir('POST', ruta, { preguntas, reemplazar: true }, admin);
    assert.equal(reemplazado.datos.resultado, 'reemplazado');
  } finally {
    await app.cerrar();
  }
});

test('administración: estadísticas de jugadores, distribución y preguntas del día', async () => {
  const app = await levantar();
  const admin = { authorization: 'Bearer secreto-admin' };
  try {
    const hoy = (await cliente(app.puerto).pedir('GET', '/api/salud')).datos.fecha;
    const banco = (await cliente(app.puerto).pedir('GET', `/api/admin/desafios/${hoy}`, null, admin)).datos;
    const masRara = (n) => [...banco.preguntas[n - 1].respuestas].sort((a, b) => b.puntos - a.puntos)[0];

    // A acierta la más rara en las 7 · B pasa las 7 · C falla dos veces la 1 (mismo texto) y abandona
    const jugar = async (accion) => {
      const c = cliente(app.puerto);
      const p = (await c.pedir('POST', '/api/partidas')).datos.partida;
      for (let n = 1; n <= 7; n++) {
        await c.pedir('POST', `/api/partidas/${p.id}/rondas/${n}/iniciar`);
        if ((await accion(c, p, n)) === false) break;
      }
      return c;
    };
    await jugar((c, p, n) => c.pedir('POST', `/api/partidas/${p.id}/rondas/${n}/respuesta`, { texto: masRara(n).canonica }));
    await jugar((c, p, n) => c.pedir('POST', `/api/partidas/${p.id}/rondas/${n}/pasar`));
    const c = await jugar(async (c, p) => {
      await c.pedir('POST', `/api/partidas/${p.id}/rondas/1/respuesta`, { texto: 'Inventado Pérez' });
      await c.pedir('POST', `/api/partidas/${p.id}/rondas/1/respuesta`, { texto: 'inventado perez' });
      return false;
    });

    assert.equal((await cliente(app.puerto).pedir('GET', '/api/admin/estadisticas')).estado, 401);
    assert.equal((await c.pedir('GET', '/api/admin/estadisticas?fecha=2026-13-01', null, admin)).estado, 400);
    const e = (await c.pedir('GET', `/api/admin/estadisticas?fecha=${hoy}&desde=${hoy}&hasta=${hoy}`, null, admin)).datos;

    assert.equal(e.totales.jugadores, 3);
    assert.ok(e.totales.visitantes >= 3, 'cuenta también a quien solo abrió la página');
    assert.equal(e.serie.length, 1);
    assert.equal(e.serie[0].jugadores, 3);
    assert.equal(e.serie[0].terminadas, 2);
    assert.equal(e.dia.terminadas, 2, 'A y B terminaron');
    assert.equal(e.dia.enCurso, 1);
    assert.deepEqual(e.dia.distribucion, [{ metros: 0, cantidad: 1 }, { metros: 7000, cantidad: 1 }], 'histograma agregado, no la lista de partidas');
    assert.equal(e.dia.resumen.promedio, 3500);
    assert.equal(e.dia.resumen.mediana, 3500);
    const p1 = e.dia.preguntas[0];
    assert.equal(p1.acertadas, 1);
    assert.equal(p1.pasadas, 1);
    assert.equal(p1.jugadas, 2, 'la ronda en curso de C no cuenta como jugada');
    assert.equal(p1.enCurso, 1);
    assert.equal(p1.rarezas.diamante, 1);
    assert.equal(p1.topAceptadas[0].texto, masRara(1).canonica);
    assert.equal(p1.topFallidas[0].veces, 2, 'las dos formas del mismo intento fallido se agrupan');
    assert.equal(p1.promedioMetros, 500);
  } finally {
    await app.cerrar();
  }
});

test('visitas sin cookie: el registro de jugadores tiene un tope por IP compartido entre instancias', async () => {
  const ruta = join(dir, `${Math.random().toString(36).slice(2)}.db`);
  const a = await levantar({ RUTA_BD: ruta, PROGRAMADOR_INTERNO: '0' });
  const b = await levantar({ RUTA_BD: ruta, PROGRAMADOR_INTERNO: '0' });
  try {
    const sinCookie = (app) => fetch(`http://127.0.0.1:${app.puerto}/api/estado`).then((r) => r.status);
    const estados = [];
    for (let i = 0; i < 20; i++) estados.push(await sinCookie(a), await sinCookie(b));
    assert.ok(estados.every((e) => e === 200), 'el juego responde igual pasado el tope');
    assert.equal((await a.db.get('SELECT COUNT(*) AS n FROM jugadores')).n, 30, '40 visitas sin cookie, 30 registradas');
    // Con cookie, el jugador se registra aunque la IP haya pasado el tope; y al jugar, siempre.
    const c = cliente(a.puerto);
    await c.pedir('GET', '/api/estado');
    assert.equal((await a.db.get('SELECT COUNT(*) AS n FROM jugadores')).n, 30);
    await c.pedir('GET', '/api/estado');
    assert.equal((await a.db.get('SELECT COUNT(*) AS n FROM jugadores')).n, 31, 'la segunda visita (con cookie) sí queda');
  } finally {
    await a.cerrar();
    await b.cerrar();
  }
});
