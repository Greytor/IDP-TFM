# Capítulo 5. IMPLEMENTACIÓN

> **Estado:** borrador v1.0 — 2026-09-04
> **Numeración:** Tablas desde la **22** · Ilustraciones desde la **19**, continuando el Capítulo 4.
> **Repositorio:** todo lo descrito aquí está publicado en https://github.com/Greytor/IDP-TFM [48]
> **Capturas pendientes:** marcadas con `[CAPTURA N]` en el punto exacto donde van.

---

El capítulo anterior definió qué se diseña y por qué. Este describe qué se construyó realmente, con qué versiones, cómo quedó conectado y qué problemas aparecieron por el camino. Todo el código, la configuración y la documentación de diseño están publicados en el repositorio del trabajo [48], por lo que este capítulo no reproduce ficheros completos sino que explica las decisiones de ingeniería y remite a la ruta concreta donde vive cada pieza.

El orden es el mismo en el que se construyó: primero el laboratorio físico, luego el campo, el borde, el centro y el consumo, y al final la red que los separa. El capítulo cierra con los problemas resueltos, que es donde el contrato de datos demuestra que sirve para algo más que documentar.

## 5.1 CONSTRUCCIÓN DEL LABORATORIO

### 5.1.1 El montaje

El laboratorio se montó sobre un mini rack abierto que aloja los cuatro equipos de la arquitectura más el switch. La Ilustración 19 muestra el conjunto tal como quedó.

*Ilustración 19 Laboratorio del proyecto: switch, cortafuegos, servidor central, nodo de campo y gateway industrial*

De arriba abajo se distinguen el panel de parcheo con los latiguillos hacia cada equipo, el switch administrable TP-Link TL-SG108PE que transporta las tres redes virtuales, el cortafuegos Edge 620 con OPNsense, el Dell OptiPlex 7080 que aloja el servidor central virtualizado, y debajo el Gigabyte Brix con los cuatro dispositivos simulados. En la bandeja inferior, sobre riel DIN y con su fuente de alimentación de 24 V, está el Siemens SIMATIC IOT2050 que hace de gateway de borde.

Que el gateway esté sobre riel DIN y con fuente industrial no es decorativo: es el único equipo del conjunto que en una instalación real viajaría al armario eléctrico de la planta del cliente, y montarlo así obliga a comprobar que arranca, se alimenta y se comunica en las condiciones en que lo haría allí.

El bastidor no es un producto comercial: se diseñó y se construyó a medida para este trabajo. Es un mini rack abierto de 13U en formato de 10 pulgadas —la variante reducida del estándar EIA-310, con 236,5 mm entre centros de carril y 44,45 mm por unidad—, armado con perfil de aluminio 2020 unido con escuadras metálicas y tuercas en T, de 256,5 × 260 × 625 mm exteriores y 216,5 mm de claro interior. Las placas frontales —panel de parcheo, bandeja ventilada del cortafuegos, soportes del OptiPlex y del Brix, y el panel de riel DIN de 3U del gateway— se imprimieron en PETG contra esa misma retícula.

Solo se recogen aquí las medidas que condicionan el montaje de los equipos. El diseño mecánico completo —modelo paramétrico del bastidor, plan de corte de los perfiles y las placas frontales listas para imprimir— está publicado como documento público de Onshape [49], por lo que el laboratorio es reproducible también en su parte física y no únicamente en la de software.

### 5.1.2 Orden de construcción

La construcción siguió un orden deliberado, de la red hacia arriba, con una regla: **ninguna capa se daba por terminada hasta que la siguiente podía consumir de ella**. Eso evitó el fallo habitual de construir todo el camino y descubrir al final que el formato no cuadra.

*Tabla 22 Orden de construcción y criterio de cierre de cada fase*

| # | Fase | Qué se construyó | Criterio para darla por cerrada |
|---|---|---|---|
| 1 | Red | VLAN, cortafuegos y reglas de conducto | Cada zona alcanza solo lo que la matriz autoriza |
| 2 | Servidor central | Hipervisor y máquina virtual | La máquina arranca, tiene dirección fija y se restaura desde instantánea |
| 3 | Campo | Los cuatro dispositivos simulados | Un cliente OPC UA y uno Modbus externos leen sus variables |
| 4 | Borde | Bróker local, adquisición y publicación | El árbol de topics del contrato aparece completo en el bróker |
| 5 | Centro | Bróker, registro de eventos y materialización | Una lectura de campo llega a la capa plata con su unidad y su calidad |
| 6 | Consumo | Paneles, API y aplicación web | Dos consumidores independientes leen el mismo dato sin conocerse |

### 5.1.3 Versiones desplegadas

Fijar las versiones importa porque la reproducibilidad es uno de los objetivos del trabajo. Todas las imágenes están ancladas a una versión concreta en los ficheros de composición, sin usar la etiqueta `latest` en ningún servicio.

*Tabla 23 Versiones del software desplegado*

