# Generador de desafíos por catálogos (sin IA)

Arma el desafío diario de **Normal** y de **Geografía** a partir de **catálogos de datos reales** (`datos/catalogos/`) y
**plantillas declarativas** (`datos/plantillas.json`). No llama a ninguna API de IA ni a ningún servicio
externo al generar, validar ni jugar: la red solo se usa al **importar** catálogos, con un comando aparte.

Farándula no tiene generador (sigue con su reserva) y está desactivada por omisión (`MODOS_ACTIVOS`).

## Cómo se usa

| Para… | Comando |
| --- | --- |
| Activarlo para la tarea diaria | `GENERADOR_NORMAL=catalogos` y/o `GENERADOR_GEOGRAFIA=catalogos` en el entorno (Vercel → Environment Variables). Sin la variable, ese modo sigue con la reserva. |
| Ver qué armaría para una fecha (sin publicar) | `npm run generar -- --vista-previa --fecha 2026-10-10` (`--modo geografia`; con `--json`, todo el detalle) |
| Publicar una fecha con el generador | `npm run generar -- --fecha 2026-10-10 --modo normal --generador catalogos` |
| Desde el panel | **Crear → Normal** o **Crear → Geografía → Publicar un día**: «Armar con: Catálogos (sin IA)», y el botón **Vista previa** |
| Actualizar los datos | `npm run importar-catalogos` (o algunos: `npm run importar-catalogos -- paises papas`), revisar `git diff datos/catalogos` y commitear |

La publicación es la de siempre (`asegurarDesafio`): bloqueo con vencimiento por fecha y modo, una sola
transacción para las siete preguntas con sus respuestas, variantes y puntajes, y `UNIQUE(modo, fecha)`.
Dos ejecuciones simultáneas publican un solo desafío y uno ya publicado no se toca (salvo «Rearmar»).
La fecha sale de `ZONA_HORARIA` (America/Argentina/Buenos_Aires): el programador y los crons preparan
mañana antes de medianoche, así el día nuevo está guardado antes de que empiece cualquier partida.

## Qué pasa si faltan candidatos

1. El generador intenta armar las siete preguntas con los catálogos.
2. Si no llega (faltan catálogos, todo lo posible se usó hace poco, nada pasa la validación) y
   `CATALOGOS_COMPLETAR_CON_RESERVA=1` (por omisión), completa **solo lo que falta** con la reserva
   verificada, respetando las mismas reglas del lote. El desafío queda con origen `mixto`.
3. Si tampoco alcanza, **no publica nada**: la corrida queda en `fallo` con el motivo (panel → Corridas,
   o `npm run admin -- corridas`). Nunca se publica un lote incompleto ni se inventa contenido.

Cada corrida guarda en `corridas.detalle.catalogos`: la semilla, las versiones, lo elegido y un resumen
de los descartes por motivo («fuera de rango», «cobertura insuficiente», «misma consigna que el …»).

## Catálogos (al 2026-10-08)

