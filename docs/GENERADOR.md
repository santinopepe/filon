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
| Actualizar los datos | `npm run importar-catalogos` (o algunos: `npm run importar-catalogos -- paises papas`), revisar `git diff datos/catalogos` y conservar los cambios revisados |

La publicación es la de siempre (`asegurarDesafio`): bloqueo con vencimiento por fecha y modo, una sola
transacción para las siete preguntas con sus respuestas, variantes y puntajes, y `UNIQUE(modo, fecha)`.
Dos ejecuciones simultáneas publican un solo desafío y uno ya publicado no se toca (salvo «Rearmar»).
Las escrituras de preguntas, respuestas, variantes y preparación del revelado se envían agrupadas
en un batch dentro de esa transacción. El orden se calcula con las respuestas que ya están en memoria,
para evitar decenas de viajes HTTP a Turso mientras se mantiene el bloqueo. Un fallo revierte todo.
El panel conserva el resultado fallido y su corrida; solo abre el desafío cuando existe.
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

## Catálogos conservados

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

### Ampliación conectada y trabajo retomado (2026-10-08)

Las cuatro categorías incorporadas a Normal y al editor del panel son **Arte, Naturaleza,
Gastronomía y Televisión**. También se amplían Música, Ciencia, Deportes, Cine, Videojuegos,
Literatura, Informática, Historia y Geografía. Los primeros once catálogos de la tabla incluyen
el trabajo previo que se conserva. Las vistas no duplican registros en el total por categoría.
Las fuentes exactas, revisiones, exclusiones y correcciones están en cada JSON.

