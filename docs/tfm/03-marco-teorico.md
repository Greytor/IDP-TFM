# Capítulo 3. MARCO TEÓRICO

> **Estado:** v3.0 — sincronizado con el documento Word del 2026-09-02 (redacción del autor).
> **Numeración:** Ilustraciones 4–9 y Tablas 2–8, continuando el Capítulo 2 (Ilustraciones 1–3, Tabla 1).
> **Citación:** IEEE. Referencias [1]–[46] en `bibliografia.md`.
> **Nota:** este fichero reproduce el capítulo redactado por el autor, con la ortografía corregida y la numeración de tablas homogeneizada. Las correcciones pendientes de trasladar al Word están listadas al final.

---

En el capítulo anterior revisamos qué existe en este dominio del conocimiento y qué queda sin resolver. Este capítulo cumple la función de fijar las herramientas conceptuales con las que se razona el diseño de la arquitectura. De esta forma solo retenemos los estándares, patrones y conceptos que fundamentan decisiones concretas de diseño y se les añaden los cuerpos teóricos que faltaron en la revisión: la teoría de sistemas de datos distribuidos y los patrones de integración basada en mensajería.

## 3.1 PROPÓSITO Y ESTRUCTURA DEL MARCO

El principal discurso sobre el UNS es sobre la infraestructura, pues describe fundamentalmente qué componentes se deben desplegar. La posición que se adopta en este trabajo es diferente: las garantías que se le atribuyen al patrón (como desacoplamiento, contextualización, resiliencia) no se derivan de los componentes, sino de propiedades formales conocidas desde hace décadas en la ingeniería de sistemas distribuidos y de integración empresarial.

Dicho de forma directa, un bróker MQTT no produce desacoplamiento por sí mismo, lo produce el modelo canónico de datos que ese bróker transporta. Y una base de datos no es una fuente de verdad, lo es el registro ordenado de eventos desde el cual esa base de datos se materializa. Hacer explícitos esos fundamentos es lo que permite pasar de una arquitectura que simplemente funciona conectando diferentes tecnologías, a una arquitectura que puede justificarse frente a un cliente, replicar en otra planta y defender técnicamente cuando alguien pregunte por qué no se utilizó otra tecnología o se hizo de otra manera.

En el estado del arte adoptamos la acepción del UNS que implica la integración de tres elementos: el bróker como canal, la jerarquía semántica como esquema de nombres y un registro durable y ordenado de eventos como fuente única de verdad. Este capítulo desarrolla cada uno de esos tres elementos y añade los que la implementación real obligaría a resolver, como la separación entre escritura y lectura, la materialización del dato para su consumo, la segmentación de la red y el reparto de capacidades en el borde.

*Tabla 2 Estructura del marco teórico y pregunta que responde cada bloque*

| # | Cap. | Concepto | Fuente principal | Pregunta que responde |
|---|---|---|---|---|
| 1 | 3.2 | Sistema de registro y datos derivados | Kleppmann [4], Kreps [35] | ¿Dónde reside la verdad del sistema? |
| 2 | 3.3 | CQRS: separación de mando y consulta | Young [36], Fowler [37] | ¿Quién escribe y quién lee? |
| 3 | 3.4 | Patrones de integración por mensajería | Hohpe y Woolf [5] | ¿Por qué el desacoplamiento reduce el coste de integración? |
| 4 | 3.5 | Jerarquía semántica | IEC 62264 [2] | ¿Cómo se nombra un activo de forma unívoca? |
| 5 | 3.6 | Publicación-suscripción y transporte | Eugster *et al.* [38], OASIS [15] | ¿Qué garantías ofrece el transporte y cuáles no? |
| 6 | 3.7 | Series temporales y modelo medallón | Armbrust *et al.* [39] | ¿Cómo se materializa el dato para su consumo? |
| 7 | 3.8 | Zonas, conductos y segundo canal | IEC 62443 [20], [21], NOA [17] | ¿Cómo se restringe el flujo sin romper la arquitectura? |
| 8 | 3.9 | Cómputo en el borde | Shi *et al.* [40], Bonomi *et al.* [41] | ¿Qué ocurre en campo y en el centro? |

Cada apartado cierra con una implicación de diseño que define cada decisión de arquitectura que se deriva de la teoría expuesta.

## 3.2 SISTEMA DE REGISTRO Y DATOS DERIVADOS

### 3.2.1 La distinción fundamental sobre los datos

Kleppmann [4] establece una distinción que resulta central para este trabajo y que la práctica industrial habitualmente omite: la diferencia entre un sistema de registro (*system of record*) y un sistema de datos derivados (*derived data system*).

Un sistema de registro contiene la versión autoritativa del dato, de forma que cuando existe una discrepancia entre dos representaciones, la del sistema de registro es por definición la correcta. Cada dato aparece en él una sola vez y esa aparición suele ser el resultado de una escritura que viene de fuera del sistema.

Por otro lado, un sistema de datos derivado contiene el resultado de transformar o procesar el dato de otro sistema, y su propiedad definitoria es la redundancia: si se pierde, puede reconstruirse desde el sistema de registro. Los índices, los cachés, las vistas materializadas, los agregados y las desnormalizaciones son todos datos derivados.

Lo relevante del planteamiento de Kleppmann es que ambos pueden estar implementados con la misma tecnología, porque la distinción no es técnica sino arquitectónica: reside en cómo fluye el dato y en quién es la autoridad; y añade que buena parte de la complejidad accidental de los sistemas de datos surge precisamente de no haber declarado explícitamente cuál es cuál.

Al trasladar esto al dominio industrial las consecuencias son inmediatas: un historiador de proceso, una base de datos de series temporales o un panel de Grafana no son fuentes de verdad, aunque en la práctica se los trate como tales. Son proyecciones de un flujo de eventos que ocurrió en la planta. Cuando el sistema de registro no está explícitamente identificado ocurre lo descrito en el capítulo 2.2.3: que cada sistema derivado se convierte por omisión en fuente paralela de verdad y aparece la divergencia sin un criterio para resolverla.

*Ilustración 4 Sistema de registro frente a sistemas de datos derivados*

### 3.2.2 El registro como abstracción unificadora

Kreps [35] formula la abstracción que resuelve el problema: el registro (*log*) entendido como una estructura de datos de solo adición, ordenada totalmente y con posiciones direccionables. Su tesis es que el registro es la abstracción que unifica los sistemas de datos distribuidos porque tres problemas que parecen distintos (la replicación, la integración de datos y el procesamiento de flujos) terminan siendo el mismo problema expresado sobre un registro.

Hay cuatro propiedades del registro que sostienen la arquitectura de este trabajo:

- **Inmutabilidad:** Los eventos no se modifican ni se borran, solo se añaden continuamente. Un error no se corrige alterando el pasado sino publicando un evento correctivo, de modo que el historial queda íntegro y auditable. Esto tiene un valor directo en entornos industriales donde la trazabilidad puede ser un requisito regulatorio.
- **Orden total:** Dentro de una partición los eventos tienen un orden definido y estable, y todos los consumidores observan la misma secuencia. Eso elimina de raíz una clase entera de discrepancias entre sistemas.
- **Consumo independiente:** Cada consumidor mantiene su propia posición de lectura, por lo que un consumidor lento, caído o recién incorporado no afecta a los demás. Esta es la propiedad que permite la difusión a múltiples destinos sin acoplarlos entre sí.
- **Reproducibilidad:** Un consumidor puede posicionarse en el pasado y reprocesar. De aquí se deriva que cualquier vista derivada sea descartable y reconstruible, lo que tiene consecuencias operativas de primer orden: corregir un error en una regla de cálculo consiste en corregir la regla y reprocesar, no en reparar a mano datos ya agregados.

