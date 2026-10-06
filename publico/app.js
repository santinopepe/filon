// Filón — interfaz del juego. El servidor decide tiempos, respuestas y puntos; acá solo se muestra.
// Hay tres modos (Normal, Farándula Argentina y Geografía), cada uno con su desafío diario, su escena
// y sus textos; el modo elegido viaja en la URL (?modo=…) para que una recarga vuelva al mismo.
import { MODOS, esModo, crearFormato } from './modos.js';
import { crearSonido } from './sonido.js';

const $ = (id) => document.getElementById(id);
const PROFUNDIDAD_MAXIMA = 7000;
const EMOJI = { grava: '🪨', cobre: '🟧', plata: '⬜', oro: '🟨', diamante: '💎' };
const numero = new Intl.NumberFormat('es-AR');
const fmt = (n) => numero.format(Math.round(n));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const elegir = (lista) => lista[Math.floor(Math.random() * lista.length)];

const ESTADOS_MODO = { disponible: 'Disponible', en_curso: 'En curso', jugado: 'Jugado hoy', preparando: 'Preparándose' };

// ───────── Preferencias ─────────
function leerPrefs() {
  try {
    return JSON.parse(localStorage.getItem('filon:prefs')) || {};
  } catch {
    return {};
  }
}
function guardarPrefs() {
  try {
    localStorage.setItem('filon:prefs', JSON.stringify(prefs));
  } catch {
    /* sin almacenamiento local: se usa el valor en memoria */
  }
}
const prefs = leerPrefs();
if (prefs.sonido === undefined) prefs.sonido = true;
if (prefs.reducir === undefined) prefs.reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Modo inicial: el de la URL; si no hay, el último elegido en este navegador; si no, Normal.
function modoInicial() {
  const enUrl = new URLSearchParams(location.search).get('modo');
  if (esModo(enUrl)) return enUrl;
  return esModo(prefs.modo) ? prefs.modo : 'normal';
}

// ───────── Estado ─────────
const estado = {
  modo: modoInicial(),
  general: null,
  partida: null,
  pantalla: 'cargando',
  ocupado: false,
  marcoMecha: null,
  esperaVencimiento: null,
  segundoTic: null,
  avisoLector: new Set(),
  completadaAlCargar: false,
};
let desfase = 0;
const ahoraServidor = () => Date.now() + desfase;
const ronda = (n) => estado.partida?.rondas.find((r) => r.posicion === n);

// Espacio donde se dibuja a Lito. En las preguntas y los resultados queda centrado entre el bloque
// de arriba (número y pregunta) y el de abajo (respuesta o resultado).
function zonaLibre() {
  const movil = innerWidth < 860;
  if (estado.pantalla === 'ronda' || estado.pantalla === 'resultado') {
    const seccion = $(`p-${estado.pantalla}`);
    const arriba = seccion.querySelector('.ronda-arriba').getBoundingClientRect().bottom;
    const abajo = seccion.querySelector('.ronda-abajo').getBoundingClientRect().top;
    return { movil, centrado: true, izquierda: 0, derecha: innerWidth, arriba, abajo: Math.max(abajo, arriba + 120) };
  }
  if (estado.pantalla === 'inicio' || estado.pantalla === 'cargando') {
    return { movil, centrado: true, izquierda: 0, derecha: innerWidth, arriba: 60 - scrollY, abajo: 260 - scrollY };
  }
  if (estado.pantalla === 'final') {
    return { movil, centrado: true, izquierda: 0, derecha: innerWidth, arriba: 120, abajo: innerHeight - 120 };
  }
  const panel = $('panel').getBoundingClientRect();
  if (movil) return { movil, izquierda: 0, derecha: innerWidth, arriba: 54, abajo: panel.top > 60 ? panel.top : innerHeight * 0.34 };
  return { movil, izquierda: 70, derecha: panel.left > 200 ? panel.left : innerWidth - 500, arriba: 60, abajo: innerHeight };
}

// Lo propio del modo activo: configuración, textos y formato de distancias.
const modo = () => MODOS[estado.modo];
const textos = () => modo().textos;
const frases = (clave) => modo().frases[clave];
let formato = crearFormato(estado.modo, fmt);
const dist = (metros) => formato.dist(metros);

let escena = null; // la crea aplicarModo() al arrancar y cada vez que se cambia de modo
const sonido = crearSonido({ activo: prefs.sonido });

/** Aplica la ambientación de un modo: escena, colores, profundímetro y textos fijos. */
function aplicarModo(clave) {
  estado.modo = clave;
  formato = crearFormato(clave, fmt);
  escena?.detener();
  escena = modo().crearEscena($('escena'), { alCambiarProfundidad: mostrarProfundidad, zonaLibre });
  escena.reducido = prefs.reducir;
  escena.fijarProfundidad(0, { animar: false });
  for (const c of Object.keys(MODOS)) document.body.classList.toggle(`modo-${c}`, c === clave);
  document.title = modo().titulo;
  construirProfundimetro();
  pintarTextosDelModo();
}

function pintarTextosDelModo() {
  const t = textos();
  $('inicio-bajada').textContent = t.bajada;
  $('inicio-regla-avance').textContent = t.reglaAvance;
  $('inicio-modo').textContent = modo().nombre;
  $('inicio-preparando').textContent = t.preparando;
  $('btn-retomar').textContent = t.retomar;
  $('ayuda-avance').textContent = t.ayudaAvance;
  $('final-unidad').textContent = modo().unidad.palabra;
  $('recorrido-titulo').textContent = t.recorridoTitulo;
  $('recorrido-texto').textContent = t.recorridoTexto;
  $('tope').textContent = formato.total;
}

// ───────── Utilidades de interfaz ─────────
async function api(metodo, ruta, cuerpo) {
  const t0 = Date.now();
  const opciones = { method: metodo, credentials: 'same-origin', headers: {} };
  if (metodo !== 'GET') {
    opciones.headers['content-type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo ?? {});
  }
  let res;
  try {
    res = await fetch(ruta, opciones);
  } catch {
    throw new Error('No pudimos conectar con la expedición. Revisá tu conexión.');
  }
  const t1 = Date.now();
  let datos = {};
  try {
    datos = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }
  const enServidor = datos.ahora ?? datos.partida?.ahora;
  if (typeof enServidor === 'number' && t1 - t0 < 4000) desfase = enServidor - (t0 + t1) / 2;
  if (!res.ok) {
    const e = new Error(datos.mensaje || 'Algo falló. Probá de nuevo.');
    e.codigo = datos.error;
    e.estado = res.status;
    throw e;
  }
  return datos;
}

let temporizadorAviso = null;
function aviso(texto) {
  const el = $('aviso');
  el.textContent = texto;
  el.classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('visible'), 3800);
}