| Capa | Componente | Imagen o paquete | Versión |
|---|---|---|---|
| Campo | Dispositivos simulados | `python:3.12-slim` + `asyncua`, `pymodbus` | 3.12 |
| Borde | Sistema operativo del gateway | Debian con núcleo de soporte industrial | 13 (trixie), `6.12.46-cip8` |
| Borde | Bróker local | `emqx/nanomq` | 0.23 |
| Borde | Gateway de adquisición | `nodered/node-red` | 4.0 |
| Borde | Procesador de flujo | `lfedge/ekuiper` | 2.0 |
| Centro | Hipervisor | Proxmox VE | 9.1.1 |
| Centro | Bróker del espacio de nombres | `emqx/emqx` | 5.8 |
| Centro | Registro de eventos | `redpandadata/redpanda` | 24.2 |
| Centro | Puente MQTT a registro | `redpandadata/connectors` (Benthos) | 4.x |
| Centro | Base de series temporales | `timescale/timescaledb-ha` | PG16 |
| Consumo | Paneles | `grafana/grafana-oss` | 11.4.0 |
| Consumo | API | FastAPI sobre `python:3.12-slim` | 0.115 |
| Consumo | Aplicación web | React con Vite, servida por `nginx` | 18 / 1.27 |
| Frontera | Cortafuegos | OPNsense | 26.1.7 |

```
[CAPTURA 1 — `docker compose ps` en las tres capas, o el panel de Portainer si se prefiere,
mostrando los contenedores levantados y su estado de salud. Sirve para evidenciar que las
tres composiciones arrancan y se mantienen sanas.]
```

## 5.2 CAMPO: LOS CUATRO DISPOSITIVOS SIMULADOS

### 5.2.1 Qué se construyó

Los cuatro dispositivos son procesos Python independientes, cada uno en su propio contenedor y con su propia dirección de red, publicados en `deploy/1-campo/sims/` [48]. Comparten una única imagen porque el código común de generación de señal y de enlace con el controlador vive en `sims/common/`, pero cada uno se lanza con su propio punto de entrada y expone su propio servidor.

*Tabla 24 Los cuatro dispositivos tal como quedaron implementados*

| # | Dispositivo | Servidor que expone | Puerto | Acceso | Código |
|---|---|---|---|---|---|
| 1 | `plc-llenado-01` | OPC UA (`asyncua`) | 4840 | Identificadores de nodo de cadena `ns=2;s=Llenadora.*` | `sims/plc_llenado/` |
| 2 | `valvula-01` | OPC UA (`asyncua`) | 4841 | `ns=2;s=Valvula.*` | `sims/valvula/` |
| 3 | `coriolis-01` | Modbus TCP (`pymodbus`) | 5020 | Función 3, registros 0–16, coma flotante de 32 bits | `sims/coriolis/` |
| 4 | `medidor-02` | Modbus TCP (`pymodbus`) | 5021 | Función 4, registros 0–11, coma flotante de 32 bits | `sims/medidor/` |

La diferencia entre la función 3 y la función 4 no es caprichosa: el caudalímetro expone registros de retención y el medidor registros de entrada, que es exactamente el reparto que se encuentra en instrumentación real y obliga a la capa de adquisición a distinguirlos.

En Modbus, cada valor en coma flotante ocupa **dos registros de dieciséis bits**, y hay que reconstruirlo respetando el orden de palabra. Los simuladores publican en orden de byte y de palabra ascendente, y el gateway lo reconstruye en la adquisición. Ese detalle, que en el capítulo 4 aparece como una frase, es en la práctica la clase de trabajo que absorbe la capa de adquisición para que el consumidor final no se entere de que existe.

```
[CAPTURA 2 — Un cliente OPC UA genérico (UaExpert o el propio explorador de Node-RED)
navegando el espacio de direcciones de `plc-llenado-01`, con el árbol de nodos desplegado.
Evidencia que el servidor es real y navegable, no una maqueta.]
```

```
[CAPTURA 3 — Un cliente Modbus genérico leyendo los registros de `coriolis-01`, mostrando
los valores en bruto de 16 bits y su reconstrucción a coma flotante. Evidencia la
heterogeneidad protocolar que el borde tiene que absorber.]
```

### 5.2.2 La causalidad entre dispositivos

El controlador ejecuta la máquina de estados descrita en el capítulo 4.3.4 y la publica por un canal REST interno que los otros tres consultan. La lógica vive en `sims/plc_llenado/model.py` y el cliente que la consume en `sims/common/plc_link.py` [48].

Ese canal es un **artefacto de la simulación** y merece insistir en ello, porque es lo que sostiene la validez del experimento. El gateway de borde llega a cada dispositivo por su protocolo industrial y no tiene forma de saber que existe: si leyera el estado global por REST en lugar de reconstruirlo desde los cuatro protocolos, estaría integrando contra una única fuente ya normalizada y el trabajo no demostraría nada.

Lo que sí se observa desde fuera es la consecuencia. Si se detiene el contenedor del controlador, los otros tres siguen sirviendo su protocolo con normalidad —un cliente Modbus sigue leyendo registros sin error— pero degradan a comportamiento de línea parada y lo señalizan: el caudalímetro y el medidor con un bit de su palabra de estado, y la válvula con una variable booleana de enlace. El gateway traduce esa señal a calidad `uncertain`, que es el mecanismo que impide entregar un valor plausible y silenciosamente equivocado.

```
[CAPTURA 4 — Secuencia de dos momentos: el árbol de topics con `q: "good"` en operación
normal, y el mismo árbol tras detener el contenedor del controlador, con las variables
afectadas en `q: "uncertain"`. Es la evidencia de que la degradación es observable.]
```

## 5.3 BORDE: ADQUISICIÓN, NORMALIZACIÓN Y ENCOLADO

