// Función de Vercel: atiende todo /api/* (vercel.json reescribe las rutas hacia acá).
// La aplicación se arma una vez por instancia y se reutiliza entre solicitudes.
import { crearAplicacion } from '../servidor/app.js';
import { enviarJson } from '../servidor/http.js';
import { crearRegistro } from '../servidor/registro.js';

const registro = crearRegistro();

let aplicacion = null;

export default async function manejar(req, res) {
  try {
    aplicacion ??= crearAplicacion().catch((e) => {
      aplicacion = null;
      throw e;
    });
    const { api } = await aplicacion;
    if (!(await api(req, res, req.url))) enviarJson(res, 404, { error: 'no_encontrado' });
  } catch (e) {
    registro.error('error_5xx', { etapa: 'arranque', error: e, pila: e?.stack });
    if (!res.headersSent) enviarJson(res, 500, { error: 'interno', mensaje: /TURSO_DATABASE_URL/.test(e.message) ? e.message : undefined });
  }
}
