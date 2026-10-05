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

/** Cliente mínimo de la API de Mensajes de Anthropic con uso forzado de herramienta. */
export function crearProveedorAnthropic({ claveApi, urlApi, modelo, modeloRevisor, tiempoLimiteMs = 240_000, obtener = globalThis.fetch }) {
  if (!claveApi) throw new Error('Falta ANTHROPIC_API_KEY.');

  async function llamar({ modeloUsado, sistema, mensaje, herramienta, maxTokens }) {
    let ultimoError;
    for (let intento = 1; intento <= 3; intento++) {
      let res;
      try {
        res = await obtener(urlApi, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': claveApi,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modeloUsado,
            max_tokens: maxTokens,
            system: sistema,
            messages: [{ role: 'user', content: mensaje }],
            tools: [herramienta],
            tool_choice: { type: 'tool', name: herramienta.name },
          }),
          signal: AbortSignal.timeout(tiempoLimiteMs),
        });
      } catch (e) {
        ultimoError = e;
        await esperar(2000 * intento);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const espera = Number(res.headers.get('retry-after')) * 1000 || 3000 * intento;
        ultimoError = new Error(`API respondió ${res.status}`);
        await esperar(Math.min(espera, 30_000));
        continue;
      }
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`API respondió ${res.status}: ${cuerpo?.error?.message || 'sin detalle'}`);
      if (cuerpo.stop_reason === 'max_tokens') throw new Error('La respuesta de la IA quedó truncada (max_tokens).');
      const bloque = (cuerpo.content || []).find((b) => b.type === 'tool_use' && b.name === herramienta.name);
      if (!bloque) throw new Error('La IA no devolvió la herramienta esperada.');
      return { datos: bloque.input, uso: cuerpo.usage, modelo: cuerpo.model };
    }
    throw ultimoError || new Error('No se pudo contactar a la API.');
  }

  return {
    nombre: 'anthropic',
    modelo,
    async generarPreguntas({ categoria, cantidad, recientes, fecha }) {
      const { datos, uso } = await llamar({
        modeloUsado: modelo,
        sistema: SISTEMA_GENERADOR,
        mensaje: mensajeGenerador({ categoria, cantidad, recientes, fecha }),
        herramienta: HERRAMIENTA_PREGUNTAS,
        maxTokens: 16_000,
      });
      return { preguntas: Array.isArray(datos?.preguntas) ? datos.preguntas : [], uso };
    },
    async revisarPreguntas({ preguntas }) {
      const { datos, uso } = await llamar({
        modeloUsado: modeloRevisor,
        sistema: SISTEMA_REVISOR,
        mensaje: mensajeRevisor(preguntas),
        herramienta: HERRAMIENTA_REVISION,
        maxTokens: 12_000,
      });
      return { revisiones: Array.isArray(datos?.preguntas) ? datos.preguntas : [], uso };
    },
  };
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