| Catálogo | Categoría | Entidades | Cobertura | Fuentes (licencia) |
| --- | --- | ---: | --- | --- |
| `paises` | Geografía | 195 | completa: 193 miembros de la ONU + Vaticano y Palestina; fronteras terrestres, moneda e idiomas oficiales | Unicode CLDR 48.2.3 (Unicode v3) + Wikidata (CC0) + GeoNames (CC BY 4.0) |
| `capitales` | Geografía | 202 | completa: capitales vigentes de los 195 (algunos países tienen varias), con las fronteras, idiomas y moneda de su país (del catálogo `paises`) | Wikidata (CC0) + `paises` |
| `provincias_argentinas` | Geografía | 23 | completa: las 23 provincias (sin CABA), con provincias vecinas y países limítrofes | Wikidata (CC0) |
| `capitales_argentinas` | Geografía | 23 | completa | Wikidata (CC0) |
| `departamentos_argentinos` | Geografía | 514 | completa: los 135 partidos bonaerenses y los 379 departamentos de las otras 22 provincias, con la cantidad verificada provincia por provincia (sin las comunas porteñas) | Georef, Servicio de Normalización de Datos Geográficos (CC BY 4.0; fuente IGN) + Wikidata (popularidad) |
| `subdivisiones` | Geografía | 442 | completa por país: divisiones de primer nivel con código ISO 3166-2 de 18 países (estados de Estados Unidos, México, Brasil, Venezuela, Alemania, Australia e India; departamentos de Uruguay, Colombia, Paraguay y Bolivia; regiones de Chile, Italia y Francia; provincias de España, Canadá y Ecuador; prefecturas de Japón), con la cantidad oficial verificada | Wikidata (CC0) |
| `capitales_subdivisiones` | Geografía | 251 | completa por país: las capitales de esas divisiones en 12 países (quedan afuera los países donde a alguna división le falta la capital o tiene varias: Alemania, India, Colombia, Francia, España; y Japón) | Wikidata (CC0) |
| `monedas` | Geografía | 143 | completa: monedas en curso de los 195 países (ISO 4217 de GeoNames/CLDR) | GeoNames (CC BY 4.0) + CLDR + Wikidata (CC0) |
| `idiomas` | Idiomas | 105 | completa: idiomas oficiales (u oficiales de hecho) de algún país, según CLDR | CLDR + Wikidata (CC0) |
| `elementos` | Ciencia | 118 | completa: números atómicos 1–118 sin huecos | Wikidata (CC0) |
| `constelaciones` | Astronomía | 88 | completa: las 88 de la IAU, con nombre en español, abreviatura, autor y zodíaco | Wikipedia en español, Anexo:Constelaciones (CC BY-SA 4.0, revisión registrada) + IAU + Wikidata (CC0) |
| `sistema_solar` | Astronomía | 13 | completa: 8 planetas y 5 planetas enanos reconocidos por la IAU | Wikidata (CC0) + IAU |
| `elementos_html` | Informática | 113 | completa: elementos del índice del estándar (sin los obsoletos) | WHATWG HTML Living Standard (CC BY 4.0) |
| `codigos_http` | Informática | 60 | completa: códigos asignados del registro de la IANA | IANA HTTP Status Code Registry |
| `pokemon` | Videojuegos | 1025 | completa: especies 1–1025 sin huecos, con tipos, generación y legendarios/míticos | PokeAPI (BSD-3) + Wikidata (CC0) |
| `papas` | Historia | 265 | completa: pontificados 1–267 sin huecos; cantidades por nombre verificadas | Wikidata (CC0) |
| `presidentes_eeuu` | Historia | 45 | completa: presidencias 1–47 sin huecos | Wikidata (CC0) |
| `secretarios_onu` | Historia | 9 | completa | Wikidata (CC0) |
| `campeones_mundial` | Deportes | 8 | completa: campeones 1930–2022 verificados uno por uno | Wikidata (CC0) |
| `sedes_mundial` | Deportes | 19 | completa: sedes 1930–2026 verificadas | Wikidata (CC0) |
| `mundial_femenino` | Deportes | 5 | completa: campeonas 1991–2023 | Wikidata (CC0) |
| `campeones_champions` | Deportes | 24 | completa: campeones de la Copa de Europa / Champions 1956–2025 verificados | Wikidata (CC0) |
| `campeones_f1` | Deportes | 35 | **parcial**: completo en 1950–2017 (a la fuente le faltan 2018, 2022 y 2024) | Wikidata (CC0) |
| `oscar_pelicula` | Cine | 98 | completa: una ganadora por ceremonia 1929–2026 (dos en 1930, ninguna en 1933) | Wikidata (CC0) |
| `canciones` | Música | 781 | **parcial**, completa por disco: 67 discos con la lista entera de su primera edición oficial | MusicBrainz (CC0) + Wikidata (CC0) |
| `nobel_literatura` | Literatura | 122 | completa (años sin entrega verificados); la nacionalidad actual falta en 17 → no se filtra por país | Wikidata (CC0) |
| `premio_cervantes` | Literatura | 51 | completa; 2 premiados sin año en la fuente → no se filtra por año | Wikidata (CC0) |
| `palabras` | Gramática | 47.611 | completa respecto del diccionario es_AR (ver reglas abajo) | Diccionario es_AR de LibreOffice / RLA-ES (GPL/LGPL/MPL) + FrequencyWords (CC BY-SA 4.0) |

