// Servidor local (desarrollo o despliegue propio): base de datos, tarea diaria, API y archivos del juego.
// En Vercel no se usa: la API corre en api/index.js y los archivos de publico/ los sirve la CDN.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RAIZ } from './config.js';
import { crearAplicacion } from './app.js';
import { crearEstaticos, enviarJson } from './http.js';
import { crearProgramador } from './programador.js';

export async function iniciarServidor(sobrescrituras = {}) {
  const { config, ahora, log, db, contexto, juego, api } = await crearAplicacion(sobrescrituras);
  const estaticos = crearEstaticos(resolve(RAIZ, 'publico'));
  const programador = crearProgramador({ db, config, contexto, ahora, log });

  const servidor = createServer(async (req, res) => {
    try {
      if (await api(req, res, req.url)) return;
      if ((req.method === 'GET' || req.method === 'HEAD') && estaticos(req, res, req.url)) return;
      if (req.method === 'GET' && !req.url.includes('.')) {
        if (estaticos(req, res, '/index.html')) return;
      }
      enviarJson(res, 404, { error: 'no_encontrado' });
    } catch (e) {
      log.error('[http]', e);
      if (!res.headersSent) enviarJson(res, 500, { error: 'interno' });
    }
  });

  if (config.programador.interno) {
    await programador.iniciar();
  } else {
    log.info('[programador] desactivado (PROGRAMADOR_INTERNO=0): usá scripts/generar-desafio.js desde cron.');
  }

  await new Promise((ok) => servidor.listen(config.puerto, config.host, ok));
  const direccion = servidor.address();
  log.info(`[filon] escuchando en http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${direccion.port} — IA: ${contexto.proveedor ? contexto.proveedor.nombre + ' / ' + contexto.proveedor.modelo : 'sin configurar (se usa la reserva)'}`);

  async function cerrar() {
    programador.detener();
    await new Promise((ok) => servidor.close(ok));
    db.close();
  }
  return { servidor, db, config, juego, programador, cerrar, puerto: direccion.port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await iniciarServidor();
  for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, async () => {
      console.info(`[filon] ${senal}: cerrando…`);
      setTimeout(() => process.exit(1), 5000).unref();
      await app.cerrar();
      process.exit(0);
    });
  }
}