function anunciar(texto) {
  const el = $('lector');
  el.textContent = '';
  setTimeout(() => (el.textContent = texto), 40);
}

let temporizadorBurbuja = null;
function decir(texto, ms = 3800) {
  const b = $('burbuja');
  b.textContent = texto;
  b.hidden = false;
  clearTimeout(temporizadorBurbuja);
  temporizadorBurbuja = setTimeout(() => (b.hidden = true), ms);
}

function sonarGolpe() {
  sonido[modo().sonidoGolpe]?.();
}

function pose(clase, ms) {
  const m = $('minero');
  m.classList.remove('cavando', 'bajando', 'festejando', 'triste');
  if (clase) m.classList.add(clase);
  if (clase && ms) setTimeout(() => m.classList.remove(clase), ms);
}

function fechaLarga(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, d)));
}
function fechaCorta(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return `${d}/${m}/${a}`;
}
function horaLocal(ms) {
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: estado.general?.zona || 'America/Argentina/Buenos_Aires' }).format(new Date(ms));
}
function reloj(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function mostrar(pantalla) {
  for (const id of ['cargando', 'inicio', 'ronda', 'resultado', 'final']) $(`p-${id}`).hidden = id !== pantalla;
  document.body.classList.toggle('en-inicio', pantalla === 'inicio' || pantalla === 'cargando');
  document.body.classList.toggle('en-excavacion', pantalla === 'ronda' || pantalla === 'resultado');
  document.body.classList.toggle('en-pagina', ['inicio', 'cargando', 'final'].includes(pantalla));
  document.body.classList.toggle('en-final', pantalla === 'final');
  document.body.classList.remove('en-recorrido');
  $('recorrido').hidden = true;
  estado.pantalla = pantalla;
  $('panel').scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });
  escena.disponer();
}

// El scroll de la página recorre únicamente la parte de la mina que se excavó.
function actualizarRecorrido() {
  if (estado.pantalla === 'inicio' || estado.pantalla === 'cargando') {
    escena.disponer();
    return;
  }
  if (estado.pantalla !== 'final') return;
  const recorrido = $('recorrido');
  if (recorrido.hidden) return;
  const inicio = recorrido.getBoundingClientRect().top + scrollY - innerHeight * .35;
  const fin = document.documentElement.scrollHeight - innerHeight;
  const progreso = Math.max(0, Math.min(1, (scrollY - inicio) / Math.max(1, fin - inicio)));
  document.body.classList.toggle('en-recorrido', scrollY >= inicio);
  escena.fijarProfundidad(estado.partida.profundidad * progreso, { animar: false });
}

let marcoScroll = null;
addEventListener('scroll', () => {
  if (marcoScroll !== null) return;
  marcoScroll = requestAnimationFrame(() => {
    marcoScroll = null;
    actualizarRecorrido();
  });
}, { passive: true });
addEventListener('resize', actualizarRecorrido);

// ───────── Barra de profundidad ─────────
// Lo recorrido muestra los colores de las etapas del modo (estratos, zonas de la alfombra o continentes);
// lo que falta queda a oscuras. La orientación (vertical en escritorio, horizontal en celulares) la
// resuelve el CSS con --pct.
function construirProfundimetro() {
  const escala = $('escala');
  for (const viejo of escala.querySelectorAll('.franja, .marca-km')) viejo.remove();
  let desde = 0;
  for (const e of modo().etapas.slice(1)) {
    const hasta = Math.min(e.hasta, PROFUNDIDAD_MAXIMA);
    const franja = document.createElement('div');
    franja.className = 'franja';
    franja.style.setProperty('--desde', (desde / PROFUNDIDAD_MAXIMA) * 100);
    franja.style.setProperty('--largo', ((hasta - desde) / PROFUNDIDAD_MAXIMA) * 100);
    franja.style.background = e.barra ?? `rgb(${e.base.map((c) => Math.min(255, c * 1.6)).join(' ')})`;
    escala.prepend(franja);
    desde = hasta;
  }
  for (let km = 1000; km < PROFUNDIDAD_MAXIMA; km += 1000) {
    const marca = document.createElement('span');
    marca.className = 'marca-km';
    marca.style.setProperty('--pos', (km / PROFUNDIDAD_MAXIMA) * 100);
    escala.append(marca);
  }
}

function mostrarProfundidad(m) {
  const metros = Math.max(0, m);
  const pct = (Math.min(metros, PROFUNDIDAD_MAXIMA) / PROFUNDIDAD_MAXIMA) * 100;
  $('profundimetro').style.setProperty('--pct', pct.toFixed(2));
  $('marcador-texto').textContent = dist(metros);
  const estrato = modo().etapaDe(metros).titulo;
  if ($('marcador-estrato').textContent !== estrato) $('marcador-estrato').textContent = estrato;
}

function dibujarPepitas() {
  for (const ol of document.querySelectorAll('.pepitas')) ol.replaceChildren(...pepitas());
}

function pepitas() {
  return estado.partida.rondas.map((r) => {
      const li = document.createElement('li');
      li.dataset.estado = r.estado;
      if (r.respuesta) li.dataset.rareza = r.respuesta.rareza;
      const t = document.createElement('span');
      t.textContent = r.posicion;
      li.append(t);
      li.setAttribute(
        'aria-label',
        r.estado === 'acertada'
          ? `Ronda ${r.posicion}: ${r.respuesta.nombreRareza}, ${r.puntos} puntos`
          : r.estado === 'activa'
            ? `Ronda ${r.posicion}: en juego`
            : r.estado === 'pendiente'
              ? `Ronda ${r.posicion}: pendiente`
              : `Ronda ${r.posicion}: sin puntos`,
      );
      return li;
  });
}