El nodo de borde corre íntegro sobre el gateway industrial, con los cinco servicios definidos en `deploy/2-edge/docker-compose.yml` [48]. Es la capa donde el dato deja de ser un registro Modbus o un nodo OPC UA y pasa a ser un mensaje del contrato.

### 5.3.1 El envelope del contrato, categoría por categoría

Esta es la pieza central de la implementación y conviene exponerla completa, porque el contrato es lo que hace que todo lo demás funcione sin coordinación. Las seis categorías comparten tres campos y difieren en el resto según lo que transportan. El contrato íntegro está en `docs/contracts/UNS.md` [48].

*Tabla 25 Campos comunes a todos los envelopes del contrato*

| Campo | Tipo | Qué es | Por qué está |
|---|---|---|---|
| `ts` | Cadena ISO 8601 UTC con milisegundos | Tiempo de **evento**, generado en el origen | Separa el tiempo de evento del de ingesta, como exige el capítulo 3.2.3 |
| `src` | Cadena | Identificador del dispositivo, idéntico al nivel `cell` del tópico | Permite validar la coherencia entre tópico y contenido |
| `seq` | Entero | Número de secuencia monótono **por dispositivo** | Hace observable la pérdida y completa la clave de idempotencia |

**`def` — definición del activo.** Retenido, una vez por dispositivo. Lleva `rev` en lugar de `seq`, porque es una revisión y no un evento de una serie.

```json
// greytec/demo/produccion/llenado/coriolis-01/def        (QoS 1, retenido)
{
  "ts": "2026-09-02T10:00:00.000Z",
  "src": "coriolis-01",
  "rev": 1,
  "contract": "0.5",
  "asset": {
    "display_name": "Caudalímetro Coriolis",
    "type": "instrumento",
    "area": "Llenado",
    "parent": "plc-llenado-01",
    "protocol": "modbus-tcp",
    "endpoint": "10.10.10.100:5020"
  },
  "variables": {
    "mass_flow_kgh": {
      "display_name": "Caudal másico",
      "u": "kg/h", "type": "number", "channel": "dat/raw",
      "min_limit": 0, "max_limit": 2000, "deadband": 5,
      "source": {"protocol": "modbus-tcp", "fc": 3, "addr": "0-1", "encoding": "float32-be"}
    }
  }
}
```

**`dat/raw` — dato de proceso.** Retenido, un tópico por variable, envelope plano. Es el mensaje más frecuente del sistema y por eso el más ligero.

```json
// greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh
{ "ts": "2026-09-03T21:46:34.180Z", "src": "coriolis-01", "seq": 122956,
  "v": 1072.652, "u": "kg/h", "q": "good" }
```

**`dat/der` — dato derivado.** No retenido. Declara de qué se derivó y con qué transformación, que es lo que preserva la trazabilidad del origen.

```json
// greytec/demo/produccion/llenado/coriolis-01/dat/der
{ "ts": "...", "src": "ekuiper", "derived_from": "coriolis-01",
  "transform": "moving_avg_5m", "seq": 210,
  "payload": { "mass_flow_kgh_avg5m": {"v": 1247.8, "u": "kg/h", "q": "good"} } }
```

**`sts` — estado del dispositivo.** Retenido, porque el último estado conocido tiene significado permanente. Los campos varían según el dispositivo y los comunes son `online` y `fw_ver`.

```json
// greytec/demo/produccion/llenado/plc-llenado-01/sts        (retenido)
{ "ts": "...", "src": "plc-llenado-01", "online": true, "fw_ver": "sim-0.1.0",
  "state_text": "RUNNING", "auto_mode": true, "alarm_jam": false, "uptime_s": 3600 }
```

**`evt` — suceso discreto.** No retenido, porque un evento pasado no representa el presente. El campo `severity` permite al consumidor filtrar sin interpretar el texto.

```json
// greytec/demo/produccion/llenado/plc-llenado-01/evt
{ "ts": "...", "src": "plc-llenado-01", "evt_type": "jam_detected",
  "severity": "alarm", "msg": "Atasco detectado en la línea, transición a FAULT" }
```

**`diag` — canal de diagnóstico.** No retenido y agrupado, a diferencia de `dat/raw`: la salud del instrumento se interpreta en conjunto y no campo a campo, así que el objeto se publica entero si cualquiera de sus campos supera su umbral.

```json
// greytec/demo/produccion/llenado/coriolis-01/diag
{ "ts": "...", "src": "coriolis-01", "diag_type": "transmitter_health",
  "payload": { "drive_gain_pct": 8.4, "tube_freq_hz": 132.07, "sensor_temp_c": 41.2,
               "air_entrainment": false, "plc_link_ok": true } }
```

Que `dat/raw` sea plano y `diag` agrupado no es una inconsistencia sino una consecuencia del patrón de consumo: una variable de proceso se grafica sola y se suscribe sola, mientras que un diagnóstico se lee entero para decidir si el instrumento es fiable.

### 5.3.2 Adquisición y normalización

La adquisición se implementó en Node-RED, con un flujo por dispositivo definido en `deploy/2-edge/nodered/flows.json` [48]. Cada flujo repite la misma cadena: un disparador cíclico, la lectura por protocolo, un nodo que decodifica y nombra las variables, un nodo que aplica la publicación por excepción, y la salida al bróker local.

