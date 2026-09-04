# Segmentación de red — zonas y conductos

> Materializa el objetivo 4 del TFM: partir la red en zonas de confianza conforme a
> IEC 62443-3-2, de modo que la operación y el negocio no se comuniquen nunca de forma
> directa. La partición se aplicó **antes** de diseñar el flujo de datos, no después.

## Por qué esto es arquitectura y no configuración

Una zona agrupa activos con requisitos de seguridad homogéneos; un conducto es un canal de
comunicación explícitamente autorizado entre zonas. Lo que la norma aporta no es una lista
de reglas de cortafuegos, sino una idea con consecuencias sobre el diseño: **la partición
restringe qué arquitecturas son admisibles**.

Si la zona de operación no puede iniciar conexiones hacia la de negocio, entonces cualquier
diseño en el que un consumidor de negocio consulte directamente a un instrumento queda
descartado de antemano. Lejos de estorbar, esa restricción refuerza el patrón: una
arquitectura mediada por un espacio de nombres alojado en la zona intermedia la satisface
sin esfuerzo, porque la operación publica hacia el centro y el negocio consume desde el
centro.

## Las tres zonas

| Zona | VLAN | Red | Qué contiene | Política |
|---|---|---|---|---|
| **Operación (OT)** | 10 | `10.10.10.0/24` | Los cuatro dispositivos de la celda y el gateway de adquisición | No inicia conexiones hacia negocio. Solo publica hacia la zona intermedia |
| **Intermedia (DMZ)** | 20 | `10.10.20.0/24` | Bróker del espacio de nombres, registro de eventos, base de datos y servicios de consumo | Recibe de operación y sirve a negocio. Aislada por cortafuegos de ambos lados |
| **Negocio (IT)** | 30 | `10.10.30.0/24` | Estaciones de trabajo y consumidores finales | Consume dato ya contextualizado. No accede a operación |

El etiquetado 802.1Q viaja por un único enlace troncal entre el switch administrable y el
cortafuegos, que es quien enruta entre las tres redes y aplica las reglas.

## Matriz de conductos

| # | Origen | Destino | Servicio | Acción | Razón |
|---|---|---|---|---|---|
| 1 | OT | DMZ | MQTT (1883/8883) | **Permitir** | Es el único camino del dato hacia el espacio de nombres |
| 2 | OT | DMZ | Cualquier otro | Denegar | La operación no accede a bases de datos ni a servicios internos |
| 3 | OT | Internet | Cualquiera | Denegar | La celda no necesita salida; reduce la superficie de exposición |
| 4 | IT | DMZ | HTTP (80) hacia la web y los paneles | **Permitir** | Acceso al dato contextualizado |
| 5 | IT | DMZ | Administración remota | Permitir con autenticación fuerte | Plano de control, separado del de datos |
| 6 | IT | OT | Cualquiera | **Denegar** | No hace falta: es la propiedad que el trabajo demuestra |

**La fila 6 es la que da sentido a la tabla.** Que no exista un conducto entre negocio y
operación no es una carencia sino el resultado de que la arquitectura no lo necesita. Un
consumidor de negocio que quisiera el valor de un instrumento en una topología punto a punto
tendría que alcanzarlo, y esa necesidad es la que abre el agujero. Aquí no lo alcanza porque
no le hace falta: el dato ya está en la zona intermedia, contextualizado y con su definición.

**No hay ninguna excepción descendente.** El contrato no define categoría de mando
(`docs/contracts/UNS.md`, v0.5), así que ningún conducto baja hacia la operación. La
direccionalidad es absoluta y no «unidireccional salvo por…», que es la formulación por la
que estas arquitecturas se degradan con el tiempo.

## Plano de datos y plano de control

Son dos mecanismos separados a propósito, porque tienen requisitos distintos y no deben
compartir camino.

El **plano de datos** es la telemetría. Sale de la operación mediante una conexión iniciada
desde dentro, así que no exige abrir ningún puerto entrante hacia la celda.

El **plano de control** es el acceso administrativo. Viaja por un canal independiente con
autenticación por clave. La consecuencia práctica de mantenerlos separados es que la
telemetría no depende de que exista un túnel permanente, y que un fallo del canal de
administración **no** interrumpe el dato.

El error habitual es resolver la telemetría abriendo una red privada virtual permanente:
eso convierte un flujo unidireccional en un canal bidireccional de propósito general y
amplía la superficie de exposición sin necesidad.

## Qué cubre esto y qué no

Cubre la **segmentación**: qué puede hablar con qué, que es una propiedad topológica del
sistema y condiciona qué arquitecturas son admisibles.

No cubre el **control de acceso por identidad** a la capa de consumo. No hay proveedor de
identidad ni autenticación de usuarios frente a los paneles y la API. Es un problema
ortogonal —se puede tener uno sin el otro— y queda fuera por alcance y por
reproducibilidad: exigir un proveedor de identidad obligaría a registrar un cliente y
disponer de un dominio antes de poder ver un solo dato. Ver `alcance.md`.

El sistema, tal como se entrega, **protege el flujo pero no distingue a quien lo consulta**.
Es una limitación declarada, no un descuido.