// ───────── Inicio ─────────
function renderInicio() {
  const g = estado.general;
  const t = textos();
  mostrar('inicio');
  escena.fijarProfundidad(0, { animar: false });
  $('inicio-meta').textContent = g.desafio ? `Desafío #${g.desafio.numero} · ${fechaLarga(g.desafio.fecha)}` : '';
  $('inicio-preparando').hidden = Boolean(g.desafio);
  const boton = $('btn-comenzar');
  boton.disabled = !g.desafio;
  const hoy = g.partidaHoy;
  const empezada = hoy && !hoy.terminada && hoy.rondas.some((r) => r.estado !== 'pendiente');
  boton.textContent = empezada ? t.seguir : t.comenzar;
  const prog = $('inicio-progreso');
  if (empezada) {
    const hechas = hoy.rondas.filter((r) => r.estado !== 'pendiente' && r.estado !== 'activa').length;
    prog.textContent = t.progreso(hechas, dist(hoy.profundidad));
    prog.hidden = false;
  } else prog.hidden = true;

  const pend = g.partidaPendiente;
  $('inicio-pendiente').hidden = !pend;
  if (pend) $('inicio-pendiente-texto').textContent = t.pendiente(pend.numero, fechaLarga(pend.fecha), horaLocal(pend.retomarHasta));
  pintarOtrosModos();
  tickCuentas();
  decir(elegir(frases('inicio')), 5000);
}

async function recargarGeneral() {
  estado.general = await api('GET', `/api/estado?modo=${estado.modo}`);
  return estado.general;
}

// ───────── Selector de modos ─────────
function etiquetaEstadoModo(m) {
  if (m.estado === 'jugado' && m.profundidad != null) return `${ESTADOS_MODO.jugado} · ${crearFormato(m.clave, fmt).dist(m.profundidad)}`;
  return ESTADOS_MODO[m.estado] || m.estado;
}

/** Marca en el selector qué modos siguen disponibles hoy y cuáles ya se jugaron. */
function pintarSelector() {
  const resumen = new Map((estado.general?.modos || []).map((m) => [m.clave, m]));
  for (const boton of document.querySelectorAll('.modo-opcion')) {
    const clave = boton.dataset.modo;
    const m = resumen.get(clave);
    const etiqueta = boton.querySelector('.modo-estado');
    etiqueta.dataset.estado = m?.estado || 'preparando';
    etiqueta.textContent = m ? etiquetaEstadoModo(m) : '';
    const actual = clave === estado.modo;
    if (actual) boton.setAttribute('aria-current', 'true');
    else boton.removeAttribute('aria-current');
    boton.setAttribute('aria-label', `${MODOS[clave].nombre}${m ? `: ${etiqueta.textContent}` : ''}${actual ? ' (modo actual)' : ''}`);
  }
}

/** En el inicio, un resumen de cómo están los otros dos modos hoy. */
function pintarOtrosModos() {
  const otros = (estado.general?.modos || []).filter((m) => m.clave !== estado.modo);
  $('inicio-otros').textContent = otros.length
    ? `${otros.map((m) => `${m.nombre}: ${etiquetaEstadoModo(m).toLowerCase()}`).join(' · ')}.`
    : '';
}

function abrirSelector() {
  if (estado.pantalla === 'ronda') {
    aviso('Terminá la ronda antes de cambiar de modo: el tiempo sigue corriendo.');
    return;
  }
  pintarSelector();
  const dlg = $('dlg-modos');
  $('btn-modos').setAttribute('aria-expanded', 'true');
  dlg.showModal();
  (dlg.querySelector('.modo-opcion[aria-current]') || dlg.querySelector('.modo-opcion'))?.focus();
  // Lo que se muestra al abrir puede ser de antes de jugar: se actualiza desde el servidor.
  recargarGeneral()
    .then(() => dlg.open && pintarSelector())
    .catch(() => {
      /* sin conexión: queda lo último conocido */
    });
}

async function elegirModo(clave) {
  $('dlg-modos').close();
  if (!esModo(clave) || clave === estado.modo || estado.ocupado) return;
  prefs.modo = clave;
  guardarPrefs();
  const url = new URL(location.href);
  if (clave === 'normal') url.searchParams.delete('modo');
  else url.searchParams.set('modo', clave);
  history.replaceState(null, '', url);
  detenerMecha();
  estado.partida = null;
  aplicarModo(clave);
  await abrirModo();
}

// ───────── Flujo de partida ─────────
async function comenzar(partidaExistente = null) {
  if (estado.ocupado) return;
  sonido.desbloquear();
  estado.ocupado = true;
  $('btn-comenzar').disabled = true;
  try {
    estado.partida = partidaExistente || (await api('POST', '/api/partidas', { modo: estado.modo })).partida;
    estado.ocupado = false;
    await entrarEnPartida(true);
  } catch (e) {
    estado.ocupado = false;
    if (e.codigo === 'sin_desafio') $('inicio-preparando').hidden = false;
    aviso(e.message);
    $('btn-comenzar').disabled = false;
  }
}

async function entrarEnPartida(animarBajada) {
  const p = estado.partida;
  dibujarPepitas();
  if (p.terminada) return mostrarFinal();
  if (animarBajada && p.profundidad > 0) {
    mostrar(p.rondaActiva ? 'ronda' : 'resultado');
    $('p-resultado').hidden = true;
    pose('bajando');
    sonido.descenso(escena.duracionDescenso(p.profundidad) / 1000);
    await escena.fijarProfundidad(p.profundidad);
    pose(null);
  } else {
    escena.fijarProfundidad(p.profundidad, { animar: false });
  }
  // Partida nueva: Lito baja de la limusina o carretea por la pista (en la mina no hay entrada).
  if (animarBajada && !p.rondaActiva && p.rondas.every((r) => r.estado === 'pendiente') && escena.entrada) {
    mostrar('resultado');
    $('p-resultado').hidden = true;
    pose('bajando');
    await escena.entrada();
    pose(null);
  }
  if (p.rondaActiva) return mostrarRonda(p.rondaActiva);
  const cerradas = p.rondas.filter((r) => r.estado !== 'pendiente' && r.estado !== 'activa');
  if (!animarBajada && cerradas.length) return mostrarResultado(cerradas[cerradas.length - 1].posicion, { animar: false });
  if (p.siguiente) return iniciarRonda(p.siguiente);
  return mostrarFinal();
}

async function iniciarRonda(n) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  try {
    const { partida } = await api('POST', `/api/partidas/${estado.partida.id}/rondas/${n}/iniciar`);
    estado.partida = partida;
    estado.ocupado = false;
    mostrarRonda(n);
  } catch (e) {
    estado.ocupado = false;
    aviso(e.message);
    try {
      estado.partida = (await api('GET', `/api/partidas/${estado.partida.id}`)).partida;
      entrarEnPartida(false);
    } catch {
      /* se mantiene la pantalla actual */
    }
  }
}