| Catálogo | Categoría | Registros | Universo, fuente y licencia |
| --- | --- | ---: | --- |
| `propiedades_css` | informatica | 492 | Todas las propiedades con estado «standard» en mdn-data (sin prefijos de proveedor ni propiedades obsoletas o experimentales). [MDN mdn-data 2.37.2](https://github.com/mdn/data) (CC0 1.0); [MDN browser-compat-data 8.1.5](https://github.com/mdn/browser-compat-data) (CC0 1.0) |
| `lenguajes_programacion` | informatica | 217 | Todos los ítems de Wikidata que son instancia de «lenguaje de programación» (Q9143, o una subclase) con artículo en al menos 15 ediciones de Wikipedia, salvo los lenguajes de marcado y de hojas de estilo (XML, CSS, TeX). [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `formatos_archivo` | informatica | 163 | Todos los tipos MIME image/*, audio/* y video/* de mime-db con al menos una extensión, agrupados por extensión compartida. [mime-db 1.54.0](https://github.com/jshttp/mime-db) (MIT); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `sistemas_operativos` | informatica | 157 | Todos los ítems de Wikidata que son instancia de «sistema operativo» (Q9135, o una subclase) con artículo en al menos 30 ediciones de Wikipedia; incluye versiones con artículo propio (Windows 7, Android Lollipop). [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `perifericos` | informatica | 34 | Los artículos de los grupos «Input devices», «Output devices» y «Removable data storage» de la plantilla de navegación «Basic computer components» de Wikipedia en inglés (con sus subelementos). [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1360093171) (CC BY-SA 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `componentes_pc` | informatica | 18 | Los artículos del grupo «Computer case» de la plantilla de navegación «Basic computer components» de Wikipedia en inglés (con sus subelementos). [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1360093171) (CC BY-SA 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `conectores` | informatica | 14 | Los artículos del grupo «Ports» de la plantilla de navegación «Basic computer components» de Wikipedia en inglés, con su vigencia (actual u obsoleto) tal como los agrupa la plantilla. [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1360093171) (CC BY-SA 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `instrumentos_musicales` | musica | 359 | Todos los ítems de Wikidata con clasificación Hornbostel-Sachs (P1762), nombre en español y artículo en al menos 15 ediciones de Wikipedia, salvo las categorías genéricas («instrumento de viento»). [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `presidentes_argentinos` | historia | 51 | Todas las personas de la tabla «Presidentes de la Nación Argentina» del anexo de Wikipedia en español (incluye a los presidentes de facto). No incluye a quienes ejercieron el Poder Ejecutivo sin el título de presidente (Luder, Puerta, Camaño, Liendo, Lacoste, Saint-Jean, Pinedo). [Wikipedia](https://es.wikipedia.org/w/index.php?oldid=175663978) (CC BY-SA 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `parques_nacionales_argentinos` | geografia | 39 | Todas las áreas de categoría «parque nacional» de la tabla «Parques nacionales» del artículo «Sistema Nacional de Áreas Protegidas (Argentina)» de Wikipedia en español, contrastada con el dataset oficial de áreas protegidas nacionales. [Wikipedia](https://es.wikipedia.org/w/index.php?oldid=170963602) (CC BY-SA 4.0); [Ministerio de Ambiente, «Áreas protegidas nacionales»](https://ciam.ambiente.gob.ar/dt_csv.php?dt_id=460) (CC BY 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `ciudades` | geografia | 597 | Las localidades pobladas de GeoNames (cities15000) con 1.000.000 habitantes o más en todo el mundo y, en la Argentina, con 100.000 o más. La población es la que registra GeoNames a la fecha de la descarga (no siempre del mismo año ni con el mismo criterio de ciudad o aglomerado). [GeoNames, cities15000](https://www.geonames.org) (CC BY 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `albumes` | musica (base) | 9683 | 143 artistas semilla; grupos de lanzamientos de tipo Album de MusicBrainz, con estado website-default. [MusicBrainz](https://musicbrainz.org) (CC0 1.0 (datos centrales)); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `albumes_estudio` | musica | 1728 | Vista de albumes: sin tipos secundarios; comparte entidades y universo. Fuentes y licencias del base `albumes`. |
| `albumes_en_vivo` | musica | 2793 | Vista de albumes: tipo secundario Live; comparte entidades y universo. Fuentes y licencias del base `albumes`. |
| `artistas_musicales` | musica | 2332 | 2332 registros únicos; relaciones documentadas de las bandas semilla y sus integrantes. [MusicBrainz](https://musicbrainz.org) (CC0 1.0 (datos centrales)); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `bandas_argentinas` | musica | 165 | Vista por país Argentina; relaciones completas del grafo base, no todas las bandas argentinas. Fuentes y licencias del base `artistas_musicales`. |
| `cientificos` | ciencia | 664 | Personas Nobel de Física, Química y Medicina/Fisiología; categorías paginadas y unidas por id. Motivaciones oficiales en inglés intactas. [Nobel Prize API](https://api.nobelprize.org/2.1/laureates) (CC0 1.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `obras_arte` | arte | 330 | P31 directo pintura; nombre es/mul y ≥20 sitelinks Wikimedia. No incluye todas las subclases de pintura. [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `deportistas` | deportes | 115 | 69 personas de los planteles argentinos 1978/1986/2022 más 47 ganadores del Balón de Oro 1956–2025; 115 personas únicas. [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1379066239) (CC BY-SA 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `clubes_futbol` | deportes | 61 | 66 Libertadores 1960–2025, 24 Sudamericanas 2002–2025 y 70 Copas de Europa/Champions 1956–2025, contrastadas por edición. [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1375300496) (CC BY-SA 4.0); [UEFA: FCSB facts, historial oficial](https://www.uefa.com/uefaconferenceleague/news/0278-15f61fdeb728-2304d29ff95f-1000--club-facts-fcsb/) (contraste factual; textos y marcas reservados); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `peliculas` | cine | 434 | 15 directores semilla por P57 y ocho Harry Potter por P179; cortos y telefilmes incluidos, estreno confirmado hasta la importación. [Wikidata](https://www.wikidata.org) (CC0 1.0); [HarryPotter.com: colección oficial de películas](https://www.harrypotter.com/discover/films) (contraste factual; textos y marcas reservados) |
| `peliculas_argentinas` | cine | 28 | Vista por país Argentina; no todas las películas argentinas. Fuentes y licencias del base `peliculas`. |
| `series` | television | 93 | 67 ganadoras de Emmy 1966–2025 y planteles de 13 Star Trek, 6 CSI y 7 NCIS; 93 títulos únicos. [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1377769840) (CC BY-SA 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `videojuegos` | videojuegos | 60 | Uncharted (12), Mass Effect (18), Age of Empires (30) por P179/P8345; con derivados, expansiones y reediciones estrenadas. [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `personajes_ficcion` | literatura | 9 | Los nueve miembros originales de la Comunidad del Anillo, verificados uno por uno. [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1359777139) (CC BY-SA 4.0); [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `libros` | literatura | 340 | 13 autores semilla; novelas y novelas cortas independientes, colecciones de cuentos y poemarios con título español/mul; no ediciones ni partes declaradas de colecciones. [Wikidata](https://www.wikidata.org) (CC0 1.0); [Wikipedia](https://en.wikipedia.org/w/index.php?oldid=1364208403) (CC BY-SA 4.0) |
| `autores` | literatura | 170 | Unión de los 122 Nobel de Literatura y 51 Cervantes conservados: 170 personas; no todos los escritores. [Wikidata](https://www.wikidata.org) (CC0 1.0) |
| `animales` | naturaleza | 151 | Ocho grupos taxonómicos, evaluación UICN no extinta e identidad exacta GBIF; una respuesta por taxón aceptado. [Wikidata](https://www.wikidata.org) (CC0 1.0); [GBIF Backbone Taxonomy](https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c) (CC BY 4.0) |
| `frutas_verduras` | gastronomia | 175 | Doce tablas cerradas del capítulo XI del CAA (12/2025); 178 filas y 175 entidades al unir pertenencias. [ANMAT, Código Alimentario Argentino, capítulo XI](https://www.argentina.gob.ar/sites/default/files/capitulo_xi_vegetales_actualiz_2025-12.pdf) (CC BY 4.0 (Argentina.gob.ar, términos y condiciones)) |
| `comidas` | gastronomia | 159 | P31 directo plato o postre, nombre es/mul y ≥20 sitelinks Wikimedia; no todos los platos del mundo. [Wikidata](https://www.wikidata.org) (CC0 1.0) |

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
- Estudios y sagas sin contraste cerrado: no se habilitan Pixar, Ghibli, Disney Animation ni otras sagas
  solo por encontrar una relación P272/P179. Harry Potter sí pasó el contraste de ocho películas.
  Las filmografías semilla se restringen al criterio explícito de Wikidata, sin afirmar una bibliografía externa exhaustiva.
- Juegos Olímpicos (sedes): juegos cancelados y sedes que son estadios. macOS: faltan las versiones 10.0–10.4.
- Grammy: no se incorpora. El Balón de Oro se resolvió con la tabla por edición, incluyendo
  expresamente las seis ediciones FIFA 2010–2015, sin confiar en un único id del premio.
- Copa Libertadores: las discrepancias se inspeccionaron y se registran como correcciones explícitas
  contra la lista de campeones por año. No se fuerza P1346. Copa América y campeonato argentino quedan afuera.
- Nobel de la Paz: 112 personas contra 111 oficiales, y el Movimiento de la Cruz Roja contado aparte.
- Presidentes de Argentina: se resolvió con el anexo por persona y tipo de acceso; no se inventa una sucesión numerada.
- Sedes del Mundial femenino: la de 2007 no figura (se importan solo las campeonas).
- Idioma → país («países donde se habla X» desde el idioma): 0 consignas utilizables con los tamaños
  permitidos; se usa la plantilla inversa (países por idioma oficial).
- Mitología: no se incorpora un panteón universal. Arte y Gastronomía sí tienen los universos
  explícitos de la nueva tabla; no se usa una lista editorial de «platos típicos».

## Cobertura y completitud

Una consigna solo se publica si el catálogo garantiza todas sus respuestas:

- Catálogo `completa`: cualquier condición vale…
- …pero solo sobre atributos que **no le faltan a ninguna entidad** (si falta la nacionalidad de alguien,
  «escritores de Chile» podría rechazar una respuesta correcta).
- Catálogo `parcial`: solo condiciones dentro de lo declarado completo: `completoPor` (un valor de un
  atributo: «las canciones del disco X») o `completoEn` (un tramo: «campeones de F1 entre 1990 y 2009»).

`completoPor` admite un atributo, una lista de atributos o un objeto como
`{ directores: ["Steven Spielberg", "Lucrecia Martel"], sagas: ["Harry Potter"] }`.
Solo esos valores certifican grupos completos; los codirectores encontrados no quedan certificados.
Los atributos multivaluados conservan todas sus pertenencias. `null` significa desconocido;
`[]` significa ninguno dentro del universo declarado. Por ejemplo, Curie tiene `premios_med: []`.

Una vista no guarda entidades: carga el base, aplica su filtro, comparte los objetos y hereda la
cobertura, atributos y temas. Su `universo` es el id del base. La cobertura se valida sobre el base
más el filtro de la vista y el de la consigna. La firma usa ese universo y esa conjunción canónica;
una vista y la condición equivalente sobre el base tienen la misma firma. Los topes y la capacidad
deduplicada también cuentan por universo.

En catálogos completos se puede acotar primero con un atributo íntegro o el nombre y luego comprobar
otro dato dentro de ese universo. Un dato desconocido nunca se usa para esconder sus propios `null`.
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
  cuatro categorías distintas, ninguna familia repetida y **una sola pregunta por catálogo** (contando juntos
  un catálogo y sus vistas: «películas» y «películas argentinas» no salen el mismo día).
- **Geografía**: siete preguntas de geografía (las plantillas de categoría Geografía y las marcadas con
  `modos: ["geografia"]`), ninguna familia repetida, hasta tres del mismo universo y, como mucho, cinco con
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

1. tiene la misma **firma**: universo + filtro canónico. No entran el id ni la familia de la plantilla, la
   versión del catálogo ni la redacción, así que renombrar una plantilla, reimportar los datos o cambiar el
   texto no habilita repetir. Dos filtros equivalentes (valores en otro orden) tienen la misma firma;
2. tiene exactamente el mismo **conjunto** de respuestas del mismo universo (condiciones distintas que,
   con estos datos, dicen lo mismo);
3. es casi el mismo conjunto (≥ 90 % de las respuestas) que una pregunta reciente **cargada a mano o de la
   reserva** (no tienen condición, así que las respuestas son la única evidencia);
4. comparte ≥90 % de nombres normalizados (Jaccard) con una consigna de **otro universo**.
   Las preguntas nuevas guardan `nombresConjunto`. Para el historial generado antiguo se recuperan
   todos los nombres canónicos desde respuestas, por lotes y en lectura; no se reescribe ninguna
   pregunta, partida, firma ni metadato viejo. MinHash se conserva como compatibilidad y preferencia.
   La prueba de 99 nombres coincidentes sobre 100 detectó un falso negativo aproximado y ahora
   exige el cálculo exacto para el bloqueo entre universos.

**Solaparse no es ser equivalente**: «países de Sudamérica» y «países de Sudamérica o Centroamérica»
comparten muchas respuestas pero son consignas distintas. El solapamiento (Jaccard por MinHash ≥ 90 % con
una pregunta del mismo catálogo dentro de la ventana) solo **baja la preferencia**. En el mismo lote,
además, no conviven dos preguntas que compartan la mitad de las respuestas.

Fuera de la ventana **nada bloquea**: a los 60 días una consigna vuelve a estar disponible. También se
evitan las familias usadas en los últimos 3 días (preferencia, no bloqueo). Los intentos están acotados
(`intentosPorPlantilla`, `intentosTotales`) y cada descarte queda registrado con su motivo.

El algoritmo de firma de los catálogos viejos conserva su serialización y huella. Una fixture de
firmas históricas comprueba países, Pokémon y elementos. La versión del generador pasa a 3 y las
plantillas a 5; esos números afectan el sorteo, no alteran las firmas históricas.

### Rotación de categorías

Se usan `diasRotacion=5` y `pesoRotacion=0.6`, configurables. La deuda de categoría mira exclusivamente
fechas anteriores; los días futuros sí bloquean repeticiones, pero no cuentan como aparición pasada.
El horizonte se adapta a `ceil(60 / capacidad de la categoría)` para las categorías pequeñas.
Hay una penalización suave por gastar demasiado pronto otra consigna de una categoría pequeña y
por elegirla dos veces en el mismo día. Son preferencias: no se agrega un bloqueo duro que impida
completar las siete preguntas. Se mantienen el tope de dos por categoría y el mínimo de cuatro categorías.
La frecuencia conseguida, incluidos intervalos máximos y huecos al comienzo/final, está en CAPACIDAD.

## Capacidad y simulación

El cierre reproducible está en [CAPACIDAD.md](CAPACIDAD.md): registros y consignas utilizables por
categoría y catálogo, cota para 60 × 7 = 420 con topes, distribución por dificultad y categoría,
intervalos de rotación, y ambas simulaciones de 180 días. Los JSON de detalle están en `docs/informes/`.

```sh
npm run capacidad-catalogos
npm run capacidad-catalogos -- --modo geografia
npm run capacidad-catalogos -- --json
npm run simular-calendario -- --dias 180 --inicio 2026-10-09 --json /tmp/normal.json
npm run simular-calendario -- --modo geografia --dias 180 --inicio 2026-10-09 --json /tmp/geografia.json
npm run simular-calendario -- --rotacion-dias 5 --rotacion-peso 0.6
```

La capacidad cuenta candidatos que pasan cobertura, validación, mínimo de cinco respuestas y
nombres no ambiguos; deduplica conjuntos del mismo universo. Las consignas propias de una vista
se informan, pero no se suman dos veces a la categoría. La cota con topes es una comprobación
estática: no demuestra el reparto diario ni elimina solapamientos entre universos. La simulación
publica en una base temporal, verifica repeticiones exactas y casi iguales, y comprueba topes reales.
No toca preguntas ni partidas existentes.

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
| `CATALOGOS_DIAS_ROTACION` | `5` | horizonte base de preferencia por categorías ausentes; se adapta a las pequeñas |
| `CATALOGOS_PESO_ROTACION` | `0.6` | peso de la preferencia por rotación |
| `CATALOGOS_MAX_RESPUESTAS` | `15000` | tope de respuestas de una pregunta generada |
| `CATALOGOS_COMPLETAR_CON_RESERVA` | `1` | completar con la reserva si faltan candidatos (`0`: fallar sin publicar) |
| `CATALOGOS_DIR`, `CATALOGOS_PLANTILLAS` | `datos/catalogos`, `datos/plantillas.json` | ubicación de los datos |

## Actualización y revisión editorial

Usar Node 24. La red queda confinada a la importación; no se agregaron servicios ni dependencias.
Los comandos de actualización son:

```sh
npm run importar-catalogos -- albumes artistas_musicales bandas_argentinas albumes_estudio albumes_en_vivo
npm run importar-catalogos -- cientificos obras_arte deportistas clubes_futbol
npm run importar-catalogos -- peliculas peliculas_argentinas series videojuegos personajes_ficcion
npm run importar-catalogos -- libros autores animales frutas_verduras comidas
npm run importar-catalogos -- --refrescar cientificos
node scripts/vista-previa-catalogos.mjs expansion-
python3 scripts/herramientas/plantillas.py /tmp/plantillas-nuevas.json
npm run verificar
```

`--refrescar` ignora la caché; `IMPORTAR_CACHE_HORAS` controla su vigencia. Las consultas de Wikidata
usan GET y validan JSON/bindings antes de cachear, evitando aceptar respuestas vacías inválidas.
Se mantienen pausas mínimas por servidor (MusicBrainz 1,1 s; Wikidata 0,4 s) y reintentos acotados.
La importación de MusicBrainz con caché fría puede tardar bastante: recorre personas, bandas y sus
relaciones, sin cortar los conjuntos. Una vista requiere un base cargable; no se escribe huérfana.
Una verificación fallida conserva el archivo anterior y debe investigarse antes de darlo por actualizado.

La vista previa emite cada enunciado real, cantidad, dificultad y cinco respuestas más/menos conocidas.
Se revisaron las plantillas nuevas y, en particular, Soda Stereo/Beatles, planteles, Emmy,
franquicias, autores, grupos zoológicos y las tablas del CAA. La utilidad de plantillas reemplaza por
id y reescribe exactamente con `json.dumps(..., ensure_ascii=False, indent=2) + '\n'`.
No se truncan conjuntos: los rangos superiores rechazan candidatos demasiado grandes.

## Limitaciones y pendientes explícitos

- **Plantas:** se encontró el [listado regional EBRPD por forma de vida](https://www.ebparks.org/sites/default/files/districtwidegrowthform_rptebrpdplantlist_2019.pdf),
  de 2019, con nombres científicos y comunes en inglés, además de variedades e identificaciones `sp.`.
  Todavía no hay un mapeo completo y verificado de taxones/nombres españoles ni licencia de reutilización
  confirmada para ese listado. No se creó un archivo vacío ni se presenta como catálogo terminado.
- **Programas de TV argentinos:** el [Martín Fierro de Oro](https://es.wikipedia.org/wiki/Premio_Mart%C3%ADn_Fierro_de_Oro)
  mezcla programas, personas, radio y TV, y año de producción/ceremonia. No se verificó una tabla cerrada
  de programas con participantes y períodos íntegros. No se habilita una consigna que acepte solo ejemplos.
- **Estudios/sagas de cine:** Pixar, Ghibli y Disney Animation dieron 88, 56 y 95 relaciones P272 en la
  exploración reproducible (`scripts/explorar-catalogos.mjs`); esas cifras mezclan formatos y no están
  certificadas contra listas completas de largos, cortos y telefilmes. Otras sagas exploradas tampoco
  pasaron el contraste. Solo Harry Potter (ocho películas) se publica como saga completa. No se usan
  filtros de letras sobre títulos cinematográficos.
- **Franquicias de TV adicionales:** Star Wars, Marvel y Dragon Ball quedan sin certificado de cantidad
  ni plantel importado. Las publicadas son las tres listas expresamente verificadas, no toda la TV.
- **Videojuegos:** BioShock no devolvió obras por las relaciones exploradas y se descartó; no se interpreta
  como «no existen juegos». Las sagas admitidas incluyen derivados, expansiones y reediciones; los
  proyectos con estreno futuro o sin fecha documentada quedan afuera.
- **Literatura:** no se habilita «todos los libros originalmente en español», ni todas las sagas literarias
  o Princesa de Asturias sin listas contrastadas. Las bibliografías son completas solo respecto del
  criterio estructurado declarado. Se excluyen partes declaradas de colecciones; la clasificación
  explícita como novela corta prevalece sobre un rótulo simultáneo de cuento. Las variantes de edición
  de Poirot investiga se unifican tras contraste, sin duplicar respuestas.
- **Nobel:** hay tres países actuales de nacimiento sin mapeo; no se habilita el filtro global por país.
  P27 está incompleto y se omite del esquema y de los atributos. Los años por disciplina están separados
  para no asociar el Nobel de Física de Curie con su año de Química.
- **Arte:** 42 obras carecen de año; el siglo global se rechaza. Las combinaciones autor/siglo solo salen
  si el año es completo en ese grupo. Hay tres autores, doce ubicaciones y dos técnicas desconocidas;
  no se rellenan. Ubicación incluye colección P195 y ubicación P276, con fecha de referencia en la consigna.
  El universo usa P31 directo: la consulta transitiva amplia no produjo una respuesta válida de WDQS.
- **Naturaleza:** hábitat y alimentación quedan `null`. Tres especies sin coincidencia taxonómica exacta
  no se importan; sus ids y motivos están registrados. Los camélidos tienen dos respuestas en este
  universo y no llegan al mínimo de cinco. No son todos los animales actuales.
- **CAA:** se publican doce tablas; coles, cucurbitáceas y la tabla incompleta de otras frutas se dejan
  afuera hasta poder leer todas sus filas. Castaña (Castanea) y nuez de Pará (Bertholletia) son distintas.
  No hay notoriedad oficial: popularidad 0 y desempate estable, sin inventar rareza factual.
- **Comidas:** 22 países de origen desconocidos; no se filtra por origen ni ingredientes incompletos.
  El universo cerrado tiene el criterio de tipo directo y umbral de notoriedad visible al jugador.
- **Música:** MusicBrainz `website-default` excluye grupos solo promocionales, bootlegs o pseudolanzamientos;
  los grupos admitidos pueden incluir ediciones regionales y reediciones. La cuenta no equivale a una
  discografía editorial del país de origen. Los siete álbumes de estudio de Soda están verificados.
  Se conservó el catálogo anterior de 67 discos con canciones. No se habilitan combinaciones con año
  sobre un grupo que tenga fechas desconocidas.
- **Gramática:** se conservan el diccionario es_AR, sus reglas de formas y la coincidencia exacta.
- **Geografía:** abundan las condiciones por letras; Normal y Geografía tienen historiales independientes.
- **Mantenimiento:** las fuentes cambian solo al reimportar; los datos guardan versión, fuente y correcciones.
  Los resultados de una semilla son evidencia reproducible, no una garantía para todo historial manual,
  cambio de datos o configuración. A partir de 60 días se permite reutilizar consignas.
