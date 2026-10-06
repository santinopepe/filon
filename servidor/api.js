// Rutas HTTP del juego.
import { randomUUID } from 'node:crypto';
import { ErrorJuego } from './juego.js';
import { enviarJson, leerJson, leerCookies, crearFirmador, crearLimitador, ipCliente, CABECERAS_SEGURIDAD } from './http.js';
import { crearLimitadorDistribuido } from './limites.js';
import { crearSesionesAdmin, secretoCoincide } from './sesiones.js';
import { crearRegistro } from './registro.js';
import { limpiarDatos } from './limpieza.js';
import { historialDesde, historialACsv } from './historial.js';
import { analizarSimilitud } from './similitud.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ } from './config.js';

/** Marca para respuestas que no son JSON (descargas): { [CRUDO]: { tipo, cuerpo, archivo } }. */
const CRUDO = Symbol('crudo');
let promptGeneracion = null;
const leerPrompt = () => (promptGeneracion ??= readFileSync(resolve(RAIZ, 'datos/prompt-generacion.txt'), 'utf8'));
import { LIMITES, PREGUNTAS_POR_DESAFIO } from './dominio.js';
import {
  desafioPorFecha,
  preguntasDeDesafio,
  respuestasDePregunta,
  preguntasRecientes,
  publicarDesafio,
  listarDesafios,
  sincronizarCaches,
} from './banco.js';
import { esFechaValida, fechaLocal, sumarDias } from './tiempo.js';
import { asegurarDesafio } from './generador/generar.js';
import { estadisticasAdmin } from './estadisticas.js';
import { validarPregunta, validarLote } from './validacion.js';

const COOKIE = 'filon_id';
const UUID = /^[0-9a-f-]{36}$/;

