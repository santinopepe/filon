# Filón · Operaciones

Runbook de producción: despliegue, migraciones, backups, restore, rollback, observabilidad, retención
y protección contra abuso. Infraestructura: **Vercel** (estáticos + una función Node en `api/index.js`
+ Vercel Cron) y **Turso/libSQL** (base principal fijada con `BD_URL`/`BD_TOKEN`).

| Rol | Responsable |
| --- | --- |
| Dueño del servicio, despliegues y backups | Cuenta `santinopepe` (owner del proyecto en Vercel, del repo en GitHub y de la base en Turso) |
| Suplente | _a definir_ — nadie más tiene hoy acceso a Vercel/Turso |

---

## 1. Despliegue

### Regla

**Producción solo promueve commits con CI verde.** El workflow `.github/workflows/ci.yml` (job
`verificar`) ejecuta, en este orden: `npm ci` · lint · chequeo estático · pruebas · cobertura con
umbrales · validación de la reserva · `npm audit --omit=dev --audit-level=moderate` · E2E en Chromium.

### Hoy Vercel despliega solo cada push a `main` — configurar el bloqueo (pasos manuales)

La integración de Git de Vercel publica cualquier push a `main` en producción **sin esperar a GitHub
Actions**. Para que eso no ocurra hay que hacer **las dos cosas**:

1. **GitHub → protección de rama** (Settings → Branches → Add rule → `main`):
   - *Require a pull request before merging*.
   - *Require status checks to pass before merging* → agregar el check **`verificar`** (aparece después
     de la primera corrida del workflow) y *Require branches to be up to date*.
   - *Do not allow bypassing the above settings* (incluye administradores).
   Así nada llega a `main` sin CI verde.
2. **Vercel → no promover sin checks** (proyecto `filon`):
   - Settings → **Deployment Checks** (o *Git → Deployment Checks*, según la versión del panel) →
     *Add Checks* → elegir el workflow **CI / verificar** de GitHub. Con esto Vercel construye el deploy
     pero **no le asigna el dominio de producción** hasta que el check pasa.
   - Si la cuenta no ofrece *Deployment Checks*: alternativa equivalente — en `vercel.json` agregar
     `"git": { "deploymentEnabled": { "main": false } }` y desplegar desde un job de GitHub Actions
     posterior a `verificar` con `vercel deploy --prod` (requiere el secreto `VERCEL_TOKEN` en GitHub).
     No se aplicó en este cambio porque modifica cómo se publica producción: decidirlo explícitamente.

### Checklist de un despliegue

1. PR con CI verde → merge a `main`.
2. Vercel construye; con *Deployment Checks* promueve solo tras `verificar` verde.
3. Al arrancar, cada instancia aplica las migraciones pendientes (ver §2) y registra un log
   `{"evento":"migracion",…}` por cada una.
4. Verificar: `GET /api/salud` → `{"ok":true,…}`; panel `/admin` → muestra la base `database-…`
   (no un host `dpl-…`, que sería una rama vacía por despliegue).
5. Revisar en Vercel → Logs que no haya eventos `error_5xx` ni `migracion_fallida`.

### Configuración que no vive en el código (Vercel → Settings → Environment Variables, Production)

| Variable | Obligatoria | Nota |
| --- | --- | --- |
| `BD_URL`, `BD_TOKEN` | sí | base principal de Turso (prioridad sobre `TURSO_*`) |
| `SECRETO_SESION` | sí | firma cookies y es la sal del hash de IPs; rotarlo cierra todas las sesiones de jugadores |
| `TOKEN_ADMIN` | para el panel | solo se usa para iniciar sesión |
| `CRON_SECRET` | sí | Vercel Cron lo envía a `/api/cron/*` |
| `ADMIN_PERMITIR_BEARER` | no (1) | poner `0` cuando ya nadie use `Authorization: Bearer TOKEN_ADMIN` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | no | sin clave, todo funciona con la reserva |

---

## 2. Migraciones

`servidor/db.js` → `MIGRACIONES`. Tabla de control: `migraciones(version, nombre, aplicada_en)`.

