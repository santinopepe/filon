// Panel de administración: desafíos, corridas de generación, reportes y generación manual.
// Todo el contenido (que puede venir de la IA) se inserta como texto, nunca como HTML.
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
  $('salir').hidden = false;
}

// ───────── Pestañas ─────────

const cargadores = { desafios: cargarDesafios, corridas: cargarCorridas, reportes: cargarReportes };
for (const boton of document.querySelectorAll('[data-pestana]')) {
  boton.addEventListener('click', () => {
    for (const b of document.querySelectorAll('[data-pestana]')) b.setAttribute('aria-selected', String(b === boton));
    for (const nombre of Object.keys(cargadores)) $(`pestana-${nombre}`).hidden = nombre !== boton.dataset.pestana;
    cargadores[boton.dataset.pestana]().catch(mostrarErrorGeneral);
  });
}

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
    'IA: ',
    h('strong', {}, datos.ia ? `${datos.ia.modelo}` : 'sin configurar (solo reserva)'),
    ` · hoy ${datos.hoy}`,
  );
  if (!$('gen-fecha').value) $('gen-fecha').value = sumarDia(hoy);

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
              h('td', {}, etiquetaOrigen(d.origen)),
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
      etiquetaOrigen(desafio.origen),
      h('button', { type: 'button', class: 'secundario chico', onclick: regenerar('auto') }, 'Regenerar'),
      h('button', { type: 'button', class: 'secundario chico', onclick: regenerar('reserva') }, 'Regenerar con reserva'),
    ),
    ...preguntas.map((p) =>
      h(
        'article',
        { class: 'tarjeta pregunta' },
        h('p', { class: 'meta' }, `${p.posicion}. ${p.categoria} · `, etiquetaOrigen(p.origen), p.reserva_id ? ` · reserva ${p.reserva_id}` : '', ` · ${p.respuestas.length} respuestas`),
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

// ───────── Inicio ─────────

if (token) {
  cargarDesafios()
    .then(mostrarPanel)
    .catch(() => salir());
} else {
  salir();
}
