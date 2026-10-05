// Instrucciones y esquemas para la generación y la revisión con IA.
import { CATEGORIAS } from '../dominio.js';

export const PISTAS_CATEGORIA = {
  geografia: 'ciudades, ríos, montañas, islas, lagos, áreas protegidas y accidentes geográficos de todos los continentes.',
  historia: 'personas, acontecimientos, instituciones, tratados y sitios históricos de distintas regiones y épocas.',
  ciencia: 'científicos, especies, cuerpos astronómicos, minerales, enfermedades, instrumentos y descubrimientos documentados.',
  deportes: 'deportistas, clubes, estadios, competencias y disciplinas de muchos países, géneros y períodos.',
  cine: 'películas, intérpretes, dirección, guion y festivales de cinematografías de todo el mundo.',
  musica: 'artistas, grupos, compositores, obras, álbumes e instrumentos de tradiciones musicales globales.',
  literatura: 'autores, obras, personajes, premios y movimientos de diversas lenguas, continentes y épocas.',
};

export const SISTEMA_GENERADOR = `Sos editor de preguntas de «Filón», un juego diario global de cultura general escrito en español claro con voseo.
Cada pregunta pide UNA respuesta escrita libremente y admite muchas respuestas correctas; las menos obvias dan más puntos.

Reglas:
1. Alcance global: evitá enfoques nacionales o localistas. No uses Argentina como referencia temática. Alterná regiones, continentes, lenguas, géneros y tradiciones; no confundas «global» con «Estados Unidos y Europa occidental».
2. Conjunto amplio y verificable: cada pregunta debe producir entre 1.000 y 1.500 respuestas distintas desde Wikidata. Si el criterio no alcanza 1.000, descartalo y diseñá otro.
3. Nada subjetivo ni opinable («mejor», «favorito», «más famoso»). Nada que cambie pronto (cargos actuales, temporadas en curso, rankings vivos). Si el conjunto depende del tiempo, fijá un año de corte explícito en el alcance.
4. El enunciado empieza con «Nombrá…» (voseo), es corto, claro y sin trampas. El alcance explica en una oración qué cuenta y qué no, sin revelar respuestas poco conocidas.
5. Entregá una consulta SPARQL de solo lectura para Wikidata; no enumeres las respuestas. Debe devolver exactamente estas variables:
   - ?item: entidad de Wikidata.
   - ?popularidad: valor numérico comparable, preferentemente wikibase:sitelinks, usado solo para ordenar la rareza.
6. Usá SELECT DISTINCT ?item ?popularidad y LIMIT 1500. No uses ORDER BY: Filón ordena los resultados localmente. No uses SERVICE ni consultas federadas; Filón obtiene después las etiquetas y alias en español o inglés mediante la API de Wikidata.
7. El criterio expresado por el enunciado y el alcance debe coincidir exactamente con los triples y filtros de la consulta.
8. Diseñá consultas eficientes. Evitá búsquedas de texto, REGEX sobre catálogos completos, caminos de propiedades innecesariamente amplios y conjuntos que representen una fracción enorme de Wikidata.
9. Rechazos: hasta 6 errores frecuentes (respuestas plausibles que NO cumplen el criterio) con un motivo breve y verdadero.
10. Exactitud y diversidad ante todo: si dudás del criterio o de que existan 1.000 resultados válidos, elegí otra pregunta.`;

export function mensajeGenerador({ categoria, cantidad, recientes, fecha }) {
  const lista = recientes.length
    ? recientes.map((r) => `- ${r.enunciado}`).join('\n')
    : '- (ninguno)';
  return `Fecha del desafío: ${fecha}.
Categoría: ${CATEGORIAS[categoria]}.
Ideas posibles para esta categoría (no obligatorias): ${PISTAS_CATEGORIA[categoria]}

Generá ${cantidad} preguntas candidatas, distintas entre sí, para esta categoría.
No repitas ni reformules estos enunciados usados en los últimos días:
${lista}

Entregá el resultado con la herramienta entregar_preguntas.`;
}

