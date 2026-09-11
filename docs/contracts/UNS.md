# Contrato del Unified Namespace — versión 0.5

| | |
|---|---|
| **Documento** | Contrato de datos del Unified Namespace de Greytec IDP |
| **Versión** | 0.5 |
| **Autor** | José Fernando Desiderio Moreira |
| **Alcance** | Laboratorio `greytec/demo` del TFM: celda de llenado de cuatro dispositivos más la pasarela de borde |
| **Estado** | Vigente |

---

## 1. Qué es este documento

Es el modelo canónico de datos del UNS: define **qué se publica, dónde, con qué forma y bajo qué reglas**, de manera que cualquier productor y cualquier consumidor puedan integrarse sin coordinarse entre sí.

El principio que lo gobierna es que **el UNS es la única fuente de verdad**. Ninguna aplicación lee datos de otra aplicación ni de una base de datos compartida: todo cambio de estado se publica como mensaje al UNS, y la base de datos de series temporales es una vista derivada de ese flujo, no una fuente primaria.

Conviene decir también qué no es este documento, porque ahí es donde suelen perderse los contratos de datos:

- No describe cómo se despliega el bróker ni con qué parámetros; eso vive en `deploy/`.
- No define políticas de retención ni de compresión en la base de datos; eso vive en `deploy/3-central/sql/`.
- No documenta la API HTTP; para eso está su especificación OpenAPI.

Si algo de lo anterior cambia, este documento no cambia. Si cambia algo de este documento, cambian todos los que lo leen — por eso el apartado 9 fija cómo hacerlo sin romper nada.

---

## 2. La jerarquía de tópicos

### 2.1 Estructura canónica

```
{empresa}/{emplazamiento}/{área}/{línea}/{celda}/{categoría}[/{subcategoría}]
```

| Nivel | Qué identifica | En el laboratorio |
|---|---|---|
| `empresa` | Organización | `greytec` |
| `emplazamiento` | Planta o instalación | `demo` |
| `área` | Zona funcional de la planta | `produccion`, `campo` |
| `línea` | Línea o subsistema del área | `llenado`, `edge` |
| `celda` | Activo individual | `coriolis-01`, `iot2050` |
| `categoría` | Clase de mensaje | `def`, `dat`, `sts`, `evt`, `diag` |
| `subcategoría` | Origen del dato, solo bajo `dat` | `raw`, `der` |

Los cuatro primeros niveles dicen **dónde está** el activo, con el vocabulario que el personal de planta ya usa. El quinto dice **cuál** es y el sexto, **qué clase de mensaje** llega. Esa separación entre ubicación y clase es la que permite suscribirse con significado de negocio en lugar de por nombre de equipo.

### 2.2 Niveles que se pueden omitir

No toda instalación necesita los seis niveles. `línea` puede omitirse si `área` ya identifica al activo sin ambigüedad. Lo que nunca se omite es `empresa`, `emplazamiento` y `celda`, de modo que la estructura mínima válida es:

```
{empresa}/{emplazamiento}/{celda}/{categoría}
```

### 2.3 El prefijo `_` reservado

Un nivel que empieza por `_` está reservado para datos calculados que no pertenecen a ningún dispositivo físico:

```
greytec/demo/produccion/llenado/_kpi/oee
greytec/demo/_kpi/consumo-total
```

Ningún dispositivo de campo publica bajo `_`. Solo lo hacen procesadores y servicios de la plataforma.

---

## 3. Convenciones comunes

### 3.1 Codificación y formato

| Propiedad | Valor | Por qué |
|---|---|---|
| Codificación | JSON en UTF-8 | Legible e inspeccionable con cualquier cliente MQTT genérico, que es lo que abarata la depuración |
| Marca de tiempo | ISO 8601 en UTC con milisegundos (`2026-09-03T21:46:34.180Z`) | Nunca epoch plano: el tiempo tiene que poder leerse sin herramienta |
| Nombres de campo | `snake_case` en inglés | Una sola convención entre la adquisición, el registro y la base de datos |
| Unidad en el nombre | Sí, cuando hay ambigüedad | `fluid_temp_c`, no `temp`; `mass_flow_kgh`, no `flow` |
| Valores nulos | Campo ausente, nunca `null` | Reduce el tamaño del mensaje y evita ambigüedad con el cero |

### 3.2 Calidad de servicio y retención

| Categoría | QoS | Retenido | Por qué |
|---|---|---|---|
| `def` | 1 | **Sí** | Todo suscriptor nuevo debe recibir la definición antes que cualquier valor |
| `dat/raw` | 1 | **Sí** | Con publicación por excepción, el retenido es lo que da el estado completo al conectarse |
| `dat/der` | 1 | No | Sale de un cálculo continuo; el último resultado no representa el presente |
| `sts` | 1 | **Sí** | El último estado conocido siempre tiene que poder consultarse |
| `evt` | 1 | No | Un evento pasado no representa el presente |
| `diag` | 1 | No | Canal paralelo; no debe interferir con el flujo principal |

