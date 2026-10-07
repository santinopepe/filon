import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarServidor } from '../servidor/index.js';
import { crearReloj } from './ayuda.js';

const DIA = 86_400_000;

test('limpieza diaria: retención, sesiones y límites vencidos, conciliación del histograma', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filon-limpieza-'));
  const reloj = crearReloj('2026-10-05T12:00:00-03:00');
  const ahora = reloj.ahora();
  const app = await iniciarServidor({
    sinArchivoEnv: true,
    log: { info() {}, warn() {}, error() {} },
    ahora: reloj.ahora,
    env: {
      PUERTO: '0', HOST: '127.0.0.1', RUTA_BD: join(dir, 'f.db'), TURSO_DATABASE_URL: '', BD_URL: '',
      PROGRAMADOR_INTERNO: '0', CRON_SECRET: 'cron-limpieza',
    },
  });
  try {
    const { db } = app;
    const viejo = ahora - 400 * DIA;
    await db.cliente.executeMultiple(`
      INSERT INTO desafios (id, fecha, numero, origen, publicado_en) VALUES (1, '2026-10-05', 1, 'reserva', 0);
      INSERT INTO preguntas (id, desafio_id, posicion, categoria, enunciado, alcance, huella, origen, fuentes) VALUES ('2026-10-05-p1', 1, 1, 'historia', 'x', 'x', 'x', 'reserva', '[]');
      INSERT INTO jugadores (id, creado_en) VALUES ('visitante-viejo', ${viejo}), ('visitante-nuevo', ${ahora}), ('jugador-viejo', ${viejo}), ('reportero-viejo', ${viejo});
      INSERT INTO partidas (id, jugador_id, desafio_id, iniciada_en, terminada_en, puntos) VALUES ('p1', 'jugador-viejo', 1, ${viejo}, ${viejo}, 120);
      INSERT INTO intentos (partida_id, posicion, texto, normalizado, aceptado, en) VALUES ('p1', 1, 'viejo', 'viejo', 0, ${viejo}), ('p1', 1, 'nuevo', 'nuevo', 0, ${ahora});
      INSERT INTO reportes (jugador_id, pregunta_id, texto, normalizado, creado_en, estado) VALUES
        ('reportero-viejo', '2026-10-05-p1', 'a', 'a', ${viejo}, 'descartado'),
        ('reportero-viejo', '2026-10-05-p1', 'b', 'b', ${viejo}, 'pendiente');
      INSERT INTO corridas (fecha_objetivo, iniciada_en, detalle) VALUES ('2025-01-01', ${viejo}, '{"x":1}'), ('2026-10-05', ${ahora}, '{"y":1}');
      INSERT INTO admin_sesiones (hash, creada_en, ultima_actividad, vence_en, vida_hasta) VALUES ('vencida', 0, 0, 1, 2), ('vigente', ${ahora}, ${ahora}, ${ahora + 60_000}, ${ahora + 60_000});
      INSERT INTO limites (clave, ventana, cuenta, vence_en) VALUES ('login_admin:x', 1, 9, 1), ('respuesta:y', 1, 1, ${ahora + 60_000});
    `);

    const sinPermiso = await fetch(`http://127.0.0.1:${app.puerto}/api/cron/limpieza`);
    assert.equal(sinPermiso.status, 401);
    const r = await (await fetch(`http://127.0.0.1:${app.puerto}/api/cron/limpieza`, { headers: { authorization: 'Bearer cron-limpieza' } })).json();

    assert.equal(r.sesionesVencidas, 1);
    assert.equal(r.limitesVencidos, 1);
    const jugadores = (await db.all('SELECT id FROM jugadores ORDER BY id')).map((j) => j.id);
    assert.deepEqual(jugadores, ['jugador-viejo', 'reportero-viejo', 'visitante-nuevo'], 'solo se borra el visitante viejo sin partidas ni reportes');
    assert.deepEqual((await db.all('SELECT texto FROM intentos')).map((i) => i.texto), ['nuevo']);
    assert.deepEqual((await db.all('SELECT estado FROM reportes')).map((x) => x.estado), ['pendiente'], 'los pendientes no se borran');
    assert.deepEqual((await db.all('SELECT detalle FROM corridas ORDER BY id')).map((c) => c.detalle), [null, '{"y":1}']);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM partidas')).n, 1, 'las partidas se conservan');
    assert.deepEqual(await db.all('SELECT puntos, cantidad FROM puntajes_desafio'), [{ puntos: 120, cantidad: 1 }], 'concilia el histograma de los últimos días');
  } finally {
    await app.cerrar();
    rmSync(dir, { recursive: true, force: true });
  }
});
