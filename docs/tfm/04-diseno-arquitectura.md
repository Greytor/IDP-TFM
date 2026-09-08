# Capítulo 4. DISEÑO DE ARQUITECTURA

> **Estado:** v2.0 — sincronizado con el documento Word (TFM p5, 2026-09-03).
> **Fuente de verdad:** el Word. Este `.md` lo reproduce para poder trabajar sobre él.
> **Numeración acordada:** Tablas **5–21** · Ilustraciones **10–18**.
> El Capítulo 5 arranca por tanto en la **Tabla 22** y la **Ilustración 19**.
> **Correcciones pendientes de trasladar al Word:** anexo al final del fichero.

---

Este capítulo traduce el marco en una arquitectura concreta que define qué se construye, sobre qué supuestos, con qué contrato de datos y bajo qué restricciones de red. Para este diseño primero se definirá el caso de referencia con sus dispositivos y variables para luego presentar la arquitectura de software y el contrato de datos, acompañado de la segmentación de red y el registro de decisiones de diseño.

Una convención que atraviesa todo el capitulo es la de que cada decisión de diseño queda registrada como un ADR (*Architectural Decision Record*), que es un listado breve que fija el contexto que fuerza la decisión, la decisión en sí mismo, las alternativas evaluadas y las consecuencias que se aceptan. El registro completo de ellas se recoge en el capítulo 4.7 y se citarán las decisiones con sus identificadores numéricos.

## 4.1 ALCANCE Y ESCENARIO DE REFERENCIA

### 4.1.1 La celda de llenado como caso de uso

Una arquitectura de datos se construye a la medida de una necesidad, por lo que se plantea un caso de uso concreto que produzca variables con significado, ritmos distintos y modos de fallo reales. Sin eso, cualquier decisión sobre contratos, categorías o garantías de entrega queda sin criterio para evaluarse.

El caso elegido es una **celda de llenado de botellas** de la industria de alimentos y bebidas. Es un proceso deliberadamente pequeño (con cuatro dispositivos propuestos) pero completo en las dimensiones que importan para este trabajo:

- **Tiene control real**: No solo telemetría, un controlador comanda una válvula y cierra un lazo sobre la masa dosificada.
- **Tiene instrumentación de proceso y de servicio**: un caudalímetro que mide el producto y un medidor eléctrico que mide el consumo de la celda. Son dos naturalezas de dato que suelen vivir en sistemas distintos y que aquí conviven en el mismo espacio de nombres.
- **Tiene diagnóstico separado del proceso**: el caudalímetro publica su propia salud por un canal paralelo, que es el patrón NOA descrito en el apartado 2.4.5.
- **Tiene variedad de protocolos**: dos dispositivos hablan OPC UA y dos hablan Modbus TCP, que es exactamente la mezcla que se encuentra comúnmente en una planta brownfield.
- **Tiene modos de fallo con causalidad**: los instrumentos dependen del controlador, y esa dependencia se propaga a la calidad del dato de forma observable.

Se plantea un llenado mediante flujo másico porque dosificar por masa exige un caudalímetro Coriolis, que es un instrumento que mide varias magnitudes a la vez (caudal másico, caudal volumétrico, densidad y temperatura) y que además expone un conjunto rico de variables de diagnóstico propio. Eso da material real para demostrar tanto la contextualización como el segundo canal.

### 4.1.2 Supuestos y simplificaciones declaradas

Para defender la arquitectura planteada se declaran los siguientes supuestos o simplificaciones del escenario:

*Tabla 5 Supuestos y simplificaciones del escenario con su efecto sobre lo que se puede afirmar en las conclusiones*

| # | Supuesto o simplificación | Qué implica de cara a las conclusiones |
|---|---|---|
| 1 | El proceso físico de la celda de llenado no existe. Los cuatro dispositivos que usaremos son scripts Python que generan el comportamiento del proceso. | Nada de lo que se afirma en este trabajo se refiere a la exactitud de la medida o del comportamiento de la celda. Lo que se valida es el tratamiento y el procesamiento de los datos. |
| 2 | Los dispositivos sí son reales como interlocutores pues cada uno expone un servidor OPC UA o Modbus TCP auténtico, con su propio contenedor y con su propia dirección. | La capa de adquisición hace exactamente el mismo trabajo que haría contra equipos físicos de descubrir nodos, leer registros, gestionar reconexiones. |
| 3 | No hay lógica IEC 61131-3. El controlador simulado no ejecuta un programa de PLC con ciclo de scan | El trabajo no afirma nada sobre programación de contenedores. |
| 4 | La causalidad entre dispositivos es real: El controlador manda a la válvula, la válvula mueve su posición con dinámica de actuador, el caudalímetro mide el caudal resultante y el medidor refleja el consumo del estado de línea, programado desde los scripts de simulación. | Los modos de fallo que se observan son emergentes, no programados: si el controlador cae, los otros tres se degradan solos y lo señalizan. |
| 5 | Los simuladores se coordinan por un canal REST interno que no forma parte de la superficie de integración. | Ese canal es un artefacto de la simulación para simular un proceso real y con causalidad. La capa de adquisición no la toca y solo habla Modbus TCP y OPC UA. |
| 6 | La escala es de decenas de variables. | Las conclusiones sobre el régimen de crecimiento son estructurales y se pueden extrapolar. |
| 7 | No hay control de acceso en la capa de consumo | Para el diseño de este trabajo no se contempla un control de acceso para los consumidores y vistas derivadas. |

Cabe resaltar que el supuesto 5 plantea que los cuatro dispositivos a simular se comunican entre sí solo para reproducir un comportamiento coherente, pero esa comunicación interna es irrelevante a ojos de la arquitectura a desarrollar.

### 4.1.3 Inventario disponible para la implementación

La arquitectura se diseña contra el hardware que realmente está disponible en un laboratorio. Uno de los objetivos del trabajo es que la solución sea replicable en una planta de tamaño medio y eso obliga a demostrar que funciona sobre equipos modestos.

*Tabla 6 Inventario de hardware del laboratorio y su papel en la arquitectura*

| # | Equipo | Especificación relevante | Papel en el TFM | Zona |
|---|---|---|---|---|
| 1 | Siemens SIMATIC IOT2050 Advanced | TI AM6547 quad-core ARM a 2,2 GHz – **2GB DDR4** – eMMC de 14,8 GB – 2xEthernet – RS485 nativo – riel DIN – Debian 13 con núcleo de soporte industrial de largo plazo | Aloja el nodo de borde completo: Bróker local, Gateway de adquisición, publicador de definiciones, servicio de salud y procesador de flujo | OT |
| 2 | Gigabyte BRIX | X86 – 4 GB RAM - Linux | Aloja los cuatro dispositivos simulados de la celda, que exponen OPC UA y Modbus TCP como lo haría el equipo físico | OT |
| 3 | Dell OptiPlex 7080 | Intel Core i5-10500T – 16 GB RAM – 256 GB – Hipervisor Proxmox VE | Aloja el núcreo central de la arquitectura y las capas de datos derivados en máquina virtual sobre hipervisor | DMZ |
| 4 | Appliance OPNsense Edge 620 | Intel Atom C3558 de 4 núcleos – 8GB DDR4 – 128 GB SSD | Enrutamiento entre zonas, reglas de conducto y separación del plano de control | OT/IT/DMZ |
| 5 | Switch TP-Link TL-SG108PE | 8 puertos gigabit – etiquetado 802.1Q | Transporta las tres VLANS sobre un único enlace troncal | OT/IT/DMZ |
| 6 | Estación de trabajo | Equipo de escritorio con navegador | Consume los paneles y la aplicación web | IT |

