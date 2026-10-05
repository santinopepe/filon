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

  const clave = e.ANTHROPIC_API_KEY || '';
  let proveedor = (e.IA_PROVEEDOR || '').toLowerCase();
  if (!proveedor) proveedor = clave ? 'anthropic' : 'ninguno';

  // En Vercel: HTTPS, proxy delante y sin procesos permanentes (la tarea diaria la dispara Vercel Cron).
  const enVercel = Boolean(e.VERCEL);
  const urlBD = e.TURSO_DATABASE_URL || e.BD_URL || '';

  const config = {
    enVercel,
    puerto: num(e.PUERTO ?? e.PORT, 3000),
    host: e.HOST || '0.0.0.0',
    // libsql://… (Turso) en producción; archivo local si no hay URL.
    rutaBD: urlBD || resolve(RAIZ, e.RUTA_BD || 'datos/filon.db'),
    tokenBD: e.TURSO_AUTH_TOKEN || e.BD_TOKEN || '',
    rutaReserva: resolve(RAIZ, e.RUTA_RESERVA || 'datos/reserva.json'),
    zona: e.ZONA_HORARIA || 'America/Argentina/Buenos_Aires',
    segundosPorPregunta: num(e.SEGUNDOS_POR_PREGUNTA, 25),
    graciaRedMs: num(e.GRACIA_RED_MS, 1500),
    horasParaRetomar: num(e.HORAS_PARA_RETOMAR, 12),
    maxIntentosPorRonda: num(e.MAX_INTENTOS_POR_RONDA, 40),
    secretoSesion: e.SECRETO_SESION || '',
    cookieSegura: bool(e.COOKIE_SEGURA, enVercel),
    confiarProxy: bool(e.CONFIAR_PROXY, enVercel),
    urlPublica: e.URL_PUBLICA || '',
    tokenAdmin: e.TOKEN_ADMIN || '',
    // Vercel Cron envía «Authorization: Bearer $CRON_SECRET».
    secretoCron: e.CRON_SECRET || '',
    relojDesfaseMs: num(e.RELOJ_DESFASE_MS, 0),

    ia: {
      proveedor, // 'anthropic' | 'simulado' | 'ninguno'
      claveApi: clave,
      urlApi: e.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages',
      modelo: e.IA_MODELO || 'claude-opus-5-5',
      modeloRevisor: e.IA_MODELO_REVISOR || 'claude-sonnet-5-5',
      maxIntentosPorDia: num(e.IA_MAX_INTENTOS_POR_DIA, 3),
      tiempoLimiteMs: num(e.IA_TIEMPO_LIMITE_MS, 240_000),
      candidatasPorCategoria: num(e.IA_CANDIDATAS_POR_CATEGORIA, 2),
      revisionAdversarial: bool(e.IA_REVISION_ADVERSARIAL, true),
      // Tiempo máximo para la IA en una corrida (0 = sin límite). En Vercel tiene que entrar en maxDuration.
      presupuestoMs: num(e.IA_PRESUPUESTO_MS, enVercel ? 200_000 : 0),
    },

    fuentes: {
      modo: (e.VERIFICAR_FUENTES || 'estricta').toLowerCase(), // 'estricta' | 'desactivada'
      dominios: (e.DOMINIOS_FUENTES ? e.DOMINIOS_FUENTES.split(',') : DOMINIOS_POR_DEFECTO).map((d) => d.trim()).filter(Boolean),
      tiempoLimiteMs: num(e.FUENTES_TIEMPO_LIMITE_MS, 15_000),
      userAgent: e.FUENTES_USER_AGENT || `FilonBot/1.0 (verificacion de preguntas; ${e.URL_PUBLICA || "sin-url"}; ${e.CONTACTO_FUENTES || "sin-contacto"})`,
    },

    wikidata: {
      tiempoLimiteMs: num(e.WIKIDATA_TIEMPO_LIMITE_MS, 45_000),
    },

    programador: {
      interno: bool(e.PROGRAMADOR_INTERNO, !enVercel),
      minutosEntreRevisiones: num(e.MINUTOS_ENTRE_REVISIONES, 10),
      minutosReservaAntesDeMedianoche: num(e.MINUTOS_RESERVA_ANTES_DE_MEDIANOCHE, 30),
    },

    diasSinRepetir: num(e.DIAS_SIN_REPETIR, 60),
  };
  return config;
}