Esta última propiedad es exactamente la carencia que en el capítulo 2.5.8 se identificó en todos los productos comerciales revisados, pues ninguno conserva el evento y por eso ninguno permite reprocesar, y es también lo que diferencia la tercera acepción del UNS de las otras, ya que sin registro durable no hay fuente de verdad, solamente un canal de paso.

### 3.2.3 Ordenación temporal y deriva de relojes

Adoptar el registro obliga a tratar un problema que la práctica industrial suele pasar por alto. Lamport [43] estableció que en un sistema distribuido el orden de los eventos no puede derivarse de forma fiable de relojes físicos independientes, y que lo relevante es la relación de precedencia causal.

En el escenario de este trabajo esto se manifiesta directamente en el hardware: un microcontrolador alimentado por batería, un controlador lógico y un gateway industrial tienen relojes que derivan entre sí. Por eso conviven dos marcas de tiempo con significados distintos: el **tiempo de evento** (cuándo se produjo la lectura en campo) y el **tiempo de ingesta** (cuándo llegó al registro central). Tras un corte de enlace, un lote de mensajes con tiempo de evento antiguo se ingesta con tiempo de ingesta actual, y si se confunden ambos el resultado son series temporales incorrectas o mediciones de retardo sin ningún sentido.

De ahí se sigue una exigencia sobre el contrato de datos: debe transportar el tiempo de evento de forma explícita, con marca de tiempo ISO 8601 en UTC generada en el origen, y debe incluir un número de secuencia monótono por dispositivo que aporte el orden causal por productor, con independencia de la deriva de su reloj.

### 3.2.4 Garantías de entrega e idempotencia

Ningún transporte distribuido puede garantizar a la vez entrega exactamente una vez, disponibilidad y tolerancia a particiones sin pagar un coste. De ahí las tres denominaciones clásicas de Calidad del Servicio (*Quality of Service*) son:

- **Como máximo una vez (QoS 0):** Puede perder mensajes, pero nunca duplica.
- **Al menos una vez (QoS 1):** Nunca pierde mensajes, pero puede duplicar.
- **Exactamente una vez (QoS 2):** Ni pierde ni duplica, pero exige una coordinación transaccional costosa entre productor, transporte y consumidor.

Helland [44] argumenta que en sistemas distribuidos a escala, la coordinación transaccional global es impracticable, y que el camino viable consiste en diseñar operaciones idempotentes, es decir, aquellas cuyo efecto es el mismo tanto si se aplican una vez como si se aplican varias veces, de forma que la entrega al menos una vez resulte funcionalmente equivalente a exactamente una vez.

Ese razonamiento es el que gobierna la elección de este trabajo: combinar calidad de servicio 1 (QoS 1) en el transporte con receptores idempotentes en los sistemas de materialización proporciona la garantía funcional que se busca, cero pérdidas y cero duplicados observables, a un costo operativo muy inferior al de implementar entrega exactamente una vez de extremo a extremo. La idempotencia se apoya en una clave natural compuesta por marca de tiempo, identificador de origen y nombre de métrica.

**Implicación de diseño 3.A:** El sistema de registro de la arquitectura es el registro de eventos inmutable, mientras que la base de datos de series temporales, el almacenamiento de objetos, los paneles y la capa de negocio son sistemas derivados descartables y reconstruibles. Ninguna aplicación escribe directamente en un sistema derivado. Todo mensaje transporta tiempo de evento generado en origen y número de secuencia, y todos los consumidores de materialización son idempotentes.

## 3.3 CQRS: SEPARACIÓN DE MANDO Y CONSULTA

### 3.3.1 El patrón

El patrón *Command Query Responsibility Segregation* (CQRS), formulado por Young [36] y difundido por Fowler [37], establece la separación entre el modelo que se emplea para modificar el estado (lado de mando) y el modelo que se emplea para consultarlo (lado de consulta). Su origen está en constatar que ambos tienen requisitos divergentes: la escritura necesita validación, consistencia y un modelo normalizado próximo al dominio, mientras que la lectura necesita rendimiento, formas desnormalizadas y proyecciones específicas por cada caso de uso. Obligar a ambos a compartir un único modelo termina comprometiendo a los dos.

El propio Fowler advierte de forma explícita que CQRS es un patrón de aplicabilidad limitada y que usarlo de forma indiscriminada añade complejidad sin beneficio, por lo que conviene justificar por qué el escenario industrial sí lo justifica, y la razón es la asimetría extrema que existe entre ambos lados.

*Tabla 3 Asimetría entre el lado de mando y el lado de consulta en el escenario industrial*

| # | Dimensión | Lado de mando (ingesta) | Lado de consulta (materialización) |
|---|---|---|---|
| 1 | Origen | Dispositivos de campo, controladores, medidores | Personas, paneles, servicios, sistemas externos |
| 2 | Patrón de acceso | Escritura continua, solo adición, alta frecuencia | Lectura por rangos temporales y agregados |
| 3 | Forma óptima | Evento inmutable y secuencial | Serie desnormalizada, preagregada |
| 4 | Requisito dominante | No perder ningún evento | Responder rápido, tolerar retraso |
| 5 | Consecuencia de un fallo | Pérdida irrecuperable de información de planta | Degradación temporal del servicio |

La quinta fila es la que convierte este patrón en una decisión estructural, ya que un fallo en el lado de consulta es reparable reconstruyendo la vista, pero un fallo en el lado de mando o escritura destruye información que la planta ya no volverá a producir.

*Ilustración 5 Separación entre el lado de mando y el lado de consulta*

### 3.3.2 La regla operativa y la consistencia eventual

De la separación se deriva una regla que gobierna toda la arquitectura y que es más restrictiva de lo que aparenta: **las aplicaciones escriben publicando eventos al registro de eventos y leen consultando vistas materializadas, pero nunca escriben directamente en una vista.** Basta una excepción, aunque sea puntual y bienintencionada, como una inserción directa en la base de datos "solo para este caso", para introducir un dato que no existe en el registro y romper la propiedad de reconstruibilidad para todo el sistema.

El precio del patrón es la consistencia eventual [42], ya que entre la publicación de un evento y su aparición en una vista transcurre un intervalo. Esta cesión es perfectamente aceptable en el dominio industrial y de hecho ya está presente en cualquier sistema SCADA con período de sondeo, pues nadie espera que un panel refleje el estado del proceso con latencia nula. Lo relevante no es eliminar el retraso, sino que ese retraso sea acotado, conocido y coherente con la necesidad del consumidor.

Conviene además situar la elección en el marco del teorema CAP [46]: ante una partición de red entre el borde y el centro, que es exactamente lo que ocurre cuando cae el enlace WAN hacia el servidor central, la arquitectura opta deliberadamente por disponibilidad y tolerancia a particiones frente a la consistencia inmediata: el borde continúa adquiriendo y encolando, y el centro converge cuando el enlace se restablece. La alternativa de bloquear la adquisición hasta poder confirmar la escritura en el centro es inaceptable en una planta industrial, por lo que es vital asegurar la lectura continua en el borde.

### 3.3.3 CQRS en el borde sin base de datos local

En este trabajo hay una derivación de la implementación habitual del patrón que merece mencionarse, y es que la lectura convencional del CQRS en el borde situaría ahí una base de datos local que sirve de modelo de lectura para el operador de campo. En esta arquitectura se prescinde de ella en consecuencia directa de lo expuesto en el capítulo 3.2.1: una base de datos en el borde sería una vista derivada de segundo orden y no un sistema de registro, porque el registro autoritativo estaría en el servidor central. Eso crearía un conflicto entre los datos existentes en la base de datos directamente desde la lectura en el borde y el sistema de registro en el servidor central.

