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
import { LIMITES, PREGUNTAS_POR_DESAFIO, MODOS, CLAVES_MODOS, MODO_POR_DEFECTO, esModo } from './dominio.js';

/** Modo de juego pedido (query o cuerpo). Sin valor es Normal; un valor desconocido es un error. */
function leerModo(valor) {
  if (valor == null || valor === '') return MODO_POR_DEFECTO;
  if (!esModo(valor)) throw new ErrorJuego(400, 'modo_invalido', `Modo de juego desconocido: «${String(valor).slice(0, 40)}». Los válidos son ${CLAVES_MODOS.join(', ')}.`);
  return valor;
}
const consulta = (req) => new URL(req.url, 'http://local').searchParams;
const modoDe = (req) => leerModo(consulta(req).get('modo'));
import {
  desafioPorFecha,
  preguntasDeDesafio,
  respuestasDePregunta,
  preguntasRecientes,
  publicarDesafio,
  listarDesafios,
  sincronizarCaches,
  preguntaParaEditar,
  editarPregunta,
  usosDeReserva,
} from './banco.js';
import { guardarEnReserva, reservaCompleta, cambiarEstadoReserva, aFormatoReserva } from './generador/reserva.js';
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
  // Banco de reserva de archivo de cada modo (la base suma lo guardado y editado desde el panel).
  const reservaArchivo = (modo) => contexto?.reservas?.[modo] ?? (modo === MODO_POR_DEFECTO ? contexto?.reserva : null) ?? { preguntas: [] };

  /** Valida una pregunta escrita en el panel (formato de reserva), en modo estricto y para su modo. */
  function validarEdicion(entrada, modo, { categoria = null } = {}) {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw new ErrorJuego(400, 'pregunta_invalida', 'Falta la pregunta.');
    const candidata = { ...entrada, ...(categoria ? { categoria } : {}) };
    if (MODOS[modo].categorias.length === 1 && !candidata.categoria) candidata.categoria = MODOS[modo].categorias[0];
    const v = validarPregunta(candidata, { dominios: config.fuentes.dominios, estricta: true, modo });
    if (!v.ok) {
      const error = new ErrorJuego(422, 'pregunta_invalida', `La pregunta tiene ${v.errores.length} problema(s). No se guardó nada.`);
      error.detalles = { errores: v.errores, advertencias: v.advertencias, descartadas: v.descartadas };
      throw error;
    }
    return v;
  }

  const prompts = new Map();
  const leerPrompt = (modo) => {
    if (!prompts.has(modo)) prompts.set(modo, readFileSync(config.rutasPrompt?.[modo] ?? resolve(RAIZ, 'datos/prompt-generacion.txt'), 'utf8'));
    return prompts.get(modo);
  };

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
      const modos = {};
      for (const modo of CLAVES_MODOS) modos[modo] = Boolean(await desafioPorFecha(db, hoy, modo));
      return { ok: true, fecha: hoy, desafioPublicado: modos[MODO_POR_DEFECTO], modos };
    }, { publica: true }],
    // ?modo=normal|farandula|geografia (por defecto, normal).
    ['GET', /^\/api\/estado$/, ({ jugadorId, req }) => juego.estado(jugadorId, modoDe(req))],
    ['POST', /^\/api\/partidas$/, async ({ jugadorId, cuerpo }) => ({ partida: await juego.iniciarPartida(jugadorId, leerModo(cuerpo.modo)) }), { limite: 'partida' }],
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
    //   hoy: asegura el desafío de hoy de cada modo (Normal con IA si quedan intentos; si no, reserva)
    //   manana-ia: prepara mañana solo con IA, solo el modo Normal (si falla queda pendiente)
    //   manana: prepara mañana de cada modo; si la IA falla, publica la reserva
    // La respuesta es la de Normal, con el resultado de cada modo en `modos`.
    ['GET', /^\/api\/cron\/(hoy|manana|manana-ia)$/, async ({ m }) => {
      if (!contexto) throw new ErrorJuego(503, 'sin_generador', 'La generación no está disponible.');
      const hoy = fechaLocal(ahora(), config.zona);
      const fecha = m[1] === 'hoy' ? hoy : sumarDias(hoy, 1);
      const modos = {};
      for (const modo of CLAVES_MODOS) {
        if (m[1] === 'manana-ia' && !MODOS[modo].iaAutomatica) continue;
        const inicio = Date.now();
        const r = await asegurarDesafio({ db, config, fecha, modo, ...contexto, permitirReserva: m[1] !== 'manana-ia', ahora, registro });
        registro[r.resultado === 'fallo' ? 'error' : 'info']('cron', { tarea: m[1], fecha, modo, resultado: r.resultado, origen: r.origen, duracionMs: Date.now() - inicio, error: r.error });
        modos[modo] = r;
      }
      return { ...modos[MODO_POR_DEFECTO], modos };
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
        `SELECT r.id, r.pregunta_id, p.enunciado, d.modo, r.texto, r.comentario, r.estado, r.creado_en,
                (SELECT COUNT(*) FROM reportes r2 WHERE r2.pregunta_id = r.pregunta_id AND r2.normalizado = r.normalizado) AS veces
         FROM reportes r JOIN preguntas p ON p.id = r.pregunta_id JOIN desafios d ON d.id = p.desafio_id
         ORDER BY r.creado_en DESC LIMIT ?`,
        LIMITES.paginaReportes,
      ),
    }), { admin: true }],
    ['POST', /^\/api\/admin\/reportes\/(\d+)$/, async ({ m, cuerpo }) => {
      if (!['aceptado', 'descartado', 'pendiente'].includes(cuerpo.estado)) throw new ErrorJuego(400, 'estado_invalido', 'Estado inválido.');
      const r = await db.run('UPDATE reportes SET estado = ? WHERE id = ?', cuerpo.estado, Number(m[1]));
      if (!r.changes) throw new ErrorJuego(404, 'sin_reporte', 'No existe ese reporte.');
      return { ok: true };
    }, { admin: true }],
    // En todas las rutas de administración de desafíos, ?modo= elige el modo de juego (por defecto, normal).
    ['GET', /^\/api\/admin\/desafios$/, async ({ req }) => {
      const modo = modoDe(req);
      return {
        hoy: fechaLocal(ahora(), config.zona),
        modo,
        modos: CLAVES_MODOS.map((clave) => ({ clave, nombre: MODOS[clave].nombre, iaAutomatica: MODOS[clave].iaAutomatica })),
        ia: contexto?.proveedor ? { nombre: contexto.proveedor.nombre, modelo: contexto.proveedor.modelo } : null,
        bd: /^(libsql|https?|wss?):/.test(config.rutaBD) ? new URL(config.rutaBD).host : 'archivo local',
        desafios: await listarDesafios(db, { modo }),
      };
    }, { admin: true }],
    // Publica un día pegado como JSON, con el mismo formato de datos/reserva.json.
    // No llama a ningún proveedor de IA ni verifica fuentes por red: solo aplica las validaciones
    // estructurales locales y publica las siete preguntas en una transacción.
    // En los modos temáticos, una pregunta sin «categoria» toma la del modo.
    ['POST', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})\/importar$/, async ({ m, cuerpo, req }) => {
      const fecha = m[1];
      if (!esFechaValida(fecha)) throw new ErrorJuego(400, 'fecha_invalida', 'Fecha inválida.');
      const modo = modoDe(req);
      const { categorias } = MODOS[modo];
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

      const existente = await desafioPorFecha(db, fecha, modo);
      if (existente && !cuerpo.reemplazar && !cuerpo.soloValidar) {
        throw new ErrorJuego(409, 'ya_existe', `Ya hay un desafío de ${MODOS[modo].nombre} para ${fecha}. Confirmá el reemplazo para sobrescribirlo.`);
      }
      if (existente && !cuerpo.soloValidar) {
        const { n } = await db.get('SELECT COUNT(*) AS n FROM partidas WHERE desafio_id = ?', existente.id);
        if (n && !cuerpo.forzar) {
          throw new ErrorJuego(409, 'hay_partidas', `Ese día ya tiene ${n} partida(s); al reemplazarlo se borran.`);
        }
      }

      const recientes = await preguntasRecientes(db, fecha, config.diasSinRepetir, modo);
      const preguntas = [];
      const detalles = [];
      const prefijo = modo === MODO_POR_DEFECTO ? 'manual' : `manual-${modo}`;
      for (const [i, entrada] of cuerpo.preguntas.entries()) {
        const candidata = { ...entrada, id: entrada?.id || `${prefijo}-${fecha}-p${i + 1}` };
        if (categorias.length === 1 && !candidata.categoria) candidata.categoria = categorias[0];
        const validacion = validarPregunta(candidata, { dominios: config.fuentes.dominios, recientes, estricta: true, modo });
        detalles.push({
          posicion: i + 1,
          enunciado: candidata.enunciado || '',
          errores: validacion.errores,
          advertencias: validacion.advertencias,
          descartadas: validacion.descartadas,
        });
        if (validacion.ok) preguntas.push({ ...validacion.pregunta, origen: 'reserva' });
      }

      const lote = preguntas.length === cuerpo.preguntas.length ? validarLote(preguntas, modo) : { ok: false, errores: [] };
      const errores = detalles.flatMap((d) => d.errores.map((error) => `Pregunta ${d.posicion}: ${error}`));
      errores.push(...lote.errores);

      // Similitud con las preguntas de los últimos N días (incluye los ya programados) y dentro del lote.
      const diasSimilitud = Math.min(30, Math.max(1, Math.floor(Number(cuerpo.diasSimilitud)) || config.similitudDias));
      const hoy = fechaLocal(ahora(), config.zona);
      const historial = (await historialDesde(db, sumarDias(hoy, -(diasSimilitud - 1)), { modo })).filter((p) => p.fecha !== fecha);
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
      if (cuerpo.soloValidar) return { resultado: 'valido', fecha, modo, advertencias, similitudes, diasSimilitud };

      const publicado = await publicarDesafio(db, {
        fecha,
        modo,
        preguntas,
        origen: 'reserva',
        modelo: 'manual',
        reemplazar: Boolean(existente),
        ahora: ahora(),
      });
      if (!publicado.publicado) throw new ErrorJuego(409, 'ya_existe', `Otro proceso publicó ${fecha} antes que esta carga.`);
      // Todo lo que se carga queda también en la reserva del modo, para poder reutilizarlo.
      const idsArchivo = new Set(reservaArchivo(modo).preguntas.map((p) => p.id));
      const enReserva = await guardarEnReserva(db, modo, preguntas, { origen: 'manual', idsArchivo, ahora: ahora() });
      return {
        ...publicado,
        enReserva,
        resultado: existente ? 'reemplazado' : 'publicado',
        modo,
        origen: 'manual',
        advertencias,
        similitudes,
        diasSimilitud,
      };
    }, { admin: true, limiteJson: LIMITES.cuerpoImportacion, limite: 'importar' }],
    // Generar o regenerar un día a mano. ?modo= es el modo de juego; en el cuerpo:
    //   modo: estrategia de generación, 'auto' (IA y, si falla, reserva) | 'ia' (solo IA; si falla no
    //         cambia nada) | 'reserva'. Los modos temáticos no tienen IA automática: solo 'reserva'
    //         (o 'auto', que en ellos es lo mismo).
    //   reemplazar: true para regenerar un día que ya existe
    //   forzar: true si ese día ya tiene partidas (se borran junto con el desafío anterior)
    ['POST', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})\/generar$/, async ({ m, cuerpo, req }) => {
      const fecha = m[1];
      if (!esFechaValida(fecha)) throw new ErrorJuego(400, 'fecha_invalida', 'Fecha inválida.');
      if (!contexto) throw new ErrorJuego(503, 'sin_generador', 'La generación no está disponible.');
      const modoJuego = modoDe(req);
      const modo = cuerpo.modo ?? 'auto';
      if (!['auto', 'ia', 'reserva'].includes(modo)) throw new ErrorJuego(400, 'modo_invalido', 'El modo tiene que ser auto, ia o reserva.');
      if (modo === 'ia' && !MODOS[modoJuego].iaAutomatica) {
        throw new ErrorJuego(400, 'sin_ia', `${MODOS[modoJuego].nombre} no se genera con la IA automática: usá la reserva o cargá un JSON hecho con su prompt.`);
      }
      if (modo === 'ia' && !contexto.proveedor) throw new ErrorJuego(400, 'sin_ia', 'La IA no está configurada (falta ANTHROPIC_API_KEY).');
      const existente = await desafioPorFecha(db, fecha, modoJuego);
      if (existente && !cuerpo.reemplazar) throw new ErrorJuego(409, 'ya_existe', `Ya hay un desafío de ${MODOS[modoJuego].nombre} para ${fecha}. Mandá reemplazar: true para regenerarlo.`);
      if (existente) {
        const { n } = await db.get('SELECT COUNT(*) AS n FROM partidas WHERE desafio_id = ?', existente.id);
        if (n && !cuerpo.forzar) {
          throw new ErrorJuego(409, 'hay_partidas', `Ese día ya tiene ${n} partida(s); al regenerarlo se borran. Mandá forzar: true para confirmar.`);
        }
      }
      const ctx = modo === 'reserva' ? { ...contexto, proveedor: null } : contexto;
      const r = await asegurarDesafio({ db, config, fecha, modo: modoJuego, ...ctx, permitirReserva: modo !== 'ia', reemplazar: Boolean(existente), forzarIA: true, ahora, registro });
      registro.info('admin_generar', { fecha, modoJuego, modo, resultado: r.resultado, origen: r.origen, corridaId: r.corridaId });
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
      return { hoy, ...(await estadisticasAdmin(db, { zona: config.zona, desde, hasta, fecha, modo: modoDe(req) })) };
    }, { admin: true }],
    // Historial de un modo para que una IA externa no repita preguntas: ?modo= &dias=3 (1–30) &formato=json|csv.
    // Incluye desde hace N-1 días hasta los días ya programados a futuro.
    ['GET', /^\/api\/admin\/historial$/, async ({ req }) => {
      const q = consulta(req);
      const modo = modoDe(req);
      const dias = Math.min(30, Math.max(1, Math.floor(Number(q.get('dias')) || 3)));
      const formato = q.get('formato') === 'csv' ? 'csv' : 'json';
      const hoy = fechaLocal(ahora(), config.zona);
      const desde = sumarDias(hoy, -(dias - 1));
      const preguntas = await historialDesde(db, desde, { modo });
      const archivo = `filon-historial-${modo === MODO_POR_DEFECTO ? '' : `${modo}-`}${desde}-${dias}d.${formato}`;
      if (formato === 'csv') return { [CRUDO]: { tipo: 'text/csv; charset=utf-8', cuerpo: historialACsv(preguntas), archivo } };
      const cuerpo = JSON.stringify({ modo, desde, dias, generado: new Date(ahora()).toISOString(), preguntas }, null, 2);
      return { [CRUDO]: { tipo: 'application/json; charset=utf-8', cuerpo, archivo } };
    }, { admin: true }],
    // Prompt de cada modo para generar un día con una IA externa (se copia desde el panel).
    ['GET', /^\/api\/admin\/prompt$/, async ({ req }) => {
      const modo = modoDe(req);
      return { modo, texto: leerPrompt(modo) };
    }, { admin: true }],
    ['GET', /^\/api\/admin\/corridas$/, async () => ({
      corridas: (await db.all('SELECT id, fecha_objetivo, modo, iniciada_en, terminada_en, resultado, uso_ia, detalle FROM corridas ORDER BY id DESC LIMIT ?', LIMITES.paginaCorridas))
        .map((c) => ({ ...c, detalle: c.detalle ? JSON.parse(c.detalle) : null })),
    }), { admin: true }],
    // Editar una pregunta ya publicada (?modo=). GET la devuelve en el formato de la reserva, con todas
    // sus respuestas; POST { pregunta, soloValidar } la valida y la reemplaza. Las respuestas que siguen
    // conservan su id (las rondas jugadas no cambian); no se puede quitar una que ya dio algún jugador.
    // La versión editada también se guarda en la reserva.
    ['GET', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})\/preguntas\/([1-7])$/, async ({ m, req }) => {
      const modo = modoDe(req);
      const d = await desafioPorFecha(db, m[1], modo);
      if (!d) throw new ErrorJuego(404, 'sin_desafio', `No hay desafío de ${MODOS[modo].nombre} para esa fecha.`);
      const p = (await preguntasDeDesafio(db, d.id)).find((x) => x.posicion === Number(m[2]));
      if (!p) throw new ErrorJuego(404, 'sin_pregunta', 'No existe esa pregunta.');
      const partidas = (await db.get('SELECT COUNT(*) AS n FROM rondas WHERE pregunta_id = ?', p.id)).n;
      return { preguntaId: p.id, posicion: p.posicion, jugadas: partidas, pregunta: await preguntaParaEditar(db, p.id) };
    }, { admin: true }],
    ['POST', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})\/preguntas\/([1-7])$/, async ({ m, req, cuerpo }) => {
      const modo = modoDe(req);
      const d = await desafioPorFecha(db, m[1], modo);
      if (!d) throw new ErrorJuego(404, 'sin_desafio', `No hay desafío de ${MODOS[modo].nombre} para esa fecha.`);
      const p = (await preguntasDeDesafio(db, d.id)).find((x) => x.posicion === Number(m[2]));
      if (!p) throw new ErrorJuego(404, 'sin_pregunta', 'No existe esa pregunta.');
      // La categoría no cambia: el día tiene que seguir teniendo su reparto de categorías.
      const v = validarEdicion({ ...cuerpo.pregunta, id: p.reserva_id || p.id }, modo, { categoria: p.categoria });
      if (cuerpo.soloValidar) return { resultado: 'valido', advertencias: v.advertencias };
      const r = await editarPregunta(db, p.id, v.pregunta);
      if (!r.editada) {
        throw new ErrorJuego(409, 'respuesta_en_uso', `No se puede quitar ${r.enUso.map((x) => `«${x}»`).join(', ')}: ya la dio algún jugador. Podés cambiarle la rareza o la explicación.`);
      }
      await guardarEnReserva(db, modo, [v.pregunta], { origen: 'edicion', reemplazar: true, ahora: ahora() });
      registro.info('admin_editar_pregunta', { fecha: m[1], modo, posicion: p.posicion });
      return { resultado: 'editada', advertencias: v.advertencias, pregunta: aFormatoReserva(v.pregunta) };
    }, { admin: true, limiteJson: LIMITES.cuerpoImportacion }],

    // Reserva de un modo (?modo=): banco de archivo + lo guardado en la base, con el estado y el uso de cada pregunta.
    ['GET', /^\/api\/admin\/reserva$/, async ({ req }) => {
      const modo = modoDe(req);
      const completa = await reservaCompleta(db, modo, reservaArchivo(modo), { dominios: config.fuentes.dominios, conInactivas: true });
      const usos = await usosDeReserva(db, modo);
      return {
        modo,
        preguntas: completa.entradas
          .map((e) => ({ id: e.pregunta.id, origen: e.origen, activa: e.activa, usos: usos.get(e.pregunta.id) ?? null, pregunta: aFormatoReserva(e.pregunta) }))
          .sort((a, b) => Number(b.activa) - Number(a.activa) || (a.usos?.ultima ?? '').localeCompare(b.usos?.ultima ?? '') || a.id.localeCompare(b.id)),
        invalidas: completa.invalidas,
      };
    }, { admin: true }],
    // Agregar o editar una pregunta de la reserva: { pregunta, soloValidar }. Sin id, se crea una nueva.
    ['POST', /^\/api\/admin\/reserva$/, async ({ req, cuerpo }) => {
      const modo = modoDe(req);
      const id = String(cuerpo.pregunta?.id || `manual-${modo}-${ahora().toString(36)}`).trim();
      if (!/^[\w-]{1,80}$/.test(id)) throw new ErrorJuego(400, 'id_invalido', 'El id solo puede tener letras, números, guiones y guiones bajos (hasta 80).');
      const v = validarEdicion({ ...cuerpo.pregunta, id }, modo);
      if (cuerpo.soloValidar) return { resultado: 'valido', id, advertencias: v.advertencias };
      const delArchivo = reservaArchivo(modo).preguntas.some((p) => p.id === id);
      const existia = delArchivo || Boolean(await db.get('SELECT 1 AS si FROM reserva WHERE id = ?', id));
      await guardarEnReserva(db, modo, [{ ...v.pregunta, id }], { origen: existia ? 'edicion' : 'manual', reemplazar: true, ahora: ahora() });
      registro.info('admin_reserva', { modo, id, accion: existia ? 'editada' : 'agregada' });
      return { resultado: existia ? 'editada' : 'agregada', id, advertencias: v.advertencias };
    }, { admin: true, limiteJson: LIMITES.cuerpoImportacion }],
    // Sacar de circulación (o volver a usar) una pregunta de la reserva: { id, activa }.
    ['POST', /^\/api\/admin\/reserva\/estado$/, async ({ req, cuerpo }) => {
      const modo = modoDe(req);
      const ok = await cambiarEstadoReserva(db, modo, String(cuerpo.id || ''), Boolean(cuerpo.activa), { base: reservaArchivo(modo), ahora: ahora() });
      if (!ok) throw new ErrorJuego(404, 'sin_pregunta', 'No existe esa pregunta en la reserva.');
      return { ok: true };
    }, { admin: true }],
    ['GET', /^\/api\/admin\/desafios\/(\d{4}-\d{2}-\d{2})$/, async ({ m, req }) => {
      if (!esFechaValida(m[1])) throw new ErrorJuego(400, 'fecha_invalida', 'Fecha inválida.');
      const modo = modoDe(req);
      const d = await desafioPorFecha(db, m[1], modo);
      if (!d) throw new ErrorJuego(404, 'sin_desafio', `No hay desafío de ${MODOS[modo].nombre} para esa fecha.`);
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
      // El catálogo se consulta después de ambas operaciones. La comprobación de
      // versión y el contador atómico son independientes y evitan un viaje en serie.
      let limiteRevelado;
      if (opciones.limite === 'revelado') {
        [, limiteRevelado] = await Promise.all([sincronizarCaches(db), limites.consumir('revelado', ip(req))]);
      } else {
        await sincronizarCaches(db);
      }
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
        const l = limiteRevelado ?? await limites.consumir(politica, ip(req));
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
