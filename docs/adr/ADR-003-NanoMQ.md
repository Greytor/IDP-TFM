# ADR-003: Broker ligero para Store & Forward en edge IOT2050

**Status:** Aceptado — Revisado 2026-06-19 (Mosquitto → NanoMQ)
**Fecha:** 2026-5-5  
**Autores:** José Desiderio

---

## Contexto

Los edges deben tolerar caídas de WAN al broker central sin pérdida de datos, manteniendo persistencia local mientras se restaura conectividad.

El IOT2050 Advanced tiene 2 GB RAM y corre Node-RED + eKuiper como stack de adquisición y stream processing. Se necesita un broker MQTT local que sea lo suficientemente ligero para coexistir con ese stack sin saturar la memoria del dispositivo.

## Decisión

Usar **NanoMQ** como broker MQTT local en el edge IOT2050, con persistencia en disco y bridge configurado a EMQX central con QoS 1 y `clean_session=false`.

**Justificación del cambio respecto a la decisión inicial (Mosquitto):**
- NanoMQ tiene un footprint significativamente menor (~2–5 MB vs ~50 MB de Mosquitto), liberando más RAM para Node-RED y eKuiper.
- NanoMQ soporta MQTT bridging nativo hacia EMQX con las mismas capacidades de store-and-forward que Mosquitto.
- Con 2 GB RAM en el IOT2050, la restricción original ("Reservado para ARM <512 MB") no aplica — se eligió NanoMQ por eficiencia y alineamiento con el ecosistema EMQ (EMQX central), no por restricción de memoria.

## Alternativas consideradas

- **Mosquitto**: estándar de facto, comunidad masiva. Descartado por footprint mayor (~50 MB) y porque el margen de RAM en el IOT2050 es más valioso para Node-RED y eKuiper.
- **EMQX Edge**: footprint mayor (~150–300 MB), descartado por consumo de recursos excesivo para el IOT2050.
- **HiveMQ Edge**: comercial y con dependencia de vendor, descartado.

## Consecuencias

- ✅ Footprint mínimo (~2–5 MB) — deja RAM disponible para Node-RED y eKuiper
- ✅ Bridge nativo a EMQX con store-and-forward y persistencia en disco
- ⚠️ Comunidad más pequeña que Mosquitto — documentación más escasa
- ⚠️ No tiene rule engine local — la transformación es responsabilidad de Node-RED; el stream processing de eKuiper standalone (ADR-004)