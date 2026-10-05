// Proveedores de IA para generar y revisar preguntas.
// Solo se usan en la tarea programada; nunca durante una partida.
import {
  SISTEMA_GENERADOR,
  mensajeGenerador,
  HERRAMIENTA_PREGUNTAS,
  SISTEMA_REVISOR,
  mensajeRevisor,
  HERRAMIENTA_REVISION,
} from './prompts.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST con hasta 3 intentos ante errores de red, 429 y 5xx.
 * `esDefinitivo(res, cuerpo)` puede cortar los reintentos (por ejemplo, cuota agotada).
 * Devuelve { res, cuerpo } de la primera respuesta que no se reintenta.
 */
async function pedirConReintentos({ obtener, url, cabeceras, datos, tiempoLimiteMs, esDefinitivo = () => false }) {
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    let res;
    try {
      res = await obtener(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cabeceras },
        body: JSON.stringify(datos),
        signal: AbortSignal.timeout(tiempoLimiteMs),
      });
    } catch (e) {
      ultimoError = e;
      await esperar(2000 * intento);
      continue;
    }
    const cuerpo = await res.json().catch(() => ({}));
    if ((res.status === 429 || res.status >= 500) && !esDefinitivo(res, cuerpo)) {
      const espera = Number(res.headers.get('retry-after')) * 1000 || 3000 * intento;
      ultimoError = new Error(`API respondió ${res.status}`);
      await esperar(Math.min(espera, 30_000));
      continue;
    }
    return { res, cuerpo };
  }
  throw ultimoError || new Error('No se pudo contactar a la API.');
}

/** Interfaz común de los proveedores a partir de una función `llamar` específica de cada API. */
function armarProveedor({ nombre, modelo, modeloRevisor, llamar, tokensGeneracion, tokensRevision }) {
  return {
    nombre,
    modelo,
    async generarPreguntas({ categoria, cantidad, recientes, fecha }) {
      const { datos, uso } = await llamar({
        modeloUsado: modelo,
        sistema: SISTEMA_GENERADOR,
        mensaje: mensajeGenerador({ categoria, cantidad, recientes, fecha }),
        herramienta: HERRAMIENTA_PREGUNTAS,
        maxTokens: tokensGeneracion,
      });
      return { preguntas: Array.isArray(datos?.preguntas) ? datos.preguntas : [], uso };
    },
    async revisarPreguntas({ preguntas }) {
      const { datos, uso } = await llamar({
        modeloUsado: modeloRevisor,
        sistema: SISTEMA_REVISOR,
        mensaje: mensajeRevisor(preguntas),
        herramienta: HERRAMIENTA_REVISION,
        maxTokens: tokensRevision,
      });
      return { revisiones: Array.isArray(datos?.preguntas) ? datos.preguntas : [], uso };
    },
  };
}

/** Cliente mínimo de la API de Mensajes de Anthropic con uso forzado de herramienta. */
export function crearProveedorAnthropic({ claveApi, urlApi, modelo, modeloRevisor, tiempoLimiteMs = 240_000, obtener = globalThis.fetch }) {
  if (!claveApi) throw new Error('Falta ANTHROPIC_API_KEY.');

  async function llamar({ modeloUsado, sistema, mensaje, herramienta, maxTokens }) {
    const { res, cuerpo } = await pedirConReintentos({
      obtener,
      url: urlApi,
      tiempoLimiteMs,
      cabeceras: { 'x-api-key': claveApi, 'anthropic-version': '2023-06-01' },
      datos: {
        model: modeloUsado,
        max_tokens: maxTokens,
        system: sistema,
        messages: [{ role: 'user', content: mensaje }],
        tools: [herramienta],
        tool_choice: { type: 'tool', name: herramienta.name },
      },
    });
    if (!res.ok) throw new Error(`API respondió ${res.status}: ${cuerpo?.error?.message || 'sin detalle'}`);
    if (cuerpo.stop_reason === 'max_tokens') throw new Error('La respuesta de la IA quedó truncada (max_tokens).');
    const bloque = (cuerpo.content || []).find((b) => b.type === 'tool_use' && b.name === herramienta.name);
    if (!bloque) throw new Error('La IA no devolvió la herramienta esperada.');
    return { datos: bloque.input, uso: cuerpo.usage, modelo: cuerpo.model };
  }

  return armarProveedor({ nombre: 'anthropic', modelo, modeloRevisor, llamar, tokensGeneracion: 16_000, tokensRevision: 12_000 });
}