Todas las categorías usan calidad de servicio 1 y no 2. La garantía de entrega exactamente una vez sale más barata con **receptores idempotentes** que con el protocolo: la terna `(ts, src, seq)` es clave natural, así que un duplicado se resuelve en la escritura y no en el transporte.

### 3.3 Identificador del dispositivo

El nivel `celda` del tópico y el campo `src` del mensaje **son idénticos**. `src` es el identificador canónico del activo en todo el sistema: el mismo que aparece en la base de datos, en los ficheros de despliegue y en el inventario de hardware.

Formato: `{tipo}-{número}` en minúsculas y con guion. Por ejemplo `coriolis-01`, `medidor-02`.

### 3.4 Número de secuencia

Todo mensaje de las categorías `dat` y `diag` lleva `seq`: un entero monótono que se reinicia a cero en cada arranque del publicador. Sirve para dos cosas: detectar mensajes perdidos y descartar duplicados.

**`seq` es por dispositivo, no por variable.** Un solo contador avanza con cada mensaje que publica ese `src`, a través de todas sus variables. Tiene dos consecuencias que conviene tener presentes:

- Quien se suscriba a una sola variable verá saltos en la secuencia. Son normales: los consumen las demás variables del mismo dispositivo. La detección de huecos se hace a nivel de dispositivo, suscribiéndose a `…/{celda}/dat/raw/#`.
- La clave `(ts, src, seq)` sigue siendo única, porque dos variables publicadas en el mismo instante nunca comparten número.

La categoría `def` no lleva `seq` sino `rev`, porque no es un flujo de muestras sino una definición con revisiones.

### 3.5 Publicación por excepción

`dat/raw` **no publica con cadencia fija: publica cuando el valor cambia**. Las reglas son cuatro:

| Regla | Qué significa |
|---|---|
| **Banda muerta** | Se publica cuando \|valor − último publicado\| supera la banda muerta declarada para esa variable. Booleanos, enteros de estado y contadores publican con cualquier cambio, es decir, banda muerta cero |
| **Cambio de calidad** | Un cambio en `q` publica siempre, aunque el valor no se haya movido |
| **Latido** | Si pasan **30 s** sin publicar una variable, se republica el último valor con marca de tiempo nueva. Es lo que distingue «sin cambios» de «productor muerto». En `diag` el latido es de 60 s |
| **Frescura** | Un consumidor debe tratar como sospechoso todo valor cuya edad supere el doble del latido |

El sondeo de la pasarela hacia el dispositivo sigue siendo cíclico, cada uno o dos segundos. La publicación por excepción reduce **lo publicado**, no lo leído.

### 3.6 Cómo se elige una banda muerta

La banda muerta tiene que ser **mayor que el ruido de la señal y menor que el cambio que importa**. Si queda por debajo del ruido, la publicación por excepción degenera en publicación periódica al ritmo del sondeo: deja de filtrar y solo añade complejidad.

No se elige a ojo. Se mide sobre el histórico ya materializado:

```sql
-- Cambio real entre muestras consecutivas de un dispositivo, última hora
SELECT field,
       count(*) AS muestras_hora,
       round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY abs(delta))::numeric, 4) AS ruido_mediano,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY abs(delta))::numeric, 4) AS cambio_p95
FROM  (SELECT field, value - lag(value) OVER (PARTITION BY field ORDER BY ts) AS delta
       FROM   v_process_readings
       WHERE  src = '<dispositivo>' AND ts > now() - interval '1 hour') d
WHERE delta IS NOT NULL
GROUP BY field;
```

Y se lee así:

| Lo que sale | Lo que significa |
|---|---|
| `muestras_hora` ≈ 120, es decir 3600/30 | La banda muerta filtra bien: la variable solo late |
| `muestras_hora` muy por encima de 120 y banda muerta menor que `ruido_mediano` | Banda muerta demasiado apretada: se está publicando ruido |
| Banda muerta entre `ruido_mediano` y `cambio_p95` | Punto correcto: filtra el ruido y deja pasar el evento |

**Los acumuladores son la excepción deliberada.** `good_count`, `total_mass_kg`, `energy_kwh` y `travel_total_m` publican con cada cambio a propósito, porque cada incremento es un evento real que un consumidor operacional necesita en vivo. El volumen que generan es problema del historiador y se resuelve con compresión, retención y agregados continuos en la base de datos, nunca subiendo la banda muerta del borde: eso degradaría el UNS en tiempo real para arreglar algo que no está ahí.

---

## 4. Los envelopes, categoría por categoría