El Gateway industrial IOT2050 es la restricción más limitante pues sus 2 GB de memoria son lo que hace que sea una necesidad optimizar las funciones y responsabilidades del nodo de borde. También es el único equipo con certificación industrial del conjunto y el único con puerto serial nativo, lo que lo convierte en la única pieza del inventario de laboratorio que podría ser traslado a una instalación real en la planta de algún cliente.

El servidor central Dell OptiPlex 7080 cuenta con un hipervisor desplegar máquinas virtuales que contengan los servicios y los componentes de software planteados en la arquitectura.

Todo el software que se despliega sobre este inventario, junto con la documentación de diseño que lo acompaña, se publica en el repositorio del trabajo [48].

El cortafuegos del laboratorio es un hardware dedicado para proveer al laboratorio de un control en la segmentación en zonas y establecer las reglas de los conductos. De esta forma podemos versionar las reglas y establecer una arquitectura que contempla la seguridad de la red.

## 4.2 REQUISITOS DE ARQUITECTURA

### 4.2.1 Requisitos funcionales

Los requisitos funcionales son aquellos que la plataforma debe ser capaz de hacer y salen directamente de los objetivos específicos del apartado 1.3:

*Tabla 7 Requisitos funcionales y el objetivo específico del cual se originan*

| # | Requisito | Origen |
|---|---|---|
| RF1 | Adquirir variables de dispositivos que hablen Modbus TCP y OPC UA, sin modificar los dispositivos | Objetivo 2 |
| RF2 | Normalizar toda lectura a un formato común con unidad, calidad y marca de tiempo de origen | Objetivo 1 |
| RF3 | Publicar el modelo de datos de cada activo de forma que un consumidor nuevo lo obtenga al conectarse | Objetivo 1 |
| RF4 | Conservar el flujo de eventos de forma inmutable y reproducible | Objetivo 2 |
| RF5 | Materializar el dato en capas de refinamiento progresivo consultables por SQL | Objetivo 2 |
| RF6 | Permitir que un consumidor nuevo se incorpore sin coordinación con ninguna fuente | Objetivo 3 |
| RF7 | Continuar adquiriendo y no perder dato ante interrupción del enlace en el centro | Objetivo 2 |
| RF8 | Señalizar la degradación de calidad cuando el proceso se detiene o falla | Objetivo 1 |
| RF9 | Impedir por topología que la zona de operación y la de negocio se comuniquen de forma directa | Objetivo 4 |
| RF10 | Desplegarse en una instalación nueva mediante configuración sin necesidad de rediseño | Objetivo 5 |

### 4.2.2 Requisitos no funcionales derivados del marco teórico

Los requisitos no funcionales son las implicaciones de diseño que la arquitectura debe satisfacer acorde a la literatura del capítulo 3.

*Tabla 8 Requisitos no funcionales derivados de las implicaciones de diseño del marco teórico*

| # | Requisito | Implicación |
|---|---|---|
| RNF1 | Existe un único sistema de registro autoritativo y toda base de datos es vista materializada reconstruible desde él | 3.A |
| RNF2 | Todo mensaje transporte tiempo de evento generado en origen y número de secuencia por dispositivo | 3.A |
| RNF3 | Todos los consumidores de materialización son idempotentes ante duplicados | 3.A |
| RNF4 | Ninguna aplicación escribe directamente en una vista materializada | 3.B |
| RNF5 | El borde no aloja base de datos ni estado persistente susceptible de divergir | 3.B |
| RNF6 | El contrato de datos es el artefacto que habilita el desacoplamiento | 3.C |
| RNF7 | La capa de adquisición es sustituible sin efecto sobre ningún componente aguas abajo | 3.C |
| RNF8 | El espacio de nombres se organiza por jerarquía semántica y categoría funcional y es autodescriptivo | 3.D |
| RNF9 | La garantía extrema a extremo se compone por saltos con calidad de servicio 1, sesión persistente y receptor idempotente | 3.E |
| RNF10 | El estado es consultable sin sondeo mediante retención selectiva por categoría | 3.E |
| RNF11 | El tiempo máximo de corte tolerable es un parámetro dimensionado | 3.E |
| RNF12 | La contextualización ocurre en el origen | 3.F |
| RNF13 | La partición en zonas es una restricción previa de diseño | 3.G |
| RNF14 | La salud del sistema fluye por un canal semánticamente diferenciado del dato de proceso | 3.G |
| RNF15 | El borde implementa conectividad, almacenamiento y reenvío y normalización | 3.H |

### 4.2.3 Restricciones

Las restricciones que condicionan el diseño serán:

*Tabla 9 Restricciones que condicionan el diseño*

| # | Restricción | Consecuencia en el diseño |
|---|---|---|
| 1 | El Gateway de borde es un equipo industrial con 2 GB de memoria | El borde no puede alojar componentes tecnológicos que superen esa capacidad. |
| 2 | Todo el software debe ser de licencia abierta | Se descartan las plataformas comerciales revisadas en el capítulo 2.5, menos las que tengan versión de uso abierto o Community Edition. |
| 3 | Todo debe ser *dockerizable* y desplegable sin orquestador | Uso de Docker Compose y no Kubernetes |
| 4 | El presupuesto de hardware es de laboratorio | Los dispositivos de campo son simuladores y se busca utilizar hardware real para el resto de los componentes |

## 4.3 EL CASO DE USO: LA CELDA DE LLENADO

### 4.3.1 Narrativa de proceso

La celda de llenado dosifica producto en envases por control de masa. Un tanque alimenta la línea y una válvula de control regula el caudal hacia la boquilla de llenado. Un caudalímetro Coriolis mide la masa que efectivamente está pasando por la línea y finalmente el controlador cierra el lazo, abriendo la válvula al iniciar el llenado e integrando el caudal medido hasta alcanzar la consigna de masa por envase. Un medidor de energía mide el consumo eléctrico de la celda completa.

*Ilustración 10 Esquema de proceso de la celda de llenado (Iconos de Siemens Industry Image Database)*

