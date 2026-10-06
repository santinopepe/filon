import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearVerificador, ipPrivada } from '../servidor/verificacion.js';
import { leerCookies, ipCliente, CABECERAS_SEGURIDAD } from '../servidor/http.js';
import { crearRegistro } from '../servidor/registro.js';
import { iniciarServidor } from '../servidor/index.js';

const DOMINIOS = ['wikipedia.org'];
const publico = async () => [{ address: '208.80.154.224', family: 4 }];
const pagina = (texto, extra = {}) => new Response(`<html><body>${texto}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...extra } });
const redireccion = (destino, estado = 302) => new Response(null, { status: estado, headers: { location: destino } });
const crear = (obtener, extra = {}) => crearVerificador({ dominios: DOMINIOS, obtener, resolver: publico, userAgent: 'prueba', tiempoLimiteMs: 2000, ...extra });

test('SSRF: solo HTTPS, dominios permitidos y puerto 443; nada de IPs literales', async () => {
  const v = crear(async () => pagina('ok'));
  await assert.rejects(v.textoDeFuente('http://es.wikipedia.org/wiki/X'), /HTTPS/);
  await assert.rejects(v.textoDeFuente('https://evil.example/wiki/X'), /dominio no permitido/);
  await assert.rejects(v.textoDeFuente('https://es.wikipedia.org:8443/wiki/X'), /puerto/);
  await assert.rejects(v.textoDeFuente('https://169.254.169.254/latest/meta-data'), /IPs literales/);
  await assert.rejects(v.textoDeFuente('https://user:pass@es.wikipedia.org/'), /credenciales/);
  assert.match(await v.textoDeFuente('https://es.wikipedia.org/wiki/X'), / ok /);
});

test('SSRF: un dominio permitido que resuelve a una red privada o a metadata se rechaza', async () => {
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.20.0.1', '::1', 'fd00::1', '::ffff:10.1.2.3']) {
    const v = crearVerificador({ dominios: DOMINIOS, obtener: async () => pagina('x'), resolver: async () => [{ address }], userAgent: 'p' });
    await assert.rejects(v.textoDeFuente('https://es.wikipedia.org/wiki/X'), /red privada/, address);
  }
  assert.equal(ipPrivada('208.80.154.224'), false);
  assert.equal(ipPrivada('2620:0:861:ed1a::1'), false);
});

test('SSRF: cada redirección se revalida y hay un máximo de saltos', async () => {
  const llamadas = [];
  const v = crear(async (url, op) => {
    llamadas.push({ url, redirect: op.redirect });
    if (url.endsWith('/a')) return redireccion('https://evil.example/b');
    if (url.endsWith('/c')) return redireccion('http://es.wikipedia.org/d');
    if (url.endsWith('/e')) return redireccion('https://169.254.169.254/');
    if (url.includes('/bucle')) return redireccion(url + 'x');
    if (url.endsWith('/bien')) return redireccion('/wiki/Destino', 301);
    return pagina('destino final');
  });
  await assert.rejects(v.textoDeFuente('https://es.wikipedia.org/a'), /dominio no permitido/);
  await assert.rejects(v.textoDeFuente('https://es.wikipedia.org/c'), /HTTPS/);
  await assert.rejects(v.textoDeFuente('https://es.wikipedia.org/e'), /IPs literales/);
  await assert.rejects(v.textoDeFuente('https://es.wikipedia.org/bucle'), /demasiadas redirecciones/);
  assert.match(await v.textoDeFuente('https://es.wikipedia.org/bien'), /destino final/);
  assert.ok(llamadas.every((l) => l.redirect === 'manual'), 'fetch nunca sigue redirecciones por su cuenta');
  assert.ok(!llamadas.some((l) => l.url.includes('evil.example') || l.url.startsWith('http:')), 'nunca se pidió un destino rechazado');
});

test('SSRF: cuerpos grandes se cortan sin descargarlos enteros; el timeout aborta la solicitud', async () => {
  const declarado = crear(async () => pagina('x', { 'content-length': '99999999' }), { maxBytes: 1000 });
  await assert.rejects(declarado.textoDeFuente('https://es.wikipedia.org/grande'), /demasiado grande/);

  let leidos = 0;
  const infinito = new ReadableStream({
    pull(c) {
      leidos += 1024;
      c.enqueue(new Uint8Array(1024).fill(65));
    },
  });
  const sinLargo = crear(async () => new Response(infinito, { headers: { 'content-type': 'text/html' } }), { maxBytes: 10_000 });
  await assert.rejects(sinLargo.textoDeFuente('https://es.wikipedia.org/stream'), /demasiado grande/);
  assert.ok(leidos < 20_000, `dejó de leer enseguida (${leidos} bytes)`);

  let abortada = false;
  const lento = crear(
    (url, { signal }) =>
      new Promise((_, mal) => {
        signal.addEventListener('abort', () => {
          abortada = true;
          mal(signal.reason);
        });
      }),
    { tiempoLimiteMs: 50 },
  );
  const t0 = Date.now();
  await assert.rejects(lento.textoDeFuente('https://es.wikipedia.org/lento'));
  assert.ok(abortada && Date.now() - t0 < 1000, 'la solicitud real se abortó por timeout');

  const binario = crear(async () => new Response('x', { headers: { 'content-type': 'application/octet-stream' } }));
  await assert.rejects(binario.textoDeFuente('https://es.wikipedia.org/bin'), /no textual/);
});

test('cookies con percent-encoding inválido no rompen nada; IP del cliente sin confiar en encabezados falsos', async () => {
  assert.deepEqual(leerCookies({ headers: { cookie: 'a=%E0%A4%A; b=ok; c=%zz' } }), { b: 'ok' });
  const req = (headers, remoteAddress = '10.0.0.9') => ({ headers, socket: { remoteAddress } });
  assert.equal(ipCliente(req({ 'x-forwarded-for': '1.2.3.4' })), '10.0.0.9', 'sin proxy de confianza se ignora XFF');
  assert.equal(ipCliente(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.5' }), { confiarProxy: true }), '203.0.113.5', 'con proxy propio: la entrada que agregó el proxy');
  assert.equal(ipCliente(req({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' }), { enVercel: true }), '198.51.100.7');
  assert.match(CABECERAS_SEGURIDAD['content-security-policy'], /object-src 'none'/);
  assert.match(CABECERAS_SEGURIDAD['content-security-policy'], /frame-ancestors 'none'/);

  const dir = mkdtempSync(join(tmpdir(), 'filon-seg-'));
  const app = await iniciarServidor({ sinArchivoEnv: true, log: { info() {}, warn() {}, error() {} }, env: { PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, 'x.db'), IA_PROVEEDOR: 'ninguno', TURSO_DATABASE_URL: '', BD_URL: '', PROGRAMADOR_INTERNO: '0' } });
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
