// Persistencia con libSQL (SQLite compatible): archivo local en desarrollo, Turso en producción (Vercel).
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { prepararRevelado } from './revelado.js';

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

/**
 * ¿Es un corte de red con la base remota (Turso)? En Vercel, la primera sentencia después de varios
 * segundos de CPU ocupada (generar un desafío) puede encontrar la conexión HTTP cerrada y fallar con
 * «fetch failed». La siguiente abre una conexión nueva y funciona.
 */
export function esErrorDeRed(e) {
  const textos = [e?.message, e?.code, e?.cause?.message, e?.cause?.code, e?.cause?.cause?.code].filter(Boolean).join(' ');
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR|other side closed|socket hang up|terminated|network/i.test(textos);
}
const INTENTOS_RED = 4;

/** Descripción de la causa de un error (para registrarla: «fetch failed» solo no dice nada). */
export function describirError(e) {
  const causas = [];
  for (let c = e?.cause, n = 0; c && n < 3; c = c.cause, n++) causas.push([c.code, c.message].filter(Boolean).join(': '));
  return [e?.message ?? String(e), ...causas.filter(Boolean)].join(' ← ');
}

// libSQL local no espera a que se libere un bloqueo: se reintenta (las sentencias fallidas no aplicaron nada).
// Un corte de red con la base remota también se reintenta, pocas veces y con espera creciente.
async function conReintentos(fn) {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      const ocupada = /SQLITE_BUSY/.test(e.code || e.message);
      const red = !ocupada && esErrorDeRed(e);
      if (!(ocupada && intento < 50) && !(red && intento < INTENTOS_RED)) throw e;
      await new Promise((ok) => setTimeout(ok, red ? 250 * intento : 10 * intento));
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
    async batch(sentencias) {
      return ejecutor.batch(sentencias);
    },
  };
}

/**
 * Abre la base. `url` puede ser libsql://… (Turso), file:… o una ruta local (o ':memory:').
 * Crea el esquema si hace falta.
 */
/**
 * Migraciones versionadas. Reglas:
 *  - Solo cambios aditivos (tablas, índices y columnas nuevas): el código de la versión anterior
 *    sigue funcionando mientras conviven instancias viejas y nuevas durante un despliegue.
 *    Única excepción: una migración que declara `reconstruye` puede rehacer esas tablas, siempre que
 *    conserven todas sus columnas (lo comprueban las pruebas).
 *  - Cada una es idempotente y se aplica dentro de una transacción; si dos instancias arrancan a la
 *    vez, la segunda ve la versión ya registrada y no hace nada.
 *  - Nunca se edita una migración ya publicada: se agrega otra.
 * La 1 es el esquema histórico (CREATE … IF NOT EXISTS), así que una base existente la «aplica» sin cambios.
 */