La línea no opera de forma continua ni ideal. Sigue un calendario de producción automático con corridas de entre diez y treinta minutos, cambios de formato de dos a ocho minutos entre corridas, atascos con un tiempo medio de fallos alrededor de veinte minutos y episodios de mala calidad aproximadamente una vez por hora. Ese comportamiento es el que produce eventos discretos, alarmas y variabilidad que un sistema de datos industriales tiene que saber tratar.

### 4.3.2 Los cuatro dispositivos y sus protocolos

*Tabla 10 Dispositivos de la celda, con sus protocolos y papel en el proceso*

| # | Dispositivo | Protocolo | Papel | Naturaleza del dato |
|---|---|---|---|---|
| 1 | plc-llenado-01 | OPC UA | Controlador de la celda. Indica el estado de la línea y el mando a la válvula | Estado, consignas y contadores de producción |
| 2 | valvula-01 | OPC UA | Actuador: posicionador con dinámica de accionamiento y desgaste acumulado | Consigna, posición real e indicadores de salud del actuador |
| 3 | Coriolis-01 | Modbus TCP | Instrumento de proceso que mide la masa dosificada | Caudal, densidad, temperatura, totalizar y canal de diagnóstico |
| 4 | Medidor-02 | Modbus TCP | Instrumento de servicio que mide el consumo eléctrico de la celda | Tensión, corriente, potencia, factor de potencia y energía acumulada |

El código de los cuatro simuladores está disponible en el repositorio del trabajo [48], bajo `deploy/1-campo/sims/`.

El reparto de protocolos reproduce una situación habitual de planta que es la combinación de equipos modernos con equipos que llevan años en operación, con protocolos distintos: El controlador y el posicionador son equipos que exponen un modelo de información tipado en OPC UA mientras que los dos instrumentos de medición se leen por registros Modbus, donde un valor de coma flotante ocupa dos registros de dieciséis bits y hay que reconstruirlo respetando el orden de palabra.

### 4.3.3 Modelo de activos y variables

La celda declara veinte siete variables repartidas entre los cuatro dispositivos, que es lo que tendrá que vivir en el propio espacio de nombres.

*Tabla 11 Variables declaradas por dispositivo y canal por el que se publican*

| Dispositivo | Variables de proceso (dat/raw) | Variables de diagnóstico (diag) | Estado (sts) | Eventos (evt) |
|---|---|---|---|---|
| plc-llenado-01 | **6** – estado de línea, velocidad, consigna de caudal, mando a válvula, contadores buenos y rechazado | – | Sí | Cambio de estado, atasco detectado y despejado |
| valvula-01 | **5** – consigna, posición, recorrido acumulado, ciclos, presión de aire | – | Sí | Desviación de posición y su recuperación |
| coriolis-01 | **5** – caudal másico, caudal volumétrico, densidad, temperatura, masa totalizada | **5** – ganancia de excitación, frecuencia del tubo, temperatura del sensor, aire arrastrado, enlace con el PLC | Sí | – |
| medidor-02 | **6** – tensión, corriente, potencia activa, factor de potencia, frecuencia, energía acumulada | – | Sí | – |

De estas variables planteadas, tres condicionan decisiones a tomar en el contrato:

- **Acumuladores:** La masa totalizada, energía acumulada, contadores de producción y recorrido del vástago nunca se reinician. El cálculo de consumo o producción en un período es responsabilidad del consumidor, que resta dos lecturas. Publicar el acumulado en lugar del incremento es mejor porque un incremento perdido es información perdida para siempre mientras que un acumulado perdido se recupera con la siguiente lectura.
- **Las variables de salud del actuador:** El recorrido acumulado y número de inversiones de dirección no describen el proceso sino el desgaste del equipo. Son datos útiles para el mantenimiento que en una arquitectura punto a punto rara vez llegan a nadie.
- **Las variables de diagnóstico del caudalímetro:** Son la representación del segundo canal en funcionamiento que extrae datos de diagnóstico en paralelo a los datos de proceso. LA ganancia de excitación rondará 8 % en condiciones normales y se dispara entre el 40% y el 90% cuando entra aire en el tubo de medida, momento en el que la densidad medida cae. No son datos de proceso pero juntas pueden explicar por qué la medida de masa dejó de ser fiable y en qué momento y publicarlas por un canal separado permite que un sistema de mantenimiento las consuma sin tocar nada del lazo de control.

### 4.3.4 Estados de línea y causalidad entre dispositivos

El controlador gobierna una máquina de estados de cuatro posiciones que determina el comportamiento de toda la celda.

*Ilustración 11 Máquina de estados de la línea y su efecto sobre los demás dispositivos*

Lo importante del diseño es que la causalidad se propaga y la ruptura es observable. Los tres dispositivos subordinados obtienen del controlador el estado de la línea de forma que si el controlador deja de responder, siguen sirviendo su protocolo con normalidad (por ejemplo, el cliente Modbus seguirá leyendo registros sin error), pero el comportamiento de la línea se degrada en parada y lo señalizan en sus datos de estado.

Esa señalización tiene implicaciones directas sobre el contrato a diseñar: la capa de adquisición traduce esos estados a una calidad *uncertain* en las variables afectadas. Este mecanismo sirve para impedir el peor fallo posible en un sistema de datos industriales que es el de entregar valores posibles pero equivocados o descontexualizados. Con esta distinción se puede distinguir un caudal cero que signifique que la línea está parada con que sea que ha perdido la referencia.

## 4.4 VISTA DE ARQUITECTURA

La arquitectura de datos se presentará siguiendo el modelo C4 [47] en sus tres primeros niveles (Contexto, contenedores y componentes), junto a una vista de despliegue que indica qué componentes de hardware alojarán qué componentes. En este capítulo se describe la función de cada elemento y por qué existe mientras que en el capítulo 5 se discutirá cómo quedo construida la arquitectura diseñada.

### 4.4.1 Qué es el sistema para diseñar y qué es el Unified Namespace

La arquitectura a diseñar esta basada en el patrón arquitectónico del Unified Namespace y lo utiliza como columna vertebral. Según la aceptación adoptada en el capitulo 2.3.2, el UNS lo forma el bróker que distribuye los mensajes, la jerarquía semántica que nombra los tópicos y el registro durable y ordenado que conserva los eventos, todo ello gobernado por un contrato.

La plataforma que se despliegua en esta arquitectura contiene más piezas que no son UNS: las vistas derivadas como la base de datos que materializa el flujo, los paneles que lo dibujan y la API que lo sirve son datos derivados y sus servidores que también se contemplan en la arquitectura de datos, pero no son el UNS en si mismo, sino sus consumidores.

### 4.4.2 Nivel 1 – Contexto

El nivel de contexto responde la pregunta de quién habla con el sistema y para qué. Fuera de la frontera del sistema de software quedan están los **dispositivos de campo**, que son un sistema externo que existen, miden y hablan su protocolo independientemente de que la plataforma esté o no esté desplegada y las **personas** que usan la plataforma según su rol, quién opera la celda, quién consulta los KPIs y desempeño del negocio y quién administra la plataforma.

