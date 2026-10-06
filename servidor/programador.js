// Tarea programada interna: garantiza el desafío de hoy y prepara el de mañana, para cada modo.
// - Corre al iniciar, cada N minutos y justo después de cada medianoche local.
// - Normal: mañana se prepara con IA por adelantado; si la IA falla, reintenta en las siguientes
//   revisiones y recién usa la reserva en los últimos minutos antes de la medianoche.
// - Modos temáticos (sin IA automática): mañana se completa con su reserva recién en esa última
//   ventana, para dejar tiempo a la carga manual desde el panel sin tener que reemplazar nada.
import { asegurarDesafio } from './generador/generar.js';
import { CLAVES_MODOS, MODOS } from './dominio.js';
import { fechaLocal, sumarDias, inicioDeFecha, proximaMedianoche } from './tiempo.js';

/** Asegura hoy (con reserva si hace falta) y prepara mañana; la reserva de mañana solo cerca de medianoche. */
export async function revisarDesafios({ db, config, contexto, ahora = () => Date.now() }) {
  const t = ahora();
  const hoy = fechaLocal(t, config.zona);
  const manana = sumarDias(hoy, 1);
  const ventanaReserva = inicioDeFecha(manana, config.zona) - config.programador.minutosReservaAntesDeMedianoche * 60_000;
  const resultados = [];
  for (const modo of CLAVES_MODOS) {
    resultados.push(await asegurarDesafio({ db, config, fecha: hoy, modo, ...contexto, permitirReserva: true, ahora }));
    // Normal sin IA publica mañana enseguida (como siempre); con IA, y en los temáticos, espera la ventana.
    const esperarVentana = MODOS[modo].iaAutomatica ? Boolean(contexto.proveedor) : true;
    resultados.push(await asegurarDesafio({ db, config, fecha: manana, modo, ...contexto, permitirReserva: !esperarVentana || t >= ventanaReserva, ahora }));
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
          if (r.resultado !== 'ya_existia' && r.resultado !== 'pendiente') log.info(`[programador] ${r.fecha} · ${r.modo}: ${r.resultado}${r.origen ? ` (${r.origen})` : ''}${r.error ? ` — ${r.error}` : ''}`);
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
