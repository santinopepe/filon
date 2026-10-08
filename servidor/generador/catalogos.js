// Puente entre el generador por catálogos (servidor/catalogos/) y la base: historial de preguntas
// generadas, preguntas recientes de otros orígenes y armado del lote del día. No usa la red.
import { cargarCatalogos } from '../catalogos/catalogos.js';
import { cargarPlantillas } from '../catalogos/plantillas.js';
import { generarLote } from '../catalogos/generador.js';
import { preguntasRecientes } from '../banco.js';
import { limitesDeVentana } from '../tiempo.js';

/**
 * Preguntas generadas dentro de la ventana (hacia atrás y hacia adelante, por los días ya programados): a
 * menos de `dias` días calendario de la fecha. Lo que salió hace `dias` días o más no cuenta.
 */
export async function historialGenerado(db, fecha, dias, modo) {
  const [desde, hasta] = limitesDeVentana(fecha, dias);
  const filas = await db.all(
    `SELECT p.firma, p.conjunto, p.generacion, d.fecha FROM preguntas p JOIN desafios d ON d.id = p.desafio_id
     WHERE d.modo = ? AND d.fecha BETWEEN ? AND ? AND d.fecha <> ? AND p.firma IS NOT NULL`,
    modo, desde, hasta, fecha,
  );
  return filas.map((f) => {
    const g = JSON.parse(f.generacion ?? '{}');
    return { fecha: f.fecha, firma: f.firma, conjunto: f.conjunto, familia: g.familia, catalogo: g.catalogo?.id, minhash: g.minhash };
  });
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
    historial.push({ fecha, firma: a.firma, conjunto: a.conjunto, familia: g.familia, catalogo: g.catalogo?.id, minhash: g.minhash });
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
    opciones: { maxRespuestas: config.catalogos.maxRespuestas, diasSinRepetir: config.catalogos.diasSinRepetir },
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