Cada archivo trae su versión (`fecha.huella`), las fuentes con licencia, el criterio de cobertura, la
lista de verificaciones que pasó, las **correcciones explícitas** y lo que no se pudo verificar a mano.
Las verificaciones de los catálogos nuevos incluyen, entre otras: fronteras simétricas y las de Argentina,
Brasil, China y Alemania; 88 constelaciones con las 17 de Lacaille; 1025 Pokémon con la cantidad exacta
por generación; 23 provincias con vecindades simétricas y las de Córdoba; cantidades de los registros de
la IANA y del WHATWG.

- **Correcciones**: Reino de Dinamarca → Dinamarca (el miembro de la ONU no tiene código ISO en
  Wikidata); «Costa de Marfil» y «Timor Oriental» en vez de las formas no castellanas de CLDR; «Palestina»;
  se quita Rawalpindi como capital de Pakistán (fue provisional en 1959–1967); alias «Inglaterra» para la
  sede de 1966; «Titanic» con su título original (no tiene título en español en Wikidata); la Guayana
  Francesa cuenta como frontera de Francia (GeoNames la lista aparte); «Nidoran hembra» y «Nidoran macho»
  (sin el símbolo los dos nombres son iguales); nombres de constelaciones sin artículo («Can Mayor», no
  «El Can Mayor»; igual se acepta escrito con él); nombre corto de las provincias («Córdoba» en vez de «Provincia de Córdoba»); se
  quita «!!!!!!!» de Billie Eilish (no se puede escribir como respuesta).
- **Sin verificación manual** (posterior a lo que se pudo contrastar): el campeón del Mundial 2026, el de
  F1 2025 y el de la Champions 2026, tal como figuran en Wikidata.

### Fuentes evaluadas y descartadas

No se usaron porque **no pasaron la verificación** (prometerían un conjunto que no está completo) o no
son objetivas:

- Continentes de Wikidata (P30): España figura en África, Asia y Europa; Estados Unidos, en Asia. Se usa
  la clasificación M49 de la ONU vía CLDR.
- Constelaciones desde Wikidata sola: faltan abreviaturas y los nombres están en latín. Se resolvió con el
  anexo de Wikipedia en español y la lista de la IAU (ver tabla).
- Filmografías y sagas: Pixar (largos y cortos mezclados), Marvel Studios (fases y series mezcladas), James
  Bond (las películas son ítems de lista, sin título en español confiable), Toy Story y Shrek (se cuelan
  spin-offs y especiales), Rápido y furioso (títulos en inglés y películas anunciadas).
- Juegos Olímpicos (sedes): juegos cancelados y sedes que son estadios. macOS: faltan las versiones 10.0–10.4.
- Balón de Oro y Grammy: faltan años o premiados; el FIFA Balón de Oro 2010–2015 es otro premio.
- Copa Libertadores: campeones equivocados (1991, 1998, 2018) y 1993 sin dato. Copa América: sin datos.
- Nobel de la Paz: 112 personas contra 111 oficiales, y el Movimiento de la Cruz Roja contado aparte.
- Presidentes de Argentina: sin la sucesión numerada en Wikidata.
- Sedes del Mundial femenino: la de 2007 no figura (se importan solo las campeonas).
- Idioma → país («países donde se habla X» desde el idioma): 0 consignas utilizables con los tamaños
  permitidos; se usa la plantilla inversa (países por idioma oficial).
- Arte, mitología y gastronomía: no se encontró una fuente con una lista cerrada y objetiva («platos
  típicos», «dioses griegos» dependen de criterios editoriales). Quedan afuera hasta tener una.

## Cobertura y completitud

Una consigna solo se publica si el catálogo garantiza todas sus respuestas:

- Catálogo `completa`: cualquier condición vale…
- …pero solo sobre atributos que **no le faltan a ninguna entidad** (si falta la nacionalidad de alguien,
  «escritores de Chile» podría rechazar una respuesta correcta).
