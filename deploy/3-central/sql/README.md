# Modelo de datos en TimescaleDB — bronze / silver / gold

> Cómo el UNS se convierte en histórico consultable: qué tablas existen,
> quién las crea, qué hace el consumer, y qué vista usar para cada cosa.
> Contrato de datos: `docs/contracts/UNS.md` (v0.3.1).

## El pipeline completo

```
Simuladores ──Modbus/OPC UA──▶ Node-RED ──MQTT──▶ NanoMQ ──bridge──▶ EMQX
                                                                       │
                       ┌───────────────────────────────────────────────┘
                       ▼
                 mqtt-bridge (Redpanda Connect)
                 topic MQTT → topic Kafka (/ → .)
                       │
                       ▼
                   Redpanda  ── un topic Kafka por topic MQTT ──┐
                       │                                        │
                       ▼                                        ▼
             redpanda-to-tsdb (consumer)               (otros consumidores
                       │                                 futuros: ML, S3…)
                       ▼
   ╔═══════ BRONZE ═══════╗   ╔═══════ SILVER ═══════╗   ╔═══════ GOLD ═══════╗
   ║ sensor_readings      ║   ║ asset_tags (dicc.)   ║   ║ v_process_1m       ║
   ║ device_status        ║ → ║ v_process_readings   ║ → ║ v_kpi_production_* ║
   ║ alerts               ║   ║ v_device_signals     ║   ║ v_line_availability║
   ║ (JSONB tal cual)     ║   ║ v_device_status_last ║   ║ v_energy / v_oee   ║
   ╚══════════════════════╝   ║ v_alerts_recent      ║   ║ v_throughput_1m    ║
                              ╚══════════════════════╝   ║ v_business_hourly ◀╫─ business_params
                                                         ╚════════════════════╝   ($: tarifa, margen…)
        crudo, inmutable          + semántica humana         KPIs de negocio
```

**Filosofía medallion:** bronze guarda el mensaje tal cual llegó (auditable,
re-procesable); silver le agrega contexto humano (nombres, unidades, límites)
sin tocar el crudo; gold calcula KPIs de negocio. La lógica vive en el modelo,
no en los aplicativos — **ningún consumidor calcula KPIs por su cuenta**
(regla anti-dilución, contrato §10.2). Grafana consume silver y gold, nunca bronze.

## Bronze — 3 tablas (las crea el consumer)

Definidas en `../consumers/redpanda-to-tsdb/init.sql`. **No se aplican a
mano**: el consumer ejecuta ese archivo en cada arranque (`CREATE IF NOT
EXISTS` — idempotente). Las tres son hypertables de TimescaleDB (particionadas
por tiempo automáticamente).

| Tabla | Recibe (categoría UNS) | Clave de dedup | Contenido |
|---|---|---|---|
| `sensor_readings` | `dat/raw` (v0.2 y v0.3) + `diag` | `(ts, src, seq)` | `payload` JSONB con la(s) variable(s) |
| `device_status` | `sts` | `(ts, src)` | `state` JSONB plano (online, alarmas…) |
| `alerts` | `dat/der` + `evt` | *(sin dedup — ver limitaciones)* | evento aplanado + `body` original |

## El consumer (`redpanda-to-tsdb`)

`../consumers/redpanda-to-tsdb/main.py`. Flujo por mensaje:

1. **Suscripción por regex** a los topics Kafka de categorías del contrato:
   `^greytec\..*\.(def|dat\.raw(\.[a-z0-9_]+)?|dat\.der|sts|diag|evt)$`
   El grupo `(\.[a-z0-9_]+)?` es el segmento de variable de los topics v0.3
   (`…dat.raw.mass_flow_kgh`). ⚠ El valor operativo vive en
   `docker-compose.yml` (env `KAFKA_PATTERN`) y **pisa** el default del código
   — si cambias el patrón, cambia ambos.
2. **Router por categoría** (`process()`): mira solo los últimos segmentos del
   topic — **nunca el nombre del dispositivo**. Por eso agregar un dispositivo
   nuevo no requiere tocar este código.
3. **Normalización v0.3** (`insert_reading_flat()`): el envelope plano
   `{ts,src,seq,v,u,q}` se guarda como `{variable: {v,u,q}}` — la misma forma
   de almacenamiento que v0.2. El nombre de la variable se toma del topic.
   Resultado: silver no distingue versiones del contrato.
4. **Exactly-once efectivo** para readings/status: `INSERT … ON CONFLICT DO
   NOTHING` + commit manual de offset *después* del INSERT. Si el consumer
   muere a mitad, Redpanda re-entrega y el duplicado se descarta por la clave.

### Qué formato termina dónde (§4.6 del contrato)

| Llega | Ejemplo de payload almacenado | En silver se ve |
|---|---|---|
| `dat/raw` v0.3 (plano) | `{"mass_flow_kgh": {"v":1250.4,"u":"kg/h","q":"good"}}` | `value=1250.4, quality='good'` |
| `dat/raw` v0.2 (agrupado, ESP32) | `{"temp_c":{"v":24.3,…}, "humidity_pct":{…}}` | una fila por campo |
| `diag` plano (coriolis §7.4.2) | `{"drive_gain_pct":62.5, "air_entrainment":true, …}` | `value=62.5, quality=NULL` (sin q por diseño) |
| `sts` | → `device_status.state` | `v_device_signals`: una fila por señal |
| `evt` / `dat/der` | → `alerts` | `v_alerts_recent` |