| Versión | Nombre | Qué hace | Compatible con el código anterior |
| --- | --- | --- | --- |
| 1 | `esquema_inicial` | esquema histórico (`CREATE … IF NOT EXISTS`); en una base existente no cambia nada | sí |
| 2 | `sesiones_admin` | tabla `admin_sesiones` + índice por vencimiento | sí (tabla nueva) |
| 3 | `limites_distribuidos` | tabla `limites` + índice por vencimiento | sí (tabla nueva) |
| 4 | `puntajes_agregados` | tabla `puntajes_desafio` y la llena desde `partidas` | sí (tabla nueva) |
| 5 | `indices_consultas` | 6 índices nuevos (ver §8) | sí (solo índices) |
| 6 | `uso_ia_en_corridas` | columnas `llamadas_ia`, `tokens_*`, `costo_estimado_usd` en `corridas` (con valores por defecto) + índice | sí (`ADD COLUMN` con default) |
| 7 | `modos_de_juego` | `desafios` pasa de `UNIQUE(fecha)` a `UNIQUE(modo, fecha)` con la columna `modo` (default `'normal'`); índice `desafios_fecha`; columna `modo` en `corridas` | sí, con una salvedad (ver abajo) |
| 8 | `reserva_en_la_base` | tabla `reserva` (preguntas de reserva guardadas y editadas desde el panel) + índice por modo | sí (tabla nueva) |

**Reglas:** solo cambios aditivos; nunca se edita una migración publicada; cada una es idempotente y
corre en una transacción (si dos instancias arrancan a la vez, la segunda ve la versión registrada).

**Excepción: la 7 reconstruye `desafios`.** SQLite no permite quitar un `UNIQUE` con `ALTER TABLE`, y
los modos de juego (Normal, Farándula Argentina, Geografía) necesitan un desafío por fecha *y* modo.
La migración copia la tabla, la borra, la recrea con las mismas columnas más `modo` y reinserta las
filas con sus mismos `id`, todo en una transacción. Como libSQL tiene las claves foráneas activas, usa
`PRAGMA defer_foreign_keys = ON`: las filas de `preguntas`/`partidas` que apuntan a `desafios` quedan
válidas al reinsertar los mismos `id` antes del `COMMIT`; si algo no cierra, se revierte todo. Las
pruebas (`pruebas/migraciones.test.js`) verifican columnas, filas, `foreign_key_check` y que las
claves foráneas sigan activas. Se probó con bases locales; **antes de desplegar en producción,
hacé un backup de Turso (§3)** y revisá el log `migracion` de la versión 7.

Durante la convivencia de instancias: el código anterior lee las mismas columnas e inserta sin `modo`
(queda en `normal`). Su `SELECT … WHERE fecha = ?` puede encontrar también los desafíos temáticos de esa
fecha; el índice `desafios_fecha` los devuelve en orden de inserción y el programador y los crons
publican siempre Normal primero, así que en la práctica sigue viendo el Normal. Conviene que el
despliegue no coincida con la publicación del día (00:00–00:10 de Buenos Aires).

**Orden de despliegue:** no requiere pasos previos (salvo el backup recomendado para la 7). El primer
arranque del código nuevo aplica las pendientes.
Mientras conviven instancias viejas y nuevas: las viejas ignoran las tablas nuevas; las partidas que
terminen en una instancia vieja no suman al histograma `puntajes_desafio`, y la limpieza diaria lo
concilia para los últimos días (`conciliarPuntajes`).

**Rollback de migraciones:** no hay migraciones «hacia abajo» porque todas son aditivas: volver al
código anterior deja tablas/columnas sin usar, que no molestan. Si alguna vez hiciera falta quitarlas,
hacerlo a mano después de un backup y solo cuando ninguna versión desplegada las use:

```sql
-- SOLO tras backup y con el código nuevo fuera de servicio:
DROP TABLE IF EXISTS admin_sesiones; DROP TABLE IF EXISTS limites; DROP TABLE IF EXISTS puntajes_desafio;
DELETE FROM migraciones WHERE version >= 2;
-- Las columnas de corridas pueden quedarse (SQLite antiguo no permite DROP COLUMN sin reconstruir).
```

---

## 3. Backup y restore (Turso)

| Parámetro | Valor objetivo |
| --- | --- |
| Frecuencia | Continua (point-in-time de Turso) + volcado lógico semanal y antes de cada migración manual |
| Retención | La del plan de Turso para PITR; volcados lógicos: 12 semanas |
| RPO | ≤ 24 h con volcados diarios; minutos si el plan incluye PITR |
| RTO | ≤ 1 h (crear base restaurada + apuntar `BD_URL`/`BD_TOKEN` + redeploy) |

### Backup lógico (volcado SQL)

```bash
# Requiere la CLI de Turso autenticada en la cuenta dueña de la base.
turso db shell database-indigo-magnet-vercel-icfg-kfuajneijmckdj07qllf18tl .dump > backup-$(date +%F).sql
gzip backup-$(date +%F).sql   # guardarlo fuera de Turso (almacenamiento cifrado con acceso restringido)
```