- Catálogo `parcial`: solo condiciones dentro de lo declarado completo: `completoPor` (un valor de un
  atributo: «las canciones del disco X») o `completoEn` (un tramo: «campeones de F1 entre 1990 y 2009»).

Si no se cumple, el candidato se descarta con el motivo «cobertura insuficiente».

## Reglas de texto (nombres)

Están en `servidor/catalogos/texto.js` y se aplican igual al evaluar, describir y validar:

- Se mira **solo el nombre canónico** de la entidad, nunca sus alias. «República Checa» es un alias de
  «Chequia»: no entra en «países que empiezan con R». Si alguien lo escribe, el rechazo lo explica
  («se toma el nombre «Chequia», que empieza con «C»»).
- No importan mayúsculas, tildes ni diéresis (á = a, ü = u). **La ñ es una letra distinta** de la n.
- Espacios, guiones, apóstrofos y signos separan palabras y no son letras: «Guinea-Bisáu» tiene dos
  palabras y once letras. Los dígitos no son letras.
- «Empieza/termina con» y «contiene la secuencia» se miran dentro de las palabras (no saltan espacios);
  «tiene la letra» y «cantidad de letras», sobre todas las letras del nombre.

## Filtros (operadores permitidos)

Un filtro es `{ "y": [condición, …] }` con hasta tres condiciones (o vacío, solo en plantillas con
`"todos": true`). Las alternativas van dentro de una condición (varias letras, varios valores).

| Operador | Campo | Parámetros | Enunciado |
| --- | --- | --- | --- |
| `empieza` / `termina` | nombre o atributo de texto | `textos` (1–3, hasta 4 letras), `no` | «cuyo nombre empiece con «A»» |
| `tiene` | nombre o texto | `letras` (1–5), `no` | «que tenga la «A» y la «S»» |
| `contiene` | nombre o texto | `texto` (2–5 letras), `no` | «que contenga «rr»» |
| `letras` / `palabras` | nombre o texto | `min`, `max` | «que tenga exactamente 5 letras» |
| `es` | atributo `texto` o `lista` | `valores` (1–4, de los que existen en el catálogo) | frase de la plantilla («de Sudamérica») |
| `entre` | atributo `numero` o `lista_numeros` | `desde`, `hasta` | frase de la plantilla («que haya asumido entre 1901 y 2000») |

`validarFiltro` rechaza operadores, claves, campos o valores desconocidos, y deja el filtro en **forma
canónica** (orden fijo, letras normalizadas): dos filtros equivalentes tienen la misma forma. Nada de lo que
viene de una plantilla se ejecuta como código, SQL ni expresión.

El enunciado (`describir`) y las respuestas (`evaluar`) salen del **mismo filtro**. `interpretar` hace
el camino inverso: las pruebas leen cada enunciado generado y comprueban que da la misma condición y el
mismo conjunto (`pruebas/generador.test.js`, más de 500 enunciados reales).

## Plantillas

Cada plantilla de `datos/plantillas.json` declara:

| Clave | Para qué |
| --- | --- |
| `id`, `familia`, `categoria`, `catalogo` | identidad; la familia agrupa consignas del mismo tipo (no se repite en un día) |
| `enunciado`, `sujetos`, `frases` | redacción rioplatense: base («Nombrá un país»), sujetos de las condiciones sobre texto («cuyo nombre») y frases de atributos («de {valor}», «que haya asumido entre {desde} y {hasta}») |
| `parametros` | de dónde salen: `valor` (valores de un atributo; `solo` los limita a una lista: «estado de» solo para países con estados), `letra` (iniciales o finales que existen), `letras` (combinaciones), `secuencia` (inicios, finales o sílabas que existen), `numero` (lista fija), `periodo` (tramos alineados) |
| `filtro` | el filtro con marcadores `{parametro}` (solo se reemplazan por valores tipados) |
| `respuestas.min` / `max` | conjunto aceptable (el máximo global es `CATALOGOS_MAX_RESPUESTAS`, por omisión 15.000) |
| `dificultad`, `prioridad` | dificultad base (0–1) y qué tan conocida es la consigna para el público general (1–3) |
| `rechazos`, `alcance`, `explicacion`, `coincidencia` | errores frecuentes con motivo, alcance y explicación de cada respuesta, y `exacta` para preguntas de palabras |
| `modos` (opcional) | modos donde se usa la plantilla (por omisión, todos los que admiten su categoría): `paises-idioma-geografia` es la copia de «países por idioma» para Geografía |

