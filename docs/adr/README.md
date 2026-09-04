# Registro de Decisiones de Arquitectura (ADR)

Cada fichero documenta una decisión de diseño con su contexto, las alternativas que se
consideraron y las consecuencias que se aceptaron. Son la materia prima del Capítulo 4 de
la memoria.

## Índice y trazabilidad al marco teórico

La última columna remite a la implicación de diseño del Capítulo 3 que la decisión
materializa. Toda decisión de este repositorio se puede trazar a un fundamento teórico: esa
es la propiedad que se defiende.

| ADR | Decisión | Implicación (Cap. 3) |
|---|---|---|
| [ADR-001](ADR-001-TimescaleDB.md) | TimescaleDB como base de series temporales | 3.F |
| [ADR-002](ADR-002-Redpanda.md) | Redpanda como registro de eventos inmutable | 3.A |
| [ADR-003](ADR-003-NanoMQ.md) | NanoMQ como bróker de borde con almacenamiento y reenvío | 3.E |
| [ADR-004](ADR-004-Node-RED.md) | Node-RED como gateway de adquisición | 3.C |
| [ADR-005](ADR-005-Idempotencia.md) | Idempotencia en todos los sinks | 3.A |
| [ADR-006](ADR-006-Contrato-UNS.md) | Esquema de topics del UNS con categorías semánticas | 3.D |
| [ADR-007](ADR-007-CQRS-Edge.md) | CQRS en el borde, sin base de datos local | 3.B |
| [ADR-008](ADR-008-MQTT-JSON.md) | MQTT con JSON estructurado frente a Sparkplug B | 3.E |
| [ADR-009](ADR-009-Proxmox.md) | Proxmox como hipervisor del servidor central | — |
| [ADR-010](ADR-010-Segmentacion-OPNsense.md) | Segmentación OT/DMZ/IT con cortafuegos dedicado | 3.G |
| [ADR-011](ADR-011-Gateway-IOT2050.md) | IOT2050 como gateway de adquisición | 3.H |
| [ADR-012](ADR-012-Simuladores-Celda.md) | Simuladores Python multiprotocolo | — |
| [ADR-013](ADR-013-Medallon.md) | La lógica de KPI vive en SQL (bronce → plata → oro) | 3.F |
| [ADR-014](ADR-014-Topologia-Servicios.md) | Cuándo separar un servicio en otra imagen | — |

## Decisiones retiradas del alcance

El repositorio de desarrollo contiene otras diez decisiones que **no se conservan aquí**
porque la memoria no las defiende. Se listan para que el lector sepa que existieron y por
qué no están, no como omisión sino como poda deliberada:

| Decisión original | Motivo de la exclusión |
|---|---|
| Capa fog intermedia | Superseded: la arquitectura final tiene dos capas, borde y centro |
| Reconciliación borde↔centro | Superseded: al no haber base de datos en el borde, no hay estado que reconciliar |
| Brix como PLC virtual · OpenPLC como soft-PLC | Superseded por ADR-012: la simulación pasó a scripts Python multiprotocolo |
| Azure como nube objetivo | Fuera de alcance: el TFM no despliega en nube |
| Medidor energético físico · HMI BeagleBone | Hardware nunca integrado |
| Write-back de KPIs al UNS · React/Vite | Capa de explotación comercial, fuera de los objetivos del §1.3 |
| Authentik como proveedor de identidad | Retirado del despliegue: el repositorio se levanta sin login ni dominio para que sea reproducible |

La numeración de este repositorio es correlativa y propia: no coincide con la del
repositorio de desarrollo.

## Cómo se escribe un ADR aquí

Un ADR se redacta **antes** de implementar, no después. Estructura mínima:

1. **Status** — Propuesto / Aceptado / Superseded por ADR-XXX
2. **Contexto** — qué fuerza la decisión, con los números que la condicionan
3. **Decisión** — qué se hace, en una frase
4. **Alternativas consideradas** — qué más se evaluó y por qué se descartó
5. **Consecuencias** — lo que se gana (✅) y lo que se acepta pagar (⚠️)

El quinto punto es el que distingue un ADR de una justificación: si no hay nada en la
columna de lo que se paga, la decisión no se ha pensado lo suficiente.
