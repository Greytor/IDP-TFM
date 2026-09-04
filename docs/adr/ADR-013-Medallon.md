# ADR-013: La lógica de KPI vive en SQL (bronze → silver → gold)

**Status:** Aceptado
**Fecha:** 2026-07-16
**Autores:** José Desiderio

---

## Contexto

El pipeline deja en TimescaleDB el JSONB tal como llegó del UNS. A partir de ahí hay que
calcular KPIs de negocio (OEE, calidad, intensidad energética) y **hay cuatro consumidores que
los quieren**: Grafana, la API REST, el motor de reportes PDF y el write-back que los devuelve
al UNS.

La pregunta no es *"cómo se calcula el OEE"* sino **dónde vive ese cálculo**. Y tiene una sola
respuesta buena, porque el fallo que hay que evitar es concreto: si el OEE se calcula en
Grafana *y* en la API, tarde o temprano **dan números distintos**, y una plataforma de datos
industriales que da dos verdades no vale nada. Es el riesgo de dilución de la lógica.

Segunda fuerza: el JSONB crudo es caro de consultar. Interpretarlo en cada consulta significa
abrir el documento de cientos de miles de filas cada vez.

## Decisión

**Toda la lógica de KPI vive en SQL, en la capa `gold`. Ningún consumidor calcula KPIs.**

Arquitectura de medallón en tres capas:

| Capa | Qué es | Regla |
|---|---|---|
| **bronze** | JSONB tal cual llegó (`sensor_readings`, `device_status`, `alerts`) | **Inmutable.** Nunca se reescribe. Es la evidencia |
| **silver** | Interpretación: JSONB → columnas vía `LATERAL`. `asset_tags` mapea `(src, field)` → nombre legible + unidad + límites | Sin lógica de negocio |
| **gold** | KPIs de negocio, como vistas | **La única fuente.** Grafana, API, reportes y write-back leen de aquí |

**Regla anti-dilución (innegociable):** si un KPI cambia, cambia en `gold.sql` y **todos** los
consumidores ven el cambio a la vez. No hay forma de que dos consumidores discrepen.

**Rendimiento — dos rutas deliberadas:**

| Tipo de consulta | Mecanismo | Por qué |
|---|---|---|
| **Conocidas** (los KPIs del catálogo) | **Continuous aggregate** `ca_kpi_1h`, agrupado por `(hour, src)`, `materialized_only=false` | Se sabe de antemano qué se va a preguntar → se materializa |
| **Desconocidas** (exploración, Familia 1 de la API) | `LATERAL` genérico sobre silver | No se puede materializar lo que no se sabe que se va a preguntar |

Misma lógica que indexar solo las consultas que sabes que vas a correr.

## Alternativas consideradas

| Opción | Pro | Contra | Descartada porque |
|--------|-----|--------|-------------------|
| Calcular KPIs en cada consumidor | Cada uno pide justo lo que necesita | **Dilución garantizada**: el OEE de Grafana y el del PDF divergen | Es el fallo que este ADR existe para evitar. |
| Calcular en un servicio Python intermedio | Se testea con pytest; lógica en un lenguaje "de verdad" | Un salto de red más; el servicio se vuelve cuello de botella y single point of failure; SQL ya es declarativo y el motor optimiza | Añade un componente para hacer lo que el motor de base de datos hace mejor. Y no elimina la dilución: habría que forzar que *todos* pasen por él. |
| Materializar con tablas + cron | Simple de entender | Refresco completo, ventana de datos rancios, hay que gestionar el estado | Los continuous aggregates de TimescaleDB hacen refresco **incremental** y sirven la cubeta en curso en vivo. |
| Solo `LATERAL`, sin agregados | Una sola ruta, más simple | **1347 ms** por consulta de OEE | Medido: inaceptable para un dashboard con refresco. |

## Consecuencias

**Positivas:**
- **Una sola verdad.** Los cuatro consumidores leen la misma vista.
- **345× más rápido**, medido con `EXPLAIN ANALYZE`: `v_oee_hourly` pasó de **1347 ms a
  3.945 ms**. El plan pasó de `jsonb_object_keys loops=702355` + `external merge Disk: 16MB` a
  `Index Scan on _materialized_hypertable_13` (233 filas) + escaneo vivo solo de la hora en curso.
- **Se cambia un KPI sin desplegar código.** Se aplica por SQL, sin reiniciar contenedores. La
  reescritura de `v_oee_hourly` para usar el agregado fue invisible para API y write-back.
- **Escala por filas, no por columnas**: un dispositivo nuevo con campos conocidos aparece solo
  en `ca_kpi_1h`. Solo se toca cuando un KPI necesita un campo **nuevo**.
- `bronze` inmutable = se puede reprocesar todo si la lógica cambia.

**Negativas / Trade-offs aceptados:**
- **La lógica de negocio no tiene tests unitarios.** Está en SQL, no en Python. Se valida por
  inspección y por `smoke_test.sql`. Es el precio de no tener dilución, y se acepta: la
  alternativa (un servicio Python testeable) reintroduce el problema que este ADR resuelve.
- **Un continuous aggregate no admite `LATERAL`** → hay que definirlo directamente sobre la
  hypertable, y por eso `ca_kpi_1h` tiene columnas explícitas. Su vocabulario de campos crece
  con los KPIs.
- `running_frac` no puede ser genérico: `avg`/`min`/`max` no expresan "fracción de muestras = 2".
- La cubeta de 1 hora es fija. Un KPI diario se construye encima (los CAgg jerárquicos lo hacen
  barato), no se reconfigura.
- Quien mantenga el stack **tiene que saber SQL**. Es una decisión de perfil de equipo.

**Deuda técnica generada:**
- `smoke_test.sql` no valida aún que toda `kpi_catalog.view_name` exista. Lo cubre parcialmente
  `GET /api/v1/admin/health` (campo `kpis_rotos`).

## Implicaciones de seguridad

- La capa `gold` son **vistas de solo lectura**. Los consumidores no pueden escribir datos.
- `bronze` inmutable es una propiedad de **integridad**: el dato crudo no se puede alterar desde
  la aplicación, así que siempre hay evidencia contra la que reconciliar un KPI disputado.
- La API compone nombres de vista con `psycopg.sql.Identifier` y **solo desde el catálogo**,
  nunca desde entrada del usuario: los identificadores no se pueden parametrizar y esa es la
  forma segura de insertarlos.
- Riesgo asumido: quien pueda escribir `kpi_catalog` decide qué vista se lee. Por eso la
  Familia 4 de la API valida contra `information_schema` y se gateará con rol `admin`
  (Sprint 2, issue 2.1-C).

## Referencias

- [ADR-001](./ADR-001-TimescaleDB.md) — TimescaleDB como TSDB
- [ADR-007](./ADR-007-CQRS-Edge.md) — CQRS: Grafana lee la BD, no MQTT
- el write-back de KPIs]-Write-back.md) — quién publica estos KPIs de vuelta al UNS
- `deploy/3-central/sql/` — `silver.sql`, `gold.sql`, `continuous_aggregates.sql`, `db-medallon.html`
- `docs/internal/journal/journal-sprint-1.3.md` §4 — la medición del 345×