### Restore en un entorno aislado (nunca sobre producción)

```bash
# 1) Base nueva a partir del volcado:
turso db create filon-restore-prueba
gunzip -c backup-AAAA-MM-DD.sql.gz | turso db shell filon-restore-prueba
#    …o, con PITR, a un instante dado:
turso db create filon-restore-prueba --from-db <base-principal> --timestamp 2026-10-06T03:00:00Z
# 2) Credenciales de la base restaurada:
turso db show filon-restore-prueba --url
turso db tokens create filon-restore-prueba
# 3) Validar con el código actual SIN tocar producción:
BD_URL=libsql://… BD_TOKEN=… npm run admin -- desafios
BD_URL=libsql://… BD_TOKEN=… npm run admin -- corridas 5
BD_URL=libsql://… BD_TOKEN=… node scripts/explicar-consultas.js
```

**Validaciones posteriores:** `SELECT MAX(version) FROM migraciones` = última versión; cantidad de
`desafios`, `partidas`, `jugadores` comparable con producción; el desafío de hoy existe; el panel
apuntado a la base restaurada (en un deploy de Preview con esas variables) muestra estadísticas.

**Para restaurar producción de verdad:** apuntar `BD_URL`/`BD_TOKEN` de Production a la base restaurada
y redeploy (o restaurar sobre la base principal con las herramientas de Turso). Anunciarlo antes.

> **Estado: PENDIENTE DE PRUEBA.** El procedimiento no se ejecutó en esta revisión: requiere la CLI de
> Turso autenticada en la cuenta dueña y crear bases nuevas, que no estaba autorizado. No hay evidencia
> todavía de que el restore funcione; hacer la prueba completa antes de considerarlo confiable y
> registrar fecha, duración real (RTO medido) y resultado de las validaciones.

---

## 4. Rollback de código

1. **Vercel → Deployments → deploy anterior sano → Promote** (o `vercel promote <url> --scope …`).
   Es inmediato y no toca la base.
2. Después de un *promote/rollback* manual, Vercel **deja de asignar** el dominio a los deploys
   nuevos de `main` hasta que se vuelva a promover uno: tenerlo en cuenta para no «perder» deploys.
3. Compatibilidad: como las migraciones son aditivas, el código anterior funciona sobre el esquema
   nuevo. Volver a un código **anterior a este cambio** implica: el panel vuelve a pedir el token en
   cada visita (se guardaba en `localStorage`; ahora no); los contadores de `limites` y las sesiones
   quedan sin uso; las estadísticas vuelven a calcularse sobre todas las partidas.
4. Revertir en git (`git revert`) y desplegar por el flujo normal con CI verde.

---

## 5. Observabilidad

Los logs son **una línea JSON por evento** (`servidor/registro.js`), visibles en Vercel → Logs. Los
campos con nombres sensibles (`token`, `secreto`, `clave`, `cookie`, `authorization`, `ip`, `prompt`,
`cuerpo`…) se reemplazan por `[oculto]`. Las IPs solo aparecen como `origen`: un HMAC truncado con
`SECRETO_SESION`.

| Evento | Nivel | Cuándo |
| --- | --- | --- |
| `error_5xx` | error | cualquier error no controlado (incluye la pila) |
| `cron` | info / error | cada corrida de `/api/cron/*` con `tarea`, `resultado`, `duracionMs` |
| `admin_login`, `admin_login_fallido`, `admin_logout` | info / warn | sesiones del panel |
| `admin_no_autorizado`, `admin_origen_rechazado`, `cron_no_autorizado`, `origen_rechazado` | warn | autorización rechazada |
| `limite_excedido`, `limite_error` | warn / error | rate limiting (una línea por ventana y origen) |
| `migracion`, `migracion_fallida` | info / error | al arrancar |
| `ia` | info | cada corrida con IA: proveedor, modelo, duración, llamadas, tokens, costo estimado |
| `admin_generar` | info | generación manual desde el panel |

### Alertas recomendadas (Vercel → Observability / Log Drains → su herramienta de alertas)

| Alerta | Condición sugerida |
| --- | --- |
| Errores | ≥ 5 `error_5xx` en 10 min, o tasa de 5xx > 2 % |
| Latencia | p95 de `/api/partidas/*` > 1,5 s durante 15 min |
| Cron | ausencia del evento `cron` con `tarea: "hoy"` entre 00:00 y 01:30 (Buenos Aires), o `resultado: "fallo"` |
| Desafío del día | `GET /api/salud` con `desafioPublicado: false` después de las 00:30 |
| Abuso | > 50 `limite_excedido` en 10 min, o > 20 `admin_login_fallido` en 1 h |
| Costo de IA | suma diaria de `costoEstimadoUsd` (o de `llamadas`) por encima del presupuesto |
| Migraciones | cualquier `migracion_fallida` |

