# ADR-010: Firewall dedicado (appliance físico) con OPNsense

**Status:** Aceptado  
**Fecha:** 2026-5-5  
**Autores:** José Desiderio

---

## Contexto

El router Huawei EG8145V5 tiene capacidades limitadas y a veces opacas de VLAN/firewall. Para un proyecto que aspira a ser referencia profesional, depender del router del ISP es deuda técnica.

## Decisión

Se adquirió un **appliance OPNsense físico** (Atom C3558 4-core, 8 GB DDR4, 128 GB SSD, AES-NI/QAT) dedicado como router/firewall del laboratorio. El EG8145V5 queda solo como gateway a internet. El OPNsense realiza el routing inter-VLAN (OT/DMZ/IT), las reglas de firewall y la VPN (Tailscale). Configuración versionada en el repositorio (export sin secretos).

## Alternativas consideradas

pfSense (similar, BSD), VyOS (CLI puro, más complejo), MikroTik virtual (CHR).

## Consecuencias

- ✅ Routing inter-VLAN profesional
- ✅ Firewall serio con reglas versionables
- ✅ Buena práctica que se replica a clientes reales
- ⚠️ Un equipo más a operar (appliance dedicado)
- ⚠️ Curva de aprendizaje OPNsense