*Ilustración 12 Diagrama de contexto del sistema*

Lo más importante aquí es que ningún consumidor aparece conectado a los productores. Esta propiedad es la que defiende el trabajo que permite la escalabilidad a la conexión con sistemas de terceros como ERP o MES que el contrato de datos habilita.

### 4.4.3 Nivel 2 – Contenedores

En este nivel se abre la caja del sistema y muestra las tres unidades desplegables entre las cuales se reparten las responsabilidades de la arquitectura diseñada para este planteamiento.

*Tabla 12 Contenedores del sistema y su responsabilidad*

| # | Contenedor | Zona | Responsabilidad | Por qué está separado |
|---|---|---|---|---|
| 1 | **PDI NODO** – Nodo de borde | OT | Adquirir de los dispositivos de campo mediante su protocolo, normalizar según el contrato, publicar y encolar ante corte de enlace | Debe seguir funcionando cuando el enlace con el centro cae, y debe estar cerca del dispositivo para que el almacenamiento y envió ocurra en el origen. |
| 2 | **PDI NUCLEO** – Columna vertebral del UNS | DMZ | Distribuir el flujo a quien se suscriba y conservarlo de forma inmutable y ordenada | Es el sistema de registro y el UNS: Su única responsabilidad es que el evento llegue y no se pierda. |
| 3 | **PDI APPS** – Capa derivada y de consumo | DMZ o IT | Materializar el flujo en capas consultables y servirlo a personas y sistemas externos | Todo lo que contiene es reconstruible desde el contendor anterior. |

*Ilustración 13 Diagrama de contenedores del sistema*

En un despliegue físico, el servidor presente en la DMZ que alberga el UNS (el PDI NUCLEO) también puede albergar las vistas derivadas que permiten y facilitan su consulta. En este caso las PDI APPs se pueden desplegar operativamente junto el PDI NUCLEO, pero arquitectónicamente están separadas porque el contenedor de núcleo contiene lo que es autoritativo mientras que el contenedor de apps contiene lo que se puede borrar y reconstruir. En una implementación o despliegue de la arquitectura se podrían ver construidos sobre diferentes máquinas virtuales en un mismo hardware físico.

### 4.4.4 Nivel 3 – Componentes del nodo de borde

En el nivel 3 se abre cada contenedor. El nodo de borde agrupa cinco componentes y todos deben coexistir por debajo del límite de memoria del Gateway industrial.

*Tabla 13 Componentes del nodo de borde y la decisión que los sostiene*

| # | Componente | Función | Decisión |
|---|---|---|---|
| 1 | Gateway de adquisición | Cliente Modbus TCP y OPC UA, sondeo cíclico y normalización al contrato | ADR-004 |
| 2 | Bróker local | Espacio de nombres del borde y puente al central con almacenamiento y reenvío | ADR-003 |
| 3 | Publicador de definiciones | Publica el plano definitional de los cuatro activos y se mantiene retenido | ADR-006 |
| 4 | Servicio de salud | Publica el diagnóstico del propio Gateway | ADR-011 |
| 5 | Procesador de flujo | Filtrado, agregación y derivados en el borde | ADR-011 |

*Ilustración 14 Componentes del nodo de borde*

### 4.4.5 Nivel 3 – Componentes del centro

Los dos contenedores centrales se documentan en un solo diagrama para ver mejor la frontera entre ambos en el mismo servidor central.

*Tabla 14 Componentes de los contenedores centrales y la decisión que los sostiene*

| # | Contenedor | Componente | Función | Decisión |
|---|---|---|---|---|
| 1 | CORE | Bróker del espacio de nombres | Distribuye a los suscriptores y conserva el último valor de las categorías retenidas | ADR-014 |
| 2 | CORE | Puente a registro de eventos | Translada el flujo con sesión durable, sin perder lo publicado durante una caída | ADR-002 |
| 3 | CORE | Registro de eventos | Fuente de verdad inmutable, ordenado, con difusión independiente y reproceso | ADR-002 |
| 4 | APPS | Consumidor de materialización | Escribe las capas del modelo medallón de forma idempotente | ADR-005 |
| 5 | APPS | Base de series temporales | Materializa bronce, plata y oro: correlaciona telemetría con contexto | ADR-001, ADR-013 |
| 6 | APPS | Servicio de API | Sirve el dato contextualizado por HTTP a clientes propios y de terceros | ADR-014 |
| 7 | APPS | Aplicación web | Consumidor propio de la API | ADR-014 |
| 8 | APPS | Paneles operativos | Consumidor independiente que lee las vistas por SQL | – |
| 9 | APPS | Proxy de entrada | Sirve los estáticos y enruta la API bajo un solo punto de acceso | ADR-014 |

*Ilustración 15 Componentes de los contenedores centrales*

### 4.4.6 Vista de despliegue

*Tabla 15 Reparto de los contenedores sobre el hardware disponible para la implementación*

| Equipo | Zona de red | Qué aloja | Por qué ahí |
|---|---|---|---|
| Nodo de campo | OT | Los cuatro dispositivos simulados | Son los equipos de la celda |
| Gateway industrial | OT | PDI NODO al completo | Es el equipo transportable y certificado cuyo límite de memoria condiciona el stack |
| Servidor central | DMZ | PDI CORE e IDP APPS sobre un hipervisor | Ambos contenedores comparten equipo por limitaciones del laboratorio de implementación, por lo que su frontera es lógica |
| Estación de trabajo | IT | Navegador que consume paneles y aplicación web | Consume el dato ya contextualizado |
| Cortafuego | OT/IT/DMZ | Enrutamiento entre zonas y reglas de conducto | Materializa la partición del capítulo 4.6 |

*Ilustración 16 Reparto de los contenedores sobre el hardware del laboratorio*

## 4.5 EL CONTRATO DEL UNIFIED NAMESPACE

En el capítulo 3 se concluyo que el artefacto que produce el desacoplamiento es el modelo canónico más que la infraestructura de mensajería, por lo que en este capítulo estableceremos el contrato con sus esquemas y reglas en un documento propio y versionado que acompaña al repositorio del trabajo [48], en `docs/contracts/UNS.md`. Lo que sigue expone su estructura y las decisiones que lo conforman, mientras que el documento recoge los esquemas completos de cada categoría y el diccionario de variables de cada dispositivo.

### 4.5.1 La jerarquía aplicada a la celda

La estructura canónica de un tópico tiene seis niveles y un séptimo opcional:

`{empresa}/{emplazamiento}/{área}/{línea}/{celda}/{categoría}[/{subcategoría}]`

Aplicada al caso de referencia, la rama de la celda quedaría así:

`greytec / demo / produccion / llenado / {dispositivo} / {categoría}`

Los cuatro primeros niveles describen dónde está el activo en la organización, con el vocabulario que el personal de planta ya usa.

