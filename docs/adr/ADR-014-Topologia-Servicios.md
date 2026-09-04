# ADR-014: Topología de servicios — cuándo separar en otra imagen y dónde se unifica

> **Nota de alcance (repositorio del TFM):** este ADR razona el criterio de separación
> usando como ejemplos `kpi-writeback` y `reports`, que **no forman parte del despliegue
> del TFM** (ver `docs/arquitectura/alcance.md`). El criterio en sí sigue vigente y es lo
> que se defiende: se aplica a `api` frente a `redpanda-to-tsdb`, que sí están desplegados.
> Los dos ejemplos se conservan porque son los casos que originaron la decisión.


**Status:** Aceptado
**Fecha:** 2026-07-16
**Autores:** José Desiderio

---

## Contexto

El stack central pasó de 7 servicios de infraestructura (broker, log, BD, Grafana…) a incluir
**servicios propios**: API REST, write-back de KPIs, motor de reportes, y ahora una app web.
Cada uno planteó la misma pregunta —*¿imagen propia o compartida?*— y se resolvió ad-hoc.

Sin un criterio explícito pasan dos cosas malas, y las dos tienen coste real:

1. **Sobre-fusionar**: una imagen gorda donde el publicador MQTT arrastra WeasyPrint, y un
   render de PDF pesado tumba por OOM los endpoints de KPI que compartían límite de memoria.
2. **Sobre-separar**: un servicio por función, cada uno con su copia de `db.py`, y un cambio de
   esquema hay que aplicarlo en cinco sitios.

Y una queja concreta que lo destapó: *"tenemos una API con admin/uns/kpi/alerts, pero otra
separada solo para reportes. ¿No sería mejor tener ambas en una sola API para la
documentación?"* — la queja es válida y la respuesta no es fusionar.

## Decisión

### 1. El criterio: **la imagen la decide el código compartido, no la función**

> **Si dos procesos comparten código, comparten imagen. Si no comparten código, imagen aparte.**

| Servicio | Imagen | Por qué |
|---|---|---|
| `api` | `greytec-idp-api` | — |
| `kpi-writeback` | `greytec-idp-api` (**la misma**) | Comparten `db.py` y `config.py`. Son **dos entrypoints del mismo código**: `uvicorn app.main:app` y `python -m app.writeback`. Patrón Django+Celery |
| `reports` | `greytec-idp-reports` (**propia**) | **No comparte código**: no toca la BD, su único vínculo es `API_BASE_URL`. Y arrastra pango/cairo/matplotlib (**562 MB** vs 273 MB) |
| `web` | `greytec-idp-web` (**propia**) | nginx + la SPA compilada. Ver puntos 2 y 3 |

Al criterio se le suman dos refuerzos cuando apuntan en la misma dirección:
- **Perfil de recursos**: la API es frecuente-ligera-rápida; los reportes son raros-pesados-lentos
  (`deploy.limits`: 256M vs **512M**). Fusionados comparten límite, y un render de 30 días puede
  llevarse por delante la API.
- **Disciplina**: `reports` es un **consumidor puro de la API**, igual que lo será la web. Eso
  fuerza una propiedad valiosa — *si el reporte necesita un dato, ese dato TIENE que existir en
  la API*. **El motor de PDF es la prueba de que la API está completa.**

### 2. La unificación va en el **borde** (nginx), no en el runtime

La queja de las dos `/docs` es real, pero es un problema de **interfaz**, no de **ejecución**.
Los dos servicios usan ya el prefijo `/api/v1` **precisamente para esto**:

```
<host>/api/v1/reports/…  → reports:8001
<host>/api/v1/…          → api:8000
```

El consumidor ve **una sola API**. Las razones de la separación son de ejecución y no
desaparecen; el síntoma se cura en la capa que corresponde.

**Y nginx no es un servicio aparte: es el servicio `web`.** Si un solo nginx sirve los estáticos
de la SPA *y* enruta el API, entonces nginx **es** el contenedor de la app — servir archivos y
enrutar es el mismo trabajo, no dos. Por eso vive en `services/idp-web/` junto a sus hermanos
(regla de gobernanza: *el código de un servicio vive junto al compose que lo despliega*), y no en
una carpeta `nginx/` propia. Un segundo nginx solo para entregar un `.js` es un salto de red
regalado.

**El mapa de rutas va en la imagen, no montado.** Que `/api/v1/reports/` apunte a `reports:8001`
es idéntico en todos los clientes → es **producto**. Lo único per-cliente es `${SERVER_NAME}`,
que resuelve el **envsubst nativo** de la imagen de nginx (`/etc/nginx/templates/*.template`);
no hace falta el patrón `sed` + `.tpl` que usa NanoMQ. Si algún día una **ruta** tuviera que
cambiar por cliente, sería señal de que el producto dejó de estar estandarizado.

### 3. La app web **no es un servicio: es un artefacto de build**

Una SPA de React+Vite **no tiene runtime en el servidor**. El build produce HTML/CSS/JS
estáticos. **La app corre en el navegador del usuario**; lo único que pasa en el servidor es
nginx enviando archivos.

Por tanto:
- **No necesita host propio, ni VM, ni "correr en algún sitio".** La pregunta *"¿dónde corre la
  app?"* se disuelve: corre en el cliente.
