# Filón

Juego web diario de cultura general ambientado en un viaje por las capas de la Tierra. Cada día hay siete preguntas, iguales para todos. Cada una admite muchas respuestas correctas y el jugador escribe una sola: cuanto menos obvia es la respuesta, más puntos vale y más hondo cava Lito, el gusano explorador. Cada punto son 10 metros; el fondo está a 7.000.

| Rareza estimada | Puntos | Descenso |
| --- | --- | --- |
| Grava — muy conocida | 10 | 100 m |
| Cobre — común | 30 | 300 m |
| Plata — menos evidente | 60 | 600 m |
| Oro — poco conocida | 85 | 850 m |
| Diamante — excepcional | 100 | 1.000 m |

La rareza es una estimación editorial (de quien arma la pregunta), no un porcentaje de jugadores. Así se presenta en la interfaz.

## Modos de juego

Hay tres modos, con la misma mecánica (siete preguntas, 25 s, rarezas y puntos) y el mismo estilo visual. Se eligen con el botón de menú (☰) de la barra superior, que abre un selector con una miniatura, el nombre y el estado de hoy de cada uno (disponible, en curso, jugado o preparándose).

| Modo | Preguntas | Ambientación | Avance |
| --- | --- | --- | --- |
| **Normal** | una de cada categoría (geografía, historia, ciencia, deportes, cine, música, literatura) | Lito cava por las capas de la Tierra | 10 m por punto; el fondo está a 7.000 m |
| **Farándula Argentina** | siete de farándula y espectáculo argentinos (TV, cine, música, humor) | Lito baja de una limusina y camina por la alfombra roja; a medida que avanza aparecen más fans, carteles, paparazzi y flashes, hasta la entrada de la gala | 10 m de alfombra por punto |
| **Geografía** | siete de geografía | Lito pilotea un avión desde Aeroparque y da la vuelta al mundo: América del Sur, América del Norte, Europa, África, Asia, Oceanía y la Antártida, con sus monumentos y su cielo | 60 km por punto; la vuelta al mundo son 42.000 km |

- **Una partida por día en cada modo.** Cada modo tiene su propio desafío diario (`desafios` es único por `modo` y `fecha`), así que la restricción histórica «una partida por jugador y desafío» queda en una por jugador, modo y día. Jugar un modo no bloquea los otros. Cambia a las 00:00 de Buenos Aires, como siempre, y como vive en la base sobrevive a recargas y a cerrar el navegador (mientras se conserve la cookie).
- **Cada pregunta es de su modo.** Normal valida las siete categorías; Farándula solo acepta la categoría `farandula` y Geografía solo `geografia`. El historial, la detección de repeticiones y la numeración de desafíos son independientes por modo.
- El modo elegido viaja en la URL (`/?modo=farandula`, `/?modo=geografia`), así una recarga o un enlace compartido abren el mismo.
- Cada modo se publica desde su reserva (`datos/reserva.json`, `datos/reserva-farandula.json`, `datos/reserva-geografia.json` más lo guardado en la base) o con la carga manual del panel, usando el prompt de cada modo (`datos/prompt*.txt`) en otra IA. El programador completa mañana con la reserva recién en los últimos 30 minutos antes de medianoche, para dejar tiempo a la carga manual sin tener que reemplazar nada.

---

## Inicio rápido (sin credenciales)

Requisito: **Node.js 24** (la versión fijada en `engines`, la misma que usa Vercel y el CI).

```bash
npm install
npm start
# → http://localhost:3000
```

Al arrancar, el servidor publica el desafío de hoy de cada modo con los **bancos de reserva** (`datos/reserva.json`: 21 preguntas curadas de Normal, 3 por categoría, 239 respuestas con variantes, explicaciones y fuentes; `datos/reserva-farandula.json`: 9; `datos/reserva-geografia.json`: 13), así que se puede jugar de inmediato.

Para ver el banco del día: `npm run admin -- desafio AAAA-MM-DD [normal|farandula|geografia]`.

## Preguntas nuevas

Hay tres caminos, ninguno llama a una IA desde el juego:

