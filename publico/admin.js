// Panel de administración: resumen con estadísticas, desafíos, creación, corridas y reportes.
// Todo el contenido (que puede venir de la IA o de los jugadores) se inserta como texto, nunca como HTML.
import { fmt, columnasApiladas, campana, barraResultado, tramos, ocultarTooltip } from './admin-graficos.js';

const CLAVE_TOKEN = 'filon_admin_token';
const $ = (id) => document.getElementById(id);

let token = '';
try {
  token = localStorage.getItem(CLAVE_TOKEN) || '';
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
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await res.json().catch(() => null);
  if (res.status === 401) {
    salir();
    throw new ErrorApi(401, { mensaje: 'Token inválido.' });
  }
  if (!res.ok) throw new ErrorApi(res.status, datos);
  return datos;
}

// ───────── Ingreso ─────────

function salir() {
  token = '';
  try {
    localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    /* nada */
  }
  $('panel').hidden = true;
  $('nav').hidden = true;
  $('salir').hidden = true;
  $('estado-ia').textContent = '';
  $('ingreso').hidden = false;
}

$('ingreso').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  token = $('token').value.trim();
  $('error-ingreso').hidden = true;
  try {
    await cargarDesafios();
    try {
      localStorage.setItem(CLAVE_TOKEN, token);
    } catch {
      /* solo dura la sesión */
    }
    mostrarPanel();
  } catch (e) {
    $('error-ingreso').textContent = e.message;
    $('error-ingreso').hidden = false;
  }
});
$('salir').addEventListener('click', salir);

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
  crear: async () => {},
  corridas: cargarCorridas,
  reportes: cargarReportes,
};
function irA(nombre) {
  ocultarTooltip();
  for (const b of document.querySelectorAll('[data-pestana]')) b.setAttribute('aria-selected', String(b.dataset.pestana === nombre));
  for (const n of Object.keys(cargadores)) $(`pestana-${n}`).hidden = n !== nombre;
  return cargadores[nombre]().catch(mostrarErrorGeneral);
}
for (const boton of document.querySelectorAll('[data-pestana]')) boton.addEventListener('click', () => irA(boton.dataset.pestana));

function mostrarErrorGeneral(e) {
  if (e.estado !== 401) alert?.(e.message);
}

// ───────── Desafíos ─────────

let hoy = '';
let fechaElegida = null;

async function cargarDesafios() {
  const datos = await api('GET', '/api/admin/desafios');
  hoy = datos.hoy;
  $('estado-ia').replaceChildren(
    'IA ',
    h('strong', {}, datos.ia ? `${datos.ia.nombre === 'openai' ? 'OpenAI' : datos.ia.nombre === 'anthropic' ? 'Anthropic' : datos.ia.nombre} · ${datos.ia.modelo}` : 'sin configurar'),
    h('br'),
    'base ',
    h('strong', { title: datos.bd || '' }, (datos.bd || '—').split('.')[0]),
  );
  if (!$('gen-fecha').value) $('gen-fecha').value = sumarDia(hoy);
  if (!$('imp-fecha').value) $('imp-fecha').value = sumarDia(hoy);

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
              { class: `clic${d.fecha === fechaElegida ? ' elegida' : ''}`, tabindex: 0, onclick: () => verDesafio(d.fecha), onkeydown: (ev) => ev.key === 'Enter' && verDesafio(d.fecha) },
              h('td', {}, d.fecha, ' ', d.fecha === hoy ? h('span', { class: 'etiqueta hoy' }, 'hoy') : d.fecha > hoy ? h('span', { class: 'etiqueta' }, 'futuro') : null),
              h('td', { class: 'num' }, d.numero),
              h('td', {}, etiquetaOrigen(origenDesafio(d))),
              h('td', {}, d.modelo || '—'),
              h('td', { class: 'num' }, `${d.terminadas}/${d.partidas}`),
              h('td', {}, fechaHora(d.publicado_en)),
            ),
          )
        : h('tr', {}, h('td', { colspan: 6, class: 'vacio' }, 'Todavía no hay desafíos.')),
    ),
  );
  if (!fechaElegida && datos.desafios.length) await verDesafio(datos.desafios.find((d) => d.fecha <= hoy)?.fecha || datos.desafios[0].fecha);
}

