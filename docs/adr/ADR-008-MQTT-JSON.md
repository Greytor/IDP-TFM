# ADR-008: MQTT Plano + JSON vs SparkPlugB
**Status:** Aceptado  
**Fecha:** 2026-5-5  
**Autores:** José Desiderio

---

## Contexto

Sparkplug B aporta features valiosas (LWT/NBIRTH/NDEATH para detección automática de edges, payload binario eficiente) pero agrega complejidad significativa de implementación y debugging.

## Decisión

**Fase 1**: MQTT plano + JSON con esquema cuidadosamente diseñado y **heartbeat manual** + LWT custom. **Fase 2 o posterior**: migrar a Sparkplug B cuando un cliente serio (oil & gas, farma, alimentos grandes) o el caso Atmos multi-tenant lo exija.

## Compatibilidad forward

El payload JSON de Fase 1 debe usar campos alineados con Sparkplug B (`timestamp`, `value`, `quality`, `metric_name`) para que la migración sea ordenada.

## Consecuencias

- ✅ Adopción más rápida en Fase 1
- ✅ Debugging simple con clientes MQTT genéricos
- ⚠️ Heartbeat y LWT manual requieren código custom
- ⚠️ Migración futura a Sparkplug B es proyecto separado (no traumático si Fase 1 está bien diseñada)