- **Generador por catálogos** (Normal, sin IA): arma el día a partir de catálogos de datos reales y verificados (`datos/catalogos/`, 25 catálogos: países con fronteras, monedas e idiomas, capitales, provincias argentinas, elementos, constelaciones, sistema solar, Pokémon, elementos HTML, códigos HTTP, papas, presidentes de EE. UU., Mundiales, Champions, F1, Óscar, discos, Nobel, Cervantes y un diccionario rioplatense) y de plantillas declarativas (`datos/plantillas.json`). Se activa con `GENERADOR_NORMAL=catalogos`; `npm run generar -- --vista-previa` muestra qué armaría. Una consigna no se repite hasta pasados 60 días calendario (`CATALOGOS_DIAS_SIN_REPETIR`); `npm run capacidad-catalogos` y `npm run simular-calendario` miden cuántas hay y simulan meses de calendario en una base temporal. Todo el detalle (fuentes, licencias, cobertura, reglas, repeticiones y cómo sumar catálogos o plantillas) está en **[docs/GENERADOR.md](docs/GENERADOR.md)**.
- **Reserva**: el banco curado de cada modo (y lo que se guardó desde el panel).
- **Carga manual**: preguntas armadas con otra IA (ChatGPT, Claude…) usando el prompt de cada modo del panel (**Crear → Generar con otra IA**). Todo lo que se carga queda en la reserva para reutilizarse.

Las siete preguntas de Normal son generales: hasta dos de una misma categoría y al menos cuatro distintas (geografía, historia, ciencia, deportes, cine, música, literatura, **gramática**, informática, astronomía, videojuegos o idiomas; las cinco últimas, solo con el generador por catálogos).

## Stack y por qué

- **Node.js 24 con una sola dependencia de producción** (`@libsql/client`): `node:http` para el servidor local, `node:test` para las pruebas. Playwright y ESLint son solo de desarrollo. No tiene paso de compilación.
- **libSQL / SQLite**: en tu máquina, un archivo (`datos/filon.db`, modo WAL); en Vercel, una base **Turso** (mismo dialecto SQL). La restricción `UNIQUE(fecha)` garantiza que nunca haya dos desafíos para el mismo día, aunque corran dos procesos a la vez. Lo publicado (desafíos, preguntas, respuestas) se cachea en memoria porque no cambia.
- **Frontend sin framework**: HTML, CSS y módulos de JavaScript. La mina es un `<canvas>` procedural; la minera, un SVG animado con CSS. Tipografías incluidas (Big Shoulders Stencil y Atkinson Hyperlegible, licencia OFL) para no depender de servicios externos.

## Estructura

```
servidor/
  app.js                arma base, juego, API y publicación (lo comparten el servidor local y Vercel)
  index.js              servidor local: programador, API y estáticos
  config.js             variables de entorno (+ .env opcional)
  db.js                 esquema, cliente libSQL (archivo o Turso), transacciones y bloqueos
  tiempo.js             fechas en America/Argentina/Buenos_Aires
  normalizar.js         normalización de respuestas e índice de búsqueda
  validacion.js         validación estructural y de consistencia
  dominio.js            rarezas, categorías y modos de juego
  banco.js              publicación y lectura del banco congelado (por fecha y modo)
  revelado.js           orden, forma de búsqueda y conteos del revelado (se preparan al publicar)
  juego.js              partidas, rondas, tiempos, puntos y reportes
  api.js, http.js       rutas, cookies firmadas, límites y seguridad
  programador.js        tarea programada interna (solo servidor local)
  generador/            reserva y publicación diaria
api/index.js            función de Vercel: atiende /api/* (incluye /api/cron/*)
vercel.json             estáticos, reescrituras, cabeceras de seguridad y crons
scripts/                generar-desafio.js · validar-reserva.js · admin.js · medir-revelado.mjs
datos/                  reserva*.json (bancos de reserva por modo) · prompt-*.txt (prompts para otra IA por modo)
publico/                index.html · estilos.css · app.js · modos.js (textos y escena de cada modo) · sonido.js
                        normalizar-texto.js (normalización compartida con el servidor)
                        escena.js (la mina) · escena-viaje.js (motor pixel art de las escenas horizontales) · pixel.js
                        escena-farandula.js (alfombra roja) · escena-geografia.js (avión) · paisaje-geografia.js (vuelta al mundo)
pruebas/                pruebas automáticas y recorrido en navegador
despliegue/             systemd, cron (alternativa a Vercel)
```

## Publicación diaria

**Cuándo.** Con `PROGRAMADOR_INTERNO=1` (por defecto) el servidor revisa al iniciar, cada 10 minutos y 1,5 s después de cada medianoche de Buenos Aires. En cada revisión, para cada modo:

