// Límite de solicitudes compartido entre instancias (todas las funciones de Vercel usan la misma base).
// Ventana fija por política y por origen. El contador se incrementa con una sola sentencia atómica
// (INSERT … ON CONFLICT … RETURNING), así que dos instancias no pueden «saltearse» el máximo.
// Las IPs nunca se guardan en claro: se usa un HMAC con el secreto del servidor.
import { createHmac } from 'node:crypto';

/** Políticas por ruta y nivel de riesgo: máximo de solicitudes por ventana. */
export const POLITICAS = Object.freeze({
  login_admin: { max: 5, ventanaMs: 15 * 60_000, alFallar: 'denegar' },
  admin: { max: 240, ventanaMs: 60_000 },
  partida: { max: 30, ventanaMs: 60_000 },
  // Visitantes nuevos registrados por IP (sin cookie). Pasado el máximo se juega igual, pero no se guarda la visita.
  visitante: { max: 30, ventanaMs: 10 * 60_000 },
  respuesta: { max: 90, ventanaMs: 60_000 },
  revelado: { max: 60, ventanaMs: 60_000 },
  reporte: { max: 20, ventanaMs: 10 * 60_000 },
  importar: { max: 20, ventanaMs: 60 * 60_000 },
  generar: { max: 10, ventanaMs: 60 * 60_000 },
  cron: { max: 30, ventanaMs: 60 * 60_000 },
});

export function crearLimitadorDistribuido({ db, secreto, politicas: base = POLITICAS, escala = 1, ahora = () => Date.now(), registro = null }) {
  // `escala` multiplica los máximos (solo para entornos de prueba que hacen muchas solicitudes desde una IP).
  const politicas = Object.fromEntries(Object.entries(base).map(([k, p]) => [k, { ...p, max: Math.max(1, Math.round(p.max * escala)) }]));
  const anonimizar = (ip) => createHmac('sha256', secreto).update(`ip:${ip || 'desconocida'}`).digest('base64url').slice(0, 32);

  /** Cuenta una solicitud. Devuelve { permitido, restantes, reintentarEn (segundos) }. */
  async function consumir(nombre, ip) {
    const p = politicas[nombre];
    if (!p) throw new Error(`Política de límite desconocida: ${nombre}`);
    const t = ahora();
    const ventana = Math.floor(t / p.ventanaMs);
    const finVentana = (ventana + 1) * p.ventanaMs;
    const origen = anonimizar(ip);
    try {
      const fila = await db.get(
        `INSERT INTO limites (clave, ventana, cuenta, vence_en) VALUES (?, ?, 1, ?)
         ON CONFLICT(clave) DO UPDATE SET
           cuenta = CASE WHEN limites.ventana = excluded.ventana THEN limites.cuenta + 1 ELSE 1 END,
           ventana = excluded.ventana,
           vence_en = excluded.vence_en
         RETURNING cuenta`,
        `${nombre}:${origen}`,
        ventana,
        finVentana,
      );
      const permitido = fila.cuenta <= p.max;
      const reintentarEn = Math.max(1, Math.ceil((finVentana - t) / 1000));
      if (!permitido && fila.cuenta === p.max + 1) registro?.warn('limite_excedido', { politica: nombre, origen, max: p.max, ventanaMs: p.ventanaMs });
      return { permitido, restantes: Math.max(0, p.max - fila.cuenta), reintentarEn };
    } catch (e) {
      // Si la base no responde: las rutas sensibles se niegan; el resto sigue (el juego no se cae por esto).
      registro?.error('limite_error', { politica: nombre, error: e });
      return { permitido: p.alFallar !== 'denegar', restantes: 0, reintentarEn: 30 };
    }
  }

  async function limpiar(t = ahora()) {
    const r = await db.run('DELETE FROM limites WHERE vence_en < ?', t);
    return r.changes;
  }

  return { consumir, limpiar, anonimizar };
}