/**
 * Cliente mínimo de la API de Chat Completions de OpenAI con llamada a función forzada.
 * Usa las mismas instrucciones y esquemas que Anthropic: la herramienta se envía como función.
 */
export function crearProveedorOpenAI({ claveApi, urlApi, modelo, modeloRevisor, tiempoLimiteMs = 240_000, obtener = globalThis.fetch }) {
  if (!claveApi) throw new Error('Falta OPENAI_API_KEY.');

  async function llamar({ modeloUsado, sistema, mensaje, herramienta, maxTokens }) {
    const { res, cuerpo } = await pedirConReintentos({
      obtener,
      url: urlApi,
      tiempoLimiteMs,
      cabeceras: { authorization: `Bearer ${claveApi}` },
      // Sin crédito, OpenAI responde 429 «insufficient_quota»: reintentar no sirve.
      esDefinitivo: (r, c) => c?.error?.code === 'insufficient_quota',
      datos: {
        model: modeloUsado,
        // Incluye los tokens de razonamiento en los modelos que razonan.
        max_completion_tokens: maxTokens,
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: mensaje },
        ],
        tools: [{ type: 'function', function: { name: herramienta.name, description: herramienta.description, parameters: herramienta.input_schema } }],
        tool_choice: { type: 'function', function: { name: herramienta.name } },
      },
    });
    if (!res.ok) throw new Error(`API respondió ${res.status}: ${cuerpo?.error?.message || 'sin detalle'}`);
    const eleccion = cuerpo.choices?.[0];
    if (eleccion?.finish_reason === 'length') throw new Error('La respuesta de la IA quedó truncada (max_completion_tokens).');
    if (eleccion?.message?.refusal) throw new Error(`La IA se negó a responder: ${eleccion.message.refusal}`);
    const llamada = (eleccion?.message?.tool_calls || []).find((t) => t.function?.name === herramienta.name);
    if (!llamada) throw new Error('La IA no devolvió la función esperada.');
    let datos;
    try {
      datos = JSON.parse(llamada.function.arguments);
    } catch {
      throw new Error('La IA devolvió argumentos que no son JSON válido.');
    }
    const uso = cuerpo.usage ? { input_tokens: cuerpo.usage.prompt_tokens, output_tokens: cuerpo.usage.completion_tokens } : null;
    return { datos, uso, modelo: cuerpo.model };
  }

  return armarProveedor({ nombre: 'openai', modelo, modeloRevisor, llamar, tokensGeneracion: 32_000, tokensRevision: 24_000 });
}

/**
 * Proveedor simulado para desarrollo y pruebas, sin credenciales.
 * Devuelve preguntas armadas a partir de un banco dado e introduce una respuesta falsa
 * para que se vea en acción la depuración (revisión + verificación de fuentes).
 */
export function crearProveedorSimulado({ banco, fallar = false, respuestaFalsa = true }) {
  return {
    nombre: 'simulado',
    modelo: 'simulado',
    async generarPreguntas({ categoria, cantidad }) {
      if (fallar) throw new Error('Fallo simulado del proveedor de IA.');
      const delaCategoria = banco.filter((p) => p.categoria === categoria).slice(0, cantidad);
      const preguntas = delaCategoria.map((p) => {
        const copia = structuredClone(p);
        delete copia.categoria;
        delete copia.id;
        if (respuestaFalsa) {
          copia.respuestas.push({ canonica: 'Atlántida', variantes: [], rareza: 'diamante', explicacion: 'Respuesta inventada para probar la depuración.' });
        }
        return copia;
      });
      return { preguntas, uso: null };
    },
    async revisarPreguntas({ preguntas }) {
      return {
        revisiones: preguntas.map((p, indice) => ({
          indice,
          apta: true,
          problemas: [],
          respuestas: p.respuestas.map((r) => ({
            canonica: r.canonica,
            veredicto: r.canonica === 'Atlántida' ? 'incorrecta' : 'correcta',
            motivo: r.canonica === 'Atlántida' ? 'Lugar mítico, no real.' : '',
          })),
        })),
        uso: null,
      };
    },
  };
}
