// Catálogos agregados por temas (cada módulo exporta su lista de definiciones).
import { INFORMATICA } from './informatica.mjs';
import { MUSICA } from './musica.mjs';
import { HISTORIA_GEO } from './historia_geo.mjs';

import { CIENCIA_ARTE } from './ciencia_arte.mjs';

import { GASTRONOMIA } from './gastronomia.mjs';

import { OBRAS } from './obras.mjs';

import { DEPORTISTAS } from './deportistas.mjs';

import { TELEVISION } from './television.mjs';

import { NATURALEZA } from './naturaleza.mjs';

import { CLUBES } from './clubes.mjs';

import { VIDEOJUEGOS } from './videojuegos.mjs';

import { AUTORES } from './autores.mjs';

import { FICCION } from './ficcion.mjs';

import { COMIDAS } from './comidas.mjs';

export const NUEVAS = [...INFORMATICA, ...MUSICA, ...HISTORIA_GEO, ...CIENCIA_ARTE, ...GASTRONOMIA, ...OBRAS, ...DEPORTISTAS, ...TELEVISION, ...NATURALEZA, ...CLUBES, ...VIDEOJUEGOS, ...AUTORES, ...FICCION, ...COMIDAS];
