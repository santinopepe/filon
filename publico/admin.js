// Panel de administración: resumen con estadísticas, desafíos, creación, corridas y reportes.
// Todo el contenido (que puede venir de la IA o de los jugadores) se inserta como texto, nunca como HTML.
import { fmt, columnasApiladas, campana, barraResultado, tramos, ocultarTooltip } from './admin-graficos.js';
import { insertarHistorial } from './prompt.js';

const $ = (id) => document.getElementById(id);

// El token maestro ya no se guarda en el navegador: se envía una sola vez al iniciar sesión y la sesión
// vive en una cookie HttpOnly. Se borra lo que haya dejado la versión anterior del panel.
try {
  localStorage.removeItem('filon_admin_token');
  sessionStorage.removeItem('filon_admin_token');
} catch {
  /* almacenamiento no disponible */
}

/** Crea un elemento: h('td', { class: 'num' }, 'texto', otroNodo). */
function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const hijo of hijos.flat()) if (hijo != null && hijo !== false) el.append(hijo instanceof Node ? hijo : String(hijo));
  return el;
}

const enlaceSeguro = (url, texto) => (/^https?:\/\//.test(url || '') ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, texto || url) : texto || url || '—');
const fechaHora = (ms) => (ms ? new Date(ms).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23', dateStyle: 'short', timeStyle: 'short' }) : '—');
const etiquetaOrigen = (origen) => h('span', { class: `etiqueta ${origen}` }, origen === 'ia' ? 'IA' : origen);
const origenDesafio = (desafio) => (desafio.modelo === 'manual' ? 'manual' : desafio.origen);

class ErrorApi extends Error {
  constructor(estado, datos) {
    super(datos?.mensaje || datos?.error || `HTTP ${estado}`);
    this.estado = estado;
    this.datos = datos;
  }
}

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: cuerpo ? { 'content-type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await res.json().catch(() => null);
  if (res.status === 401 && ruta !== '/api/admin/sesion') {
    mostrarIngreso('La sesión venció o se cerró. Volvé a ingresar.');
    throw new ErrorApi(401, { mensaje: 'Sesión vencida.' });
  }
  if (!res.ok) throw new ErrorApi(res.status, datos);
  return datos;
}

// ───────── Ingreso ─────────

function mostrarIngreso(mensaje = '') {
  ocultarTooltip();
  $('panel').hidden = true;
  $('nav').hidden = true;
  $('salir').hidden = true;
  $('estado-ia').textContent = '';
  $('ingreso').hidden = false;
  $('error-ingreso').textContent = mensaje;
  $('error-ingreso').hidden = !mensaje;
  $('token').focus();
}

$('ingreso').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const token = $('token').value.trim();
  $('token').value = ''; // no queda en el DOM ni en memoria del formulario
  $('error-ingreso').hidden = true;
  $('ingresar').disabled = true;
  try {
    await api('POST', '/api/admin/sesion', { token });
    await iniciarPanel();
  } catch (e) {
    const mensaje = e.estado === 401 ? 'Token incorrecto.' : e.estado === 429 ? 'Demasiados intentos. Esperá unos minutos.' : e.message;
    mostrarIngreso(mensaje);
  } finally {
    $('ingresar').disabled = false;
  }
});

$('salir').addEventListener('click', async () => {
  await api('DELETE', '/api/admin/sesion').catch(() => {}); // revoca la sesión en el servidor
  mostrarIngreso('Cerraste la sesión.');
});

async function iniciarPanel() {
  await cargarDesafios();
  mostrarPanel();
}

function mostrarPanel() {
  $('ingreso').hidden = true;
  $('panel').hidden = false;
  $('nav').hidden = false;
  $('salir').hidden = false;
  irA('resumen');
}

// ───────── Secciones ─────────

const cargadores = {
  resumen: cargarResumen,
  desafios: cargarDesafios,
  crear: () => elegirModoCrear(modoCrear),
  reserva: cargarReserva,
  corridas: cargarCorridas,
  reportes: cargarReportes,
};
const pestanas = [...document.querySelectorAll('[role="tab"][data-pestana]')];
function irA(nombre, { enfocar = false } = {}) {
  ocultarTooltip();
  for (const b of pestanas) {
    const activa = b.dataset.pestana === nombre;
    b.setAttribute('aria-selected', String(activa));
    b.tabIndex = activa ? 0 : -1; // «roving tabindex»: solo la pestaña activa entra en el orden de tabulación
    if (activa && enfocar) b.focus();
  }
  for (const n of Object.keys(cargadores)) $(`pestana-${n}`).hidden = n !== nombre;
  return cargadores[nombre]().catch(mostrarErrorGeneral);
}
for (const boton of pestanas) boton.addEventListener('click', () => irA(boton.dataset.pestana));
// Teclado del patrón de pestañas: flechas izquierda/derecha, Inicio y Fin.
$('nav').addEventListener('keydown', (ev) => {
  const i = pestanas.indexOf(document.activeElement);
  if (i < 0) return;
  const destino = { ArrowRight: (i + 1) % pestanas.length, ArrowLeft: (i - 1 + pestanas.length) % pestanas.length, Home: 0, End: pestanas.length - 1 }[ev.key];
  if (destino === undefined) return;
  ev.preventDefault();
  irA(pestanas[destino].dataset.pestana, { enfocar: true });
});

function mostrarErrorGeneral(e) {
  if (e.estado === 401) return;
  const zona = $('estado-global');
  zona.textContent = `No se pudo completar: ${e.message}`;
  zona.hidden = false;
  clearTimeout(mostrarErrorGeneral.t);
  mostrarErrorGeneral.t = setTimeout(() => (zona.hidden = true), 8000);
}

// ───────── Desafíos ─────────

let hoy = '';
let fechaElegida = null;
let modoDesafios = 'normal';

$('des-modo').addEventListener('change', () => {
  modoDesafios = $('des-modo').value;
  fechaElegida = null;
  $('detalle').replaceChildren();
  cargarDesafios().catch(mostrarErrorGeneral);
});

async function cargarDesafios() {
  const datos = await api('GET', conModo('/api/admin/desafios', modoDesafios));
  hoy = datos.hoy;
  $('estado-ia').replaceChildren(
    'IA ',
    h('strong', {}, datos.ia ? `${datos.ia.nombre === 'openai' ? 'OpenAI' : datos.ia.nombre === 'anthropic' ? 'Anthropic' : datos.ia.nombre} · ${datos.ia.modelo}` : 'sin configurar'),
    h('br'),
    'base ',
    h('strong', { title: datos.bd || '' }, (datos.bd || '—').split('.')[0]),
  );
  for (const herramientas of Object.values(crear)) herramientas.fechasPorDefecto(sumarDia(hoy));

  const tabla = $('tabla-desafios');
  tabla.replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', {}, '#'), h('th', {}, 'Origen'), h('th', {}, 'Modelo'), h('th', {}, 'Partidas'), h('th', {}, 'Publicado'))),
    h(
      'tbody',
      {},
      datos.desafios.length
        ? datos.desafios.map((d) =>
            h(
              'tr',
              { class: d.fecha === fechaElegida ? 'elegida' : null, 'data-fecha': d.fecha },
              h(
                'td',
                {},
                h('button', { type: 'button', class: 'boton-fila', 'aria-current': d.fecha === fechaElegida ? 'true' : null, onclick: () => verDesafio(d.fecha) }, d.fecha),
                ' ',
                d.fecha === hoy ? h('span', { class: 'etiqueta hoy' }, 'hoy') : d.fecha > hoy ? h('span', { class: 'etiqueta' }, 'futuro') : null,
              ),
              h('td', { class: 'num' }, d.numero),
              h('td', {}, etiquetaOrigen(origenDesafio(d))),
              h('td', {}, d.modelo || '—'),
              h('td', { class: 'num' }, `${d.terminadas}/${d.partidas}`),
              h('td', {}, fechaHora(d.publicado_en)),
            ),
          )
        : h('tr', {}, h('td', { colspan: 6, class: 'vacio' }, `Todavía no hay desafíos de ${NOMBRES_MODO[modoDesafios]}.`)),
    ),
  );
  if (!fechaElegida && datos.desafios.length) await verDesafio(datos.desafios.find((d) => d.fecha <= hoy)?.fecha || datos.desafios[0].fecha);
}

