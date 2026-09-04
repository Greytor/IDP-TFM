# ADR-006: Esquema de topics del UNS con namespaces semánticos

**Status:** Aceptado — Revisado 2026-07-01 (esquema formalizado en el contrato UNS; el borrador original de topics queda superseded)
**Fecha original:** 2026-05-05
**Autores:** José Desiderio

---

## Contexto

El UNS necesita una estructura de tópicos predecible que separe semánticamente los tipos de información (datos crudos, derivados, estado, eventos discretos, comandos, diagnóstico).

## Decisión

La estructura de topics, los envelopes de payload y las reglas de evolución se formalizan en el **contrato UNS** (`docs/contracts/UNS.md`), que es el documento canónico. Este ADR registra la decisión de fondo: **jerarquía ISA-95 + categorías semánticas como último nivel**.

Estructura canónica (contrato UNS §2):

```
{enterprise}/{site}/{area}/{line}/{cell}/{category}[/{subcategory}]
```

Categorías (contrato UNS §4):

- **`dat/raw`**: datos directos del PLC/sensor sin transformación — solo publican dispositivos de campo (vía el gateway edge)
- **`dat/der`**: KPIs, agregados y mediciones derivadas — solo publican procesadores (eKuiper, FastAPI)
- **`sts`**: estado del dispositivo (retained)
- **`evt`**: eventos discretos y alarmas (paro, cruce de umbral, respuesta a comando)
- **`cmd`**: comandos hacia el dispositivo, idempotentes por `cmd_id`
- **`diag`**: diagnóstico paralelo al lazo de control (patrón NOA)
- **`_` (prefijo reservado)**: datos calculados de sistema que no corresponden a un dispositivo físico (p.ej. `greytec/demo/_kpi/oee`) — reemplaza al namespace `system/` del borrador original

## Evolución respecto al borrador original (2026-05-05)

El borrador de este ADR proponía `.../{equipment}/raw/{metric}` con categorías `raw/`, `derived/`, `event/`, `cmd/`, `system/` y un topic por métrica. Al formalizar el contrato UNS v0.1 (2026-06-05) se ajustó:

| Borrador (superseded) | Contrato vigente | Razón |
|---|---|---|
| `raw/{metric}` — un topic por métrica | `dat/raw` — un mensaje por ciclo de muestreo con múltiples variables | Menos overhead MQTT en dispositivos; el payload `{v,u,q}` conserva la semántica por variable |
| `raw/` y `derived/` como categorías top | subcategorías bajo `dat` | `sts`/`evt`/`diag` no necesitan la distinción raw/der (asimetría documentada, contrato §5.3) |
| `event/` | `evt` + `sts` separados | El estado retenido (retained=true) tiene semántica distinta al evento discreto |
| `system/` | prefijo reservado `_` | Aplicable en cualquier nivel del árbol, no solo bajo site |
| `{tenant}` + `{equipment}` (7 niveles) | `{enterprise}` como raíz de tenant, `{cell}` como activo (6 niveles) | Alineación ISA-95; niveles intermedios opcionales (contrato §2.2) |

## Consecuencias

- ✅ Suscriptores filtran por intención (`+/+/+/+/+/dat/raw`, `.../evt`, …)
- ✅ Políticas de retention y QoS por categoría (contrato §3.2)
- ✅ Versionado y evolución del contrato con reglas explícitas (contrato §9)
- ✅ ACLs verificables en el broker (campo publica `dat/raw`, procesadores `dat/der`)
- ⚠️ Cualquier cambio de esquema es breaking change y requiere versionar el contrato — este ADR no se edita para eso; se versiona `docs/contracts/UNS.md`