El sondeo es de uno a dos segundos según el dispositivo. Sobre esa cadencia se aplica el deadband de cada variable, declarado en el plano definitional, más un latido de treinta segundos que garantiza que el silencio nunca sea ambiguo. Sin ese latido, un consumidor no podría distinguir que un valor no ha cambiado de que el productor está muerto.

```
[CAPTURA 5 — El editor de Node-RED con los cuatro flujos desplegados, mostrando la cadena
completa de un dispositivo desde el disparador hasta la salida MQTT.]
```

```
[CAPTURA 6 — El nodo function de publicación por excepción abierto, con la constante
DEADBAND visible. Documenta el acoplamiento que se explica en el capítulo 5.7.]
```

### 5.3.3 El publicador de definiciones

Es el servicio propio que materializa la categoría `def`, en `deploy/2-edge/def-publisher/` [48]. Lee un fichero único y versionado, `definitions.yml`, valida su contenido y publica un mensaje retenido por dispositivo. Después termina, porque no hay nada que mantener vivo.

La decisión de que sea un servicio aparte y no un nodo más del flujo de adquisición tiene una razón: la definición y la adquisición cambian a ritmos distintos y por motivos distintos. El flujo cambia cuando cambia cómo se lee y la definición cambia cuando cambia qué significa lo leído. Separarlos permite que el modelo de datos de la instalación viva en un fichero legible y comparable entre versiones, en vez de sepultado dentro de un nodo function. La consecuencia práctica es que dar de alta un instrumento nuevo es editar un fichero de configuración y no editar un flujo.

El servicio no publica nada si la definición no valida. Comprueba que los nombres estén en minúsculas con guión bajo, que cada variable declare nombre legible, unidad, tipo y canal, que el canal sea uno de los válidos y que los límites sean coherentes. Es deliberado que falle cerrado porque una definición inconsistente contamina el espacio de nombres para todos los consumidores.

```
[CAPTURA 7 — La salida del contenedor def-publisher al arrancar, con las cuatro líneas de
publicación y el recuento de variables por dispositivo.]
```

```
[CAPTURA 8 — Un cliente MQTT suscrito a `+/+/+/+/+/def`, mostrando el árbol completo de
definiciones recibido al conectarse. Es la evidencia de que el espacio de nombres es
autodescriptivo: un consumidor nuevo obtiene el modelo de datos entero sin pedir nada.]
```

### 5.3.4 Salud del gateway

El servicio `edge-health` publica el diagnóstico del propio nodo de borde con el uso de procesador, memoria, disco, temperatura, red y estado de cada contenedor. Está en `deploy/2-edge/edge-health/` [48].

Publica además su propia definición, y lo hace de una forma que merece señalarse: en lugar de leerla de un fichero, la deriva del payload que acaba de medir. Como las métricas por contenedor dependen de qué contenedores están corriendo, declararlas estáticamente sería frágil. Al construir la definición desde el mismo diccionario del que sale el dato, la definición no puede divergir del flujo por construcción, ya que si una variable se publica es porque está declarada. Y si el conjunto de contenedores cambia, se republica con la revisión incrementada, que es exactamente el caso de uso que el contrato prevé para el campo `rev`.

### 5.3.5 Bróker local y almacenamiento y reenvío

NanoMQ hace de espacio de nombres del borde y de puente hacia el bróker central, configurado en `deploy/2-edge/nanomq/nanomq.conf.tpl` [48]. El puente usa calidad de servicio 1, sesión persistente y cola con persistencia en disco.

Esa combinación es lo que da la resiliencia ante corte de enlace, y conviene decir dónde está su límite real, que no es el protocolo sino la capacidad de la cola. El tiempo máximo de corte tolerable es el cociente entre la capacidad de encolado y la tasa de publicación agregada, lo que convierte una afirmación cualitativa en un parámetro dimensionable. Su medición se aborda en el capítulo 7.

```
[CAPTURA 9 — El árbol completo del espacio de nombres en un cliente MQTT, desplegado hasta
las cinco categorías que la celda publica: `def`, `dat/raw`, `sts`, `evt` y `diag`. Cada
dispositivo emite las que le corresponden —el caudalímetro tiene `diag` y el medidor no,
por ejemplo—, y `dat/der` no aparece porque el procesador de flujo está desplegado e
inactivo (capítulo 5.3.6). Es la evidencia visual de la jerarquía semántica del capítulo
4.5.1.]
```

### 5.3.6 El procesador de flujo, montado e inactivo

eKuiper se despliega en el borde pero no ejecuta ninguna regla. Es una decisión coherente con la taxonomía del capítulo 3.9.2, donde la analítica de flujo aparece como capacidad **condicional**: se activa si el volumen o la latencia lo justifican, y en esta instalación ninguno de los dos lo hace.

Dejarlo instalado y apagado, con un flujo de ejemplo preparado en `deploy/2-edge/ekuiper/streams/` [48], permite comprobar que cabe dentro del presupuesto de memoria del gateway y evita presentar como implementado algo que no se ejercita.

## 5.4 CENTRO: REGISTRO DE EVENTOS Y MATERIALIZACIÓN

El servidor central corre sobre una máquina virtual del hipervisor, con los nueve servicios de `deploy/3-central/docker-compose.yml` [48]. Virtualizar en lugar de instalar directamente sobre el sistema operativo permite tomar una instantánea antes de cada cambio mayor y volver atrás en minutos, que durante la construcción se usó más de una vez.

```
[CAPTURA 10 — El panel de Proxmox con la máquina virtual del núcleo, sus recursos
asignados y la lista de instantáneas tomadas durante la construcción.]
```