Esa base de datos no aportaría durabilidad real, ya que la durabilidad la aporta el encolado persistente del bróker de borde mediante la técnica de redes de almacenamiento y reenvío (*store and forward*), sino que aportaría la necesidad de administrar una base de datos en el dispositivo de borde con lo que implica: aumento del consumo de memoria, gestión de esquemas, migraciones, copias de seguridad y, sobre todo, un estado persistente susceptible de divergir del centro o del sistema de registro, con la necesidad añadida de un mecanismo de reconciliación entre ambos.

El modelo de lectura local se resuelve entonces con una ventana viva en memoria sobre el flujo del bróker, que cubre de sobra la necesidad real del operador de campo, que es ver el estado actual y la tendencia inmediata. El historial profundo de esta forma se mantiene como responsabilidad del servidor central.

**Implicación de diseño 3.B:** Se adopta CQRS estricto en toda la arquitectura, incluido el borde. Ningún componente escribe directamente en una vista materializada. El borde no aloja base de datos, su modelo de lectura es una ventana en memoria y su durabilidad procede de técnicas de almacenamiento y reenvío en el bróker local. Se acepta la consistencia eventual y se prioriza la disponibilidad del borde frente a la consistencia inmediata en el centro.

## 3.4 PATRONES DE INTEGRACIÓN BASADA EN MENSAJERÍA

La obra de Hohpe y Woolf [5] cataloga sesenta y cinco patrones de integración por mensajería con un nivel de formalización que el discurso industrial sobre el UNS no alcanza.

En primer lugar, aporta un vocabulario preciso para nombrar cada pieza de la arquitectura, lo que permite sustituir la descripción por producto ("un Node-RED que lee Modbus") por la descripción por función ("un adaptador de canal"), que es independiente de la implementación y sobrevive al cambio de herramienta. En segundo lugar contiene la explicación formal de por qué el Unified Namespace produce el efecto que se le atribuye.

### 3.4.1 El núcleo: bus de mensajes más modelo canónico

Este segmento es el fundamento teórico central del trabajo.

El patrón *Message Bus* describe una infraestructura común que permite a sistemas heterogéneos interoperar mediante un conjunto compartido de interfaces. El patrón *Canonical Data Model* describe un modelo de datos independiente de cualquier aplicación concreta, al que cada participante traduce desde su formato nativo. Hohpe y Woolf formulan la propiedad que interesa para este trabajo: sin un modelo canónico, integrar N sistemas con M sistemas exige N x M traductores, uno por cada par, mientras que con el modelo canónico solo exige N + M, uno por participante.

Lo relevante no es la reducción del número absoluto de traductores, que es evidente, sino el cambio en el régimen de crecimiento que ya se señaló en el capítulo 2.2.2: se pasa de un crecimiento multiplicativo a uno aditivo. De ahí se deriva la propiedad que realmente importa en la operación diaria: incorporar un consumidor nuevo añade una sola pieza y no obliga a tocar ninguna de las existentes, mientras que en la topología punto a punto obliga a intervenir en las N fuentes.

*Ilustración 6 Extracto de la literatura de Hohpe y Woolf: el modelo de datos canónico*

Este análisis permite además corregir la acepción A que se identificó en el capítulo 2.3.2. El bus por sí solo no define ningún traductor y, en consecuencia, lo que hace es trasladar las N x M traducciones al interior de los consumidores, donde dejan de ser visibles pero siguen existiendo y siguen costando lo mismo. Es el modelo canónico (es decir, el contrato UNS) el que produce realmente la reducción de integraciones. Por eso este trabajo trata el contrato como el artefacto principal de la arquitectura y no como documentación de acompañamiento.

Vale la pena retomar el matiz introducido en el capítulo 2.2.2, donde se señaló que en una planta real no todas las fuentes se conectan con todos los consumidores, ya que muchas fuentes quedan huérfanas y muchos consumidores se encadenan entre sí. Eso no invalida el análisis, pero sí ajusta la lectura, ya que en la práctica el coste evitado no es tanto el de las integraciones que se construyeron sino el de las integraciones que nunca llegaron a construirse porque su coste marginal las hacía inviables. De esa forma el dato generalmente sí existe en la planta, pero nunca llega a quien podía usarlo o necesitarlo. Esa es una de las pérdidas reales que el modelo canónico busca evitar y es también la más difícil de cuantificar.

### 3.4.2 Catálogo de patrones aplicados

La Tabla 4 recoge los patrones que se utilizarán efectivamente en la arquitectura, con su función y con el componente que lo materializa. Es el vocabulario con el que se describe el diseño en el capítulo 4.

*Tabla 4 Patrones de integración de Hohpe y Woolf aplicados en la arquitectura*

| # | Patrón | Función | Materialización en la arquitectura |
|---|---|---|---|
| 1 | Message Bus | Infraestructura común de interoperación | El UNS en conjunto: bróker de borde, bróker central y registro de datos |
| 2 | Canonical Data Model | Modelo independiente de aplicación al que todos traducen | El contrato UNS: jerarquía, envelopes, unidades y calidad |
| 3 | Publish-Subscribe Channel | Difusión a múltiples consumidores independientes | Tópicos MQTT con comodines por categoría |
| 4 | Channel Adapter | Conecta un sistema ajeno a la mensajería sin modificarlo | Adquisición Modbus TCP o OPC UA en el borde |
| 5 | Message Translator | Convierte entre formatos manteniendo la intención | Normalización de registros nativos al envelope del contrato |
| 6 | Messaging Bridge | Conecta dos sistemas de mensajería | Puente del bróker de borde al bróker central |
| 7 | Guaranteed Delivery | El mensaje sobrevive a fallos del transporte | Persistencia local más Calidad del Servicio 1 con sesión persistente |
| 8 | Durable Subscriber | El suscriptor no pierde lo emitido mientras estaba ausente | Sesión persistente en MQTT / grupos de consumidores en el registro |
| 9 | Idempotent Receiver | Tolera duplicados sin efecto observable | Clave natural compuesta e inserción con resolución de conflicto |
| 10 | Content-Based Router | Encamina según el contenido o el destino del mensaje | Encamina por categoría del tópico hacia distintos consumidores |
| 11 | Event Message | Notifica que algo ocurrió | Categorías de dato, estado, evento y diagnóstico |
| 12 | Command Message | Solicita que algo ocurra | Categoría de mando, con identificador idempotente |
| 13 | Document Message | Transfiere datos sin implicar acción | Carga útil con varias variables por ciclo de muestreo |
| 14 | Message Sequence | Permite detectar pérdidas y ordenar mensajes | Número de secuencia monótono por dispositivo |
| 15 | Dead Letter Channel | Aísla mensajes no procesables | Cuarentena de mensajes que no validan contra el contrato |

**Implicación de diseño 3.C:** El artefacto central de la arquitectura es el contrato UNS entendido como el modelo canónico y no el bróker. La adquisición se implementa como adaptador de canal y traductor de mensajes, de forma que esa capa resulte sustituible sin efecto sobre el resto del sistema. Todo mensaje de datos porta un número de secuencia.

## 3.5 LA JERARQUÍA SEMÁNTICA COMO ESQUEMA DE NOMBRES

### 3.5.1 ¿Por qué ISA-95?

Establecida la necesidad de un modelo canónico, queda decidir cómo se nombran los elementos del dominio. La respuesta de este trabajo, y lo generalizado en la comunidad industrial, es la de adoptar la jerarquía de equipos de ISA-95 / IEC 62264 [2] como esquema de nombres por tres razones:

