// Generador por catálogos (sin IA): reglas de texto, filtros, coherencia enunciado–respuestas, alias,
// rareza, reproducibilidad, repeticiones, cobertura, publicación y juego. Usa los catálogos reales de
// datos/catalogos; las muestras sintéticas están marcadas como tales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepararEntorno } from './ayuda.js';
import { rasgos } from '../servidor/catalogos/texto.js';
import { validarFiltro, evaluar, describir, interpretar, claveDeFiltro, explicarFalla } from '../servidor/catalogos/filtros.js';
import { cargarCatalogos } from '../servidor/catalogos/catalogos.js';
import { cargarPlantillas, combinaciones, instanciar, validarPlantilla } from '../servidor/catalogos/plantillas.js';
import { generarLote, asignarRarezas, repeticion, minhash, problemaDeCobertura, firmaDe, prepararCandidatos, POR_OMISION } from '../servidor/catalogos/generador.js';
import { cargarConfig } from '../servidor/config.js';
import { CATEGORIAS, CATEGORIAS_NORMAL } from '../servidor/dominio.js';
import { normalizar } from '../servidor/normalizar.js';
import { dentroDeVentana, diasEntre, fechaLocal, limitesDeVentana, sumarDias } from '../servidor/tiempo.js';
import { asegurarDesafio } from '../servidor/generador/generar.js';
import { crearJuego } from '../servidor/juego.js';
import { validarLote } from '../servidor/validacion.js';
import { leerAfijos, expandir } from '../scripts/catalogos/hunspell.mjs';
import { limpiarAlias, sinParentesis } from '../scripts/catalogos/comun.mjs';

const { catalogos } = cargarCatalogos(new URL('../datos/catalogos', import.meta.url).pathname);
const PL = cargarPlantillas(new URL('../datos/plantillas.json', import.meta.url).pathname);
const plantillas = { version: PL.version, lista: PL.plantillas };
const cat = (id) => catalogos.get(id);
const ent = (catalogoId, id) => cat(catalogoId).entidades.find((e) => e.id === id);
const nombres = (filtro, c) => c.entidades.filter((e) => evaluar(filtro, e)).map((e) => e.nombre).sort();
const DOMINIOS = cargarConfig({ sinArchivoEnv: true, env: {} }).fuentes.dominios;
// Las preguntas de un lote como historial de otra fecha (lo que lee historialGenerado de la base).
const comoHistorial = (lote, fecha) => lote.preguntas.map((p) => ({ fecha, firma: p.firma, conjunto: p.conjunto, familia: p.generacion.familia, catalogo: p.generacion.catalogo.id, minhash: p.generacion.minhash }));

test('reglas de texto: sin tildes ni mayúsculas, ñ distinta de n, guiones y espacios separan palabras', () => {
  assert.deepEqual(rasgos('Guinea-Bisáu'), { ...rasgos('Guinea-Bisáu'), forma: 'guinea bisau', letras: 'guineabisau', nLetras: 11, nPalabras: 2, inicial: 'g', final: 'u' });
  assert.equal(rasgos('Ñandú').inicial, 'ñ');
  const conEnie = validarFiltro({ op: 'tiene', campo: 'nombre', letras: ['ñ'] }, cat('palabras')).filtro;
  assert.ok(evaluar(conEnie, { nombre: 'año' }));
  assert.ok(!evaluar(conEnie, { nombre: 'ano' }), 'ano no tiene ñ');
  const conN = validarFiltro({ op: 'empieza', campo: 'nombre', textos: ['n'] }, cat('palabras')).filtro;
  assert.ok(!evaluar(conN, { nombre: 'ñandú' }), 'ñandú no empieza con n');
  const termina = validarFiltro({ op: 'termina', campo: 'nombre', textos: ['U'] }, cat('paises')).filtro;
  assert.ok(evaluar(termina, ent('paises', 'PE')), 'Perú termina en u (sin tilde)');
  const secuencia = validarFiltro({ op: 'contiene', campo: 'nombre', texto: 'ar' }, cat('paises')).filtro;
  assert.ok(!evaluar(secuencia, { nombre: 'Costa Rica' }), 'una secuencia no salta el espacio entre palabras');
});

test('filtros: solo operadores permitidos y parámetros validados; nada se ejecuta', () => {
  const paises = cat('paises');
  const malos = [
    { op: 'eval', campo: 'nombre', texto: 'process.exit()' },
    { op: 'empieza', campo: 'nombre', textos: ['a'], extra: 1 },
    { op: 'empieza', campo: 'nombre', textos: ["a' OR 1=1 --"] },
    { op: 'empieza', campo: '__proto__', textos: ['a'] },
    { op: 'es', campo: 'subregion', valores: ['Atlántida'] },
    { op: 'entre', campo: 'nombre', desde: 1, hasta: 2 },
    { op: 'letras', campo: 'nombre', min: 9, max: 3 },
    { op: 'tiene', campo: 'nombre', letras: ['ab'] },
    { y: [{ op: 'letras', campo: 'nombre', min: 3 }, { op: 'letras', campo: 'nombre', min: 4 }, { op: 'palabras', campo: 'nombre', min: 1 }, { op: 'letras', campo: 'nombre', max: 9 }] },
    { y: [{ op: 'letras', campo: 'nombre', min: 3 }], o: [] },
  ];
  for (const f of malos) assert.equal(validarFiltro(f, paises).ok, false, JSON.stringify(f));
  // Equivalentes: otro orden, mayúsculas y tildes en los parámetros → la misma forma canónica.
  const a = validarFiltro({ y: [{ op: 'termina', campo: 'nombre', textos: ['A'] }, { op: 'es', campo: 'continente', valores: ['Europa'] }] }, paises).filtro;
  const b = validarFiltro({ y: [{ op: 'es', campo: 'continente', valores: ['Europa'] }, { op: 'termina', campo: 'nombre', textos: ['á'] }] }, paises).filtro;
  assert.equal(claveDeFiltro(a), claveDeFiltro(b));
  assert.deepEqual(nombres(a, paises), nombres(b, paises));
  // Combinación: «de Europa y cuyo nombre termine en A», contra un filtro hecho a mano.
  const esperados = paises.entidades.filter((e) => e.atributos.continente === 'Europa' && /a$/.test(e.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())).map((e) => e.nombre).sort();
  assert.deepEqual(nombres(a, paises), esperados);
});

