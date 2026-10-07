// Configuración a partir de variables de entorno (y de un archivo .env opcional en la raíz).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function cargarArchivoEnv(ruta) {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || linea.trim().startsWith('#')) continue;
    let valor = m[2];
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}

const DOMINIOS_POR_DEFECTO = [
  'wikipedia.org',
  'wikidata.org',
  'query.wikidata.org',
  'britannica.com',
  'nobelprize.org',
  'fifa.com',
  'olympics.com',
  'conmebol.com',
  'oscars.org',
  'iupac.org',
  'nasa.gov',
  'iau.org',
  'rae.es',
  'unesco.org',
  'imdb.com',
  'loc.gov',
  'bne.es',
  'cervantesvirtual.com',
  'un.org',
  'who.int',
  'worldbank.org',
];

const num = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));
const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'si', 'sí', 'yes'].includes(String(v).toLowerCase()));

export function cargarConfig(sobrescrituras = {}) {
  if (!sobrescrituras.sinArchivoEnv) cargarArchivoEnv(resolve(RAIZ, '.env'));
  const e = { ...process.env, ...(sobrescrituras.env || {}) };

  // En Vercel: HTTPS, proxy delante y sin procesos permanentes (la tarea diaria la dispara Vercel Cron).
  const enVercel = Boolean(e.VERCEL);
  // BD_URL/BD_TOKEN fijan la base principal. Tienen prioridad sobre TURSO_*, que la integración de Turso
  // en Vercel puede apuntar a una rama nueva (vacía) en cada despliegue.
  const urlBD = e.BD_URL || e.TURSO_DATABASE_URL || '';

  const config = {
    enVercel,
    puerto: num(e.PUERTO ?? e.PORT, 3000),
    host: e.HOST || '0.0.0.0',
    // libsql://… (Turso) en producción; archivo local si no hay URL.
    rutaBD: urlBD || resolve(RAIZ, e.RUTA_BD || 'datos/filon.db'),
    tokenBD: e.BD_URL ? e.BD_TOKEN || '' : e.TURSO_AUTH_TOKEN || '',
    rutaReserva: resolve(RAIZ, e.RUTA_RESERVA || 'datos/reserva.json'),
    // Bancos de reserva y prompts para otra IA, por modo de juego (Normal usa rutaReserva).
    rutasReserva: {
      farandula: resolve(RAIZ, e.RUTA_RESERVA_FARANDULA || 'datos/reserva-farandula.json'),
      geografia: resolve(RAIZ, e.RUTA_RESERVA_GEOGRAFIA || 'datos/reserva-geografia.json'),
    },
    rutasPrompt: {
      normal: resolve(RAIZ, 'datos/prompt-generacion.txt'),
      farandula: resolve(RAIZ, 'datos/prompt-farandula.txt'),
      geografia: resolve(RAIZ, 'datos/prompt-geografia.txt'),
    },
    zona: e.ZONA_HORARIA || 'America/Argentina/Buenos_Aires',
    segundosPorPregunta: num(e.SEGUNDOS_POR_PREGUNTA, 25),
    graciaRedMs: num(e.GRACIA_RED_MS, 1500),
    horasParaRetomar: num(e.HORAS_PARA_RETOMAR, 12),
    maxIntentosPorRonda: num(e.MAX_INTENTOS_POR_RONDA, 40),
    secretoSesion: e.SECRETO_SESION || '',
    cookieSegura: bool(e.COOKIE_SEGURA, enVercel),
    confiarProxy: bool(e.CONFIAR_PROXY, enVercel),
    tokenAdmin: e.TOKEN_ADMIN || '',
    // Multiplica los máximos de los límites de solicitudes (1 en producción; más alto solo en pruebas E2E).
    limitesEscala: num(e.LIMITES_ESCALA, 1),
    admin: {
      // Sesiones del panel: vencen por inactividad y, como máximo, a las N horas de iniciadas.
      inactividadMs: num(e.ADMIN_INACTIVIDAD_MIN, 30) * 60_000,
      vidaMaximaMs: num(e.ADMIN_VIDA_HORAS, 8) * 3_600_000,
      // Transición: acepta «Authorization: Bearer TOKEN_ADMIN» para scripts y curl. Poné 0 para exigir sesión.
      permitirBearer: bool(e.ADMIN_PERMITIR_BEARER, true),
    },
    // Vercel Cron envía «Authorization: Bearer $CRON_SECRET».
    secretoCron: e.CRON_SECRET || '',
    relojDesfaseMs: num(e.RELOJ_DESFASE_MS, 0),

    fuentes: {
      // Dominios aceptados como fuente de una pregunta (https). Se valida al cargar o editar preguntas.
      dominios: (e.DOMINIOS_FUENTES ? e.DOMINIOS_FUENTES.split(',') : DOMINIOS_POR_DEFECTO).map((d) => d.trim()).filter(Boolean),
    },

    programador: {
      interno: bool(e.PROGRAMADOR_INTERNO, !enVercel),
      minutosEntreRevisiones: num(e.MINUTOS_ENTRE_REVISIONES, 10),
      minutosReservaAntesDeMedianoche: num(e.MINUTOS_RESERVA_ANTES_DE_MEDIANOCHE, 30),
    },

    diasSinRepetir: num(e.DIAS_SIN_REPETIR, 60),
    // Carga manual: días hacia atrás (más los ya programados) con los que se comparan las preguntas.
    similitudDias: num(e.SIMILITUD_DIAS, 3),

    // Retención (días). Las partidas y los desafíos se conservan: son el historial del juego.
    retencion: {
      visitantesSinPartidaDias: num(e.RETENER_VISITANTES_DIAS, 90),
      intentosDias: num(e.RETENER_INTENTOS_DIAS, 180),
      reportesResueltosDias: num(e.RETENER_REPORTES_DIAS, 365),
      detalleCorridasDias: num(e.RETENER_CORRIDAS_DIAS, 180),
    },
  };
  return config;
}
