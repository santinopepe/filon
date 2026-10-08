// Plantillas del generador (datos/plantillas.json): validación del esquema, cálculo de los parámetros a
// partir de los datos y armado del filtro concreto. Los parámetros solo reemplazan marcadores «{x}» por
// valores tipados: no hay plantillas con código, expresiones ni SQL.
import { readFileSync } from 'node:fs';
import { CATEGORIAS_NORMAL } from '../dominio.js';
import { normalizar } from '../normalizar.js';
import { ALFABETO, rasgos, textoNormal } from './texto.js';

const TIPOS_PARAMETRO = new Set(['valor', 'letra', 'letras', 'secuencia', 'numero', 'periodo']);
const CLAVES = new Set(['id', 'familia', 'categoria', 'catalogo', 'enunciado', 'frases', 'sujetos', 'parametros', 'filtro', 'todos', 'respuestas', 'dificultad', 'prioridad', 'rechazos', 'alcance', 'explicacion', 'coincidencia']);

/** Valida una plantilla (sin mirar los datos). Devuelve la lista de errores. */
export function validarPlantilla(p) {
  const e = [];
  const extra = Object.keys(p).filter((k) => !CLAVES.has(k));
  if (extra.length) e.push(`claves desconocidas: ${extra.join(', ')}`);
  for (const k of ['id', 'familia', 'catalogo', 'enunciado', 'alcance', 'explicacion']) if (typeof p[k] !== 'string' || !p[k].trim()) e.push(`falta «${k}»`);
  if (!/^[a-z0-9-]+$/.test(p.id ?? '')) e.push('id con caracteres inválidos');
  if (!CATEGORIAS_NORMAL.includes(p.categoria)) e.push(`categoría inválida «${p.categoria}»`);
  if (!/^Nombrá /.test(p.enunciado ?? '')) e.push('el enunciado empieza con «Nombrá»');
  if (p.alcance && (p.alcance.length < 8 || p.alcance.length > 260)) e.push('alcance de 8 a 260 caracteres');
  const { min, max } = p.respuestas ?? {};
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 5 || max < min) e.push('respuestas.min ≥ 5 y respuestas.max ≥ min');
  if (typeof p.dificultad !== 'number' || p.dificultad < 0 || p.dificultad > 1) e.push('dificultad entre 0 y 1');
  if (![1, 2, 3].includes(p.prioridad)) e.push('prioridad 1, 2 o 3');
  if (p.coincidencia !== undefined && !['flexible', 'exacta'].includes(p.coincidencia)) e.push('coincidencia «flexible» o «exacta»');
  for (const [k, f] of Object.entries(p.frases ?? {})) {
    if (typeof f !== 'string' || !/\{(valor|desde)\}/.test(f)) e.push(`frase de «${k}» sin {valor} ni {desde}`);
  }
  for (const [k, s] of Object.entries(p.sujetos ?? {})) if (!/^(que|cuyo|cuya) ?/.test(s)) e.push(`sujeto de «${k}» inválido`);
  for (const [nombre, def] of Object.entries(p.parametros ?? {})) {
    if (!/^\w+$/.test(nombre)) e.push(`parámetro con nombre inválido «${nombre}»`);
    if (!TIPOS_PARAMETRO.has(def?.tipo)) e.push(`parámetro «${nombre}» con tipo inválido`);
    if (def?.tipo === 'numero' && (!Array.isArray(def.valores) || !def.valores.every(Number.isInteger) || def.valores.length > 20)) e.push(`parámetro «${nombre}»: hasta 20 enteros`);
    if (def?.tipo === 'letras' && ![1, 2, 3].includes(def.cantidad)) e.push(`parámetro «${nombre}»: cantidad 1 a 3`);
    if (def?.tipo === 'secuencia' && (![2, 3, 4].includes(def.largo) || !['inicial', 'final', 'cualquiera'].includes(def.posicion))) e.push(`parámetro «${nombre}»: largo 2–4 y posición inicial, final o cualquiera`);
    if (def?.tipo === 'periodo' && !(Number.isInteger(def.ancho) && Number.isInteger(def.paso) && Number.isInteger(def.origen) && def.ancho > 0 && def.paso > 0)) e.push(`parámetro «${nombre}»: ancho, paso y origen enteros`);
  }
  const vacio = Array.isArray(p.filtro?.y) && !p.filtro.y.length;
  if (vacio !== Boolean(p.todos)) e.push('«todos: true» va con un filtro vacío (y solo con él)');
  return e;
}

/** Carga y valida el archivo de plantillas. Devuelve { version, plantillas, problemas }. */
export function cargarPlantillas(ruta) {
  let datos;
  try {
    datos = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    return { version: null, plantillas: [], problemas: [`No se pudieron leer las plantillas (${e.message}).`] };
  }
  const problemas = [];
  const ids = new Set();
  const plantillas = [];
  for (const p of datos.plantillas ?? []) {
    const errores = validarPlantilla(p);
    if (ids.has(p.id)) errores.push('id repetido');
    ids.add(p.id);
    if (errores.length) problemas.push(`Plantilla «${p.id}»: ${errores.join('; ')}`);
    else plantillas.push({ coincidencia: 'flexible', frases: {}, sujetos: {}, ...p });
  }
  return { version: String(datos.version ?? '0'), plantillas, problemas };
}