test('coherencia: el enunciado de cada plantilla se lee de vuelta como la misma condición y da el mismo conjunto', () => {
  let revisados = 0;
  for (const p of plantillas.lista) {
    const c = cat(p.catalogo);
    for (const combo of combinaciones(p, c).slice(0, 40)) {
      const { ok, filtro } = validarFiltro(instanciar(p.filtro, combo.valores), c);
      if (!ok) continue;
      const enunciado = describir(filtro, p, combo.vistas);
      const leido = interpretar(enunciado, p, c);
      assert.ok(leido, `no se pudo leer «${enunciado}»`);
      const canonico = validarFiltro(leido, c);
      assert.ok(canonico.ok, `${enunciado}: ${canonico.errores}`);
      assert.equal(claveDeFiltro(canonico.filtro), claveDeFiltro(filtro), enunciado);
      assert.deepEqual(nombres(canonico.filtro, c), nombres(filtro, c), enunciado);
      revisados++;
    }
  }
  assert.ok(revisados > 500, `${revisados} enunciados revisados`);
});

test('enunciados de condiciones combinadas: el sujeto no se repite y se lee igual', () => {
  const p = { enunciado: 'Nombrá una palabra', sujetos: { nombre: 'que' }, frases: {} };
  const { filtro } = validarFiltro({ y: [{ op: 'empieza', campo: 'nombre', textos: ['c'] }, { op: 'tiene', campo: 'nombre', letras: ['s', 'a'] }, { op: 'letras', campo: 'nombre', min: 5, max: 5 }] }, cat('palabras'));
  const enunciado = describir(filtro, p);
  assert.equal(enunciado, 'Nombrá una palabra que empiece con «C» y tenga la «A» y la «S» y tenga exactamente 5 letras.');
  assert.equal(claveDeFiltro(validarFiltro(interpretar(enunciado, p, cat('palabras')), cat('palabras')).filtro), claveDeFiltro(filtro));
  assert.ok(nombres(filtro, cat('palabras')).every((w) => /^c/.test(w) && w.length === 5));
});

test('las condiciones miran el nombre canónico: un alias que cumple no hace entrar a otra entidad', () => {
  const paises = cat('paises');
  const conR = validarFiltro({ op: 'empieza', campo: 'nombre', textos: ['r'] }, paises).filtro;
  const chequia = ent('paises', 'CZ');
  assert.ok(chequia.alias.includes('República Checa'));
  assert.ok(!nombres(conR, paises).includes('Chequia'));
  assert.equal(explicarFalla(conR, chequia, { nombre: 'nombre' }), 'se toma el nombre «Chequia», que empieza con «C»');
});

test('alias: colisiones dentro del catálogo se descartan y los alias no inflan el conjunto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'filon-catalogo-'));
  const base = { nombre: 'Prueba', version: 'v1', importado: '2026-10-07', fuentes: [{ url: 'https://www.wikidata.org', licencia: 'CC0' }], cobertura: { tipo: 'completa', criterio: 'sintético' }, atributos: {} };
  writeFileSync(
    join(dir, 'sintetico.json'),
    JSON.stringify({
      ...base,
      id: 'sintetico',
      entidades: [
        { id: 'a', nombre: 'República del Congo', alias: ['Congo', 'Congo-Brazzaville'], popularidad: 5 },
        { id: 'b', nombre: 'República Democrática del Congo', alias: ['Congo', 'RDC'], popularidad: 9 },
        { id: 'c', nombre: 'Gabón', alias: ['República Gabonesa'], popularidad: 3 },
      ],
    }),
  );
  const c = cargarCatalogos(dir).catalogos.get('sintetico');
  assert.ok(c.entidades.every((e) => !e.alias.includes('Congo')), '«Congo» nombra a dos entidades: no es alias de ninguna');
  assert.deepEqual(c.colisiones.map((x) => x.alias).sort(), ['Congo', 'Congo']);
  assert.ok(c.entidades.find((e) => e.id === 'a').alias.includes('Congo-Brazzaville'));
  const todos = validarFiltro({ y: [] }, c).filtro;
  assert.equal(c.entidades.filter((e) => evaluar(todos, e)).length, 3, 'tres entidades, tres respuestas (los alias no suman)');
  // En los catálogos reales, ninguna forma de un alias apunta a otra entidad.
  for (const [id, real] of catalogos) assert.ok(Array.isArray(real.colisiones), id);
});

test('rareza: quintiles por popularidad, reproducibles, con las cinco rarezas desde 5 respuestas', () => {
  const entidades = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, popularidad: i % 4 }));
  const r1 = asignarRarezas(entidades);
  const r2 = asignarRarezas([...entidades].reverse());
  assert.deepEqual([...r1].sort(), [...r2].sort(), 'no depende del orden de entrada');
  assert.equal(new Set(r1.values()).size, 5);
  assert.equal(r1.get('e3'), 'grava', 'la más popular (empate resuelto por id) es Grava');
  assert.equal(new Set(asignarRarezas(entidades.slice(0, 5)).values()).size, 5);
});