function sumarDia(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function verDesafio(fecha) {
  fechaElegida = fecha;
  for (const tr of $('tabla-desafios').querySelectorAll('tbody tr')) tr.classList.toggle('elegida', tr.firstChild?.firstChild?.textContent === fecha);
  const { desafio, preguntas } = await api('GET', `/api/admin/desafios/${fecha}`);
  const regenerar = (modo) => () => {
    irA('crear');
    $('gen-fecha').value = fecha;
    $('gen-modo').value = modo;
    $('form-generar').requestSubmit();
    $('form-generar').scrollIntoView({ behavior: 'smooth' });
  };
  $('detalle').replaceChildren(
    h(
      'div',
      { class: 'cabecera-detalle' },
      h('h2', {}, `Desafío #${desafio.numero} · ${desafio.fecha}`),
      etiquetaOrigen(origenDesafio(desafio)),
      h('button', { type: 'button', class: 'secundario chico', onclick: regenerar('auto') }, 'Regenerar'),
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
          ` · ${p.respuestas.length} respuestas`,
        ),
        h('p', { class: 'enunciado' }, p.enunciado),
        h('p', { class: 'alcance' }, p.alcance),
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

// ───────── Generar / regenerar ─────────

let pendiente = null;

$('form-generar').addEventListener('submit', (ev) => {
  ev.preventDefault();
  generar({ modo: $('gen-modo').value });
});
$('gen-confirmar-no').addEventListener('click', () => {
  $('gen-confirmar').hidden = true;
  pendiente = null;
});
$('gen-confirmar-si').addEventListener('click', () => {
  $('gen-confirmar').hidden = true;
  if (pendiente) generar(pendiente);
});

async function generar(opciones) {
  const fecha = $('gen-fecha').value;
  if (!fecha) return;
  const cuerpo = { modo: opciones.modo, reemplazar: Boolean(opciones.reemplazar), forzar: Boolean(opciones.forzar) };
  $('gen-confirmar').hidden = true;
  $('gen-resultado').hidden = true;
  $('gen-progreso').hidden = false;
  $('gen-boton').disabled = true;
  try {
    const r = await api('POST', `/api/admin/desafios/${fecha}/generar`, cuerpo);
    mostrarResultado(r);
    fechaElegida = fecha;
    await cargarDesafios();
    await verDesafio(fecha);
  } catch (e) {
    if (e.datos?.error === 'ya_existe') {
      pedirConfirmacion(`Ya hay un desafío para ${fecha}. ¿Lo regenero? El anterior se reemplaza solo si el nuevo se publica bien.`, { ...cuerpo, reemplazar: true });
    } else if (e.datos?.error === 'hay_partidas') {
      pedirConfirmacion(`${e.datos.mensaje} Esto no se puede deshacer.`, { ...cuerpo, reemplazar: true, forzar: true });
    } else {
      mostrarResultado({ resultado: 'error', error: e.message });
    }
  } finally {
    $('gen-progreso').hidden = true;
    $('gen-boton').disabled = false;
  }
}

function pedirConfirmacion(texto, siguiente) {
  pendiente = siguiente;
  $('gen-confirmar-texto').textContent = texto;
  $('gen-confirmar').hidden = false;
}

const EXPLICACION = {
  publicado: 'Publicado.',
  reemplazado: 'Regenerado: el día anterior se reemplazó.',
  pendiente: 'La IA no logró completar el día y el modo «solo IA» no usa la reserva: no se cambió nada. Mirá la corrida para ver por qué.',
  ocupado: 'Hay otra generación en curso para esa fecha. Probá en unos minutos.',
  fallo: 'Falló la generación. Mirá la corrida para el detalle.',
  error: 'Error.',
};

function mostrarResultado(r) {
  const ok = r.resultado === 'publicado' || r.resultado === 'reemplazado';
  const caja = $('gen-resultado');
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

// ───────── Importación manual por JSON ─────────

let pendienteImportacion = null;

$('imp-archivo').addEventListener('change', async () => {
  const archivo = $('imp-archivo').files?.[0];
  if (!archivo) return;
  try {
    $('imp-json').value = await archivo.text();
    const documento = JSON.parse($('imp-json').value);
    if (documento?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(documento.fecha)) $('imp-fecha').value = documento.fecha;
    $('imp-resultado').hidden = true;
  } catch {
    mostrarResultadoImportacion({ error: 'El archivo no contiene JSON válido.' });
  }
});

$('form-importar').addEventListener('submit', (ev) => {
  ev.preventDefault();
  let documento;
  try {
    documento = JSON.parse($('imp-json').value);
  } catch (error) {
    mostrarResultadoImportacion({ error: `JSON inválido: ${error.message}` });
    return;
  }
  const preguntas = Array.isArray(documento) ? documento : documento?.preguntas;
  if (!Array.isArray(preguntas)) {
    mostrarResultadoImportacion({ error: 'El JSON debe ser un arreglo de preguntas o un objeto con la propiedad «preguntas».' });
    return;
  }
  importarPreguntas({ preguntas });
});

$('imp-confirmar-no').addEventListener('click', () => {
  $('imp-confirmar').hidden = true;
  pendienteImportacion = null;
});
$('imp-confirmar-si').addEventListener('click', () => {
  $('imp-confirmar').hidden = true;
  if (pendienteImportacion) importarPreguntas(pendienteImportacion);
});

async function importarPreguntas(opciones) {
  const fecha = $('imp-fecha').value;
  if (!fecha) return;
  const cuerpo = {
    preguntas: opciones.preguntas,
    reemplazar: Boolean(opciones.reemplazar),
    forzar: Boolean(opciones.forzar),
  };
  $('imp-confirmar').hidden = true;
  $('imp-resultado').hidden = true;
  $('imp-progreso').hidden = false;
  $('imp-boton').disabled = true;
  try {
    const resultado = await api('POST', `/api/admin/desafios/${fecha}/importar`, cuerpo);
    mostrarResultadoImportacion(resultado);
    fechaElegida = fecha;
    await cargarDesafios();
    await verDesafio(fecha);
  } catch (error) {
    if (error.datos?.error === 'ya_existe') {
      pedirConfirmacionImportacion(`Ya hay un desafío para ${fecha}. ¿Querés reemplazarlo por este JSON?`, { ...cuerpo, reemplazar: true });
    } else if (error.datos?.error === 'hay_partidas') {
      pedirConfirmacionImportacion(`${error.datos.mensaje} Esto también borra esas partidas y no se puede deshacer.`, { ...cuerpo, reemplazar: true, forzar: true });
    } else {
      mostrarResultadoImportacion({ error: error.message, detalles: error.datos?.detalles });
    }
  } finally {
    $('imp-progreso').hidden = true;
    $('imp-boton').disabled = false;
  }
}

function pedirConfirmacionImportacion(texto, siguiente) {
  pendienteImportacion = siguiente;
  $('imp-confirmar-texto').textContent = texto;
  $('imp-confirmar').hidden = false;
}

function mostrarResultadoImportacion(resultado) {
  const ok = resultado.resultado === 'publicado' || resultado.resultado === 'reemplazado';
  const errores = resultado.detalles?.errores || [];
  const avisos = resultado.advertencias || [];
  const caja = $('imp-resultado');
  caja.className = `resultado ${ok ? 'ok' : 'mal'}`;
  caja.textContent = [
    ok ? (resultado.resultado === 'reemplazado' ? 'Desafío reemplazado con el JSON manual.' : 'Desafío manual publicado.') : resultado.error || 'No se pudo publicar.',
    ...errores.map((error) => `• ${error}`),
    ...avisos.map((aviso) => `Aviso: ${aviso}`),
  ].join('\n');
  caja.hidden = false;
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
                  h('td', {}, h('div', { class: 'vacio' }, r.pregunta_id), r.enunciado),
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

const resumen = { rango: 30, datos: null };
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
    const datos = await api('GET', `/api/admin/estadisticas${consulta}`);
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
  const cuentas = tramos(dia?.metros || [], 7000, 500);
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
  campana($('graf-campana'), { valores: e.dia?.metros || [], resumen: e.dia?.resumen });
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
        ['Llegaron al fondo (7.000 m)', fmt((dia.metros || []).filter((m) => m >= 7000).length)],
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

if (token) {
  cargarDesafios()
    .then(mostrarPanel)
    .catch(() => salir());
} else {
  salir();
}