1. Si falta el desafío de **hoy**, lo publica en el acto con la reserva (nadie se queda sin jugar).
2. En los últimos 30 minutos antes de medianoche (`MINUTOS_RESERVA_ANTES_DE_MEDIANOCHE`), si todavía no se cargó a mano el de **mañana**, lo arma con la reserva.

Así, a las 00:00 el desafío nuevo ya está publicado y el cambio es instantáneo. Abrir la página o jugar **nunca** publica preguntas: si por algún motivo no hubiera desafío, la API responde «la mina se está preparando».

**Idempotencia.** Cada ejecución verifica primero si la fecha ya existe; toma un bloqueo con vencimiento en la base (`bloqueos`) para que dos procesos no publiquen a la vez; y publica las 7 preguntas en **una sola transacción**. Si otra ejecución ganó la carrera, la publicación se descarta sin reemplazar nada. Los desafíos anteriores se conservan.

**Cómo** (`servidor/generador/generar.js`): en Normal se ordenan las 7 categorías de forma reproducible según la fecha; en los temáticos son siete ranuras de su categoría. Para cada una se elige de la reserva una pregunta que no se haya usado en los últimos 60 días (`DIAS_SIN_REPETIR`), priorizando la que hace más tiempo que no sale (si todas se usaron hace poco, se repite la menos reciente y queda un aviso); se valida el lote (sin solapamientos) y se publica. Todo queda en `corridas.detalle` para auditoría.

**Reserva.** `datos/reserva.json` (y `reserva-farandula.json`, `reserva-geografia.json`) es el banco curado de archivo. A ese banco de archivo se suma la tabla `reserva` de la base: **cada pregunta que se publica (cargada a mano o editada) queda guardada ahí** para reutilizarse, y desde el panel (pestaña **Reserva**) se pueden agregar, editar y desactivar preguntas de cualquiera de las dos fuentes (una fila con el mismo id que una pregunta del archivo la reemplaza). En Vercel los archivos de `datos/` son de solo lectura: lo editable vive en la base. También se globalizó: ya no contiene preguntas centradas en provincias, presidentes o clubes argentinos. Se valida en modo estricto al iniciar y con `npm run validar-reserva`.

**Tarea externa (opcional).** Si preferís cron o systemd, poné `PROGRAMADOR_INTERNO=0` y usá `scripts/generar-desafio.js` (ver `despliegue/crontab.ejemplo` y los `.timer`). Ambas variantes pueden convivir sin riesgo gracias al bloqueo y a la idempotencia.

```bash
npm run generar                         # hoy
npm run generar -- --manana             # mañana
npm run generar -- --modo farandula      # un solo modo (por defecto, los tres)
```

## Partida

- **Identidad anónima**: cookie `HttpOnly`, `SameSite=Lax`, firmada con HMAC y válida 400 días. Sin registro. Una partida por identificador y desafío (restricción `UNIQUE` en la base); como cada modo tiene su desafío, son una por identificador, modo y día.
- **Tiempo validado en el servidor**: al empezar una ronda se guarda el inicio y el límite (25 s). Una respuesta que llega después del límite más 1,5 s de margen de red no cuenta y la ronda se cierra con 0 puntos. El navegador solo muestra la mecha.
- **Recarga**: el estado vive en el servidor. Recargar vuelve a la misma ronda con el tiempo restante real; pedir de nuevo una ronda ya empezada no reinicia el reloj; no se puede saltar ni volver a una ronda.
- **Medianoche**: la partida queda atada a su desafío. Si empezaste a las 23:58, terminás con esas preguntas aunque ya sea el día siguiente (tenés hasta 12 h después del fin del día; luego las rondas sin jugar caducan). El desafío nuevo es otra partida.
- **Validación de respuestas** contra el banco almacenado. La respuesta y el banco de una ronda nunca se envían al navegador hasta que la ronda termina.
- **Reportes**: después de cada ronda (no mientras está en juego) se puede reportar una respuesta válida que falte. Se revisan en el panel (`/admin` → Reportes) o con `npm run admin -- reportes`. Las puntuaciones del día no cambian.
- **Concurrencia**: el tope de intentos por ronda, el cierre de la ronda y la suma de puntos se deciden en una misma transacción; dos envíos simultáneos (doble clic, dos pestañas, dos instancias) no superan el máximo ni puntúan dos veces.
- **Límites**: una partida por identificador anónimo (una cookie). Sin cuentas, borrar las cookies o usar otro navegador permite volver a jugar; el ranking cuenta lo que llega.

### Normalización

