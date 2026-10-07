// Servidor para las pruebas E2E: base temporal, con el desafío de hoy publicado desde la reserva.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarServidor } from '../../servidor/index.js';

import { TOKEN_ADMIN_E2E } from './ayuda.js';
const dir = mkdtempSync(join(tmpdir(), 'filon-e2e-'));
const app = await iniciarServidor({
  sinArchivoEnv: true,
  env: {
    PUERTO: process.env.PUERTO_E2E || '4317',
    HOST: '127.0.0.1',
    RUTA_BD: join(dir, 'e2e.db'),
    TURSO_DATABASE_URL: '',
    BD_URL: '',
    TOKEN_ADMIN: TOKEN_ADMIN_E2E,
    PROGRAMADOR_INTERNO: '1',
    // Todas las pruebas salen de la misma IP: se escalan los límites (en producción, 1).
    LIMITES_ESCALA: '50',
  },
});
const cerrar = async () => {
  await app.cerrar();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);