### Limitaciones conocidas

- **`alerts` no tiene clave de dedup** (los `evt` no llevan `seq`): si el
  consumer muere entre el INSERT y el commit del offset, la re-entrega duplica
  esa alerta. Aceptado por ahora (los evt son de baja frecuencia).
- **Descubrimiento de topics nuevos:** una variable nueva crea un topic Kafka
  nuevo; librdkafka refresca metadata cada ~5 min — los primeros mensajes de
  una variable *recién estrenada* pueden tardar eso en aparecer. No hay pérdida:
  `auto.offset.reset=earliest` los recoge desde el inicio del topic.
- **Commit por mensaje**: correcto y simple al volumen actual (~decenas de
  msg/s). Si el volumen crece, batchear commits.

## Silver — `silver.sql` (aplicar a mano)

```bash
docker exec -i greytec-timescaledb psql -U <USER> -d <DB> -v ON_ERROR_STOP=1 < silver.sql
docker exec -i greytec-timescaledb psql -U <USER> -d <DB> -v ON_ERROR_STOP=1 < continuous_aggregates.sql
docker exec -i greytec-timescaledb psql -U <USER> -d <DB> -v ON_ERROR_STOP=1 < gold.sql
```

⚠ **El orden es obligatorio sobre una base limpia.** `continuous_aggregates.sql`
crea `ca_kpi_1h` leyendo de bronce, y cinco vistas de `gold.sql` leen de ese
agregado: invertirlos falla con «relation "ca_kpi_1h" does not exist».

⚠ `silver.sql` hace `DROP VIEW … CASCADE` (las vistas gold dependen de las
silver), así que **re-aplicar silver borra el gold** — por eso gold.sql se
re-aplica siempre a continuación. El CAgg no se ve afectado por ese CASCADE:
cuelga de bronce, no de plata. Los tres son idempotentes y no tocan datos.

| Objeto | Qué es |
|---|---|
| `asset_tags` | **Diccionario de contexto**: para cada `(src, field)` — nombre legible, unidad, área, límites operativos, `is_numeric`. Es metadata editable; no guarda proceso. `INSERT … ON CONFLICT DO NOTHING` preserva ediciones manuales. |
| `v_process_readings` | La vista central: desempaqueta el JSONB de `sensor_readings` a una fila por `(ts, src, field)` con `value` (numérico), `value_text` (booleans/strings) y `quality`. Soporta ambas formas de payload (objeto `{v,u,q}` y escalar plano del diag) vía `jsonb_typeof`. **INNER JOIN con `asset_tags`: un campo sin fila en el diccionario NO aparece** — filtro deliberado contra ruido. |
| `v_device_signals` | `device_status.state` expandido a una fila por señal — para State Timeline en Grafana. |
| `v_device_status_latest` | Último `sts` conocido por dispositivo. |
| `v_alerts_recent` | `alerts` ordenado descendente. |

## Gold — `gold.sql` (aplicar a mano, después de silver)

Todas dependen de `v_process_readings`. Nota transversal: con RBE (contrato
§3.5) las muestras **no son uniformes** — publican al cambiar + heartbeat cada
30 s. El heartbeat acota el error de los promedios (≤30 s sin muestra) y
garantiza ≥1 muestra de cada contador por bucket de 1 min con el edge vivo.

| Vista | KPI | Panel Grafana típico |
|---|---|---|
| `v_process_1m` | Rollup avg/min/max/n por minuto de toda variable | Time series (tendencias largas) |
| `v_kpi_production_live` | Botellas good/rejected/total + reject_pct, en vivo | Stat |
| `v_production_hourly` | Producción y calidad por hora (delta de contadores) | Bar chart |
| `v_throughput_1m` | Botellas/hora reales, normalizado por tiempo entre muestras | Time series |
| `v_line_availability_hourly` | % del tiempo en RUNNING / FAULT / STOPPED | Bar gauge / Time series |
| `v_energy_hourly` | kWh consumidos + potencia media/pico de la celda | Bar chart + Stat |
| `v_energy_intensity_hourly` | Wh por botella producida (energía ÷ producción del mismo bucket) | Time series |
| `v_oee_hourly` | OEE = disponibilidad × calidad × performance (nominal 2400 bph) | Gauge / Time series |
| `v_business_hourly` | Económico por hora: margen ganado + costos de energía, rechazos y paradas, según `business_params` | (lo consume la web/PDF, no Grafana) |

Caveat de contadores: si un simulador se reinicia, sus acumuladores vuelven a
0. Los deltas por bucket usan `greatest(…, 0)` donde aplica, pero el bucket
que contiene el reinicio puede quedar inflado (max pre-reinicio − min
post-reinicio). Tratamiento estándar de counters (mismo caso que Prometheus).