function mostrarRonda(n) {
  const r = ronda(n);
  mostrar('ronda');
  dibujarPepitas();
  pose(null);
  $('ronda-num').textContent = `Pregunta ${n} de 7`;
  $('ronda-categoria').textContent = r.categoria;
  $('ronda-enunciado').textContent = r.enunciado;
  $('ronda-alcance').textContent = r.alcance;
  $('ronda-mensaje').textContent = '';
  $('ronda-mensaje').classList.remove('error');
  escena.disponer();
  const campo = $('campo-respuesta');
  campo.value = '';
  campo.disabled = false;
  $('btn-responder').disabled = false;
  $('btn-pasar').disabled = false;
  $('mecha').classList.remove('apagada', 'urgente');
  campo.focus({ preventScroll: true });
  iniciarMecha(n, r.limiteEn);
  decir(elegir(frases('ronda')), 3200);
  anunciar(`Ronda ${n} de 7. ${r.categoria}. ${r.enunciado} Tenés ${estado.partida.segundosPorPregunta} segundos.`);
}

function detenerMecha() {
  cancelAnimationFrame(estado.marcoMecha);
  clearTimeout(estado.esperaVencimiento);
  estado.marcoMecha = null;
}

function iniciarMecha(n, limite) {
  detenerMecha();
  const total = estado.partida.segundosPorPregunta * 1000;
  estado.avisoLector = new Set();
  const resto = $('mecha-resto');
  const num = $('mecha-num');
  const paso = () => {
    const queda = limite - ahoraServidor();
    resto.style.width = `${Math.max(0, Math.min(1, queda / total)) * 100}%`;
    const seg = Math.max(0, Math.ceil(queda / 1000));
    if (num.textContent !== String(seg)) {
      num.textContent = seg;
      if (seg <= 5 && seg > 0) sonido.tic();
      if ((seg === 10 || seg === 5) && !estado.avisoLector.has(seg)) {
        estado.avisoLector.add(seg);
        anunciar(`Quedan ${seg} segundos.`);
      }
    }
    $('mecha').classList.toggle('urgente', queda <= 5000);
    if (queda <= 0) return mechaApagada(n, limite);
    estado.marcoMecha = requestAnimationFrame(paso);
  };
  paso();
}

function mechaApagada(n, limite) {
  detenerMecha();
  $('campo-respuesta').disabled = true;
  $('btn-responder').disabled = true;
  $('btn-pasar').disabled = true;
  $('mecha').classList.add('apagada');
  const m = $('ronda-mensaje');
  m.textContent = 'Se apagó la mecha…';
  m.classList.remove('error');
  sonido.apagado();
  pose('triste');
  const gracia = estado.partida.graciaMs ?? 1500;
  estado.esperaVencimiento = setTimeout(() => cerrarVencida(n, 0), Math.max(0, limite + gracia + 250 - ahoraServidor()));
}

async function cerrarVencida(n, intento) {
  try {
    estado.partida = (await api('GET', `/api/partidas/${estado.partida.id}`)).partida;
    if (ronda(n).estado === 'activa' && intento < 8) {
      estado.esperaVencimiento = setTimeout(() => cerrarVencida(n, intento + 1), 600);
      return;
    }
    mostrarResultado(n, { animar: true });
  } catch (e) {
    aviso(e.message);
    estado.esperaVencimiento = setTimeout(() => cerrarVencida(n, intento + 1), 1500);
  }
}

async function responder(ev) {
  ev.preventDefault();
  const campo = $('campo-respuesta');
  const texto = campo.value.trim();
  const n = estado.partida?.rondaActiva;
  if (!n || estado.ocupado || campo.disabled) return;
  const mensaje = $('ronda-mensaje');
  if (!texto) {
    mensaje.textContent = 'Escribí una respuesta antes de enviar.';
    mensaje.classList.add('error');
    campo.focus();
    return;
  }
  estado.ocupado = true;
  $('btn-responder').disabled = true;
  try {
    const r = await api('POST', `/api/partidas/${estado.partida.id}/rondas/${n}/respuesta`, { texto });
    estado.partida = r.partida;
    if (r.resultado === 'sugerida') {
      campo.value = r.sugerencia;
      campo.select();
      mensaje.textContent = `¿Quisiste decir «${r.sugerencia}»? Apretá Enter de nuevo para confirmarla.`;
      mensaje.classList.remove('error');
      anunciar(`Respuesta completada: ${r.sugerencia}. Apretá Enter de nuevo para confirmarla.`);
      estado.ocupado = false;
      $('btn-responder').disabled = false;
      campo.focus({ preventScroll: true });
      return;
    }
    if (r.resultado === 'aceptada') {
      detenerMecha();
      campo.disabled = true;
      $('btn-pasar').disabled = true;
      estado.ocupado = false;
      await celebrar(n);
      return;
    }
    if (r.resultado === 'rechazada') {
      sonido.rechazo();
      const form = $('form-respuesta');
      form.classList.remove('sacudir');
      void form.offsetWidth;
      form.classList.add('sacudir');
      mensaje.textContent = r.repetida
        ? `Ya probaste «${texto}».`
        : r.motivo
          ? `«${texto}» no vale: ${r.motivo}`
          : `«${texto}» no está en la veta. Probá otra.`;
      mensaje.classList.add('error');
      campo.value = '';
      if (Math.random() < 0.35) decir(elegir(frases('rechazo')), 2200);
    } else if (r.resultado === 'vacia') {
      mensaje.textContent = 'Escribí una respuesta antes de enviar.';
      mensaje.classList.add('error');
    } else {
      detenerMecha();
      estado.ocupado = false;
      mostrarResultado(n, { animar: true });
      return;
    }
  } catch (e) {
    mensaje.textContent = e.message;
    mensaje.classList.add('error');
  }
  estado.ocupado = false;
  if (ronda(n)?.estado === 'activa') {
    $('btn-responder').disabled = false;
    campo.focus({ preventScroll: true });
  }
}

async function pasar() {
  const n = estado.partida?.rondaActiva;
  if (!n || estado.ocupado) return;
  estado.ocupado = true;
  detenerMecha();
  try {
    estado.partida = (await api('POST', `/api/partidas/${estado.partida.id}/rondas/${n}/pasar`)).partida;
    estado.ocupado = false;
    mostrarResultado(n, { animar: true });
  } catch (e) {
    estado.ocupado = false;
    aviso(e.message);
  }
}