Se ignoran mayúsculas, espacios repetidos, tildes, diéresis y signos de puntuación; **la ñ se conserva** («año» ≠ «ano»). Al buscar se prueba además la forma sin espacios («J.R.R.» = «JRR») y se quita un artículo que el jugador haya agregado («la Argentina»).

**Tolerancia: nunca se acepta algo distinto sin que el jugador lo confirme.**
- Si lo escrito es exactamente el nombre canónico (con la normalización de arriba), se acepta.
- Si coincide con una **variante** registrada (nombre alternativo, título original, abreviatura) o con una forma sin artículo, el juego responde «¿Quisiste decir «X»?» con el nombre canónico; al confirmar con Enter se acepta y vale los mismos puntos.
- También **sugiere** por apellidos o palabras completas (desde 4 caracteres), palabras en otro orden u omitidas, y subcadenas (desde 5 caracteres): «Márquez», «Márquez Gabriel» o «garciamarq» completan «Gabriel García Márquez» sin necesitar una variante registrada. Si el fragmento corresponde a varias respuestas, no elige ninguna. Los conectores y números solos no alcanzan.
- Corrige errores de tipeo tanto en nombres completos como en fragmentos: «tolkein» completa «J. R. R. Tolkien». Exige al menos 5 caracteres y tolera una distancia de edición de hasta el 20 % del largo, con un máximo de 3; si hay dos candidatas igual de cercanas, no sugiere nada. Las formas exactas y variantes registradas tienen prioridad. Así «Austria» nunca se convierte sola en «Australia».
- El autocompletado ocurre al enviar. La sugerencia conserva la ronda abierta y no consume un intento; hace falta otro Enter para confirmar y recibir los puntos. Los rechazos explícitos conservan su explicación.

Al terminar la partida, cada fila del resumen final abre **todas las respuestas válidas** de esa pregunta (ordenadas de mayor a menor puntaje). Apenas aparece el final, la página pide en segundo plano, en un solo pedido, las primeras 100 respuestas de las siete preguntas (casi siempre son todas): abrir, cerrar o cambiar de pregunta no vuelve a pedir nada, y si se abre antes de que lleguen se muestra la carga (y, si falla, «Reintentar»). Con más de 100, el detalle se recorre por páginas de 100 (nunca hay más filas montadas) y el buscador y el filtro por rareza trabajan en el servidor sobre el conjunto completo; con menos, filtran al instante en el navegador con las mismas reglas de normalización (`publico/normalizar-texto.js`, compartido con el servidor). El orden del revelado, la forma de búsqueda y los conteos por rareza se calculan al publicar (`servidor/revelado.js`), no en cada lectura. Durante el juego no se revelan: el servidor las entrega solo para rondas ya cerradas, y el resumen del final solo con la partida terminada. Para medir este recorrido: `node --expose-gc scripts/medir-revelado.mjs [--sintetico 12000] [--latencia 10] [--navegador]`.

## Pantallas

- **Selector de modos** (botón ☰): miniatura y nombre de cada modo, con su estado de hoy. Durante una ronda no se puede cambiar de modo (la mecha sigue corriendo).
- **Inicio**: nombre, modo actual, explicación breve, rarezas, el botón para empezar («Comenzar excavación», «Bajar de la limusina» o «Despegar») y cuenta regresiva al próximo desafío. Si hay una partida en curso, «Seguir…»; si quedó una del día anterior en ese modo, la opción de terminarla.
- **Partida**: en celulares, al abrirse el teclado la ronda se acomoda a la parte visible de la pantalla (pregunta compacta arriba, campo de respuesta debajo), sin tener que scrollear. Pregunta, alcance, mecha de 25 s, campo de respuesta, intentos rechazados, progreso de las 7 rondas, puntos y profundidad.
- **Resultado de ronda**: rareza, puntos, metros, respuesta aceptada, explicación, fuente, «otra joya de esta veta» y reporte de faltantes, con la animación de excavación y descenso.
- **Resultado final**: profundidad total, estrato alcanzado, desglose por pregunta y «Compartir resultado» (un resumen con emojis por rareza, sin respuestas).
- **Partida completada**: al volver el mismo día, el resultado guardado y el tiempo hasta el próximo desafío.

