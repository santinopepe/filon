// Filón — Geografía: Filón pilotea un avión y da la vuelta al mundo, en pixel art.
// El avance de la partida (0 a 7.000 «metros», que en pantalla se muestran como kilómetros) lo lleva
// desde la pista de Aeroparque por América, Europa, África, Asia y Oceanía hasta la Antártida.
// El paisaje (cielo, sierras, vegetación, mar y monumentos) está en paisaje-geografia.js; acá van el
// avión, la pista y los carteles con el nombre de cada lugar.
import { limitar, lerp } from './escena.js';
import { cartelPixel } from './pixel.js';
import { crearPaisajeGeografia } from './paisaje-geografia.js';

export { ETAPAS_GEOGRAFIA } from './paisaje-geografia.js';

export function crearMundoGeografia() {
  const paisaje = crearPaisajeGeografia();
  let carteles = [];

  // El piso sube hasta las ruedas mientras el avión está en la pista y baja al despegar.
  const altura = (x, a) => limitar(x / 160, 0, 1) ** 1.4 * 0.42 * a;

  // Pista de Aeroparque y torre de control, al principio del viaje.
  function pista(ctx, v, piso) {
    const P = v.P;
    const base = v.snap(piso);
    const fin = v.anclaX + (110 - v.x) * v.k;
    if (fin <= 0) return;
    const a = v.alto;
    const tx = v.anclaX + (-95 - v.x) * v.k;
    v.rect(ctx, tx - a * 0.08, base - a * 1.2, a * 0.16, a * 1.2, '#b4bfd6');
    v.rect(ctx, tx - a * 0.08, base - a * 1.2, a * 0.05, a * 1.2, '#8c97b2');
    v.rect(ctx, tx - a * 0.22, base - a * 1.46, a * 0.44, a * 0.28, '#3a4262');
    v.rect(ctx, tx - a * 0.18, base - a * 1.41, a * 0.36, a * 0.13, '#8ff0f5');
    v.rect(ctx, tx - a * 0.18, base - a * 1.41, a * 0.36, P, '#d4fbff');
    v.rect(ctx, tx - a * 0.01, base - a * 1.62, P, a * 0.16, '#3a4262');
    v.rect(ctx, tx - a * 0.01 - P, base - a * 1.64, P * 3, P * 2, '#ff4d6d');
    ctx.fillStyle = '#5c6278';
    ctx.fillRect(0, base, fin, P * 6);
    ctx.fillStyle = '#767c94';
    ctx.fillRect(0, base, fin, P);
    ctx.fillStyle = '#3f4459';
    ctx.fillRect(0, base + P * 5, fin, P);
    ctx.fillStyle = '#fff8dc';
    const largo = P * 10;
    const corr = ((v.x * v.k) % (largo * 2) + largo * 2) % (largo * 2);
    for (let x = -corr; x < fin - largo; x += largo * 2) ctx.fillRect(v.snap(x), base + P * 2, largo, P);
  }

  // Avión rojo y blanco en pixeles, petiso y redondo, dibujado columna por columna con contorno oscuro.
  // Filón asoma por la cabina: se dibuja entre el fuselaje y el borde de la cabina.
  function avion(ctx, v) {
    const P = v.P;
    const a = v.alto / P; // altura de Filón, en pixeles de la escena
    const n = (k) => Math.round(k * a);
    const enTierra = limitar(1 - v.x / 120, 0, 1);
    const balanceo = v.reducido || enTierra > 0 ? 0 : Math.sin(v.reloj * 2.2) * 1.2;
    const ox = v.posicion(v.anclaX);
    const oy = v.posicion(v.anclaY + balanceo * P);
    const B = (dx, dy, w, h, color) => {
      if (w <= 0 || h <= 0) return;
      ctx.fillStyle = color;
      ctx.fillRect(ox + dx * P, oy + dy * P, w * P, h * P);
    };
    const ROJO = '#e8393f';
    const ROJO_CLARO = '#ff7a70';
    const ROJO_OSCURO = '#a51f33';
    const BLANCO = '#f7f3ea';
    const GRIS = '#c9c2b8';
    const PLATA = '#dfe3ea';
    const LINEA = '#1c1230';

    const cola = n(-0.8);
    const nariz = n(0.6);
    const capo = nariz - n(0.2); // desde acá empieza el capó del motor
    const perfil = (i) => {
      const t = limitar((i - cola) / (nariz - cola), 0, 1);
      let medio = lerp(a * 0.07, a * 0.2, Math.min(1, t / 0.45) ** 0.7);
      if (t > 0.86) medio *= Math.sqrt(1 - ((t - 0.86) / 0.14) ** 2 * 0.45);
      const centro = -0.3 * a - (1 - t) ** 2.5 * 0.12 * a;
      return { arriba: Math.round(centro - medio), abajo: Math.round(centro + medio), centro: Math.round(centro) };
    };
    const forma = (desde, hasta, alto, color, borde = false) => {
      for (let i = desde; i <= hasta; i++) {
        const [arriba, abajo] = alto(i);
        if (borde) B(i - 1, arriba - 1, 3, abajo - arriba + 3, LINEA);
        else B(i, arriba, 1, abajo - arriba + 1, color);
      }
    };

    // Ruedas gorditas (se guardan al despegar).
    if (enTierra > 0.05) {
      for (const dx of [n(-0.08), n(0.3)]) {
        B(dx, perfil(dx).abajo, 2, -perfil(dx).abajo - n(0.1), '#4a4f66');
        const r = n(0.065);
        B(dx - r, -2 * r - 1, 2 * r + 2, 2 * r + 1, LINEA);
        B(dx - r + 1, -2 * r, 2 * r, 2 * r - 1, '#2f3045');
        B(dx, -r - 1, 2, 2, '#9aa0b8');
      }
    }
    // Aleta de cola, chica y redondeada.
    const aletaAncho = n(0.24);
    const aleta = (i) => {
      const u = (i - cola) / aletaAncho;
      const alto = n(0.26) * Math.sqrt(Math.max(0, 1 - Math.max(0, u - 0.25) ** 2 / 0.56));
      return [perfil(i).arriba - Math.round(alto), perfil(i).arriba + 1];
    };
    forma(cola, cola + aletaAncho, aleta, null, true);
    forma(cola, cola + aletaAncho, aleta, ROJO);
    forma(cola, cola + Math.round(aletaAncho * 0.6), (i) => [aleta(i)[0], aleta(i)[0] + 1], BLANCO);
    // Fuselaje: contorno, rojo arriba y blanco abajo, capó plateado.
    const cuerpo = (i) => [perfil(i).arriba, perfil(i).abajo];
    forma(cola, nariz, cuerpo, null, true);
    forma(cola, capo, (i) => [perfil(i).arriba, perfil(i).centro], ROJO);
    forma(cola, capo, (i) => [perfil(i).arriba, perfil(i).arriba], ROJO_CLARO);
    forma(cola, capo, (i) => [perfil(i).centro + 1, perfil(i).abajo], BLANCO);
    forma(cola, capo, (i) => [perfil(i).abajo, perfil(i).abajo], GRIS);
    forma(capo + 1, nariz, cuerpo, PLATA);
    forma(capo + 1, nariz, (i) => [perfil(i).arriba, perfil(i).arriba + 1], '#ffffff');
    B(capo, perfil(capo).arriba, 1, perfil(capo).abajo - perfil(capo).arriba + 1, LINEA);
    B(capo + n(0.08), perfil(capo).arriba + 1, 1, perfil(capo).abajo - perfil(capo).arriba - 1, '#a9adbb');
    // Franja roja a lo largo de la panza blanca y estabilizador de cola.
    forma(cola + n(0.1), capo - 1, (i) => [perfil(i).centro + 3, perfil(i).centro + 3], ROJO);
    const est = perfil(cola + 2).centro;
    B(cola - 3, est - 1, n(0.26), 4, LINEA);
    B(cola - 2, est, n(0.26) - 2, 2, ROJO_OSCURO);

    // Filón en la cabina: se recorta en el borde superior del fuselaje.
    const borde = perfil(0).arriba;
    v.filon(ctx, { x: v.anclaX, y: v.anclaY + balanceo * P, recorte: oy + (borde + 1) * P, saltar: false });
    B(n(-0.2), borde, n(0.34), 2, ROJO_OSCURO);
    B(n(-0.2) - 1, borde - 1, 1, 3, LINEA);
    // Parabrisas curvo delante de Filón.
    const p0 = n(0.13);
    const largo = n(0.12);
    for (let j = 0; j <= largo; j++) {
      const alto = Math.round(n(0.12) * Math.sqrt(1 - (j / (largo + 1)) ** 2)) + 1;
      const base = perfil(p0 + j).arriba;
      B(p0 + j, base - alto - 1, 1, alto + 1, LINEA);
      if (j < largo) B(p0 + j, base - alto, 1, alto, '#bfe9ff');
    }
    B(p0 + 1, perfil(p0).arriba - n(0.09), 1, 2, '#ffffff');
    // Ala redondeada, abajo y adelante.
    const ala0 = n(-0.3);
    const ala1 = n(0.24);
    const alaY = perfil(0).centro + n(0.11);
    const ala = (i) => {
      const u = ((i - ala0) / (ala1 - ala0)) * 2 - 1;
      const grosor = n(0.055) * Math.sqrt(Math.max(0, 1 - u * u)) + 1;
      return [Math.round(alaY - grosor), Math.round(alaY + grosor * 0.8)];
    };
    forma(ala0, ala1, ala, null, true);
    forma(ala0, ala1, ala, ROJO);
    forma(ala0, ala1, (i) => [ala(i)[0], ala(i)[0]], ROJO_CLARO);
    forma(ala0, ala1, (i) => [ala(i)[1], ala(i)[1]], ROJO_OSCURO);
    // Buje rojo y hélice: disco tramado y una pala que gira.
    const fn = perfil(nariz);
    B(nariz, fn.centro - n(0.05) - 1, n(0.05) + 2, n(0.1) + 2, LINEA);
    B(nariz + 1, fn.centro - n(0.05), n(0.05), n(0.1), ROJO);
    B(nariz + 1, fn.centro - n(0.04), 1, 1, '#ffffff');
    const hx = nariz + n(0.05) + 2;
    const radio = n(0.3);
    ctx.fillStyle = v.trama(ctx, '#dfe8f2', 0.35);
    ctx.fillRect(ox + hx * P, oy + (fn.centro - radio) * P, 3 * P, radio * 2 * P);
    // La pala se ve entera o de canto, alternando: parece girar.
    const deCanto = !v.reducido && Math.floor(v.reloj * 28) % 2 === 1;
    const pala = deCanto ? Math.round(radio * 0.3) : radio;
    B(hx, fn.centro - pala, 2, pala * 2, '#55596f');
  }

  return {
    entrada: -60,
    vestuario: 'geografia',
    contorno: [42, 34, 68],
    dibujarFondo(ctx, v) {
      paisaje.fondo(ctx, v, v.anclaY + altura(v.x, v.alto));
    },
    dibujarMedio(ctx, v) {
      const piso = v.anclaY + altura(v.x, v.alto);
      carteles = paisaje.medio(ctx, v, piso);
      pista(ctx, v, piso);
    },
    dibujarFrente(ctx, v, emitir) {
      paisaje.cerca(ctx, v, v.anclaY + altura(v.x, v.alto));
      // Estelas de velocidad mientras vuela.
      if (!v.reducido && Math.abs(v.velocidad) > 70) {
        ctx.fillStyle = 'rgb(255 255 255 / .7)';
        for (let i = 0; i < 10; i++) {
          const y = v.snap(v.anclaY - v.alto * (0.1 + Math.random() * 1.3));
          const x = v.snap(Math.random() * v.W);
          ctx.fillRect(x, y, Math.min(v.P * 30, Math.abs(v.velocidad) * 0.1), v.P);
        }
        if (Math.random() < 0.35) emitir('humo', v.anclaX - v.alto * 1.05, v.anclaY - v.alto * 0.36, 1, '#ffffff', { fuerza: 0.2 });
      }
    },
    dibujarPersonaje(ctx, v) {
      avion(ctx, v);
    },
    dibujarPrimerPlano(ctx, v) {
      for (const { lugar, x, y } of carteles) {
        // El cartel se corre si quedaría encima del avión.
        if (Math.abs(x - v.anclaX) < v.alto * 1.2 && y > v.anclaY - v.alto * 1.3) continue;
        cartelPixel(ctx, lugar.nombre, x, Math.max(v.P * 12, y), v.P, { limites: [v.W < 860 ? v.P * 2 : 80, v.W - v.P * 2] });
      }
    },
    golpe(v, emitir) {
      emitir('humo', v.anclaX - v.alto * 1.05, v.anclaY - v.alto * 0.36, 4, '#ffffff', { fuerza: 0.35 });
    },
  };
}
