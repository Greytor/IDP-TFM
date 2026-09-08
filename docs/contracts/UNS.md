# Contrato UNS v0.5 — Greytec IDP (edición TFM)

> **Documento:** Unified NameSpace Contract  
> **Versión:** 0.5  
> **Autor:** Desiderio Moreira  
> **Status:** Vigente — edición del repositorio académico del TFM  
> **Última actualización:** 2026-09-03  
> **Scope:** Laboratorio Greytec-Demo. Para deployments en cliente real, ver sección 7.
>
> **⚠ v0.3 es un cambio mayor:** `dat/raw` pasa de un telegrama agrupado por dispositivo
> a **un topic por variable con Report by Exception** (§3.5, §4.1). OpenPLC (`soft-plc`)
> se retira y lo reemplaza la celda de llenado F&B simulada (§7.1). **v0.3.1** agrega §4.6:
> justificación de por qué cada categoría tiene su propia granularidad y forma de payload.

---

## Tabla de contenidos

1. [Propósito y alcance](#1-propósito-y-alcance)
2. [Jerarquía de topics](#2-jerarquía-de-topics)
3. [Convenciones globales](#3-convenciones-globales) — incluye §3.5 Report by Exception
4. [Esquemas de envelope por categoría](#4-esquemas-de-envelope-por-categoría) — incluye §4.6 justificación de forma por categoría
5. [Regla raw vs. derived](#5-regla-raw-vs-derived)
6. [Árbol completo del laboratorio](#6-árbol-completo-del-laboratorio)
7. [Payloads por dispositivo](#7-payloads-por-dispositivo)
8. [Extensión a cliente real](#8-extensión-a-cliente-real)
10. [Clasificación de consumidores](#10-clasificación-de-consumidores)
11. [Reglas de evolución del contrato](#11-reglas-de-evolución-del-contrato)
12. [Historial de versiones](#12-historial-de-versiones)

---

## 1. Propósito y alcance

Este documento es el **contrato de datos del Unified Namespace (UNS)** de Greytec IDP. Define qué se publica, dónde, en qué formato, y bajo qué reglas — de forma que cualquier productor y cualquier consumidor puedan integrarse sin coordinación bilateral.

**Principio rector:** el UNS es una única fuente de verdad. Ninguna aplicación lee datos directamente de otra aplicación ni de una base de datos compartida. Todo cambio de estado se expresa como un mensaje publicado al UNS. Las bases de datos (TimescaleDB, MinIO) son vistas materializadas derivadas del UNS, no fuentes primarias.

**Lo que este documento NO es:**

- No define cómo se despliega el broker (eso es documentación interna de Greytec).
- No define retención de datos en TimescaleDB (eso es el runbook de despliegue).
- No es la documentación de la API REST de FastAPI (eso es el OpenAPI spec).

**Audiencia:**

- Interna (Greytec): referencia para construir firmware, pipelines y consumers.
- Integradores externos: pueden recibir las secciones 2, 3, 4 y 5 como contrato de integración. Las secciones 6 y 7 son IP interna.

---

## 2. Jerarquía de topics

### 2.1. Estructura canónica

```
{enterprise}/{site}/{area}/{line}/{cell}/{category}[/{subcategory}]
```

| Nivel | Descripción | Ejemplo laboratorio | Ejemplo cliente real |
|---|---|---|---|
| `enterprise` | Organización o tenant | `greytec` | `atmos` |
| `site` | Planta o instalación | `demo` | `planta-guayaquil` |
| `area` | Zona funcional de la planta | `campo`, `control`, `energia` | `linea-1`, `servicios` |
| `line` | Línea o subsistema dentro del área | `instrumentacion`, `remoto` | `compresor`, `bombeo` |
| `cell` | Dispositivo o activo individual | `esp32-a`, `soft-plc` | `compresor-01` |
| `category` | Tipo funcional del mensaje | `def`, `dat`, `sts`, `evt`, `diag` | igual |
| `subcategory` | Origen del dato (solo bajo `dat`) | `raw`, `der` | igual |

### 2.2. Regla de niveles opcionales

No toda jerarquía necesita los seis niveles intermedios. En instalaciones simples, `line` puede omitirse si `area` ya identifica unívocamente al activo. Lo que **nunca** puede omitirse es `enterprise`, `site` y `cell`. La estructura mínima válida es:

```
{enterprise}/{site}/{cell}/{category}
```

La decisión de qué niveles usar en un deployment específico se documenta en la sección de configuración de tenant correspondiente (`tenants/{cliente}/uns-mapping.md`).

### 2.3. Namespace reservado `_`

Los topics que comienzan con `_` en cualquier nivel son **reservados para datos calculados o de sistema** que no corresponden a un dispositivo físico individual:

```
greytec/demo/_kpi/oee
greytec/demo/_kpi/consumo-total
greytec/demo/campo/_kpi/temperatura-promedio
```

Ningún dispositivo de campo publica bajo `_`. Solo publican: eKuiper, FastAPI, o pipelines de analytics de Greytec.

---

## 3. Convenciones globales

### 3.1. Encoding y formato

| Propiedad | Valor | Razón |
|---|---|---|
| Encoding | JSON UTF-8 | Legible, debuggeable, compatible con todo el stack |
| Timestamp | ISO 8601 UTC con milisegundos | `2026-06-05T14:23:00.123Z` — nunca Unix epoch plano |
| Nombres de campos | `snake_case` en inglés | Consistencia entre firmware (C++) y backend (Python) |
| Unidades en nombre | Sí, cuando hay ambigüedad | `temp_c` no `temp`; `pressure_hpa` no `pressure` |
| Valores nulos | Campo ausente, no `null` | Reduce tamaño de payload en dispositivos con RAM limitada |

### 3.2. QoS por categoría

| Categoría | QoS | Retained | Razón |
|---|---|---|---|
| `def` | 1 | **true** | Definición del activo (§4.0). Todo suscriptor nuevo debe recibir qué es el activo y qué significan sus variables **antes** que cualquier valor |
| `dat/raw/{var}` | 1 (at-least-once) | **true** | RBE (§3.5): el broker conserva el último valor por variable; un suscriptor nuevo arranca con el estado completo sin esperar el próximo cambio |
| `dat/der` | 1 | false | Telemetría derivada continua; duplicados tolerables con `seq` |
| `_kpi/{name}` | 1 | **true** | Indicador de estado corriente (§7.3): el SCADA debe verlo al conectar, no esperar al siguiente recálculo. Retirar un KPI exige publicar un retained vacío |
| `sts` | 1 | **true** | El broker conserva el último estado; nuevo suscriptor lo recibe inmediatamente |
| `evt` | 1 | false | Eventos discretos; no tiene sentido retener el último |
| `diag` | 1 | false | Canal paralelo NOA; no bloquea el lazo de control |

### 3.3. Identificadores de dispositivo

El `cell` en el topic y el campo `src` en el payload **deben ser idénticos**. El `src` es el identificador canónico del dispositivo en todo el sistema — el mismo que aparece en TimescaleDB, en los runbooks y en el inventario de hardware.

Formato: `{tipo}-{numero}` en minúsculas con guión. Ejemplos: `esp32-a`, `esp32-b`, `soft-plc`, `medidor-01`.

### 3.4. Número de secuencia

La categoría `def` no lleva `seq` sino `rev` (§4.0): no es un flujo de muestras sino una
definición con revisiones.


Todo mensaje de categoría `dat` incluye un campo `seq`: entero sin signo de 32 bits, monotónico, reiniciado a 0 en cada arranque del dispositivo (o del publicador edge que actúa en su nombre). Permite al consumidor detectar pérdida de mensajes y descartar duplicados (Idempotent Receiver — Hohpe & Woolf).

**Con topics por variable (v0.3), `seq` es por dispositivo, no por variable:** un solo contador que incrementa con cada mensaje publicado del `src`, a través de todas sus variables. Consecuencias:

- La detección de huecos se hace a nivel de dispositivo, suscribiéndose a `…/{cell}/dat/raw/#`. Un suscriptor de una sola variable verá saltos de `seq` normales (los consumen las otras variables).
- La clave de idempotencia `(ts, src, seq)` sigue siendo única — dos variables publicadas en el mismo instante nunca comparten `seq`.

### 3.5. Report by Exception (RBE)

`dat/raw` **no publica en cadencia fija**: publica cuando el valor cambia. Reglas:

| Regla | Definición |
|---|---|
| **Deadband** | Se publica cuando \|valor − último publicado\| > deadband de la variable (tabla §7 por dispositivo). Booleanos, enteros de estado y contadores: cualquier cambio publica. |
| **Cambio de calidad** | Un cambio de `q` publica siempre, aunque el valor no haya cambiado. |
| **Heartbeat** | Si pasan **30 s** sin publicar una variable, se republica el último valor (con `ts` nuevo). Distingue "sin cambios" de "productor muerto". Para `diag`: 60 s. |
| **Retained** | `retain=true` en cada `dat/raw/{var}`: el broker conserva el último valor y un suscriptor nuevo arranca con el estado completo del namespace. |
| **Frescura** | Un consumidor debe tratar como sospechoso (stale) un valor cuya edad supere 2× heartbeat. |

El poll del edge hacia el dispositivo (Modbus/OPC UA) sigue siendo cíclico — el RBE reduce **lo publicado**, no lo leído. El deadband se aplica en el edge (Node-RED) o nativamente vía monitored items de OPC UA.

#### 3.5.1. Cómo dimensionar un deadband

**Regla:** el deadband debe ser **mayor que el ruido de la señal** y **menor que el cambio que
importa**. Si queda por debajo del ruido, el RBE **degenera en publicación periódica al ritmo
del poll**: deja de filtrar y solo añade complejidad.

Cómo verificarlo con datos reales, no a ojo:

```sql
-- Cambio real entre muestras consecutivas de un dispositivo (última hora)
SELECT field,
       count(*) AS muestras_hora,
       round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY abs(delta))::numeric, 4) AS ruido_mediano,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY abs(delta))::numeric, 4) AS cambio_p95
FROM (SELECT field, value - lag(value) OVER (PARTITION BY field ORDER BY ts) AS delta
      FROM v_process_readings
      WHERE src = '<dispositivo>' AND ts > now() - interval '1 hour') d
WHERE delta IS NOT NULL GROUP BY field;
```

Diagnóstico:

| Señal | Lectura |
|---|---|
| `muestras_hora` ≈ **120** (= 3600/heartbeat) | el deadband filtra bien — solo late ✓ |
| `muestras_hora` ≫ 120 y `deadband` < `ruido_mediano` | **deadband demasiado apretado**: publica ruido |
| `deadband` entre `ruido_mediano` y `cambio_p95` | punto correcto: filtra ruido, deja pasar eventos |

**Contraejemplo real (v0.3):** `voltage_v` (db 1, ruido 0.32) publicaba 124 msg/h — el piso exacto
del heartbeat. `current_a` (db 0.05, ruido 0.23) publicaba 1558 msg/h. Mismo dispositivo, mismo
ciclo: la única diferencia era el deadband frente al ruido.

**Excepción — acumuladores y contadores** (`good_count`, `total_mass_kg`, `energy_kwh`): publican
en cada cambio **a propósito**. Cada incremento es un evento real que el consumidor operacional
(SCADA) necesita en vivo, no ruido. El volumen que generan es **problema del historiador**, y se
resuelve con las políticas de TimescaleDB (compression, retention, continuous aggregates) — nunca
subiendo el deadband del edge, que degradaría el UNS en tiempo real. *El deadband del edge lo dicta
el consumidor operacional (§10.1), no la base de datos.*

---

## 4. Esquemas de envelope por categoría

Todos los mensajes tienen un **envelope** con campos comunes. Los campos específicos de cada dispositivo van dentro de `payload`.

### 4.0. `def` — Definición del activo (retenida)

`def` es la primera categoría que un consumidor debe leer y la única que describe **qué es**
el activo en lugar de qué está haciendo. Se publica **retenida**, una vez por dispositivo, al
arrancar el publicador y cada vez que la definición cambie — nunca al ritmo del proceso.

```json
// topic: greytec/demo/produccion/llenado/coriolis-01/def   (QoS 1, retain=true)
{
  "ts": "2026-09-02T10:00:00.000Z",
  "src": "coriolis-01",
  "rev": 1,
  "contract": "0.4",
  "asset": {
    "display_name": "Caudalímetro Coriolis",
    "type": "instrumento",
    "manufacturer": "Greytec (simulado)",
    "model": "sim-coriolis",
    "serial": "SIM-CORIOLIS-01",
    "area": "Llenado",
    "parent": "plc-llenado-01",
    "protocol": "modbus-tcp"
  },
  "variables": {
    "mass_flow_kgh": {
      "display_name": "Caudal másico",
      "u": "kg/h",
      "type": "number",
      "channel": "dat/raw",
      "min_limit": 0,
      "max_limit": 2000,
      "deadband": 5,
      "source": { "protocol": "modbus-tcp", "fc": 3, "addr": "0-1", "encoding": "float32-be" }
    },
    "drive_gain_pct": {
      "display_name": "Ganancia de excitación",
      "u": "%", "type": "number", "channel": "diag",
      "min_limit": 0, "max_limit": 100, "deadband": 1,
      "source": { "protocol": "modbus-tcp", "fc": 3, "addr": "10-11", "encoding": "float32-be" }
    }
  }
}
```

**Reglas:**

- **`rev`** es un entero monótono que se incrementa en cada cambio de la definición. **No se
  reinicia** al arrancar el publicador, a diferencia de `seq` (§3.4): un consumidor lo usa
  para saber si su copia está al día.
- **`contract`** declara la versión de este documento contra la que se emitió el mensaje.
- **Retención obligatoria.** Un consumidor nuevo obtiene la definición al suscribirse, sin
  pedirla y sin esperar al siguiente ciclo de publicación. Es lo que hace el namespace
  **autodescriptivo**: sin `def`, el nombre de variable del último nivel del topic (§4.1) es
  una etiqueta sin unidad, sin rango y sin procedencia.
- **Correspondencia obligatoria con el flujo.** Toda clave de `variables` debe publicarse en
  el canal que declara su campo `channel`, y toda variable publicada debe estar declarada.
  Una variable que aparece en `dat/raw` sin estar en `def` es un defecto del productor, no
  una extensión válida. Esta regla es verificable con un script.
- **`deadband`** es normativo: es el mismo umbral que aplica el RBE (§3.5). Publicarlo aquí
  evita que el criterio de publicación quede sepultado en la configuración del gateway.
- **Quién publica.** Lo publica **quien conoce el mapeo**, que es el gateway de borde y no el
  dispositivo de campo: el instrumento habla Modbus u OPC UA y no sabe que existe el UNS.
- `def` **no tiene subcategoría** (§5.3): no existen `def/raw` ni `def/der`.
- `source` documenta la procedencia protocolar. Es información de ingeniería sensible en un
  despliegue de cliente: ver §8 sobre qué se entrega.

**Por qué una categoría propia y no un campo más en `sts`.** Ambas son retenidas, pero
cambian a ritmos incomparables: `sts` cambia cada vez que el dispositivo se conecta o
desconecta, mientras que `def` cambia cuando alguien interviene la instalación. Mezclarlas
obligaría a reenviar el diccionario completo de variables en cada latido de estado.

---

### 4.1. `dat/raw` — Datos de proceso (un topic por variable)

Desde v0.3, cada variable tiene su propio topic bajo `dat/raw` y el envelope es **plano** — el nombre de la variable vive únicamente en el último nivel del topic:

```json
// topic: greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh
{
  "ts": "2026-07-03T14:23:00.123Z",
  "src": "coriolis-01",
  "seq": 1042,
  "v": 1250.4,
  "u": "kg/h",
  "q": "good"
}
```

**Reglas:**
- Un mensaje = una variable. El nombre de variable es el último nivel del topic (`snake_case` inglés, §3.1) y **no se repite** en el payload.
- `q` es obligatorio: `bad` si el dispositivo devolvió error; `uncertain` si el valor fue leído pero es sospechoso (fuera de rango, enlace de causalidad caído, medición en dos fases).
- `v` puede ser `number`, `bool`, o `string` según la variable. El tipo es fijo por variable y está documentado en la sección 7.
- Cadencia: Report by Exception (§3.5) — deadband + heartbeat, `retain=true`.
- `seq` por dispositivo, no por variable (§3.4).

> **Transición desde v0.2:** el envelope agrupado (`payload: {var: {v,u,q}}`) queda **deprecado para `dat/raw`**. Los ESP32 (§7.1, §7.2) y el medidor físico (§7.3) lo siguen usando hasta que se migre su firmware/pipeline; los consumidores deben aceptar ambos formatos durante la transición. Todo productor nuevo publica el formato v0.3.

### 4.1.b. `dat/der` — Datos derivados

`dat/der` **mantiene el envelope agrupado** (los procesadores emiten resultados multicampo); se alineará al formato por variable en una versión futura si se necesita. El envelope agrega dos campos:

```json
{
  "ts": "2026-06-05T14:23:05.000Z",
  "src": "ekuiper",
  "derived_from": "esp32-a",
  "transform": "moving_avg_5m",
  "seq": 210,
  "payload": {
    "temp_c_avg5m": { "v": 24.1, "u": "°C", "q": "good" }
  }
}
```

- `derived_from`: el `src` del dispositivo origen.
- `transform`: identificador de la función aplicada. Documentado en el runbook de eKuiper.

### 4.2. `sts` — Estado del dispositivo

```json
{
  "ts": "2026-06-05T14:23:00.000Z",
  "src": "esp32-a",
  "online": true,
  "uptime_s": 3600,
  "fw_ver": "0.3.1",
  "rssi_dbm": -67,
  "batt_pct": 84
}
```

**Reglas:**
- `online`, `uptime_s`, `fw_ver` son obligatorios.
- `rssi_dbm` solo si el dispositivo tiene conectividad inalámbrica.
- `batt_pct` solo si el dispositivo tiene batería (ESP32-B, ESP32-C).
- Publicar con retained=true. Publicar en cada arranque y cada vez que cambie un campo.
- En caso de desconexión limpia, publicar `"online": false` antes de cerrar.

### 4.4. `evt` — Evento discreto

```json
{
  "ts": "2026-06-05T14:26:00.000Z",
  "src": "soft-plc",
  "evt_type": "setpoint_changed",
  "severity": "info",
  "msg": "Setpoint de temperatura cambiado a 25.0°C"
}
```

**Valores de `severity`:** `info` | `warn` | `alarm` | `critical`

**Valores de `evt_type`:** definidos por dispositivo en la sección 7. Siempre en `snake_case`.


### 4.5. `diag` — Diagnóstico NOA

Canal paralelo al lazo de control. Publica información de salud del instrumento **sin interferir con `dat/raw`**.

```json
{
  "ts": "2026-06-05T14:23:00.000Z",
  "src": "esp32-a",
  "diag_type": "sensor_health",
  "payload": {
    "sensor_id": "bme280-0x76",
    "status": "ok",
    "last_error": null,
    "read_failures_since_boot": 0
  }
}
```

### 4.6. Por qué cada categoría tiene su propia forma de payload

Un lector del contrato nota rápido que `dat/raw` parte cada variable en su propio topic con envelope plano, mientras `sts`/`diag`/`evt` agrupan varios campos en un solo mensaje — y que ni `sts` ni `diag` usan el wrapper `{v,u,q}` de `dat/raw`. **Esto no es inconsistencia — es que la forma del payload se deriva de cómo se consume la categoría, no de una plantilla única aplicada a ciegas.** Dos ejes independientes gobiernan la forma:

1. **Granularidad** — ¿el suscriptor típico quiere una variable sola, o el conjunto completo?
2. **Forma del valor** — ¿el campo es una medición de proceso con unidad y calidad que puede degradarse de forma independiente (`{v,u,q}`), o es metadata/estado que solo tiene sentido leído en bloque (plano)?

| Categoría | Granularidad | Forma del valor | Por qué | Se consume como |
|---|---|---|---|---|
| `dat/raw` | 1 topic por variable (v0.3) | `{v,u,q}` | Cada variable es útil de forma **independiente** — un consumidor quiere `mass_flow_kgh` sin arrastrar el resto del dispositivo. RBE (§3.5) reduce tráfico donde el volumen es alto. | Serie temporal por variable |
| `dat/der` | Agrupado | `{v,u,q}` | El procesador emite varios resultados relacionados de un mismo cálculo (§4.1.b); no se benefician de partirse — se generan y consumen juntos. | Serie temporal por resultado derivado |
| `sts` | Agrupado | Plano | El estado de un dispositivo se lee **como bloque** — un HMI no muestra "online" sin el resto de indicadores del mismo widget. Sin distinción raw/der (§5.3): es por definición el estado físico. | Snapshot / widget de estado |
| `diag` | Agrupado (o sub-árbol funcional, §5.3) | Plano | Diagnóstico **holístico**: juzgar la salud de un instrumento requiere ver varias variables a la vez (ej. drive gain + frecuencia de tubo + aire arrastrado del coriolis, §7.1.2). Partirlo fragmentaría un juicio que es conjunto por naturaleza. Cadencia ya baja (heartbeat 60s) — el ahorro de tráfico del RBE por variable no aplica aquí. | Panel de salud / tabla de mantenimiento |
| `evt` | Discreto (1 mensaje = 1 evento) | Plano + `msg` texto | No es una serie temporal, es un **log de eventos**. `evt_type`/`severity` son categóricos y se agregan; `msg` es contexto para un humano, no un dato a graficar — igual que el asunto de un commit. | Tabla / log / anotación |

**Por qué `diag` y `sts` no llevan `q` por campo:** el wrapper `{v,u,q}` existe para valores de **proceso de campo con unidad física que pueden degradarse de forma independiente entre sí** (ej. `mass_flow_kgh` puede ser `uncertain` mientras `fluid_temp_c` sigue `good`). Los campos de `diag`/`sts` no se degradan independientemente — la señal de calidad de todo el bloque vive a nivel de enlace (`plc_link_ok`, `online`), no campo por campo. Añadir `q` a cada campo de `diag` no aportaría información nueva: siempre sería `good` salvo que se modele fallo del canal diagnóstico mismo, que ya se cubre con `status` (§4.5) o `plc_link_ok` (§7.1.2).

**Cómo representar cada categoría en dashboards (Grafana):**

| Categoría | Panel recomendado | Nota |
|---|---|---|
| `dat/raw`, `dat/der` | Time series / Stat | Vía vistas silver (`v_process_readings`) — una serie por `(src, field)`. |
| `sts` | State timeline / Stat con color mapping | `line_state` en particular calza con el panel "State timeline" de Grafana: bandas de color por estado en el tiempo. |
| `diag` | Stat/gauge agrupado por instrumento, o tabla de salud | Se lee el bloque completo por `src`, no campo suelto. |
| `evt` | Table o Logs panel (`ts, src, evt_type, severity, msg`) | Nunca Time series. Opcionalmente como **annotations** superpuestas sobre la gráfica de `dat/raw` del mismo dispositivo (ej. marcar `jam_detected` sobre la curva de `mass_flow_kgh`) — así se ve la causa y el efecto en el mismo panel. |

**Nota para el TFM — dos escuelas de diseño UNS:** Sparkplug B agrupa **todo** el dispositivo en un solo payload (NBIRTH/NDATA), evitando la explosión de topics; el estilo tag-hierarchy clásico (Ignition, ISA-95) publica un topic por variable. Este contrato **no elige una escuela para todo el namespace** — aplica la que corresponde según el patrón de consumo de cada categoría (tabla arriba). Es una decisión de ingeniería explícita, no una inconsistencia accidental.

**Regla de evolución (ver también §11):** todo productor nuevo o categoría nueva que se agregue al contrato debe declarar, en su propia sección de la parte 7, granularidad y forma de valor siguiendo esta tabla — no se asume un formato por defecto.

---

## 5. Regla raw vs. derived

### 5.1. Definición

| Subcategoría | Quién publica | Qué contiene |
|---|---|---|
| `dat/raw` | Solo dispositivos de campo (firmware) | Lectura directa del sensor o registro del PLC, sin transformación |
| `dat/der` | Solo procesadores (eKuiper, FastAPI, pipelines) | Resultado de un cálculo sobre uno o más `raw` |

**Invariante:** ningún procesador publica en `dat/raw`. Ningún dispositivo de campo publica en `dat/der`. Esta regla se puede verificar con ACLs en el broker.

### 5.2. Wildcards habilitados por esta estructura

| Suscripción | Recibe |
|---|---|
| `greytec/demo/#` | Todo el namespace del laboratorio |
| `+/+/+/+/+/def` | La definición de todos los activos — el modelo de datos completo de la instalación |
| `+/+/+/+/+/dat/#` | Todos los datos de proceso, cualquier activo |
| `+/+/+/+/+/dat/raw/#` | Solo datos crudos de todos los activos (todas las variables) |
| `+/+/+/+/+/dat/der` | Solo datos derivados de todos los activos |
| `greytec/demo/produccion/llenado/+/dat/raw/#` | Todo el raw de la celda de llenado |
| `greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh` | Una sola variable de un solo activo — la granularidad que habilita v0.3 |
| `greytec/demo/produccion/llenado/+/dat/raw/energy_kwh` | Una variable en todas las cells de la línea |
| `greytec/demo/campo/instrumentacion/esp32-a/#` | Todo lo del ESP32-A |

### 5.3. Asimetría documentada

`raw` y `der` son subcategorías **únicamente válidas bajo `dat`**. Las demás categorías (`def`, `sts`, `evt`, `diag`) no tienen subdivisión de origen porque semánticamente no la necesitan:

- `sts` es por definición siempre raw — describe el estado físico del dispositivo.
- `evt` y `diag` son categorías con semántica propia que no se benefician de la distinción.

Esta asimetría es deliberada y debe preservarse al extender el contrato.

**Excepción — sub-árbol funcional bajo `diag`:** la regla anterior prohíbe subdividir `diag` por *origen* (no hay `diag/raw` vs `diag/der`). NO prohíbe un sub-árbol **funcional** cuando una sola entidad emite múltiples grupos de diagnóstico independientes. Caso de uso: la salud de un gateway edge, que abarca métricas heterogéneas (CPU, RAM, disco, red, contenedores). En ese caso `diag` se usa como rama y cada grupo cuelga debajo: `…/diag/cpu`, `…/diag/mem`, `…/diag/docker_container_mem`, etc. Cada hoja lleva su propio payload. Esto mantiene el namespace navegable (suscribir a `…/diag/cpu` sin recibir el resto) y se reserva para `diag` de infraestructura (ver §7.2).

---

## 6. Árbol completo del laboratorio

Cada celda publica **`def` primero** (retenido): es lo que permite a un consumidor nuevo
interpretar todo lo demás sin preguntar a nadie.

```
greytec/
  demo/
    produccion/
      llenado/                       ← la celda de llenado (§7.1)
        plc-llenado-01/
          def                        ← [R] identidad + diccionario de 6 variables
          dat/raw/{variable}         ← un topic por variable, RBE (§3.5, §4.1)
          sts                        ← [R] estado, auto_mode, alarm_jam, uptime
          evt                        ← line_state_change, jam_detected, jam_cleared
        valvula-01/
          def                        ← [R] identidad + diccionario de 5 variables
          dat/raw/{variable}
          sts                        ← [R] incluye plc_link_ok, alarm_deviation
          evt                        ← valve_deviation, valve_deviation_cleared
        coriolis-01/
          def                        ← [R] identidad + 5 variables dat/raw + 3 diag
          dat/raw/{variable}
          diag                       ← [NOA] drive_gain, tube_freq, sensor_temp
          sts                        ← [R]
        medidor-02/
          def                        ← [R] identidad + diccionario de 6 variables
          dat/raw/{variable}
          sts                        ← [R] incluye plc_link_ok
    campo/
      edge/                          ← el gateway NO es un sensor: solo publica su salud
        iot2050/
          diag                       ← salud del gateway (edge-health): host + contenedores
    _kpi/                            ← [R] indicadores calculados — no desplegado (§7.3)
      oee
      consumo-total
```

`[R]` = retenido (§3.2). `[NOA]` = canal de diagnóstico paralelo al lazo de control (§4.5).

**Nota — la línea `edge/`.** Agrupa los gateways, que no son sensores sino el equipo que
*publica*. El edge lee los dispositivos que tiene por debajo (Modbus TCP, OPC UA), normaliza
y publica el `dat/raw` de cada uno; por eso los datos de proceso aparecen bajo el `cell` que
los origina, aunque sea el edge quien físicamente los publique. Lo único propio del gateway
es su `diag`.

**Nota — `def` del gateway.** `iot2050` publica su `def` como cualquier otro activo, pero no
desde un fichero estático: sus métricas por contenedor dependen de qué contenedores corren, así
que **deriva la definición del propio payload que acaba de medir**. Por construcción no puede
divergir del flujo —si una variable se publica, está declarada, porque ambas salen del mismo
diccionario— y si el conjunto de campos cambia, se republica el `def` con `rev` incrementado.

## 7. Payloads por dispositivo

> **Status de esta sección:** PARCIAL — se completa en Semana 2 cuando el hardware esté en mano y el firmware probado. Los campos marcados con `[TBD]` se confirman con la hoja de datos del sensor y las pruebas de integración.
>
> **Transición v0.3:** §7.1-§7.3 (ESP32 y medidor físico) aún documentan el envelope agrupado v0.2 — válido hasta migrar su firmware/pipeline (§4.1). La celda de llenado (§7.1) ya publica el formato v0.3 por variable.

### 7.1. Celda de llenado F&B — simuladores (Brix)

> Reemplaza al OpenPLC (`soft-plc`, retirado en v0.3). Cuatro dispositivos simulados en `core/compose/simuladores/` con causalidad real entre ellos: el PLC comanda la válvula, la válvula determina el caudal del coriolis, el estado de línea determina el consumo del medidor. Mapas de registros/nodos completos y guía de integración: `core/compose/simuladores/README.md`.

**Topic base:** `greytec/demo/produccion/llenado/{cell}/…`  
**Adquisición:** Node-RED (edge) por dispositivo — poll cíclico 1-2 s, publicación RBE (§3.5), envelope plano (§4.1).  
**Calidad:** cada dispositivo señaliza la pérdida del enlace de causalidad con el PLC (status word / `PlcLinkOk`) → el edge publica `q: "uncertain"`.

#### 7.4.1. `plc-llenado-01` — PLC de celda (OPC UA :4840)

Máquina de estados de la línea: `0=STOPPED, 1=STARTING, 2=RUNNING, 3=FAULT`. De `line_state` + contadores se derivan **disponibilidad y calidad (OEE)** aguas abajo (regla anti-dilución: el KPI vive en `gold.sql`).

| Variable (`dat/raw/…`) | Tipo | Unidad | Deadband | Origen OPC UA (`ns=2;s=…`) |
|---|---|---|---|---|
| `line_state` | int | — | cualquier cambio | `Llenadora.State` |
| `speed_bpm` | number | bpm | 0.5 | `Llenadora.SpeedBpm` |
| `target_flow_kgh` | number | kg/h | 5 | `Llenadora.TargetFlowKgh` |
| `valve_cmd_pct` | number | % | 0.5 | `Llenadora.ValveCmdPct` |
| `good_count` | int | cnt | cualquier cambio | `Llenadora.GoodCount` (UInt32) |
| `bad_count` | int | cnt | cualquier cambio | `Llenadora.BadCount` (UInt32) |

**`sts`** (retained): `{ts, src, online, fw_ver: "sim-0.1.0", state_text, auto_mode, alarm_jam, uptime_s}`

**Eventos (`evt`)** — los deriva el edge de las transiciones:

| `evt_type` | `severity` | Condición |
|---|---|---|
| `line_state_change` | `info` | Cualquier transición de `line_state` |
| `jam_detected` | `alarm` | Entrada a FAULT (`AlarmJam` true) |
| `jam_cleared` | `info` | Salida de FAULT |

**Sin canal de mando.** El controlador simulado expone nodos escribibles `ns=2;s=Cmd.*` (`AutoMode`, `Start`, `Stop`, `TargetFlowKgh`), pero **este contrato no define ninguna categoría de mando**: la plataforma es de solo lectura sobre el proceso. La consecuencia es que el flujo es unidireccional de campo a consumo sin una sola excepción, lo que simplifica la segmentación de red. Habilitarlo es una extensión natural —exigiría identificador idempotente, emisor identificado y evento de respuesta que lo referencie— y queda como línea de continuación.

#### 7.4.2. `coriolis-01` — Caudalímetro Coriolis (Modbus TCP :5020, FC3)

Floats 32-bit big-endian (palabra alta primero), direcciones zero-based.

| Variable (`dat/raw/…`) | Tipo | Unidad | Deadband | Origen (FC3 addr) |
|---|---|---|---|---|
| `mass_flow_kgh` | number | kg/h | 5 | 0-1 |
| `volume_flow_lph` | number | L/h | 5 | 2-3 |
| `density_kgm3` | number | kg/m³ | 0.5 | 4-5 |
| `fluid_temp_c` | number | °C | 0.1 | 6-7 |
| `total_mass_kg` | number | kg | 1 | 8-9 (acumulador, no se resetea) |

**`diag`** (NOA, §4.5) — canal de salud paralelo al lazo de control; agrupado, RBE con heartbeat 60 s:

```json
{
  "ts": "2026-07-03T14:23:00.000Z",
  "src": "coriolis-01",
  "diag_type": "transmitter_health",
  "payload": {
    "drive_gain_pct": 8.2,
    "tube_freq_hz": 146.99,
    "sensor_temp_c": 19.8,
    "air_entrainment": false,
    "plc_link_ok": true
  }
}
```

**Deadbands del `diag`** — el objeto se publica **entero** si CUALQUIER campo dispara:

| Campo | Deadband | Nota |
|---|---|---|
| `drive_gain_pct` | **1** | ruido medido ≈1.6; el evento real (aire arrastrado) salta a 40-90%, así que 3 lo captura intacto |
| `tube_freq_hz` | 0.05 | ruido medido ≈0.013 ✓ |
| `sensor_temp_c` | 0.2 | ruido medido ≈0.064 ✓ |
| `air_entrainment`, `plc_link_ok` | cualquier cambio | booleanos |

> **`drive_gain_pct` revisado en v0.3.1** (1→3). Con deadband 1 quedaba bajo su propio ruido
> (≈1.6) y disparaba constantemente — y como el `diag` publica el objeto completo, arrastraba
> a los otros dos campos: 411 k mensajes, **26× su piso de heartbeat**. Era el tópico más
> ruidoso de todo el sistema, siendo un canal de *diagnóstico*.

Origen: FC3 addr 10-15 (drive gain, frec. de tubo, temp. sensor) + status word addr 16 (bit0=enlace PLC, bit1=aire arrastrado, bit2=fallo sensor). El drive gain normal ronda 8%; con aire arrastrado sube a 40-90% y la densidad cae — insight de mantenimiento predictivo. Con bit1 activo, `mass_flow_kgh` y `density_kgm3` se publican con `q: "uncertain"`.

**`sts`** (retained): `{ts, src, online, fw_ver: "sim-0.1.0"}`

#### 7.4.3. `valvula-01` — Válvula de control con posicionador (OPC UA :4841)

| Variable (`dat/raw/…`) | Tipo | Unidad | Deadband | Origen OPC UA (`ns=2;s=…`) |
|---|---|---|---|---|
| `setpoint_pct` | number | % | 0.5 | `Valvula.SetpointPct` |
| `position_pct` | number | % | 0.5 | `Valvula.PositionPct` |
| `travel_total_m` | number | m | 0.01 | `Valvula.TravelTotalM` (salud del posicionador) |
| `cycle_count` | int | cnt | cualquier cambio | `Valvula.CycleCount` (UInt32) |
| `air_supply_bar` | number | bar | 0.05 | `Valvula.AirSupplyBar` |

**`sts`** (retained): `{ts, src, online, fw_ver: "sim-0.1.0", plc_link_ok, alarm_deviation}`

**Eventos (`evt`):** `valve_deviation` (`alarm`) cuando `AlarmDeviation` pasa a true (|posición − setpoint| > 5% sostenido > 10 s); `valve_deviation_cleared` (`info`) cuando vuelve a false.

#### 7.4.4. `medidor-02` — Medidor de energía de la celda (Modbus TCP :5021, FC4)

Estilo Eastron SDM: floats 32-bit BE en input registers. (El `medidor-01` de §7.3 sigue reservado para el medidor físico Modbus RTU.)

| Variable (`dat/raw/…`) | Tipo | Unidad | Deadband | Origen (FC4 addr) |
|---|---|---|---|---|
| `voltage_v` | number | V | 1 | 0-1 |
| `current_a` | number | A | 0.05 | 2-3 |
| `active_power_w` | number | W | 25 | 4-5 |
| `power_factor` | number | — | 0.01 | 6-7 |
| `frequency_hz` | number | Hz | 0.02 | 8-9 |
| `energy_kwh` | number | kWh | 0.01 | 10-11 (acumulador, no se resetea) |

> **Deadbands revisados en v0.3.1** (`current_a` 0.05→0.3, `power_factor` 0.01→0.05,
> `frequency_hz` 0.02→0.1). Los originales quedaban **por debajo del ruido** de la señal,
> así que el RBE disparaba en cada poll y degeneraba en publicación periódica: `current_a`
> publicaba 13× más que `voltage_v` — mismo dispositivo, mismo ciclo, misma cadencia —
> sin aportar información. Ver la regla de dimensionamiento en §3.5.

Status word addr 12 (bit0=enlace PLC): sin enlace, el medidor reporta consumo de standby — plausible pero sin contexto de línea → `q: "uncertain"`.

**`sts`** (retained): `{ts, src, online, fw_ver: "sim-0.1.0", plc_link_ok}`

### 7.2. Edge IOT2050 — Salud del gateway (`diag`)

**Topic base:** `greytec/demo/campo/edge/iot2050/diag/{métrica}`
**Frecuencia:** cada 10 s
**Origen:** Telegraf (host + contenedores) → NanoMQ local → bridge → EMQX central

`diag` se usa como **rama** (sub-árbol funcional, §5.3): un topic por métrica, cada uno con su payload. Así un consumidor puede suscribirse solo a `…/diag/cpu` o `…/diag/docker_container_mem`.

| Topic | Contenido |
|---|---|
| `…/diag/cpu` | uso de CPU del host |
| `…/diag/mem` | RAM del host |
| `…/diag/disk` | disco del host (un mensaje por partición) |
| `…/diag/system` | load average + uptime |
| `…/diag/temp` | temperatura de sensores |
| `…/diag/net` | red del host (por interfaz) |
| `…/diag/docker` | resumen del daemon |
| `…/diag/docker_container_cpu` | CPU por contenedor |
| `…/diag/docker_container_mem` | RAM por contenedor |
| `…/diag/docker_container_net` / `…_blkio` | red / disco I/O por contenedor |

El payload es el **formato nativo de Telegraf** (no el envelope `diag` de §4.5): es una excepción deliberada para salud de infraestructura. Equivalencia: `timestamp`↔`ts`, `tags.src`↔`src`, `name`↔tipo de métrica, `fields`↔`payload`.

```json
// topic: greytec/demo/campo/edge/iot2050/diag/cpu
{
  "name": "cpu",
  "tags": { "src": "iot2050", "host": "iot2050", "cpu": "cpu-total" },
  "fields": { "usage_idle": 95.2, "usage_user": 3.1, "usage_system": 1.7 },
  "timestamp": "2026-06-25T14:23:00.000Z"
}
```

> Si en el futuro se requiere que el edge cumpla el envelope `diag` estricto de §4.5, se añade un processor Starlark a Telegraf que renombre los campos. Por ahora se prioriza simplicidad y navegabilidad.

### 7.3. `_kpi` — KPIs calculados (productor: `idp-writeback`)

> **No desplegado en el TFM.** El servicio `kpi-writeback` queda fuera del alcance de este
> repositorio (ver `docs/arquitectura/alcance.md`). Los indicadores existen igualmente como
> vistas de la capa oro y los consume la API; lo que no ocurre es su republicación al UNS.
> El apartado se conserva porque especifica el patrón consumidor-productor del §10.3 y es
> la línea futura natural del trabajo.

> **Declaración de granularidad y forma exigida por §11.** Este es el primer productor
> del namespace reservado `_` (§2.3), y el único que **no lee de un dispositivo sino del
> historiador**: cierra el lazo devolviendo al UNS la inteligencia calculada en `gold.sql`.

**Topic:** `{enterprise}/{site}/{area}/{line}/_kpi/{name}`
**Ejemplo:** `greytec/demo/produccion/llenado/_kpi/oee`
**Productor:** servicio `kpi-writeback` (`core/compose/central/services/idp-api/`, entry point `app/writeback.py`)
**Registro:** tabla `kpi_catalog` (contrato API §4) — una fila por KPI define vista, tópico, origen y unidades.

#### Nivel del topic: línea, no sitio

Un KPI pertenece al **activo que lo genera**, no a la planta. El OEE es *de una línea*; con
dos líneas hay dos OEE que se analizan por separado y se comparan entre sí. Anclarlo al nivel
de línea (`…/produccion/llenado/_kpi/oee`) permite que la línea 2 publique el suyo
(`…/produccion/linea2/_kpi/oee`) sin colisión. Un KPI genuinamente de planta (ej. consumo
total) sí vive a nivel sitio (`greytec/demo/_kpi/consumo-total`) — el nivel lo decide el
alcance del indicador, y el catálogo lo declara por fila.

#### Granularidad y forma (§4.6)

| Eje | Decisión | Por qué |
|---|---|---|
| **Granularidad** | **Agrupado** — 1 topic por KPI, todos sus campos en un mensaje | Los componentes son la **descomposición de un solo número**: `oee = disponibilidad × calidad × performance`. Publicar `oee_pct` suelto es inútil — ante un 74% la pregunta inmediata es "¿por qué?", y la respuesta son los componentes. Se generan del mismo cálculo y se consumen juntos (mismo criterio que `dat/der`). |
| **Forma del valor** | **`{v,u,q}`** | Los campos **sí se degradan independientemente**: con la línea parada toda la hora, `availability_pct` = 0.0 (válido) mientras `quality_pct` y `performance_pct` son NULL (división por cero). Cada campo necesita su propia `q`. |

#### `q` — el estado del cálculo, no del sensor

| Situación | `q` |
|---|---|
| Cubeta horaria **cerrada** | `good` — dato final |
| Cubeta **en curso** (`is_partial`) | `uncertain` — real pero provisional, aún cambiará |
| Campo NULL (sin datos, división por cero) | `bad` |

`is_partial` (columna de `v_oee_hourly`) **no se publica como campo**: se traduce a `q`. Así el
SCADA pinta en gris la hora en curso mirando solo la calidad, sin lógica de negocio propia.

#### Envelope — esquema `dat/der` (§4.1.b)

```json
// topic: greytec/demo/produccion/llenado/_kpi/oee   (QoS 1, retain=true)
{
  "ts": "2026-07-16T16:23:00.000Z",
  "src": "idp-writeback",
  "derived_from": "plc-llenado-01",
  "transform": "v_oee_hourly",
  "seq": 42,
  "bucket": "2026-07-16T11:00:00-05:00",
  "payload": {
    "availability_pct": { "v": 83.7, "u": "%", "q": "good" },
    "quality_pct":      { "v": 97.8, "u": "%", "q": "good" },
    "performance_pct":  { "v": 90.8, "u": "%", "q": "good" },
    "oee_pct":          { "v": 74.3, "u": "%", "q": "uncertain" }
  }
}
```

- `derived_from` — el `src` origen del catálogo. Varios orígenes van separados por coma
  (`"medidor-02,plc-llenado-01"` para intensidad energética).
- `transform` — la vista gold que lo calcula. Es la trazabilidad: del mensaje se llega a la lógica.
- `bucket` — **extensión propia de `_kpi`**: la ventana temporal a la que se refiere el valor.
  `ts` es cuándo se publicó (para frescura, §3.5); `bucket` es a qué hora pertenece. Un KPI
  agregado necesita ambos; un `dat/der` puntual no.
- `payload` — solo los campos declarados en `kpi_catalog.units`. Las columnas internas de la
  vista (ej. `muestras`) no salen al namespace.

#### Cadencia

RBE (§3.5) como cualquier productor del UNS: se recalcula cada **30 s** y se publica solo si
algún campo cambió; **heartbeat 60 s**; `retain=true`. Los KPIs vienen redondeados a 1 decimal,
así que en régimen estable el tráfico es mínimo.

> **Retirar un KPI:** poner `publish=false` en el catálogo no basta — el broker conservaría el
> último retained y el SCADA lo vería congelado para siempre. El write-back publica un
> **retained vacío** al topic para borrarlo del broker antes de dejar de publicarlo.

---

## 8. Extensión a cliente real

Al desplegar Greytec IDP en un cliente, **la estructura del contrato no cambia**. Solo cambia la configuración de tenant en `tenants/{cliente}/uns-mapping.md`:

```yaml
# tenants/atmos/uns-mapping.md
enterprise: atmos
site: planta-guayaquil
areas:
  - id: linea-1
    lines:
      - id: compresor
        cells:
          - id: compresor-01
            type: plc-siemens-s7
            topics:
              dat_raw: atmos/planta-guayaquil/linea-1/compresor/compresor-01/dat/raw
              sts:     atmos/planta-guayaquil/linea-1/compresor/compresor-01/sts
```

**Lo que Greytec entrega al cliente:** el árbol de topics documentado para su instalación (equivalente a la sección 6 de este documento, con sus datos reales). Los schemas de envelope (sección 4) son IP de Greytec y no se entregan — el cliente recibe solo los topics y los nombres de variables.

**Lo que nunca cambia entre deployments:**
- La estructura canónica `{enterprise}/{site}/{area}/{line}/{cell}/{category}`
- Los schemas de envelope (sección 4)
- La regla raw/derived (sección 5)
- Las convenciones globales (sección 3)

---

## 10. Clasificación de consumidores

El UNS define **dos clases de consumidor** según su patrón de acceso al dato, más una clase especial de consumidor que también produce:

### 10.1. Consumidor operacional (RT)

Se conecta directamente al broker **EMQX**. Accede al estado actual de los activos.

| Propiedad | Valor |
|---|---|
| Latencia | < 100 ms |
| Protocolo | MQTT suscripción directa |
| Datos | Estado presente — sin historia |
| Patrón | Reacciona a un **evento individual** |

**Ejemplos:** SCADA, HMI, sistema de gestión de energía (EMS), Senseye, cualquier sistema con conector MQTT nativo que opere en tiempo real.

**Regla de integración:** suscribir a los topics documentados en §6 usando los wildcards de §5.2. No requiere credenciales de base de datos.

### 10.2. Consumidor analítico

Se conecta a las **vistas derivadas de TimescaleDB** (silver o gold). Accede al histórico interpretado de los activos.

| Propiedad | Valor |
|---|---|
| Latencia | Segundos a minutos |
| Protocolo | PostgreSQL (SQL) |
| Datos | Historia completa + contexto semántico (`asset_tags`) |
| Patrón | Detecta un **patrón sobre muchos eventos en el tiempo** |

**Ejemplos:** Grafana, APIs REST (FastAPI), modelos de ML en training, integraciones ERP/CMMS.

**Regla de integración:** conectarse a las vistas silver (`v_process_readings`, `v_device_signals`) para datos con contexto, o a las vistas gold (`v_production_hourly`, `v_conveyor_availability_hourly`, etc.) para KPIs de negocio.

**Regla anti-dilución:** **ningún consumidor calcula KPIs por su cuenta**. Si el KPI no existe en `gold.sql`, se añade ahí y todos lo usan. La lógica de negocio vive en el modelo, no en los aplicativos.

### 10.3. Consumidor-productor (edge compute)

Consume del UNS y **republica de vuelta** al UNS con dato derivado o enriquecido. No es un consumidor terminal — es parte del pipeline de procesamiento.

| Propiedad | Valor |
|---|---|
| Latencia | < 1 s |
| Protocolo | MQTT entrada + MQTT salida |
| Datos | Consume `dat/raw`, produce `dat/der` o `evt` |
| Patrón | Transforma o evalúa en tiempo real |

**Ejemplos:** eKuiper (reglas de alarma, medias móviles), modelos de ML en edge (detección de anomalías en tiempo real).

**Regla:** sus publicaciones siempre van bajo `dat/der` o `evt` (§5.1). Nunca publican bajo `dat/raw`.

### 10.4. Regla de decisión

> ¿El consumidor necesita reaccionar a un evento individual, o necesita detectar un patrón sobre muchos eventos en el tiempo?

- **Evento individual → tiempo real → EMQX** (consumidor operacional)
- **Patrón sobre el tiempo → histórico → TimescaleDB** (consumidor analítico)
- **Transforma y republica → EMQX entrada/salida** (consumidor-productor)

---

## 11. Reglas de evolución del contrato

> **Regla 0 (v0.4) — la definición manda.** Añadir, renombrar o retirar una variable obliga a
> publicar una nueva revisión de `def` con `rev` incrementado, **en el mismo despliegue** en
> que cambia el flujo. Una variable presente en `dat/raw` y ausente de `def` es un defecto
> del productor; una variable declarada en `def` que nunca se publica es una definición
> muerta. Ambas son verificables automáticamente comparando el árbol retenido de `def` con
> el de `dat/raw`.


1. **Agregar un campo a `payload`** es backward-compatible. Los consumidores existentes ignoran campos nuevos.
2. **Renombrar o eliminar un campo** es un breaking change. Requiere versionar el contrato (`uns-v0.2.md`) y un período de transición con ambos campos publicados.
3. **Agregar un dispositivo nuevo** no requiere cambiar el contrato — solo agregar su sección en la parte 7 y documentar su rama en el árbol de la sección 6. Esa sección debe declarar explícitamente granularidad y forma de valor según la tabla de §4.6 — no se asume un formato por defecto.
4. **Cambiar QoS o retained** de una categoría existente es un breaking change para los consumidores con Durable Subscription. Requiere ADR.
5. **Cambiar el schema de envelope** (sección 4) es un breaking change mayor. Requiere nueva versión mayor del contrato y migración coordinada de todos los producers y consumers.
6. **Agregar una categoría nueva** (distinta de `dat/raw`, `dat/der`, `sts`, `evt`, `diag`) requiere justificar su granularidad y forma de valor en una subsección de §4.6, siguiendo el mismo criterio: la forma se deriva del patrón de consumo, no de copiar la de otra categoría por comodidad.

---

## 12. Historial de versiones

| Versión | Fecha | Cambios |
|---|---|---|
| **0.5** | **2026-09-03** | Se **retira la categoría `cmd`**: la plataforma es de solo lectura sobre el proceso y no define ningún flujo descendente. Con ello el contrato queda en seis categorías (`def`, `dat`, `sts`, `evt`, `diag`) y la direccionalidad campo→consumo pasa a ser absoluta, sin excepciones, lo que simplifica la matriz de conductos de red. Habilitar el mando queda como línea de continuación. |
| **0.4** | **2026-09-02** | **Edición TFM.** Nueva categoría `def` (§4.0): definición del activo retenida, con identidad, diccionario de variables, límites, deadband normativo y procedencia protocolar. Campo `rev` frente a `seq`. Regla 0 de evolución (correspondencia `def` ↔ flujo). Se retiran del contrato los dispositivos fuera del alcance del TFM (ESP32-A, ESP32-B y medidor Modbus RTU físico) y se renumera §7. `_kpi` se marca como no desplegado. |
| 0.1 | 2026-06-05 | Versión inicial. Jerarquía, convenciones, envelopes, árbol del laboratorio. Sección 7 parcial. |
| 0.1.1 | 2026-06-25 | Línea `campo/edge/` para gateways edge (IOT2050 como cell). `diag` como **sub-árbol funcional por métrica** (`diag/cpu`, `diag/mem`, …) — excepción documentada en §5.3. §7.2: salud del edge por Telegraf (formato nativo/line protocol). Nota del rol del edge frente a los PLCs. |
| 0.1.2 | 2026-06-25 | §7.1: payload de `soft-plc/dat/raw` completo (24 variables de la celda de mezcla + conveyor vía Modbus TCP). Tabla de origen Modbus por variable. |
| 0.1.3 | 2026-06-25 | §7.1: adquisición dual — OPC UA (tanque + proceso, `ns=2;i=1..16`) + Modbus TCP (conveyor). Split `dat/raw` (mediciones) / `sts` (estado retenido, campos planos). Tabla de origen por protocolo. |
| 0.2 | 2026-06-30 | §10: clasificación de consumidores (operacional RT → EMQX; analítico → TimescaleDB; consumidor-productor → EMQX in/out). Regla anti-dilución de KPIs. §7.1: `parts_total`/`parts_rejected` corregidos a DINT 32-bit (`%QD11/%QD12`) para eliminar overflow a las ~4.5h de operación continua. |
| **0.3** | 2026-07-03 | **Cambio mayor.** `dat/raw` pasa a **un topic por variable** con envelope plano `{ts, src, seq, v, u, q}` (§4.1) y **Report by Exception** (§3.5: deadband + heartbeat 30 s + retained=true). `seq` por dispositivo a través de sus variables (§3.4). OpenPLC (`control/soft-plc`) retirado; lo reemplaza la celda de llenado F&B simulada bajo `produccion/llenado/` — 4 dispositivos con causalidad real: `plc-llenado-01` (OPC UA), `coriolis-01` (Modbus TCP, con `diag` NOA), `valvula-01` (OPC UA), `medidor-02` (Modbus TCP) (§6, §7.1, `core/compose/simuladores/`). Envelope agrupado deprecado para `dat/raw` (transición: ESP32/medidor físico); `dat/der` lo conserva. |
| 0.3.2 | 2026-07-16 | **Deadbands afinados con datos medidos.** §3.5.1 nuevo: regla de dimensionamiento del deadband (debe superar el ruido y quedar bajo el cambio que importa; si queda bajo el ruido, el RBE degenera en publicación periódica) + query SQL de verificación + la excepción de los acumuladores (publican cada cambio a propósito: el deadband del edge lo dicta el consumidor operacional §10.1, no el historiador — el volumen se resuelve con políticas de TimescaleDB). §7.1.4: `current_a` 0.05→0.3, `power_factor` 0.01→0.05, `frequency_hz` 0.02→0.1 (todos quedaban bajo su ruido: `current_a` publicaba 13× más que `voltage_v` en el mismo dispositivo sin aportar información). §7.1.2: deadbands del `diag` **documentados por primera vez** (solo vivían en el código del flow) y `drive_gain_pct` 1→3 — con db 1 quedaba bajo su ruido (≈1.6) y, como el `diag` publica el objeto entero, arrastraba a los demás: 411 k mensajes, 26× su piso. `good_count`/`total_mass_kg`/`energy_kwh` **sin cambios** (deliberado). |
| 0.3.1 | 2026-07-03 | §4.6 nuevo: justificación explícita de por qué cada categoría tiene su propia granularidad (por variable vs. agrupada) y forma de valor (`{v,u,q}` vs. plana) — resuelve la aparente inconsistencia entre `dat/raw` (partido, v0.3) y `sts`/`diag`/`evt` (agrupados, planos desde v0.1). Incluye tabla de representación en dashboards por categoría (`evt`→tabla/log/annotation, nunca time series) y referencia a las dos escuelas de diseño UNS (Sparkplug B vs. tag-hierarchy ISA-95). §11: nueva regla de evolución — toda categoría/dispositivo nuevo debe declarar su granularidad y forma siguiendo §4.6, no asumir un formato por defecto. |

---

*Este documento es IP interna de Greytec S.A.S. Las secciones 2, 3, 4 y 5 pueden compartirse con integradores externos bajo acuerdo de confidencialidad. Las secciones 6, 7 y 8 son confidenciales.*