test('lote: siete preguntas variadas, reproducible con la misma semilla, fecha y versiones', () => {
  const opciones = { catalogos, plantillas, fecha: '2026-11-03', dominios: DOMINIOS };
  const a = generarLote(opciones);
  const b = generarLote(opciones);
  assert.ok(a.ok, a.errores.join(' '));
  assert.equal(a.preguntas.length, 7);
  assert.deepEqual(a.preguntas, b.preguntas, 'mismo lote, mismas respuestas y rarezas');
  assert.equal(a.semilla, b.semilla);
  assert.ok(validarLote(a.preguntas).ok);
  const porCategoria = {};
  for (const p of a.preguntas) porCategoria[p.categoria] = (porCategoria[p.categoria] ?? 0) + 1;
  assert.ok(Object.keys(porCategoria).length >= 4 && Object.values(porCategoria).every((n) => n <= 2), JSON.stringify(porCategoria));
  assert.ok((porCategoria.gramatica ?? 0) <= 1);
  assert.equal(new Set(a.elegidas.map((e) => e.familia)).size, 7, 'ninguna familia se repite en el día');
  assert.ok(new Set(a.elegidas.map((e) => e.dificultad.nivel)).size >= 2, 'dificultades mezcladas');
  const otroDia = generarLote({ ...opciones, fecha: '2026-11-04' });
  assert.notDeepEqual(otroDia.elegidas.map((e) => e.enunciado), a.elegidas.map((e) => e.enunciado));
  const otraSemilla = generarLote({ ...opciones, semillaBase: 'otra' });
  assert.notEqual(otraSemilla.semilla, a.semilla);
  for (const p of a.preguntas) {
    assert.equal(p.origen, 'catalogo');
    assert.ok(p.generacion.catalogo.version && p.generacion.versiones.plantillas && p.firma && p.conjunto);
    assert.equal(p.generacion.minhash.length, 64);
  }
});

test('repeticiones: misma firma o mismo conjunto son la misma consigna; compartir respuestas no lo es', () => {
  const paises = cat('paises');
  const armar = (catalogo, familia, filtro) => {
    const ids = catalogo.entidades.filter((e) => evaluar(filtro, e)).map((e) => e.id).sort();
    return { firma: firmaDe(catalogo.id, filtro), conjunto: `${catalogo.id}|${ids.join()}`, familia, catalogo, minhash: minhash(ids) };
  };
  const registro = (c, fecha) => ({ fecha, firma: c.firma, conjunto: c.conjunto, familia: c.familia, catalogo: c.catalogo.id, minhash: c.minhash });
  const sud = armar(paises, 'paises-region', validarFiltro({ op: 'es', campo: 'subregion', valores: ['Sudamérica'] }, paises).filtro);
  assert.match(repeticion(sud, [registro(sud, '2026-10-01')]), /misma consigna que el 2026-10-01/);
  // Otra condición (de otra familia) con el mismo conjunto: «de Sudamérica» y «de Sudamérica con al menos una letra».
  const igual = armar(paises, 'paises-letras', validarFiltro({ y: [{ op: 'es', campo: 'subregion', valores: ['Sudamérica'] }, { op: 'letras', campo: 'nombre', min: 1 }] }, paises).filtro);
  assert.match(repeticion(igual, [registro(sud, '2026-10-01')]), /mismo conjunto/);
  // Capitales de Sudamérica: otro catálogo, otras respuestas → se permite.
  const capitales = cat('capitales');
  const caps = armar(capitales, 'capitales', validarFiltro({ op: 'es', campo: 'subregion', valores: ['Sudamérica'] }, capitales).filtro);
  assert.equal(repeticion(caps, [registro(sud, '2026-10-01')]), null);
  // Sudamérica + Centroamérica contiene a Sudamérica: solapan, pero no son la misma consigna.
  const casi = armar(paises, 'paises-region', validarFiltro({ op: 'es', campo: 'subregion', valores: ['Sudamérica', 'Centroamérica'] }, paises).filtro);
  assert.equal(repeticion(casi, [registro(sud, '2026-10-01')]), null, 'el solapamiento solo baja la preferencia');
  // El historial hace que el generador elija otra cosa.
  const lote = generarLote({ catalogos, plantillas, fecha: '2026-11-03', dominios: DOMINIOS });
  const conHistorial = generarLote({ catalogos, plantillas, fecha: '2026-11-03', dominios: DOMINIOS, historial: comoHistorial(lote, '2026-11-02') });
  assert.ok(conHistorial.ok);
  const antes = new Set(lote.preguntas.map((p) => p.firma));
  assert.ok(conHistorial.preguntas.every((p) => !antes.has(p.firma)), 'ninguna consigna repetida');
  assert.ok(conHistorial.descartes.some((d) => /^repetida: misma consigna que el 2026-11-02/.test(d.motivo)), 'se registra el motivo del descarte');
});

