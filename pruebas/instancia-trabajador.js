// Una «instancia» del servidor en su propio hilo, para simular varias funciones de Vercel sobre la
// misma base: cada hilo tiene su event loop, así que un bloqueo de SQLite no frena a las demás.
import { parentPort, workerData } from 'node:worker_threads';
import { crearAplicacion } from '../servidor/app.js';

let desfase = 0;
const silencioso = { info() {}, warn() {}, error() {} };
const app = await crearAplicacion({ sinArchivoEnv: true, log: silencioso, ahora: () => workerData.inicio + desfase, env: workerData.env });

parentPort.on('message', async ({ id, metodo, args = [] }) => {
  try {
    let resultado;
    if (metodo === 'avanzar') resultado = desfase += args[0];
    else if (metodo === 'cerrar') resultado = app.db.close();
    else resultado = await app.juego[metodo](...args);
    parentPort.postMessage({ id, resultado });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
parentPort.postMessage({ listo: true });
