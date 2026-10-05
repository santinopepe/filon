// Utilidades compartidas por las pruebas.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cargarConfig } from '../servidor/config.js';
import { abrirBD } from '../servidor/db.js';
import { cargarReserva } from '../servidor/generador/reserva.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { crearVerificador } from '../servidor/verificacion.js';
import { fechaLocal } from '../servidor/tiempo.js';

export function crearReloj(inicio) {
  let t = typeof inicio === 'number' ? inicio : Date.parse(inicio);
  return {
    ahora: () => t,
    avanzar(ms) {
      t += ms;
      return t;
    },
    fijar(nuevo) {
      t = typeof nuevo === 'number' ? nuevo : Date.parse(nuevo);
    },
  };
}

/** Base nueva en un archivo temporal (':memory:' no admite transacciones concurrentes en libSQL). */
export function rutaTemporal() {
  return join(mkdtempSync(join(tmpdir(), 'filon-prueba-')), 'filon.db');
}

export async function prepararEntorno({ inicio = '2026-10-05T15:00:00-03:00', env = {} } = {}) {
  const config = cargarConfig({ sinArchivoEnv: true, env: { IA_PROVEEDOR: 'ninguno', ANTHROPIC_API_KEY: '', TURSO_DATABASE_URL: '', BD_URL: '', ...env } });
  config.rutaBD = rutaTemporal();
  const db = await abrirBD(config.rutaBD);
  const reloj = crearReloj(inicio);
  const reserva = cargarReserva(config.rutaReserva, { dominios: config.fuentes.dominios });
  const verificador = crearVerificador({ dominios: config.fuentes.dominios, modo: 'desactivada' });
  return { config, db, reloj, reserva, verificador };
}

/** Publica (con la reserva) el desafío del día actual del reloj. */
export async function publicarHoy(entorno, fecha = fechaLocal(entorno.reloj.ahora(), entorno.config.zona)) {
  const r = await asegurarDesafio({ db: entorno.db, config: entorno.config, fecha, reserva: entorno.reserva, verificador: entorno.verificador, proveedor: null, ahora: entorno.reloj.ahora });
  if (r.resultado !== 'publicado' && r.resultado !== 'ya_existia') throw new Error(`No se pudo publicar ${fecha}: ${JSON.stringify(r)}`);
  return r;
}

/** Respuestas almacenadas de una posición del desafío de una fecha. */
export function respuestasDe(db, fecha, posicion) {
  return db.all(
    `SELECT r.* FROM respuestas r JOIN preguntas p ON p.id = r.pregunta_id JOIN desafios d ON d.id = p.desafio_id
     WHERE d.fecha = ? AND p.posicion = ? ORDER BY r.puntos`,
    fecha,
    posicion,
  );
}

/** Respuesta HTML falsa que nombra todos los textos dados (para simular fuentes). */
export function paginaCon(textos) {
  return `<html><body><h1>Lista</h1><ul>${textos.map((t) => `<li>${t}</li>`).join('')}</ul></body></html>`;
}