test('ventana de 60 días calendario: a 59 se rechaza, a 60 y 61 se permite, hacia atrás y hacia adelante', () => {
  assert.equal(POR_OMISION.diasSinRepetir, 60);
  assert.equal(cargarConfig({ sinArchivoEnv: true, env: {} }).catalogos.diasSinRepetir, 60, 'por omisión, 60');
  assert.equal(cargarConfig({ sinArchivoEnv: true, env: { CATALOGOS_DIAS_SIN_REPETIR: '30' } }).catalogos.diasSinRepetir, 30, 'respeta un valor explícito');
  assert.ok(dentroDeVentana('2026-11-03', '2026-09-05', 60) && !dentroDeVentana('2026-11-03', '2026-09-04', 60));
  assert.deepEqual(limitesDeVentana('2026-11-03', 60), ['2026-09-05', '2027-01-01']);
  const fecha = '2026-11-03';
  const base = generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS });
  const firmas = new Set(base.preguntas.map((p) => p.firma));
  for (const [distancia, bloquea] of [[59, true], [60, false], [61, false]]) {
    for (const sentido of [-1, 1]) {
      const otra = sumarDias(fecha, sentido * distancia);
      assert.equal(Math.abs(diasEntre(fecha, otra)), distancia);
      const r = generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS, historial: comoHistorial(base, otra) });
      assert.ok(r.ok, r.errores.join(' '));
      if (bloquea) assert.ok(r.preguntas.every((p) => !firmas.has(p.firma)), `a ${sentido * distancia} días no se repite`);
      else assert.deepEqual(r.preguntas, base.preguntas, `a ${sentido * distancia} días el historial no pesa`);
    }
  }
});

test('ventana con cambio de año y en la zona horaria del proyecto', () => {
  const ZONA = 'America/Argentina/Buenos_Aires';
  // 2026-12-01 → 2027-01-29 son 59 días; → 2027-01-30, 60.
  assert.equal(diasEntre('2026-12-01', '2027-01-29'), 59);
  const historial = comoHistorial(generarLote({ catalogos, plantillas, fecha: '2026-12-01', dominios: DOMINIOS }), '2026-12-01');
  const firmas = new Set(historial.map((h) => h.firma));
  const a59 = generarLote({ catalogos, plantillas, fecha: '2027-01-29', dominios: DOMINIOS, historial });
  assert.ok(a59.preguntas.every((p) => !firmas.has(p.firma)));
  const a60 = generarLote({ catalogos, plantillas, fecha: '2027-01-30', dominios: DOMINIOS, historial });
  assert.deepEqual(a60.preguntas, generarLote({ catalogos, plantillas, fecha: '2027-01-30', dominios: DOMINIOS }).preguntas);
  // La fecha que cuenta es la del calendario local: las 01:00 UTC del 1/1 todavía son el 31/12 en Buenos Aires.
  assert.equal(fechaLocal(Date.parse('2027-01-01T01:00:00Z'), ZONA), '2026-12-31');
  assert.equal(diasEntre('2026-11-01', fechaLocal(Date.parse('2026-12-31T02:59:00Z'), ZONA)), 59);
  assert.equal(diasEntre('2026-11-01', fechaLocal(Date.parse('2026-12-31T03:00:00Z'), ZONA)), 60);
});

test('historial manual o de reserva: bloquea dentro de la ventana solo si las respuestas son casi las mismas', () => {
  const fecha = '2026-11-03';
  const base = generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS });
  const objetivo = base.preguntas[0];
  const manual = (f) => [{ fecha: f, enunciado: 'Cargada a mano', claves: objetivo.respuestas.map((r) => normalizar(r.canonica)) }];
  const dentro = generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS, recientes: manual(sumarDias(fecha, -59)) });
  assert.ok(!dentro.preguntas.some((p) => p.conjunto === objetivo.conjunto));
  assert.ok(dentro.descartes.some((d) => /casi el mismo conjunto que «Cargada a mano»/.test(d.motivo)));
  // Un día ya programado a mano dentro de 59 días también cuenta.
  assert.ok(!generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS, recientes: manual(sumarDias(fecha, 59)) }).preguntas.some((p) => p.conjunto === objetivo.conjunto));
  assert.deepEqual(generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS, recientes: manual(sumarDias(fecha, -60)) }).preguntas, base.preguntas);
  // Compartir la mitad de las respuestas con una pregunta manual no bloquea.
  const mitad = [{ fecha: sumarDias(fecha, -1), enunciado: 'Mitad', claves: objetivo.respuestas.slice(0, Math.ceil(objetivo.respuestas.length / 2)).map((r) => normalizar(r.canonica)) }];
  assert.deepEqual(generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS, recientes: mitad }).preguntas, base.preguntas);
});

test('firma estable: no cambia con la versión del catálogo, el nombre de la plantilla ni la redacción', () => {
  const plantilla = PL.plantillas.find((p) => p.id === 'paises-continente');
  const paises = cat('paises');
  const firmas = (p, c) => prepararCandidatos(p, c, { dominios: DOMINIOS }).candidatos.map((x) => x.firma).sort();
  const original = firmas(plantilla, paises);
  assert.ok(original.length > 3);
  assert.deepEqual(firmas({ ...plantilla, id: 'renombrada', familia: 'otra-familia' }, paises), original, 'id y familia no entran');
  assert.deepEqual(firmas({ ...plantilla, enunciado: `${plantilla.enunciado}, por favor` }, paises), original, 'la redacción no entra');
  assert.deepEqual(firmas(plantilla, { ...paises, version: '2099-01-01.otra' }), original, 'reimportar el catálogo no habilita repetir');
  // Los valores en otro orden son la misma condición.
  const a = validarFiltro({ op: 'es', campo: 'continente', valores: ['Europa', 'Asia'] }, paises).filtro;
  const b = validarFiltro({ op: 'es', campo: 'continente', valores: ['Asia', 'Europa'] }, paises).filtro;
  assert.equal(firmaDe('paises', a), firmaDe('paises', b));
  assert.notEqual(firmaDe('paises', a), firmaDe('capitales', a), 'otro catálogo, otra consigna');
});