Los tres campos comunes a todos los mensajes son `ts`, `src` y `seq`. El resto depende de lo que transporte cada categoría.

### 4.1 `def` — la definición del activo

Es la primera categoría que un consumidor debe leer, y la única que describe **qué es** el activo en lugar de qué está haciendo. Se publica **retenida**, una vez por dispositivo, al arrancar el publicador y cada vez que la definición cambie. Nunca al ritmo del proceso.

```json
// greytec/demo/produccion/llenado/coriolis-01/def          (QoS 1, retenido)
{
  "ts": "2026-09-02T10:00:00.000Z",
  "src": "coriolis-01",
  "rev": 2,
  "contract": "0.5",
  "asset": {
    "display_name": "Caudalímetro Coriolis",
    "type": "instrumento",
    "manufacturer": "Greytec (simulado)",
    "model": "sim-coriolis",
    "serial": "SIM-CORIOLIS-01",
    "area": "Llenado",
    "parent": "plc-llenado-01",
    "protocol": "modbus-tcp",
    "endpoint": "10.10.10.100:5020"
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

Seis reglas gobiernan esta categoría:

1. **`rev` sustituye a `seq`.** Es un entero monótono que se incrementa en cada cambio de la definición y **no se reinicia al arrancar el publicador**. Un consumidor lo usa para saber si su copia está al día, y la vista materializada, para descartar revisiones antiguas reentregadas tras un corte.
2. **`contract` declara contra qué versión de este documento se emitió el mensaje.**
3. **La retención es obligatoria.** Un consumidor que se suscriba a `+/+/+/+/+/def` recibe el modelo de datos completo de la instalación en el instante de conectarse, sin pedírselo a nadie y sin esperar a que algo cambie. Es lo que hace que el espacio de nombres sea autodescriptivo: sin `def`, el nombre de variable del último nivel del tópico es una etiqueta sin unidad, sin rango y sin procedencia.
4. **La definición y el flujo se corresponden en ambas direcciones.** Toda variable declarada en `variables` debe publicarse por el canal que indica su campo `channel`, y toda variable publicada debe estar declarada. Una variable que aparece en `dat/raw` sin estar en `def` es un defecto del productor, no una extensión válida. Es verificable con la vista `v_contrato_variables_sin_declarar`.
5. **`deadband` es normativo.** Es el mismo umbral que aplica la publicación por excepción. Declararlo aquí evita que el criterio con el que se decide publicar quede sepultado en la configuración de la pasarela, y permite que un consumidor sepa que un valor no ha cambiado porque no superó su umbral.
6. **Lo publica quien conoce el mapeo,** que es la pasarela de borde y no el dispositivo de campo: el instrumento habla Modbus u OPC UA y no sabe que existe el UNS.

**Por qué es una categoría propia y no un campo más en `sts`.** Las dos son retenidas, pero cambian a ritmos incomparables: `sts` cambia cada vez que el dispositivo se conecta o se desconecta, mientras que `def` cambia cuando alguien interviene la instalación. Mezclarlas obligaría a reenviar el diccionario completo de variables en cada latido de estado.

### 4.2 `dat/raw` — el dato de proceso

Cada variable tiene su propio tópico y el envelope es **plano**: el nombre de la variable vive únicamente en el último nivel del tópico y no se repite en el mensaje.

```json
// greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh     (retenido)
{
  "ts":  "2026-09-03T21:46:34.180Z",
  "src": "coriolis-01",
  "seq": 122956,
  "v":   1072.652,
  "u":   "kg/h",
  "q":   "good"
}
```

- Un mensaje es una variable. El tipo de `v` es fijo por variable y lo declara `def`.
- `q` es obligatorio y toma tres valores: `good`; `bad` si el dispositivo devolvió error; `uncertain` si el valor se leyó pero es sospechoso, ya sea por estar fuera de rango o por haberse caído el enlace de causalidad con el controlador.
- Cadencia: publicación por excepción, con retenido activo.

### 4.3 `dat/der` — el dato derivado

Mantiene el envelope agrupado, porque un procesador emite varios resultados de un mismo cálculo y no se benefician de partirse. Añade dos campos que preservan la trazabilidad del origen:

```json
// greytec/demo/produccion/llenado/coriolis-01/dat/der
{
  "ts": "2026-09-03T21:46:35.000Z",
  "src": "ekuiper",
  "derived_from": "coriolis-01",
  "transform": "moving_avg_5m",
  "seq": 210,
  "payload": {
    "mass_flow_kgh_avg5m": { "v": 1247.8, "u": "kg/h", "q": "good" }
  }
}
```

- `derived_from`: el `src` del dispositivo de origen. Si son varios, separados por coma.
- `transform`: identificador de la función aplicada. Del mensaje se llega a la lógica que lo produjo.

### 4.4 `sts` — el estado del dispositivo

Retenido, con campos planos. `online` y `fw_ver` son obligatorios; el resto depende del dispositivo.

```json
// greytec/demo/produccion/llenado/plc-llenado-01/sts       (retenido)
{
  "ts": "2026-09-03T21:46:00.000Z",
  "src": "plc-llenado-01",
  "online": true,
  "fw_ver": "sim-0.1.0",
  "state_text": "RUNNING",
  "auto_mode": true,
  "alarm_jam": false,
  "uptime_s": 3600
}
```

Se publica al arrancar y cada vez que cambie un campo. Ante una desconexión limpia se publica `"online": false` antes de cerrar.

### 4.5 `evt` — el suceso discreto

No retenido, porque un evento pasado no representa el presente.

```json
// greytec/demo/produccion/llenado/plc-llenado-01/evt
{
  "ts": "2026-09-03T21:46:12.000Z",
  "src": "plc-llenado-01",
  "evt_type": "jam_detected",
  "severity": "alarm",
  "msg": "Atasco en la llenadora"
}
```

- `severity` toma cuatro valores: `info`, `warn`, `alarm`, `critical`. Existe para que el consumidor pueda filtrar sin interpretar el texto.
- `evt_type` va en `snake_case` y se declara por dispositivo en el apartado 7.
- `msg` es contexto para una persona, no un dato que graficar.

### 4.6 `diag` — el canal de diagnóstico

Canal paralelo al lazo de control, siguiendo el patrón de segundo canal de NAMUR Open Architecture. Transporta la salud del equipo sin interferir con `dat/raw`. No retenido y **agrupado**: el objeto se publica entero si cualquiera de sus campos supera su banda muerta.

```json
// greytec/demo/produccion/llenado/coriolis-01/diag
{
  "ts": "2026-09-03T21:46:00.000Z",
  "src": "coriolis-01",
  "seq": 3208,
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

### 4.7 Por qué cada categoría tiene la forma que tiene

Al leer el contrato salta a la vista que `dat/raw` parte cada variable en su propio tópico con envelope plano, mientras que `sts`, `diag` y `evt` agrupan varios campos en un solo mensaje, y que ni `sts` ni `diag` usan el envoltorio `{v,u,q}`. No es una inconsistencia: **la forma del mensaje se deriva de cómo se consume la categoría**, y no de una plantilla única aplicada a ciegas.

Dos ejes independientes deciden la forma. El primero es la **granularidad**: ¿el suscriptor típico quiere una variable suelta o el conjunto completo? El segundo es la **forma del valor**: ¿es una medición de proceso con unidad y calidad que puede degradarse por su cuenta, o es estado que solo tiene sentido leído en bloque?

| Categoría | Granularidad | Forma del valor | Por qué | Se consume como |
|---|---|---|---|---|
| `dat/raw` | Un tópico por variable | `{v,u,q}` | Cada variable es útil de forma independiente: un consumidor quiere `mass_flow_kgh` sin arrastrar el resto del dispositivo | Serie temporal por variable |
| `dat/der` | Agrupado | `{v,u,q}` | El procesador emite varios resultados relacionados de un mismo cálculo; se generan y se consumen juntos | Serie temporal por resultado |
| `sts` | Agrupado | Plano | El estado se lee como bloque: nadie muestra `online` sin el resto de indicadores del mismo panel | Instantánea de estado |
| `diag` | Agrupado | Plano | El diagnóstico es un juicio conjunto: valorar la salud de un instrumento exige ver varias variables a la vez. Partirlo fragmentaría un juicio que por naturaleza no se fragmenta | Panel de salud |
| `evt` | Un mensaje, un evento | Plano, con `msg` de texto | No es una serie temporal sino un registro de sucesos. `evt_type` y `severity` se agregan; `msg` es para leer | Tabla o anotación sobre la gráfica |

**Por qué `sts` y `diag` no llevan `q` por campo.** El envoltorio `{v,u,q}` existe para valores de proceso con unidad física que pueden degradarse unos con independencia de otros: `mass_flow_kgh` puede ser `uncertain` mientras `fluid_temp_c` sigue siendo `good`. Los campos de `sts` y `diag` no se degradan por separado, porque su señal de calidad vive a nivel de enlace —`plc_link_ok`, `online`— y no campo a campo. Añadirles `q` no aportaría información nueva: siempre sería `good`.

---

## 5. Dato crudo y dato derivado

### 5.1 La regla

| Subcategoría | Quién publica | Qué contiene |
|---|---|---|
| `dat/raw` | Solo la adquisición de campo | Lectura directa del instrumento o del controlador, sin transformar |
| `dat/der` | Solo procesadores | Resultado de un cálculo sobre una o más lecturas crudas |

**Ningún procesador publica en `dat/raw` y ningún dispositivo de campo publica en `dat/der`.** Es lo que preserva la trazabilidad del origen del dato, y es verificable en el propio bróker con listas de control de acceso.

### 5.2 Suscripciones que habilita la estructura

| Suscripción | Qué recibe |
|---|---|
| `greytec/demo/#` | Todo el espacio de nombres del laboratorio |
| `+/+/+/+/+/def` | La definición de todos los activos: el modelo de datos completo de la instalación |
| `+/+/+/+/+/dat/raw/#` | Todo el dato crudo de todos los activos |
| `+/+/+/+/+/dat/der` | Solo dato derivado |
| `greytec/demo/produccion/llenado/+/dat/raw/#` | Todo el dato crudo de la celda de llenado |
| `greytec/demo/produccion/llenado/+/dat/raw/energy_kwh` | Una variable en todas las celdas de la línea |
| `greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh` | Una sola variable de un solo activo |

La tercera y la penúltima son las que importan: **permiten incorporar un consumidor sin saber qué dispositivos existen ni cuántos se añadirán después**, que es la propiedad que sostiene el desacoplamiento.

### 5.3 Dónde no aplica la distinción

`raw` y `der` son subcategorías válidas **solo bajo `dat`**. Las demás categorías no las necesitan: `sts` describe por definición el estado físico del dispositivo, y `evt` y `diag` tienen semántica propia que no se beneficia de declarar origen. La asimetría es deliberada y debe conservarse al extender el contrato.

Hay una excepción, y es funcional, no de origen: cuando una sola entidad emite grupos de diagnóstico heterogéneos, `diag` puede usarse como rama y colgar cada grupo debajo (`…/diag/cpu`, `…/diag/red`). Se reserva para el diagnóstico de infraestructura y hoy no se usa: la pasarela publica un único `diag` agrupado.

---

## 6. El espacio de nombres de la celda

Cada celda publica **`def` primero**, retenido. Es lo que permite a un consumidor nuevo interpretar todo lo demás sin preguntar a nadie.

```
greytec/
  demo/
    produccion/
      llenado/
        plc-llenado-01/
          def                        [R] identidad + diccionario de 6 variables
          dat/raw/{variable}         un tópico por variable, publicación por excepción
          sts                        [R] estado, modo automático, alarma de atasco, tiempo en servicio
          evt                        cambio de estado, atasco detectado y despejado
        valvula-01/
          def                        [R] identidad + diccionario de 5 variables
          dat/raw/{variable}
          sts                        [R] incluye enlace con el PLC y alarma de desviación
          evt                        desviación de válvula y su recuperación
        coriolis-01/
          def                        [R] identidad + 5 variables de proceso y 5 de diagnóstico
          dat/raw/{variable}
          diag                       [NOA] salud del transmisor, agrupada
        medidor-02/
          def                        [R] identidad + diccionario de 6 variables
          dat/raw/{variable}
          sts                        [R] incluye enlace con el PLC
    campo/
      edge/
        iot2050/
          def                        [R] derivado del propio payload medido
          diag                       salud de la pasarela: anfitrión y contenedores
    _kpi/                            reservada, no desplegada (apartado 7.6)
```

`[R]` indica retenido. `[NOA]` indica canal de diagnóstico paralelo al lazo de control.

**Por qué el borde cuelga de su propia rama.** La pasarela no es un sensor: es el equipo que *publica*. Lee los dispositivos que tiene por debajo, normaliza y publica el `dat/raw` de cada uno, por lo que los datos de proceso aparecen bajo la celda que los origina aunque físicamente los emita el borde. Lo único propio de la pasarela es su `diag`, y por eso es lo único que vive bajo `campo/edge/`.

---

## 7. Las variables de cada dispositivo

Las veintisiete variables de la celda salen de un único fichero versionado, `deploy/2-edge/def-publisher/definitions.yml`, que es la fuente de la que se publica `def`. Las tablas de este apartado lo reproducen; ante cualquier duda manda el fichero.

### 7.1 `plc-llenado-01` — controlador de la celda

OPC UA en `opc.tcp://10.10.10.100:4840`. Gobierna la máquina de estados de la línea: `0 = STOPPED`, `1 = STARTING`, `2 = RUNNING`, `3 = FAULT`. De `line_state` y los contadores se derivan aguas abajo la disponibilidad y la calidad del OEE.

| Variable (`dat/raw/…`) | Tipo | Unidad | Banda muerta | Nodo OPC UA (`ns=2;s=…`) |
|---|---|---|---|---|
| `line_state` | int | — | cualquier cambio | `Llenadora.State` |
| `speed_bpm` | number | bpm | 0,5 | `Llenadora.SpeedBpm` |
| `target_flow_kgh` | number | kg/h | 5 | `Llenadora.TargetFlowKgh` |
| `valve_cmd_pct` | number | % | 0,5 | `Llenadora.ValveCmdPct` |
| `good_count` | int | cnt | cualquier cambio (acumulador) | `Llenadora.GoodCount` |
| `bad_count` | int | cnt | cualquier cambio (acumulador) | `Llenadora.BadCount` |

**`sts`** (retenido): `online`, `fw_ver`, `state_text`, `auto_mode`, `alarm_jam`, `uptime_s`.

**`evt`**, derivados por el borde a partir de las transiciones:

| `evt_type` | `severity` | Cuándo |
|---|---|---|
| `line_state_change` | `info` | Cualquier transición de `line_state` |
| `jam_detected` | `alarm` | Entrada en FAULT |
| `jam_cleared` | `info` | Salida de FAULT |

**No hay canal de mando.** El controlador expone nodos escribibles bajo `ns=2;s=Cmd.*`, pero este contrato **no define ninguna categoría de mando**: la plataforma es de solo lectura sobre el proceso. La consecuencia es que el flujo va de campo a consumo sin una sola excepción, lo que simplifica la matriz de conductos de red. Habilitar el mando es una extensión natural —exigiría identificador idempotente, emisor identificado y evento de respuesta que lo referencie— y queda como línea de continuación.

### 7.2 `coriolis-01` — caudalímetro Coriolis

Modbus TCP en `10.10.10.100:5020`, función 3. Coma flotante de 32 bits *big-endian* con la palabra alta primero, direcciones desde cero.

| Variable (`dat/raw/…`) | Tipo | Unidad | Banda muerta | Dirección |
|---|---|---|---|---|
| `mass_flow_kgh` | number | kg/h | 5 | 0-1 |
| `volume_flow_lph` | number | L/h | 5 | 2-3 |
| `density_kgm3` | number | kg/m³ | 0,5 | 4-5 |
| `fluid_temp_c` | number | °C | 0,1 | 6-7 |
| `total_mass_kg` | number | kg | 1 (acumulador) | 8-9 |

**`diag`** (agrupado, latido de 60 s). El objeto se publica entero si cualquiera de sus campos dispara:

| Campo (`diag`) | Tipo | Unidad | Banda muerta | Dirección |
|---|---|---|---|---|
| `drive_gain_pct` | number | % | 1 | 10-11 |
| `tube_freq_hz` | number | Hz | 0,05 | 12-13 |
| `sensor_temp_c` | number | °C | 0,2 | 14-15 |
| `air_entrainment` | bool | — | cualquier cambio | 16, bit 1 |
| `plc_link_ok` | bool | — | cualquier cambio | 16, bit 0 |

La ganancia de excitación ronda el 8 % en operación normal y sube entre el 40 % y el 90 % cuando entra aire en el tubo de medida, momento en el que además la densidad cae. Es el indicador de mantenimiento predictivo de la celda, y es el motivo por el que estas cinco variables viajan por un canal separado: un sistema de mantenimiento puede consumirlas sin tocar nada del lazo de control.

Con `air_entrainment` activo, `mass_flow_kgh` y `density_kgm3` se publican con `q: "uncertain"`. Con `plc_link_ok` en falso, todas las variables del dispositivo pasan a `uncertain`.

### 7.3 `valvula-01` — válvula de control con posicionador

OPC UA en `opc.tcp://10.10.10.100:4841`.

| Variable (`dat/raw/…`) | Tipo | Unidad | Banda muerta | Nodo OPC UA (`ns=2;s=…`) |
|---|---|---|---|---|
| `setpoint_pct` | number | % | 0,5 | `Valvula.SetpointPct` |
| `position_pct` | number | % | 0,5 | `Valvula.PositionPct` |
| `travel_total_m` | number | m | 0,01 (acumulador) | `Valvula.TravelTotalM` |
| `cycle_count` | int | cnt | cualquier cambio (acumulador) | `Valvula.CycleCount` |
| `air_supply_bar` | number | bar | 0,05 | `Valvula.AirSupplyBar` |

`travel_total_m` y `cycle_count` no describen el proceso sino el desgaste del posicionador. Son datos de mantenimiento que en una arquitectura punto a punto rara vez llegan a nadie.

**`sts`** (retenido): `online`, `fw_ver`, `plc_link_ok`, `alarm_deviation`.

**`evt`:** `valve_deviation` (`alarm`) cuando la diferencia entre posición y consigna supera el 5 % sostenido más de 10 s; `valve_deviation_cleared` (`info`) al recuperarse.

### 7.4 `medidor-02` — medidor de energía de la celda

Modbus TCP en `10.10.10.100:5021`, función 4. Coma flotante de 32 bits *big-endian* en registros de entrada.

| Variable (`dat/raw/…`) | Tipo | Unidad | Banda muerta | Dirección |
|---|---|---|---|---|
| `voltage_v` | number | V | 1 | 0-1 |
| `current_a` | number | A | 0,05 | 2-3 |
| `active_power_w` | number | W | 25 | 4-5 |
| `power_factor` | number | — | 0,01 | 6-7 |
| `frequency_hz` | number | Hz | 0,02 | 8-9 |
| `energy_kwh` | number | kWh | 0,01 (acumulador) | 10-11 |

Palabra de estado en la dirección 12, bit 0: enlace con el PLC. Sin enlace el medidor reporta consumo de reposo, que es un valor plausible pero sin contexto de línea, así que se publica con `q: "uncertain"`.

**`sts`** (retenido): `online`, `fw_ver`, `plc_link_ok`.

### 7.5 `iot2050` — salud de la pasarela

La pasarela publica un único `diag` agrupado en `greytec/demo/campo/edge/iot2050/diag`, con cadencia fija de 10 s. Recoge consumo de procesador, memoria, disco, temperatura y red del anfitrión, más procesador y memoria por contenedor.

A diferencia del resto, aquí **no hay banda muerta**: la cadencia es fija porque el consumo es una señal que siempre se mueve y filtrarla no aportaría nada.

Su `def` es el único que **no sale de `definitions.yml`**, sino que se deriva del propio payload que acaba de medirse. El motivo es que las métricas por contenedor dependen de qué contenedores están corriendo en ese momento, y eso no puede escribirse por adelantado sin quedar desfasado en cuanto se añada un servicio. Por construcción la definición no puede divergir del flujo, porque ambos salen del mismo diccionario; y si el conjunto de campos cambia, se republica con `rev` incrementado, que es exactamente el caso de uso que `rev` prevé.

Para un consumidor la diferencia es invisible: se suscribe a `+/+/+/+/+/def` y recibe el árbol entero con el mismo formato, sin saber ni necesitar saber cuál se escribió a mano y cuál se generó solo.

### 7.6 `_kpi` — indicadores calculados (reservada, no desplegada)

Esta categoría está especificada y **no se publica**. Los indicadores existen como vistas de la capa oro y los consume la API; lo que no ocurre es su republicación al UNS. Se conserva aquí porque especifica el patrón de consumidor-productor y es la línea de continuación natural del trabajo.

**Tópico:** `{empresa}/{emplazamiento}/{área}/{línea}/_kpi/{nombre}`, por ejemplo `greytec/demo/produccion/llenado/_kpi/oee`.

Un indicador pertenece al activo que lo genera y no a la planta. El OEE es *de una línea*: con dos líneas hay dos OEE que se analizan por separado y se comparan entre sí, así que anclarlo al nivel de línea permite que la segunda publique el suyo sin colisión. Un indicador genuinamente de planta, como el consumo total, sí vive a nivel de emplazamiento. El nivel lo decide el alcance del indicador.

Usa el envelope de `dat/der` con un campo más, `bucket`:

```json
// greytec/demo/produccion/llenado/_kpi/oee                 (QoS 1, retenido)
{
  "ts": "2026-09-03T16:23:00.000Z",
  "src": "idp-writeback",
  "derived_from": "plc-llenado-01",
  "transform": "v_oee_hourly",
  "seq": 42,
  "bucket": "2026-09-03T11:00:00-05:00",
  "payload": {
    "availability_pct": { "v": 83.7, "u": "%", "q": "good" },
    "quality_pct":      { "v": 97.8, "u": "%", "q": "good" },
    "performance_pct":  { "v": 90.8, "u": "%", "q": "good" },
    "oee_pct":          { "v": 74.3, "u": "%", "q": "uncertain" }
  }
}
```

`ts` es cuándo se publicó, para juzgar frescura; `bucket` es a qué ventana temporal pertenece el valor. Un indicador agregado necesita ambos; un `dat/der` puntual, no.

Va agrupado porque los componentes son la descomposición de un solo número —`oee = disponibilidad × calidad × rendimiento`—: publicar `oee_pct` suelto es inútil, porque ante un 74 % la pregunta inmediata es por qué, y la respuesta son los componentes. Y lleva `{v,u,q}` porque los campos **sí** se degradan por separado: con la línea parada toda la hora, `availability_pct` vale 0,0 y es un valor válido, mientras que `quality_pct` y `performance_pct` son nulos por división entre cero.

`q` describe aquí el estado del cálculo y no el del sensor:

| Situación | `q` |
|---|---|
| Cubeta horaria cerrada | `good`, dato final |
| Cubeta en curso | `uncertain`, real pero provisional |
| Campo nulo por falta de datos o división entre cero | `bad` |

**Para retirar un indicador no basta con dejar de publicarlo:** el bróker conservaría el último retenido y el consumidor lo vería congelado para siempre. Hay que publicar un retenido vacío en ese tópico antes de darlo de baja.

---

## 8. Quién consume y por dónde

Hay dos clases de consumidor según su patrón de acceso, más una tercera que también produce.

| Clase | Se conecta a | Latencia | Qué ve | Cuándo elegirla |
|---|---|---|---|---|
| **Operacional** | El bróker, por MQTT | < 100 ms | El estado presente, sin historia | Cuando hay que reaccionar a un **evento individual** |
| **Analítico** | Las vistas de plata y oro, por SQL | Segundos | Historia completa con contexto semántico | Cuando hay que detectar un **patrón sobre muchos eventos en el tiempo** |
| **Consumidor-productor** | El bróker, de entrada y de salida | < 1 s | Consume `dat/raw` y publica `dat/der` o `evt` | Cuando transforma o evalúa en tiempo real |

La pregunta que decide es siempre la misma: **¿hace falta reaccionar a un evento, o detectar un patrón a lo largo del tiempo?** Lo primero va al bróker; lo segundo, a la base de datos.

Dos reglas acompañan a esta clasificación:

- **Ningún consumidor calcula indicadores por su cuenta.** Si el indicador no existe en la capa oro, se añade ahí y todos lo usan. La lógica de negocio vive en el modelo y no en cada aplicación, porque de lo contrario cada consumidor termina con su propia definición de OEE.
- **El consumidor-productor publica siempre bajo `dat/der` o `evt`,** nunca bajo `dat/raw`.

---

## 9. Reglas de evolución

En la práctica industrial hay que estar preparado para los cambios, pero cambiar el contrato sin reglas rompe a los consumidores. El criterio es doble:

- **Compatibilidad hacia atrás:** un consumidor nuevo entiende el dato que escribió un productor antiguo.
- **Compatibilidad hacia delante:** un consumidor antiguo sigue funcionando con el dato que escribe un productor nuevo.

Un cambio es seguro solo si conserva las dos.

> **Regla 0 — la definición manda.** Añadir, renombrar o retirar una variable obliga a publicar una revisión nueva de `def`, con `rev` incrementado, **en el mismo despliegue** en que cambia el flujo. Una variable presente en `dat/raw` y ausente de `def` es un defecto del productor; una variable declarada en `def` que nunca se publica es una definición muerta. Ambas se detectan comparando el árbol retenido de `def` con el de `dat/raw`.

| # | Cambio | ¿Rompe compatibilidad? | Qué hacer |
|---|---|---|---|
| 1 | Añadir una variable, una categoría o un dispositivo | No | Publicarlo, y aplicar la Regla 0 |
| 2 | Añadir un campo opcional a un envelope | No | Publicarlo. Los consumidores existentes ignoran lo que no conocen |
| 3 | Renombrar o eliminar una variable | Sí | Transición con el nombre antiguo y el nuevo publicándose a la vez; retirar el antiguo cuando ningún consumidor lo use |
| 4 | Cambiar la unidad o el tipo de una variable | Sí | Es una variable distinta: publicarla con nombre nuevo y aplicar la regla 3 |
| 5 | Cambiar la calidad de servicio o la retención de una categoría | Sí | Versionar el contrato y avisar. Requiere un ADR |
| 6 | Cambiar el esquema de un envelope | Sí | Cambio mayor: versión nueva del contrato y migración coordinada de productores y consumidores |

La regla 5 es la única que no resulta evidente, porque no rompe a nadie de forma visible pero sí cambia el comportamiento de quien está suscrito. Un consumidor que contaba con recibir el último valor retenido al conectarse deja de recibirlo y muestra una pantalla vacía **sin ningún error**, que es el modo de fallo más difícil de diagnosticar.

Además, todo dispositivo o categoría que se incorpore debe declarar explícitamente su granularidad y su forma de valor siguiendo el criterio del apartado 4.7. No se asume un formato por defecto: la forma se deriva del patrón de consumo y no se copia de otra categoría por comodidad.

---

## 10. Llevar el contrato a otra instalación

Al desplegar en una planta distinta **la estructura del contrato no cambia**. Solo cambian los tres primeros niveles del tópico y el inventario de activos:

```yaml
empresa: PyME
emplazamiento: planta-guayaquil
areas:
  - id: linea-1
    lineas:
      - id: compresor
        celdas:
          - id: compresor-01
            tipo: plc-siemens-s7
```

Lo que nunca cambia entre instalaciones es la estructura canónica del tópico, los esquemas de envelope del apartado 4, la regla de dato crudo frente a derivado y las convenciones del apartado 3. Lo que sí cambia es el árbol del apartado 6 y las tablas de variables del apartado 7, que se reescriben con los activos reales de esa planta.

Esa es la propiedad que hace replicable la arquitectura: **una instalación nueva se resuelve por configuración y no por rediseño**.
