// Volumen representativo: miles de partidas, preguntas de 1.500 respuestas y límites de tamaño.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarServidor } from '../servidor/index.js';
import { publicarDesafio, conciliarPuntajes } from '../servidor/banco.js';
import { normalizar } from '../servidor/normalizar.js';
import { CONSULTAS, explicar } from '../scripts/explicar-consultas.js';
import { LIMITES } from '../servidor/dominio.js';
import { cargarReserva } from '../servidor/generador/reserva.js';

const silencioso = { info() {}, warn() {}, error() {} };
const ADMIN = { authorization: 'Bearer volumen-admin' };
let dir;
before(() => (dir = mkdtempSync(join(tmpdir(), 'filon-volumen-'))));
after(() => rmSync(dir, { recursive: true, force: true }));

async function levantar() {
  return iniciarServidor({
    sinArchivoEnv: true,
    log: silencioso,
    env: {
      PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, `${Math.random().toString(36).slice(2)}.db`),
      TURSO_DATABASE_URL: '', BD_URL: '', TOKEN_ADMIN: 'volumen-admin', PROGRAMADOR_INTERNO: '0',
    },
  });
}

const RAREZAS = [['grava', 10], ['cobre', 30], ['plata', 60], ['oro', 85], ['diamante', 100]];
/** Una pregunta sintética con `n` respuestas, ya en el formato que guarda la base. */
function preguntaGrande(categoria, n) {
  return {
    categoria,
    enunciado: `Nombrá un elemento de la lista grande de ${categoria}.`,
    alcance: 'Lista sintética de prueba.',
    huella: `grande-${categoria}`,
    origen: 'ia',
    fuentes: [{ url: 'https://es.wikipedia.org/wiki/Prueba', titulo: 'Prueba' }],
    rechazos: [],
    respuestas: Array.from({ length: n }, (_, i) => {
      const [rareza, puntos] = RAREZAS[Math.min(4, Math.floor((i / n) * 5))];
      const canonica = `Entidad ${categoria} ${String(i).padStart(4, '0')}`;
      return { canonica, rareza, puntos, explicacion: 'Sintética.', variantes: [], formas: [normalizar(canonica)] };
    }),
  };
}