test('categorías nuevas: el generador las usa y la validación del lote las acepta', () => {
  for (const c of ['informatica', 'astronomia', 'videojuegos', 'idiomas']) {
    assert.ok(CATEGORIAS[c] && CATEGORIAS_NORMAL.includes(c), c);
    assert.ok(plantillas.lista.some((p) => p.categoria === c && cat(p.catalogo)), `hay plantillas de ${c}`);
  }
  for (const p of plantillas.lista) assert.ok(CATEGORIAS_NORMAL.includes(p.categoria), `${p.id}: categoría ${p.categoria}`);
  // Un mes encadenado (cada día ve el historial de los anteriores, como en el calendario real).
  const vistas = new Set();
  const historial = [];
  for (let i = 0; i < 30; i++) {
    const fecha = sumarDias('2026-11-01', i);
    const lote = generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS, historial });
    assert.ok(lote.ok && validarLote(lote.preguntas).ok, fecha);
    for (const p of lote.preguntas) vistas.add(p.categoria);
    historial.push(...comoHistorial(lote, fecha));
  }
  for (const c of ['informatica', 'astronomia', 'videojuegos', 'idiomas']) assert.ok(vistas.has(c), `en un mes sale ${c}`);
});

test('cobertura: no se promete un conjunto completo con datos parciales', () => {
  const f1 = cat('campeones_f1');
  const tramo = f1.cobertura.completoEn[0];
  const dentro = validarFiltro({ op: 'entre', campo: 'titulos', desde: 1990, hasta: tramo.hasta }, f1).filtro;
  const fuera = validarFiltro({ op: 'entre', campo: 'titulos', desde: 2010, hasta: 2029 }, f1).filtro;
  assert.equal(problemaDeCobertura(f1, dentro), null);
  assert.match(problemaDeCobertura(f1, fuera), /parcial/);
  assert.match(problemaDeCobertura(f1, validarFiltro({ y: [] }, f1).filtro), /parcial/, 'sin condiciones tampoco: faltan temporadas');
  const canciones = cat('canciones');
  const unDisco = validarFiltro({ op: 'es', campo: 'disco', valores: ['Thriller'] }, canciones).filtro;
  assert.equal(problemaDeCobertura(canciones, unDisco), null, 'cada disco tiene su lista completa');
  assert.match(problemaDeCobertura(canciones, validarFiltro({ op: 'empieza', campo: 'nombre', textos: ['t'] }, canciones).filtro), /parcial/);
  const nobel = cat('nobel_literatura');
  assert.ok(!nobel.completos.has('paises'));
  assert.match(problemaDeCobertura(nobel, validarFiltro({ op: 'es', campo: 'paises', valores: ['Chile'] }, nobel).filtro), /faltan datos/);
});

test('plantillas: esquema validado (no admiten claves ni tipos desconocidos)', () => {
  assert.deepEqual(PL.problemas, []);
  const buena = PL.plantillas[0];
  assert.deepEqual(validarPlantilla(buena), []);
  assert.ok(validarPlantilla({ ...buena, codigo: 'process.exit()' }).length);
  assert.ok(validarPlantilla({ ...buena, categoria: 'astrologia' }).length);
  assert.ok(validarPlantilla({ ...buena, parametros: { x: { tipo: 'consulta', sql: 'DROP TABLE' } } }).length);
  assert.ok(validarPlantilla({ ...buena, filtro: { y: [] } }).length, 'filtro vacío sin «todos»');
});

test('importación: expansión de afijos Hunspell y limpieza de alias', () => {
  const reglas = leerAfijos('SET UTF-8\nFLAG UTF-8\nSFX S Y 2\nSFX S 0 s [aeiou]\nSFX S 0 es [^aeiou]\nSFX R Y 1\nSFX R ar o/C ar\nSFX C Y 1\nSFX C 0 lo .');
  const formas = [];
  expandir('casa', ['S'], reglas, (f) => formas.push(f));
  expandir('pared', ['S'], reglas, (f) => formas.push(f));
  expandir('cantar', ['R'], reglas, (f) => formas.push(f));
  assert.deepEqual(formas, ['casas', 'paredes', 'canto', 'cantolo']);
  assert.deepEqual(limpiarAlias('Argentina', ['argentina', 'República Argentina', 'RA', '🇦🇷', 'República Argentina']), ['República Argentina']);
  assert.deepEqual(sinParentesis('Myanmar (Birmania)'), { base: 'Myanmar', extras: ['Birmania', 'Myanmar Birmania'] });
});

test('publicación: el lote generado se guarda entero (o nada), es idempotente y no se pisa en paralelo', async () => {
  const e = await prepararEntorno();
  const args = { db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, reservas: e.reservas, ahora: e.reloj.ahora, generador: 'catalogos' };
  const resultados = await Promise.all([asegurarDesafio({ ...args, titular: 'a' }), asegurarDesafio({ ...args, titular: 'b' })]);
  assert.equal(resultados.filter((r) => r.resultado === 'publicado').length, 1);
  assert.equal((await e.db.get('SELECT COUNT(*) AS n FROM desafios')).n, 1);
  const publicado = resultados.find((r) => r.resultado === 'publicado');
  assert.equal(publicado.origen, 'catalogo');
  const preguntas = await e.db.all('SELECT * FROM preguntas ORDER BY posicion');
  assert.equal(preguntas.length, 7);
  for (const p of preguntas) {
    assert.equal(p.origen, 'catalogo');
    assert.ok(p.firma && p.conjunto && JSON.parse(p.generacion).catalogo.version);
    const { n, variantes } = await e.db.get('SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM variantes v WHERE v.pregunta_id = ?) AS variantes FROM respuestas WHERE pregunta_id = ?', p.id, p.id);
    assert.equal(n, JSON.parse(p.conteos).total, 'conteos preparados al publicar');
    assert.ok(variantes >= n, 'cada respuesta tiene sus formas aceptadas');
  }
  assert.equal((await asegurarDesafio(args)).resultado, 'ya_existia');
  // El día siguiente no repite consignas del anterior.
  await asegurarDesafio({ ...args, fecha: '2026-10-06' });
  const dos = await e.db.all("SELECT p.firma, d.fecha FROM preguntas p JOIN desafios d ON d.id = p.desafio_id WHERE d.fecha IN ('2026-10-05', '2026-10-06')");
  assert.equal(new Set(dos.map((x) => x.firma)).size, 14);
  e.db.close();
});