### 5.4.1 Del bróker al registro de eventos

EMQX recibe todo lo que publica el borde y lo distribuye a quien se suscriba. Delante del registro hay un puente que traslada el flujo MQTT al registro de eventos, configurado en `deploy/3-central/consumers/mqtt-bridge/` [48].

El puente hace una única traducción, y es la que permite que el registro herede la jerarquía sin código: **convierte las barras del tópico MQTT en puntos del nombre del tema del registro**. Así, `greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh` pasa a ser un tema del registro con el mismo camino semántico. La consecuencia es que la organización del espacio de nombres se conserva íntegra en el sistema de registro, y que añadir un dispositivo no obliga a configurar nada en el puente.

El puente usa sesión persistente, lo que significa que si el propio puente cae, el bróker retiene para él lo publicado mientras estuvo ausente. Es el patrón de suscriptor durable del catálogo del capítulo 3.4.2.

```
[CAPTURA 11 — El panel de Redpanda Console con la lista de temas creados automáticamente
a partir del árbol MQTT, mostrando que la jerarquía semántica se conserva en el registro.]
```

### 5.4.2 El consumidor de materialización

Es la pieza con más lógica propia del sistema, en `deploy/3-central/consumers/redpanda-to-tsdb/` [48]. Se suscribe al registro por patrón, enruta cada mensaje según su categoría y lo escribe en la capa bronce.

Tiene dos propiedades que conviene destacar porque son las que sostienen dos requisitos del capítulo 4.

**Enruta por categoría y nunca por dispositivo.** El enrutador mira únicamente los últimos segmentos del nombre del tema, así que un activo nuevo que respete el contrato se materializa sin tocar una línea de código: aparece en las tablas, se declara solo mediante su plano definitional y las vistas lo recogen. Es la forma que toma el requisito RF6 en la capa central.

**Toda escritura es idempotente.** Las inserciones usan claves naturales con resolución de conflicto, de modo que reprocesar el registro o recibir un duplicado no produce efecto observable. La clave es la terna de marca de tiempo, origen y secuencia para las lecturas, y la pareja de marca de tiempo y origen para los estados. Esto es lo que permite operar con calidad de servicio 1 en lugar de pagar el coste de la entrega exactamente una vez, según el argumento del capítulo 3.2.4.

El caso de `def` merece mención aparte. Como es un mensaje retenido, el bróker lo reentrega en cada reconexión del puente y el consumidor lo recibe muchas veces con la misma revisión. La escritura está condicionada por `rev`, así que reprocesarlo es gratuito y una revisión vieja reentregada tras un corte no puede pisar a una nueva ya aplicada.

### 5.4.3 Las capas del modelo medallón

Las tres capas viven en la misma base de datos y se definen en `deploy/3-central/consumers/redpanda-to-tsdb/init.sql` y en `deploy/3-central/sql/` [48].

*Tabla 26 Las tres capas tal como quedaron implementadas*

| Capa | Forma | Qué contiene | Se reconstruye desde |
|---|---|---|---|
| Bronce | Tablas con hipertabla temporal | El evento tal como llegó, con el payload íntegro y su marca de ingesta | El registro de eventos |
| Plata | Vistas | Una fila por marca de tiempo, origen y variable, con unidad, calidad y límites resueltos | La capa bronce |
| Oro | Vistas | Indicadores de negocio agregados por período | La capa plata |

La capa bronce son cinco tablas. Tres guardan series temporales —las lecturas de proceso, los estados y las alarmas— y son hipertablas, es decir, el motor las particiona por tiempo sin que la aplicación lo gestione. Las otras dos materializan el plano definitional, que no es una serie sino un catálogo con revisiones, y por eso son tablas ordinarias. Todas llevan además de la marca de tiempo del evento una **marca de ingesta**, que es lo que permite medir la latencia de contextualización sin instrumentar nada más: la diferencia entre ambas es exactamente lo que el capítulo 7 tiene que medir.

```
[CAPTURA 23 — Las tablas de la capa bronce declaradas como hipertablas de TimescaleDB.
Evidencia de que el particionado temporal lo resuelve el propio motor y no lógica de
aplicación, que es el argumento de la ADR-001.]
```

Las capas superiores se implementaron como **vistas y no como tablas materializadas**, aplicando el principio de no optimizar antes de tener evidencia de que hace falta. Mientras el volumen lo permita, la vista garantiza coherencia automática con la capa inferior, y cuando el volumen lo exija, convertirla en agregado continuo es una operación local que no altera el contrato de consumo ni obliga a tocar los paneles.

La capa plata es donde ocurre la contextualización: une la telemetría en bruto con el diccionario de variables mediante una reunión declarativa en SQL, de modo que cada lectura sale ya con su nombre legible, su unidad, su área y sus límites. Que eso sea una consulta y no código a medida es la razón de haber elegido un motor relacional con extensión temporal en lugar de una base de series temporales pura.

```
[CAPTURA 12 — Una consulta SQL sobre la capa plata mostrando el mismo dato en las tres
formas: el JSON en bruto de bronce, la fila contextualizada de plata y el indicador
agregado de oro. Es la mejor evidencia del refinamiento progresivo.]
```

```
[CAPTURA 13 — La vista `v_contrato_variables_sin_declarar` devolviendo cero filas. Es la
comprobación automática de la Regla 0 del contrato: ninguna variable llega a la base de
datos sin estar declarada en el plano definitional.]
```

