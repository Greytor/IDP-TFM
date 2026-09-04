# ADR-001: TimescaleDB como TSDB del stack

**Status:** Aceptado  
**Fecha:** 2026-5-5  
**Autores:** José Desiderio

---

## Contexto

El stack requiere motor de almacenamiento para series temporales de planta con necesidad de correlacionar con contexto relacional (equipos, eventos, configuración multi-tenant).

## Decisión

Adoptar TimescaleDB (extensión sobre PostgreSQL) como motor TSDB del stack de referencia.

## Alternativas consideradas

- **InfluxDB 2.x/3.x**: rechazado por roadmap turbulenta (cambios 1.x→2.x→3.x con incompatibilidades) y JOIN limitado con datos relacionales contextuales.
- **PostgreSQL puro sin TimescaleDB**: rechazado por desempeño en agregaciones temporales y por falta de hipertablas y compresión columnar.
- **Cassandra / ScyllaDB**: rechazado por curva operativa y overkill para escala objetivo (plantas medias).

## Consecuencias

- ✅ Una sola base motor cubre dos roles: time-series + relacional contextual
- ✅ Talento SQL ampliamente disponible
- ✅ JOIN nativo entre datos de planta y contexto ISA-95
- ⚠️ Equipo debe profundizar en hipertablas, compresión, continuous aggregates
- ⚠️ Algunas features avanzadas son enterprise (evaluar costo si se necesitan)


