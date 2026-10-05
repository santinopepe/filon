// Sonidos sintetizados con Web Audio (sin archivos). Se activan recién tras un gesto del usuario.

const ARPEGIOS = {
  grava: [392],
  cobre: [392, 523.25],
  plata: [392, 523.25, 659.25],
  oro: [392, 523.25, 659.25, 783.99],
  diamante: [523.25, 659.25, 783.99, 1046.5, 1318.5],
};

export function crearSonido({ activo = true } = {}) {
  let ctx = null;
  let maestro = null;
  let encendido = activo;

  function asegurar() {
    if (!encendido) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      maestro = ctx.createGain();
      maestro.gain.value = 0.55;
      maestro.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tono(frec, { dur = 0.2, tipo = 'sine', vol = 0.2, en = 0, hasta = null } = {}) {
    const c = asegurar();
    if (!c) return;
    const t = c.currentTime + en;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(frec, t);
    if (hasta) o.frequency.exponentialRampToValueAtTime(hasta, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(maestro);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function ruido({ dur = 0.12, vol = 0.2, frec = 2400, q = 1.2, en = 0, tipo = 'bandpass' } = {}) {
    const c = asegurar();
    if (!c) return;
    const t = c.currentTime + en;
    const largo = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, largo, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < largo; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / largo);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = tipo;
    f.frequency.value = frec;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(maestro);
    s.start(t);
  }

  return {
    get activo() {
      return encendido;
    },
    set activo(v) {
      encendido = Boolean(v);
      if (!encendido && ctx) ctx.suspend();
      if (encendido && ctx) ctx.resume();
    },
    desbloquear: () => asegurar(),
    pico() {
      ruido({ dur: 0.09, vol: 0.35, frec: 3200, q: 2 });
      tono(1760, { dur: 0.08, tipo: 'square', vol: 0.05 });
    },
    rechazo() {
      tono(140, { dur: 0.22, tipo: 'sine', vol: 0.3, hasta: 70 });
      ruido({ dur: 0.15, vol: 0.12, frec: 400, tipo: 'lowpass' });
    },
    tic() {
      tono(1250, { dur: 0.04, tipo: 'square', vol: 0.04 });
    },
    acierto(rareza) {
      const notas = ARPEGIOS[rareza] || ARPEGIOS.grava;
      notas.forEach((f, i) => tono(f, { dur: 0.5, tipo: 'triangle', vol: 0.16, en: i * 0.085 }));
      if (rareza === 'diamante' || rareza === 'oro') {
        for (let i = 0; i < 6; i++) tono(2093 + i * 260, { dur: 0.25, tipo: 'sine', vol: 0.035, en: 0.35 + i * 0.06 });
      }
    },
    descenso(segundos) {
      if (segundos <= 0) return;
      ruido({ dur: Math.min(3.5, segundos), vol: 0.22, frec: 160, q: 0.7, tipo: 'lowpass' });
    },
    apagado() {
      tono(330, { dur: 0.4, tipo: 'triangle', vol: 0.12, hasta: 160 });
      ruido({ dur: 0.35, vol: 0.08, frec: 5000, tipo: 'highpass' });
    },
  };
}
