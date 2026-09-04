# ADR-002: Redpanda como deploy target, Kafka como referencia conceptual

**Status:** Aceptado  
**Fecha:** 2026-5-5  
**Autores:** José Desiderio

---

## Contexto

El stack requiere un log-based broker para fan-out a múltiples consumidores con replay independiente y fuente de verdad inmutable.

## Decisión

Desplegar **Redpanda** en producción por simplicidad operativa (sin JVM, sin ZooKeeper, single binary, low footprint). Aprender los **conceptos desde Kafka** porque hay material formativo más abundante. APIs cliente son idénticas, migración futura entre los dos es trivial.

## Alternativas consideradas

- **Apache Kafka puro**: rechazado por overhead operacional (JVM heap tuning, ZK/KRaft) en fog local con hardware modesto.
- **NATS JetStream**: viable y más liviano, pero ecosistema de connectors más limitado.
- **Apache Pulsar**: rechazado por complejidad operativa (BookKeeper).
- **Cloud-managed (Confluent Cloud, Kinesis, Event Hubs)**: rechazado por vendor lock-in y por requerir datos OT en tercero.

## Consecuencias

- ✅ Footprint operativo bajo, fácil de desplegar en cualquier cliente
- ✅ Kafka API compatibility = migrabilidad
- ✅ Performance excelente (C++ sin JVM)
- ⚠️ Empresa más joven (fundada 2019 como Vectorized); riesgo bajo pero presente
- ⚠️ Aprendizaje conceptual desde Kafka requiere "traducir" mentalmente algunos detalles