## 5.5 CONSUMO: DOS CONSUMIDORES INDEPENDIENTES

La capa de consumo es la que demuestra el objetivo 3, y por eso importa que sean **dos consumidores construidos con tecnologías distintas, que no se conocen entre sí y que ninguno conoce a los productores**.

### 5.5.1 Paneles operativos

Grafana lee las vistas de la capa oro por SQL. Los cuatro tableros están versionados como ficheros en `deploy/3-central/consumers/dashboards/` [48], lo que permite reproducirlos en otra instalación sin rehacerlos a mano.

Es un consumidor puro: no publica nada, no escribe nada y no sabe que existe un bróker. Si mañana se apagara, ningún otro componente se enteraría.

```
[CAPTURA 14 — El tablero de operación con el estado de la línea, el caudal y los
contadores en tiempo real.]
```

```
[CAPTURA 15 — El tablero de gerencia con los indicadores agregados, para mostrar que el
mismo dato sirve a dos audiencias distintas sin duplicar integraciones.]
```

### 5.5.2 API y aplicación web

El segundo consumidor es la plataforma propia, con una API en `deploy/3-central/services/idp-api/` y una aplicación web en `deploy/3-central/services/idp-web/` [48]. La API sirve el dato contextualizado por HTTP y la aplicación lo consume, igual que podría hacerlo un sistema de terceros.

En esta edición del despliegue **no hay control de acceso**. La API no valida credenciales y la aplicación no tiene pantalla de acceso, de modo que quien clone el repositorio levanta el sistema y entra. Es una decisión de alcance y de reproducibilidad, declarada en el capítulo 4.1.2, y su consecuencia está acotada: el sistema protege el flujo mediante la segmentación de red, pero no distingue a quien lo consulta.

La interfaz del proveedor de sesión se conservó intacta en el código del front, de modo que reponer autenticación es sustituir un fichero y no rehacer las vistas.

```
[CAPTURA 16 — La aplicación web mostrando el espacio de nombres navegable, con las
variables de un dispositivo y su definición resuelta.]
```

```
[CAPTURA 17 — Una respuesta de la API en formato JSON, o la documentación interactiva
generada automáticamente, para evidenciar que el dato es consumible por terceros.]
```

## 5.6 RED: CÓMO QUEDÓ LA SEGMENTACIÓN

La segmentación se construyó primero, antes que ninguna otra capa, porque es una restricción previa de diseño y no un control posterior. La configuración completa se documenta en `docs/arquitectura/red-segmentacion.md` [48].

*Tabla 27 Redes virtuales y direccionamiento del laboratorio*

| VLAN | Zona | Red | Qué aloja |
|---|---|---|---|
| 10 | Operación (OT) | `10.10.10.0/24` | Nodo de campo y gateway de borde |
| 20 | Intermedia (DMZ) | `10.10.20.0/24` | Hipervisor y máquina virtual del núcleo |
| 30 | Negocio (IT) | `10.10.30.0/24` | Estación de trabajo y gestión del switch |

Las tres redes viajan etiquetadas sobre un único enlace troncal entre el switch administrable y el cortafuegos, que es quien enruta entre ellas y aplica las reglas. Que el cortafuegos sea hardware dedicado y no una función del router del proveedor permite versionar las reglas y reproducirlas en otra instalación, que es lo que exige el requisito RF10.

```
[CAPTURA 18 — La configuración de VLAN en el switch administrable, mostrando el puerto
troncal y los puertos de acceso de cada zona.]
```

```
[CAPTURA 19 — Las interfaces de OPNsense: (a) las tres redes con sus direcciones, y (b) los
dispositivos VLAN, donde las tres etiquetas cuelgan del mismo padre físico, que es el enlace
troncal descrito arriba.]
```

```
[CAPTURA 20 — El conjunto de reglas del cortafuegos para la zona de operación, donde se
ve que solo se autoriza la mensajería hacia la zona intermedia y todo lo demás queda
denegado por defecto.]
```

```
[CAPTURA 21 — El conjunto de reglas de la zona de negocio, donde se ve la ausencia de
cualquier regla hacia operación. Es la evidencia gráfica de la fila 6 de la matriz de
conductos, que es la propiedad que el trabajo demuestra.]
```

La zona intermedia tiene su propio conjunto de reglas, y es donde aparece el único conducto que desciende hacia la operación.

```
[CAPTURA 25 — El conjunto de reglas de la zona intermedia. La primera regla es el conducto
de administración descrito abajo; la segunda deniega explícitamente cualquier otro tráfico
hacia operación. Una de las reglas corresponde a un servicio ajeno al trabajo: el
cortafuegos del laboratorio da servicio también a equipos domésticos que comparten bastidor.]
```

**El acceso remoto de administración.** Una planta en la que no se puede entrar a mantener no es sostenible, así que el plano de control existe y está declarado. Se resuelve con una red superpuesta con autenticación por dispositivo cuyo único nodo es el propio cortafuegos: el administrador llega hasta él desde fuera y, desde ahí, alcanza la zona intermedia. El descenso hacia la operación no es libre, lo autoriza una sola regla, desde un único equipo de la zona intermedia, por SSH y con registro. Es el patrón de acceso remoto que recomienda IEC 62443, donde la conexión **termina en la zona intermedia y se vuelve a establecer bajo control** en lugar de alcanzar la celda directamente.

