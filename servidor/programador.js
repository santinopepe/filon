// Tarea programada interna: garantiza el desafío de hoy y prepara el de mañana.
// - Corre al iniciar, cada N minutos y justo después de cada medianoche local.
// - Mañana se prepara con IA por adelantado; si la IA falla, reintenta en las siguientes revisiones
//   y recién usa la reserva en los últimos minutos antes de la medianoche.
import { asegurarDesafio } from './generador/generar.js';
import { fechaLocal, sumarDias, inicioDeFecha, proximaMedianoche } from './tiempo.js';

/** Asegura hoy (con reserva si hace falta) y prepara mañana con IA; la reserva de mañana solo cerca de medianoche. */
export async function revisarDesafios({ db, config, contexto, ahora = () => Date.now() }) {
  const t = ahora();
  const hoy = fechaLocal(t, config.zona);
  const manana = sumarDias(hoy, 1);
  const resultados = [await asegurarDesafio({ db, config, fecha: hoy, ...contexto, permitirReserva: true, ahora })];
  const ventanaReserva = inicioDeFecha(manana, config.zona) - config.programador.minutosReservaAntesDeMedianoche * 60_000;
  resultados.push(await asegurarDesafio({ db, config, fecha: manana, ...contexto, permitirReserva: !contexto.proveedor || t >= ventanaReserva, ahora }));
  return resultados;
}

export function crearProgramador({ db, config, contexto, ahora = () => Date.now(), log = console }) {
  let enCurso = null;
  let intervalo = null;
  let temporizadorMedianoche = null;

  async function revisar() {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      let resultados = [];
      try {
        resultados = await revisarDesafios({ db, config, contexto, ahora });
        for (const r of resultados) {
          if (r.resultado !== 'ya_existia' && r.resultado !== 'pendiente') log.info(`[programador] ${r.fecha}: ${r.resultado}${r.origen ? ` (${r.origen})` : ''}${r.error ? ` — ${r.error}` : ''}`);
        }
      } catch (e) {
        log.error('[programador] error inesperado', e);
      } finally {
        enCurso = null;
      }
      return resultados;
    })();
    return enCurso;
  }

  function programarMedianoche() {
    const espera = Math.max(1000, proximaMedianoche(ahora(), config.zona) - ahora() + 1500);
    temporizadorMedianoche = setTimeout(async () => {
      await revisar();
      programarMedianoche();
    }, Math.min(espera, 2 ** 31 - 1));
    temporizadorMedianoche.unref?.();
  }

  return {
    revisar,
    iniciar() {
      const primera = revisar();
      intervalo = setInterval(revisar, config.programador.minutosEntreRevisiones * 60_000);
      intervalo.unref?.();
      programarMedianoche();
      return primera;
    },
    detener() {
      clearInterval(intervalo);
      clearTimeout(temporizadorMedianoche);
    },
  };
}