Antes de elegir, el generador **calcula** qué parámetros dan conjuntos válidos (tamaño, cobertura, nombres
sin ambigüedad) y descarta el resto con su motivo. No se agregan respuestas para llegar a una cantidad.

## Rareza, dificultad y coincidencia

- **Rareza** (política editorial reproducible): se ordenan las respuestas por popularidad (empates por id)
  y se reparten en quintiles: el 20 % más conocido es Grava y el 20 % menos conocido, Diamante. La
  popularidad es la cantidad de Wikipedias con artículo (sitelinks de Wikidata) o, para palabras, la
  frecuencia en subtítulos. **No son estadísticas de jugadores.** En las canciones sin artículo en Wikipedia
  (popularidad 0) el orden entre ellas es el del id, es decir, arbitrario pero estable.
- **Dificultad** (estimación editorial): la de la plantilla, más cuánto cuesta conocer las mejores respuestas
  del conjunto dentro de su catálogo, más condiciones combinadas y conjuntos chicos. Un conjunto grande no
  baja la dificultad por sí solo. El lote mezcla fácil, media y difícil.
- **Coincidencia exacta** (preguntas de palabras): solo vale la palabra escrita, sin importar mayúsculas ni
  tildes. No se completan fragmentos ni se sugieren parecidas («cas» no se convierte en «casa»).

## El lote del día

- **Normal**: siete preguntas generales: hasta dos de una misma categoría (Gramática, una), al menos
  cuatro categorías distintas, ninguna familia repetida y hasta dos del mismo catálogo.
- **Geografía**: siete preguntas de geografía (las plantillas de categoría Geografía y las marcadas con
  `modos: ["geografia"]`), ninguna familia repetida, hasta tres del mismo catálogo y, como mucho, cinco con
  condiciones sobre las letras del nombre (se prefieren tres o menos). El historial es propio del modo: la
  ventana de 60 días se cuenta dentro de cada modo, como en la reserva.
- Un nombre repetido en el catálogo («Capital» es departamento de varias provincias) solo vuelve ambigua
  la pregunta que incluye a los dos; las homónimas de afuera no se usan como rechazo.
- **Reproducible**: la semilla sale de `CATALOGOS_SEMILLA`, la fecha, el modo y las versiones de los
  catálogos, las plantillas, los filtros y las reglas de texto. Con los mismos datos e historial se
  arma el mismo lote; otra versión de un catálogo cambia el sorteo.
- Cada pregunta publicada guarda `firma`, `conjunto` y `generacion` (plantilla, filtro, parámetros,
  versiones, semilla, dificultad y MinHash del conjunto).

## Repeticiones

Una consigna no se repite hasta pasados **60 días calendario completos**: `CATALOGOS_DIAS_SIN_REPETIR`
(60 por omisión; un valor explícito se respeta). Los días se cuentan en fechas del calendario de
`ZONA_HORARIA` (no en horas), hacia atrás **y hacia adelante** (cuenta los días ya programados):

| Distancia entre fechas | ¿Se puede repetir? |
| ---: | --- |
| 59 días | no |
| 60 días | sí |
| 61 días | sí |

(`dentroDeVentana(a, b, dias)` en `servidor/tiempo.js`: `|días entre a y b| < dias`. El 2026-12-01 y el
2027-01-29 están a 59 días; el 2027-01-30, a 60.)

Dentro de la ventana —y siempre dentro del mismo lote— se descarta un candidato si:

1. tiene la misma **firma**: catálogo + filtro canónico. No entran el id ni la familia de la plantilla, la
   versión del catálogo ni la redacción, así que renombrar una plantilla, reimportar los datos o cambiar el
   texto no habilita repetir. Dos filtros equivalentes (valores en otro orden) tienen la misma firma;