---

## 6. Retención de datos y limpieza

Tarea diaria `GET /api/cron/limpieza` (Vercel Cron, 07:00 UTC). Borra por tandas de 5.000 filas.

| Dato | Retención | Variable |
| --- | --- | --- |
| Jugadores anónimos que nunca jugaron ni reportaron | 90 días desde la primera visita | `RETENER_VISITANTES_DIAS` |
| Intentos fallidos (texto libre escrito por jugadores) | 180 días | `RETENER_INTENTOS_DIAS` |
| Reportes ya resueltos (aceptados/descartados) | 365 días; los pendientes no se borran | `RETENER_REPORTES_DIAS` |
| Detalle de corridas de generación | 180 días (se conserva el resumen) | `RETENER_CORRIDAS_DIAS` |
| Sesiones del panel | hasta su vencimiento (30 min de inactividad / 8 h máx.) | `ADMIN_INACTIVIDAD_MIN`, `ADMIN_VIDA_HORAS` |
| Contadores de rate limit | hasta el fin de su ventana | — |
| Partidas, rondas, desafíos | indefinida (historial del juego y estadísticas) | — |
| Logs | los retiene Vercel según el plan (1 h–30 días); con Log Drain, 30 días como máximo | — |

---

## 7. Protección contra abuso

- **Distribuido** (`servidor/limites.js`): contadores en la tabla `limites` de Turso, compartidos por
  todas las instancias; incremento atómico (`INSERT … ON CONFLICT … RETURNING`). Claves =
  `política:HMAC(IP)`; nunca la IP en claro.

  | Política | Máximo |
  | --- | --- |
  | `login_admin` | 5 / 15 min (si la base falla, se niega) |
  | `admin` (resto del panel) | 240 / min |
  | `partida` | 30 / min · `respuesta` 90 / min · `revelado` 60 / min |
  | `reporte` | 20 / 10 min |
  | `importar` | 20 / h · `generar` 10 / h · `cron` 30 / h |

- **Por instancia** (primera barrera, en memoria): ~8 solicitudes/s por IP.
- **IP del cliente**: en Vercel se usa `x-real-ip` (Vercel la fija y no se puede falsificar desde el
  cliente); con un proxy propio (`CONFIAR_PROXY=1`), la última entrada de `X-Forwarded-For`.
- **Vercel Firewall (configurar a mano)** — proyecto → Firewall:
  1. Activar **Attack Challenge Mode** ante un ataque en curso.
  2. Regla **Rate limit**: `/api/admin/sesion` → 10 solicitudes / 15 min por IP → *Deny*.
  3. Regla **Rate limit**: `/api/*` → 300 / min por IP → *Deny* (corta antes de llegar a la función).
  4. Opcional: bloquear `/admin` y `/api/admin/*` salvo países o IPs esperados.

---

## 8. Índices y evidencia (EXPLAIN QUERY PLAN)

`npm run explicar-consultas` imprime el plan de 22 consultas principales; `pruebas/volumen.test.js`
falla si alguna recorre completa una tabla grande. Resumen (base con 3.000 partidas):

| Consulta | Plan |
| --- | --- |
| partida del jugador / pendiente | `SEARCH partidas USING INDEX … (jugador_id=? AND …)` |
| tope de intentos (en la transacción) | `SEARCH intentos USING INDEX intentos_ronda (partida_id=? AND posicion=?)` |
| ranking del día | `SEARCH puntajes_desafio USING INDEX … (desafio_id=?)` (≤ 141 filas) |
| partidas de un desafío, serie del panel | `SEARCH partidas USING (COVERING) INDEX partidas_desafio_terminada` |
| visitantes por período, limpieza | `SEARCH jugadores USING COVERING INDEX jugadores_creado` |
| reportes pendientes | `SEARCH reportes USING COVERING INDEX reportes_estado` |
| limpieza de intentos / límites / sesiones | `SEARCH … USING COVERING INDEX intentos_en / limites_vence / admin_sesiones_vence` |
| IA del día | `SEARCH corridas USING INDEX corridas_iniciada` |

Única excepción aceptada: `SCAN desafios` en la serie del panel (una fila por día, ~365 por año).
Los totales históricos del panel (`COUNT(DISTINCT jugador_id)`) recorren el índice completo de
`partidas`; es una consulta solo de administración y se puede preagregar si el volumen lo exige.
