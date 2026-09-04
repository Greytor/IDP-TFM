# idp-api — API de consumo del UNS

Expone por HTTP el dato ya contextualizado que vive en las capas plata y oro de
TimescaleDB. Es uno de los dos consumidores del sistema: el otro es Grafana, que
lee las mismas vistas por SQL.

> **Sin autenticación en esta edición.** El repositorio académico se despliega sin
> proveedor de identidad y sin dominio: `docker compose up` y la API responde. Lo
> que este trabajo demuestra es la arquitectura de datos, no el control de acceso,
> y exigir un proveedor OIDC obligaba a registrar un cliente y disponer de un
> dominio antes de poder ver un solo dato. Ver `docs/arquitectura/alcance.md`.
>
> Reponerlo es acotado y está previsto: devolver un módulo `auth.py`, añadir
> `dependencies=[Depends(...)]` a los routers que deban cerrarse y configurar el
> emisor. Ningún router necesita cambiar por dentro.

## Qué hace, y qué no

**Hace** — sirve lecturas del espacio de nombres, indicadores de negocio, alarmas
y el catálogo de activos, siempre leyendo de vistas, nunca de las tablas base.

**No hace** — no escribe en la base de datos de proceso ni habla con los
dispositivos. Es un consumidor: lee del sistema derivado y no conoce a ningún
productor. Esa ignorancia mutua es justamente lo que el trabajo demuestra.

## Familias de endpoints

| Prefijo | Qué sirve | Fuente |
|---|---|---|
| `/api/v1/config` | Configuración de arranque de la web | Variables de entorno |
| `/api/v1/uns/…` | Recorrido del espacio de nombres y últimas lecturas | Capa plata |
| `/api/v1/kpi/…` | Indicadores por catálogo | Capa oro |
| `/api/v1/alerts/…` | Eventos y alarmas | Tabla `alerts` |
| `/api/v1/business/…` | Parámetros de negocio del cálculo de indicadores | `kpi_catalog` |
| `/api/v1/admin/…` | Alta y edición del catálogo de indicadores | Escritura |
| `/health` | Sonda de vida, sin dependencias | — |

`/api/v1/admin/…` es la única familia que escribe, y lo que escribe es
configuración de cálculo, nunca dato de proceso.

## Por qué las rutas son relativas

La aplicación web llama a `/api/v1/…` sin host. En despliegue lo enruta nginx y en
desarrollo lo reenvía el proxy de Vite. El mismo código funciona en ambos sitios y
no hace falta CORS ni recompilar la web por instalación.

## Desarrollo

```bash
docker compose up -d api           # desde deploy/3-central
curl http://localhost/api/v1/config
curl http://localhost/openapi.json # esquema completo
```