El quinto identifica el activo concreto y el sexto declara qué clase de mensaje es. Esa separación entre ubicación y clase es lo que permite las suscripciones con significado de negocio.

*Ilustración 17 Árbol del espacio de nombres de la celda de llenado*

### 4.5.2 Las seis categorías y los cuatro planos

*Tabla 16 Categorías del contrato, con su plano y quién las publica*

| # | Categoría | Plano | Qué transporta | Quién publica |
|---|---|---|---|---|
| 1 | def | Definitional | Qué es el activo y qué significan sus variables | El Gateway |
| 2 | dat/raw | Functional | Lectura directa del dispositivo, con una variable por tópico | El Gateway |
| 3 | dat/der | Informative | Resultado de un cálculo sobre una o más lecturas | Procesador de flujo en el gateway |
| 4 | sts | Functional | Estado operativo y disponibilidad del dispositivo | El Gateway |
| 5 | evt | Functional | Suceso discreto como una transición, alarma o respuesta | El gateway |
| 6 | diag | Functional | Salud del equipo | El Gateway |

Las categorías responden a la forma del mensaje y los planos a la naturaleza del conocimiento que transporte. La distinción entre dato crudo y derivado se aplica únicamente bajo **dat** a propósito, ya que el el estado, el evento, el mando y el diagnóstico no necesitan declarar su origen porque su semántica ya lo determina.

### 4.5.3 El plano definitional

De las siete categorías, **def** es la que resuelve la carencia identificada en el capítulo 2.3.5.

Con un tópico por variable y un envelope plano, el nombre de la variable vive en el último nivel del tópico. Por ejemplo, un consumidor que se suscriba recibe **mass_flow_kgh = 1250.4**, y con eso puede dibujar una gráfica, pero no se puede saber en qué unidad está, entre qué límites es válido, de qué registro Modbus salió ni con qué umbral se decidió publicarlo. Esa información muchas veces existe, pero solo en la cabeza del que configuro o integró el sistema, pero no en el propio espacio de nombres. Ese es el coste de conocimiento del capítulo 2.2.2 que suele perderse en cada integración punto a punto.

La categoría **def** lo resuelve publicando de forma retenida y una vez por dispositivo, la identidad del activo y el diccionario completo con sus variables: Nombre, unidad, tipo, canal por el que se publica, límites operativos, umbral de publicación por excepción y procedencia protocolar.

Para que funcione, esta categoría funciona con las siguientes propiedades de diseño:

- **La retención es obligatoria:** Un consumidor que se suscriba a `+/+/+/+/+/def` recibe el modelo de datos completo de una instalación en el instante de conectarse sin pedírselo a nadie y sin esperar a que algo cambie para que el espacio de nombres sea autodescriptivo y permite un desacoplamiento real ya que el consumidor no debe hablar con el productor para recibir la información y de paso entender el dato.
- **Lleva revisión en vez de secuencia:** El campo **rev** dentro del envelope es un entero monótono que se incrementa cuando la definición cambia, y que no se reinicia al arrancar el publicador, a diferencia del número de secuencia de los mensajes de datos. Un consumidor lo usa para saber si su copia está al día y la vista materializada para descartar revisiones viejas reentragadas tras un corte.
- **El umbral de publicación es normativo:** Declarar el deadband en **def** y no solo en la configuración del Gateway significa que el criterio con el que se decide publicar deja de ser un detalle interno y pasa a ser parte del contrato. Eso permite que un consumidor sepa que un valor no ha cambiado porque no superó el umbral.

El diccionario de las veintisiete variables de la celda se declara en un único fichero versionado, `deploy/2-edge/def-publisher/definitions.yml` [48], desde el que el publicador construye los mensajes retenidos. Dar de alta un instrumento nuevo es editar ese fichero y no tocar el flujo de adquisición.

Estas propiedades hacen que sea necesaria una regla de evolución para el contrato: añadir renombrar o retirar una variable obliga a publicar una nueva revisión de **def** en el mismo despliegue en el que cambia el flujo para mantener consistencia y visibilidad de las variables existentes.

### 4.5.4 Envelope plano y publicación por excepción

El contrato adopta un tópico por variable con envelope plano, en lugar del telegrama agrupado por dispositivo:

```json
// greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh
{
  "ts": "2026-09-03T21:46:34.180Z",
  "src": "coriolis-01",
  "seq": 122956,
  "v": 1072.652,
  "u": "kg/h",
  "q": "good"
}
```

Se eligió este diseño por tres motivos:

- **Granularidad de suscripción:** Un consumidor que solo necesita el caudal se suscribe al caudal y no necesita recibir ni descartar las otras variables.
- **Retención útil:** Al ser un tópico por variable, el último valor de cada una queda retenido de forma independiente y un suscriptor nuevo obtiene el estado completo de la celda al conectarse.
- **Publicación por excepción:** Cada variable tiene su propio umbral y latido, por lo que solo envía un telegrama ligero cuando su propia variable cambia lo suficiente.

De esta forma, la publicación de los datos no ocurre bajo a una cadencia fija, sino cuando el valor cambia más allá de su umbral, pero igual manteniendo un latido de treinta segundos para garantizar que el silencio no sea que un equipo se detuvo y poder distinguir correctamente ente que el valor no haya cambiado o que el productor este muerto.

La única categoría que mantiene un ciclo de scan fijo es el del canal de dignóstico en cuyo caso se realiza cada sesenta segundos y ese sí se publica entero sic ualquiera de sus campos supera algún umbral porque la salud del instrumento se interpreta en conjunto y no campo a campo.

El número de secuencia es por dispositivo y no por variable, de forma que cada evento sigue una línea secuencial. Esto tiene la consecuencia de que un suscriptor de una sola variable verá saltos en la secuencia, porque las demás variables del mismo dispositivo harán también hará que suban. Esa detección de huecos se haría a nivel de dispositivo, suscribiéndose a todas las variables para poder tener trazabilidad de todos los cambios en una combinación de tiempo, secuencia y origen únicos.

### 4.5.5 Política de calidad de servicio y retención

*Tabla 17 Calidad de servicio y retención por categoría*

| Categoría | QoS | Retenido | ¿Por qué? |
|---|---|---|---|
| def | 1 | Sí | Todo suscriptor nuevo debe recibir la definición antes que cualquier valor |
| dat/raw | 1 | Sí | Con publicación por excepción, el retenido es lo que da el valor completo al conectarse |
| dat/der | 1 | No | El cálculo viene del procesamiento de flujo continuo |
| Sts | 1 | Sí | El último estado conocido es necesario obtenerlo siempre |
| evt | 1 | No | Un evento pasado no representa el presente |
| diag | 1 | No | Canal paralelo que no debe interferir con el lazo principal |

Todas las categorías tienen calidad de servicio 1 aplica el argumento del capítulo 3.2.4 de que la garantía de entrega exactamente una vez sale más barata mediante receptores idempotentes que mediante el protocolo. Esa idempotencia se logra al tratar la terna de marca de tiempo, origen y secuencia como clave natural.