En Normal, la escena vertical cambia con la profundidad: una superficie verde y luminosa; tierra con raíces, arenisca con fósiles, pizarra laminada, granito moteado, basalto con grietas de magma y la cámara de cristales a partir de 6.000 m. Lito abre progresivamente un túnel orgánico por el centro del corte geológico: solo aparece detrás del gusano y termina en el frente de excavación de la profundidad alcanzada. El gusano tiene silueta anatómica, clitelo, segmentos y textura húmeda, y cada hallazgo dispara partículas del color de su rareza. En Farándula y Geografía la escena es horizontal y en pixel art (`escena-viaje.js`): el avance mueve el mundo alrededor de Filón. Cada cuadro se dibuja en dos lienzos de baja resolución que se agrandan sin suavizado: el fondo (cielo, nubes, sierras, ciudad, reflectores) con pixeles más grandes y desenfocados, y el frente (suelo, mar, alfombra, público, limusina, avión) nítido, con bordes duros y tramas de pixeles para lo translúcido. Filón se pixela a partir del mismo SVG del juego, con contorno oscuro y su vestuario: anteojos y moño en la alfombra roja; gorro de piloto, antiparras y bufanda en la cabina del avión rojo y blanco. Los carteles usan una tipografía pixel de 3×5 (`pixel.js`). La barra de progreso muestra las etapas de cada modo (de «Llegada» a «Entrada de la gala»; de Aeroparque a la Antártida). Los sonidos se sintetizan con Web Audio y se silencian con un botón; el control de movimiento reducido (que respeta la preferencia del sistema) elimina animaciones, partículas y descensos.

## Pruebas y verificaciones

```bash
npm ci                          # dependencias exactas (también instala Playwright y ESLint)
npx playwright install chromium # una vez: el navegador de las pruebas E2E
npm run verificar               # todo lo que corre el CI, en el mismo orden
```

| Comando | Qué hace |
| --- | --- |
| `npm run lint` | ESLint sobre servidor, navegador, scripts y pruebas |
| `npm run chequear` | `node --check` de cada archivo y verificación de imports relativos |
| `npm test` | 129 pruebas unitarias y de integración (`node:test`) |
| `npm run test:cobertura` | las mismas, con umbrales de cobertura (líneas 85 %, funciones 85 %, ramas 70 %) |
| `npm run validar-reserva` | los tres bancos: Normal (21, 3 por categoría), Farándula (9) y Geografía (13), cada temático con al menos 7 |
| `npm run test:navegador` | 24 pruebas E2E en Chromium con Playwright (levantan su propio servidor con una base temporal) |
| `npm run test:recorrido` | recorrido histórico en navegador (19 comprobaciones, guarda capturas en `capturas/`) |
| `npm run explicar-consultas` | `EXPLAIN QUERY PLAN` de las consultas principales |
| `npm run importar-catalogos` | importa y verifica los catálogos del generador (usa la red; ver docs/GENERADOR.md) |
| `npm run capacidad-catalogos` | consignas distintas utilizables por categoría, familia y plantilla (sin red) |
| `npm run simular-calendario` | simula 180 días de Normal con el generador en una base temporal (sin red, no toca producción) |

Cubren, entre otras cosas: normalización y sugerencias; validación y reserva; publicación (idempotencia, ejecuciones simultáneas, reserva sin repeticiones, bloqueo global, ventana previa a medianoche); partida (tiempos, recarga, medianoche, caducidad, doble envío y tope de intentos con dos instancias en hilos separados); sesiones del panel (login, revocación, inactividad, vida máxima, límite de intentos, origen, `__Host-`); rate limiting compartido entre instancias; migraciones (base nueva, base heredada con datos, arranque simultáneo); volumen (3.000 partidas, preguntas de 1.500 respuestas), revelado exacto con más de 10.000 respuestas sintéticas (páginas, búsqueda, rareza, en frío y con caché) y la limpieza diaria. El E2E prueba carga inicial, partida completa, doble envío, recarga, revelado final (precarga única, carga en curso, error y reintento, páginas de 100 con filtros y respuestas tardías descartadas), móvil y teclado, panel sin autenticación, login/logout, importación JSON válida e inválida y la navegación por teclado de las pestañas.

## Decisiones tomadas