Que el nodo de la red superpuesta esté en el cortafuegos y no en el gateway de borde es deliberado, y es lo que mantiene cierta la fila 3 de la matriz de conductos. Si el gateway tuviera que hablar con el plano de control de un servicio en la nube para ser administrable, la zona de operación necesitaría salida a Internet, que es precisamente lo que la partición niega. Con el nodo en el cortafuegos, la celda no habla con Internet en ningún caso.

Los dos planos no comparten camino, y esa separación tiene una consecuencia comprobable: si el canal de administración cae, la telemetría sigue publicándose, porque el puente del borde solo necesita el conducto MQTT hacia la zona intermedia. Es lo contrario del error habitual de resolver el dato con una red privada virtual permanente, que convierte un flujo unidireccional en un canal bidireccional de propósito general.

La comprobación de que la partición funciona no es que las reglas estén escritas sino que el tráfico prohibido efectivamente no pasa. Desde la estación de trabajo de la zona de negocio no hay ruta hacia ningún dispositivo de campo, y el intento queda registrado en el cortafuegos.

```
[CAPTURA 22 — Un intento de conexión desde la zona de negocio hacia un dispositivo de
campo, y el registro del cortafuegos bloqueándolo. Es la validación empírica de la
segmentación, no solo su configuración.]
```

## 5.7 PROBLEMAS ENCONTRADOS Y RESUELTOS

Este capítulo sería incompleto si presentara la construcción como un camino recto. Los tres problemas que siguen aparecieron durante el desarrollo y se documentan porque los tres los detectó el propio contrato de datos, que es la mejor evidencia de que un contrato verificable no solo documenta sino que encuentra defectos.

*Tabla 28 Problemas detectados durante la construcción y cómo se resolvieron*

| # | Problema | Cómo se detectó | Resolución |
|---|---|---|---|
| 1 | Cuatro umbrales de publicación divergentes entre lo declarado y lo aplicado | Al implementar el plano definitional, comparando el fichero de definiciones con los nodos de adquisición | Se corrigieron a favor de lo desplegado |
| 2 | Dos variables de diagnóstico publicadas y no declaradas | La misma comparación | Se añadieron a la definición |
| 3 | El diccionario de variables se sembraba a mano en la capa derivada | Al revisar el cumplimiento del requisito RNF4 | Se materializa desde la categoría `def` |

### 5.7.1 Umbrales divergentes entre la definición y el flujo

Al construir el plano definitional hubo que declarar el deadband de cada una de las veintisiete variables, y al contrastar esos valores con los que aplicaban realmente los nodos de adquisición aparecieron cuatro discrepancias.

*Tabla 29 Discrepancias entre el umbral documentado y el umbral realmente aplicado*

| Variable | El contrato decía | El flujo aplicaba | Se resolvió a |
|---|---|---|---|
| `medidor-02.current_a` | 0,3 | **0,05** | 0,05 |
| `medidor-02.power_factor` | 0,05 | **0,01** | 0,01 |
| `medidor-02.frequency_hz` | 0,1 | **0,02** | 0,02 |
| `coriolis-01.drive_gain_pct` | 3 | **1** | 1 |

Todas se resolvieron a favor de lo desplegado, porque lo desplegado es la verdad: el sistema llevaba semanas publicando con esos umbrales y el documento era el que estaba desactualizado.

Lo relevante no es la corrección en sí, que es trivial, sino por qué apareció. Mientras el umbral fue un detalle interno del gateway, nadie tenía forma de saber que el documento y el flujo divergían, y un consumidor que interpretase el silencio de una variable estaba trabajando con un supuesto falso. Al declararlo en el contrato, la divergencia dejó de ser invisible.

Que el umbral se declare en la definición y se aplique en el nodo de adquisición no es una duplicación accidental: es la condición que hace posible la comprobación. Dos expresiones independientes de la misma decisión pueden contrastarse entre sí; un valor único no puede contrastarse consigo mismo, y la divergencia de la Tabla 29 habría permanecido invisible. Es el principio de la partida doble aplicado al modelo de datos, donde la redundancia controlada es lo que convierte un error en algo detectable.

La alternativa —que el nodo lea el umbral del propio `def` retenido— sustituye verificabilidad por consistencia: elimina la posibilidad de divergencia y, con ella, la de detectarla. Además traslada al arranque del gateway una dependencia del bróker que hoy no existe, porque los mensajes retenidos no sobreviven a un reinicio del bróker local y el publicador de definiciones se ejecuta una sola vez; el nodo de adquisición se quedaría sin umbrales y su modo de fallo sería el silencio, indistinguible de una variable que no cambia. Se optó por la verificabilidad, coherente con el papel que el capítulo 4 asigna al contrato como instrumento comprobable y no meramente descriptivo.

### 5.7.2 Variables publicadas y no declaradas

La misma comparación reveló que el canal de diagnóstico del caudalímetro publicaba dos variables booleanas, la detección de aire arrastrado y el estado del enlace con el controlador, que no figuraban en ninguna documentación. Existían, se publicaban y algún consumidor podría haberlas estado usando sin que el modelo de datos las reconociera.

Se añadieron a la definición, con lo que el total de la celda pasó a las veintisiete variables que declara el capítulo 4.3.3.