1. **Reconocimiento:** La jerarquía empresa, emplazamiento, área, línea, celda y activo es el vocabulario con el que el personal de planta ya describe su instalación, y es un esquema de nombres que coincide con el mapa mental del usuario.
2. **Estabilidad:** La estructura física y organizativa de una planta cambia con una frecuencia mucho menor que su instrumentación o sus sistemas de información. Un espacio de nombres anclado en la jerarquía de la planta es más estable que uno anclado en la topología de la red o en el fabricante de los equipos, que son los dos criterios alternativos más habituales en la práctica y también los dos más frágiles, pues basta cambiar de proveedor de PLC o resegmentar la red para invalidar todo el esquema.
3. **Capacidad de consulta:** Una jerarquía semántica permite suscripciones por comodín con significado de negocio, de modo que suscribirse a todos los datos crudos de un área es una operación natural sobre el espacio de nombres y no requiere conocer qué dispositivos existen en ella ni cuántos se añadirán después. Esta propiedad es la que permite que un consumidor nuevo se incorpore sin coordinarse con ninguna fuente.

### 3.5.2 Categorías funcionales como último nivel

La jerarquía de activos responde a dónde está el dato, pero no a qué clase de dato es. Un mismo activo emite información heterogénea: mediciones continuas, estado operativo, eventos discretos, órdenes y diagnóstico. Tratarlas a todas de forma indiferente obliga a cada consumidor a filtrar por contenido, lo que vuelve a introducir el acoplamiento semántico que se estaba tratando de evitar.

Por eso el diseño añade un nivel de categoría funcional al final de la jerarquía, y esa decisión se apoya directamente en la Tabla 4: la separación entre el *Event Message*, *Command Message* y *Document Message* es la que sostiene la distinción entre dato, evento y mando. La necesidad de un estado consultable en cualquier momento, que se resuelve con mensajes retenidos como se verá en el apartado 3.6.3, sostiene la categoría de estado; y el patrón de segundo canal NOA que se describió en el apartado 2.4.5 sostiene la categoría de diagnóstico.

La distinción adicional entre dato crudo y dato derivado hace verificable en el propio bróker la regla de que ningún procesador publique como si fuera un dispositivo de campo y ningún dispositivo de campo publique resultados calculados. Esa regla, expresada como lista de control de acceso, es lo que preserva la trazabilidad del origen del dato.

### 3.5.3 Los planos del espacio de nombres

La jerarquía sitúa el activo y la categoría clasifica el mensaje, por lo que queda una tercera pregunta que ninguna de las dos responde: qué naturaleza de conocimiento transporta ese mensaje. No es lo mismo el valor que un sensor acaba de leer, el promedio que alguien calculó a partir de él, y el hecho de que ese sensor mida en grados Celsius entre 15 y 80. Los tres se refieren al mismo activo y los tres son necesarios, pero cambian a ritmos completamente distintos y se consumen de formas distintas.

La práctica industrial ha formulado esa dimensión como un conjunto de *namespaces* dentro del UNS. La formulación más difundida es atribuida a Walker Reynolds y asociada al mismo origen divulgativo que el propio término UNS (apartado 2.3.1), y distingue:

- **Functional:** Organiza los parámetros según su función o propósito, con independencia de dónde estén físicamente o en qué red vivan.
- **Informative:** Organiza los datos abstraídos por su contenido informativo, destinados al consumo por software, lagos de datos y otros sistemas.
- **Definitional:** Organiza los parámetros por sus definiciones y atributos, lo que rara vez o nunca cambia, como la fecha de instalación, la versión de firmware o el rango de calibración.
- **Ad-hoc:** Organización temporal y propia de una instalación concreta, que en ocasiones termina consolidándose.

Es importante señalar que esta taxonomía procede de material formativo de 4.0 Solutions y no de una especificación normativa, con la misma condición de literatura gris que se declaró para el concepto general en el capítulo 2.1.2.

De esta forma se definen dos ejes para la definición del contrato de datos del UNS: el plano dice de qué clase de conocimiento se trata y la categoría dice qué forma tiene el mensaje. Este trabajo adoptará ambos ejes de forma explícita.

*Tabla 5 Los dos ejes del espacio de nombres: plano y categoría*

| # | Plano | Qué contiene | Ritmo de cambio | Categorías del contrato |
|---|---|---|---|---|
| 1 | Definitional | Lo que el activo es | Muy bajo, cambia con una intervención de ingeniería | `def` |
| 2 | Functional | Lo que el activo hace ahora | Alto, al ritmo del proceso | `dat/raw`, `sts`, `cmd`, `evt`, `diag` |
| 3 | Informative | Lo que se deduce del activo | Medio, al ritmo del cálculo | `dat/der`, `_kpi` |
| 4 | Ad-hoc | Trabajo temporal o experimental | Indeterminado | `_adhoc` |

Las categorías de este trabajo se fundamentan en los tipos de mensaje de Hohpe y Woolf, la semántica de retención (3.6.3) y el patrón del segundo canal de NOA, porque esa base prescribe garantías de entrega y política de retención, algo que la clasificación por naturaleza del conocimiento no hace al ser solamente descriptiva. El eje de planos sigue siendo útil como lectura complementaria, ya que agrupa por ritmo de cambio, que es lo que determina si un dato debe publicarse retenido o no.

Dentro de los planos, el definitional es el que más peso arquitectónico tiene porque resuelve el coste de conocimiento planteado en 2.2.2: en la integración punto a punto, la semántica del dato queda implícita y termina viviendo en las personas que construyeron la integración. Un modelo canónico sin plano definitional no elimina ese coste, solo lo desplaza a la configuración del gateway o a una tabla de base de datos (el namespace transporta valores, pero no se autodescribe). Publicar la definición dentro del propio UNS, de forma retenida, cierra ese hueco porque el consumidor recibe primero qué es el activo y qué significan sus variables, y después la telemetría, sin tener que preguntarle a nadie. Eso es lo que vuelve real el desacoplamiento, no solo la ausencia de conexión directa.

### 3.5.4 El payload como representación del activo

En el apartado 2.4.7.1 se señaló que RAMI 4.0 [22] plantea el AAS (*Asset Administration Shell*) como abstracción de toda la información digitalizada relevante de un activo, y que en este trabajo esa función la cumple el payload JSON dentro del UNS.

El plano definitional de la práctica industrial y el AAS de RAMI 4.0 apuntan al mismo objetivo desde dos tradiciones diferentes que no se citan entre sí. Una nace de la comunidad de integradores anglosajona y la otra de la normalización industrial alemana, y ambas concluyen que el activo debe llevar consigo su propia descripción. Cuando dos líneas independientes llegan a la misma conclusión, la decisión de diseño que se apoya en ellas es más sólida que si dependiera de una sola.

El AAS es una especificación completa que abarca submodelos, identificadores globales y descubrimiento entre activos, mientras que el envelope del contrato UNS cubre solo una parte: la representación en tiempo real del estado y las mediciones del activo, con su unidad, su calidad y su procedencia. La coincidencia es de intención, ya que ambos persiguen que el activo se represente digitalmente de forma autodescriptiva y no como un valor suelto sin contexto, pero el contrato UNS se queda deliberadamente en el subconjunto que resuelve el problema de este trabajo y que puede sostener un dispositivo de campo con memoria limitada.

### 3.5.5 Límites de ISA-95 y el aplanamiento de la pirámide

Como ya se estableció en el apartado 2.4.1, ISA-95 aporta la jerarquía y ahí termina su alcance, pues no define transporte, ni esquema de carga útil, ni garantías de entrega. Todo lo que excede al nombrado debe especificarse en el contrato, y ese es el sentido preciso en que este trabajo afirma estar alineado con ISA-95.

Lo que el UNS elimina es el flujo obligatoriamente vertical del dato, es decir, la exigencia de que para llegar del nivel 1 al nivel 4 haya que atravesar secuencialmente los niveles intermedios. Lo que el UNS conserva, y de hecho refuerza, es la jerarquía de nombres y de responsabilidades. La pirámide se mantiene como modelo de organización y responsabilidad y desaparece como modelo de transporte. Formulado correctamente, ISA-95 no queda superada, sino que se emplea para lo que es sólida (nombrar y organizar) y no para lo que nunca fue diseñada (transportar telemetría de alta frecuencia).

