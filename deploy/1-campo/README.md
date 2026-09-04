# Simuladores — Celda de llenado F&B

> Cuatro dispositivos de campo simulados. Cada uno expone un servidor OPC UA o Modbus TCP
> auténtico, en su propio contenedor y con su propia dirección (contrato UNS §7.1).
> 4 dispositivos Python, 2 protocolos: la mitad Modbus TCP, la mitad OPC UA.
> Contrato: `docs/contracts/UNS.md` §7.4.

## Por qué

Modelar el proceso en Python y no en un runtime de PLC permite dar a cada dispositivo su
propia dinámica, sus propios modos de fallo y su propio canal de diagnóstico, que es lo
que el trabajo necesita ejercitar (ADR-012).

## Topología y causalidad

```
                       ┌──────────────────────┐
                       │  plc-llenado-01      │  OPC UA :4840
                       │  (PLC maestro)       │  REST   :8080 (interno; :8085 debug)
                       │  modelo de la línea  │
                       └──────────┬───────────┘
             GET /state (cada 0.5 s, red interna del compose)
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │ valvula-01       │ │ coriolis-01      │ │ medidor-02       │
   │ OPC UA :4841     │ │ Modbus TCP :5020 │ │ Modbus TCP :5021 │
   │ posicionador     │ │ FC3 + diag NOA   │ │ FC4 estilo SDM   │
   └──────────────────┘ └──────────────────┘ └──────────────────┘
```

- El PLC corre la máquina de estados de la línea (STOPPED → STARTING →
  RUNNING → FAULT) con calendario de producción autónomo: corridas de
  10-30 min, changeovers de 2-8 min, atascos con MTBF ≈ 20 min, episodios
  de mala calidad ~1/h.
- La causalidad es real: el PLC comanda `valve_cmd_pct` → la válvula mueve
  su posición con dinámica de actuador → el coriolis mide el caudal
  resultante → el medidor refleja el consumo eléctrico del estado de línea.
- **Si el PLC cae**, los otros 3 siguen sirviendo su protocolo pero degradan
  a "línea parada" y lo señalizan (status word bit0 / `PlcLinkOk`). Node-RED
  debe mapear eso a `q: "uncertain"`.
- El canal REST es un artefacto de simulación: **no** es parte de la
  superficie de integración. Node-RED solo habla Modbus TCP y OPC UA.

## Levantar

```bash
docker compose down          # en core/compose/brix — OpenPLC usa el puerto 4840
docker compose up -d --build # en esta carpeta
```

Verificación rápida:

```bash
curl http://10.10.10.100:8085/state        # estado del PLC maestro (JSON)
docker logs -f sim-plc-llenado             # transiciones de estado de la línea
# OPC UA:  UAExpert → opc.tcp://10.10.10.100:4840 y :4841 (Security None, Anonymous)
# Modbus:  Node-RED / modpoll → 10.10.10.100:5020 (FC3) y :5021 (FC4)
```

## Puertos

| Dispositivo | Protocolo | Puerto | Notas |
|---|---|---|---|
| plc-llenado-01 | OPC UA | 4840 | puerto estándar OPC UA |
| valvula-01 | OPC UA | 4841 | |
| coriolis-01 | Modbus TCP | 5020 | FC3 holding registers |
| medidor-02 | Modbus TCP | 5021 | FC4 input registers |
| (debug) REST del PLC | HTTP | 8085 | `GET /state`, `GET /healthz` |

## plc-llenado-01 — nodos OPC UA (ns=2)

NodeIds de tipo string: `ns=2;s=<id>`.

| NodeId | Tipo | Descripción | Variable UNS |
|---|---|---|---|
| `Llenadora.State` | Int32 | 0=STOPPED 1=STARTING 2=RUNNING 3=FAULT | `line_state` |
| `Llenadora.StateText` | String | texto del estado | → `sts.state_text` |
| `Llenadora.GoodCount` | UInt32 | botellas buenas (acumulador) | `good_count` |
| `Llenadora.BadCount` | UInt32 | botellas rechazadas (acumulador) | `bad_count` |
| `Llenadora.SpeedBpm` | Float | velocidad de línea (botellas/min) | `speed_bpm` |
| `Llenadora.TargetFlowKgh` | Float | consigna de caudal | `target_flow_kgh` |
| `Llenadora.ValveCmdPct` | Float | mando a la válvula | `valve_cmd_pct` |
| `Llenadora.AlarmJam` | Boolean | atasco activo | → `sts.alarm_jam` + `evt` |
| `Llenadora.UptimeS` | UInt32 | uptime del PLC | → `sts.uptime_s` |

**Nodos de comando** (escribibles, para el flujo `cmd` de un sprint posterior):
`Cmd.AutoMode` (Boolean, default True), `Cmd.Start` / `Cmd.Stop` (Boolean,
pulsos — el PLC los consume), `Cmd.TargetFlowKgh` (Float). Con
`AutoMode=False` el calendario autónomo se suspende y la línea obedece los
comandos.

## valvula-01 — nodos OPC UA (ns=2)

| NodeId | Tipo | Descripción | Variable UNS |
|---|---|---|---|
| `Valvula.SetpointPct` | Float | mando recibido del PLC | `setpoint_pct` |
| `Valvula.PositionPct` | Float | posición real (lag τ≈2 s + fricción) | `position_pct` |
| `Valvula.TravelTotalM` | Float | recorrido acumulado del vástago (salud) | `travel_total_m` |
| `Valvula.CycleCount` | UInt32 | inversiones de dirección (salud) | `cycle_count` |
| `Valvula.AirSupplyBar` | Float | presión de aire de instrumentos | `air_supply_bar` |
| `Valvula.AlarmDeviation` | Boolean | desviación >5% sostenida >10 s | → `sts` + `evt` |
| `Valvula.PlcLinkOk` | Boolean | enlace con el PLC | → `q=uncertain` si False |

