import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerCookies, ipCliente, CABECERAS_SEGURIDAD } from '../servidor/http.js';
import { crearRegistro } from '../servidor/registro.js';
import { iniciarServidor } from '../servidor/index.js';

test('cookies con percent-encoding inválido no rompen nada; IP del cliente sin confiar en encabezados falsos', async () => {
  assert.deepEqual(leerCookies({ headers: { cookie: 'a=%E0%A4%A; b=ok; c=%zz' } }), { b: 'ok' });
  const req = (headers, remoteAddress = '10.0.0.9') => ({ headers, socket: { remoteAddress } });
  assert.equal(ipCliente(req({ 'x-forwarded-for': '1.2.3.4' })), '10.0.0.9', 'sin proxy de confianza se ignora XFF');
  assert.equal(ipCliente(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.5' }), { confiarProxy: true }), '203.0.113.5', 'con proxy propio: la entrada que agregó el proxy');
  assert.equal(ipCliente(req({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' }), { enVercel: true }), '198.51.100.7');
  assert.match(CABECERAS_SEGURIDAD['content-security-policy'], /object-src 'none'/);
  assert.match(CABECERAS_SEGURIDAD['content-security-policy'], /frame-ancestors 'none'/);

  const dir = mkdtempSync(join(tmpdir(), 'filon-seg-'));
  const app = await iniciarServidor({ sinArchivoEnv: true, log: { info() {}, warn() {}, error() {} }, env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, 'x.db'), TURSO_DATABASE_URL: '', BD_URL: '', PROGRAMADOR_INTERNO: '0' } });
  try {
    const r = await fetch(`http://127.0.0.1:${app.puerto}/api/estado`, { headers: { cookie: 'filon_id=%E0%A4%A' } });
    assert.equal(r.status, 200, 'no da 500');
    assert.match(r.headers.get('content-security-policy'), /object-src 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await app.cerrar();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('los logs estructurados ocultan secretos, cookies e IPs', () => {
  const lineas = [];
  const r = crearRegistro({ info: (l) => lineas.push(l), warn: (l) => lineas.push(l), error: (l) => lineas.push(l) });
  r.info('prueba', { token: 'abc', authorization: 'Bearer x', cookie: 'filon_admin=1', ip: '1.2.3.4', anidado: { claveApi: 'sk-1', ok: 1 }, ruta: '/api/x' });
  const dato = JSON.parse(lineas[0]);
  assert.equal(dato.evento, 'prueba');
  assert.equal(dato.ruta, '/api/x');
  assert.equal(dato.anidado.ok, 1);
  assert.ok(!/abc|Bearer x|filon_admin=1|1\.2\.3\.4|sk-1/.test(lineas[0]));
});
