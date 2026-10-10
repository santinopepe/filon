// Puente entre el generador por catálogos (servidor/catalogos/) y la base: historial de preguntas
// generadas, preguntas recientes de otros orígenes y armado del lote del día. No usa la red.
import { cargarCatalogos } from '../catalogos/catalogos.js';
import { cargarPlantillas } from '../catalogos/plantillas.js';
import { generarLote } from '../catalogos/generador.js';
import { preguntasRecientes } from '../banco.js';
import { limitesDeVentana } from '../tiempo.js';
import { normalizar } from '../normalizar.js';

/** Lo que el generador necesita de una pregunta generada (`g`: su campo `generacion`). */
const registroDeHistorial = (fecha, p, g) => ({ fecha, firma: p.firma, conjunto: p.conjunto, categoria: p.categoria, familia: g.familia, catalogo: g.universo ?? g.catalogo?.id, minhash: g.minhash, minhashNombres: g.minhashNombres, nombresConjunto: g.nombresConjunto });

/**
 * Preguntas generadas dentro de la ventana (hacia atrás y hacia adelante, por los días ya programados): a
 * menos de `dias` días calendario de la fecha. Lo que salió hace `dias` días o más no cuenta.
 */
export async function historialGenerado(db, fecha, dias, modo) {
  const [desde, hasta] = limitesDeVentana(fecha, dias);
  const filas = await db.all(
    `SELECT p.id, p.firma, p.conjunto, p.generacion, p.categoria, d.fecha FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE d.modo = ? AND d.fecha BETWEEN ? AND ? AND d.fecha <> ? AND p.firma IS NOT NULL`,
    modo, desde, hasta, fecha,
  );
  const registros = filas.map((f) => {
    const g = JSON.parse(f.generacion ?? '{}');
    return { ...registroDeHistorial(f.fecha, f, g), preguntaId: f.id };
  });
  // Compatibilidad: leer las canónicas de preguntas viejas sin reescribir sus firmas ni metadatos.
  const sinNombres = registros.filter(r => !r.nombresConjunto);
  for (let i = 0; i < sinNombres.length; i += 400) {
    const lote = sinNombres.slice(i, i + 400), porId = new Map(lote.map(r => [r.preguntaId, r]));
    for (const r of lote) r.nombresConjunto = [];
    const respuestas = await db.all(`SELECT pregunta_id, canonica FROM respuestas WHERE pregunta_id IN (${lote.map(() => '?').join(',')}) ORDER BY orden`, ...porId.keys());
    for (const r of respuestas) porId.get(r.pregunta_id).nombresConjunto.push(normalizar(r.canonica));
  }
  return registros.map(({ preguntaId: _preguntaId, ...registro }) => registro);
}

/**
 * Arma el lote de una fecha con los catálogos. `anteriores`: preguntas del día que se está rearmando
 * (cuentan como recientes, así el día cambia de verdad). Devuelve el resultado de generarLote más los
 * problemas de carga de catálogos y plantillas.
 */
export async function generarConCatalogos({ db, config, fecha, modo, anteriores = [] }) {
  const { catalogos, problemas } = cargarCatalogos(config.catalogos.dir);
  const plantillas = cargarPlantillas(config.catalogos.rutaPlantillas);
  const historial = await historialGenerado(db, fecha, config.catalogos.diasSinRepetir, modo);
  for (const a of anteriores) {
    if (!a.firma) continue;
    const g = JSON.parse(a.generacion ?? '{}');
    historial.push({ ...registroDeHistorial(fecha, a, g), nombresConjunto: g.nombresConjunto ?? a.claves });
  }
  const recientes = (await preguntasRecientes(db, fecha, config.catalogos.diasSinRepetir, modo)).filter((r) => !r.firma);
  const r = generarLote({
    catalogos,
    plantillas: { version: plantillas.version, lista: plantillas.plantillas },
    fecha,
    modo,
    semillaBase: config.catalogos.semilla,
    historial,
    recientes,
    dominios: config.fuentes.dominios,
    opciones: { maxRespuestas: config.catalogos.maxRespuestas, diasSinRepetir: config.catalogos.diasSinRepetir, diasRotacion: config.catalogos.diasRotacion, pesoRotacion: config.catalogos.pesoRotacion, planDificultad: config.catalogos.planDificultad, minFamiliares: config.catalogos.minFamiliares },
  });
  return { ...r, problemas: [...problemas, ...plantillas.problemas] };
}

/** Resumen de los descartes para guardar en la corrida (sin miles de líneas). */
export function resumirDescartes(descartes, muestra = 40) {
  const porMotivo = {};
  let total = 0;
  for (const d of descartes) {
    const clave = d.motivo.replace(/\d+/g, 'N').replace(/«[^»]*»/g, '«…»').slice(0, 90);
    porMotivo[clave] = (porMotivo[clave] ?? 0) + (d.cantidad ?? 1);
    total += d.cantidad ?? 1;
  }
  return { total, porMotivo, muestra: descartes.filter((d) => d.enunciado).slice(0, muestra) };
}