**Implicación de diseño 3.D:** El espacio de nombres se organiza en dos ejes ortogonales: la jerarquía ISA-95 con categorías funcionales como último nivel, y los cuatro planos según la naturaleza del conocimiento. Se incorpora una categoría propia del plano definitional, publicada de forma retenida, que declara la identidad del activo y el diccionario de sus variables, de modo que el namespace sea autodescriptivo y el coste de conocimiento no se desplace fuera del UNS. La distinción entre dato crudo y derivado se hace verificable mediante listas de control de acceso en el bróker. Todo lo que ISA-95 no cubre se especifica de forma explícita en el contrato UNS.

## 3.6 PUBLICACIÓN-SUSCRIPCIÓN Y GARANTÍAS DEL TRANSPORTE

### 3.6.1 Las tres dimensiones del desacoplamiento

Eugster *et al.* [38] ofrecen la caracterización formal del paradigma de publicación-suscripción y establecen que su valor reside en producir desacoplamiento en tres dimensiones a la vez. La distinción es más útil que la noción intuitiva de desacoplamiento y permite razonar con precisión sobre qué garantiza la arquitectura y qué no:

- **Desacoplamiento en el espacio:** productor y consumidor no se conocen ni mantienen referencias mutuas, de forma que el productor no sabe cuántos consumidores existen ni quiénes son.
- **Desacoplamiento en el tiempo:** no necesitan participar en la interacción de forma simultánea, por lo que un consumidor puede estar desconectado cuando se produce el evento y recibirlo después.
- **Desacoplamiento en la sincronización:** el productor no se bloquea al publicar ni el consumidor al esperar, y ambos operan con su propio flujo de control.

De las propiedades atribuidas al UNS en la tabla del capítulo 2.3.3, el desacoplamiento se apoya principalmente en la primera dimensión y la resiliencia del borde en la segunda. Esta correspondencia importa porque muestra que esas propiedades no son afirmaciones de mercado, sino consecuencias conocidas del paradigma aplicadas a un escenario industrial.

La publicación-suscripción debilita la garantía de extremo a extremo, porque el productor no recibe confirmación de que un consumidor concreto haya procesado su mensaje. Esa pérdida de garantía es intrínseca al patrón y no un defecto de implementación. En telemetría la contrapartida es aceptable, pero deja de serlo en la categoría de mando, y por eso el contrato exige que todo mando genere un evento de respuesta que lo referencie. Es la reintroducción controlada del acuse de recibo donde se lo requiere.

### 3.6.2 Calidad del servicio

MQTT [14], [15] define tres niveles de calidad de servicio que corresponden a las tres semánticas de entrega expuestas en el apartado 3.2.4. La elección de este trabajo es la calidad de servicio 1 para todas las categorías, en aplicación directa del argumento de Helland [44]: la garantía de exactamente una vez sale más barata mediante receptores idempotentes que mediante el protocolo.

La calidad de servicio de MQTT es una garantía salto a salto y no de extremo a extremo: rige entre cliente y bróker, y después otra vez entre bróker y cliente suscriptor. En una arquitectura con bróker de borde, puente y bróker central, la garantía completa no la proporciona el protocolo sino la composición de tres elementos: calidad de servicio 1 en cada salto, sesión persistente en el puente y receptores idempotentes en la materialización.

*Ilustración 7 La garantía de extremo a extremo es una composición de garantías por salto*

### 3.6.3 Mensajes retenidos y testamento como mecanismos de estado

Hay dos mecanismos de MQTT que resuelven un problema que la publicación-suscripción pura no aborda: cómo conoce un consumidor recién incorporado el estado presente de un activo que no ha cambiado recientemente.

El **mensaje retenido** hace que el bróker conserve el último mensaje publicado en un tópico y lo entregue de inmediato a todo nuevo suscriptor. Su efecto es que el estado se vuelve consultable sin sondeo, lo que resulta esencial para el desacoplamiento: un consumidor nuevo obtiene el estado actual de todos los activos en el mismo instante en que se suscribe, sin pedir nada a ninguna fuente. En términos del apartado 3.2.1, es una vista materializada mínima alojada en el propio bróker.

El **testamento** (*Last Will and Testament*) permite registrar en la conexión un mensaje que el bróker publicará automáticamente si el cliente se desconecta de forma no limpia, lo que proporciona detección de fallo del productor sin necesidad de sondeo activo. Es el mecanismo elemental que Sparkplug B eleva a protocolo completo con sus mensajes de nacimiento y defunción, como se describió en el apartado 2.4.4.

El diseño aplica ambos de forma diferenciada: retención activa en la categoría de estado, donde el último valor conocido tiene significado permanente, y retención desactivada en las categorías de dato y evento, donde la última muestra o el último evento no representan el presente.

### 3.6.4 Almacenamiento y reenvío como propiedad compuesta

La resiliencia ante corte de enlace no procede de un componente concreto sino de la composición de tres mecanismos: sesión persistente en el puente hacia el bróker central, cola de mensajes salientes con persistencia y calidad de servicio 1, que retiene el mensaje hasta recibir confirmación.

Este análisis permite además identificar con precisión dónde está el límite real de la resiliencia, que no es el protocolo sino la capacidad de la cola. El tiempo máximo de corte tolerable resulta de dividir la capacidad de encolado entre la tasa de publicación agregada, lo que convierte una afirmación cualitativa como "el borde resiste cortes" en un parámetro de diseño dimensionable. Esto tiene además una consecuencia comercial directa, porque permite responder a un cliente cuánto tiempo aguanta su instalación sin enlace y qué hay que cambiar para que aguante más, que es exactamente el tipo de pregunta que un integrador debe poder contestar con un número concreto.

### 3.6.5 Por qué MQTT con JSON estructurado y no Sparkplug B

La decisión de emplear MQTT con carga útil JSON estructurada en lugar de Sparkplug B, cuyas características se revisaron en el apartado 2.4.4, se apoya en tres consideraciones.

- **Qué aporta realmente Sparkplug:** Sus dos aportaciones sustantivas son la gestión automática de estado mediante nacimiento y defunción, y la eficiencia del formato binario. La primera es replicable con testamento y latido (*heartbeat*) explícitos, tal como se describió en el apartado anterior. La segunda es poco relevante en un escenario cuyo cuello de botella no es el ancho de banda.
- **Qué cuesta:** La estructura de tópicos de Sparkplug se organiza en torno a la topología de nodos de borde y no en torno a la jerarquía ISA-95 del negocio, lo que obliga a forzar la correspondencia dentro del campo `group_id`. Dado que en el apartado 3.5.1 se estableció la jerarquía semántica como el habilitador principal del desacoplamiento, adoptar Sparkplug supondría debilitar precisamente la propiedad que se busca. A esto se suma la opacidad del payload binario durante la construcción, que encarece la depuración justo en la fase donde más se depura.
- **Qué exige mantener la puerta abierta:** La decisión no es irreversible si el envelope JSON emplea campos semánticamente equivalentes a las métricas de Sparkplug, es decir marca de tiempo, valor, calidad y nombre de métrica, de modo que una migración posterior sea una traducción mecánica y no un rediseño.

**Implicación de diseño 3.E:** Se adopta MQTT con calidad de servicio 1 en todos los saltos, sesión persistente en el puente y receptores idempotentes, componiendo así la garantía de extremo a extremo. La retención se activa únicamente en la categoría de estado. El tiempo máximo de corte tolerable se dimensiona explícitamente como capacidad de cola dividida entre tasa de publicación. El envelope JSON mantiene compatibilidad semántica con Sparkplug B.