export const HERRAMIENTA_PREGUNTAS = {
  name: 'entregar_preguntas',
  description: 'Entrega las preguntas candidatas con todas sus respuestas válidas.',
  input_schema: {
    type: 'object',
    properties: {
      preguntas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            enunciado: { type: 'string', description: 'Empieza con «Nombrá…».' },
            alcance: { type: 'string', description: 'Qué cuenta y qué no, en una oración.' },
            consulta_wikidata: {
              type: 'string',
              description: 'Consulta SPARQL SELECT DISTINCT que devuelve ?item y ?popularidad, sin SERVICE ni ORDER BY, con LIMIT 1500.',
            },
            estimacion_respuestas: { type: 'integer', minimum: 1000, maximum: 1500 },
            fuentes: {
              type: 'array',
              description: 'Fuentes que enumeran el conjunto completo.',
              items: {
                type: 'object',
                properties: { url: { type: 'string' }, titulo: { type: 'string' } },
                required: ['url', 'titulo'],
              },
            },
            respuestas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  canonica: { type: 'string' },
                  variantes: { type: 'array', items: { type: 'string' } },
                  rareza: { type: 'string', enum: ['grava', 'cobre', 'plata', 'oro', 'diamante'] },
                  explicacion: { type: 'string' },
                  fuente_url: { type: 'string', description: 'Opcional: fuente específica de esta respuesta.' },
                },
                required: ['canonica', 'variantes', 'rareza', 'explicacion'],
              },
            },
            rechazos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  textos: { type: 'array', items: { type: 'string' } },
                  motivo: { type: 'string' },
                },
                required: ['textos', 'motivo'],
              },
            },
          },
          required: ['enunciado', 'alcance', 'consulta_wikidata', 'estimacion_respuestas', 'rechazos'],
        },
      },
    },
    required: ['preguntas'],
  },
};

export const SISTEMA_REVISOR = `Sos verificador de datos de un juego de preguntas. Tu trabajo es encontrar errores, no aprobar.
Para cada pregunta revisá:
- que el enunciado sea claro, no subjetivo y defina un conjunto cerrado;
- cada respuesta: si cumple de verdad el enunciado y el alcance, y si el dato de su explicación es correcto;
- contradicciones entre respuestas, explicaciones, rarezas y alcance;
- respuestas válidas importantes que falten en el conjunto.
Marcá «incorrecta» lo que es falso o no cumple el enunciado y «dudosa» lo que no podés confirmar con seguridad. Ante la duda, «dudosa».
Una pregunta no es apta si es ambigua, subjetiva, depende de datos que cambian o le faltan respuestas importantes.`;

export function mensajeRevisor(preguntas) {
  const cuerpo = preguntas.map((p, i) => ({
    indice: i,
    enunciado: p.enunciado,
    alcance: p.alcance,
    origen_datos: p.datosEstructurados || 'lista editorial',
    consulta_wikidata: p.consultaWikidata || null,
    total_respuestas: p.respuestas.length,
    muestra_respuestas: p.respuestas.slice(0, 40).map((r) => ({ canonica: r.canonica, variantes: r.variantes, rareza: r.rareza })),
    rechazos: p.rechazos.map((r) => ({ textos: r.textos, motivo: r.motivo })),
  }));
  return `Revisá estas preguntas globales y entregá el resultado con la herramienta entregar_revision.
Si origen_datos es wikidata, auditá que el enunciado, el alcance y la consulta coincidan, que el conjunto sea mundial y que la consulta no introduzca un sesgo nacional. Las respuestas son solo una muestra: no marques como faltantes las entidades que no aparecen en ella.\n\n${JSON.stringify(cuerpo, null, 1)}`;
}

export const HERRAMIENTA_REVISION = {
  name: 'entregar_revision',
  description: 'Entrega la revisión crítica de cada pregunta.',
  input_schema: {
    type: 'object',
    properties: {
      preguntas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            indice: { type: 'integer' },
            apta: { type: 'boolean' },
            problemas: { type: 'array', items: { type: 'string' } },
            faltantes: { type: 'array', items: { type: 'string' }, description: 'Respuestas válidas importantes que faltan.' },
            respuestas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  canonica: { type: 'string' },
                  veredicto: { type: 'string', enum: ['correcta', 'dudosa', 'incorrecta'] },
                  motivo: { type: 'string' },
                },
                required: ['canonica', 'veredicto'],
              },
            },
          },
          required: ['indice', 'apta', 'problemas', 'respuestas'],
        },
      },
    },
    required: ['preguntas'],
  },
};
