// Arma la aplicación (base, juego, API y generación). La usan el servidor local y la función de Vercel.
import { cargarConfig } from './config.js';
import { abrirBD, obtenerSecreto } from './db.js';
import { crearJuego } from './juego.js';
import { crearApi } from './api.js';
import { crearContextoGeneracion } from './generador/contexto.js';

export async function crearAplicacion(sobrescrituras = {}) {
  const config = { ...cargarConfig(sobrescrituras), ...(sobrescrituras.config || {}) };
  const ahora = sobrescrituras.ahora || (() => Date.now() + config.relojDesfaseMs);
  const log = sobrescrituras.log || console;
  if (config.enVercel && !/^(libsql|https?|wss?):/.test(config.rutaBD)) {
    throw new Error('Falta TURSO_DATABASE_URL: conectá una base Turso al proyecto (Storage → Turso) y volvé a desplegar.');
  }
  const db = await abrirBD(config.rutaBD, { token: config.tokenBD });
  const secreto = await obtenerSecreto(db, config.secretoSesion);
  const contexto = sobrescrituras.contexto || crearContextoGeneracion(config, { log });
  const juego = crearJuego({ db, config, ahora });
  const api = crearApi({ db, config, juego, secreto, contexto, ahora });
  return { config, ahora, log, db, contexto, juego, api };
}