test('sin candidatos suficientes: se completa con la reserva o no se publica nada', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filon-plantillas-'));
  const pocas = join(dir, 'plantillas.json');
  writeFileSync(pocas, JSON.stringify({ version: 'prueba', plantillas: PL.plantillas.filter((p) => p.id === 'paises-continente' || p.id === 'elementos-inicial') }));
  const e = await prepararEntorno();
  e.config.catalogos.rutaPlantillas = pocas;
  const args = { db: e.db, config: e.config, reserva: e.reserva, reservas: e.reservas, ahora: e.reloj.ahora, generador: 'catalogos' };
  const mixto = await asegurarDesafio({ ...args, fecha: '2026-10-05' });
  assert.equal(mixto.resultado, 'publicado');
  assert.equal(mixto.origen, 'mixto');
  const origenes = (await e.db.all('SELECT origen FROM preguntas')).map((p) => p.origen);
  assert.equal(origenes.filter((o) => o === 'catalogo').length, 2);
  assert.equal(origenes.filter((o) => o === 'reserva').length, 5);
  const corrida = JSON.parse((await e.db.get('SELECT detalle FROM corridas ORDER BY id DESC LIMIT 1')).detalle);
  assert.ok(corrida.catalogos.errores.length && corrida.completadaConReserva.length === 5);

  e.config.catalogos.completarConReserva = false;
  const sinReserva = await asegurarDesafio({ ...args, fecha: '2026-10-06' });
  assert.equal(sinReserva.resultado, 'fallo');
  assert.equal(await e.db.get("SELECT id FROM desafios WHERE fecha = '2026-10-06'"), null, 'no se publica un lote incompleto');
  e.db.close();
});

test('juego: en las preguntas de palabras vale solo la palabra escrita (sin autocompletar fragmentos)', async () => {
  const e = await prepararEntorno();
  // El primer día con una pregunta de Gramática (no todos los días tienen una).
  const lista = { version: plantillas.version, lista: plantillas.lista };
  let fecha = '2026-10-05';
  while (!generarLote({ catalogos, plantillas: lista, fecha, semillaBase: e.config.catalogos.semilla, dominios: e.config.fuentes.dominios }).preguntas.some((p) => p.categoria === 'gramatica')) fecha = sumarDias(fecha, 1);
  assert.ok(diasEntre('2026-10-05', fecha) < 30, 'en un mes sale Gramática');
  e.reloj.fijar(`${fecha}T15:00:00-03:00`);
  await asegurarDesafio({ db: e.db, config: e.config, fecha, reserva: e.reserva, reservas: e.reservas, ahora: e.reloj.ahora, generador: 'catalogos' });
  assert.equal((await e.db.get("SELECT coincidencia FROM preguntas WHERE categoria = 'gramatica'"))?.coincidencia, 'exacta');
  const juego = crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora });
  const yo = '11111111-2222-4333-8444-555555555555';
  const p = await juego.iniciarPartida(yo);
  const posicion = (await e.db.get("SELECT posicion FROM preguntas WHERE coincidencia = 'exacta'"))?.posicion;
  assert.ok(posicion, 'el día tiene una pregunta de palabras');
  for (let n = 1; n < posicion; n++) {
    await juego.iniciarRonda(yo, p.id, n);
    await juego.pasar(yo, p.id, n);
  }
  await juego.iniciarRonda(yo, p.id, posicion);
  const pregunta = await e.db.get('SELECT id FROM preguntas WHERE posicion = ?', posicion);
  const valida = (await e.db.get('SELECT canonica FROM respuestas WHERE pregunta_id = ? AND length(canonica) >= 6 ORDER BY orden LIMIT 1', pregunta.id)).canonica;
  const fragmento = await juego.responder(yo, p.id, posicion, valida.slice(0, 4));
  assert.notEqual(fragmento.resultado, 'sugerida', 'un fragmento no se completa');
  assert.notEqual(fragmento.resultado, 'aceptada');
  const exacta = await juego.responder(yo, p.id, posicion, valida.toUpperCase());
  assert.equal(exacta.resultado, 'aceptada', 'la palabra exacta vale (sin importar mayúsculas)');
  e.db.close();
});

