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

  // Proveedor de IA: IA_PROVEEDOR si está y tiene su clave; si no, el que tenga clave (primero Anthropic).
  const claves = { anthropic: e.ANTHROPIC_API_KEY || '', openai: e.OPENAI_API_KEY || '' };
  const elegido = (e.IA_PROVEEDOR || '').toLowerCase();
  const detectado = claves.anthropic ? 'anthropic' : claves.openai ? 'openai' : null;
  let proveedor = elegido || detectado || 'ninguno';
  if (proveedor in claves && !claves[proveedor] && detectado) proveedor = detectado;
  const deOpenAI = proveedor === 'openai';
  // IA_MODELO solo se usa si corresponde al proveedor activo (en Vercel puede haber quedado uno de Claude).
  const modeloPropio = (m) => (m && /^claude/i.test(m) !== deOpenAI ? m : '');
  const modelosPorDefecto = deOpenAI ? ['gpt-5', 'gpt-5-mini'] : ['claude-opus-5-5', 'claude-sonnet-5-5'];

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
      proveedor, // 'anthropic' | 'openai' | 'simulado' | 'ninguno'
      claveApi: deOpenAI ? claves.openai : claves.anthropic,
      urlApi: deOpenAI ? e.OPENAI_URL || 'https://api.openai.com/v1/chat/completions' : e.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages',
      modelo: modeloPropio(e.IA_MODELO) || modelosPorDefecto[0],
      modeloRevisor: modeloPropio(e.IA_MODELO_REVISOR) || modelosPorDefecto[1],
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
