# ADR-012: Simuladores Python multiprotocolo en vez de OpenPLC

**Status:** Aceptado — *Supersedes la decisión previa sobre OpenPLC, revisa la decisión previa sobre el rol del Brix*
**Fecha:** 2026-07-16
**Autores:** José Desiderio

---

## Contexto

la decisión previa sobre OpenPLC puso OpenPLC Runtime en el Brix como PLC virtual, con la celda
modelada en Structured Text (tanque + condiciones + cinta). Funcionó, pero al construir sobre
él aparecieron tres límites:

1. **Fragilidad operativa.** El programa compilado **no persiste** a recreaciones del
   contenedor: hay que recompilar desde el Editor tras cada `docker compose up` que recree el
   contenedor. Los índices `arr`/`elem` del `opcua.json` salen del `debug-map.json` del
   compilador y hay que reajustarlos a mano en cada recompilación con cambios de variables.
   Para un demo que debe levantarse delante de un cliente, eso es un riesgo.
2. **Un solo runtime, un solo dispositivo.** Toda la simulación colgaba de un proceso. La
   demo no podía enseñar **dispositivos heterogéneos con protocolos distintos**, que es
   precisamente la superficie de integración que Greytec vende.
3. **No podía simular instrumentación inteligente.** El patrón NOA (diagnóstico del
   instrumento por un canal aparte del dato de proceso) no es expresable en ST: un Coriolis
   que reporta `drive_gain`, `air_entrainment` y `tube_frequency` no es un bloque de función,
   es un dispositivo con su propia electrónica.

Además el caso de uso maduró: de un tanque con cinta a una **celda de llenado F&B** con OEE,
calidad, rechazos y consumo energético — un caso con KPIs de negocio reales.

## Decisión

Retirar OpenPLC. La celda la simulan **4 contenedores Python independientes**
(`deploy/1-campo/`), cada uno un dispositivo que **habla su protocolo industrial**:

| Dispositivo | Protocolo | Puerto | Rol |
|---|---|---|---|
| `plc-llenado-01` | OPC UA | 4840 | PLC maestro: modelo de la línea |
| `valvula-01` | OPC UA | 4841 | Válvula de llenado |
| `coriolis-01` | Modbus TCP | 5020 (FC3) | Caudalímetro + diagnóstico NOA |
| `medidor-02` | Modbus TCP | 5021 (FC4) | Medidor de energía |

Node-RED los lee por Modbus/OPC UA **exactamente igual que leía a OpenPLC**, y normaliza al UNS.
Ningún simulador publica MQTT: **no tienen acceso al broker**.

## Alternativas consideradas

| Opción | Pro | Contra | Descartada porque |
|--------|-----|--------|-------------------|
| Mantener OpenPLC + añadir simuladores para lo que ST no cubre | Conserva el programa IEC 61131-3 | Dos mecanismos de simulación conviviendo; el problema de persistencia sigue | Complejidad sin beneficio: el vocabulario OT ya lo dan los protocolos, no el ladder. |
| Simuladores Python publicando MQTT directo | Lo más simple | **Elimina la capa de protocolo OT**: sin Modbus ni OPC UA, la demo es "IoT que publica JSON" | Es exactamente lo que la decisión previa sobre OpenPLC temía, y con razón. El valor está en que Node-RED **traduzca** protocolo industrial → UNS. |
| Comprar un PLC físico | Máxima fidelidad | >$800 USD | Sin cambios respecto a la decisión previa sobre OpenPLC: no hay presupuesto ni proceso real que automatizar. |

## Consecuencias

**Positivas:**
- **El vocabulario OT se conserva y se amplía**: de 1 runtime a 4 dispositivos con 2
  protocolos. La adquisición de Node-RED es idéntica a la de un cliente real.
- **Robustez**: `docker compose up` y la celda está corriendo. Sin recompilar, sin Editor, sin
  reajustar índices.
- **Simulable lo que antes no**: el diagnóstico NOA del Coriolis existe porque el dispositivo
  lo genera.
- **Realismo causal**: el resto de dispositivos consultan `GET /state` del PLC maestro (red
  interna del compose), así que caudal, energía y rechazos **son coherentes** con lo que hace
  la línea, no ruido independiente.
- **Cada dispositivo se prueba solo**: `modpoll` a `:5020` o UAExpert a `:4840`.

**Negativas / Trade-offs aceptados:**
- **Se pierde el programa IEC 61131-3 y el scan cycle.** No hay ladder ni ST en el demo. Esto
  es real y hay que decirlo en la narrativa: el demo enseña **adquisición e integración OT**,
  no programación de control. Si un cliente pide ver lógica de control, OpenPLC sigue en el
  repo y se puede reactivar.
- La objeción de la decisión previa sobre OpenPLC ("no es un PLC") **sigue siendo cierta para la capa de control**; deja
  de serlo para la capa de protocolo, que es la que consume el IDP.
- 4 contenedores en vez de 1 en el Brix.

**Deuda técnica generada:**
- El Brix mezcla dos roles (campo + gateway edge) que en planta están separados. Concesión de
  laboratorio mientras no llegue el IOT2050. Ver la decisión previa sobre el rol del Brix.

## Implicaciones de seguridad

- Los simuladores exponen Modbus TCP y OPC UA **sin autenticación** (Security None, Anonymous),
  igual que OpenPLC. Es fiel a la realidad: **los protocolos OT de campo no autentican**, y por
  eso el modelo de seguridad es **la segmentación de red**, no el protocolo. Viven en VLAN 10
  (OT), que solo alcanza la DMZ por MQTT 1883 ([ADR-010](./ADR-010-Segmentacion-OPNsense.md)).
- **Ningún simulador tiene credenciales del broker**: no publican MQTT. La única ruta al UNS es
  Node-RED, y eso mantiene un solo punto de normalización y de control de acceso.
- Al ser software simulado, un compromiso no tiene consecuencia física. En un cliente real este
  mismo lugar lo ocupa un PLC de verdad, y ahí la segmentación deja de ser demostrativa.

## Referencias

- la decisión previa sobre OpenPLC — superseded por este
- la decisión previa sobre el rol del Brix — el rol del Brix
- `deploy/1-campo/README.md` — topología, causalidad y mapa de registros
- `docs/contracts/UNS.md` §7.4 — payloads de la celda