## coriolis-01 — registros Modbus (FC3, unit 1)

Floats de 32 bits big-endian, palabra alta primero, direcciones zero-based
(igual que el flow actual: `writeUInt16BE`/`readFloatBE`). Leer addr 0-16 de
un solo poll (`quantity: 17`).

| Addr | Variable | Unidad | Canal UNS |
|---|---|---|---|
| 0-1 | `mass_flow_kgh` | kg/h | `dat/raw` |
| 2-3 | `volume_flow_lph` | L/h | `dat/raw` |
| 4-5 | `density_kgm3` | kg/m³ | `dat/raw` |
| 6-7 | `fluid_temp_c` | °C | `dat/raw` |
| 8-9 | `total_mass_kg` | kg | `dat/raw` (totalizador, no se resetea) |
| 10-11 | `drive_gain_pct` | % | `diag` (NOA) |
| 12-13 | `tube_freq_hz` | Hz | `diag` (NOA) |
| 14-15 | `sensor_temp_c` | °C | `diag` (NOA) |
| 16 | `status_word` | — | bit0=enlace PLC, bit1=aire arrastrado, bit2=fallo sensor |

El drive gain normal ronda 8%; durante episodios de aire arrastrado (casi
seguros en cada arranque de línea) sube a 40-90% y la densidad cae — ese es
el insight NOA para mantenimiento predictivo de la demo.

## medidor-02 — registros Modbus (FC4, unit 1)

| Addr | Variable | Unidad |
|---|---|---|
| 0-1 | `voltage_v` | V |
| 2-3 | `current_a` | A |
| 4-5 | `active_power_w` | W |
| 6-7 | `power_factor` | — |
| 8-9 | `frequency_hz` | Hz |
| 10-11 | `energy_kwh` | kWh (acumulador, no se resetea) |
| 12 | `status_word` | bit0=enlace PLC |

## Integración Node-RED (edge) — contrato v0.3

Topics de salida: `greytec/demo/produccion/llenado/{cell}/dat/raw/{variable}`
con envelope **plano** y **RBE** (deadband + heartbeat 30 s + retained). Ver
contrato §3.5 y §4.1.

```json
// greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh
{ "ts": "2026-07-03T14:23:00.123Z", "src": "coriolis-01", "seq": 1042,
  "v": 1250.4, "u": "kg/h", "q": "good" }
```

Cadencias de poll sugeridas: OPC UA 1 s (PLC y válvula), Modbus 1 s
(coriolis), 2 s (medidor). El RBE reduce lo publicado, no lo leído.

Snippet genérico para un nodo function por dispositivo (entrada:
`msg.payload = { variable: {v, u, q} }` ya normalizado; salida: N mensajes
MQTT con topic/retain dinámicos — dejar topic vacío en el nodo `mqtt out`):

```javascript
const SRC  = 'coriolis-01';
const BASE = `greytec/demo/produccion/llenado/${SRC}/dat/raw`;
// deadbands del contrato §7.4 — booleanos y contadores: cualquier cambio
const DEADBAND = { mass_flow_kgh: 5, volume_flow_lph: 5, density_kgm3: 0.5,
                   fluid_temp_c: 0.1, total_mass_kg: 1 };
const HEARTBEAT_MS = 30000;

const last = context.get('last') || {};
let   seq  = context.get('seq')  || 0;   // seq POR DISPOSITIVO (contrato §3.4)
const now  = Date.now();
const out  = [];

for (const [name, val] of Object.entries(msg.payload)) {
    const prev = last[name];
    const db = DEADBAND[name] ?? 0;
    const changed = prev === undefined
        || (typeof val.v === 'number' ? Math.abs(val.v - prev.v) > db : val.v !== prev.v)
        || val.q !== prev.q;
    if (changed || (now - prev.t) >= HEARTBEAT_MS) {
        seq += 1;
        last[name] = { v: val.v, q: val.q, t: now };
        out.push({ topic: `${BASE}/${name}`, qos: 1, retain: true,
                   payload: { ts: new Date().toISOString(), src: SRC, seq,
                              v: val.v, u: val.u, q: val.q } });
    }
}
context.set('last', last);
context.set('seq', seq);
return [out];
```

Reglas de calidad (`q`):

- `status_word` bit0 = 0 o `PlcLinkOk` = False → `q: "uncertain"` en las
  variables de ese dispositivo.
- Coriolis con bit1 (aire arrastrado) → `q: "uncertain"` en `mass_flow_kgh`
  y `density_kgm3` (medición de dos fases).
- Poll Modbus/OPC UA fallido → publicar `sts` con `online: false` (equivale
  al LWT en el patrón edge-publisher).

`sts` (retained, por dispositivo): `{ts, src, online, fw_ver: "sim-0.1.0"}` +
extras del contrato §7.4. `diag` del coriolis: agrupado (envelope §4.5),
RBE con heartbeat 60 s.

## Integración aguas abajo (pendiente tras este sprint)

Los topics por variable **no matchean** los patrones actuales:

1. `central/consumers/mqtt-bridge/mqtt-to-redpanda.yaml` — sin cambios de
   sintaxis, pero el fan-out crea un topic Redpanda por variable (~30).
2. `redpanda-to-tsdb/main.py` — `KAFKA_PATTERN` y el router usan
   `endswith(".dat.raw")`: hay que aceptar `dat.raw.<variable>` y parsear el
   envelope plano (variable desde el topic).
3. `central/sql/silver.sql` — nuevos `src` y campos en `asset_tags`; la vista
   `v_process_readings` asume payload agrupado.