export const MIGRACIONES = [
  { version: 1, nombre: 'esquema_inicial', multiple: ESQUEMA },
  {
    version: 2,
    nombre: 'sesiones_admin',
    sentencias: [
      `CREATE TABLE IF NOT EXISTS admin_sesiones (
         hash TEXT PRIMARY KEY,
         creada_en INTEGER NOT NULL,
         ultima_actividad INTEGER NOT NULL,
         vence_en INTEGER NOT NULL,
         vida_hasta INTEGER NOT NULL
       )`,
      'CREATE INDEX IF NOT EXISTS admin_sesiones_vence ON admin_sesiones(vence_en)',
    ],
  },
  {
    version: 3,
    nombre: 'limites_distribuidos',
    sentencias: [
      `CREATE TABLE IF NOT EXISTS limites (
         clave TEXT PRIMARY KEY,
         ventana INTEGER NOT NULL,
         cuenta INTEGER NOT NULL,
         vence_en INTEGER NOT NULL
       )`,
      'CREATE INDEX IF NOT EXISTS limites_vence ON limites(vence_en)',
    ],
  },
  {
    version: 4,
    nombre: 'puntajes_agregados',
    sentencias: [
      // Histograma exacto de puntos por desafío (los puntos van de 0 a 700 de a 5: ≤ 141 filas por día).
      `CREATE TABLE IF NOT EXISTS puntajes_desafio (
         desafio_id INTEGER NOT NULL,
         puntos INTEGER NOT NULL,
         cantidad INTEGER NOT NULL,
         PRIMARY KEY (desafio_id, puntos)
       )`,
      `INSERT OR IGNORE INTO puntajes_desafio (desafio_id, puntos, cantidad)
         SELECT desafio_id, puntos, COUNT(*) FROM partidas WHERE terminada_en IS NOT NULL GROUP BY desafio_id, puntos`,
    ],
  },
  {
    version: 5,
    nombre: 'indices_consultas',
    // Justificación con EXPLAIN QUERY PLAN en scripts/explicar-consultas.js y docs/OPERACIONES.md.
    sentencias: [
      'CREATE INDEX IF NOT EXISTS partidas_desafio_terminada ON partidas(desafio_id, terminada_en)',
      'CREATE INDEX IF NOT EXISTS partidas_jugador_terminada ON partidas(jugador_id, terminada_en)',
      'CREATE INDEX IF NOT EXISTS jugadores_creado ON jugadores(creado_en)',
      'CREATE INDEX IF NOT EXISTS reportes_estado ON reportes(estado, creado_en)',
      'CREATE INDEX IF NOT EXISTS reportes_pregunta ON reportes(pregunta_id, normalizado)',
      'CREATE INDEX IF NOT EXISTS intentos_en ON intentos(en)',
    ],
  },
  {
    version: 6,
    nombre: 'uso_ia_en_corridas',
    async aplicar(tx) {
      const columnas = new Set((await tx.all('PRAGMA table_info(corridas)')).map((c) => c.name));
      const nuevas = [
        ['llamadas_ia', 'INTEGER NOT NULL DEFAULT 0'],
        ['tokens_entrada', 'INTEGER NOT NULL DEFAULT 0'],
        ['tokens_salida', 'INTEGER NOT NULL DEFAULT 0'],
        ['costo_estimado_usd', 'REAL'],
      ];
      for (const [nombre, tipo] of nuevas) if (!columnas.has(nombre)) await tx.run(`ALTER TABLE corridas ADD COLUMN ${nombre} ${tipo}`);
      await tx.run('CREATE INDEX IF NOT EXISTS corridas_iniciada ON corridas(iniciada_en)');
    },
  },
  {
    version: 7,
    nombre: 'modos_de_juego',
    // Excepción documentada a «solo aditivas» (ver docs/OPERACIONES.md): las pruebas verifican que la
    // tabla reconstruida conserva todas sus columnas, sus filas y las claves foráneas que la apuntan.
    reconstruye: ['desafios'],
    // Un desafío por fecha Y modo. SQLite no permite quitar el UNIQUE(fecha) con ALTER TABLE, así que
    // `desafios` se reconstruye con las mismas columnas más `modo` (las filas existentes quedan en
    // 'normal'). Es la única migración no aditiva: el código anterior sigue leyendo las mismas columnas.
    // Con las claves foráneas activas (libSQL las activa), borrar la tabla padre deja violaciones
    // diferidas que se saldan al reinsertar las mismas filas antes del COMMIT; si algo no cierra, la
    // transacción entera se revierte.
    async aplicar(tx) {
      const columnas = new Set((await tx.all('PRAGMA table_info(desafios)')).map((c) => c.name));
      if (!columnas.has('modo')) {
        await tx.run('PRAGMA defer_foreign_keys = ON');
        await tx.run('CREATE TABLE desafios_copia AS SELECT * FROM desafios');
        await tx.run('DROP TABLE desafios');
        await tx.run(`CREATE TABLE desafios (
           id INTEGER PRIMARY KEY,
           fecha TEXT NOT NULL,
           numero INTEGER NOT NULL,
           origen TEXT NOT NULL CHECK (origen IN ('ia', 'reserva', 'mixto')),
           modelo TEXT,
           corrida_id INTEGER,
           publicado_en INTEGER NOT NULL,
           modo TEXT NOT NULL DEFAULT 'normal',
           UNIQUE (modo, fecha)
         )`);
        await tx.run(
          `INSERT INTO desafios (id, fecha, numero, origen, modelo, corrida_id, publicado_en, modo)
           SELECT id, fecha, numero, origen, modelo, corrida_id, publicado_en, 'normal' FROM desafios_copia`,
        );
        await tx.run('DROP TABLE desafios_copia');
      }
      // Las búsquedas por fecha sola (estadísticas, limpieza) siguen teniendo índice.
      await tx.run('CREATE INDEX IF NOT EXISTS desafios_fecha ON desafios(fecha)');
      const deCorridas = new Set((await tx.all('PRAGMA table_info(corridas)')).map((c) => c.name));
      if (!deCorridas.has('modo')) await tx.run("ALTER TABLE corridas ADD COLUMN modo TEXT NOT NULL DEFAULT 'normal'");
    },
  },
  {
    version: 8,
    nombre: 'reserva_en_la_base',
    // Reserva editable desde el panel (en Vercel los archivos de datos/ son de solo lectura). Se suma a
    // los bancos de datos/reserva*.json: una fila con el mismo id que una pregunta del archivo la
    // reemplaza (edición) o la saca de circulación (activa = 0). Cada pregunta que se publica (manual o
    // de la IA) queda guardada acá para reutilizarse.
    sentencias: [
      `CREATE TABLE IF NOT EXISTS reserva (
         id TEXT PRIMARY KEY,
         modo TEXT NOT NULL,
         pregunta TEXT NOT NULL,
         origen TEXT NOT NULL CHECK (origen IN ('manual', 'ia', 'edicion')),
         activa INTEGER NOT NULL DEFAULT 1,
         creada_en INTEGER NOT NULL,
         actualizada_en INTEGER NOT NULL
       )`,
      'CREATE INDEX IF NOT EXISTS reserva_modo ON reserva(modo, activa)',
    ],
  },
  {
    version: 9,
    nombre: 'revelado_preparado',
    // Orden del revelado y forma de búsqueda de cada respuesta, y conteos por pregunta, calculados al
    // publicar (servidor/revelado.js) en vez de en cada lectura. Columnas nuevas que admiten NULL: el
    // código anterior las ignora. Lo ya publicado se completa acá; si una instancia vieja publica durante
    // el despliegue, la lectura detecta `conteos` en NULL y lo prepara en ese momento.
    async aplicar(tx) {
      const deRespuestas = new Set((await tx.all('PRAGMA table_info(respuestas)')).map((c) => c.name));
      if (!deRespuestas.has('orden')) await tx.run('ALTER TABLE respuestas ADD COLUMN orden INTEGER');
      if (!deRespuestas.has('normalizada')) await tx.run('ALTER TABLE respuestas ADD COLUMN normalizada TEXT');
      const dePreguntas = new Set((await tx.all('PRAGMA table_info(preguntas)')).map((c) => c.name));
      if (!dePreguntas.has('conteos')) await tx.run('ALTER TABLE preguntas ADD COLUMN conteos TEXT');
      await tx.run('CREATE INDEX IF NOT EXISTS respuestas_revelado ON respuestas(pregunta_id, orden)');
      await tx.run('CREATE INDEX IF NOT EXISTS respuestas_revelado_rareza ON respuestas(pregunta_id, rareza, orden)');
      for (const { id } of await tx.all('SELECT id FROM preguntas WHERE conteos IS NULL')) await prepararRevelado(tx, id);
    },
  },
  {
    version: 10,
    nombre: 'generador_por_catalogos',
    // Segunda excepción documentada a «solo aditivas»: el CHECK de `origen` no se puede cambiar con ALTER
    // TABLE, y las preguntas armadas por el generador de catálogos tienen su propio origen («catalogo»).
    // `desafios` y `preguntas` se reconstruyen con las mismas columnas (y las mismas filas e ids); a
    // `preguntas` se le suman columnas que admiten NULL: firma semántica, huella del conjunto de
    // respuestas, metadatos de generación (JSON) y modo de coincidencia de las respuestas. El código
    // anterior sigue leyendo y escribiendo las mismas columnas de siempre.
    reconstruye: ['desafios', 'preguntas'],
    async aplicar(tx) {
      const sql = (tabla) => tx.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", tabla).then((f) => f.sql);
      const columnas = async (tabla) => (await tx.all(`PRAGMA table_info(${tabla})`)).map((c) => c.name);
      async function reconstruir(tabla, crear) {
        const anteriores = await columnas(tabla);
        await tx.run(`CREATE TABLE ${tabla}_copia AS SELECT * FROM ${tabla}`);
        await tx.run(`DROP TABLE ${tabla}`);
        await tx.run(crear);
        const nuevas = new Set(await columnas(tabla));
        const comunes = anteriores.filter((c) => nuevas.has(c)).join(', ');
        await tx.run(`INSERT INTO ${tabla} (${comunes}) SELECT ${comunes} FROM ${tabla}_copia`);
        await tx.run(`DROP TABLE ${tabla}_copia`);
      }
      await tx.run('PRAGMA defer_foreign_keys = ON');
      if (!(await sql('desafios')).includes("'catalogo'")) {
        await reconstruir(
          'desafios',
          `CREATE TABLE desafios (
             id INTEGER PRIMARY KEY,
             fecha TEXT NOT NULL,
             numero INTEGER NOT NULL,
             origen TEXT NOT NULL CHECK (origen IN ('ia', 'reserva', 'mixto', 'catalogo')),
             modelo TEXT,
             corrida_id INTEGER,
             publicado_en INTEGER NOT NULL,
             modo TEXT NOT NULL DEFAULT 'normal',
             UNIQUE (modo, fecha)
           )`,
        );
      }
      if (!(await sql('preguntas')).includes("'catalogo'")) {
        await reconstruir(
          'preguntas',
          `CREATE TABLE preguntas (
             id TEXT PRIMARY KEY,
             desafio_id INTEGER NOT NULL REFERENCES desafios(id),
             posicion INTEGER NOT NULL CHECK (posicion BETWEEN 1 AND 7),
             categoria TEXT NOT NULL,
             enunciado TEXT NOT NULL,
             alcance TEXT NOT NULL,
             huella TEXT NOT NULL,
             origen TEXT NOT NULL CHECK (origen IN ('ia', 'reserva', 'catalogo')),
             reserva_id TEXT,
             fuentes TEXT NOT NULL,
             rechazos TEXT NOT NULL DEFAULT '[]',
             conteos TEXT,
             firma TEXT,
             conjunto TEXT,
             generacion TEXT,
             coincidencia TEXT NOT NULL DEFAULT 'flexible' CHECK (coincidencia IN ('flexible', 'exacta')),
             UNIQUE (desafio_id, posicion)
           )`,
        );
      }
      await tx.run('CREATE INDEX IF NOT EXISTS desafios_fecha ON desafios(fecha)');
      await tx.run('CREATE INDEX IF NOT EXISTS preguntas_reserva ON preguntas(reserva_id)');
      await tx.run('CREATE INDEX IF NOT EXISTS preguntas_firma ON preguntas(firma)');
    },
  },
];

