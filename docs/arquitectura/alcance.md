# Alcance del repositorio

> Este repositorio contiene **la versión académica** de la plataforma que sustenta el
> Trabajo de Fin de Máster. No es el repositorio de desarrollo de Greytec IDP: es un corte
> congelado que incluye únicamente lo que la memoria diseña, implementa y defiende.

## Los cinco objetivos que este repositorio materializa

| # | Objetivo del TFM (§1.3) | Dónde se materializa |
|---|---|---|
| 1 | Formalizar el contrato del Unified Namespace | `docs/contracts/UNS.md` (v0.5) |
| 2 | Arquitectura dirigida por eventos de extremo a extremo | `deploy/1-campo`, `deploy/2-edge`, `deploy/3-central` |
| 3 | Demostrar el desacoplo productor/consumidor | 4 productores heterogéneos, 2 consumidores independientes |
| 4 | Seguridad por diseño OT/DMZ/IT (IEC 62443) | `docs/arquitectura/red-segmentacion.md` |
| 5 | Replicabilidad por configuración, no por rediseño | Todo el despliegue es Docker Compose |

## Qué entra

**Campo (`deploy/1-campo`)** — cuatro dispositivos simulados en Python, cada uno un
contenedor independiente con su propio ciclo de vida, hablando protocolo industrial real:

| Dispositivo | Protocolo | Papel en la celda |
|---|---|---|
| `plc-llenado-01` | OPC UA | Controlador: máquina de estados de la línea |
| `valvula-01` | OPC UA | Actuador: posicionador con dinámica y desgaste |
| `coriolis-01` | Modbus TCP (FC3) | Instrumento de proceso + canal de diagnóstico NOA |
| `medidor-02` | Modbus TCP (FC4) | Instrumento de energía de la celda |

**Borde (`deploy/2-edge`)** — NanoMQ (bróker local y puente con almacenamiento y reenvío),
Node-RED (adquisición y normalización al contrato), eKuiper (procesamiento de flujo),
`edge-health` (salud del gateway) y `def-publisher` (plano definitional).

**Central (`deploy/3-central`)** — EMQX (bróker UNS), Redpanda (registro de eventos
inmutable), TimescaleDB (materialización en capas bronce/plata/oro), el puente
MQTT→Redpanda, el consumidor idempotente, y los dos consumidores del dato ya
contextualizado: Grafana y la plataforma propia (`idp-api` + `idp-web`).

## Qué queda fuera, y por qué

| Pieza | Motivo |
|---|---|
| `kpi-writeback` | Republicar los KPIs al UNS es el patrón consumidor-productor del contrato §10.3. Es interesante pero no responde a ningún objetivo del §1.3. Línea futura. |
| `idp-reports` | Informes en PDF. Valor comercial, no académico. |
| MinIO | Almacenamiento frío en Parquet. El objetivo 2 pide el registro inmutable y las capas medallón, que cubre Redpanda y TimescaleDB. |
| pgAdmin | Herramienta de desarrollo. |
| Authentik (OIDC) y despliegue con dominio | Control de acceso a la capa de consumo. Ortogonal a los objetivos y un obstáculo para reproducir el trabajo. |
| ESP32, LoRa, medidor físico, HMI | Hardware nunca integrado. Estaba en el plan del IDP, no en el alcance del TFM. |
| Ansible, multi-tenancy, despliegue en nube | Automatización y explotación comercial, fuera de los objetivos. |

**Sin autenticación y sin dominio.** Se retiraron los tres contenedores de Authentik y
toda dependencia de un nombre de dominio. `idp-api` ya no valida tokens e `idp-web` ya no
tiene flujo de login: quien clone el repositorio levanta el stack y entra. La razón es de
alcance —lo que se demuestra es la arquitectura de datos, no el control de acceso— y de
reproducibilidad: exigir un proveedor de identidad obligaba a registrar un cliente OIDC y
disponer de un dominio antes de poder ver un solo dato. La interfaz del proveedor de sesión
se conservó intacta en el front, de modo que reponerlo es sustituir un fichero.

## Los cuatro productores y los dos consumidores

El objetivo 3 se sostiene sobre esta heterogeneidad, que es real y no nominal:

- **Productores**: dos hablan OPC UA y dos Modbus TCP; dos son instrumentos, uno es un
  actuador y otro un controlador; uno publica además un canal de diagnóstico NOA. Ninguno
  sabe que el UNS existe: es el borde quien traduce.
- **Consumidores**: Grafana lee las vistas de la capa oro por SQL; `idp-api` sirve el mismo
  dato por HTTP a `idp-web` y a cualquier cliente externo. Son independientes entre sí y
  ninguno conoce a los productores.

La evidencia de desacoplamiento es que **apagar un productor no afecta a los demás ni a los
consumidores**, y que la capa de adquisición se sustituyó por una herramienta comercial sin
modificar nada aguas abajo.

## Relación con el repositorio de desarrollo

`IDP-Greytec` sigue evolucionando con las piezas que aquí quedaron fuera. Este repositorio
no recibe esos cambios: su función es ser reproducible y citable tal como se defendió.