### 4.5.6 Reglas de evolución

En la práctica industrial es necesario estar preparado para los cambios, pero cambiar el contrato de datos sin reglas puede romper a los consumidores del UNS.

Ese problema es el de la evolución de esquemas que Kleppmann [4] formula para cualquier sistema donde quien escribe y quien lee se actualizan por separado, que es lo que pasa siempre en la práctica industrial.

De ahí salen los dos criterios que gobiernan todo el contrato:

- **Compatibilidad hacia atrás:** un consumidor nuevo entiende el dato que escribió un productor viejo.
- **Compatibilidad hacia adelante:** un consumidor viejo sigue funcionando con el dato que escribe un producto nuevo.

Un cambio en el contrato es seguro solo si conserva ambas e incompatible si rompe alguna.

*Tabla 18 Clasificación de los cambios sobre el contrato*

| # | Cambio | ¿Rompe algo? | Qué hay que hacer |
|---|---|---|---|
| 1 | Añadir una variable, una categoría o un dispositivo | No | Publicarlo. |
| 2 | Añadir un campo opcional a un envelope | No | Publicarlo. |
| 3 | Renombrar o eliminar una variable | Sí | Transición donde el nombre viejo y el nuevo se usen a la vez y retirar el viejo cuando ningún consumidor lo use |
| 4 | Cambiar la unidad o el tipo de una variable | Sí | Al ser una variable distinta se publica con nombre nuevo y se aplica la regla 3 |
| 5 | Cambiar la calidad de servicio o la retención de una categoria | Sí | Versionar el contrato y avisar. |
| 6 | Cambiar el esquema de un envelope | Sí | Cambio mayor: versión nueva del contrato y migración coordinada de productores y consumidores |

La regla 5 es la única regla que no es evidente pues no romperá ningún productor o consumidor, pero sí cambia el comportamiento de quien está suscrito. Por ejemplo un consumidor que contaba con recibir el último valor retenido al conectarse deja de recibirlo y muestra una pantalla vacía sin ningún error mientras que uno con sesión durable deja de recibir lo que se publicó mientras estaba caído.

Por encima de estas reglas está la regla del plano definitional, pues cualquier cambio en las variables obliga a publicar una una revisión de **def** en el mismo despliegue en el que cambia el flujo porque ahí se publica la definición del propio dispositivo y sus variables.

## 4.6 DISEÑO DE LA RED Y SEGMENTACIÓN

### 4.6.1 Zonas de confianza

La partición sigue el modelo de zonas y conductos de IEC 62443 descrito en el apartado 3.8.1, y se aplicó como restricción previa al diseño del flujo de datos. Para este trabajo se definen 3 zonas:

*Tabla 19 Zonas de confianza en la instalación*

| # | Zona | Qué contiene | Política |
|---|---|---|---|
| 1 | Operación (OT) | Dispositivos de la celda y gateway de adquisición | No inicia conexiones hacia IT, solo publica hacia la DMZ |
| 2 | Zona desmilitarizada (DMZ) | Bróker del espacio de nombres, registro de eventos, base de datos y servicios de consumo | Recibe la operación y sirve a negocio. Aislada por cortafuegos de ambos lados. |
| 3 | Negocio (IT) | Estaciones de trabajo y consumidores finales | Consume el dato ya contextualizado. No puede acceder a la operación. |

El detalle de direccionamiento y las reglas aplicadas se documentan en `docs/arquitectura/red-segmentacion.md` [48].

### 4.6.2 Matriz de conductos

*Tabla 20 Conductos autorizados entre zonas*

| # | Origen | Destino | Servicio | Acción | Razón |
|---|---|---|---|---|---|
| 1 | OT | DMZ | Mensajería del espacio de nombres | Permitir | Es el único camino del dato hacia el UNS |
| 2 | OT | DMZ | Cualquier otro | Denegar | La operación no accede a la base de datos ni servicios internos |
| 3 | OT | Internet | Cualquiera | Denegar | La celda no necesita salida y esto reduce la superficie de exposión |
| 4 | IT | DMZ | Aplicación web y paneles | Permitir | Acceso al dato contextualizado |
| 5 | IT | DMZ | Administración remota | Permitir con autenticación | Plano de control, separado del de datos |
| 6 | IT | OT | Cualquiera | Denegar | No hace falta por ningún motivo. |

*Ilustración 18 Zonas de confianza y conductos autorizados*

El sexto ítem es el que da todo el sentido en una arquitectura cibersegura, pues que no exista un conducto entre negocio y operación es el resultado de que la arquitectura no lo necesita para extraer información. Un consumidor de negocio que quisiera el valor de un instrumento en una arquitectura punto a punto tendría que establecer ese túnel y al hacerlo exponer la operación a ataques, pero aquí no es necesario porque el dato ya esta en la zona intermedia, contextualizado y con su definición.

### 4.6.3 Plano de datos y plano de control

La distinción del capitulo 3.8.2 toma valor en dos mecanismos separados:

- **El plano de datos** es el flujo de telemetría que ya hemos definido desde el equipo de campo hasta el UNS en la DMZ, donde continuamente tenemos una lectura de datos en un sentido.
- **El plano de control** es el acceso administrativo que viaja por un canal independiente con autenticación mediante una VPN para poder configurar directamente los equipos que participan desde una consola de administración.

Esto es esencial para asegurar que la telemetría no dependa de que exista un túnel permanente y que un fallo en el canal de administración interrumpe el dato.

## 4.7 DECISIONES DE ARQUITECTURA

### 4.7.1 ADR (Architectural Decision Record)

Toda decisión de esta arquitectura está registrada como un ADR (Architectural Decision Record): un documento breve que fija el contexto que fuerza la decisión, la decisión en si misma, las alternativas evaluadas y las consecuencias que se aceptan. Los catorce registros están publicados en el repositorio del trabajo [48], bajo `docs/adr/`.

La disciplina que se siguió es que el ADR se escribe antes de implementar y no después, porque un registro redactado a posteriori es una justificación mientras que uno redactado antes es una decisión que todavía se puede discutir cuando cambiarla es barato.

### 4.7.2 Las decisiones y su relación al marco teórico

*Tabla 21 Decisiones de arquitectura, su implicación teórica y el requisito que satisfacen*

