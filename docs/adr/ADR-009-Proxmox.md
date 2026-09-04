# ADR-009: Proxmox como hipervisor en servidor central

**Status:** Aceptado  
**Fecha:** 2026-5-5  
**Autores:** José Desiderio

---

## Contexto

El Dell 7080 ya tiene Proxmox VE instalado (`pve.greytec.ec`). Aprovechar su capacidad de virtualización en lugar de instalar Docker bare-metal.

## Decisión

Usar **Proxmox VE** como hipervisor del fog central. El stack central corre como **VM(s) o LXC containers** dentro de Proxmox. Esto permite:
- Snapshots antes de cambios mayores
- Aislamiento entre componentes (si se elige granularidad VM-por-componente)
- Migración en vivo si se escala a múltiples hosts
- Backups vía Proxmox Backup Server

**Estructura propuesta:**
- 1 LXC: stack central completo en Docker Compose (más simple, cabe en 8 GB)
- O bien: 4-5 LXC separados (EMQX, Redpanda, TimescaleDB, MinIO+Grafana+FastAPI) si se quiere granularidad mayor — más operativo pero más overhead

## Alternativas consideradas

Empezar con **un solo LXC con Docker Compose interno** (simplicidad). Evolucionar a multi-LXC si la granularidad se requiere.

## Consecuencias

- ✅ Snapshots y backups nativos
- ✅ Aprovechar Proxmox ya instalado
- ✅ Aislamiento opcional según necesidad
- ⚠️ Curva de aprendizaje Proxmox si no se domina ya
- ⚠️ Overhead de virtualización (mínimo con LXC)