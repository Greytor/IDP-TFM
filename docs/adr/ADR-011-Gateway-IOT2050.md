# ADR-011: IOT2050 como Edge Gateway de adquisición

**Status:** Aceptado — Revisado 2026-06-24 (stack edge definitivo: NanoMQ + Node-RED + eKuiper)
**Fecha original:** 2026-06-05
**Autores:** José Desiderio

---

## Contexto

El IOT2050 Advanced (ARM Cortex-A53 quad-core, **2 GB RAM**) es el edge gateway industrial del laboratorio. Es el único equipo en la arquitectura con capacidad de RS-485 nativo, certificación industrial y factor de forma para riel DIN — atributos que lo hacen transportable a clientes reales.

Con 2 GB RAM compartidos entre OS y stack de aplicación, no es viable instalar una base de datos ni un visualizador pesado junto con los servicios de adquisición y mensajería.

## Decisión

El IOT2050 corre exclusivamente el **stack de adquisición y mensajería edge**:

| Servicio | Rol | RAM estimada | Licencia |
|---|---|---|---|
| **NanoMQ** | Broker MQTT local + bridge QoS 1 a EMQX central | ~10 MB | Apache 2.0 |
| **Node-RED** | Cliente Modbus TCP + OPC UA + normalización UNS + Node-RED Dashboard | ~150 MB | Apache 2.0 |
| **eKuiper** | Stream processing: deadband, KPIs derivados, detección de anomalías | ~80 MB | Apache 2.0 |
| OS + overhead | — | ~300 MB | — |
| **Total** | — | **~540 MB / 2048 MB** | — |

**No corre** en el IOT2050: TimescaleDB, Grafana, PostgreSQL, ni ninguna base de datos. El historial y la visualización profunda son responsabilidad del stack central (Dell/Proxmox).

**Dashboard local:** Node-RED Dashboard (`node-red-dashboard`) corre dentro del mismo proceso de Node-RED. El operador de campo accede desde cualquier navegador en la VLAN OT a `http://10.10.10.4:1880/ui`. Muestra valores en tiempo real con buffer configurable en memoria (~1 hora). No requiere WAN.

**Stack central:** el IOT2050 publica al EMQX central vía bridge NanoMQ (QoS 1, `clean_session=false`). Si la WAN cae, NanoMQ encola hasta `max_send_queue_len 10000` mensajes y los entrega íntegros al reconectar. Al ritmo del lab (~2.1 msg/s: soft-plc `dat`+`sts` a 1 Hz + `diag` cada 10 s) eso da **~80 minutos de backlog** — cumple el objetivo mínimo de 1 h del plan; para el objetivo extendido de 24 h, habilitar el cache en disco del bridge (`bridges.mqtt.cache` en `nanomq.conf.tpl`) o reducir la frecuencia de publicación.

## Alternativas consideradas

| Opción | Contra | Estado |
|---|---|---|
| TimescaleDB edge + Grafana | ~400 MB adicionales de RAM; historial local redundante con Redpanda central | Descartado (ADR-007) |
| SQLite + Grafana plugin | ~300 MB para Grafana; sink adicional a gestionar | Reservado si cliente exige historial offline en campo |
| NeuronEX como gateway de adquisición | Plugins avanzados (OPC UA, S7) requieren licencia comercial | Diferido para alta densidad de tags (ADR-004) |
| Mosquitto como broker | Footprint mayor (~50 MB) vs NanoMQ (~10 MB) | Descartado (ADR-003) |

## Consecuencias

- ✅ Stack completo ocupa ~540 MB — margen amplio para picos y OS
- ✅ Sin base de datos en el edge: no hay drift, no hay reconciliación, no hay backups locales
- ✅ Dashboard local funciona sin WAN
- ✅ Todo open source, sin licencias comerciales
- ✅ El IOT2050 es transportable: el mismo `docker-compose.yml` se despliega en cualquier IOT2050 en cliente
- ⚠️ Sin historial offline: si la WAN cae, el dashboard muestra solo lo que cabe en el buffer en memoria
- ⚠️ Consultas históricas desde campo requieren WAN activa al Grafana central
