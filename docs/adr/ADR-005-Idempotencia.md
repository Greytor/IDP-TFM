# ADR-005: Idempotencia en todos los sinks
**Status:** Aceptado  
**Fecha:** 2026-5-5  
**Autores:** José Desiderio

---

## Contexto

MQTT QoS 1 garantiza at-least-once. Después de catch-up tras outages, pueden llegar duplicados al broker central y por consecuencia a los consumers que materializan a TimescaleDB.

## Decisión

Todos los sinks aguas abajo del log son **idempotentes**. Patrón canónico: `INSERT ... ON CONFLICT DO NOTHING` en TimescaleDB con primary key compuesta `(timestamp, source_uri, metric)`.

## Alternativas consideradas

- **QoS 2 exactly-once en todo**: rechazado por overhead y no resuelve duplicados a nivel de aplicación.
- **Deduplicación en stream processor**: agrega complejidad y latencia.

## Consecuencias

- ✅ Catch-up y reprocesos seguros
- ✅ Patrón estándar y bien entendido
- ⚠️ La PK debe diseñarse cuidadosamente para que no haya colisiones legítimas