- **Respuesta vacía**: enviar el campo vacío no consume nada (se muestra un aviso). Una ronda termina con 0 puntos si vence la mecha o si el jugador toca «Pasar esta pregunta».
- **Margen de red** de 1,5 s después del límite para respuestas enviadas a tiempo pero que llegaron tarde.
- **Entre rondas** el reloj no corre: la ronda siguiente empieza cuando el jugador toca «Seguir bajando». La pregunta no se revela antes.
- **Categorías**: cada día tiene exactamente una pregunta de cada una de las 7 categorías, en un orden que depende de la fecha.
- **Después de cada ronda** se muestra una «joya» (la respuesta más valiosa que no dio el jugador) y cuántas respuestas tenía la veta. Compartir no revela respuestas.
- **Número de desafío**: días transcurridos desde el primer desafío publicado.
- **Una partida diaria por identificador**: sin registro no se puede impedir que alguien borre las cookies y juegue de nuevo; el resultado del primer identificador queda guardado.
- **Rechazos frecuentes**: cada pregunta puede traer errores comunes con su motivo («Plutón: desde 2006 es planeta enano»), que se muestran al rechazarlos.
- **Límites**: 40 intentos por ronda, 15 reportes por partida, ~8 solicitudes por segundo por IP.

## Variables de entorno

Todas son opcionales; están documentadas en `.env.example`. Las principales:

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `BD_URL`, `BD_TOKEN` | — | Base principal (prioridad sobre `TURSO_*`) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | — | Base Turso (en Vercel las inyecta la integración) |
| `PUERTO`, `HOST`, `RUTA_BD` | `3000`, `0.0.0.0`, `datos/filon.db` | Servidor local y base en archivo |
| `ZONA_HORARIA` | `America/Argentina/Buenos_Aires` | Cambio de desafío a las 00:00 |
| `SEGUNDOS_POR_PREGUNTA` | `25` | Duración de la mecha |
| `PROGRAMADOR_INTERNO` | `1` (`0` en Vercel) | `0` para usar cron/systemd/Vercel Cron |
| `MINUTOS_RESERVA_ANTES_DE_MEDIANOCHE` | `30` | Desde cuándo se prepara mañana con la reserva |
| `DOMINIOS_FUENTES` | lista por defecto | Dominios aceptados como fuente de las preguntas |
| `COOKIE_SEGURA`, `CONFIAR_PROXY` | `0` (`1` en Vercel) | Producción detrás de HTTPS / proxy |
| `TOKEN_ADMIN` | — | Habilita el panel (solo se usa para iniciar sesión) |
| `ADMIN_INACTIVIDAD_MIN`, `ADMIN_VIDA_HORAS` | `30`, `8` | Vencimiento de la sesión del panel |
| `ADMIN_PERMITIR_BEARER` | `1` | Transición: acepta `Authorization: Bearer TOKEN_ADMIN` en scripts; poné `0` para exigir sesión |
| `RETENER_*` | ver `.env.example` | Retención de datos (ver docs/OPERACIONES.md) |
| `CRON_SECRET` | — | Protege `/api/cron/*` (Vercel Cron lo envía solo) |
| `RELOJ_DESFASE_MS` | `0` | Probar la medianoche sin esperar |

## Despliegue

### Vercel (recomendado)

Todo corre en Vercel: `publico/` lo sirve la CDN, `/api/*` es una función (`api/index.js`) y la tarea diaria la disparan los crons de `vercel.json`. La base es Turso, conectada desde el Marketplace de Vercel.

1. `vercel link` (o importá el repositorio en vercel.com/new). No hace falta configurar framework ni comando de build.
2. En el proyecto: **Storage → Create Database → Turso**, conectada a Production (y Preview si querés). Eso agrega `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. Elegí la región de Turso cercana a la de las funciones (por defecto Vercel usa `iad1`, Washington → AWS `us-east-1`).
   **Importante:** la integración puede crear una rama de la base por despliegue (el host empieza con `dpl-…`), que arranca vacía en cada deploy. Para Production cargá `BD_URL` y `BD_TOKEN` con la URL y el token de la base principal: tienen prioridad sobre las `TURSO_*`. El panel `/admin` muestra qué base está usando.
3. **Settings → Environment Variables → Import .env** con el `.env` del proyecto (secretos ya generados).
4. `vercel --prod`. El esquema de la base se crea solo en la primera solicitud.
5. Publicá el primer desafío sin esperar al cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<tu-dominio>/api/cron/hoy`.

Crons (hora UTC; Buenos Aires es UTC−3 todo el año). Los dos recorren los tres modos. Funcionan también en el plan Hobby, que dispara cada cron una vez por día con precisión de una hora:

| Ruta | UTC | Buenos Aires | Qué hace |
| --- | --- | --- | --- |
| `/api/cron/manana` | 01:30 | 22:30 | Si no se cargó a mano, arma mañana con la reserva |
| `/api/cron/hoy` | 03:05 | 00:05 | Red de seguridad: asegura el desafío de hoy |