- **No es un consumidor** en el sentido del UNS: no se suscribe a MQTT ni lee la BD. Es un
  consumidor de la **API**, y lo es desde el navegador.
- Vive en `services/idp-web/` porque su **código fuente** sí es un servicio propio del producto.
  Lo que corre en el servidor es el nginx de esa misma imagen (punto 2).

**Corolario de orden:** `idp-web` **nace con nginx y un `index.html` de relleno** (issue 2.1-A),
antes de que exista una línea de React. El borde queda resuelto —API, reportes y Grafana
enrutados, puertos cerrados— sin esperar al frontend. En 2.2-A se rellena el `src/`. Mismo
servicio, mismo contenedor: crece, no se sustituye.

### 4. Todo corre en **un solo host** (`greytec-core`, 10.10.20.130)

No se reparte el stack entre máquinas. A esta escala, separar hosts añade operación y red sin
comprar nada: el cliente recibe **una caja con el stack**, que es justo lo que hace desplegable
el producto (ver `golden-stack.md`).

## Alternativas consideradas

| Opción | Pro | Contra | Descartada porque |
|--------|-----|--------|-------------------|
| Una sola imagen para todo | Una `/docs`, un contenedor, simple | El write-back cargaría WeasyPrint; matplotlib se importaría en todos los procesos (RAM real); un render puede OOM-ear la API | Fusiona por función y no por código compartido, que es justo el criterio equivocado. |
| Un servicio por función, imagen por servicio | Máxima independencia | Tres copias de `db.py`; un cambio de esquema en tres sitios | Separa lo que comparte código. |
| App en su propio contenedor nginx, proxiado por el nginx del borde | Versionable aparte del proxy | **Dos nginx** para servir archivos estáticos | Un salto de red para entregar un `.js`. |
| Host/VM aparte para la app pública | Aísla lo público del plano de datos | Otra máquina que operar y actualizar; el túnel Cloudflare ya es la frontera | El túnel hace conexiones **salientes**: no hay puerto de entrada que aislar. Reconsiderar si algún día hay tráfico de internet real. |
| Fusionar `reports` en `api` por la queja de las dos `/docs` | Una sola `/docs` | Reintroduce todos los contras de la fila 1 | El problema era de interfaz; se resuelve con nginx (punto 2). |

## Consecuencias

**Positivas:**
- Criterio **repetible**: ante un servicio nuevo, la pregunta es *"¿comparte código?"*, no una
  discusión.
- La API se mantiene fina; el motor de PDF no puede tumbarla.
- El consumidor ve un dominio y un `/api/v1`.
- Añadir la web **no añade carga al servidor**: son archivos estáticos.
- `golden-stack.md` sigue cumpliéndose: imágenes idénticas por cliente, config por cliente.

**Negativas / Trade-offs aceptados:**
- **Duplicación real y consciente**: `idp-reports/app/timeutil.py` duplica `resolve_range` de
  `idp-api/app/common.py`. **15 líneas de convención, no de negocio.** Compartirlas obligaría a
  una librería común entre dos imágenes que no comparten nada más — más acoplamiento del que
  ahorra. Si la convención cambia, cambia en el contrato y se refleja en los dos sitios.
- **Un salto HTTP**: el reporte pide a la API datos que podría sacar de la BD. Se paga a
  propósito, por la disciplina del punto 1. Si la API cae, el reporte da **503**, que es
  degradación honesta.
- **Dos OpenAPI**. Se mitiga con `/api/v1/admin/services` (issue 2.1-D): SwaggerUI soporta
  varias specs con un desplegable. El contrato de verdad es `API.md`, no Swagger.
- **Un solo host = un solo punto de fallo.** Aceptado para el demo. HA es Fase 5.
- `api` y `kpi-writeback` comparten imagen: un rebuild por un cambio de la API también
  reconstruye la del write-back. Barato.

**Deuda técnica generada:**
- `/api/v1/admin/services` no existe todavía (va con nginx: sus URLs dependen del proxy).

## Implicaciones de seguridad

- **Solo nginx publica puertos al host.** Hoy `8000`, `8001` y `3000` están expuestos en la VM;
  tras el issue 2.1-A dejan de estarlo y la única superficie es el proxy. Un punto de entrada
  es un punto que auditar.
- **La app es estática y pública**: no debe contener secretos. Todo lo sensible se resuelve
  contra la API con el token del usuario. Un `.env` de Vite acaba **dentro del bundle** — no es
  un lugar para credenciales.
- **`reports` no tiene credenciales de base de datos.** Su compromiso no da acceso al
  historiador; solo puede pedir a la API lo que la API ya expone. Esa es una consecuencia de
  seguridad directa del criterio del punto 1, y es un argumento contra fusionarlo.
- Co-locar la web pública con el plano de datos es aceptable **porque el túnel Cloudflare hace
  conexiones salientes**: no hay puerto de entrada abierto en la DMZ. Si algún día se publica
  por IP con puertos abiertos, este ADR debe revisarse.

## Referencias

- [ADR-013](./ADR-013-Medallon.md), el write-back de KPIs]-Write-back.md)
- `docs/architecture/golden-stack.md` — frontera producto/laboratorio
- `docs/contracts/API.md` §3.4 — las cuatro familias
- `docs/pm/sprint-2.md` — issues 2.1-A (nginx), 2.1-D (`/admin/services`), 2.2-A (andamiaje)
