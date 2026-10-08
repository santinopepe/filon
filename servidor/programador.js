// Tarea programada interna: garantiza el desafío de hoy y prepara el de mañana, para cada modo.
// - Corre al iniciar, cada N minutos y justo después de cada medianoche local.
// - Hoy se completa con la reserva enseguida (nadie se queda sin jugar).
// - Mañana se completa con la reserva recién en los últimos minutos antes de la medianoche, para dejar
//   tiempo a la carga manual desde el panel sin tener que reemplazar nada.
import { asegurarDesafio } from './generador/generar.js';
import { fechaLocal, sumarDias, inicioDeFecha, proximaMedianoche } from './tiempo.js';

/** Asegura hoy y, cerca de la medianoche, prepara mañana, en cada modo activo. */
export async function revisarDesafios({ db, config, contexto, ahora = () => Date.now() }) {
  const t = ahora();
  const hoy = fechaLocal(t, config.zona);
  const manana = sumarDias(hoy, 1);
  const ventanaReserva = inicioDeFecha(manana, config.zona) - config.programador.minutosReservaAntesDeMedianoche * 60_000;
  const resultados = [];
  for (const modo of config.modosActivos) {
    resultados.push(await asegurarDesafio({ db, config, fecha: hoy, modo, ...contexto, ahora }));
    if (t >= ventanaReserva) resultados.push(await asegurarDesafio({ db, config, fecha: manana, modo, ...contexto, ahora }));
  }
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
          if (r.resultado !== 'ya_existia') log.info(`[programador] ${r.fecha} · ${r.modo}: ${r.resultado}${r.origen ? ` (${r.origen})` : ''}${r.error ? ` — ${r.error}` : ''}`);
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