## 3.7 MATERIALIZACIÓN: SERIES TEMPORALES Y MODELO MEDALLÓN

### 3.7.1 Naturaleza de la carga de trabajo

El lado de consulta del patrón CQRS debe materializar el flujo de eventos en una forma eficiente para el acceso. La carga de trabajo de telemetría industrial tiene características que la distinguen de la carga transaccional convencional y que determinan la elección tecnológica: escritura dominada por adiciones en orden temporal aproximado, ausencia casi total de actualizaciones y borrados, consultas casi siempre acotadas por rango temporal, agregación como operación predominante y necesidad de correlacionar la serie con contexto relacional, es decir, con qué activo la produjo, en qué área está y bajo qué orden de producción se generó.

Esta última necesidad es la que decide la elección de motor. Una base de datos de series temporales pura optimiza las cuatro primeras características a costa de la quinta, y entonces la correlación con el contexto termina resolviéndose en la aplicación, lo que reintroduce lógica de integración fuera del contrato. Un motor relacional extendido con capacidades de serie temporal, con particionado automático por tiempo, compresión columnar y agregados continuos, cubre las cinco y permite que la contextualización sea una operación de reunión declarativa en SQL en lugar de código a medida.

### 3.7.2 El modelo medallón y su correspondencia con CQRS

La arquitectura medallón organiza el dato materializado en tres capas de refinamiento progresivo, bronce, plata y oro, y procede del ámbito de las plataformas analíticas modernas [39], [45]. Su adopción en este trabajo no es estética sino estructural, porque cada capa tiene una función distinta y una regla de reconstrucción distinta.

*Tabla 6 Capas del modelo medallón y su función en la arquitectura*

| # | Capa | Contenido | Transformación aplicada | Reconstruible desde |
|---|---|---|---|---|
| 1 | Bronce | Evento tal como se recibió, con la carga útil íntegra | Ninguna, salvo el desempaquetado del envelope | El registro de eventos |
| 2 | Plata | Serie normalizada por variable, tipada, con unidad y calidad | Aplanamiento, tipado y resolución del diccionario de variables | La capa bronce |
| 3 | Oro | Indicadores y agregados listos para consumo | Agregación temporal y cálculo de indicadores de negocio | La capa plata |

La correspondencia con el apartado 3.2.1 es exacta y explica por qué el modelo encaja: las tres capas son datos derivados y cada una es reconstruible desde la anterior o, en última instancia, desde el registro. La capa bronce cumple además una función que merece destacarse, porque al conservar la carga útil íntegra permite recuperar información que las capas superiores descartaron sin necesidad de reprocesar el registro completo. Es un punto intermedio de reconstrucción que abarata el reproceso.

La decisión de implementar las capas superiores como vistas en lugar de tablas materializadas responde al principio de no optimizar antes de tener evidencia de que hace falta. Mientras el volumen lo permita, la vista garantiza coherencia automática con la capa inferior; y cuando el volumen lo exija, convertirla en agregado continuo es una operación local que no altera el contrato de consumo ni obliga a tocar los paneles.

*Ilustración 8 Modelo medallón y direcciones de refinamiento y reconstrucción*

### 3.7.3 ¿Por qué no un lago de datos (DataLake)?

Descartar la aproximación de lago de datos merece justificación, dado que es la respuesta dominante en el ámbito de la analítica. El argumento es el que ya se expuso en el apartado 2.2.3 al describir el antipatrón del *datalake* sin contexto: traslada el coste de interpretación aguas abajo, a cada consumidor. Dicho en los términos del apartado 3.4.1, un lago de datos es un bus sin modelo canónico, porque resuelve el almacenamiento y no resuelve la traducción, con lo que las N x M traducciones reaparecen intactas en la capa analítica.

La arquitectura propuesta invierte el orden y contextualiza en origen, antes de la persistencia, de modo que el dato llega ya con unidad, calidad, procedencia y ubicación semántica. El almacenamiento de objetos con formato columnar se reserva para archivado frío y reproceso, que es la función en la que efectivamente aporta valor.

**Implicación de diseño 3.F:** La materialización emplea un motor relacional con extensión de series temporales, para permitir la correlación declarativa entre telemetría y contexto. El dato se organiza en capas bronce, plata y oro, todas ellas derivadas y reconstruibles. La contextualización ocurre en origen, antes de la persistencia.

## 3.8 LA SEGURIDAD COMO PROPIEDAD ARQUITECTÓNICA

### 3.8.1 Zonas y conductos como restricción previa de diseño

La serie IEC 62443 [20], [21] aporta al marco teórico una idea con consecuencias directas sobre el diseño del flujo de datos: la seguridad se expresa como propiedad topológica y no como un conjunto de controles superpuestos sobre una red ya construida.

Una zona agrupa activos con requisitos de seguridad homogéneos y un conducto es un canal de comunicación explícitamente autorizado entre zonas, con sus propios requisitos. El diseño consiste en particionar el sistema en zonas de confianza homogénea y enumerar de forma exhaustiva los conductos permitidos, de modo que todo flujo no enumerado queda prohibido por defecto.

La consecuencia para este trabajo es que la partición en zonas **restringe el espacio de arquitecturas admisibles** y por tanto debe considerarse durante el diseño y no después. Si la zona de operación no puede iniciar conexiones hacia la zona de negocio, entonces cualquier arquitectura que requiera que un consumidor de negocio consulte directamente a un dispositivo de campo queda descartada de antemano. Lejos de ser un obstáculo, esa restricción refuerza el patrón, porque una arquitectura mediada por un espacio de nombres alojado en la zona intermedia la satisface de forma natural: la operación publica hacia el centro y el negocio consume desde el centro, sin que ambas zonas se comuniquen jamás de forma directa.

### 3.8.2 Plano de datos y plano de control

Una segunda distinción conceptual valiosa en el escenario de activos distribuidos y procedente de la práctica de redes es la separación del plano de datos, es decir el flujo de telemetría que sale de la planta, del plano de control, que es el acceso administrativo a los equipos.

Su relevancia es que ambos planos tienen requisitos de seguridad y disponibilidad distintos y no deberían compartir mecanismo. La telemetría puede salir mediante una conexión saliente cifrada iniciada desde la planta, sin necesidad de abrir ningún puerto hacia el interior, mientras que el acceso administrativo exige autenticación fuerte, trazabilidad y un canal independiente. Confundir ambos planos, que es el error habitual de resolver la telemetría abriendo una red privada virtual permanente, amplía la superficie de exposición sin necesidad, porque convierte un flujo unidireccional en un canal bidireccional de propósito general.

### 3.8.3 El modelo de tres zonas y la excepción del mando

De los dos apartados anteriores se deriva el modelo de tres zonas que la arquitectura implementa: una zona de operación que aloja los dispositivos de campo, el control y la adquisición; una zona intermedia desmilitarizada que aloja el espacio de nombres, el registro de eventos y la persistencia; y una zona de negocio que aloja los consumidores. Los conductos autorizados son dos, de operación a zona intermedia para publicar y de zona de negocio a zona intermedia para consumir, sin ningún conducto directo entre operación y negocio.

La categoría de mando del contrato constituye la única excepción controlada a esa direccionalidad, ya que es el único flujo que desciende hacia la operación. Por eso el contrato le exige identificador idempotente, emisor identificado y evento de respuesta que lo referencie. La auditabilidad del mando no es un añadido opcional, sino la condición que permite admitirlo sin comprometer el principio.

*Ilustración 9 Segmentación IT/OT/DMZ*

### 3.8.4 NOA como patrón general de segundo canal

La NAMUR Open Architecture [17]-[19] aporta un patrón que complementa lo anterior en un plano distinto, al separar el canal de proceso, que es el lazo de control y permanece intacto y certificado, de un canal de diagnóstico paralelo que extrae información de monitorización sin interferir con aquel.

