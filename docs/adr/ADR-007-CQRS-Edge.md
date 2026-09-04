# ADR-007: CQRS en Edge

**Status:** Aceptado — Revisado 2026-06-24 (eliminación de TimescaleDB edge; Node-RED Dashboard como read model local)
**Fecha original:** 2026-05-05
**Autores:** José Desiderio

---

## Contexto

El IOT2050 (2 GB RAM, ARM Cortex-A53) necesita servir un dashboard local que funcione sin WAN y exponer datos en tiempo real al operador de campo, sin comprometer la RAM disponible para NanoMQ, Node-RED y eKuiper.

La decisión original (2026-05-05) introducía TimescaleDB como read model local en el edge y Grafana para la visualización. Eso suponía ~150-200 MB adicionales para PostgreSQL/TimescaleDB y ~250 MB para Grafana, comprometiendo el margen de RAM del IOT2050. Tras reevaluar, se eliminó la DB edge y se adoptó un modelo más simple.

## Decisión

Aplicar **CQRS estricto en el edge** sin base de datos local:

1. **NanoMQ es el log de eventos del edge** — toda escritura ocurre publicando al broker, nunca directamente a ningún store.
2. **Node-RED Dashboard es el read model local** — sirve datos en tiempo real desde el stream de NanoMQ, con un buffer en memoria configurable (últimos N minutos). No requiere proceso ni disco adicional; corre dentro del mismo Node-RED.
3. **eKuiper publica datos derivados de vuelta a NanoMQ** — KPIs, deadband, agregados. Los topics `derived/` y `event/` se generan en el edge y fluyen por el mismo broker, sin ningún sink local externo.
4. **Ningún componente edge escribe a una DB** — si se necesita historial profundo, se consulta al stack central (cuando hay WAN) o se acepta que el dashboard edge es solo "ventana viva".
5. **El bridge NanoMQ → EMQX central es el mecanismo de persistencia real** — el dato no se pierde en el edge porque NanoMQ lo encola con QoS 1 hasta que el central lo confirme.

## Por qué no hay TimescaleDB en el IOT2050

| Componente | RAM | Necesidad real |
|---|---|---|
| TimescaleDB (PostgreSQL mínimo) | ~150-200 MB | Historial profundo, queries complejas |
| Grafana | ~250 MB | Dashboards configurables |
| **Total si se añaden** | **~400 MB adicionales** | — |

El operador de campo en campo necesita ver el estado actual y una tendencia de los últimos 30-60 minutos. Eso lo cubre Node-RED Dashboard completamente, sin base de datos. El historial profundo es responsabilidad del stack central (TimescaleDB central con 1-2 años de retención). La DB edge sería una vista materializada redundante que consume RAM valiosa sin añadir durabilidad real (el log autoritativo es Redpanda en el central).

## Alternativas consideradas

- **TimescaleDB edge + Grafana**: descartado — ~400 MB de RAM en un dispositivo de 2 GB que ya corre NanoMQ + Node-RED + eKuiper. Añade complejidad sin durabilidad real (el log está en Redpanda).
- **SQLite + Grafana plugin**: factible técnicamente (~50 MB), pero añade un tercer proceso y un sink adicional. Se reserva como opción si el cliente exige tendencias históricas offline en campo.
- **Grafana con MQTT datasource (sin DB)**: viable (~250 MB), misma UI que el central. Descartado por ahora — el costo en RAM de Grafana solo para streaming no justifica frente a Node-RED Dashboard ya incluido en el mismo proceso.

## Consecuencias

- ✅ Stack edge completo ocupa ~300 MB de RAM (NanoMQ + Node-RED + eKuiper)
- ✅ Dashboard local funciona sin WAN — Node-RED Dashboard sirve desde buffer en memoria
- ✅ Ningún componente edge escribe a disco salvo NanoMQ (persistencia de cola de mensajes)
- ✅ Sin gestión de schema, migraciones ni backups en el edge
- ✅ Si el IOT2050 cae y se reinicia, el dashboard vuelve a mostrar datos en segundos — sin proceso de recovery de DB
- ⚠️ Sin historial offline en campo: si cae la WAN, el dashboard muestra solo lo que cabe en el buffer en memoria de Node-RED (~1 hora configurable)
- ⚠️ Consultas históricas en campo requieren WAN activa hacia el Grafana central