2. tiene exactamente el mismo **conjunto** de respuestas del mismo catálogo (condiciones distintas que,
   con estos datos, dicen lo mismo);
3. es casi el mismo conjunto (≥ 90 % de las respuestas) que una pregunta reciente **cargada a mano o de la
   reserva** (no tienen condición, así que las respuestas son la única evidencia).

**Solaparse no es ser equivalente**: «países de Sudamérica» y «países de Sudamérica o Centroamérica»
comparten muchas respuestas pero son consignas distintas. El solapamiento (Jaccard por MinHash ≥ 90 % con
una pregunta del mismo catálogo dentro de la ventana) solo **baja la preferencia**. En el mismo lote,
además, no conviven dos preguntas que compartan la mitad de las respuestas.

Fuera de la ventana **nada bloquea**: a los 60 días una consigna vuelve a estar disponible. También se
evitan las familias usadas en los últimos 3 días (preferencia, no bloqueo). Los intentos están acotados
(`intentosPorPlantilla`, `intentosTotales`) y cada descarte queda registrado con su motivo.

Los desafíos viejos no se reescriben: las firmas nuevas se calculan al generar, y las preguntas publicadas
antes conservan la suya.

## Capacidad y simulación

```
npm run capacidad-catalogos                 # consignas distintas utilizables, por categoría, familia y plantilla
npm run simular-calendario                  # 180 días seguidos en una base temporal (no toca producción)
npm run simular-calendario -- --dias 365 --semilla otra --inicio 2026-12-01 --manuales 7 --futuros 3 --json informe.json
```

`capacidad-catalogos` cuenta consignas **utilizables** (tamaño en rango, cobertura, sin nombres ambiguos,
pasan la validación) y distintas por conjunto, no combinaciones teóricas. `simular-calendario` publica día
por día con el flujo real (`asegurarDesafio`) sobre una base temporal y la reserva del repositorio (solo
lectura), con historial manual previo y días futuros ya programados opcionales, e informa días solo con
catálogos, mixtos y fallidos, repeticiones (falla si alguna equivalencia cae a menos de la ventana),
variedad y dificultad.

### Resultados (2026-10-08)

**Capacidad** (`npm run capacidad-catalogos`, ventana de 60 días): con 7 preguntas por día y como mucho
una de Gramática, una ventana necesita al menos 360 consignas fuera de Gramática.

| | Antes | Ahora |
| --- | ---: | ---: |
| Catálogos | 14 | 25 |
| Plantillas | 35 | 58 |
| Consignas distintas fuera de Gramática | 241 | **668** |
| Consignas de Gramática | 2.473 | 2.473 |
| Aporte en la ventana (cada familia, como mucho una por día) | 241 | 551 |

Por categoría, fuera de Gramática: Videojuegos 259, Geografía 170, Música 65, Historia 40, Ciencia 37,
Deportes 21, Cine 20, Literatura 16, Informática 15, Astronomía 13, Idiomas 12. Antes se agotaban todas
las familias dentro de los 60 días. Ahora el cuello de botella son las familias chicas (Mundial, Cervantes,
sistema solar, secretarios de la ONU), que salen poco y no frenan el calendario.

**Simulaciones** (`npm run simular-calendario`, base temporal, `CATALOGOS_COMPLETAR_CON_RESERVA=1`,
`CATALOGOS_MAX_RESPUESTAS=15000`, plantillas versión 2, todas las versiones de catálogo registradas en el
informe `--json`):

| Semilla | Días | Historial inicial | Solo catálogos | Mixtos | Fallos | Repeticiones < 60 días | Menor distancia | Consignas distintas |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `simulacion`, desde 2026-10-08 | 180 | vacío | 180 | 0 | 0 | 0 | 60 días | 620 |
| `otra-semilla`, desde 2026-10-08 | 180 | 14 días previos y 4 futuros ya programados (reserva) | 176 (+4 programados) | 0 | 0 | 0 | 60 días | 617 |
| `filon`, desde 2026-12-01 | 365 | 7 días previos y 6 futuros ya programados (reserva) | 359 (+6 programados) | 0 | 0 | 0 | 60 días | 806 |

