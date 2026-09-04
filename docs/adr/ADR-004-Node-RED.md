# ADR-004: Node-RED como gateway de adquisición primario en el IOT2050

**Status:** Aceptado — Revisado 2026-06-24 (NeuronEX primario → Node-RED primario)
**Fecha original:** 2026-05-05
**Autores:** José Desiderio

---

## Contexto

Se necesita un cliente OPC UA / Modbus TCP robusto para el IOT2050 que normalice los datos de campo al contrato UNS y los publique en NanoMQ local. El stack del IOT2050 tiene 2 GB RAM (ARM Cortex-A53); cualquier componente de adquisición debe coexistir con NanoMQ y eKuiper sin saturar el dispositivo.

La decisión original (2026-05-05) elegía NeuronEX como cliente protocolar primario por sus drivers OT en C y eKuiper integrado. Tras evaluar el volumen real de tags del proyecto (~50 tags en Phase 1-3) y la restricción de no querer licencias comerciales, se revisó esta decisión.

## Decisión

Usar **Node-RED** como gateway de adquisición primario en el IOT2050:

- `node-red-contrib-modbus` → cliente Modbus TCP para ESP32-A y medidor Eastron SDM120
- `node-red-contrib-opcua` → cliente OPC UA para OpenPLC en el PLC virtual
- Node-RED también sirve el **Node-RED Dashboard** (`node-red-dashboard`) como visualizador local en campo — sin base de datos adicional
- El stream processing (deadband, KPIs derivados, anomalías) lo maneja **eKuiper standalone** (Apache 2.0), no dentro de Node-RED

**Por qué Node-RED es suficiente para este stack:**

| Métrica | Capacidad Node-RED | Carga real del proyecto |
|---|---|---|
| Tags concurrentes | ~300-500 a 1s en ARM | ~50 tags |
| Polling mínimo | ~500 ms estable | 10 segundos |
| Protocolos necesarios | Modbus TCP + OPC UA | Modbus TCP + OPC UA |
| Licencia | Apache 2.0, sin límites | — |

**NeuronEX se difiere** para escenarios de alta densidad de tags (>500) o protocolos industriales avanzados sin nodos maduros en Node-RED (DNP3, IEC 61850, S7 nativo). En esos casos, NeuronEX puede reemplazar Node-RED en el IOT2050 sin modificar nada del pipeline aguas abajo — el contrato UNS actúa como interfaz de desacoplamiento.

## Alternativas consideradas

| Opción | Pro | Contra | Estado |
|---|---|---|---|
| NeuronEX (EMQ, comercial) | Drivers OT en C, alta densidad, eKuiper integrado | Plugins avanzados (OPC UA, S7) requieren licencia comercial | Diferido — plan B para alta densidad |
| Neuron (EMQ, open-source LGPL) | Gratuito, drivers básicos en C | OPC UA es plugin comercial; dashboard congelado en v2.6.3; madurez menor | Descartado — OPC UA necesario desde Phase 1 |
| Solo Node-RED | Open source total, flexible, ARM64 oficial | Single-threaded JS, escala hasta ~500 tags | **Elegido para Phase 1-3** |
| Crosser / Litmus Edge / FlowFuse | Feature-rich | Comerciales, vendor lock-in | Descartados |

## Consecuencias

- ✅ Sin licencias comerciales ni límites de tags
- ✅ Imágenes ARM64 oficiales disponibles
- ✅ `node-red-contrib-modbus` maduro y estable para Modbus TCP
- ✅ Node-RED Dashboard incluido — visualizador local sin DB adicional
- ✅ La capa de adquisición es reemplazable (NeuronEX, Kepware, etc.) sin tocar el pipeline aguas abajo
- ⚠️ Single-threaded: no apto para >300-500 tags o polling sub-segundo a escala
- ⚠️ `node-red-contrib-opcua` es comunitario; menos robusto que el cliente OPC UA nativo de NeuronEX para modelos de información grandes
- ⚠️ Transformaciones complejas deben moverse a eKuiper, no implementarse como function nodes en Node-RED (riesgo de bloquear el event loop)