async function migrar(db, cliente, registro) {
  await conReintentos(() => cliente.execute('CREATE TABLE IF NOT EXISTS migraciones (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL, aplicada_en INTEGER NOT NULL)'));
  const aplicadas = new Set((await db.all('SELECT version FROM migraciones')).map((m) => m.version));
  for (const m of MIGRACIONES) {
    if (aplicadas.has(m.version)) continue;
    const inicio = Date.now();
    try {
      if (m.multiple) {
        // Solo sentencias IF NOT EXISTS: repetirla es inocuo, por eso puede ir fuera de una transacción.
        await conReintentos(() => cliente.executeMultiple(m.multiple));
        await db.run('INSERT OR IGNORE INTO migraciones (version, nombre, aplicada_en) VALUES (?, ?, ?)', m.version, m.nombre, Date.now());
      } else {
        await db.transaccion(async (tx) => {
          if (await tx.get('SELECT 1 AS si FROM migraciones WHERE version = ?', m.version)) return; // otra instancia ganó
          if (m.aplicar) await m.aplicar(tx);
          for (const sentencia of m.sentencias || []) await tx.run(sentencia);
          await tx.run('INSERT INTO migraciones (version, nombre, aplicada_en) VALUES (?, ?, ?)', m.version, m.nombre, Date.now());
        });
      }
      registro?.info('migracion', { version: m.version, nombre: m.nombre, duracionMs: Date.now() - inicio });
    } catch (e) {
      registro?.error('migracion_fallida', { version: m.version, nombre: m.nombre, error: e });
      throw e;
    }
  }
}