La función tiene `maxDuration: 60` s. El límite de solicitudes por IP es por instancia de la función, así que en Vercel es orientativo.

### Administración

Panel web en **`/admin`**. Se ingresa una vez con el `TOKEN_ADMIN`: el servidor lo compara en tiempo constante y abre una **sesión** (token aleatorio en una cookie `HttpOnly`, `SameSite=Strict`, `__Host-` con HTTPS; en la base solo se guarda su hash). La sesión vence a los 30 minutos sin actividad y, como máximo, a las 8 horas; «Salir» la revoca en el servidor. El token maestro **no** se guarda en el navegador. El login tiene un límite de 5 intentos cada 15 minutos.

El panel abre en un **resumen** con estadísticas (con un selector de modo): jugadores y finalización por día, la campana de profundidad del día con su ajuste normal, promedio/mediana/cuartiles y, por pregunta, cuántos acertaron, pasaron o se quedaron sin tiempo, qué rarezas encontraron y los intentos fallidos más repetidos (pistas de respuestas que faltan). Además: desafíos (filtrados por modo, con **«Editar pregunta»** en cada una), creación (reserva o JSON), **reserva**, corridas y reportes. El editor de preguntas es un formulario (enunciado, alcance, fuentes, tabla de respuestas con variantes, rareza y explicación, y rechazos) que también se puede editar como JSON; valida igual que la carga manual. Al editar una pregunta ya publicada, las respuestas que siguen conservan su id (las partidas jugadas mantienen sus puntos), no se puede quitar una respuesta que algún jugador ya dio ni cambiar la categoría, y la versión editada se guarda también en la reserva. **Crear** tiene tres pestañas, **Normal**, **Farándula Argentina** y **Geografía**, cada una con las mismas herramientas y su propio estado: publicar desde la reserva, carga manual con «Solo validar», el prompt del modo y su historial. En **Crear → Generar con otra IA** está el prompt para usar con ChatGPT, Claude u otra IA (editable, y con «Copiar con historial» que completa el historial con toda la reserva del modo —lo publicado, lo cargado y lo editado— para que no repita ninguna pregunta) y la descarga en **JSON o CSV** de las preguntas de los últimos N días (por defecto 3, incluidos los ya programados): `GET /api/admin/historial?dias=3&formato=json|csv`. Las pestañas siguen el patrón ARIA (flechas, Inicio y Fin).

La misma API, desde scripts, con `Authorization: Bearer $TOKEN_ADMIN` mientras `ADMIN_PERMITIR_BEARER=1` (transición). Todas las rutas de desafíos, el historial, el prompt y las estadísticas aceptan `?modo=normal|farandula|geografia` (sin el parámetro, Normal); un modo desconocido responde `400 modo_invalido`. En el juego, `GET /api/estado?modo=…` devuelve además `modos` (el estado de hoy de los tres) y `POST /api/partidas` recibe `{"modo": "…"}`.

| Ruta | Qué hace |
| --- | --- |
| `GET /api/admin/estadisticas?fecha=…&desde=…&hasta=…` | Totales, serie diaria de jugadores y detalle del día (distribución de profundidad, resultados por pregunta e intentos fallidos frecuentes) |
| `GET /api/admin/desafios` | Desafíos publicados, con cantidad de partidas |
| `GET /api/admin/desafios/AAAA-MM-DD` | Banco completo de un día |
| `POST /api/admin/desafios/AAAA-MM-DD/generar` | Publica o rearma un día con la reserva (ver abajo) |
| `POST /api/admin/desafios/AAAA-MM-DD/importar` | Valida y publica siete preguntas desde JSON |
| `GET /api/admin/corridas` | Últimas corridas con su detalle |
| `GET /api/admin/desafios/AAAA-MM-DD/preguntas/N` · `POST` | Una pregunta publicada en formato de reserva; `POST {"pregunta": …, "soloValidar": bool}` la reemplaza (409 `respuesta_en_uso` si se quita una respuesta ya dada) |
| `GET /api/admin/reserva` · `POST` | Reserva del modo (archivo + base, con origen, estado y usos); `POST {"pregunta": …}` agrega o edita (sin id, se asigna uno) |
| `POST /api/admin/reserva/estado` | `{"id": …, "activa": bool}`: saca de circulación o vuelve a usar una pregunta |
| `GET /api/admin/historial?fuente=reserva` | Toda la reserva del modo (archivo + base) con la última fecha de uso de cada pregunta; es lo que usa «Copiar con historial» |
| `GET /api/admin/reportes` · `POST /api/admin/reportes/:id` | Reportes y cambio de estado (`{"estado":"aceptado"}`) |

