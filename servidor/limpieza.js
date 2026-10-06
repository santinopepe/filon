// Tarea diaria de limpieza y retención (ver «Retención de datos» en docs/OPERACIONES.md).
// Borra por tandas para no bloquear la base: lo que quede se borra en la corrida siguiente.
import { conciliarPuntajes } from './banco.js';
import { fechaLocal, sumarDias } from './tiempo.js';

const DIA = 86_400_000;
const TANDA = 5000;

async function borrarPorTandas(db, tabla, condicion, ...args) {
  const r = await db.run(`DELETE FROM ${tabla} WHERE rowid IN (SELECT rowid FROM ${tabla} WHERE ${condicion} LIMIT ${TANDA})`, ...args);
  return r.changes;
}

export async function limpiarDatos({ db, config, ahora = () => Date.now(), sesiones, limites }) {
  const t = ahora();
  const r = config.retencion;
  const resultado = {
    sesionesVencidas: await sesiones.limpiar(t),
    limitesVencidos: await limites.limpiar(t),
    // Visitantes que nunca jugaron ni reportaron: no aportan nada al historial.
    visitantesSinPartida: await borrarPorTandas(
      db,
      'jugadores',
      `creado_en < ? AND NOT EXISTS (SELECT 1 FROM partidas p WHERE p.jugador_id = jugadores.id)
       AND NOT EXISTS (SELECT 1 FROM reportes x WHERE x.jugador_id = jugadores.id)`,
      t - r.visitantesSinPartidaDias * DIA,
    ),
    // Los textos escritos por los jugadores (intentos fallidos) son lo más personal: se conservan poco.
    intentos: await borrarPorTandas(db, 'intentos', 'en < ?', t - r.intentosDias * DIA),
    reportesResueltos: await borrarPorTandas(db, 'reportes', "estado <> 'pendiente' AND creado_en < ?", t - r.reportesResueltosDias * DIA),
    detalleCorridas: (
      await db.run(
        `UPDATE corridas SET detalle = NULL WHERE rowid IN (
           SELECT rowid FROM corridas WHERE detalle IS NOT NULL AND iniciada_en < ? LIMIT ${TANDA})`,
        t - r.detalleCorridasDias * DIA,
      )
    ).changes,
  };
  // Concilia el histograma de puntajes de los últimos días (por si una instancia vieja terminó partidas
  // sin actualizarlo durante un despliegue).
  const desde = sumarDias(fechaLocal(t, config.zona), -2);
  const recientes = await db.all('SELECT id FROM desafios WHERE fecha >= ?', desde);
  for (const d of recientes) await conciliarPuntajes(db, d.id);
  resultado.desafiosConciliados = recientes.length;
  return resultado;
}