async function celebrar(n) {
  const r = ronda(n);
  const rareza = r.respuesta.rareza;
  mostrarResultado(n, { animar: true, enCurso: true });
  if (!prefs.reducir) {
    pose('cavando');
    for (const t of [140, 500, 860]) {
      setTimeout(() => {
        escena.golpe();
        sonarGolpe();
      }, t);
    }
    await esperar(1080);
    pose(null);
    const origen = escena.descubrir(rareza);
    sonido.acierto(rareza);
    volarGema(origen, n, rareza);
    await esperar(420);
    pose('bajando');
    sonido.descenso(escena.duracionDescenso(r.metros) / 1000);
    await escena.fijarProfundidad(estado.partida.profundidad);
    pose('festejando', 1100);
  } else {
    sonido.acierto(rareza);
    await escena.fijarProfundidad(estado.partida.profundidad, { animar: false });
  }
  dibujarPepitas();
  decir(elegir(frases(rareza)), 3200);
  habilitarSiguiente();
}

function volarGema(origen, n, rareza) {
  const destino = $('pepitas-resultado').children[n - 1]?.getBoundingClientRect();
  const gema = $('gema-vuela');
  if (!destino || !gema.animate) return;
  gema.dataset.rareza = rareza;
  gema.hidden = false;
  const fin = { x: destino.left + destino.width / 2, y: destino.top + destino.height / 2 };
  const anim = gema.animate(
    [
      { transform: `translate(${origen.x}px, ${origen.y}px) scale(.4)`, opacity: 0 },
      { transform: `translate(${origen.x}px, ${origen.y - 40}px) scale(1.3)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${fin.x}px, ${fin.y}px) scale(.8)`, opacity: 1 },
    ],
    { duration: 820, easing: 'cubic-bezier(.35,.1,.25,1)' },
  );
  gema.style.left = '0px';
  gema.style.top = '0px';
  anim.onfinish = () => {
    gema.hidden = true;
    dibujarPepitas();
  };
}

function habilitarSiguiente() {
  const b = $('btn-siguiente');
  b.disabled = false;
  b.textContent = estado.partida.siguiente ? textos().siguiente : 'Ver el resultado final';
}

function negrita(texto) {
  const fuerte = document.createElement('strong');
  fuerte.textContent = texto;
  return fuerte;
}

function botonRespuestas(r, texto) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'respuesta-abrir';
  boton.textContent = texto;
  boton.setAttribute('aria-label', `${texto}. Ver todas las respuestas válidas de la pregunta ${r.posicion}`);
  boton.addEventListener('click', () => abrirRespuestas(r.posicion));
  return boton;
}

// Revelado paginado: se piden y se dibujan de a 100 (el servidor no entrega más por página).
const revelado = { n: null, buscar: '', siguiente: 0, pidiendo: false, espera: null };

function filaRespuesta(respuesta, propia) {
  const li = document.createElement('li');
  li.dataset.rareza = respuesta.rareza;
  if (respuesta.canonica === propia) li.classList.add('es-tuya');
  const gema = document.createElement('span');
  gema.className = 'piedra';
  const nombre = document.createElement('span');
  nombre.className = 'respuesta-nombre';
  nombre.textContent = respuesta.canonica;
  if (respuesta.canonica === propia) {
    const tuya = document.createElement('small');
    tuya.textContent = 'Tu respuesta';
    nombre.append(tuya);
  }
  const rareza = document.createElement('span');
  rareza.className = 'respuesta-rareza';
  rareza.textContent = respuesta.nombreRareza;
  const puntos = document.createElement('strong');
  puntos.className = 'respuesta-puntos';
  puntos.textContent = `${respuesta.puntos} pts`;
  li.append(gema, nombre, rareza, puntos);
  return li;
}

async function pedirPaginaRespuestas({ reiniciar = false } = {}) {
  const r = ronda(revelado.n);
  if (!r || revelado.pidiendo || (!reiniciar && revelado.siguiente == null)) return;
  revelado.pidiendo = true;
  const lista = $('lista-respuestas');
  const mas = $('respuestas-mas');
  if (reiniciar) {
    revelado.siguiente = 0;
    const carga = document.createElement('li');
    carga.className = 'respuestas-cargando';
    carga.textContent = 'Extrayendo el catálogo de la veta…';
    lista.replaceChildren(carga);
  }
  mas.disabled = true;
  try {
    const q = new URLSearchParams({ desde: String(revelado.siguiente), limite: '100' });
    if (revelado.buscar) q.set('buscar', revelado.buscar);
    const datos = await api('GET', `/api/partidas/${estado.partida.id}/rondas/${revelado.n}/respuestas?${q}`);
    if (reiniciar) lista.replaceChildren();
    const fragmento = document.createDocumentFragment();
    for (const respuesta of datos.respuestas) fragmento.append(filaRespuesta(respuesta, r.respuesta?.canonica));
    lista.append(fragmento);
    if (!datos.coincidencias) {
      const vacio = document.createElement('li');
      vacio.className = 'respuestas-cargando';
      vacio.textContent = 'Ninguna respuesta válida coincide con esa búsqueda.';
      lista.append(vacio);
    }
    revelado.siguiente = datos.siguiente;
    const mostradas = lista.querySelectorAll('li:not(.respuestas-cargando)').length;
    $('respuestas-ayuda').textContent = revelado.buscar
      ? `${fmt(datos.coincidencias)} de ${fmt(datos.total)} respuestas coinciden. Mostrando ${fmt(mostradas)}.`
      : `${fmt(datos.total)} respuestas, ordenadas de mayor a menor puntaje.${datos.total > mostradas ? ` Mostrando ${fmt(mostradas)}.` : ''}`;
    mas.hidden = datos.siguiente == null;
  } catch (e) {
    lista.replaceChildren(Object.assign(document.createElement('li'), { className: 'respuestas-cargando', textContent: e.message }));
  } finally {
    revelado.pidiendo = false;
    mas.disabled = false;
  }
}

async function abrirRespuestas(n) {
  const r = ronda(n);
  if (!r?.totalRespuestas) return;
  revelado.n = n;
  revelado.buscar = '';
  $('respuestas-ronda').textContent = `Pregunta ${r.posicion} de 7 · ${r.categoria}`;
  $('respuestas-pregunta').textContent = r.enunciado;
  $('respuestas-ayuda').textContent = `${fmt(r.totalRespuestas)} respuestas, ordenadas de mayor a menor puntaje.`;
  $('respuestas-buscar').value = '';
  $('respuestas-buscar-caja').hidden = r.totalRespuestas <= 30;
  $('respuestas-mas').hidden = true;
  const dlg = $('dlg-respuestas');
  if (!dlg.open) dlg.showModal();
  await pedirPaginaRespuestas({ reiniciar: true });
}

