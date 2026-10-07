import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarServidor } from '../servidor/index.js';
import { crearReloj } from './ayuda.js';

const silencioso = { info() {}, warn() {}, error() {} };
const TOKEN = 'token-maestro-de-prueba-123';
let dir;
before(() => (dir = mkdtempSync(join(tmpdir(), 'filon-sesiones-'))));
after(() => rmSync(dir, { recursive: true, force: true }));

async function levantar(env = {}, extra = {}) {
  return iniciarServidor({
    sinArchivoEnv: true,
    log: extra.log || silencioso,
    ahora: extra.ahora,
    env: {
      PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, `${Math.random().toString(36).slice(2)}.db`),
      TURSO_DATABASE_URL: '', BD_URL: '',
      TOKEN_ADMIN: TOKEN, PROGRAMADOR_INTERNO: '0', ...env,
    },
  });
}

/** Cliente con un frasco de cookies (varias por nombre), como un navegador. */
function navegador(puerto) {
  const frasco = new Map();
  return {
    frasco,
    async pedir(metodo, ruta, cuerpo, cabeceras = {}) {
      const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
        method: metodo,
        headers: {
          ...(frasco.size ? { cookie: [...frasco].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
          ...cabeceras,
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      });
      for (const c of res.headers.getSetCookie()) {
        const [par] = c.split(';');
        const i = par.indexOf('=');
        const valor = par.slice(i + 1);
        if (valor && !/Max-Age=0/.test(c)) frasco.set(par.slice(0, i), valor);
        else frasco.delete(par.slice(0, i));
      }
      return { estado: res.status, datos: await res.json().catch(() => null), res };
    },
  };
}

test('login: token incorrecto 401; correcto crea una sesión con cookie HttpOnly y SameSite=Strict', async () => {
  const registros = [];
  const log = { info: (l) => registros.push(l), warn: (l) => registros.push(l), error: (l) => registros.push(l) };
  const app = await levantar({}, { log });
  try {
    const b = navegador(app.puerto);
    assert.equal((await b.pedir('GET', '/api/admin/desafios')).estado, 401, 'sin sesión no hay acceso');
    assert.equal((await b.pedir('POST', '/api/admin/sesion', { token: 'mal' })).estado, 401);
    const ok = await b.pedir('POST', '/api/admin/sesion', { token: TOKEN });
    assert.equal(ok.estado, 200);
    const cookie = ok.res.headers.getSetCookie()[0];
    assert.match(cookie, /^filon_admin=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1800$/);
    assert.ok(!JSON.stringify(ok.datos).includes(TOKEN), 'la respuesta no devuelve el token maestro');
    assert.equal((await b.pedir('GET', '/api/admin/sesion')).datos.autenticado, true);
    assert.equal((await b.pedir('GET', '/api/admin/desafios')).estado, 200, 'la cookie alcanza: no hace falta el token');

    // En la base solo está el hash del token de sesión.
    const valor = b.frasco.get('filon_admin');
    const fila = await app.db.get('SELECT hash FROM admin_sesiones');
    assert.equal(fila.hash.length, 64);
    assert.notEqual(fila.hash, valor);

    // Solo los eventos estructurados (la línea de arranque del servidor local menciona su propia dirección).
    const texto = registros.filter((l) => l.startsWith('{')).join('\n');
    assert.match(texto, /"evento":"admin_login_fallido"/);
    assert.match(texto, /"evento":"admin_login"/);
    assert.match(texto, /"evento":"admin_no_autorizado"/);
    assert.ok(!texto.includes(TOKEN) && !texto.includes(valor), 'los logs no contienen el token ni la sesión');
    assert.ok(!texto.includes('127.0.0.1'), 'los logs no contienen la IP en claro');
  } finally {
    await app.cerrar();
  }
});

test('logout revoca la sesión en el servidor (la cookie robada deja de servir)', async () => {
  const app = await levantar();
  try {
    const b = navegador(app.puerto);
    await b.pedir('POST', '/api/admin/sesion', { token: TOKEN });
    const robada = b.frasco.get('filon_admin');
    const salida = await b.pedir('DELETE', '/api/admin/sesion');
    assert.equal(salida.estado, 200);
    assert.match(salida.res.headers.getSetCookie()[0], /Max-Age=0/);
    assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM admin_sesiones')).n, 0);
    const otro = navegador(app.puerto);
    otro.frasco.set('filon_admin', robada);
    assert.equal((await otro.pedir('GET', '/api/admin/desafios')).estado, 401);
  } finally {
    await app.cerrar();
  }
});

test('la sesión vence por inactividad, se renueva con actividad y no supera la vida absoluta', async () => {
  const reloj = crearReloj('2026-10-05T10:00:00-03:00');
  const app = await levantar({ ADMIN_INACTIVIDAD_MIN: '30', ADMIN_VIDA_HORAS: '2' }, { ahora: reloj.ahora });
  try {
    const b = navegador(app.puerto);
    await b.pedir('POST', '/api/admin/sesion', { token: TOKEN });
    // Actividad cada 20 minutos: la sesión se renueva...
    for (let i = 0; i < 5; i++) {
      reloj.avanzar(20 * 60_000);
      const r = await b.pedir('GET', '/api/admin/desafios');
      assert.equal(r.estado, 200, `sigue viva a los ${(i + 1) * 20} min`);
    }
    // ...pero nunca más allá de la vida absoluta (2 h).
    reloj.avanzar(20 * 60_000);
    assert.equal((await b.pedir('GET', '/api/admin/desafios')).estado, 401, 'vence a las 2 h aunque haya actividad');

    const c = navegador(app.puerto);
    await c.pedir('POST', '/api/admin/sesion', { token: TOKEN });
    reloj.avanzar(31 * 60_000);
    assert.equal((await c.pedir('GET', '/api/admin/desafios')).estado, 401, 'vence tras 30 min sin actividad');
    assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM admin_sesiones')).n, 0, 'las vencidas se borran');
  } finally {
    await app.cerrar();
  }
});

test('login con límite de intentos, chequeo de origen y cookie __Host- con HTTPS', async () => {
  const app = await levantar({ COOKIE_SEGURA: '1' });
  try {
    const b = navegador(app.puerto);
    for (let i = 0; i < 5; i++) assert.equal((await b.pedir('POST', '/api/admin/sesion', { token: 'mal' })).estado, 401);
    const bloqueado = await b.pedir('POST', '/api/admin/sesion', { token: TOKEN });
    assert.equal(bloqueado.estado, 429, 'el sexto intento en 15 minutos se rechaza, aunque sea correcto');
    assert.ok(Number(bloqueado.res.headers.get('retry-after')) > 0);
  } finally {
    await app.cerrar();
  }
  const app2 = await levantar({ COOKIE_SEGURA: '1' });
  try {
    const b = navegador(app2.puerto);
    const ok = await b.pedir('POST', '/api/admin/sesion', { token: TOKEN });
    assert.match(ok.res.headers.getSetCookie()[0], /^__Host-filon_admin=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
    const ajeno = await b.pedir('POST', '/api/admin/desafios/2026-12-01/generar', { modo: 'reserva' }, { origin: 'https://otro-sitio.example' });
    assert.equal(ajeno.estado, 403, 'un POST con la cookie desde otro origen se rechaza');
    const login = await navegador(app2.puerto).pedir('POST', '/api/admin/sesion', { token: TOKEN }, { origin: 'https://otro-sitio.example' });
    assert.equal(login.estado, 403);
  } finally {
    await app2.cerrar();
  }
});

test('transición: Bearer TOKEN_ADMIN sigue sirviendo para scripts, salvo con ADMIN_PERMITIR_BEARER=0', async () => {
  const app = await levantar();
  try {
    const r = await navegador(app.puerto).pedir('GET', '/api/admin/desafios', undefined, { authorization: `Bearer ${TOKEN}` });
    assert.equal(r.estado, 200);
  } finally {
    await app.cerrar();
  }
  const estricto = await levantar({ ADMIN_PERMITIR_BEARER: '0' });
  try {
    const r = await navegador(estricto.puerto).pedir('GET', '/api/admin/desafios', undefined, { authorization: `Bearer ${TOKEN}` });
    assert.equal(r.estado, 401);
  } finally {
    await estricto.cerrar();
  }
});