| # | Decisión | Implicación | Requisito |
|---|---|---|---|
| 001 | Base de datos relacional con extensión de series temporales | 3.F | RNF12 |
| 002 | Registro de eventos compatible con la API de Kafka como fuente de verdad | 3.A | RNF1 |
| 003 | Bróker ligero en el borde con almacenamiento y reenvío | 3.E | RNF9, RNF11 |
| 004 | Herramienta de flujos como gateway de adquisición | 3.C | RNF7 |
| 005 | Idempotencia en todos los sistemas de materialización | 3.A | RNF3 |
| 006 | Espacio de nombres con jerarquía semántica y categorías funcionales | 3.D | RNF8 |
| 007 | CQRS en el borde, sin base de datos local | 3.B | RNF4, RNF5 |
| 008 | Mensajería con carga útil estructura legible | 3.E | RNF10 |
| 009 | Virtualización del servidor central | – | – |
| 010 | Cortafuegos dedicado con segmentación en tres zonas | 3.G | RNF13 |
| 011 | Gateway industrial con recursos limitados como nodo de borde | 3.H | RNF15 |
| 012 | Dispositivos simulados multiprotocolo en lugar de un único runtime | – | RF1 |
| 013 | La lógica de indicadores vive en SQL, en capas de refinamiento | 3.F | RNF12 |
| 014 | Criterio de separación de servicios en imágenes distintas (docker) | – | RF10 |

Los tres ADR sin implicación teórica asociada son de infraestructura y para la implementación no directamente relacionada a la arquitectura de datos.

## 4.8 SÍNTESIS DEL DISEÑO

La arquitectura diseñada en primera instancia se puede resumir en cinco propiedades, cada una relacionada a un fundamento del capítulo 3 y verificable en el sistema construido.

**Una sola fuente de verdad:** El registro de eventos inmutables es autoritativo mientras que la base de datos, los paneles y la API son vistas materializadas descartables y reconstruirles desde él.

**El UNS es el contrato y el bróker:** El artefacto que produce el desacoplamiento es el modelo canónico de datos, y por eso el contrato es un documento versionado con reglas de evolución y no una convención implícita. La categoría definitional es importante porque hace que el propio espacio de nombres sea capaz de explicar qué significa lo que transporte.

**La segmentación como restricción de diseño:** Se parte de la partición en zonas para dibujar el flujo, eliminando así la necesidad de establecer conductos entre IT y OT.

---

# Anexo — Correcciones pendientes de trasladar al documento Word

## A. Ilustraciones — seis pendientes de insertar

Las tres primeras ya están en el Word. Las seis siguientes están rotuladas en este `.md`
en el punto exacto donde van, para que el texto y los pies cuadren al insertarlas.

| # | Apartado | Ilustración | Estado |
|---|---|---|---|
| 10 | §4.3.1 | Esquema de proceso de la celda de llenado | ✅ en el Word |
| 11 | §4.3.4 | Máquina de estados de la línea | ✅ en el Word — **rótulo corregido**, ver A1 |
| 12 | §4.4.2 | Diagrama de contexto del sistema (C4 Nivel 1) | ✅ en el Word |
| 13 | §4.4.3 | Diagrama de contenedores (C4 Nivel 2) | ⬜ pendiente |
| 14 | §4.4.4 | Componentes del nodo de borde (C4 Nivel 3) | ⬜ pendiente |
| 15 | §4.4.5 | Componentes de los contenedores centrales (C4 Nivel 3) | ⬜ pendiente |
| 16 | §4.4.6 | Reparto de los contenedores sobre el hardware | ⬜ pendiente |
| 17 | §4.5.1 | Árbol del espacio de nombres de la celda | ⬜ pendiente |
| 18 | §4.6.2 | Zonas de confianza y conductos autorizados | ⬜ pendiente |

**A1 — rótulo de la Ilustración 11.** En el Word dice «Diagrama de contexto del sistema»,
que es el rótulo de la 12, pero la figura muestra la máquina de estados. Corregido en este
`.md` a «Máquina de estados de la línea y su efecto sobre los demás dispositivos».

**A2 — Índice de Figuras.** La página 8 sigue vacía. Generar cuando estén las nueve.

## B. Tablas — ocho rotuladas, serie 5–21

Al rotular las ocho que faltaban, la serie del capítulo pasa de 5–13 a **5–21**, y el
Capítulo 5 arranca en la **Tabla 22**. Los rótulos nuevos, con la numeración final:

| Tabla | Apartado | Rótulo | Estado |
|---|---|---|---|
| 5 | §4.1.2 | Supuestos y simplificaciones del escenario… | ya rotulada |
| **6** | §4.1.3 | Inventario de hardware del laboratorio y su papel en la arquitectura | **nueva** |
| 7 | §4.2.1 | Requisitos funcionales… | era la 6 |
| 8 | §4.2.2 | Requisitos no funcionales… | era la 7 |
| 9 | §4.2.3 | Restricciones que condicionan el diseño | era la 8 |
| 10 | §4.3.2 | Dispositivos de la celda… | era la 9 |
| **11** | §4.3.3 | Variables declaradas por dispositivo y canal por el que se publican | **nueva** |
| 12 | §4.4.3 | Contenedores del sistema y su responsabilidad | era la 10 |
| **13** | §4.4.4 | Componentes del nodo de borde y la decisión que los sostiene | **nueva** |
| **14** | §4.4.5 | Componentes de los contenedores centrales y la decisión que los sostiene | **nueva** |
| 15 | §4.4.6 | Reparto de los contenedores sobre el hardware… | era la 11 |
| **16** | §4.5.2 | Categorías del contrato, con su plano y quién las publica | **nueva** |
| 17 | §4.5.5 | Calidad de servicio y retención por categoría | era la 12 |
| **18** | §4.5.6 | Clasificación de los cambios sobre el contrato | **nueva** |
| 19 | §4.6.1 | Zonas de confianza en la instalación | era la 13 |
| **20** | §4.6.2 | Conductos autorizados entre zonas | **nueva** |
| **21** | §4.7.2 | Decisiones de arquitectura, su implicación teórica y el requisito que satisfacen | **nueva** |

**B1 — cabecera incompleta.** La tabla de reglas de evolución (ahora Tabla 18) solo tenía
encabezado en la primera columna. Las tres cabeceras correctas son **«# Cambio»**,
**«¿Rompe algo?»** y **«Qué hay que hacer»**.

**B2 — Índice de Tablas.** La página 8 sigue vacía. Generar al final.

## C. Citas

| # | Dónde | Incidencia | Acción |
|---|---|---|---|
| C1 | §4.4 | «el modelo C4 ()» — cita vacía | Debe ser **[47]** (S. Brown), ya en la bibliografía |
| C2 | §4.5.6 | «Kleppmann ()» — cita vacía | Debe ser **[4]** |
| C3 | §3.3.1 | «formulado por Young ()» — cita vacía | Debe ser **[36]** |
| C4 | §3.3.2 | «la consistencia eventual ()» y «el teorema CAP ()» | **[42]** Vogels y **[46]** Gilbert y Lynch |
| C5 | §3.9.1 | Bonomi citado como [46] y Shi como [47]; en §3.10 y en la bibliografía son [41] y [40] | Unificar a **[41]** y **[40]** |
| C6 | Cap. 9 | La bibliografía **duplica tres referencias**: Kreps en [35] y [42], Shi en [40] y [47], Bonomi en [41] y [46] | Resolver como está previsto en `bibliografia.md` |

## D. Coherencia de contenido