$('respuestas-mas').addEventListener('click', () => pedirPaginaRespuestas());
$('respuestas-buscar').addEventListener('input', () => {
  clearTimeout(revelado.espera);
  revelado.espera = setTimeout(() => {
    revelado.buscar = $('respuestas-buscar').value.trim().slice(0, 60);
    pedirPaginaRespuestas({ reiniciar: true });
  }, 250);
});

function mostrarResultado(n, { animar = false, enCurso = false } = {}) {
  const r = ronda(n);
  detenerMecha();
  mostrar('resultado');
  dibujarPepitas();
  $('res-ronda').textContent = `Pregunta ${n} de 7`;
  $('res-categoria').textContent = r.categoria;
  $('res-enunciado').textContent = r.enunciado || '';
  const h = $('hallazgo');
  const respuesta = $('res-respuesta');
  respuesta.replaceChildren();
  const fuenteP = $('res-fuente-p');
  if (r.estado === 'acertada') {
    const a = r.respuesta;
    h.dataset.rareza = a.rareza;
    $('res-titulo').textContent = a.nombreRareza;
    $('res-puntos').textContent = `+${r.puntos} puntos · ${textos().avance(dist(r.metros))}`;
    respuesta.append('Tu respuesta: ', negrita(a.canonica), '.');
    $('res-explicacion').textContent = a.explicacion;
    $('res-explicacion').hidden = false;
    const enlace = $('res-fuente');
    enlace.href = a.fuente.url;
    enlace.textContent = `Fuente: ${a.fuente.titulo}`;
    fuenteP.hidden = false;
  } else {
    h.dataset.rareza = 'nada';
    $('res-titulo').textContent = r.estado === 'pasada' ? 'Pasaste' : r.estado === 'caducada' ? 'Sin excavar' : 'Se apagó la mecha';
    $('res-puntos').textContent = `0 puntos · ${textos().quieto}`;
    const probadas = (r.intentos || []).map((i) => `«${i.texto}»`);
    respuesta.append(probadas.length ? `Probaste ${probadas.join(', ')}, pero no estaban en la veta.` : 'No llegaste a dar una respuesta válida.');
    $('res-explicacion').hidden = true;
    fuenteP.hidden = true;
    if (animar) {
      pose('triste', 1600);
      decir(elegir(frases(r.estado === 'pasada' ? 'pasada' : 'vencida')), 3000);
    }
  }
  h.classList.remove('revelar');
  if (animar) {
    void h.offsetWidth;
    h.classList.add('revelar');
  }
  $('btn-reportar').hidden = r.estado === 'caducada';
  const siguiente = $('btn-siguiente');
  siguiente.disabled = enCurso;
  siguiente.textContent = estado.partida.siguiente ? textos().siguiente : 'Ver el resultado final';
  escena.disponer();
  $('res-titulo').focus({ preventScroll: true });
  anunciar(
    r.estado === 'acertada'
      ? `${r.respuesta.nombreRareza}. ${r.respuesta.canonica}. ${r.puntos} puntos, ${textos().anuncioAvance(`${formato.valor(r.metros)} ${modo().unidad.palabra}`)}.`
      : `${$('res-titulo').textContent}. Cero puntos.`,
  );
}

async function siguiente() {
  if (estado.ocupado || $('btn-siguiente').disabled) return;
  if (estado.partida.siguiente) return iniciarRonda(estado.partida.siguiente);
  return mostrarFinal();
}

// ───────── Final ─────────
const SVG_NS = 'http://www.w3.org/2000/svg';
function nodoSvg(nombre, atributos = {}, texto = '') {
  const nodo = document.createElementNS(SVG_NS, nombre);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
  if (texto) nodo.textContent = texto;
  return nodo;
}