- Variedad (180 días, semilla `simulacion`, 1.260 preguntas): Geografía 342, Videojuegos 184,
  Gramática 159, Ciencia 110, Historia 103, Música 86, Deportes 63, Cine 52, Literatura 45,
  Informática 41, Astronomía 39, Idiomas 36. Ningún catálogo pasa de dos preguntas por día y ninguna
  categoría de dos; 4 días con 4 categorías, 69 con 5, 99 con 6 y 8 con 7.
- Dificultad: 25 % fácil, 51 % media, 24 % difícil.
- Las consignas vuelven a salir a partir de los 60 días (640 reutilizaciones en 180 días), nunca antes.
- Tiempo: unos 1,4 s por día en una laptop (catálogos ya cargados en memoria).

### Modo Geografía (2026-10-08)

Siete preguntas de geografía por día: una ventana de 60 días necesita al menos **420** consignas distintas.
Con los catálogos de geografía que había (países, capitales, provincias argentinas, monedas) eran 170: el
modo se agotaba en unos 24 días. Para llegar se sumaron catálogos reales y plantillas:

| | Antes | Ahora |
| --- | ---: | ---: |
| Catálogos con preguntas de geografía | 5 | 8 (`subdivisiones`, `capitales_subdivisiones`, `departamentos_argentinos`) |
| Plantillas del modo | 17 | 65 |
| Consignas distintas | 170 | **1.090** |
| Aporte en la ventana (cada familia, como mucho una por día) | 170 | 703 |

Simulaciones (`npm run simular-calendario -- --modo geografia`, mismas condiciones que arriba):

| Semilla | Días | Historial inicial | Solo catálogos | Mixtos | Fallos | Repeticiones < 60 días | Menor distancia | Consignas distintas |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `simulacion`, desde 2026-10-11 | 180 | vacío | 180 | 0 | 0 | 0 | 60 días | 554 |
| `otra`, desde 2026-12-01 | 365 | 7 días previos y 4 futuros ya programados (reserva) | 361 (+4 programados) | 0 | 0 | 0 | 60 días | 615 |

- Preguntas con condiciones sobre las letras del nombre, por día (180 días): 3 en 108 días, 2 en 31, 5 en
  24, 4 en 7, 1 en 8 y 0 en 2. Con un tope duro de 4, el modo se quedaba sin consignas «sin letras» hacia
  el día 50 de cada ventana (17 días mixtos y 2 fallos en 180): por eso el tope es 5 y la preferencia, 3.
- Dificultad: 10 % fácil, 52 % media, 38 % difícil. Hay pocas consignas fáciles de geografía.
- Normal con los catálogos nuevos (180 días, semilla `otra-semilla`, 14 días previos y 4 programados):
  176 solo con catálogos (+4 programados), 0 mixtos, 0 fallos, 0 repeticiones a menos de 60 días; 1.583
  consignas distintas fuera de Gramática.

## Cómo agregar…

**Un catálogo**:

1. Agregá su definición en `scripts/catalogos/definiciones.mjs`: `id`, `nombre`, `cobertura` (tipo y
   criterio), `atributos` (tipo y etiqueta) y `importar()`. Esta función descarga los datos (Wikidata
   con `sparql`, `etiquetas` y `propiedad`; otras fuentes con `descargar`), los transforma y
   **verifica** la cobertura con `exigir(…)`: cantidades esperadas, ordinales sin huecos, años sin
   entrega. Si una verificación falla, el archivo no se escribe.
2. Sumala a `DEFINICIONES` y corré `npm run importar-catalogos -- <id>`.
3. Revisá el archivo generado (verificaciones, correcciones, `sinVerificarManualmente`) y commitealo.

Usá solo fuentes cuya licencia permita reutilizar los datos, y declarala en `fuentes`.

**Una plantilla**: agregala a `datos/plantillas.json`. `cargarPlantillas` valida el esquema y la prueba
de coherencia la recorre sola. Mirá cómo queda con `npm run generar -- --vista-previa`.