| # | Dónde | Incidencia | Acción |
|---|---|---|---|
| D1 | §4.5.2 | Dice «el estado, el evento, **el mando** y el diagnóstico», pero la categoría de mando se retiró | Eliminar «el mando» |
| D2 | §4.5.3 | «De las **siete** categorías» — ahora son seis | Corregir a «seis» |
| D3 | §4.6.3 | «un fallo en el canal de administración **interrumpe** el dato» — afirma lo contrario de lo que se quiere decir | Debe ser «**no** interrumpe el dato» |
| D4 | §4.8 | «se puede resumir en **cinco** propiedades», pero se enumeran tres | Corregir a «tres», o recuperar las dos que faltan: garantías compuestas por saltos, y el borde que excluye el control cerrado |
| D5 | §4.4.6 | La tabla mezcla «PDI CORE» e «**IDP** APPS» | Unificar el prefijo a PDI |
| D6 | §4.1.3 | «TI AM654**7**» — el modelo real del IOT2050 Advanced es **AM6548** | Corregir |
| D7 | §4.4.3 vs §4.4.5 | El Nivel 2 llama al contenedor «PDI NUCLEO» y el Nivel 3 lo llama «CORE» | Unificar |

## E. Ortografía y redacción

| # | Dónde | Dice | Debe decir |
|---|---|---|---|
| E1 | Intro §4 | «la decisión en sí mismo» | «la decisión en sí misma» |
| E2 | §4.1.2, supuesto 3 | «programación de contenedores» | «programación de **controladores**» |
| E3 | §4.1.3 | «el **núcreo** central» | «el núcleo central» |
| E4 | §4.1.3 | «cuenta con un hipervisor desplegar máquinas virtuales» | «…un hipervisor **para** desplegar…» |
| E5 | §4.1.3 | «podría ser **traslado** a una instalación real» | «trasladado» |
| E6 | §4.3.2, Tabla 10 | «Caudal, densidad, temperatura, **totalizar**» | «totalizador» |
| E7 | §4.3.3 | «veinte siete variables» | «veintisiete variables» |
| E8 | §4.3.3 | «**LA** ganancia de excitación» | «La ganancia de excitación» |
| E9 | §4.3.4 | «descontexualizados» | «descontextualizados» |
| E10 | §4.3.4 | «distinguir un caudal cero que signifique… **con que sea que** ha perdido la referencia» | «…**de uno que signifique que** ha perdido la referencia» |
| E11 | §4.4 | «cómo **quedo** construida» | «cómo quedó construida» |
| E12 | §4.4.1 | «la **aceptación** adoptada» | «la **acepción** adoptada» — mismo error en §2.3.2 y §2.3.3 |
| E13 | §4.4.1 | «se **despliegua**» | «se despliega» |
| E14 | §4.4.2 | «quedan **están** los dispositivos de campo» | «quedan los dispositivos de campo» |
| E15 | §4.4.3, Tabla 12 | «el almacenamiento y **envió**» | «envío» |
| E16 | §4.4.3, Tabla 12 | «desde el **contendor** anterior» | «contenedor» |
| E17 | §4.4.5 | «**Translada** el flujo» | «Traslada el flujo» |
| E18 | §4.5 | «se **concluyo**» | «se concluyó» |
| E19 | §4.5.2 | «ya que **el el** estado» | «ya que el estado» |
| E20 | §4.5.3 | «el que **configuro** o integró» | «configuró» |
| E21 | §4.5.3 | «reentragadas» | «reentregadas» |
| E22 | §4.5.4 | «no ocurre **bajo a** una cadencia fija» | «no ocurre a una cadencia fija» |
| E23 | §4.5.4 | «**ente** que el valor no haya cambiado» | «**entre** que el valor…» |
| E24 | §4.5.4 | «canal de **dignóstico**» | «diagnóstico» |
| E25 | §4.5.4 | «se publica entero **sic ualquiera**» | «se publica entero **si cualquiera**» |
| E26 | §4.5.4 | «harán también **hará** que suban» | «harán también que suba» |
| E27 | §4.5.5, Tabla 17 | «**Sts**» con mayúscula, el resto en minúscula | Unificar a `sts` |
| E28 | §4.5.5 | «Todas las categorías tienen calidad de servicio 1 **aplica** el argumento» | «…calidad de servicio 1, **lo que aplica** el argumento» |
| E29 | §4.5.6 | «el dato que escribe un **producto** nuevo» | «un **productor** nuevo» |
| E30 | §4.5.6, tabla | «de una **categoria**» | «categoría» |
| E31 | §4.5.6 | «publicar **una una** revisión» | «publicar una revisión» |
| E32 | §4.6.2 | «superficie de **exposión**» | «exposición» |
| E33 | §4.4.6, Tabla 15 | «**Cortafuego**» | «Cortafuegos» |
| E34 | §4.8 | «descartables y **reconstruirles**» | «reconstruibles» |
| E35 | §4.8 | «qué significa lo que **transporte**» | «lo que transporta» |
| E36 | Global | «capitulo» sin tilde en varias apariciones | «capítulo» |

## F. Referencias al repositorio — resueltas

El repositorio está publicado en **https://github.com/Greytor/IDP-TFM** y citado como **[48]**.
Este `.md` ya incorpora las seis referencias en el texto; hay que trasladarlas al Word:

| Apartado | Qué se cita | Ruta en el repositorio |
|---|---|---|
| §4.1.3 | El despliegue completo y su documentación | raíz del repositorio |
| §4.3.2 | Los cuatro simuladores de campo | `deploy/1-campo/sims/` |
| §4.5 | El contrato completo del UNS (v0.5) | `docs/contracts/UNS.md` |
| §4.5.3 | El diccionario de las 27 variables | `deploy/2-edge/def-publisher/definitions.yml` |
| §4.6.1 | Zonas, conductos y direccionamiento | `docs/arquitectura/red-segmentacion.md` |
| §4.7.1 | Los catorce registros de decisión | `docs/adr/` |

Entrada bibliográfica que hay que añadir al Capítulo 9:

> [48] J. F. Desiderio Moreira, «IDP-TFM — Arquitectura de referencia basada en Unified
> Namespace para la interoperabilidad OT-IT», repositorio de software, Greytec S.A.S., 2026.
> [En línea]. Disponible en: https://github.com/Greytor/IDP-TFM

## G. Añadidos de este `.md` que no están en el Word

Al insertar las referencias al repositorio se añadieron dos fragmentos de texto que
conviene revisar antes de trasladarlos:

| Apartado | Qué se añadió |
|---|---|
| §4.5.3 | Un párrafo sobre `definitions.yml` como fichero único y versionado del diccionario, y sobre que dar de alta un instrumento es editarlo sin tocar el flujo de adquisición |
| §4.7.1 | Un segundo párrafo con la disciplina de escribir el ADR **antes** de implementar, que es lo que distingue una decisión de una justificación |
