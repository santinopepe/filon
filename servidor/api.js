// Rutas HTTP del juego.
import { randomUUID } from 'node:crypto';
import { ErrorJuego } from './juego.js';
import { enviarJson, leerJson, leerCookies, crearFirmador, crearLimitador } from './http.js';
import { desafioPorFecha, preguntasDeDesafio, respuestasDePregunta, listarDesafios, sincronizarCaches } from './banco.js';
import { esFechaValida, fechaLocal, sumarDias } from './tiempo.js';
import { asegurarDesafio } from './generador/generar.js';

const COOKIE = 'filon_id';
const UUID = /^[0-9a-f-]{36}$/;

export function crearApi({ db, config, juego, secreto, contexto = null, ahora = () => Date.now() }) {
  const firmador = crearFirmador(secreto);
  const limitar = crearLimitador({ capacidad: 40, porSegundo: 8 });

  function identificar(req) {
    const valor = firmador.verificar(leerCookies(req)[COOKIE]);
    if (valor && UUID.test(valor)) return { jugadorId: valor, nueva: null };
    const id = randomUUID();
    const atributos = [`${COOKIE}=${encodeURIComponent(firmador.firmar(id))}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${400 * 86400}`];
    if (config.cookieSegura) atributos.push('Secure');
    return { jugadorId: id, nueva: atributos.join('; ') };
  }

  function ip(req) {
    if (config.confiarProxy) {
      const xff = req.headers['x-forwarded-for'];
      if (xff) return String(xff).split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'desconocida';
  }

  function esAdmin(req) {
    if (!config.tokenAdmin) return false;
    return req.headers.authorization === `Bearer ${config.tokenAdmin}`;
  }

  const esCron = (req) => (config.secretoCron && req.headers.authorization === `Bearer ${config.secretoCron}`) || esAdmin(req);

  const rutas = [
    ['GET', /^\/api\/salud$/, async () => {
      const hoy = fechaLocal(ahora(), config.zona);
      return { ok: true, fecha: hoy, desafioPublicado: Boolean(await desafioPorFecha(db, hoy)) };
    }, { publica: true }],
    ['GET', /^\/api\/estado$/, ({ jugadorId }) => juego.estado(jugadorId)],
    ['POST', /^\/api\/partidas$/, async ({ jugadorId }) => ({ partida: await juego.iniciarPartida(jugadorId) })],
    ['GET', /^\/api\/partidas\/([0-9a-f-]{36})$/, async ({ jugadorId, m }) => ({ partida: await juego.verPartida(jugadorId, m[1]) })],
    ['GET', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/respuestas$/, async ({ jugadorId, m }) => ({
      respuestas: await juego.respuestasValidas(jugadorId, m[1], Number(m[2])),
    })],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/iniciar$/, async ({ jugadorId, m }) => ({ partida: await juego.iniciarRonda(jugadorId, m[1], Number(m[2])) })],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/respuesta$/, ({ jugadorId, m, cuerpo }) => juego.responder(jugadorId, m[1], Number(m[2]), cuerpo.texto)],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/pasar$/, async ({ jugadorId, m }) => ({ partida: await juego.pasar(jugadorId, m[1], Number(m[2])) })],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/reporte$/, ({ jugadorId, m, cuerpo }) => juego.reportar(jugadorId, m[1], Number(m[2]), cuerpo.texto, cuerpo.comentario)],

    // Tarea diaria (Vercel Cron, ver vercel.json). Idempotente.
    //   hoy: asegura el desafío de hoy (IA si quedan intentos; si no, reserva)
    //   manana-ia: prepara mañana solo con IA (si falla queda pendiente)
    //   manana: prepara mañana; si la IA falla, publica la reserva
    ['GET', /^\/api\/cron\/(hoy|manana|manana-ia)$/, async ({ m }) => {
      if (!contexto) throw new ErrorJuego(503, 'sin_generador', 'La generación no está disponible.');
      const hoy = fechaLocal(ahora(), config.zona);
      const fecha = m[1] === 'hoy' ? hoy : sumarDias(hoy, 1);
      const r = await asegurarDesafio({ db, config, fecha, ...contexto, permitirReserva: m[1] !== 'manana-ia', ahora });
      console.info(`[cron] ${m[1]}: ${JSON.stringify(r)}`);
      return r;
    }, { cron: true }],

    // Administración (requiere TOKEN_ADMIN).
    ['GET', /^\/api\/admin\/reportes$/, async () => ({
      reportes: await db.all(
        `SELECT r.id, r.pregunta_id, p.enunciado, r.texto, r.comentario, r.estado, r.creado_en,
                (SELECT COUNT(*) FROM reportes r2 WHERE r2.pregunta_id = r.pregunta_id AND r2.normalizado = r.normalizado) AS veces
         FROM reportes r JOIN preguntas p ON p.id = r.pregunta_id ORDER BY r.creado_en DESC LIMIT 500`,
      ),
    }), { admin: true }],
    ['POST', /^\/api\/admin\/reportes\/(\d+)$/, async ({ m, cuerpo }) => {
      if (!['aceptado', 'descartado', 'pendiente'].includes(cuerpo.estado)) throw new ErrorJuego(400, 'estado_invalido', 'Estado inválido.');
      const r = await db.run('UPDATE reportes SET estado = ? WHERE id = ?', cuerpo.estado, Number(m[1]));
      if (!r.changes) throw new ErrorJuego(404, 'sin_reporte', 'No existe ese reporte.');
      return { ok: true };
    }, { admin: true }],
    ['GET', /^\/api\/admin\/desafios$/, async () => ({
      hoy: fechaLocal(ahora(), config.zona),
      ia: contexto?.proveedor ? { nombre: contexto.proveedor.nombre, modelo: contexto.proveedor.modelo } : null,
      desafios: await listarDesafios(db),
    }), { admin: true }],
    // Generar o regenerar un día a mano.
    //   modo: 'auto' (IA y, si falla, reserva) | 'ia' (solo IA; si falla no cambia nada) | 'reserva'
    //   reemplazar: true para regenerar un día que ya existe
    //   forzar: true si ese día ya tiene partidas (se borran junto con el desafío anterior)
    ['POST', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})\/generar$/, async ({ m, cuerpo }) => {
      const fecha = m[1];
      if (!esFechaValida(fecha)) throw new ErrorJuego(400, 'fecha_invalida', 'Fecha inválida.');
      if (!contexto) throw new ErrorJuego(503, 'sin_generador', 'La generación no está disponible.');
      const modo = cuerpo.modo ?? 'auto';
      if (!['auto', 'ia', 'reserva'].includes(modo)) throw new ErrorJuego(400, 'modo_invalido', 'El modo tiene que ser auto, ia o reserva.');
      if (modo === 'ia' && !contexto.proveedor) throw new ErrorJuego(400, 'sin_ia', 'La IA no está configurada (falta ANTHROPIC_API_KEY).');
      const existente = await desafioPorFecha(db, fecha);
      if (existente && !cuerpo.reemplazar) throw new ErrorJuego(409, 'ya_existe', `Ya hay un desafío para ${fecha}. Mandá reemplazar: true para regenerarlo.`);
      if (existente) {
        const { n } = await db.get('SELECT COUNT(*) AS n FROM partidas WHERE desafio_id = ?', existente.id);
        if (n && !cuerpo.forzar) {
          throw new ErrorJuego(409, 'hay_partidas', `Ese día ya tiene ${n} partida(s); al regenerarlo se borran. Mandá forzar: true para confirmar.`);
        }
      }
      const ctx = modo === 'reserva' ? { ...contexto, proveedor: null } : contexto;
      const r = await asegurarDesafio({ db, config, fecha, ...ctx, permitirReserva: modo !== 'ia', reemplazar: Boolean(existente), forzarIA: true, ahora });
      console.info(`[admin] generar ${fecha} (${modo}): ${JSON.stringify(r)}`);
      return r;
    }, { admin: true }],
    ['GET', /^\/api\/admin\/corridas$/, async () => ({
      corridas: (await db.all('SELECT id, fecha_objetivo, iniciada_en, terminada_en, resultado, uso_ia, detalle FROM corridas ORDER BY id DESC LIMIT 50'))
        .map((c) => ({ ...c, detalle: c.detalle ? JSON.parse(c.detalle) : null })),
    }), { admin: true }],
    ['GET', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})$/, async ({ m }) => {
      if (!esFechaValida(m[1])) throw new ErrorJuego(400, 'fecha_invalida', 'Fecha inválida.');
      const d = await desafioPorFecha(db, m[1]);
      if (!d) throw new ErrorJuego(404, 'sin_desafio', 'No hay desafío para esa fecha.');
      const preguntas = [];
      for (const p of await preguntasDeDesafio(db, d.id)) {
        preguntas.push({
          ...p,
          fuentes: JSON.parse(p.fuentes),
          rechazos: JSON.parse(p.rechazos),
          respuestas: (await respuestasDePregunta(db, p.id)).map((r) => ({ ...r, variantes: JSON.parse(r.variantes) })),
        });
      }
      return { desafio: d, preguntas };
    }, { admin: true }],
  ];

  return async function manejar(req, res, ruta) {
    const camino = ruta.split('?')[0];
    if (!camino.startsWith('/api/')) return false;
    await sincronizarCaches(db);
    if (!limitar(ip(req))) {
      enviarJson(res, 429, { error: 'demasiadas_solicitudes', mensaje: 'Vas muy rápido. Esperá un momento.' }, { 'retry-after': '2' });
      return true;
    }
    for (const [metodo, patron, fn, opciones = {}] of rutas) {
      const m = camino.match(patron);
      if (!m) continue;
      if (req.method !== metodo) {
        enviarJson(res, 405, { error: 'metodo_no_permitido' });
        return true;
      }
      if ((opciones.admin && !esAdmin(req)) || (opciones.cron && !esCron(req))) {
        enviarJson(res, 401, { error: 'no_autorizado' });
        return true;
      }
      const ident = opciones.publica || opciones.admin || opciones.cron ? { jugadorId: null, nueva: null } : identificar(req);
      const extra = ident.nueva ? { 'set-cookie': ident.nueva } : {};
      try {
        const cuerpo = metodo === 'POST' ? await leerJson(req) : {};
        const resultado = await fn({ jugadorId: ident.jugadorId, m, cuerpo, req });
        enviarJson(res, 200, resultado, extra);
      } catch (e) {
        if (e instanceof ErrorJuego) enviarJson(res, e.estado, { error: e.codigo, mensaje: e.message }, extra);
        else if (e.estado) enviarJson(res, e.estado, { error: 'solicitud_invalida', mensaje: e.message }, extra);
        else {
          console.error('[api]', e);
          enviarJson(res, 500, { error: 'interno', mensaje: 'Algo falló en el servidor.' }, extra);
        }
      }
      return true;
    }
    enviarJson(res, 404, { error: 'no_encontrado' });
    return true;
  };
}