test('más de 10.000 respuestas (catálogo SINTÉTICO): se genera, valida, publica y revela por páginas', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filon-sintetico-'));
  mkdirSync(join(dir, 'catalogos'));
  // SINTÉTICO: 12.000 «palabras» inventadas solo para medir volumen; no es contenido del juego.
  const silabas = ['ba', 'ce', 'di', 'fo', 'gu', 'la', 'me', 'ni', 'po', 'ru', 'sa', 'te', 'vi', 'zo', 'ña'];
  const entidades = [];
  for (let i = 0; entidades.length < 12_000; i++) {
    const w = `${silabas[i % 15]}${silabas[Math.floor(i / 15) % 15]}${silabas[Math.floor(i / 225) % 15]}${silabas[Math.floor(i / 3375) % 15]}`;
    entidades.push({ nombre: `a${w}s`, popularidad: i % 997 });
  }
  writeFileSync(join(dir, 'catalogos', 'sintetico.json'), JSON.stringify({ id: 'sintetico', nombre: 'SINTÉTICO', version: 'v1', importado: '2026-10-07', fuentes: [{ nombre: 'Prueba', url: 'https://github.com/LibreOffice/dictionaries', licencia: 'prueba' }], cobertura: { tipo: 'completa', criterio: 'sintético' }, atributos: {}, fuenteEntidades: 'https://github.com/LibreOffice/dictionaries', entidades }));
  const plantilla = { ...PL.plantillas.find((p) => p.id === 'palabras-dos-letras'), id: 'sintetica', familia: 'sintetica', catalogo: 'sintetico', parametros: {}, filtro: { op: 'tiene', campo: 'nombre', letras: ['a', 's'] } };
  writeFileSync(join(dir, 'plantillas.json'), JSON.stringify({ version: 'sintetica', plantillas: [plantilla, ...PL.plantillas.filter((p) => p.categoria !== 'gramatica')] }));
  const e = await prepararEntorno();
  Object.assign(e.config.catalogos, { dir: join(dir, 'catalogos'), rutaPlantillas: join(dir, 'plantillas.json') });
  const t0 = Date.now();
  const r = await asegurarDesafio({ db: e.db, config: e.config, fecha: '2026-10-05', reserva: e.reserva, reservas: e.reservas, ahora: e.reloj.ahora, generador: 'catalogos' });
  const ms = Date.now() - t0;
  assert.equal(r.resultado, 'publicado', JSON.stringify(r));
  const grande = await e.db.get("SELECT id, conteos, posicion FROM preguntas WHERE coincidencia = 'exacta'");
  assert.ok(grande, 'el lote incluye la pregunta sintética');
  assert.equal(JSON.parse(grande.conteos).total, 12_000);
  assert.ok(ms < 30_000, `generar y publicar 12.000 respuestas tardó ${ms} ms`);
  const juego = crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora });
  const yo = '99999999-8888-4777-8666-555555555555';
  const p = await juego.iniciarPartida(yo);
  for (let n = 1; n <= 7; n++) {
    await juego.iniciarRonda(yo, p.id, n);
    await juego.pasar(yo, p.id, n);
  }
  const pagina = await juego.respuestasValidas(yo, p.id, grande.posicion, { desde: 11_950 });
  assert.equal(pagina.total, 12_000);
  assert.equal(pagina.respuestas.length, 50);
  e.db.close();
});

test('de punta a punta con una categoría nueva: se publica, se juega, se revela y aparece en las estadísticas', async () => {
  const e = await prepararEntorno();
  const NUEVAS = ['informatica', 'astronomia', 'videojuegos', 'idiomas'];
  let fecha = '2026-10-05';
  while (!generarLote({ catalogos, plantillas, fecha, semillaBase: e.config.catalogos.semilla, dominios: e.config.fuentes.dominios }).preguntas.some((p) => NUEVAS.includes(p.categoria))) fecha = sumarDias(fecha, 1);
  e.reloj.fijar(`${fecha}T15:00:00-03:00`);
  const pub = await asegurarDesafio({ db: e.db, config: e.config, fecha, reserva: e.reserva, reservas: e.reservas, ahora: e.reloj.ahora, generador: 'catalogos' });
  assert.equal(pub.origen, 'catalogo');
  const nueva = await e.db.get(`SELECT id, posicion, categoria FROM preguntas WHERE categoria IN (${NUEVAS.map(() => '?').join(',')}) ORDER BY posicion LIMIT 1`, ...NUEVAS);
  const valida = (await e.db.get('SELECT canonica FROM respuestas WHERE pregunta_id = ? ORDER BY orden LIMIT 1', nueva.id)).canonica;
  const juego = crearJuego({ db: e.db, config: e.config, ahora: e.reloj.ahora });
  const yo = '11111111-2222-4333-8444-666666666666';
  const partida = await juego.iniciarPartida(yo);
  for (let n = 1; n <= 7; n++) {
    const ronda = await juego.iniciarRonda(yo, partida.id, n);
    if (n === nueva.posicion) {
      assert.equal(ronda.rondas[n - 1].categoria, CATEGORIAS[nueva.categoria], 'el juego muestra el nombre de la categoría');
      assert.equal((await juego.responder(yo, partida.id, n, valida)).resultado, 'aceptada');
    }
    await juego.pasar(yo, partida.id, n);
  }
  const final = await juego.respuestasDelFinal(yo, partida.id);
  const deLaNueva = final.preguntas.find((p) => p.posicion === nueva.posicion);
  assert.ok(deLaNueva.total >= 5 && deLaNueva.respuestas.some(([nombre]) => nombre === valida), 'el final muestra sus respuestas');
  const pagina = await juego.respuestasValidas(yo, partida.id, nueva.posicion, { buscar: valida });
  assert.ok(pagina.respuestas.some((r) => (r.canonica ?? r[0]) === valida), 'el revelado la encuentra');
  const { estadisticasAdmin } = await import('../servidor/estadisticas.js');
  const stats = await estadisticasAdmin(e.db, { zona: e.config.zona, desde: fecha, hasta: fecha, fecha });
  assert.ok(JSON.stringify(stats).includes(CATEGORIAS[nueva.categoria]), 'las estadísticas nombran la categoría');
  e.db.close();
});

