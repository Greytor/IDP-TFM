# Greytec IDP — edición TFM

Arquitectura de referencia para la interoperabilidad OT-IT basada en Unified Namespace.

Este repositorio acompaña al Trabajo de Fin de Máster **«Diseño, implementación y validación
de una arquitectura de referencia basada en Unified Namespace para la interoperabilidad
OT-IT en entornos industriales»** (Universidad Europea de Madrid, Máster Universitario en
Industria 4.0). Contiene el sistema completo que la memoria diseña, implementa y valida, y
únicamente eso: el alcance está declarado en [`docs/arquitectura/alcance.md`](docs/arquitectura/alcance.md).

**Autor:** José Fernando Desiderio Moreira · **Director:** Santiago Díaz Domínguez

---

## Qué demuestra

Cuatro dispositivos industriales heterogéneos —dos por OPC UA y dos por Modbus TCP— publican
sobre un mismo espacio de nombres, y dos consumidores independientes leen de él sin conocer
a ningún productor. Entre unos y otros no hay una sola integración punto a punto: hay un
contrato.

El registro de eventos es la **fuente de verdad**; la base de datos y los paneles son vistas
materializadas descartables y reconstruibles desde él.

## Por dónde empezar

| Si quieres… | Lee |
|---|---|
| Entender qué se publica y con qué garantías | [`docs/contracts/UNS.md`](docs/contracts/UNS.md) — **el artefacto central del trabajo** |
| Saber por qué cada pieza es la que es | [`docs/adr/`](docs/adr/README.md) — 14 decisiones con sus alternativas |
| Ver qué entra y qué no en el alcance | [`docs/arquitectura/alcance.md`](docs/arquitectura/alcance.md) |
| Desplegarlo | [`docs/arquitectura/despliegue.md`](docs/arquitectura/despliegue.md) |
| Acceder una vez levantado | `http://localhost` (plataforma) y `http://localhost:3000` (Grafana) |
| Verificar que el contrato se cumple | [`docs/arquitectura/despliegue.md`](docs/arquitectura/despliegue.md) §4 |

## El contrato es lo que hay que leer

La tesis que sostiene el trabajo es que **el desacoplamiento no lo produce el bróker sino el
modelo canónico de datos que ese bróker transporta**. Por eso el artefacto principal de este
repositorio no es ningún componente, sino `docs/contracts/UNS.md`: la jerarquía de topics
alineada con ISA-95, las seis categorías semánticas, los envelopes, la política de calidad de
servicio y retención por categoría, y las reglas de evolución.

Desde la versión 0.4 el contrato incorpora la categoría **`def`**, que publica de forma
retenida la definición de cada activo —identidad, unidades, límites, umbrales de publicación
y procedencia protocolar—. Es lo que hace el espacio de nombres autodescriptivo: quien se
suscribe a `+/+/+/+/+/def` recibe el modelo de datos completo de la celda al conectarse, sin
pedírselo a nadie.

## Estructura

```
docs/
  contracts/UNS.md            contrato del Unified Namespace (v0.5)
  adr/                        14 decisiones de arquitectura
  arquitectura/               alcance, segmentación de red y pendientes
deploy/
  1-campo/                    4 dispositivos simulados (OPC UA y Modbus TCP)
  2-edge/                     NanoMQ · Node-RED · eKuiper · edge-health · def-publisher
  3-central/                  EMQX · Redpanda · TimescaleDB · consumidores · API · web
```

Cada capa se despliega con `docker compose up -d --build` desde su carpeta. El orden y la
verificación están en `docs/arquitectura/despliegue.md`.

**No hace falta dominio ni cuenta de usuario.** El stack se levanta y se entra: no hay
proveedor de identidad ni pantalla de login, porque lo que se demuestra es la arquitectura
de datos. Es una decisión de alcance, documentada en `docs/arquitectura/alcance.md`.

## Cómo citar este repositorio

```
J. F. Desiderio Moreira, «Greytec IDP — arquitectura de referencia basada en Unified
Namespace para la interoperabilidad OT-IT», repositorio de software, 2026. [En línea].
Disponible en: https://github.com/Greytor/IDP-TFM
```

## Licencia y propiedad intelectual

El código y la documentación son propiedad de Greytec S.A.S. Se publican como material de
referencia académica asociado al TFM. Consultar `LICENSE`.