function sumarDia(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

let pedidoDetalle = 0;
async function verDesafio(fecha) {
  const mio = ++pedidoDetalle; // si llega una respuesta vieja después de otra elección, se descarta
  fechaElegida = fecha;
  for (const tr of $('tabla-desafios').querySelectorAll('tbody tr')) {
    const elegida = tr.dataset.fecha === fecha;
    tr.classList.toggle('elegida', elegida);
    const boton = tr.querySelector('.boton-fila');
    if (elegida) boton?.setAttribute('aria-current', 'true');
    else boton?.removeAttribute('aria-current');
  }
  const modo = modoDesafios;
  const { desafio, preguntas } = await api('GET', conModo(`/api/admin/desafios/${fecha}`, modo));
  if (mio !== pedidoDetalle) return;
  const regenerar = (estrategia) => async () => {
    await irA('crear');
    await elegirModoCrear(modo);
    crear[modo].regenerar(fecha, estrategia);
  };
  $('detalle').replaceChildren(
    h(
      'div',
      { class: 'cabecera-detalle' },
      h('h2', {}, `Desafío #${desafio.numero} · ${desafio.fecha}`),
      etiquetaModo(modo),
      etiquetaOrigen(origenDesafio(desafio)),
      modo === 'normal' ? h('button', { type: 'button', class: 'secundario chico', onclick: regenerar('auto') }, 'Regenerar') : null,
      h('button', { type: 'button', class: 'secundario chico', onclick: regenerar('reserva') }, 'Regenerar con reserva'),
    ),
    ...preguntas.map((p) =>
      h(
        'article',
        { class: 'tarjeta pregunta' },
        h(
          'p',
          { class: 'meta' },
          `${p.posicion}. ${p.categoria} · `,
          etiquetaOrigen(desafio.modelo === 'manual' ? 'manual' : p.origen),
          desafio.modelo !== 'manual' && p.reserva_id ? ` · reserva ${p.reserva_id}` : '',
          ` · ${p.totalRespuestas ?? p.respuestas.length} respuestas`,
          (p.totalRespuestas ?? 0) > p.respuestas.length ? ` (se muestran las ${p.respuestas.length} más valiosas)` : '',
        ),
        h('p', { class: 'enunciado' }, p.enunciado),
        h('p', { class: 'alcance' }, p.alcance),
        h('p', {}, h('button', { type: 'button', class: 'secundario chico', onclick: () => editarPublicada(modo, fecha, p.posicion) }, 'Editar pregunta')),
        h(
          'div',
          { class: 'tabla-envoltura' },
          h(
            'table',
            { class: 'tabla' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Pts'), h('th', {}, 'Rareza'), h('th', {}, 'Respuesta'), h('th', {}, 'Explicación y fuente'))),
            h(
              'tbody',
              {},
              [...p.respuestas]
                .sort((a, b) => b.puntos - a.puntos || a.canonica.localeCompare(b.canonica, 'es'))
                .map((r) =>
                  h(
                    'tr',
                    {},
                    h('td', { class: 'num' }, r.puntos),
                    h('td', {}, h('span', { class: `etiqueta ${r.rareza}` }, r.rareza)),
                    h('td', {}, h('strong', {}, r.canonica), r.variantes.length ? h('div', { class: 'variantes' }, `También: ${r.variantes.join(', ')}`) : null),
                    h('td', { class: 'explicacion' }, r.explicacion, ' ', enlaceSeguro(r.fuente_url, r.fuente_titulo || 'fuente')),
                  ),
                ),
            ),
          ),
        ),
        h(
          'details',
          {},
          h('summary', {}, `Fuentes (${p.fuentes.length}) y rechazos conocidos (${p.rechazos.length})`),
          h('ul', { class: 'lista' }, p.fuentes.map((f) => h('li', {}, enlaceSeguro(f.url, f.titulo || f.url)))),
          p.rechazos.length ? h('ul', { class: 'lista' }, p.rechazos.map((r) => h('li', {}, h('strong', {}, r.ejemplo || r.formas?.[0] || '—'), `: ${r.motivo}`))) : null,
        ),
      ),
    ),
  );
}

// ───────── Crear: una copia de las herramientas por modo de juego ─────────
// Cada modo (Normal, Farándula Argentina, Geografía) tiene su pestaña con generar/reserva, carga
// manual, prompt para otra IA e historial. Todas las llamadas llevan ?modo=, así las preguntas, la
// validación de repeticiones y el historial quedan separados por modo.

const NOMBRES_MODO = { normal: 'Normal', farandula: 'Farándula Argentina', geografia: 'Geografía' };
const CATEGORIA_TEMATICA = { farandula: 'farandula', geografia: 'geografia' };
const conModo = (ruta, modo) => `${ruta}${ruta.includes('?') ? '&' : '?'}modo=${modo}`;
const etiquetaModo = (modo) => (modo && modo !== 'normal' ? h('span', { class: `etiqueta modo-${modo}` }, NOMBRES_MODO[modo] || modo) : null);

const EJEMPLO_JSON = (categoria, id) => `{
  "preguntas": [
    {
      "id": "${id}",
      "categoria": "${categoria}",
      "enunciado": "Nombrá…",
      "alcance": "Cuenta…",
      "fuentes": [{ "url": "https://…", "titulo": "…" }],
      "respuestas": [
        {
          "canonica": "Respuesta",
          "variantes": ["Otra forma"],
          "rareza": "grava",
          "explicacion": "Una explicación breve."
        }
      ],
      "rechazos": [{ "textos": ["No vale"], "motivo": "Motivo." }]
    }
  ]
}`;

const EXPLICACION = {
  publicado: 'Publicado.',
  reemplazado: 'Regenerado: el día anterior se reemplazó.',
  pendiente: 'La IA no logró completar el día y el modo «solo IA» no usa la reserva: no se cambió nada. Mirá la corrida para ver por qué.',
  ocupado: 'Hay otra generación en curso para esa fecha. Probá en unos minutos.',
  fallo: 'Falló la generación. Mirá la corrida para el detalle.',
  error: 'Error.',
};

const crear = {}; // modo → herramientas montadas
let modoCrear = 'normal';

function montarCrear(modo) {
  const raiz = $(`crear-${modo}`);
  raiz.append($('plantilla-crear').content.cloneNode(true));
  // Los id llevan el modo como prefijo: «normal-imp-json», «farandula-imp-json»…
  for (const el of raiz.querySelectorAll('[data-id]')) el.id = `${modo}-${el.dataset.id}`;
  for (const el of raiz.querySelectorAll('[data-for]')) el.htmlFor = `${modo}-${el.dataset.for}`;
  const q = (id) => $(`${modo}-${id}`);
  const tematico = modo !== 'normal';
  const categoria = CATEGORIA_TEMATICA[modo];

  // Textos propios del modo.
  q('formato-ejemplo').textContent = EJEMPLO_JSON(categoria || 'geografia', tematico ? `${modo}-ejemplo` : 'geo-ejemplo');
  q('formato-reglas').textContent = tematico
    ? `Las siete preguntas son de ${NOMBRES_MODO[modo]} y llevan la categoría «${categoria}» (si falta, se completa sola). Cada pregunta necesita entre 5 y 80 respuestas, al menos tres rarezas y una respuesta diamante.`
    : 'El día debe contener exactamente una pregunta de cada categoría: geografía, historia, ciencia, deportes, cine, música y literatura. Cada pregunta necesita entre 5 y 80 respuestas, al menos tres rarezas y una respuesta diamante.';
  q('imp-json').placeholder = tematico
    ? `{"preguntas":[{"id":"${modo}-ejemplo","categoria":"${categoria}","enunciado":"…","alcance":"…","fuentes":[{"url":"https://…","titulo":"…"}],"respuestas":[…],"rechazos":[]}, …]}`
    : '{"preguntas":[{"id":"geo-ejemplo","categoria":"geografia","enunciado":"…","alcance":"…","fuentes":[{"url":"https://…","titulo":"…"}],"respuestas":[…],"rechazos":[]}, …]}';
  if (tematico) {
    // Los modos temáticos no tienen IA automática: se publican desde su reserva o con un JSON.
    q('gen-titulo').textContent = 'Publicar desde la reserva';
    q('gen-sub').textContent = `Arma el día con el banco de reserva de ${NOMBRES_MODO[modo]}. Para preguntas nuevas, usá el prompt de abajo y la carga manual.`;
    for (const opcion of q('gen-modo').querySelectorAll('option')) if (opcion.value !== 'reserva') opcion.remove();
    q('gen-boton').textContent = 'Publicar';
    q('ayuda-json').textContent = `Elegí la fecha y pegá un JSON con las siete preguntas de ${NOMBRES_MODO[modo]}. Usa el mismo formato que los bancos de reserva y no llama a ninguna IA.`;
    q('prompt-titulo').textContent = `Generar ${NOMBRES_MODO[modo]} con otra IA`;
  }

  // ── Generar / regenerar ──
  let pendiente = null;
  q('form-generar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    generar({ modo: q('gen-modo').value });
  });
  q('gen-confirmar-no').addEventListener('click', () => {
    q('gen-confirmar').hidden = true;
    pendiente = null;
  });
  q('gen-confirmar-si').addEventListener('click', () => {
    q('gen-confirmar').hidden = true;
    if (pendiente) generar(pendiente);
  });

  async function generar(opciones) {
    const fecha = q('gen-fecha').value;
    if (!fecha) return;
    const cuerpo = { modo: opciones.modo, reemplazar: Boolean(opciones.reemplazar), forzar: Boolean(opciones.forzar) };
    q('gen-confirmar').hidden = true;
    q('gen-resultado').hidden = true;
    q('gen-progreso').hidden = false;
    q('gen-boton').disabled = true;
    try {
      const r = await api('POST', conModo(`/api/admin/desafios/${fecha}/generar`, modo), cuerpo);
      mostrarResultado(r);
      await mostrarDesafioCreado(modo, fecha);
    } catch (e) {
      if (e.datos?.error === 'ya_existe') {
        pedirConfirmacion(`Ya hay un desafío de ${NOMBRES_MODO[modo]} para ${fecha}. ¿Lo regenero? El anterior se reemplaza solo si el nuevo se publica bien.`, { ...cuerpo, reemplazar: true });
      } else if (e.datos?.error === 'hay_partidas') {
        pedirConfirmacion(`${e.datos.mensaje} Esto no se puede deshacer.`, { ...cuerpo, reemplazar: true, forzar: true });
      } else {
        mostrarResultado({ resultado: 'error', error: e.message });
      }
    } finally {
      q('gen-progreso').hidden = true;
      q('gen-boton').disabled = false;
    }
  }

  function pedirConfirmacion(texto, siguiente) {
    pendiente = siguiente;
    q('gen-confirmar-texto').textContent = texto;
    q('gen-confirmar').hidden = false;
  }

  function mostrarResultado(r) {
    const ok = r.resultado === 'publicado' || r.resultado === 'reemplazado';
    const caja = q('gen-resultado');
    caja.className = `resultado ${ok ? 'ok' : 'mal'}`;
    caja.textContent = [
      EXPLICACION[r.resultado] || r.resultado,
      r.origen ? `Origen: ${r.origen}.` : '',
      r.error ? `Detalle: ${r.error}` : '',
      r.errores ? `Detalle: ${r.errores.join(' ')}` : '',
      r.corridaId ? `Corrida #${r.corridaId}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
    caja.hidden = false;
  }

  // ── Importación manual por JSON ──
  let pendienteImportacion = null;

  q('imp-archivo').addEventListener('change', async () => {
    const archivo = q('imp-archivo').files?.[0];
    if (!archivo) return;
    try {
      q('imp-json').value = await archivo.text();
      const documento = JSON.parse(q('imp-json').value);
      if (documento?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(documento.fecha)) q('imp-fecha').value = documento.fecha;
      q('imp-resultado').hidden = true;
    } catch {
      mostrarResultadoImportacion({ error: 'El archivo no contiene JSON válido.' });
    }
  });

  /** Lee las preguntas del cuadro de texto; si el JSON no sirve, muestra el error y devuelve null. */
  function preguntasDelJson() {
    let documento;
    try {
      documento = JSON.parse(q('imp-json').value);
    } catch (error) {
      mostrarResultadoImportacion({ error: `JSON inválido: ${error.message}` });
      return null;
    }
    const preguntas = Array.isArray(documento) ? documento : documento?.preguntas;
    if (!Array.isArray(preguntas)) {
      mostrarResultadoImportacion({ error: 'El JSON debe ser un arreglo de preguntas o un objeto con la propiedad «preguntas».' });
      return null;
    }
    return preguntas;
  }

  q('form-importar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const preguntas = preguntasDelJson();
    if (preguntas) importarPreguntas({ preguntas });
  });
  // Valida y compara con los últimos días sin publicar nada.
  q('imp-validar').addEventListener('click', () => {
    const preguntas = preguntasDelJson();
    if (preguntas) importarPreguntas({ preguntas, soloValidar: true });
  });
  q('imp-confirmar-no').addEventListener('click', () => {
    q('imp-confirmar').hidden = true;
    pendienteImportacion = null;
  });
  q('imp-confirmar-si').addEventListener('click', () => {
    q('imp-confirmar').hidden = true;
    if (pendienteImportacion) importarPreguntas(pendienteImportacion);
  });

  async function importarPreguntas(opciones) {
    const fecha = q('imp-fecha').value;
    if (!fecha) return;
    const cuerpo = {
      preguntas: opciones.preguntas,
      reemplazar: Boolean(opciones.reemplazar),
      forzar: Boolean(opciones.forzar),
      soloValidar: Boolean(opciones.soloValidar),
      diasSimilitud: diasHistorial(), // los mismos días que el historial que se le pasa a la IA
    };
    q('imp-confirmar').hidden = true;
    q('imp-resultado').hidden = true;
    q('imp-progreso').hidden = false;
    q('imp-boton').disabled = true;
    q('imp-validar').disabled = true;
    try {
      const resultado = await api('POST', conModo(`/api/admin/desafios/${fecha}/importar`, modo), cuerpo);
      mostrarResultadoImportacion(resultado);
      if (resultado.resultado === 'valido') return; // solo se validó: no hay nada nuevo que mostrar
      await mostrarDesafioCreado(modo, fecha);
    } catch (error) {
      if (error.datos?.error === 'ya_existe') {
        pedirConfirmacionImportacion(`Ya hay un desafío de ${NOMBRES_MODO[modo]} para ${fecha}. ¿Querés reemplazarlo por este JSON?`, { ...cuerpo, reemplazar: true });
      } else if (error.datos?.error === 'hay_partidas') {
        pedirConfirmacionImportacion(`${error.datos.mensaje} Esto también borra esas partidas y no se puede deshacer.`, { ...cuerpo, reemplazar: true, forzar: true });
      } else {
        mostrarResultadoImportacion({ error: error.message, detalles: error.datos?.detalles });
      }
    } finally {
      q('imp-progreso').hidden = true;
      q('imp-boton').disabled = false;
      q('imp-validar').disabled = false;
    }
  }

  function pedirConfirmacionImportacion(texto, siguiente) {
    pendienteImportacion = siguiente;
    q('imp-confirmar-texto').textContent = texto;
    q('imp-confirmar').hidden = false;
  }

  function mostrarResultadoImportacion(resultado) {
    const ok = ['publicado', 'reemplazado', 'valido'].includes(resultado.resultado);
    const errores = resultado.detalles?.errores || [];
    const avisos = resultado.advertencias || resultado.detalles?.advertencias || [];
    const similitudes = resultado.similitudes || resultado.detalles?.similitudes;
    const dias = resultado.diasSimilitud || resultado.detalles?.diasSimilitud;
    const titulo = {
      publicado: 'Desafío manual publicado.',
      reemplazado: 'Desafío reemplazado con el JSON manual.',
      valido: 'El JSON es válido. Todavía no se publicó: usá «Validar y publicar».',
    }[resultado.resultado];
    const sinParecidos = similitudes && similitudes.every((x) => !x.coincidencias.length);
    const caja = q('imp-resultado');
    caja.className = `resultado ${ok ? 'ok' : 'mal'}`;
    caja.textContent = [
      ok ? titulo : resultado.error || 'No se pudo publicar.',
      ...errores.map((error) => `• ${error}`),
      ...avisos.map((aviso) => `Aviso: ${aviso}`),
      sinParecidos ? `Sin similitudes con las preguntas de ${NOMBRES_MODO[modo]} de los últimos ${dias} días ni dentro del lote.` : '',
    ]
      .filter(Boolean)
      .join('\n');
    caja.hidden = false;
  }

  // ── Generar con otra IA: historial y prompt del modo ──
  // Normal conserva la clave histórica; los otros modos guardan sus ediciones aparte.
  const clavePrompt = modo === 'normal' ? 'filon_prompt_editado' : `filon_prompt_editado_${modo}`;
  let promptOriginal = null;

  async function cargarPrompt() {
    if (promptOriginal !== null) return;
    promptOriginal = (await api('GET', conModo('/api/admin/prompt', modo))).texto;
    let guardado = null;
    try {
      guardado = localStorage.getItem(clavePrompt);
    } catch {
      /* sin almacenamiento: se usa el original */
    }
    q('prompt-texto').value = guardado ?? promptOriginal;
  }

  q('prompt-texto').addEventListener('input', () => {
    try {
      if (q('prompt-texto').value === promptOriginal) localStorage.removeItem(clavePrompt);
      else localStorage.setItem(clavePrompt, q('prompt-texto').value);
    } catch {
      /* nada */
    }
  });

  q('prompt-restaurar').addEventListener('click', () => {
    q('prompt-texto').value = promptOriginal ?? '';
    try {
      localStorage.removeItem(clavePrompt);
    } catch {
      /* nada */
    }
    avisarPrompt('Se restauró el prompt original.');
  });

  const diasHistorial = () => Math.min(30, Math.max(1, Math.floor(Number(q('hist-dias').value)) || 3));

  async function pedirHistorial(formato) {
    const res = await fetch(conModo(`/api/admin/historial?dias=${diasHistorial()}&formato=${formato}`, modo), { credentials: 'same-origin' });
    if (res.status === 401) {
      mostrarIngreso('La sesión venció o se cerró. Volvé a ingresar.');
      throw new ErrorApi(401, { mensaje: 'Sesión vencida.' });
    }
    if (!res.ok) throw new ErrorApi(res.status, await res.json().catch(() => null));
    const archivo = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `filon-historial.${formato}`;
    return { res, archivo };
  }

  async function descargarHistorial(formato) {
    try {
      const { res, archivo } = await pedirHistorial(formato);
      const url = URL.createObjectURL(await res.blob());
      const enlace = h('a', { href: url, download: archivo, hidden: true });
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      avisarPrompt(`Se descargó ${archivo}.`);
    } catch (e) {
      mostrarErrorGeneral(e);
    }
  }
  q('hist-json').addEventListener('click', () => descargarHistorial('json'));
  q('hist-csv').addEventListener('click', () => descargarHistorial('csv'));

  async function copiarPrompt(conHistorial) {
    try {
      await cargarPrompt();
      let texto = q('prompt-texto').value;
      let detalle = '';
      if (conHistorial) {
        const { res } = await pedirHistorial('json');
        const datos = await res.json();
        // Lo justo para comparar: sin ids ni números internos.
        const historial = datos.preguntas.map(({ fecha, categoria, enunciado, alcance, respuestas }) => ({ fecha, categoria, enunciado, alcance, respuestas }));
        texto = insertarHistorial(texto, historial);
        detalle = ` con ${historial.length} preguntas de ${NOMBRES_MODO[modo]} desde el ${datos.desde}`;
      }
      await copiarTexto(texto);
      avisarPrompt(`Prompt copiado${detalle}. Pegalo en la IA.`);
    } catch (e) {
      mostrarErrorGeneral(e);
    }
  }
  q('prompt-copiar-historial').addEventListener('click', () => copiarPrompt(true));
  q('prompt-copiar').addEventListener('click', () => copiarPrompt(false));

  function avisarPrompt(texto) {
    q('prompt-estado').textContent = texto;
  }

  return {
    cargar: cargarPrompt,
    fechasPorDefecto(fecha) {
      if (!q('gen-fecha').value) q('gen-fecha').value = fecha;
      if (!q('imp-fecha').value) q('imp-fecha').value = fecha;
    },
    regenerar(fecha, estrategia) {
      q('gen-fecha').value = fecha;
      q('gen-modo').value = q('gen-modo').querySelector(`option[value="${estrategia}"]`) ? estrategia : 'reserva';
      q('form-generar').requestSubmit();
      q('form-generar').scrollIntoView({ behavior: 'smooth' });
    },
  };
}

for (const modo of Object.keys(NOMBRES_MODO)) crear[modo] = montarCrear(modo);

const pestanasCrear = [...document.querySelectorAll('#nav-crear [role="tab"]')];
function elegirModoCrear(modo, { enfocar = false } = {}) {
  modoCrear = modo;
  for (const b of pestanasCrear) {
    const activa = b.dataset.modo === modo;
    b.setAttribute('aria-selected', String(activa));
    b.tabIndex = activa ? 0 : -1;
    if (activa && enfocar) b.focus();
  }
  for (const m of Object.keys(NOMBRES_MODO)) $(`crear-${m}`).hidden = m !== modo;
  return crear[modo].cargar().catch(mostrarErrorGeneral);
}
for (const b of pestanasCrear) b.addEventListener('click', () => elegirModoCrear(b.dataset.modo));
$('nav-crear').addEventListener('keydown', (ev) => {
  const i = pestanasCrear.indexOf(document.activeElement);
  if (i < 0) return;
  const n = pestanasCrear.length;
  const destino = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[ev.key];
  if (destino === undefined) return;
  ev.preventDefault();
  elegirModoCrear(pestanasCrear[destino].dataset.modo, { enfocar: true });
});

/** Después de publicar desde «Crear», muestra ese día en «Desafíos» (sin cambiar de pestaña). */
async function mostrarDesafioCreado(modo, fecha) {
  modoDesafios = modo;
  $('des-modo').value = modo;
  fechaElegida = fecha;
  await cargarDesafios();
  await verDesafio(fecha);
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Sin permiso de portapapeles: se usa un área temporal seleccionada.
    const area = h('textarea', { readonly: true, class: 'solo-lector' });
    area.value = texto;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

// ───────── Editor de preguntas (publicadas y de la reserva) ─────────

const CATEGORIAS_MODO = {
  normal: [['geografia', 'Geografía'], ['historia', 'Historia'], ['ciencia', 'Ciencia'], ['deportes', 'Deportes'], ['cine', 'Cine'], ['musica', 'Música'], ['literatura', 'Literatura']],
  farandula: [['farandula', 'Farándula']],
  geografia: [['geografia', 'Geografía']],
};
const RAREZAS_EDITOR = [['grava', 'Grava · 10'], ['cobre', 'Cobre · 30'], ['plata', 'Plata · 60'], ['oro', 'Oro · 85'], ['diamante', 'Diamante · 100']];
// Qué se está editando: { tipo: 'publicada', modo, fecha, posicion } | { tipo: 'reserva', modo, nueva }.
let edicion = null;

function filaRespuesta(r = {}) {
  const celda = (hijo) => h('td', {}, hijo);
  const fila = h(
    'tr',
    {},
    celda(h('input', { class: 'ed-canonica', value: r.canonica || '', 'aria-label': 'Respuesta' })),
    celda(h('input', { class: 'ed-variantes', value: (r.variantes || []).join(', '), 'aria-label': 'Variantes' })),
    celda(h('select', { class: 'ed-rareza', 'aria-label': 'Rareza' }, RAREZAS_EDITOR.map(([v, t]) => h('option', { value: v, selected: v === (r.rareza || 'grava') }, t)))),
    celda(h('input', { class: 'ed-explicacion', value: r.explicacion || '', 'aria-label': 'Explicación' })),
    celda(h('button', { type: 'button', class: 'secundario chico', 'aria-label': 'Quitar esta respuesta', onclick: () => {
      fila.remove();
      contarRespuestas();
    } }, '✕')),
  );
  if (r.fuente?.url) fila.dataset.fuente = JSON.stringify(r.fuente); // la fuente propia se conserva tal cual
  return fila;
}

function contarRespuestas() {
  $('ed-cuenta').textContent = `(${$('ed-respuestas').children.length})`;
}

function llenarEditor(p) {
  $('ed-id').value = p.id || '';
  $('ed-categoria').value = p.categoria || $('ed-categoria').options[0]?.value || '';
  $('ed-enunciado').value = p.enunciado || '';
  $('ed-alcance').value = p.alcance || '';
  $('ed-fuentes').value = (p.fuentes || []).map((f) => `${f.url}${f.titulo ? ` | ${f.titulo}` : ''}`).join('\n');
  $('ed-respuestas').replaceChildren(...(p.respuestas || []).map(filaRespuesta));
  $('ed-rechazos').value = (p.rechazos || []).map((x) => `${(x.textos || []).join(', ')} | ${x.motivo}`).join('\n');
  $('ed-form').dataset.estructurada = p.datosEstructurados || '';
  $('ed-json').value = JSON.stringify(p, null, 2);
  contarRespuestas();
}

/** Lee el formulario y arma la pregunta en el formato de los bancos de reserva. */
function leerEditor() {
  const lineas = (texto) => texto.split('\n').map((l) => l.trim()).filter(Boolean);
  const p = {
    id: $('ed-id').value.trim(),
    categoria: $('ed-categoria').value,
    enunciado: $('ed-enunciado').value.trim(),
    alcance: $('ed-alcance').value.trim(),
    fuentes: lineas($('ed-fuentes').value).map((l) => {
      const [url, ...titulo] = l.split('|');
      return { url: url.trim(), titulo: titulo.join('|').trim() };
    }),
    respuestas: [...$('ed-respuestas').children]
      .map((fila) => ({
        canonica: fila.querySelector('.ed-canonica').value.trim(),
        variantes: fila.querySelector('.ed-variantes').value.split(',').map((x) => x.trim()).filter(Boolean),
        rareza: fila.querySelector('.ed-rareza').value,
        explicacion: fila.querySelector('.ed-explicacion').value.trim(),
        ...(fila.dataset.fuente ? { fuente: JSON.parse(fila.dataset.fuente) } : {}),
      }))
      .filter((r) => r.canonica),
    rechazos: lineas($('ed-rechazos').value).map((l) => {
      const i = l.lastIndexOf('|');
      return { textos: (i < 0 ? l : l.slice(0, i)).split(',').map((x) => x.trim()).filter(Boolean), motivo: i < 0 ? '' : l.slice(i + 1).trim() };
    }),
  };
  if ($('ed-form').dataset.estructurada) p.datosEstructurados = $('ed-form').dataset.estructurada;
  return p;
}

function abrirEditor(pregunta, contexto, { titulo, sub, aviso = '' }) {
  edicion = contexto;
  $('ed-titulo').textContent = titulo;
  $('ed-sub').textContent = sub;
  $('ed-aviso').textContent = aviso;
  $('ed-categoria').replaceChildren(...CATEGORIAS_MODO[contexto.modo].map(([v, t]) => h('option', { value: v }, t)));
  // En una pregunta publicada la categoría no cambia (el día conserva su reparto) y el id tampoco.
  $('ed-categoria').disabled = contexto.tipo === 'publicada' || CATEGORIAS_MODO[contexto.modo].length === 1;
  $('ed-id').readOnly = !(contexto.tipo === 'reserva' && contexto.nueva);
  $('ed-resultado').hidden = true;
  llenarEditor(pregunta);
  $('dlg-editor').showModal();
  $('ed-enunciado').focus();
}

async function editarPublicada(modo, fecha, posicion) {
  try {
    const datos = await api('GET', conModo(`/api/admin/desafios/${fecha}/preguntas/${posicion}`, modo));
    abrirEditor(datos.pregunta, { tipo: 'publicada', modo, fecha, posicion }, {
      titulo: `Editar la pregunta ${posicion} del ${fecha}`,
      sub: `${NOMBRES_MODO[modo]} · se guarda también en la reserva`,
      aviso: datos.jugadas
        ? `Ya se jugó ${datos.jugadas} ${datos.jugadas === 1 ? 'vez' : 'veces'}: los puntos de esas partidas no cambian y no se pueden quitar respuestas que ya dio algún jugador.`
        : '',
    });
  } catch (e) {
    mostrarErrorGeneral(e);
  }
}

function mostrarResultadoEditor(ok, texto, detalles) {
  const caja = $('ed-resultado');
  caja.className = `resultado ${ok ? 'ok' : 'mal'}`;
  caja.textContent = [
    texto,
    ...(detalles?.errores || []).map((e) => `• ${e}`),
    ...(detalles?.descartadas || []).map((d) => `• Respuesta «${d.canonica}»: ${d.motivo}`),
    ...(detalles?.advertencias || []).map((a) => `Aviso: ${a}`),
  ]
    .filter(Boolean)
    .join('\n');
  caja.hidden = false;
  caja.scrollIntoView({ block: 'nearest' });
}

async function guardarEditor(soloValidar) {
  if (!edicion) return;
  const pregunta = leerEditor();
  const ruta = edicion.tipo === 'publicada' ? conModo(`/api/admin/desafios/${edicion.fecha}/preguntas/${edicion.posicion}`, edicion.modo) : conModo('/api/admin/reserva', edicion.modo);
  $('ed-guardar').disabled = true;
  $('ed-validar').disabled = true;
  try {
    const r = await api('POST', ruta, { pregunta, soloValidar });
    if (soloValidar) return mostrarResultadoEditor(true, 'La pregunta es válida. Todavía no se guardó.', r);
    $('dlg-editor').close();
    if (edicion.tipo === 'publicada') {
      modoDesafios = edicion.modo;
      $('des-modo').value = edicion.modo;
      await verDesafio(edicion.fecha);
    } else await cargarReserva();
  } catch (e) {
    mostrarResultadoEditor(false, e.message, e.datos?.detalles);
  } finally {
    $('ed-guardar').disabled = false;
    $('ed-validar').disabled = false;
  }
}

$('ed-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  guardarEditor(false);
});
$('ed-validar').addEventListener('click', () => guardarEditor(true));
$('ed-cerrar').addEventListener('click', () => $('dlg-editor').close());
$('ed-agregar').addEventListener('click', () => {
  const fila = filaRespuesta();
  $('ed-respuestas').append(fila);
  contarRespuestas();
  fila.querySelector('input').focus();
});
$('ed-desde-json').addEventListener('click', () => {
  try {
    const p = JSON.parse($('ed-json').value);
    llenarEditor({ ...p, id: $('ed-id').readOnly ? $('ed-id').value : p.id });
    mostrarResultadoEditor(true, 'Se pasó el JSON al formulario. Revisalo y guardá.');
  } catch (e) {
    mostrarResultadoEditor(false, `JSON inválido: ${e.message}`);
  }
});
// Al abrir el JSON se actualiza con lo que haya en el formulario.
$('ed-json').closest('details').addEventListener('toggle', (ev) => {
  if (ev.target.open) $('ed-json').value = JSON.stringify(leerEditor(), null, 2);
});

// ───────── Reserva ─────────

let modoReserva = 'normal';
$('reserva-modo').addEventListener('change', () => {
  modoReserva = $('reserva-modo').value;
  cargarReserva().catch(mostrarErrorGeneral);
});
$('reserva-nueva').addEventListener('click', () => {
  const categoria = CATEGORIAS_MODO[modoReserva][0][0];
  abrirEditor({ categoria, fuentes: [], respuestas: [{}, {}, {}, {}, {}], rechazos: [] }, { tipo: 'reserva', modo: modoReserva, nueva: true }, {
    titulo: 'Nueva pregunta de reserva',
    sub: `${NOMBRES_MODO[modoReserva]} · el id se completa solo si lo dejás vacío`,
  });
});

const ORIGENES_RESERVA = { archivo: 'archivo', manual: 'cargada', ia: 'IA', edicion: 'editada' };

async function cargarReserva() {
  const { preguntas, invalidas } = await api('GET', conModo('/api/admin/reserva', modoReserva));
  const activas = preguntas.filter((p) => p.activa).length;
  $('reserva-nota').textContent = `${activas} activa(s) de ${preguntas.length}`;
  const cambiar = (id, activa) => async () => {
    await api('POST', conModo('/api/admin/reserva/estado', modoReserva), { id, activa }).catch(mostrarErrorGeneral);
    await cargarReserva();
  };
  $('reserva-lista').replaceChildren(
    ...(invalidas.length
      ? [h('p', { class: 'error' }, `${invalidas.length} pregunta(s) guardadas ya no pasan la validación y no se usan: ${invalidas.map((i) => `${i.id} (${i.errores[0]})`).join('; ')}`)]
      : []),
    preguntas.length
      ? h(
          'div',
          { class: 'tabla-envoltura' },
          h(
            'table',
            { class: 'tabla reserva-tabla' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Pregunta'), h('th', {}, 'Categoría'), h('th', { class: 'num' }, 'Resp.'), h('th', {}, 'Origen'), h('th', {}, 'Usada'), h('th', {}, ''))),
            h(
              'tbody',
              {},
              preguntas.map((r) =>
                h(
                  'tr',
                  { class: r.activa ? null : 'inactiva' },
                  h('td', { class: 'enunciado-celda' }, h('strong', {}, r.pregunta.enunciado), h('span', { class: 'vacio' }, r.id)),
                  h('td', {}, r.pregunta.categoria),
                  h('td', { class: 'num' }, r.pregunta.respuestas.length),
                  h('td', {}, h('span', { class: `etiqueta ${r.origen}` }, ORIGENES_RESERVA[r.origen] || r.origen), r.activa ? null : [' ', h('span', { class: 'etiqueta mal' }, 'inactiva')]),
                  h('td', {}, r.usos ? `${r.usos.veces} ${r.usos.veces === 1 ? 'vez' : 'veces'} · última ${r.usos.ultima}` : 'nunca'),
                  h(
                    'td',
                    {},
                    h(
                      'div',
                      { class: 'acciones' },
                      h('button', { type: 'button', class: 'secundario chico', onclick: () => abrirEditor(r.pregunta, { tipo: 'reserva', modo: modoReserva, nueva: false }, { titulo: 'Editar pregunta de reserva', sub: `${NOMBRES_MODO[modoReserva]} · ${r.id}` }) }, 'Editar'),
                      h('button', { type: 'button', class: 'secundario chico', onclick: cambiar(r.id, !r.activa) }, r.activa ? 'Desactivar' : 'Activar'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'vacio' }, 'No hay preguntas en la reserva de este modo.'),
  );
}

// ───────── Corridas ─────────

async function cargarCorridas() {
  const { corridas } = await api('GET', '/api/admin/corridas');
  const lista = (titulo, items, render) =>
    items?.length ? [h('h3', {}, `${titulo} (${items.length})`), h('ul', { class: 'lista' }, items.map((x) => h('li', {}, render(x))))] : [];
  $('pestana-corridas').replaceChildren(
    ...(corridas.length
      ? corridas.map((c) => {
          const d = c.detalle || {};
          const ok = c.resultado.startsWith('publicado');
          return h(
            'details',
            { class: 'tarjeta corrida' },
            h(
              'summary',
              {},
              h('strong', {}, `#${c.id} · ${c.fecha_objetivo}`),
              etiquetaModo(c.modo),
              h('span', { class: `etiqueta ${ok ? 'ia' : c.resultado === 'en_curso' ? '' : 'mal'}` }, c.resultado),
              c.uso_ia ? h('span', { class: 'etiqueta' }, `IA ${d.modelo || ''}`) : null,
              d.reemplaza ? h('span', { class: 'etiqueta mixto' }, 'regeneración') : null,
              h('span', { class: 'vacio' }, `${fechaHora(c.iniciada_en)}${c.terminada_en ? ` · ${Math.round((c.terminada_en - c.iniciada_en) / 1000)} s` : ''}`),
            ),
            h(
              'div',
              { class: 'cuerpo' },
              d.errorIA ? h('p', { class: 'error' }, `Error de IA: ${d.errorIA}`) : null,
              d.error ? h('p', { class: 'error' }, `Error: ${String(d.error).split('\n')[0]}`) : null,
              d.errorLote ? h('p', { class: 'error' }, `Lote inválido: ${d.errorLote.join(' ')}`) : null,
              ...lista('Publicadas', d.publicadas, (p) => [`${p.categoria} · `, etiquetaOrigen(p.origen), ` · ${p.respuestas} resp. · ${p.enunciado}`]),
              ...lista('Avisos', d.avisos, (a) => a),
              ...lista('Preguntas rechazadas', d.rechazadas, (r) => [h('strong', {}, `[${r.etapa}] `), r.enunciado || r.categoria || '', ': ', (r.motivos || []).join(' · ')]),
              ...lista('Respuestas descartadas', d.descartes, (r) => [h('strong', {}, `[${r.etapa}] ${r.canonica || ''}`), ` — ${r.motivo || ''}`, r.enunciado ? h('span', { class: 'vacio' }, ` (${r.enunciado})`) : '']),
              ...lista('Pasos', d.pasos, (p) => JSON.stringify(p)),
            ),
          );
        })
      : [h('p', { class: 'vacio' }, 'Todavía no hay corridas.')]),
  );
}