`POST …/generar?modo=…` recibe `{"reemplazar": bool, "forzar": bool}` y arma el día con la reserva del modo:
- Para rearmar un día que ya existe hace falta `reemplazar: true`. El anterior se borra recién cuando el nuevo se publicó bien, y las preguntas reemplazadas no se repiten.
- Si ese día ya tiene partidas, responde `409 hay_partidas`; con `forzar: true` se borran junto con el desafío anterior.

**Carga manual (JSON) y repeticiones.** Además de las reglas de formato, cada pregunta se compara con las publicadas en los últimos días (por defecto 3, `SIMILITUD_DIAS`, o los «Días de historial» del panel; incluye los días ya programados) y con las otras del mismo JSON. Se comparan las raíces de las palabras del enunciado («termina»/«termine», «país»/«países») y las respuestas en común:
- **repetida** (no se publica): enunciado muy parecido (≥ 60 %), o el mismo conjunto (≥ 60 % de las respuestas y al menos 4), o enunciado parecido (≥ 45 %) con la mitad de las respuestas en común (al menos 3);
- **parecida** (se publica con aviso): enunciado algo parecido (≥ 35 %) o 3 respuestas en común o ≥ 30 % del conjunto.
El aviso dice con qué pregunta y fecha, el porcentaje y qué respuestas comparten. «Solo validar» hace todo el control sin publicar. Sigue vigente el control de 60 días (`DIAS_SIN_REPETIR`) para repeticiones evidentes.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN_ADMIN" -H 'content-type: application/json' \
  -d '{"reemplazar":true}' https://<tu-dominio>/api/admin/desafios/2026-10-07/generar
```

`POST …/importar?modo=…` recibe `{"preguntas":[…], "reemplazar":false, "forzar":false}`. Las preguntas usan exactamente el formato de `datos/reserva.json`. En Normal la API exige siete categorías distintas; en los temáticos, siete preguntas de la categoría del modo (si una no trae `categoria`, toma la del modo). En todos, valida fuentes, respuestas, variantes, rarezas y repeticiones, y guarda todo en una única transacción. Un error devuelve el detalle y no escribe nada. El cuerpo puede medir hasta 1 MB.

Para copiar a la reserva de la base las preguntas que ya estaban publicadas (antes de que existiera): `npm run admin -- copiar-reserva [modo] [--seco]`. Es idempotente: no duplica lo del archivo ni lo ya copiado, y vincula cada día a su pregunta de reserva para contar los usos.

Para administrar la base de producción desde tu máquina: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run admin -- corridas` (o `GET /api/admin/*` con `TOKEN_ADMIN`).

### Operación: CI, migraciones, backups y rollback

Todo el procedimiento está en **[docs/OPERACIONES.md](docs/OPERACIONES.md)**: la regla de que producción solo promueve commits con CI verde (y cómo configurarlo en GitHub y Vercel), las migraciones versionadas y su compatibilidad durante un deploy, backup y restore de Turso (con RPO/RTO; la prueba de restore está **pendiente**), rollback de código, logs estructurados y alertas, retención de datos y la configuración recomendada del Vercel Firewall.

### Otras opciones

- **Servidor propio**: copiá el proyecto a `/opt/filon`, creá `.env` y usá `despliegue/filon.service`. Poné un proxy HTTPS delante (Caddy o nginx) con `COOKIE_SEGURA=1` y `CONFIAR_PROXY=1`.
- **Docker**: `docker build -t filon . && docker run -p 3000:3000 -v filon-datos:/datos --env-file .env filon`.
- Respaldá `datos/filon.db` (contiene todos los desafíos, partidas y reportes). En Turso, los respaldos son automáticos.

## Próximos pasos posibles

- Edición puntual desde el panel para sumar variantes a preguntas ya publicadas.
- Estadísticas reales de respuestas por desafío (complementarias a la rareza estimada, sin cambiar los puntos del día).
- Ampliar la reserva para cubrir más días sin repetir.

## Capturas

![Inicio en escritorio](docs/inicio.png)
![Resultado de una ronda](docs/ronda-resultado.png)
![Resultado final](docs/final.png)
![Recorrido en celular](docs/celular.png)