Su valor conceptual para este trabajo va más allá del caso de uso de instrumentación inteligente, porque formaliza un principio general aplicable a toda la arquitectura: la información sobre la **salud del sistema** debe fluir por un canal semánticamente diferenciado del de los datos de proceso, de manera que su volumen, su cadencia o su fallo no puedan afectar al flujo principal. De ahí procede la categoría de diagnóstico del contrato, que se emplea tanto para la salud de la instrumentación como para la del propio gateway de borde.

**Implicación de diseño 3.G:** La partición en tres zonas con conductos explícitos es una restricción de diseño previa y no un control posterior. La telemetría emplea conexión saliente en el plano de datos y la administración emplea un plano de control independiente. La categoría de mando es la única excepción a la direccionalidad y está sujeta a idempotencia, identificación de emisor y evento de respuesta. La salud del sistema fluye por una categoría diferenciada, conforme al patrón de segundo canal.

## 3.9 CÓMPUTO EN EL BORDE

### 3.9.1 Borde y niebla

La literatura fundacional sobre cómputo distribuido cerca del dato distingue dos nociones que conviene emplear con precisión. Bonomi *et al.* [41] introducen el cómputo en la niebla (*fog computing*) como capa intermedia entre los dispositivos y la nube, caracterizada por proximidad geográfica, baja latencia y conciencia de la ubicación. Shi *et al.* [40] formulan el cómputo en el borde (*edge computing*) como el procesamiento realizado en la frontera de la red y establecen las tres razones que lo justifican: reducir latencia, reducir el volumen transmitido y mantener autonomía operativa ante pérdida de conectividad.

La tercera razón es la determinante en el escenario industrial, porque no se trata de optimizar el coste de transmisión sino de que la planta siga adquiriendo y operando cuando el enlace no está disponible. En una planta media latinoamericana, donde el enlace de datos rara vez tiene garantías de servicio, esa autonomía es un requisito de partida más que una mejora.

### 3.9.2 Una taxonomía de capacidades del borde

La discusión sobre qué debe ejecutarse en el borde suele plantearse en términos binarios, lo que impide razonar sobre el compromiso. En este trabajo se adopta una taxonomía propia de capacidades, construida a partir de la literatura anterior y de la práctica de la organización en la que se enmarca el TFM, que permite decidir de forma explícita qué capacidades se activan y cuáles se difieren.

*Tabla 7 Taxonomía de capacidades del borde y criterio de asignación*

| # | Capacidad | Criterio de asignación al borde | Decisión |
|---|---|---|---|
| 1 | Conectividad protocolar (traducción a mensajería) | Es la función que define al gateway | Obligatorio |
| 2 | Almacenamiento y reenvío ante corte de enlace | Es necesario para la autonomía operativa (3.9.1) | Obligatorio |
| 3 | Normalización y contextualización | La contextualización en el origen es un principio de diseño (3.7.3) | Obligatorio |
| 4 | Analítica de flujo (filtrado, agregación, banda muerta) | Si el volumen o la latencia lo justifica | Condicional |
| 5 | Panel local independiente del enlace | Si existe operador de campo | Condicional |
| 6 | Modelos de inferencia en el borde | Solo con un caso de uso que lo financie | Condicional |
| 7 | Control supervisorio cerrado en el borde | Incompatible con las garantías de la plataforma | Excluida |

La exclusión explícita del control supervisorio cerrado en el borde se debe a que cerrar un lazo de control sobre la infraestructura de datos introduciría una dependencia funcional del proceso respecto de un sistema que, por diseño y como se estableció en el apartado 3.3.2, es eventualmente consistente y tolerante a particiones. Un lazo de control exige determinismo temporal y disponibilidad dura, que son propiedades que esta arquitectura deliberadamente no ofrece a cambio de escalabilidad y desacoplamiento. La frontera entre plataforma de datos y sistema de control no es entonces una convención de mercado ni una limitación comercial de Greytec, sino una consecuencia directa de las garantías que cada uno puede ofrecer.

### 3.9.3 La restricción de recursos como condición de diseño

El escenario de este trabajo incorpora una restricción que, como se señaló en el apartado 2.3.5, el estado del arte apenas documenta: el gateway de borde es un equipo industrial certificado con memoria muy limitada. Esa restricción no se trata aquí como un inconveniente a superar, sino como la condición realista de la mayoría del parque instalado y por tanto como un criterio de validez de la propuesta.

Su efecto sobre la arquitectura es directo y ya se anticipó en el apartado 3.3.3, porque obliga a decidir qué capacidades no residen en el borde. Y aquí ocurre algo que conviene señalar: la ausencia de base de datos local, lejos de ser una limitación aceptada por escasez de recursos, resulta ser la decisión teóricamente correcta una vez establecido que el registro autoritativo está en el centro. La restricción de hardware y el razonamiento arquitectónico convergen en la misma conclusión, lo que es un buen indicio de que la decisión es sólida y no una racionalización a posteriori de una limitación.

**Implicación de diseño 3.H:** El borde implementa siempre la conectividad protocolar, el almacenamiento y reenvío y la normalización y contextualización, y admite de forma condicional la analítica de flujo y el panel local. Difiere la inferencia de modelos y excluye el control supervisorio cerrado. La exclusión de este último se fundamenta en la incompatibilidad entre las garantías de una plataforma eventualmente consistente y los requisitos de un lazo de control. El borde no aloja base de datos, porque la restricción de recursos y el análisis del apartado 3.2.1 convergen en esa decisión.

## 3.10 SÍNTESIS DEL CAPÍTULO

En este capítulo se ha revisado la teoría y la literatura detrás de los patrones formales conocidos y cómo apoyan el desarrollo de este trabajo. Como punto de partida para el capítulo 4, la Tabla 8 consolida los constructos teóricos, su implicación de diseño y la decisión arquitectónica que soporta:

*Tabla 8 Trazabilidad del constructo teórico a la decisión de arquitectura*

| # | Constructo teórico | Implicación | Decisión de arquitectura |
|---|---|---|---|
| 1 | Sistema de registro frente a datos derivados | 3.A | Registro de eventos inmutable como fuente de verdad y bases de datos como vistas reconstruibles |
| 2 | El registro como abstracción unificadora | 3.A | Difusión a consumidores independientes con capacidad de reproceso |
| 3 | Ordenación causal y deriva de relojes | 3.A | Tiempo de evento en origen y número de secuencia por dispositivo |
| 4 | Idempotencia frente a transacciones | 3.A | Calidad de Servicio 1 más receptores idempotentes con clave natural |
| 5 | CQRS | 3.B | Nadie escribe en una vista, toda escritura es publicación de un evento |
| 6 | Consistencia eventual y teorema CAP | 3.B | Se prioriza disponibilidad y tolerancia a particiones en el borde |
| 7 | Bus de mensajes + modelo canónico | 3.C | El contrato UNS es el artefacto central de la arquitectura, no el bróker |
| 8 | Adaptador de canal y traductor de mensajes | 3.C | Capa de adquisición sustituible sin efecto aguas abajo |
| 9 | Secuencia de mensajes | 3.C | Número de secuencia que hace observable la pérdida |
| 10 | Jerarquía ISA-95 | 3.D | Espacio de nombres semántico con categorías funcionales |
| 11 | Planos del espacio de nombres | 3.D | Categoría `def` retenida: el namespace declara qué es cada activo y qué significan sus variables |
| 12 | Representación del activo (AAS) | 3.D | El envelope como representación autodescriptiva parcial del activo |
| 13 | Desacoplamiento en espacio, tiempo y sincronización | 3.E | Publicación-suscripción como paradigma de interacción |
| 14 | Mensajes retenidos y testamento | 3.E | Estado consultable sin sondeo por consumidores nuevos |
| 15 | Almacenamiento y reenvío | 3.E | Cola persistente dimensionada como capacidad de retención entre tasa de adquisición |
| 16 | Modelo medallón | 3.F | Capas bronce, plata y oro, todas derivadas |
| 17 | Zonas y conductos | 3.G | Tres zonas con conductos explícitos como restricción previa |
| 18 | Segundo canal de diagnóstico | 3.G | Categoría de diagnóstico diferenciada del dato de proceso |
| 19 | Cómputo en el borde | 3.H | Capacidades constitutivas y condicionales en el borde, con exclusión razonada del control cerrado |

