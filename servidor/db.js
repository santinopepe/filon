// Persistencia con libSQL (SQLite compatible): archivo local en desarrollo, Turso en producción (Vercel).
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Un desafío por fecha local. UNIQUE(fecha) impide duplicados aunque dos procesos publiquen a la vez.
CREATE TABLE IF NOT EXISTS desafios (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL UNIQUE,
  numero INTEGER NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('ia', 'reserva', 'mixto')),
  modelo TEXT,
  corrida_id INTEGER,
  publicado_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preguntas (
  id TEXT PRIMARY KEY,
  desafio_id INTEGER NOT NULL REFERENCES desafios(id),
  posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 7),
  categoria TEXT NOT NULL,
  enunciado TEXT NOT NULL,
  alcance TEXT NOT NULL,
  huella TEXT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('ia', 'reserva')),
  reserva_id TEXT,
  fuentes TEXT NOT NULL,
  rechazos TEXT NOT NULL DEFAULT '[]',
  UNIQUE (desafio_id, posicion)
);
CREATE INDEX IF NOT EXISTS preguntas_reserva ON preguntas(reserva_id);

CREATE TABLE IF NOT EXISTS respuestas (
  id INTEGER PRIMARY KEY,
  pregunta_id TEXT NOT NULL REFERENCES preguntas(id),
  canonica TEXT NOT NULL,
  rareza TEXT NOT NULL CHECK (rareza IN ('grava', 'cobre', 'plata', 'oro', 'diamante')),
  puntos INTEGER NOT NULL,
  explicacion TEXT NOT NULL,
  fuente_url TEXT NOT NULL,
  fuente_titulo TEXT,
  variantes TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS respuestas_pregunta ON respuestas(pregunta_id);

-- Formas normalizadas aceptadas. Todas apuntan a una respuesta: mismas variantes, mismos puntos.
CREATE TABLE IF NOT EXISTS variantes (
  pregunta_id TEXT NOT NULL,
  normalizada TEXT NOT NULL,
  respuesta_id INTEGER NOT NULL REFERENCES respuestas(id),
  PRIMARY KEY (pregunta_id, normalizada)
);

CREATE TABLE IF NOT EXISTS corridas (
  id INTEGER PRIMARY KEY,
  fecha_objetivo TEXT NOT NULL,
  iniciada_en INTEGER NOT NULL,
  terminada_en INTEGER,
  resultado TEXT NOT NULL DEFAULT 'en_curso',
  uso_ia INTEGER NOT NULL DEFAULT 0,
  detalle TEXT
);
CREATE INDEX IF NOT EXISTS corridas_fecha ON corridas(fecha_objetivo);

CREATE TABLE IF NOT EXISTS bloqueos (
  nombre TEXT PRIMARY KEY,
  titular TEXT NOT NULL,
  vence_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jugadores (
  id TEXT PRIMARY KEY,
  creado_en INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS partidas (
  id TEXT PRIMARY KEY,
  jugador_id TEXT NOT NULL REFERENCES jugadores(id),
  desafio_id INTEGER NOT NULL REFERENCES desafios(id),
  iniciada_en INTEGER NOT NULL,
  terminada_en INTEGER,
  puntos INTEGER NOT NULL DEFAULT 0,
  UNIQUE (jugador_id, desafio_id)
);

CREATE TABLE IF NOT EXISTS rondas (
  partida_id TEXT NOT NULL REFERENCES partidas(id),
  posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 7),
  pregunta_id TEXT NOT NULL REFERENCES preguntas(id),
  estado TEXT NOT NULL CHECK (estado IN ('activa', 'acertada', 'vencida', 'pasada', 'caducada')),
  inicio_en INTEGER NOT NULL,
  limite_en INTEGER NOT NULL,
  cierre_en INTEGER,
  respuesta_id INTEGER REFERENCES respuestas(id),
  texto_aceptado TEXT,
  puntos INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (partida_id, posicion)
);

CREATE TABLE IF NOT EXISTS intentos (
  id INTEGER PRIMARY KEY,
  partida_id TEXT NOT NULL,
  posicion INTEGER NOT NULL,
  texto TEXT NOT NULL,
  normalizado TEXT NOT NULL,
  aceptado INTEGER NOT NULL,
  motivo TEXT,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS intentos_ronda ON intentos(partida_id, posicion);

CREATE TABLE IF NOT EXISTS reportes (
  id INTEGER PRIMARY KEY,
  jugador_id TEXT NOT NULL,
  pregunta_id TEXT NOT NULL,
  texto TEXT NOT NULL,
  normalizado TEXT NOT NULL,
  comentario TEXT,
  creado_en INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  UNIQUE (jugador_id, pregunta_id, normalizado)
);
`;

// libSQL local no espera a que se libere un bloqueo: se reintenta (las sentencias fallidas no aplicaron nada).
async function conReintentos(fn) {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      if (!/SQLITE_BUSY/.test(e.code || e.message) || intento >= 50) throw e;
      await new Promise((ok) => setTimeout(ok, 10 * intento));
    }
  }
}

const comoObjeto = (rs, fila) => Object.fromEntries(rs.columns.map((c, i) => [c, fila[i]]));

/** Envoltorio con la misma forma para el cliente y para una transacción. */
function envolver(ejecutor, { reintentar = false } = {}) {
  const ejecutar = (sql, args) => (reintentar ? conReintentos(() => ejecutor.execute({ sql, args })) : ejecutor.execute({ sql, args }));
  return {
    async get(sql, ...args) {
      const rs = await ejecutar(sql, args);
      return rs.rows.length ? comoObjeto(rs, rs.rows[0]) : null;
    },
    async all(sql, ...args) {
      const rs = await ejecutar(sql, args);
      return rs.rows.map((f) => comoObjeto(rs, f));
    },
    async run(sql, ...args) {
      const rs = await ejecutar(sql, args);
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
    },
  };
}

/**
 * Abre la base. `url` puede ser libsql://… (Turso), file:… o una ruta local (o ':memory:').
 * Crea el esquema si hace falta.
 */
export async function abrirBD(url, { token } = {}) {
  let destino = url;
  const local = !/^(libsql|https?|wss?):/.test(url);
  if (local && url !== ':memory:') {
    const ruta = url.replace(/^file:/, '');
    mkdirSync(dirname(ruta), { recursive: true });
    destino = `file:${ruta}`;
  }
  const cliente = createClient({ url: destino, authToken: token || undefined, intMode: 'number' });
  if (local && url !== ':memory:') await cliente.execute('PRAGMA journal_mode = WAL;');
  await cliente.executeMultiple(ESQUEMA);
  const db = envolver(cliente, { reintentar: true });
  db.cliente = cliente;
  db.close = () => cliente.close();
  // Las transacciones del mismo proceso se encolan; entre procesos se reintenta si la base está ocupada.
  let cola = Promise.resolve();
  /** Ejecuta fn(tx) dentro de una transacción de escritura (BEGIN IMMEDIATE). */
  db.transaccion = (fn) => {
    const corrida = cola.then(async () => {
      const tx = await conReintentos(() => cliente.transaction('write'));
      try {
        const r = await fn(envolver(tx));
        await tx.commit();
        return r;
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      } finally {
        tx.close();
      }
    });
    cola = corrida.catch(() => {});
    return corrida;
  };
  return db;
}

/** Ejecuta fn(tx) dentro de una transacción con bloqueo de escritura inmediato. */
export function transaccion(db, fn) {
  return db.transaccion(fn);
}

export async function leerMeta(db, clave) {
  return (await db.get('SELECT valor FROM meta WHERE clave = ?', clave))?.valor ?? null;
}

export async function escribirMeta(db, clave, valor) {
  await db.run('INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', clave, valor);
}

/** Devuelve el secreto para firmar cookies; si no está configurado, crea uno persistente. */
export async function obtenerSecreto(db, configurado) {
  if (configurado) return configurado;
  let s = await leerMeta(db, 'secreto_sesion');
  if (!s) {
    await db.run('INSERT OR IGNORE INTO meta (clave, valor) VALUES (?, ?)', 'secreto_sesion', randomBytes(32).toString('hex'));
    s = await leerMeta(db, 'secreto_sesion');
  }
  return s;
}

/**
 * Bloqueo entre procesos con vencimiento (por si un proceso muere a mitad de camino).
 * Devuelve true si quedó tomado por `titular`.
 */
export function tomarBloqueo(db, nombre, titular, ttlMs, ahora = Date.now()) {
  return transaccion(db, async (tx) => {
    const fila = await tx.get('SELECT titular, vence_en FROM bloqueos WHERE nombre = ?', nombre);
    if (!fila) {
      await tx.run('INSERT INTO bloqueos (nombre, titular, vence_en) VALUES (?, ?, ?)', nombre, titular, ahora + ttlMs);
      return true;
    }
    if (fila.titular === titular || fila.vence_en < ahora) {
      await tx.run('UPDATE bloqueos SET titular = ?, vence_en = ? WHERE nombre = ?', titular, ahora + ttlMs, nombre);
      return true;
    }
    return false;
  });
}

export async function liberarBloqueo(db, nombre, titular) {
  await db.run('DELETE FROM bloqueos WHERE nombre = ? AND titular = ?', nombre, titular);
}