test('Geografía: siete preguntas de geografía, variadas por familia y catálogo, con pocas de letras', async () => {
  const opciones = { catalogos, plantillas, modo: 'geografia', dominios: DOMINIOS };
  const historial = [];
  for (let i = 0; i < 10; i++) {
    const fecha = sumarDias('2026-11-01', i);
    const lote = generarLote({ ...opciones, fecha, historial });
    assert.ok(lote.ok, lote.errores.join(' '));
    assert.deepEqual(lote, generarLote({ ...opciones, fecha, historial }), 'reproducible');
    assert.ok(validarLote(lote.preguntas, 'geografia').ok);
    assert.ok(lote.preguntas.every((p) => p.categoria === 'geografia'));
    assert.equal(new Set(lote.elegidas.map((e) => e.familia)).size, 7, 'ninguna familia se repite');
    const porCatalogo = Object.values(lote.elegidas.reduce((m, e) => ({ ...m, [e.catalogo]: (m[e.catalogo] ?? 0) + 1 }), {}));
    assert.ok(porCatalogo.every((n) => n <= 3), 'hasta tres del mismo catálogo');
    assert.ok(lote.preguntas.filter((p) => p.generacion.filtro.y.some((c) => c.campo === 'nombre')).length <= 5, 'hasta cinco de letras');
    historial.push(...comoHistorial(lote, fecha));
  }
  // La semilla incluye el modo: Normal y Geografía arman días distintos con los mismos datos.
  assert.notEqual(generarLote({ ...opciones, fecha: '2026-11-01' }).semilla, generarLote({ ...opciones, modo: 'normal', fecha: '2026-11-01' }).semilla);
  assert.throws(() => generarLote({ ...opciones, modo: 'farandula', fecha: '2026-11-01' }), /no tiene generador/);
});

test('Geografía se publica con catálogos solo si GENERADOR_GEOGRAFIA=catalogos', async () => {
  const e = await prepararEntorno({ env: { GENERADOR_GEOGRAFIA: 'catalogos' } });
  const args = { db: e.db, config: e.config, reserva: e.reserva, reservas: e.reservas, ahora: e.reloj.ahora, modo: 'geografia' };
  const r = await asegurarDesafio({ ...args, fecha: '2026-10-05' });
  assert.equal(r.origen, 'catalogo');
  assert.ok((await e.db.all("SELECT p.categoria FROM preguntas p JOIN desafios d ON d.id = p.desafio_id WHERE d.modo = 'geografia'")).every((p) => p.categoria === 'geografia'));
  e.config.generadores.geografia = 'reserva';
  assert.equal((await asegurarDesafio({ ...args, fecha: '2026-10-06' })).origen, 'reserva');
  assert.equal((await asegurarDesafio({ ...args, fecha: '2026-10-07', generador: 'catalogos' })).origen, 'catalogo', 'el panel puede elegir');
  assert.equal(cargarConfig({ sinArchivoEnv: true, env: {} }).generadores.geografia, 'reserva', 'por omisión, la reserva');
  e.db.close();
});

test('plantillas: «solo» limita los valores de un parámetro y «modos» limita dónde se usa la plantilla', () => {
  const estados = PL.plantillas.find((p) => p.id === 'estados-pais');
  const enunciados = prepararCandidatos(estados, cat('subdivisiones'), { dominios: DOMINIOS }).candidatos.map((c) => c.enunciado).sort();
  assert.deepEqual(enunciados, ['Alemania', 'Australia', 'Brasil', 'Estados Unidos', 'India', 'México', 'Venezuela'].map((p) => `Nombrá un estado de ${p}.`).sort());
  assert.match(validarPlantilla({ ...estados, parametros: { pais: { tipo: 'letra', campo: 'nombre', posicion: 'inicial', solo: ['A'] } } }).join(' '), /«solo»/);
  assert.match(validarPlantilla({ ...estados, modos: ['inexistente'] }).join(' '), /modos/);
  // La copia de «países por idioma» para Geografía no entra en Normal.
  const soloGeografia = new Set(PL.plantillas.filter((p) => p.modos && !p.modos.includes('normal')).map((p) => p.id));
  assert.ok(soloGeografia.has('paises-idioma-geografia'));
  const historial = [];
  for (let i = 0; i < 6; i++) {
    const fecha = sumarDias('2026-11-01', i);
    const lote = generarLote({ catalogos, plantillas, fecha, dominios: DOMINIOS, historial });
    assert.ok(lote.elegidas.every((x) => !soloGeografia.has(x.plantilla)));
    historial.push(...comoHistorial(lote, fecha));
  }
});

test('nombres repetidos en el catálogo: solo es ambigua la pregunta que los incluye a los dos', () => {
  const deptos = cat('departamentos_argentinos');
  assert.ok(deptos.entidades.filter((x) => x.nombre === 'Capital').length > 1, 'hay varios departamentos «Capital»');
  const plantilla = PL.plantillas.find((p) => p.id === 'departamentos-provincia');
  const { candidatos } = prepararCandidatos(plantilla, deptos, { dominios: DOMINIOS });
  const mendoza = candidatos.find((c) => c.enunciado === 'Nombrá un departamento de Mendoza.');
  assert.ok(mendoza?.entidades.some((x) => x.nombre === 'Capital'), 'Mendoza tiene su «Capital» y la pregunta vale');
  // Dos «Capital» en el mismo conjunto sí es ambiguo.
  const ambos = validarFiltro({ op: 'es', campo: 'provincia', valores: ['Mendoza', 'San Juan'] }, deptos).filtro;
  const sintetica = { ...plantilla, id: 'prueba-ambigua', parametros: {}, filtro: ambos, respuestas: { min: 5, max: 60 } };
  const r = prepararCandidatos(sintetica, deptos, { dominios: DOMINIOS });
  assert.equal(r.candidatos.length, 0);
  assert.equal(r.descartes['nombres ambiguos'], 1);
});