export function crearApi({ db, config, juego, secreto, contexto = null, ahora = () => Date.now(), registro = crearRegistro() }) {
  const firmador = crearFirmador(secreto);
  // Primera barrera, en memoria y por instancia (barata). La protección real es la distribuida.
  const escala = config.limitesEscala ?? 1;
  const limitar = crearLimitador({ capacidad: 40 * escala, porSegundo: 8 * escala });
  const limites = crearLimitadorDistribuido({ db, secreto, ahora, registro, escala: config.limitesEscala });
  const sesiones = crearSesionesAdmin({ db, config, ahora });

  function identificar(req, cookies) {
    const valor = firmador.verificar(cookies[COOKIE]);
    if (valor && UUID.test(valor)) return { jugadorId: valor, nueva: null };
    const id = randomUUID();
    const atributos = [`${COOKIE}=${encodeURIComponent(firmador.firmar(id))}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${400 * 86400}`];
    if (config.cookieSegura) atributos.push('Secure');
    return { jugadorId: id, nueva: atributos.join('; ') };
  }

  const ip = (req) => ipCliente(req, config);
  const bearer = (req) => {
    const a = String(req.headers.authorization || '');
    return a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  };

  /** Sesión del panel (cookie) o, durante la transición, Bearer TOKEN_ADMIN. Devuelve null si no autoriza. */
  async function autorizarAdmin(req, cookies) {
    if (!config.tokenAdmin) return null;
    const sesion = await sesiones.validar(cookies);
    if (sesion) return { via: 'sesion', renovar: sesion.renovar };
    if (config.admin.permitirBearer && secretoCoincide(bearer(req), config.tokenAdmin)) return { via: 'bearer', renovar: null };
    return null;
  }

  const esCron = async (req, cookies) =>
    secretoCoincide(bearer(req), config.secretoCron) || Boolean(await autorizarAdmin(req, cookies));

  // Defensa adicional contra CSRF (además de SameSite=Strict) para cambios hechos con la cookie de sesión.
  const mismoOrigen = (req) => {
    const origen = req.headers.origin;
    if (!origen) return true;
    try {
      return new URL(origen).host === req.headers.host;
    } catch {
      return false;
    }
  };

  const rutas = [
    ['GET', /^\/api\/salud$/, async () => {
      const hoy = fechaLocal(ahora(), config.zona);
      return { ok: true, fecha: hoy, desafioPublicado: Boolean(await desafioPorFecha(db, hoy)) };
    }, { publica: true }],
    ['GET', /^\/api\/estado$/, ({ jugadorId }) => juego.estado(jugadorId)],
    ['POST', /^\/api\/partidas$/, async ({ jugadorId }) => ({ partida: await juego.iniciarPartida(jugadorId) }), { limite: 'partida' }],
    ['GET', /^\/api\/partidas\/([0-9a-f-]{36})$/, async ({ jugadorId, m }) => ({ partida: await juego.verPartida(jugadorId, m[1]) })],
    // Revelado paginado: ?desde=0&limite=100&buscar=texto (limite ≤ LIMITES.paginaRevelado).
    ['GET', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/respuestas$/, async ({ jugadorId, m, req }) => {
      const q = new URL(req.url, 'http://local').searchParams;
      const desde = Math.max(0, Math.floor(Number(q.get('desde')) || 0));
      const limite = Math.min(LIMITES.paginaRevelado, Math.max(1, Math.floor(Number(q.get('limite')) || LIMITES.paginaRevelado)));
      const buscar = String(q.get('buscar') || '').slice(0, 60);
      return juego.respuestasValidas(jugadorId, m[1], Number(m[2]), { desde, limite, buscar });
    }, { limite: 'revelado' }],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/iniciar$/, async ({ jugadorId, m }) => ({ partida: await juego.iniciarRonda(jugadorId, m[1], Number(m[2])) })],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/respuesta$/, ({ jugadorId, m, cuerpo }) => juego.responder(jugadorId, m[1], Number(m[2]), cuerpo.texto), { limite: 'respuesta' }],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/pasar$/, async ({ jugadorId, m }) => ({ partida: await juego.pasar(jugadorId, m[1], Number(m[2])) })],
    ['POST', /^\/api\/partidas\/([0-9a-f-]{36})\/rondas\/([1-7])\/reporte$/, ({ jugadorId, m, cuerpo }) => juego.reportar(jugadorId, m[1], Number(m[2]), cuerpo.texto, cuerpo.comentario), { limite: 'reporte' }],

    // ───────── Sesión del panel de administración ─────────
    ['POST', /^\/api\/admin\/sesion$/, async ({ cuerpo, req, cabeceras }) => {
      if (!config.tokenAdmin) throw new ErrorJuego(503, 'admin_deshabilitado', 'El panel está deshabilitado: falta TOKEN_ADMIN.');
      const origen = limites.anonimizar(ip(req));
      if (!secretoCoincide(cuerpo.token, config.tokenAdmin)) {
        registro.warn('admin_login_fallido', { origen });
        throw new ErrorJuego(401, 'credenciales_invalidas', 'Token incorrecto.');
      }
      await sesiones.limpiar();
      cabeceras['set-cookie'] = (await sesiones.crear()).cookie;
      registro.info('admin_login', { origen });
      return { ok: true, inactividadMin: config.admin.inactividadMs / 60_000 };
    }, { publica: true, limite: 'login_admin', soloMismoOrigen: true }],
    ['GET', /^\/api\/admin\/sesion$/, async ({ cookies, cabeceras }) => {
      const sesion = config.tokenAdmin ? await sesiones.validar(cookies) : null;
      if (sesion?.renovar) cabeceras['set-cookie'] = sesion.renovar;
      return { autenticado: Boolean(sesion), habilitado: Boolean(config.tokenAdmin) };
    }, { publica: true }],
    ['DELETE', /^\/api\/admin\/sesion$/, async ({ cookies, cabeceras, req }) => {
      const { revocada, cookie } = await sesiones.revocar(cookies);
      cabeceras['set-cookie'] = cookie;
      registro.info('admin_logout', { revocada, origen: limites.anonimizar(ip(req)) });
      return { ok: true };
    }, { publica: true, soloMismoOrigen: true }],

    // Tarea diaria (Vercel Cron, ver vercel.json). Idempotente.
    //   hoy: asegura el desafío de hoy (IA si quedan intentos; si no, reserva)
    //   manana-ia: prepara mañana solo con IA (si falla queda pendiente)
    //   manana: prepara mañana; si la IA falla, publica la reserva
    ['GET', /^\/api\/cron\/(hoy|manana|manana-ia)$/, async ({ m }) => {
      if (!contexto) throw new ErrorJuego(503, 'sin_generador', 'La generación no está disponible.');
      const hoy = fechaLocal(ahora(), config.zona);
      const fecha = m[1] === 'hoy' ? hoy : sumarDias(hoy, 1);
      const inicio = Date.now();
      const r = await asegurarDesafio({ db, config, fecha, ...contexto, permitirReserva: m[1] !== 'manana-ia', ahora, registro });
      registro[r.resultado === 'fallo' ? 'error' : 'info']('cron', { tarea: m[1], fecha, resultado: r.resultado, origen: r.origen, duracionMs: Date.now() - inicio, error: r.error });
      return r;
    }, { cron: true, limite: 'cron' }],
    // Limpieza diaria: sesiones y límites vencidos, retención de datos y conciliación de estadísticas.
    ['GET', /^\/api\/cron\/limpieza$/, async () => {
      const inicio = Date.now();
      const r = await limpiarDatos({ db, config, ahora, sesiones, limites });
      registro.info('cron', { tarea: 'limpieza', duracionMs: Date.now() - inicio, ...r });
      return r;
    }, { cron: true, limite: 'cron' }],

    // Administración (requiere TOKEN_ADMIN).
    ['GET', /^\/api\/admin\/reportes$/, async () => ({
      reportes: await db.all(
        `SELECT r.id, r.pregunta_id, p.enunciado, r.texto, r.comentario, r.estado, r.creado_en,
                (SELECT COUNT(*) FROM reportes r2 WHERE r2.pregunta_id = r.pregunta_id AND r2.normalizado = r.normalizado) AS veces
         FROM reportes r JOIN preguntas p ON p.id = r.pregunta_id ORDER BY r.creado_en DESC LIMIT ?`,
        LIMITES.paginaReportes,
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
      bd: /^(libsql|https?|wss?):/.test(config.rutaBD) ? new URL(config.rutaBD).host : 'archivo local',
      desafios: await listarDesafios(db),
    }), { admin: true }],
    // Publica un día pegado como JSON, con el mismo formato de datos/reserva.json.
    // No llama a ningún proveedor de IA ni verifica fuentes por red: solo aplica las validaciones
    // estructurales locales y publica las siete preguntas en una transacción.
    ['POST', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})\/importar$/, async ({ m, cuerpo }) => {
      const fecha = m[1];
      if (!esFechaValida(fecha)) throw new ErrorJuego(400, 'fecha_invalida', 'Fecha inválida.');
      if (!Array.isArray(cuerpo.preguntas)) {
        throw new ErrorJuego(400, 'json_invalido', 'El JSON debe ser un arreglo o un objeto con una propiedad «preguntas».');
      }
      if (cuerpo.preguntas.length > PREGUNTAS_POR_DESAFIO) {
        const error = new ErrorJuego(422, 'desafio_invalido', `El día lleva exactamente ${PREGUNTAS_POR_DESAFIO} preguntas. No se guardó nada.`);
        error.detalles = { errores: [`El lote debe tener ${PREGUNTAS_POR_DESAFIO} preguntas (llegaron ${cuerpo.preguntas.length}).`], preguntas: [] };
        throw error;
      }
      const larga = cuerpo.preguntas.findIndex((p) => Array.isArray(p?.respuestas) && p.respuestas.length > LIMITES.respuestasPorPregunta);
      if (larga >= 0) {
        throw new ErrorJuego(413, 'demasiadas_respuestas', `La pregunta ${larga + 1} supera el máximo de ${LIMITES.respuestasPorPregunta} respuestas.`);
      }

      const existente = await desafioPorFecha(db, fecha);
      if (existente && !cuerpo.reemplazar && !cuerpo.soloValidar) {
        throw new ErrorJuego(409, 'ya_existe', `Ya hay un desafío para ${fecha}. Confirmá el reemplazo para sobrescribirlo.`);
      }
      if (existente && !cuerpo.soloValidar) {
        const { n } = await db.get('SELECT COUNT(*) AS n FROM partidas WHERE desafio_id = ?', existente.id);
        if (n && !cuerpo.forzar) {
          throw new ErrorJuego(409, 'hay_partidas', `Ese día ya tiene ${n} partida(s); al reemplazarlo se borran.`);
        }
      }

      const recientes = await preguntasRecientes(db, fecha, config.diasSinRepetir);
      const preguntas = [];
      const detalles = [];
      for (const [i, entrada] of cuerpo.preguntas.entries()) {
        const candidata = { ...entrada, id: entrada?.id || `manual-${fecha}-p${i + 1}` };
        const validacion = validarPregunta(candidata, { dominios: config.fuentes.dominios, recientes, estricta: true });
        detalles.push({
          posicion: i + 1,
          enunciado: candidata.enunciado || '',
          errores: validacion.errores,
          advertencias: validacion.advertencias,
          descartadas: validacion.descartadas,
        });
        if (validacion.ok) preguntas.push({ ...validacion.pregunta, origen: 'reserva' });
      }

      const lote = preguntas.length === cuerpo.preguntas.length ? validarLote(preguntas) : { ok: false, errores: [] };
      const errores = detalles.flatMap((d) => d.errores.map((error) => `Pregunta ${d.posicion}: ${error}`));
      errores.push(...lote.errores);

      // Similitud con las preguntas de los últimos N días (incluye los ya programados) y dentro del lote.
      const diasSimilitud = Math.min(30, Math.max(1, Math.floor(Number(cuerpo.diasSimilitud)) || config.similitudDias));
      const hoy = fechaLocal(ahora(), config.zona);
      const historial = (await historialDesde(db, sumarDias(hoy, -(diasSimilitud - 1)))).filter((p) => p.fecha !== fecha);
      const similitudes = analizarSimilitud(cuerpo.preguntas, historial);
      const avisosSimilitud = [];
      for (const s of similitudes) {
        for (const c of s.coincidencias) {
          const contra = c.origen === 'lote' ? `la pregunta ${c.posicion} de este mismo JSON` : `«${c.enunciado}» del ${c.fecha}`;
          if (c.nivel === 'repetida') errores.push(`Pregunta ${s.posicion}: repite ${contra} (${c.motivo}).`);
          else avisosSimilitud.push(`Pregunta ${s.posicion}: se parece a ${contra} (${c.motivo}).`);
        }
      }

      if (errores.length) {
        const error = new ErrorJuego(422, 'desafio_invalido', `El JSON tiene ${errores.length} problema(s). No se guardó nada.`);
        error.detalles = { errores, advertencias: avisosSimilitud, preguntas: detalles, similitudes, diasSimilitud };
        throw error;
      }
      const advertencias = [...avisosSimilitud, ...detalles.flatMap((d) => d.advertencias.map((aviso) => `Pregunta ${d.posicion}: ${aviso}`))];
      if (cuerpo.soloValidar) return { resultado: 'valido', fecha, advertencias, similitudes, diasSimilitud };

      const publicado = await publicarDesafio(db, {
        fecha,
        preguntas,
        origen: 'reserva',
        modelo: 'manual',
        reemplazar: Boolean(existente),
        ahora: ahora(),
      });
      if (!publicado.publicado) throw new ErrorJuego(409, 'ya_existe', `Otro proceso publicó ${fecha} antes que esta carga.`);
      return {
        ...publicado,
        resultado: existente ? 'reemplazado' : 'publicado',
        origen: 'manual',
        advertencias,
        similitudes,
        diasSimilitud,
      };
    }, { admin: true, limiteJson: LIMITES.cuerpoImportacion, limite: 'importar' }],
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
      const r = await asegurarDesafio({ db, config, fecha, ...ctx, permitirReserva: modo !== 'ia', reemplazar: Boolean(existente), forzarIA: true, ahora, registro });
      registro.info('admin_generar', { fecha, modo, resultado: r.resultado, origen: r.origen, corridaId: r.corridaId });
      return r;
    }, { admin: true, limite: 'generar' }],
    // Estadísticas: ?fecha=AAAA-MM-DD (día en detalle) &desde=…&hasta=… (serie diaria, hasta 366 días).
    ['GET', /^\/api\/admin\/estadisticas$/, async ({ req }) => {
      const q = new URL(req.url, 'http://local').searchParams;
      const hoy = fechaLocal(ahora(), config.zona);
      const fecha = q.get('fecha') || hoy;
      const hasta = q.get('hasta') || hoy;
      const desde = q.get('desde') || sumarDias(hasta, -29);
      for (const f of [fecha, desde, hasta]) if (!esFechaValida(f)) throw new ErrorJuego(400, 'fecha_invalida', `Fecha inválida: ${f}`);
      if (desde > hasta) throw new ErrorJuego(400, 'rango_invalido', 'El rango está invertido.');
      if (sumarDias(desde, 366) < hasta) throw new ErrorJuego(400, 'rango_invalido', 'El rango no puede superar un año.');
      return { hoy, ...(await estadisticasAdmin(db, { zona: config.zona, desde, hasta, fecha })) };
    }, { admin: true }],
    // Historial para que una IA externa no repita preguntas: ?dias=3 (1–30) &formato=json|csv.
    // Incluye desde hace N-1 días hasta los días ya programados a futuro.
    ['GET', /^\/api\/admin\/historial$/, async ({ req }) => {
      const q = new URL(req.url, 'http://local').searchParams;
      const dias = Math.min(30, Math.max(1, Math.floor(Number(q.get('dias')) || 3)));
      const formato = q.get('formato') === 'csv' ? 'csv' : 'json';
      const hoy = fechaLocal(ahora(), config.zona);
      const desde = sumarDias(hoy, -(dias - 1));
      const preguntas = await historialDesde(db, desde);
      const archivo = `filon-historial-${desde}-${dias}d.${formato}`;
      if (formato === 'csv') return { [CRUDO]: { tipo: 'text/csv; charset=utf-8', cuerpo: historialACsv(preguntas), archivo } };
      const cuerpo = JSON.stringify({ desde, dias, generado: new Date(ahora()).toISOString(), preguntas }, null, 2);
      return { [CRUDO]: { tipo: 'application/json; charset=utf-8', cuerpo, archivo } };
    }, { admin: true }],
    // Prompt para generar un día con una IA externa (se copia desde el panel).
    ['GET', /^\/api\/admin\/prompt$/, async () => ({ texto: leerPrompt() }), { admin: true }],
    ['GET', /^\/api\/admin\/corridas$/, async () => ({
      corridas: (await db.all('SELECT id, fecha_objetivo, iniciada_en, terminada_en, resultado, uso_ia, detalle FROM corridas ORDER BY id DESC LIMIT ?', LIMITES.paginaCorridas))
        .map((c) => ({ ...c, detalle: c.detalle ? JSON.parse(c.detalle) : null })),
    }), { admin: true }],
    ['GET', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})$/, async ({ m }) => {
      if (!esFechaValida(m[1])) throw new ErrorJuego(400, 'fecha_invalida', 'Fecha inválida.');
      const d = await desafioPorFecha(db, m[1]);
      if (!d) throw new ErrorJuego(404, 'sin_desafio', 'No hay desafío para esa fecha.');
      const preguntas = [];
      for (const p of await preguntasDeDesafio(db, d.id)) {
        // Las respuestas más valiosas primero y con tope: una pregunta de Wikidata puede tener 1.500.
        const todas = [...(await respuestasDePregunta(db, p.id))].sort((a, b) => b.puntos - a.puntos || a.id - b.id);
        preguntas.push({
          ...p,
          fuentes: JSON.parse(p.fuentes),
          rechazos: JSON.parse(p.rechazos),
          totalRespuestas: todas.length,
          respuestas: todas.slice(0, LIMITES.respuestasEnDetalleAdmin).map((r) => ({ ...r, variantes: JSON.parse(r.variantes) })),
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
    let ruta_ = null;
    let m = null;
    let existeCamino = false;
    for (const r of rutas) {
      const coincide = camino.match(r[1]);
      if (!coincide) continue;
      existeCamino = true;
      if (r[0] === req.method) {
        ruta_ = r;
        m = coincide;
        break;
      }
    }
    if (!ruta_) {
      enviarJson(res, existeCamino ? 405 : 404, { error: existeCamino ? 'metodo_no_permitido' : 'no_encontrado' });
      return true;
    }
    const [metodo, , fn, opciones = {}] = ruta_;
    const cookies = leerCookies(req);
    const cabeceras = {};
    try {
      if (opciones.admin) {
        const auth = await autorizarAdmin(req, cookies);
        if (!auth) {
          registro.warn('admin_no_autorizado', { ruta: camino, metodo });
          enviarJson(res, 401, { error: 'no_autorizado' });
          return true;
        }
        if (auth.via === 'sesion' && metodo !== 'GET' && !mismoOrigen(req)) {
          registro.warn('admin_origen_rechazado', { ruta: camino, metodo });
          enviarJson(res, 403, { error: 'origen_invalido' });
          return true;
        }
        if (auth.renovar) cabeceras['set-cookie'] = auth.renovar;
      }
      if (opciones.soloMismoOrigen && !mismoOrigen(req)) {
        registro.warn('origen_rechazado', { ruta: camino, metodo });
        enviarJson(res, 403, { error: 'origen_invalido' });
        return true;
      }
      if (opciones.cron && !(await esCron(req, cookies))) {
        registro.warn('cron_no_autorizado', { ruta: camino });
        enviarJson(res, 401, { error: 'no_autorizado' });
        return true;
      }
      const politica = opciones.limite ?? (opciones.admin ? 'admin' : null);
      if (politica) {
        const l = await limites.consumir(politica, ip(req));
        if (!l.permitido) {
          enviarJson(res, 429, { error: 'demasiadas_solicitudes', mensaje: 'Demasiados intentos. Esperá un momento.' }, { 'retry-after': String(l.reintentarEn) });
          return true;
        }
      }
    } catch (e) {
      registro.error('error_5xx', { ruta: camino, metodo, etapa: 'autorizacion', error: e });
      enviarJson(res, 500, { error: 'interno', mensaje: 'Algo falló en el servidor.' });
      return true;
    }
    const ident = opciones.publica || opciones.admin || opciones.cron ? { jugadorId: null, nueva: null } : identificar(req, cookies);
    if (ident.nueva) cabeceras['set-cookie'] = ident.nueva;
    try {
      const cuerpo = metodo === 'POST' ? await leerJson(req, opciones.limiteJson ?? LIMITES.cuerpoJson) : {};
      const resultado = await fn({ jugadorId: ident.jugadorId, m, cuerpo, req, cookies, cabeceras });
      if (resultado?.[CRUDO]) {
        const { tipo, cuerpo: datos, archivo } = resultado[CRUDO];
        res.writeHead(200, {
          ...CABECERAS_SEGURIDAD,
          'content-type': tipo,
          'cache-control': 'no-store',
          'content-disposition': `attachment; filename="${archivo}"`,
          ...cabeceras,
        });
        res.end(datos);
        return true;
      }
      enviarJson(res, 200, resultado, cabeceras);
    } catch (e) {
      if (e instanceof ErrorJuego) enviarJson(res, e.estado, { error: e.codigo, mensaje: e.message, ...(e.detalles ? { detalles: e.detalles } : {}) }, cabeceras);
      else if (e.estado) enviarJson(res, e.estado, { error: 'solicitud_invalida', mensaje: e.message }, cabeceras);
      else {
        registro.error('error_5xx', { ruta: camino, metodo, error: e, pila: e.stack });
        enviarJson(res, 500, { error: 'interno', mensaje: 'Algo falló en el servidor.' }, cabeceras);
      }
    }
    return true;
  };
}