**Un operador de filtro**: en `servidor/catalogos/filtros.js` sumalo a `OPERADORES`. Después:

- su validación en `validarFiltro`;
- su evaluación en `cumple`;
- su frase en `verbo` o `describir`;
- su patrón en `interpretar`;
- su explicación en `explicarFalla`;
- una prueba de ida y vuelta.

Si cambia cómo se describe o se evalúa, subí `VERSION_FILTROS`.

## Configuración

| Variable | Por omisión | Para qué |
| --- | --- | --- |
| `GENERADOR_NORMAL` | `reserva` | `catalogos` para armar Normal con este generador |
| `GENERADOR_GEOGRAFIA` | `reserva` | `catalogos` para armar Geografía con este generador |
| `MODOS_ACTIVOS` | `normal,geografia` | modos que se publican y se juegan (Normal siempre); Farándula está apagada por omisión |
| `CATALOGOS_SEMILLA` | `filon` | base de la semilla (cambiarla cambia los sorteos) |
| `CATALOGOS_DIAS_SIN_REPETIR` | `60` | ventana de repeticiones en días calendario (a 59 se rechaza, a 60 se permite) |
| `CATALOGOS_MAX_RESPUESTAS` | `15000` | tope de respuestas de una pregunta generada |
| `CATALOGOS_COMPLETAR_CON_RESERVA` | `1` | completar con la reserva si faltan candidatos (`0`: fallar sin publicar) |
| `CATALOGOS_DIR`, `CATALOGOS_PLANTILLAS` | `datos/catalogos`, `datos/plantillas.json` | ubicación de los datos |

## Limitaciones

- **Gramática:**
  - Las palabras son las del diccionario es_AR en su forma de diccionario. Un plural o una conjugación
    («casas», «comiste») no valen, y el enunciado lo dice («en singular o infinitivo»).
  - Las entradas sueltas del diccionario se filtran con reglas explícitas; algunas formas irregulares
    frecuentes («estoy», «fue») siguen valiendo.
- **Música:** hay 67 discos («Purple Rain» no figura como álbum en MusicBrainz y quedó afuera). Muchas
  canciones no tienen artículo en Wikipedia, así que su rareza entre ellas es arbitraria (pero estable).
- **Variedad:** Geografía (países, capitales, provincias, monedas) es la categoría más frecuente (≈ 27 %
  de las preguntas). Nunca hay más de dos por día, pero se nota en el mes. Informática, Astronomía,
  Idiomas y Literatura tienen pocas consignas (12–16 cada una) y salen cada 4 o 5 días.
- **Repeticiones a los 60 días:** con 668 consignas fuera de Gramática y unas 370 preguntas fuera de Gramática por ventana, a partir
  del segundo bimestre la mayoría de las preguntas son consignas ya vistas hace 60 días o más. Es lo que
  pide la regla. Para estirarlo hay que sumar catálogos o plantillas.
- **Arte, mitología y gastronomía:** sin catálogo (ver fuentes descartadas).
- **Geografía:** muchas consignas son de letras («un país cuyo nombre tenga la «B» y la «R»»): en uno de
  cada siete días, cinco de las siete. Las de fronteras, regiones e idiomas son menos y se agotan antes.
  Normal y Geografía tienen historiales separados: la misma consigna puede salir en los dos modos con pocos
  días de diferencia.
- **Departamentos argentinos:** 20 de 514 no se encontraron en Wikidata (popularidad 0: su rareza entre
  ellos es arbitraria pero estable).
- **Entorno:** la ventana de 60 días es el valor por omisión. Ningún entorno desplegado tenía
  `CATALOGOS_DIAS_SIN_REPETIR=30` configurado (no estaba en Vercel ni en el `.env` local). Si alguno lo
  tuviera, ese valor explícito se respeta y hay que borrarlo o ponerlo en 60.
- **Mantenimiento:** los datos se actualizan solo al reimportar. Wikidata cambia, y una verificación que
  falla frena la actualización hasta que se revise.
