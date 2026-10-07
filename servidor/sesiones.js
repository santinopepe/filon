// Sesiones administrativas del lado del servidor.
// - El TOKEN_ADMIN solo viaja una vez, al iniciar sesión, y se compara en tiempo constante.
// - La sesión es un token opaco aleatorio en una cookie HttpOnly + SameSite=Strict (__Host- con HTTPS).
// - En la base se guarda solo un HMAC del token con el TOKEN_ADMIN como clave: una copia de la base no
//   permite usar sesiones, y al rotar el TOKEN_ADMIN todas las sesiones anteriores dejan de valer.
// - Vence por inactividad (renovable con la actividad) y por una vida máxima absoluta.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const sha256 = (texto) => createHash('sha256').update(String(texto)).digest();
const RENOVAR_CADA_MS = 60_000; // no escribir en la base en cada solicitud

/** Compara dos secretos en tiempo constante (también cuando difieren en longitud). */
export function secretoCoincide(candidato, esperado) {
  if (typeof candidato !== 'string' || !candidato || !esperado) return false;
  return timingSafeEqual(sha256(candidato), sha256(esperado));
}

export function crearSesionesAdmin({ db, config, ahora = () => Date.now() }) {
  const nombreCookie = config.cookieSegura ? '__Host-filon_admin' : 'filon_admin';
  const inactividad = config.admin.inactividadMs;
  const vidaMaxima = config.admin.vidaMaximaMs;
  // La sesión queda atada a la credencial con la que se abrió: con otro TOKEN_ADMIN el hash no coincide.
  const hash = (token) => createHmac('sha256', String(config.tokenAdmin)).update(token).digest('hex');

  const cookie = (valor, maxAgeMs) =>
    [
      `${nombreCookie}=${valor}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
      ...(config.cookieSegura ? ['Secure'] : []),
    ].join('; ');

  return {
    nombreCookie,

    async crear() {
      const t = ahora();
      const token = randomBytes(32).toString('base64url');
      await db.run(
        'INSERT INTO admin_sesiones (hash, creada_en, ultima_actividad, vence_en, vida_hasta) VALUES (?, ?, ?, ?, ?)',
        hash(token),
        t,
        t,
        Math.min(t + inactividad, t + vidaMaxima),
        t + vidaMaxima,
      );
      return { cookie: cookie(token, inactividad) };
    },

    /** Devuelve null si no hay sesión válida; si la hay, { renovar } con la cookie a reenviar (o null). */
    async validar(cookies) {
      const token = cookies[nombreCookie];
      if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
      const t = ahora();
      const fila = await db.get('SELECT ultima_actividad, vence_en, vida_hasta FROM admin_sesiones WHERE hash = ?', hash(token));
      if (!fila) return null;
      if (fila.vence_en <= t || fila.vida_hasta <= t) {
        await db.run('DELETE FROM admin_sesiones WHERE hash = ?', hash(token));
        return null;
      }
      if (t - fila.ultima_actividad < RENOVAR_CADA_MS) return { renovar: null };
      const vence = Math.min(t + inactividad, fila.vida_hasta);
      await db.run('UPDATE admin_sesiones SET ultima_actividad = ?, vence_en = ? WHERE hash = ?', t, vence, hash(token));
      return { renovar: cookie(token, vence - t) };
    },

    /** Revoca la sesión en el servidor. Devuelve la cookie que la borra en el navegador. */
    async revocar(cookies) {
      const token = cookies[nombreCookie];
      let revocada = false;
      if (token) revocada = (await db.run('DELETE FROM admin_sesiones WHERE hash = ?', hash(token))).changes > 0;
      return { revocada, cookie: cookie('', 0) };
    },

    async limpiar(t = ahora()) {
      return (await db.run('DELETE FROM admin_sesiones WHERE vence_en <= ? OR vida_hasta <= ?', t, t)).changes;
    },
  };
}