### 3.10.1 Conclusión del capítulo

Dos ideas centrales se concluyen de este marco teórico:

1. El artefacto que produce el desacoplamiento es el modelo canónico y no la infraestructura de mensajería. Esta conclusión, derivada en el capítulo 3.4.1, es la que justifica que el contrato UNS y no la elección de bróker constituya la aportación principal de este trabajo.
2. La distinción entre sistema de registro y datos derivados es lo que convierte una colección de componentes en una arquitectura. Sin esa distinción, cada base de datos termina comportándose como fuente paralela de verdad y la divergencia entre sistemas se queda sin un criterio de resolución.

El siguiente capítulo traduce el marco teórico en una arquitectura de referencia concreta: las decisiones justificadas mediante Registro de Decisiones de Arquitectura (ADR: *Architectural Decision Record*), diagramas de estructura, y la especificación del contrato UNS y la segmentación de red.

---

## Correcciones pendientes de trasladar al documento Word

### A. Citaciones rotas o duplicadas (crítico)

| Dónde | Problema | Corrección |
|---|---|---|
| §3.3.1 | «formulado por Young ()» — cita vacía | `[36]` |
| §3.3.2 | «la consistencia eventual ()» — cita vacía; la referencia no existe en la bibliografía | Añadir Vogels como **[42]** y citar `[42]` |
| §3.3.2 | «el teorema CAP ()» — cita vacía; la referencia no existe | Añadir Gilbert y Lynch como **[46]** y citar `[46]` |
| Bibliografía | **[35] y [42] son el mismo Kreps** | Dejar `[35]`; liberar el hueco [42] para Vogels. En §3.2.2 cambiar `[42]` → `[35]` |
| Bibliografía | **[40] y [47] son el mismo Shi** | Dejar `[40]`; eliminar [47]. En §3.9.1 cambiar `[47]` → `[40]` |
| Bibliografía | **[41] y [46] son el mismo Bonomi** | Dejar `[41]`; liberar [46] para Gilbert y Lynch. En §3.9.1 cambiar `[46]` → `[41]` |
| §2.4.4 (Cap. 2) | «proceso PAS del comité ISO/IEC JTC 1 ()» — cita vacía | `[25]` |
| §2.5.6 (Cap. 2) | «material divulgativo sustancial sobre UNS [7], [7]» | `[6], [7]` |
| §2.6.2 (Cap. 2) | «(Redpanda()» — cita ausente y paréntesis mal cerrado | Añadir referencia de Redpanda |
| §2.6.2 (Cap. 2) | «IEC 611331-3» | **IEC 61131-3** |

### B. Numeración de tablas

En el Word solo están rotuladas dos tablas del capítulo (planos como «Tabla 2» y medallón como «Tabla 3»), pero el texto remite a «Tabla 4» (patrones) y «Tabla 8» (síntesis). Rotulando **todas** las tablas por orden de aparición, las referencias existentes quedan correctas sin tocar el texto:

| Tabla | Contenido | Apartado |
|---|---|---|
| 2 | Estructura del marco teórico | 3.1 |
| 3 | Asimetría mando/consulta | 3.3.1 |
| **4** | Catálogo de patrones | 3.4.2 ← ya citada así |
| 5 | Los dos ejes: plano y categoría | 3.5.3 ← estaba como «Tabla 2» |
| 6 | Capas del modelo medallón | 3.7.2 ← estaba como «Tabla 3» |
| 7 | Capacidades del borde | 3.9.2 |
| **8** | Trazabilidad teoría → diseño | 3.10 ← ya citada así |

### C. Erratas de redacción

| Dónde | Dice | Debe decir |
|---|---|---|
| §3.1, tabla, fila 4 | «Publicación semántica» | «Jerarquía semántica» |
| §3.1 | «decisión de arquitectua» | «arquitectura» |
| §3.2.1 (título) | «La distinción fundamenta sobre los datos» | «fundamental» |
| §3.1 | «esa base de daos se materializa» | «base de datos» |
| §3.2.2 | «ordenada totalmente y composiciones direccionables» | «y con posiciones direccionables» |
| §3.2.2 | «y todos los eventos, y todos los consumidores observan» | sobra «y todos los eventos,» |
| §3.2.2 | «sea descartable y reconstruirle» | «reconstruible» |
| §3.2.2, §2.3.2 y otros | «aceptación» (del término UNS) | **«acepción»** — aparece varias veces |
| §3.2.3 | «orden causal por producto» | «por productor» |
| §3.2.4 | «coordinación transaccional costosa entre producto, transporte y consumidor» | «entre productor,» |
| §3.2.4 | «resulte funcionamiento equivalente» | «funcionalmente equivalente» |
| §3.3.2 | «nunca escriben directamente en una lista» | «en una vista» |
| §3.3.2 | «hasta poder confiar la escritura en el centro» | «confirmar la escritura» |
| §3.3.3 | «situaría ahí un base de datos local» | «una base de datos» |
| §3.5.1 | «anclado en la topología de la redo en el fabricante» | «de la red o en el fabricante» |
| §3.5.2 | «un estad consultable» | «estado» |
| §3.5.2 | «el patrón de segundo canal NOA que se desribió» | «describió» |
| §3.5.2 | «Esa regla, expresa como lista de control de acceso» | «expresada» |
| §3.6.1 (título) | «Las tres dimensiones de desacoplamiento» | «del desacoplamiento» |
| §3.7.3 | «respuesta dominante en el ámbito de la analítica transaccional» | «de la analítica» — un lago de datos no es analítica transaccional |
| §3.10.1 | «Tres dos centrales se concluyen» | «Dos ideas centrales se concluyen» |
| §3.10.1 | «la aporación principal» | «aportación» |
| §3.10.1 | «derivada en el capítulo 3.4.2» | «3.4.1» — el núcleo canónico quedó en 3.4.1 |
| Tabla 8, fila 1 | «Registro de eventos inmutbale» | «inmutable» |
| Tabla 8, fila 11 | «el namespace delcara» | «declara» |

### D. Coherencia de contenido

1. **§3.9.2 anuncia «siete niveles» pero la tabla ya no los tiene.** El cambio de la tabla a Capacidad / Criterio / Decisión es una mejora, porque elimina una numeración L1–L7 que era propia y no normalizada. Solo hay que quitar «de siete niveles» del texto introductorio (ya corregido en este fichero).
2. **Se eliminó el apartado sobre el alcance de la validación.** La versión anterior cerraba declarando que la validación es funcional y demostrativa, no un estudio experimental comparativo. Al no estar, el marco teórico ya no dice con qué alcance se contrastarán H1–H3. Conviene reponerlo, aquí o al inicio del Capítulo 7, porque el Capítulo 1 fija umbrales cuantitativos (p99 < 5 s, 0 % de pérdida) y sin esa acotación el tribunal esperará un diseño experimental formal.
3. **Se eliminó el apartado «Los límites del argumento» de §3.4.** Contenía las dos objeciones al recuento N×M → N+M (no compensa en instalaciones pequeñas; cada traducción canónica es más cara por unidad). Es opcional, pero anticipa una pregunta previsible de tribunal.