export async function abrirBD(url, { token, registro } = {}) {
  let destino = url;
  const local = !/^(libsql|https?|wss?):/.test(url);
  if (local && url !== ':memory:') {
    const ruta = url.replace(/^file:/, '');
    mkdirSync(dirname(ruta), { recursive: true });
    destino = `file:${ruta}`;
  }
  // `timeout`: espera de bloqueo (busy timeout) por conexión para archivos locales. Sin ella, dos procesos
  // sobre el mismo archivo reciben SQLITE_BUSY al instante y una sentencia cortada puede dejar la conexión
  // inutilizable para el siguiente COMMIT. En Turso (remoto) no aplica: la concurrencia la resuelve el servidor.
  const cliente = createClient({ url: destino, authToken: token || undefined, intMode: 'number', ...(local ? { timeout: 5000 } : {}) });
  // Varias instancias pueden abrir la misma base a la vez: el cambio a WAL reintenta si está ocupada.
  if (local && url !== ':memory:') await conReintentos(() => cliente.execute('PRAGMA journal_mode = WAL;'));
  const db = envolver(cliente, { reintentar: true });
  db.cliente = cliente;
  db.close = () => cliente.close();
  // Las transacciones del mismo proceso se encolan; entre procesos se reintenta si la base está ocupada.
  let cola = Promise.resolve();
  /** Ejecuta fn(tx) dentro de una transacción de escritura (BEGIN IMMEDIATE). */
  db.transaccion = (fn) => {
    const corrida = cola.then(async () => {
      // Si otra conexión tiene el bloqueo (BUSY al empezar, en una sentencia o al confirmar), la
      // transacción ya quedó revertida: se repite entera, releyendo el estado. Las funciones de
      // transacción solo leen y escriben la base, así que repetirlas es seguro.
      for (let intento = 1; ; intento++) {
        const tx = await conReintentos(() => cliente.transaction('write'));
        try {
          const r = await fn(envolver(tx));
          await tx.commit();
          return r;
        } catch (err) {
          await tx.rollback().catch(() => {});
          // Con la base ocupada, o si se cortó la conexión con la base remota, la transacción quedó
          // revertida: se repite entera. Un corte justo al confirmar puede haber guardado los cambios;
          // repetirla relee el estado (publicarDesafio ve el día ya publicado y no lo duplica).
          const ocupada = /SQLITE_BUSY/.test(err?.code || err?.message || '');
          if (!(ocupada && intento < 30) && !(esErrorDeRed(err) && intento < INTENTOS_RED)) throw err;
          await new Promise((ok) => setTimeout(ok, ocupada ? 5 * intento + Math.random() * 10 : 250 * intento));
        } finally {
          tx.close();
        }
      }
    });
    cola = corrida.catch(() => {});
    return corrida;
  };
  await migrar(db, cliente, registro);
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