Cuando el histórico escale: materializar `v_process_1m` como *continuous
aggregate* de TimescaleDB (nota al pie de `gold.sql`).

### `business_params` — el tercer catálogo (2026-07-17)

`asset_tags` dice qué **significa** cada señal; `kpi_catalog` dice qué KPIs
**existen**; `business_params` dice qué **vale** el negocio. Tabla clave→valor
(param, value, unit, description, `updated_at`) sembrada en `gold.sql` con
`ON CONFLICT DO NOTHING` — lo editado en la consola sobrevive a re-aplicar.

| Parámetro | Semilla | Lo usa |
|---|---|---|
| `tarifa_kwh` | 0.10 $/kWh | costo de energía |
| `margen_botella` | 0.08 $/botella | margen ganado y costo de paradas |
| `costo_rechazo` | 0.12 $/botella | costo de rechazos |
| `meta_diaria` | 40 000 botellas/día | barra de avance de la web |
| `tasa_nominal_bph` | 2 400 botellas/hora | costo de paradas (misma constante del OEE) |

Por qué es tabla y no config de entorno: las **fórmulas viven en SQL** (regla
anti-dilución) y una vista no puede leer un `.env`. `v_business_hourly` la lee
con `CROSS JOIN`: un `PUT` desde la consola (Familia 4,
`/api/v1/admin/business-params/{param}`) recalcula el dinero en la siguiente
consulta, sin reiniciar nada. En un cliente real estas filas las sincroniza un
conector desde su ERP contra esos mismos endpoints — la tabla es la interfaz.

`updated_at` existe para el **pie de supuestos**: todo número monetario de la
web y del PDF declara con qué parámetros y de qué fecha se calculó. El costo de
paradas es margen **no ganado** (costo de oportunidad: `(1 − disponibilidad) ×
tasa_nominal × margen × fracción de hora`): se lista aparte y nunca se resta
del margen ganado. Un solo producto por ahora (la celda simula un SKU); un
segundo SKU añadiría la dimensión producto **a esta vista**, no a la API ni al
front.

## Cómo agregar un dispositivo nuevo (checklist)

1. **Contrato**: sección en `docs/contracts/UNS.md` §7 (topics, variables,
   deadbands — declarando granularidad y forma según §4.6).
2. **Edge**: cadena de adquisición en Node-RED (poll → normalizar → RBE).
3. **Consumer / bronze: NADA.** El router es genérico por categoría.
4. **Silver**: una fila en `asset_tags` por variable (metadata, no código).
   Re-aplicar `silver.sql` y luego `gold.sql`.
5. **Gold**: solo si el dispositivo trae un KPI de negocio nuevo.
6. Verificar con `smoke_test.sql` (bloque 2.3: campos que llegan sin diccionario).

## Smoke test

`smoke_test.sql` — solo SELECTs, seguro de correr en producción. Cuatro
bloques: bronze (¿llega?), calidad (¿se pierde algo? ¿huecos de seq?), silver
(¿se interpreta?), gold (¿KPIs coherentes?). Cada query documenta qué
resultado es "sano". Correr tras cada despliegue o cambio de contrato.

## Verificación de este modelo (2026-07-03)

Validado contra un TimescaleDB desechable (misma imagen que producción,
`timescale/timescaledb:2.17.2-pg15`): `init.sql` + `silver.sql` + `gold.sql`
aplican limpio, re-aplican idempotentes (incluido el CASCADE silver→gold), y
las 10 vistas devuelven resultados correctos con datos de prueba en los tres
formatos de payload (v0.2 agrupado, v0.3 plano normalizado, diag plano).

## Verificación de este documento (2026-07-18)

Se comparó **este README, `gold.sql` y `db-medallon.html` contra lo que
corre de verdad en producción** (no solo entre sí):

- Las 13 vistas de `pg_views` (4 silver + 9 gold, incluida `v_business_hourly`)
  coinciden exactamente con las que crean `silver.sql`/`gold.sql` — ninguna
  vista fantasma, ninguna vista documentada que no exista.
- `pg_get_viewdef()` de `v_oee_hourly` y `v_business_hourly` en el servidor es
  **idéntico** a lo que hay en `gold.sql` — el bloque de negocio, aplicado a
  mano por partes el 17/07, quedó en sincronía con el archivo completo.
- `business_params` y `kpi_catalog` en el servidor tienen exactamente las filas
  que siembra `gold.sql` (5 parámetros, 6 KPIs con `business` en `publish=false`).
- El único CAgg vivo es `ca_kpi_1h` (`materialized_only=false`) — confirmado
  contra `timescaledb_information.continuous_aggregates`.
- **Se corrigieron dos comentarios desactualizados** en `gold.sql`: dos
  referencias a `ca_llenado_1h`/`ca_medidor_1h` como si aún existieran, cuando
  `continuous_aggregates.sql` los fusionó en `ca_kpi_1h` hace tiempo (el
  *código* ya usaba el nombre correcto — solo el comentario mentía).

Conclusión: los tres documentos están al día entre sí y con el servidor.