function dibujarRendimiento(estadisticas, puntos) {
  const seccion = $('rendimiento');
  if (!estadisticas) {
    seccion.hidden = true;
    return;
  }
  seccion.hidden = false;
  const { total, puesto, empatados, percentil, promedio, desviacion, distribucion, suficientesDatos } = estadisticas;
  const puestoEl = $('rendimiento-puesto');
  const cifra = document.createElement('strong');
  cifra.textContent = `#${puesto}`;
  puestoEl.replaceChildren(cifra, document.createElement('span'));
  puestoEl.lastChild.textContent = ` de ${fmt(total)}`;

  if (total === 1) $('rendimiento-resumen').textContent = 'Sos la primera persona en completar esta expedición.';
  else {
    const empate = empatados > 1 ? ` Empataste con ${empatados - 1}.` : '';
    $('rendimiento-resumen').textContent = `Superaste al ${percentil}% de quienes jugaron.${empate}`;
  }
  $('rendimiento-nota').textContent = suficientesDatos
    ? `La curva toma los ${fmt(total)} resultados terminados. El promedio está en ${dist(promedio * 10)}.`
    : `Todavía hay pocos resultados (${fmt(total)}). La forma de la curva es provisoria y se ajustará a medida que juegue más gente.`;

  const svg = $('rendimiento-grafico');
  svg.replaceChildren();
  const titulo = nodoSvg('title', { id: 'rendimiento-grafico-titulo' }, `Distribución de puntajes: puesto ${puesto} de ${total}`);
  const desc = nodoSvg(
    'desc',
    { id: 'rendimiento-grafico-desc' },
    total === 1 ? `Tu resultado fue ${dist(puntos * 10)}.` : `Tu resultado fue ${dist(puntos * 10)} y superó al ${percentil} por ciento de los jugadores.`,
  );
  svg.append(titulo, desc);

  const x0 = 34;
  const x1 = 500;
  const y0 = 166;
  const alto = 122;
  const x = (valor) => x0 + (Math.max(0, Math.min(700, valor)) / 700) * (x1 - x0);
  svg.append(nodoSvg('line', { class: 'campana-eje', x1: x0, y1: y0, x2: x1, y2: y0 }));
  const mayorBarra = Math.max(1, ...distribucion.map((tramo) => tramo.cantidad));
  for (const tramo of distribucion) {
    const izquierda = x(tramo.desde) + 1;
    const derecha = x(Math.min(700, tramo.hasta + 1)) - 1;
    const altura = (tramo.cantidad / mayorBarra) * (alto * 0.48);
    svg.append(
      nodoSvg('rect', {
        class: 'campana-barra',
        x: izquierda,
        y: y0 - altura,
        width: Math.max(2, derecha - izquierda),
        height: altura,
        rx: 2,
      }),
    );
  }

  const sigma = Math.max(desviacion || 0, suficientesDatos ? 18 : 80);
  const muestras = Array.from({ length: 101 }, (_, i) => {
    const valor = (i / 100) * 700;
    const densidad = Math.exp(-0.5 * ((valor - promedio) / sigma) ** 2);
    return [x(valor), y0 - densidad * alto];
  });
  const camino = muestras.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${camino} L${x1} ${y0} L${x0} ${y0} Z`;
  svg.append(nodoSvg('path', { class: `campana-area${suficientesDatos ? '' : ' provisional'}`, d: area }));
  svg.append(nodoSvg('path', { class: `campana-curva${suficientesDatos ? '' : ' provisional'}`, d: camino }));

  for (const valor of [0, 350, 700]) {
    const etiqueta = dist(valor * 10);
    const ancla = valor === 0 ? 'start' : valor === 700 ? 'end' : 'middle';
    svg.append(nodoSvg('line', { class: 'campana-tick', x1: x(valor), y1: y0, x2: x(valor), y2: y0 + 6 }));
    svg.append(nodoSvg('text', { class: 'campana-etiqueta', x: x(valor), y: 190, 'text-anchor': ancla }, etiqueta));
  }

  const tuX = x(puntos);
  svg.append(nodoSvg('line', { class: 'campana-marca', x1: tuX, y1: 24, x2: tuX, y2: y0 }));
  svg.append(nodoSvg('circle', { class: 'campana-punto', cx: tuX, cy: 24, r: 6 }));
  const anclaTu = tuX < 105 ? 'start' : tuX > 430 ? 'end' : 'middle';
  const corrimiento = anclaTu === 'start' ? 9 : anclaTu === 'end' ? -9 : 0;
  svg.append(nodoSvg('text', { class: 'campana-tu', x: tuX + corrimiento, y: 15, 'text-anchor': anclaTu }, `VOS · ${dist(puntos * 10)}`));
}

function mostrarFinal({ completada = false } = {}) {
  const p = estado.partida;
  detenerMecha();
  mostrar('final');
  escena.fijarProfundidad(0, { animar: false });
  const recorrido = $('recorrido');
  recorrido.hidden = p.profundidad <= 0;
  recorrido.style.setProperty('--largo-recorrido', `${Math.max(700, p.profundidad * .7)}px`);
  const t = textos();
  const e = modo().etapaDe(p.profundidad);
  $('recorrido-fin').textContent = `Hasta acá llegaste: ${formato.valor(p.profundidad)} ${modo().unidad.palabra}. ${e.titulo}.`;
  $('final-sobre').textContent = `${completada ? `${t.yaJugaste} · ` : ''}${estado.modo === 'normal' ? '' : `${modo().nombre} · `}Desafío #${p.numero} · ${fechaLarga(p.fecha)}`;
  $('final-estrato').textContent =
    p.profundidad === 0 ? t.finalCero : p.profundidad >= PROFUNDIDAD_MAXIMA ? t.finalMaximo : t.finalLlegaste(e, formato.valor(p.profundidad));
  dibujarRendimiento(p.estadisticas, p.puntos);
  const lista = $('desglose');
  lista.replaceChildren(
    ...p.rondas.map((r) => {
      const li = document.createElement('li');
      li.dataset.rareza = r.respuesta?.rareza || 'nada';
      const piedra = document.createElement('span');
      piedra.className = 'piedra';
      const texto = document.createElement('span');
      texto.className = 'd-texto';
      const pregunta = document.createElement('span');
      pregunta.className = 'd-pregunta';
      pregunta.textContent = `${r.posicion}. ${r.enunciado}`;
      const textoRespuesta = r.respuesta ? `${r.respuesta.canonica} · ${r.respuesta.nombreRareza}` : r.estado === 'pasada' ? 'Pasaste' : 'Sin respuesta';
      // Al terminar, cada fila abre todas las respuestas válidas de esa pregunta.
      const resp = r.totalRespuestas ? botonRespuestas(r, textoRespuesta) : document.createElement('span');
      resp.classList.add('d-resp');
      if (!r.totalRespuestas) resp.textContent = textoRespuesta;
      texto.append(pregunta, resp);
      const pts = document.createElement('span');
      pts.className = 'd-pts';
      pts.textContent = dist((r.puntos || 0) * 10);
      li.append(piedra, texto, pts);
      return li;
    }),
  );
  const contador = $('final-metros');
  if (prefs.reducir || completada) contador.textContent = formato.valor(p.profundidad);
  else {
    const inicio = performance.now();
    const dur = 1200;
    const subir = (ahora) => {
      const k = Math.min(1, (ahora - inicio) / dur);
      contador.textContent = formato.valor(p.profundidad * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(subir);
    };
    requestAnimationFrame(subir);
  }
  const esHoy = estado.general?.desafio && p.fecha === estado.general.desafio.fecha;
  $('btn-hoy').hidden = Boolean(esHoy);
  $('final-guardado').textContent = 'Tu resultado quedó guardado.';
  tickCuentas();
  $('final-titulo').focus({ preventScroll: true });
  decir(t.despedida(p.profundidad), 4500);
  anunciar(`Partida terminada. Llegaste a ${formato.valor(p.profundidad)} ${modo().unidad.palabra}.`);
}

function textoCompartir() {
  const p = estado.partida;
  const filas = p.rondas.map((r) => (r.respuesta ? EMOJI[r.respuesta.rareza] : '⬛')).join('');
  const ranking = p.estadisticas ? `\nPuesto #${p.estadisticas.puesto} de ${fmt(p.estadisticas.total)}` : '';
  const enlace = estado.modo === 'normal' ? location.origin : `${location.origin}/?modo=${estado.modo}`;
  return `${textos().compartir(p.numero, fechaCorta(p.fecha), dist(p.profundidad))}${ranking}\n${filas}\n${enlace}`;
}

async function compartir() {
  const texto = textoCompartir();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text: texto });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(texto);
    aviso('Resultado copiado. Pegalo donde quieras.');
  } catch {
    window.prompt('Copiá tu resultado:', texto);
  }
}