// ───────── Reportes ─────────

async function cargarReportes() {
  const { reportes } = await api('GET', '/api/admin/reportes');
  const pendientes = reportes.filter((r) => r.estado === 'pendiente').length;
  $('insignia-reportes').textContent = pendientes;
  $('insignia-reportes').hidden = !pendientes;
  const cambiar = (id, estado) => async () => {
    await api('POST', `/api/admin/reportes/${id}`, { estado }).catch(mostrarErrorGeneral);
    await cargarReportes();
  };
  $('pestana-reportes').replaceChildren(
    reportes.length
      ? h(
          'div',
          { class: 'tabla-envoltura' },
          h(
            'table',
            { class: 'tabla' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Respuesta'), h('th', {}, 'Veces'), h('th', {}, 'Pregunta'), h('th', {}, 'Comentario'), h('th', {}, 'Estado'), h('th', {}, ''))),
            h(
              'tbody',
              {},
              reportes.map((r) =>
                h(
                  'tr',
                  {},
                  h('td', {}, h('strong', {}, r.texto), h('div', { class: 'vacio' }, fechaHora(r.creado_en))),
                  h('td', { class: 'num' }, r.veces),
                  h('td', {}, h('div', { class: 'vacio' }, r.pregunta_id, ' ', etiquetaModo(r.modo)), r.enunciado),
                  h('td', {}, r.comentario || '—'),
                  h('td', {}, h('span', { class: `etiqueta ${r.estado === 'aceptado' ? 'ia' : r.estado === 'descartado' ? 'mal' : ''}` }, r.estado)),
                  h(
                    'td',
                    {},
                    h(
                      'div',
                      { class: 'acciones' },
                      r.estado !== 'aceptado' ? h('button', { type: 'button', class: 'secundario chico', onclick: cambiar(r.id, 'aceptado') }, 'Aceptar') : null,
                      r.estado !== 'descartado' ? h('button', { type: 'button', class: 'secundario chico', onclick: cambiar(r.id, 'descartado') }, 'Descartar') : null,
                      r.estado !== 'pendiente' ? h('button', { type: 'button', class: 'secundario chico', onclick: cambiar(r.id, 'pendiente') }, 'Pendiente') : null,
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'vacio' }, 'No hay reportes.'),
  );
}

// ───────── Resumen ─────────

const resumen = { rango: 30, datos: null, modo: 'normal' };
const fechaCorta = (f) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const RAREZAS = ['diamante', 'oro', 'plata', 'cobre', 'grava'];
const NOMBRE_RAREZA = { grava: 'Grava', cobre: 'Cobre', plata: 'Plata', oro: 'Oro', diamante: 'Diamante' };

function restarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

$('est-fecha').addEventListener('change', () => $('est-fecha').value && cargarResumen());
$('est-modo').addEventListener('change', () => {
  resumen.modo = $('est-modo').value;
  cargarResumen().catch(mostrarErrorGeneral);
});
for (const b of document.querySelectorAll('[data-rango]')) {
  b.addEventListener('click', () => {
    resumen.rango = Number(b.dataset.rango);
    for (const x of document.querySelectorAll('[data-rango]')) x.setAttribute('aria-pressed', String(x === b));
    cargarResumen();
  });
}
new ResizeObserver(() => resumen.datos && dibujarGraficos(resumen.datos)).observe($('resumen'));

async function cargarResumen() {
  const fecha = $('est-fecha').value || hoy || '';
  const consulta = fecha ? `?fecha=${fecha}&hasta=${fecha}&desde=${restarDias(fecha, resumen.rango - 1)}` : '';
  $('resumen').classList.add('recargando'); // conserva lo anterior atenuado mientras carga
  try {
    const datos = await api('GET', conModo(`/api/admin/estadisticas${consulta}`, resumen.modo));
    if (!$('est-fecha').value) $('est-fecha').value = datos.fecha;
    $('est-fecha').max = sumarDia(datos.hoy);
    resumen.datos = datos;
    pintarResumen(datos);
  } finally {
    $('resumen').classList.remove('recargando');
  }
}

function tile(etiqueta, valor, detalle) {
  return h('div', { class: 'kpi' }, h('p', { class: 'kpi-etiqueta' }, etiqueta), h('p', { class: 'kpi-valor' }, valor), detalle ? h('p', { class: 'kpi-detalle' }, detalle) : null);
}

function variacion(actual, anterior, nombre = 'el día anterior') {
  if (anterior == null) return null;
  const d = actual - anterior;
  if (!d) return `= igual que ${nombre}`;
  return `${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs ${nombre}`;
}

function pintarResumen(e) {
  const dia = e.dia;
  const t = e.totales;
  const anterior = e.serie.length > 1 ? e.serie.at(-2) : null;
  const insignia = $('insignia-reportes');
  insignia.textContent = t.reportesPendientes;
  insignia.hidden = !t.reportesPendientes;
  $('est-nota').textContent = dia
    ? `Desafío #${dia.numero}${e.fecha === e.hoy ? ' · hoy' : ''}`
    : `No hay desafío publicado el ${e.fecha}.`;

  $('kpis').replaceChildren(
    tile('Jugaron', fmt(dia?.jugadores ?? 0), variacion(dia?.jugadores ?? 0, anterior?.desafio ? anterior.jugadores : null)),
    tile('Terminaron', fmt(dia?.terminadas ?? 0), dia?.jugadores ? `${pct(dia.terminadas, dia.jugadores)}% de los que empezaron` : 'nadie empezó todavía'),
    tile('Profundidad promedio', dia?.resumen ? `${fmt(dia.resumen.promedio)} m` : '—', dia?.resumen ? `mediana ${fmt(dia.resumen.mediana)} m` : 'sin partidas terminadas'),
    tile('Jugadores únicos', fmt(t.jugadores), `${fmt(t.visitantes)} abrieron el juego`),
    tile('Volvieron', fmt(t.recurrentes), t.jugadores ? `${pct(t.recurrentes, t.jugadores)}% jugó 2 días o más` : 'desde el primer día'),
  );

  const conDesafio = e.serie.filter((d) => d.desafio);
  const totalPeriodo = conDesafio.reduce((a, d) => a + d.jugadores, 0);
  $('dias-sub').textContent = `${fmt(totalPeriodo)} partidas en los últimos ${e.serie.length} días · promedio ${fmt(conDesafio.length ? totalPeriodo / conDesafio.length : 0)} por día. Tocá una columna para ver ese día.`;
  $('tabla-dias').replaceChildren(
    tabla(
      ['Fecha', 'Desafío', 'Empezaron', 'Terminaron', 'Prom. profundidad', 'Visitantes nuevos'],
      [...e.serie].reverse().map((d) => [d.fecha, d.numero ? `#${d.numero}` : '—', fmt(d.jugadores), fmt(d.terminadas), d.promedioMetros == null ? '—' : `${fmt(d.promedioMetros)} m`, fmt(d.visitantesNuevos)]),
    ),
  );

  $('campana-sub').textContent = dia?.terminadas
    ? `${fmt(dia.terminadas)} partidas terminadas del ${e.fecha}, en tramos de 500 m.${dia.terminadas < 3 ? ' Con menos de 3 no se ajusta la campana.' : ''}`
    : `Sin partidas terminadas el ${e.fecha}.`;
  const histograma = (dia?.distribucion || []).map((f) => ({ valor: f.metros, cantidad: f.cantidad }));
  const cuentas = tramos(histograma, 7000, 500);
  $('tabla-campana').replaceChildren(tabla(['Tramo', 'Partidas', '% del total'], cuentas.map((c) => [`${fmt(c.desde)}–${fmt(c.hasta)} m`, fmt(c.cantidad), `${pct(c.cantidad, dia?.terminadas || 0)}%`])));

  pintarNumeros(e);
  pintarPreguntas(dia);
  dibujarGraficos(e);
}

function dibujarGraficos(e) {
  columnasApiladas($('graf-dias'), {
    elegida: e.fecha,
    alElegir: (fecha) => {
      $('est-fecha').value = fecha;
      cargarResumen();
    },
    dias: e.serie.map((d) => ({
      fecha: d.fecha,
      etiqueta: fechaCorta(d.fecha),
      desafio: d.desafio,
      titulo: `${d.fecha}${d.numero ? ` · desafío #${d.numero}` : ''}`,
      segmentos: [
        { valor: d.terminadas, clase: 's1', nombre: 'terminaron' },
        { valor: d.jugadores - d.terminadas, clase: 's2', nombre: 'sin terminar' },
      ],
      filas: d.desafio
        ? [
            { valor: fmt(d.jugadores), etiqueta: 'empezaron' },
            { valor: fmt(d.terminadas), etiqueta: 'terminaron', clave: 's1' },
            { valor: fmt(d.jugadores - d.terminadas), etiqueta: 'sin terminar', clave: 's2' },
            ...(d.promedioMetros == null ? [] : [{ valor: `${fmt(d.promedioMetros)} m`, etiqueta: 'de profundidad promedio' }]),
          ]
        : [{ valor: 'Sin desafío', etiqueta: 'ese día' }],
    })),
  });
  campana($('graf-campana'), { valores: (e.dia?.distribucion || []).map((f) => ({ valor: f.metros, cantidad: f.cantidad })), resumen: e.dia?.resumen });
}

function pintarNumeros(e) {
  const dia = e.dia;
  $('numeros-sub').textContent = dia ? `Desafío #${dia.numero} · ${e.fecha}` : e.fecha;
  const r = dia?.resumen;
  const filas = dia
    ? [
        ['Empezaron', fmt(dia.jugadores)],
        ['Terminaron', `${fmt(dia.terminadas)} (${pct(dia.terminadas, dia.jugadores)}%)`],
        ['Sin terminar', fmt(dia.enCurso)],
        ['Promedio', r ? `${fmt(r.promedio)} m` : '—'],
        ['Mediana', r ? `${fmt(r.mediana)} m` : '—'],
        ['Desvío estándar', r ? `${fmt(r.desviacion)} m` : '—'],
        ['Mitad central (25–75%)', r ? `${fmt(r.p25)}–${fmt(r.p75)} m` : '—'],
        ['Mínimo y máximo', r ? `${fmt(r.minimo)} · ${fmt(r.maximo)} m` : '—'],
        ['Llegaron al fondo (7.000 m)', fmt((dia.distribucion || []).filter((f) => f.metros >= 7000).reduce((a, f) => a + f.cantidad, 0))],
      ]
    : [['Sin desafío', 'Elegí otro día o generá uno en «Crear».']];
  $('numeros').replaceChildren(...filas.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function pintarPreguntas(dia) {
  const destino = $('tabla-preguntas');
  if (!dia) return destino.replaceChildren(h('p', { class: 'vacio' }, 'No hay desafío ese día.'));
  destino.replaceChildren(
    h(
      'table',
      { class: 'tabla tabla-preguntas' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Pregunta'), h('th', {}, 'Resultado'), h('th', { class: 'num' }, 'Prom.'), h('th', {}, 'Rarezas halladas'), h('th', {}, 'Más respondidas'), h('th', {}, 'Intentos fallidos'))),
      h(
        'tbody',
        {},
        dia.preguntas.map((q) =>
          h(
            'tr',
            {},
            h('td', { class: 'col-pregunta', 'data-etiqueta': 'Pregunta' }, h('span', { class: 'pregunta-meta' }, `${q.posicion} · ${q.categoria}`), h('span', { class: 'pregunta-texto' }, q.enunciado)),
            h(
              'td',
              { class: 'col-resultado', 'data-etiqueta': 'Resultado' },
              barraResultado(
                [
                  { valor: q.acertadas, clase: 's1', nombre: 'acertó' },
                  { valor: q.vencidas, clase: 's2', nombre: 'se le apagó la mecha' },
                  { valor: q.pasadas, clase: 's3', nombre: 'pasó' },
                ],
                `Pregunta ${q.posicion}`,
              ),
              h('span', { class: 'resultado-texto' }, q.jugadas ? `${pct(q.acertadas, q.jugadas)}% acertó · ${fmt(q.jugadas)} jugadas` : 'Sin jugadas'),
            ),
            h('td', { class: 'num', 'data-etiqueta': 'Profundidad promedio' }, q.promedioMetros == null ? '—' : `${fmt(q.promedioMetros)} m`),
            h('td', { 'data-etiqueta': 'Rarezas halladas' }, chipsRarezas(q.rarezas)),
            h('td', { 'data-etiqueta': 'Más respondidas' }, chips(q.topAceptadas.slice(0, 3), false)),
            h('td', { 'data-etiqueta': 'Intentos fallidos' }, chips(q.topFallidas.slice(0, 4), true)),
          ),
        ),
      ),
    ),
  );
}

function chipsRarezas(rarezas) {
  const presentes = RAREZAS.filter((r) => rarezas[r]);
  if (!presentes.length) return h('span', { class: 'vacio' }, '—');
  return h('ul', { class: 'chips' }, presentes.map((r) => h('li', { class: 'chip' }, h('i', { class: `punto ${r}`, 'aria-hidden': 'true' }), `${NOMBRE_RAREZA[r]} ${fmt(rarezas[r])}`)));
}

function chips(lista, fallidas) {
  if (!lista.length) return h('span', { class: 'vacio' }, '—');
  return h(
    'ul',
    { class: 'chips' },
    lista.map((x) =>
      h(
        'li',
        { class: `chip${fallidas && x.veces >= 2 ? ' alerta' : ''}`, title: fallidas && x.veces >= 2 ? 'Varias personas lo intentaron: revisá si falta en la veta.' : null },
        x.texto,
        h('b', {}, ` ×${fmt(x.veces)}`),
      ),
    ),
  );
}

function tabla(cabeceras, filas) {
  return h(
    'table',
    { class: 'tabla' },
    h('thead', {}, h('tr', {}, cabeceras.map((c, i) => h('th', { class: i ? 'num' : null }, c)))),
    h('tbody', {}, filas.map((f) => h('tr', {}, f.map((v, i) => h('td', { class: i ? 'num' : null }, v))))),
  );
}

// ───────── Inicio ─────────

api('GET', '/api/admin/sesion')
  .then((s) => (s.autenticado ? iniciarPanel() : mostrarIngreso(s.habilitado ? '' : 'El panel está deshabilitado: falta TOKEN_ADMIN en el servidor.')))
  .catch(() => mostrarIngreso('No se pudo contactar al servidor.'));