test('volumen: preguntas de 1.500 respuestas se revelan paginadas y la vista no las carga', async () => {
  const app = await levantar();
  const base = `http://127.0.0.1:${app.puerto}`;
  try {
    const hoy = (await (await fetch(`${base}/api/salud`)).json()).fecha;
    const categorias = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'];
    await publicarDesafio(app.db, { fecha: hoy, preguntas: categorias.map((c) => preguntaGrande(c, 1500)), origen: 'ia' });

    let cookie = '';
    const pedir = async (metodo, ruta, cuerpo) => {
      const r = await fetch(base + ruta, { method: metodo, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' }, body: metodo === 'POST' ? JSON.stringify(cuerpo || {}) : undefined });
      cookie = r.headers.get('set-cookie')?.split(';')[0] || cookie;
      return { estado: r.status, datos: await r.json() };
    };
    const p = (await pedir('POST', '/api/partidas')).datos.partida;
    await pedir('POST', `/api/partidas/${p.id}/rondas/1/iniciar`);
    const cerrada = (await pedir('POST', `/api/partidas/${p.id}/rondas/1/pasar`)).datos.partida;
    assert.equal(cerrada.rondas[0].totalRespuestas, 1500, 'la vista cuenta las respuestas sin traerlas');
    assert.ok(JSON.stringify(cerrada).length < 20_000, 'el estado de la partida sigue siendo liviano');

    const pag1 = (await pedir('GET', `/api/partidas/${p.id}/rondas/1/respuestas?limite=5000`)).datos;
    assert.equal(pag1.respuestas.length, LIMITES.paginaRevelado, 'la página tiene tope aunque se pida más');
    assert.equal(pag1.total, 1500);
    assert.equal(pag1.siguiente, LIMITES.paginaRevelado);
    assert.ok(pag1.respuestas.every((r, i, t) => i === 0 || t[i - 1].puntos >= r.puntos));
    const ultima = (await pedir('GET', `/api/partidas/${p.id}/rondas/1/respuestas?desde=1450`)).datos;
    assert.equal(ultima.respuestas.length, 50);
    assert.equal(ultima.siguiente, null);
    const busqueda = (await pedir('GET', `/api/partidas/${p.id}/rondas/1/respuestas?buscar=0042`)).datos;
    assert.deepEqual(busqueda.respuestas.map((r) => r.canonica), ['Entidad geografia 0042']);

    const detalle = await (await fetch(`${base}/api/admin/desafios/${hoy}`, { headers: ADMIN })).json();
    assert.ok(detalle.preguntas.every((q) => q.respuestas.length === LIMITES.respuestasEnDetalleAdmin && q.totalRespuestas === 1500));
  } finally {
    await app.cerrar();
  }
});

test('volumen: 3.000 partidas terminadas; ranking y estadísticas salen del histograma agregado', async () => {
  const app = await levantar();
  try {
    const hoy = '2026-10-05';
    const reserva = cargarReserva(app.config.rutaReserva, { dominios: app.config.fuentes.dominios }).preguntas;
    const lote = ['geografia', 'historia', 'ciencia', 'deportes', 'cine', 'musica', 'literatura'].map((c) => reserva.find((p) => p.categoria === c));
    const { desafioId } = await publicarDesafio(app.db, { fecha: hoy, preguntas: lote, origen: 'reserva' });
    const filas = Array.from({ length: 3000 }, (_, i) => [`v${i}`, (i * 37) % 141 * 5]);
    for (let i = 0; i < filas.length; i += 500) {
      const parte = filas.slice(i, i + 500);
      await app.db.cliente.batch(
        [
          ...parte.map(([id]) => ({ sql: 'INSERT INTO jugadores (id, creado_en) VALUES (?, 0)', args: [id] })),
          ...parte.map(([id, puntos]) => ({ sql: 'INSERT INTO partidas (id, jugador_id, desafio_id, iniciada_en, terminada_en, puntos) VALUES (?, ?, ?, 0, 1, ?)', args: [`p-${id}`, id, desafioId, puntos] })),
        ],
        'write',
      );
    }
    await conciliarPuntajes(app.db, desafioId);
    const histograma = await app.db.all('SELECT puntos, cantidad FROM puntajes_desafio WHERE desafio_id = ?', desafioId);
    assert.ok(histograma.length <= 141, `${histograma.length} filas en lugar de 3.000`);
    assert.equal(histograma.reduce((s, f) => s + f.cantidad, 0), 3000);

    const t0 = Date.now();
    const e = await (await fetch(`http://127.0.0.1:${app.puerto}/api/admin/estadisticas?fecha=${hoy}&desde=${hoy}&hasta=${hoy}`, { headers: ADMIN })).json();
    const demora = Date.now() - t0;
    const promedio = filas.reduce((s, [, p]) => s + p, 0) / filas.length;
    assert.equal(e.dia.terminadas, 3000);
    assert.ok(Math.abs(e.dia.resumen.promedio - promedio * 10) < 1e-6, 'el promedio del histograma es exacto');
    assert.ok(e.dia.distribucion.length <= 141, 'el endpoint no devuelve una fila por partida');
    assert.ok(demora < 2000, `estadísticas en ${demora} ms`);

    // Las consultas principales siguen usando índices con datos.
    for (const c of await explicar(app.db)) {
      const plan = c.plan.join(' | ');
      assert.ok(!/\bSCAN (partidas|intentos|rondas|jugadores|reportes|respuestas|variantes|limites|admin_sesiones|puntajes_desafio)\b(?! USING)/.test(plan), `«${c.nombre}» recorre una tabla completa: ${plan}`);
    }
    assert.ok(CONSULTAS.length >= 20);
  } finally {
    await app.cerrar();
  }
});

test('límites de tamaño en la carga manual', async () => {
  const app = await levantar();
  const ruta = `http://127.0.0.1:${app.puerto}/api/admin/desafios/2026-12-01/importar`;
  const enviar = (cuerpo) => fetch(ruta, { method: 'POST', headers: { ...ADMIN, 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
  try {
    const enorme = await enviar(JSON.stringify({ preguntas: [], relleno: 'x'.repeat(LIMITES.cuerpoImportacion + 10) }));
    assert.equal(enorme.status, 413, 'el cuerpo supera el máximo');
    const ocho = await enviar({ preguntas: Array.from({ length: 8 }, () => ({})) });
    assert.equal(ocho.status, 422);
    const larga = await enviar({ preguntas: [{ respuestas: Array.from({ length: LIMITES.respuestasPorPregunta + 1 }, () => ({})) }] });
    assert.equal(larga.status, 413);
    assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM desafios')).n, 0, 'nada se guardó');
  } finally {
    await app.cerrar();
  }
});