// ───── Parámetros calculados desde los datos ─────

const coleccion = new Intl.Collator('es');

/** Texto original (con tildes y mayúsculas) que corresponde a un tramo de la forma normalizada. */
function vistaDe(nombre, forma, desde, largo) {
  const original = nombre.normalize('NFC');
  if (normalizar(original).length !== original.replace(/\s+/g, ' ').trim().length) return null;
  const tramo = original.replace(/\s+/g, ' ').trim().slice(desde, desde + largo);
  return normalizar(tramo) === forma.slice(desde, desde + largo) ? tramo : null;
}

/** Valores posibles de un parámetro (en orden estable), con la vista de cada texto si corresponde. */
export function valoresDeParametro(def, catalogo) {
  const ents = catalogo.entidades;
  const textoDe = (e) => (def.campo === 'nombre' ? e.nombre : String(e.atributos[def.campo] ?? ''));
  switch (def.tipo) {
    case 'valor':
      return [...(catalogo.valores.get(def.campo) ?? [])].sort(coleccion.compare).map((v) => ({ valor: v }));
    case 'numero':
      return def.valores.map((v) => ({ valor: v }));
    case 'letras': {
      const combinaciones = [];
      const armar = (desde, actual) => {
        if (actual.length === def.cantidad) return void combinaciones.push({ valor: [...actual] });
        for (let i = desde; i < ALFABETO.length; i++) armar(i + 1, [...actual, ALFABETO[i]]);
      };
      armar(0, []);
      return combinaciones;
    }
    case 'letra': {
      const vistas = new Set();
      for (const e of ents) {
        const r = rasgos(textoDe(e));
        const l = def.posicion === 'final' ? r.final : r.forma[0];
        if (l && ALFABETO.includes(l)) vistas.add(l);
      }
      return [...vistas].sort((a, b) => ALFABETO.indexOf(a) - ALFABETO.indexOf(b)).map((v) => ({ valor: v }));
    }
    case 'secuencia': {
      // Secuencias observadas (dentro de una palabra) y la forma original más frecuente para mostrarlas.
      const conteo = new Map();
      for (const e of ents) {
        const texto = textoDe(e);
        const { forma } = rasgos(texto);
        const posiciones = def.posicion === 'inicial' ? [0] : def.posicion === 'final' ? [forma.length - def.largo] : [...forma].map((_, i) => i);
        const vistas = new Set();
        for (const i of posiciones) {
          const s = forma.slice(i, i + def.largo);
          if (i < 0 || s.length !== def.largo || !/^\p{L}+$/u.test(s) || vistas.has(s)) continue;
          vistas.add(s);
          const v = conteo.get(s) ?? { n: 0, vistas: new Map() };
          v.n++;
          const vista = vistaDe(texto, forma, i, def.largo) ?? s;
          v.vistas.set(vista, (v.vistas.get(vista) ?? 0) + 1);
          conteo.set(s, v);
        }
      }
      return [...conteo]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([s, v]) => ({ valor: s, vista: [...v.vistas].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0] }));
    }
    case 'periodo': {
      const numeros = ents.flatMap((e) => [e.atributos[def.campo]].flat()).filter((n) => typeof n === 'number');
      if (!numeros.length) return [];
      const min = Math.min(...numeros);
      const max = Math.max(...numeros);
      const valores = [];
      let desde = def.origen + Math.floor((min - def.origen) / def.paso) * def.paso;
      for (; desde <= max; desde += def.paso) valores.push({ valor: { desde, hasta: desde + def.ancho - 1 } });
      return valores;
    }
  }
  return [];
}

/** Todas las combinaciones de parámetros de una plantilla (producto cartesiano, orden estable). */
export function combinaciones(plantilla, catalogo) {
  let combos = [{ valores: {}, vistas: {} }];
  for (const [nombre, def] of Object.entries(plantilla.parametros ?? {})) {
    const opciones = valoresDeParametro(def, catalogo);
    combos = combos.flatMap((c) =>
      opciones.map((o) => ({
        valores: { ...c.valores, [nombre]: o.valor },
        vistas: o.vista && o.vista !== o.valor ? { ...c.vistas, [textoNormal(o.vista)]: o.vista } : c.vistas,
      })),
    );
  }
  return combos;
}

/** Reemplaza los marcadores «{x}» y «{x.y}» del filtro de la plantilla por los valores (solo datos). */
export function instanciar(molde, valores) {
  if (typeof molde === 'string') {
    const m = molde.match(/^\{(\w+)(?:\.(\w+))?\}$/);
    if (!m) return molde;
    const v = m[2] ? valores[m[1]]?.[m[2]] : valores[m[1]];
    return v === undefined ? molde : v;
  }
  if (Array.isArray(molde)) return molde.flatMap((x) => (typeof x === 'string' && Array.isArray(instanciar(x, valores)) ? instanciar(x, valores) : [instanciar(x, valores)]));
  if (molde && typeof molde === 'object') return Object.fromEntries(Object.entries(molde).map(([k, v]) => [k, instanciar(v, valores)]));
  return molde;
}