// ───────── Reportes ─────────
function abrirReporte() {
  const n = Number($('res-ronda').textContent.match(/\d+/)?.[0]);
  const r = ronda(n);
  if (!r) return;
  const dlg = $('dlg-reporte');
  dlg.dataset.ronda = n;
  $('rep-pregunta').textContent = r.enunciado;
  const ultimo = r.intentos?.[r.intentos.length - 1]?.texto || '';
  $('rep-texto').value = ultimo;
  $('rep-comentario').value = '';
  dlg.showModal();
  $('rep-texto').focus();
}

async function enviarReporte(ev) {
  ev.preventDefault();
  const dlg = $('dlg-reporte');
  const texto = $('rep-texto').value.trim();
  if (!texto) {
    $('rep-texto').focus();
    return;
  }
  $('rep-enviar').disabled = true;
  try {
    const r = await api('POST', `/api/partidas/${estado.partida.id}/rondas/${dlg.dataset.ronda}/reporte`, { texto, comentario: $('rep-comentario').value });
    dlg.close();
    aviso(r.yaValida ? 'Esa respuesta ya figura en la veta.' : r.duplicado ? 'Ya la habías reportado. ¡Gracias!' : `Gracias: vamos a revisar «${texto}».`);
  } catch (e) {
    aviso(e.message);
  } finally {
    $('rep-enviar').disabled = false;
  }
}

// ───────── Cuentas regresivas ─────────
let recargandoPorMedianoche = false;
async function tickCuentas() {
  const g = estado.general;
  if (!g) return;
  const falta = g.proximoDesafioEn - ahoraServidor();
  const texto = reloj(falta);
  for (const id of ['cuenta-inicio', 'cuenta-final']) {
    const el = $(id);
    if (el.textContent !== texto) el.textContent = texto;
  }
  if (falta <= 0 && !recargandoPorMedianoche && (estado.pantalla === 'inicio' || estado.pantalla === 'final')) {
    recargandoPorMedianoche = true;
    await esperar(2500);
    try {
      await recargarGeneral();
      if (estado.pantalla === 'inicio' || estado.pantalla === 'final') {
        aviso('¡Hay un desafío nuevo!');
        renderInicio();
      }
    } catch {
      /* se reintenta en el próximo tic */
    }
    recargandoPorMedianoche = false;
  }
}

// ───────── Preferencias visibles ─────────
function aplicarPrefs() {
  document.documentElement.classList.toggle('movimiento-reducido', prefs.reducir);
  escena.reducido = prefs.reducir;
  $('btn-movimiento').setAttribute('aria-pressed', String(prefs.reducir));
  $('btn-movimiento').setAttribute('aria-label', prefs.reducir ? 'Movimiento reducido: activado' : 'Movimiento reducido: desactivado');
  $('btn-sonido').setAttribute('aria-pressed', String(prefs.sonido));
  $('btn-sonido').setAttribute('aria-label', prefs.sonido ? 'Sonido activado' : 'Sonido silenciado');
  sonido.activo = prefs.sonido;
}

// ───────── Arranque ─────────
/** Abre el modo activo: retoma una ronda en curso, muestra el resultado si ya se jugó o va al inicio. */
async function abrirModo() {
  mostrar('cargando');
  try {
    await recargarGeneral();
  } catch (e) {
    $('p-cargando').querySelector('p').textContent = `${e.message} Volvé a cargar la página en unos segundos.`;
    return;
  }
  const g = estado.general;
  const conRondaActiva = [g.partidaHoy, g.partidaPendiente].find((p) => p && p.rondaActiva && !p.terminada);
  if (conRondaActiva) {
    estado.partida = conRondaActiva;
    return entrarEnPartida(false);
  }
  if (g.partidaHoy?.terminada && !g.partidaPendiente) {
    estado.partida = g.partidaHoy;
    dibujarPepitas();
    return mostrarFinal({ completada: true });
  }
  renderInicio();
}

$('btn-comenzar').addEventListener('click', () => comenzar(estado.general?.partidaHoy || null));
$('btn-modos').addEventListener('click', abrirSelector);
$('btn-cambiar-modo').addEventListener('click', abrirSelector);
$('dlg-modos').addEventListener('close', () => $('btn-modos').setAttribute('aria-expanded', 'false'));
for (const boton of document.querySelectorAll('.modo-opcion')) boton.addEventListener('click', () => elegirModo(boton.dataset.modo));
$('btn-retomar').addEventListener('click', () => comenzar(estado.general?.partidaPendiente));
$('form-respuesta').addEventListener('submit', responder);
$('btn-pasar').addEventListener('click', pasar);
$('btn-siguiente').addEventListener('click', siguiente);
$('btn-compartir').addEventListener('click', compartir);
$('btn-reportar').addEventListener('click', abrirReporte);
$('form-reporte').addEventListener('submit', enviarReporte);
$('rep-cancelar').addEventListener('click', () => $('dlg-reporte').close());
$('btn-ayuda').addEventListener('click', () => $('dlg-ayuda').showModal());
$('btn-hoy').addEventListener('click', async () => {
  await recargarGeneral();
  renderInicio();
});
$('btn-sonido').addEventListener('click', () => {
  prefs.sonido = !prefs.sonido;
  guardarPrefs();
  aplicarPrefs();
  if (prefs.sonido) sonido.pico();
});
$('btn-movimiento').addEventListener('click', () => {
  prefs.reducir = !prefs.reducir;
  guardarPrefs();
  aplicarPrefs();
});
document.querySelector('.marca').addEventListener('click', (e) => {
  if (estado.pantalla === 'ronda') {
    e.preventDefault();
    aviso('Terminá la ronda antes de salir: el tiempo sigue corriendo.');
  }
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || estado.pantalla !== 'ronda' || !estado.partida) return;
  try {
    estado.partida = (await api('GET', `/api/partidas/${estado.partida.id}`)).partida;
    if (!estado.partida.rondaActiva) {
      const cerradas = estado.partida.rondas.filter((r) => r.estado !== 'pendiente');
      mostrarResultado(cerradas[cerradas.length - 1].posicion, { animar: true });
    }
  } catch {
    /* sin conexión: la mecha local sigue */
  }
});
addEventListener('resize', () => escena.disponer());

aplicarModo(estado.modo);
aplicarPrefs();
setInterval(tickCuentas, 1000);
abrirModo();