Este caso ilustra la Regla 0 del contrato mejor que cualquier explicación: una variable presente en el flujo y ausente de la definición es un defecto del productor, y la única forma de detectarlo sistemáticamente es que ambas cosas vivan en el mismo espacio de nombres y se puedan comparar. La comprobación quedó automatizada como una vista de la base de datos que debe devolver cero filas.

### 5.7.3 Una aplicación escribiendo en la capa derivada

El tercer problema es el más interesante desde el punto de vista arquitectónico, porque era una violación del propio marco teórico del trabajo.

El diccionario de variables, es decir qué significa cada campo, en qué unidad y con qué límites, vivía como una lista de inserciones literales en el script que crea la capa plata. Funcionaba, pero era exactamente lo que el requisito RNF4 prohíbe: una aplicación escribiendo directamente en un sistema derivado. Y era además el mismo defecto que el capítulo 2.5.8 reprocha a los productos comerciales, que es alojar el modelo semántico de la planta dentro del producto en lugar de en el espacio de nombres.

La categoría `def` lo cierra. El diccionario se publica ahora en el espacio de nombres, el consumidor lo materializa en la base de datos igual que materializa cualquier otro dato, y el script de la capa plata dejó de sembrar nada a mano. Si la base de datos se borra, el diccionario se reconstruye solo al reconectar, porque los mensajes de definición son retenidos.

```
[CAPTURA 24 — El diccionario de variables en `asset_tags`, con el nombre legible, la
unidad, el umbral de publicación y la revisión de cada variable. Ninguna de esas filas se
escribió a mano: viajan desde el fichero de definiciones del gateway hasta la base de datos
a través del espacio de nombres. Las variables del propio gateway muestran umbral nulo
porque publica en cadencia fija y no por excepción, y su definición lo declara así.]
```

La consecuencia práctica es que la capa derivada volvió a ser lo que el capítulo 3.2.1 dice que debe ser, es decir enteramente reconstruible y sin ninguna información que exista solo ahí.

### 5.7.4 Sustitución de la capa de adquisición

Además de los problemas encontrados, se ejercitó de forma deliberada la propiedad más fuerte que afirma el capítulo 4, que es que la capa de adquisición es sustituible sin efecto sobre nada aguas abajo, tal como exige el requisito RNF7.

La prueba consistió en sustituir la herramienta de adquisición por una alternativa comercial, manteniendo el contrato. Ningún componente aguas abajo requirió cambio alguno: el bróker siguió recibiendo los mismos tópicos con los mismos envelopes, el consumidor siguió materializando sin tocar una línea y los paneles siguieron dibujando.

Esa es la demostración de que el desacoplamiento no lo produce el bróker sino el contrato. Si el modelo canónico no existiera, cambiar la herramienta de adquisición habría obligado a revisar cada consumidor. El detalle del experimento y su medición se presentan en el capítulo 7.

## 5.8 SÍNTESIS DE LA IMPLEMENTACIÓN

Lo que se construyó es un sistema completo de extremo a extremo, desplegado sobre hardware modesto y reproducible por configuración, con veintisiete variables fluyendo desde cuatro dispositivos heterogéneos hasta dos consumidores que no se conocen entre sí.

De la construcción conviene retener tres cosas.

**El contrato no fue documentación sino una herramienta de diagnóstico.** Los tres problemas del capítulo 5.7 los encontró el contrato al obligar a declarar explícitamente lo que hasta entonces vivía implícito en la configuración. Ninguno se habría detectado con pruebas funcionales, porque el sistema funcionaba.

**Nada de lo construido exige coordinación entre las partes.** Añadir un dispositivo es escribir su definición y su flujo de adquisición, y ni el bróker, ni el registro, ni el consumidor, ni los paneles necesitan enterarse.

**La restricción de recursos y el razonamiento arquitectónico llegaron a la misma conclusión.** El gateway no aloja base de datos, y esa decisión se sostiene tanto por sus dos gigabytes de memoria como por el análisis del capítulo 3.3.3. Cuando una limitación práctica y un fundamento teórico coinciden, la decisión es sólida y no una racionalización posterior.

El capítulo siguiente analiza la viabilidad económica de llevar esta arquitectura a una instalación real.

---

## Notas de redacción para revisión con el director

1. **Numeración:** Tablas 22–29 e Ilustración 19, continuando la serie acordada del Capítulo 4.
2. **Capturas:** 22 marcadores repartidos por el capítulo, cada uno con la descripción de qué debe verse y por qué. Las tres más importantes para la defensa son la **8** (el árbol de definiciones recibido al conectarse), la **13** (la comprobación de la Regla 0 devolviendo cero filas) y la **21** (la ausencia de reglas entre negocio y operación).
3. **El capítulo 5.7 es el que más valor tiene ante el tribunal**, porque enseña que el contrato encuentra defectos y no solo los documenta. Conviene no recortarlo.
4. **Sobre la sustitución de la capa de adquisición (§5.7.4):** está anunciada aquí y medida en el capítulo 7. Hay que decidir si el experimento se presenta entero en el 7 o si aquí basta con el anuncio.
5. **Pendiente de verificar contra el despliegue final:** las versiones exactas de la Tabla 23, que están puestas con la mejor información disponible pero conviene confirmarlas antes de entregar.
6. **Si se rotulan las capturas como ilustraciones**, la serie del capítulo pasaría de la 19 a la 41, y el Capítulo 6 arrancaría en la 42. Conviene decidirlo antes de generar el índice de figuras.
