"""Punto de entrada de la API — arma la app FastAPI y monta los routers.

uvicorn importa la variable `app` de este módulo y la mantiene escuchando.
El `lifespan` gestiona el ciclo de vida: abre el pool de conexiones al arrancar
y lo cierra al apagar — así no se abren conexiones a mitad de servicio ni quedan
colgadas al reiniciar.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from fastapi import Depends

from .config import settings
from .db import pool
from .routers import admin, alerts, business, config as config_router, health, kpi, uns

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Arranque: abrir el pool y esperar a que haya al menos una conexión lista.
    pool.open()
    try:
        pool.wait(timeout=10.0)
        log.info("Pool de conexiones a TimescaleDB listo")
    except Exception as e:  # DB aún no disponible: la app arranca igual y /health dirá degraded
        log.warning("DB no lista al arrancar (%s); se reintenta en cada request", e)
    yield
    # --- Apagado: devolver las conexiones limpiamente.
    pool.close()
    log.info("Pool cerrado")


# Sin /docs ni /redoc (2026-07-17): el Swagger público era "conveniencia
# mientras no exista el explorador de la consola" (nginx 2.1-A) — y el
# explorador ya existe, tras login y rol. Un Swagger anónimo en internet
# regalaba el mapa completo de la API a cualquiera que pasara.
# openapi_url=None quita la ruta AUTOMÁTICA; la spec se sirve abajo, gateada.
app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# La spec OpenAPI exige token VÁLIDO (cualquier rol): la consume el explorador
# de la consola, que la pide con su Bearer. El mapa de endpoints no es dato de
# planta, pero tampoco es un folleto para internet.
@app.get("/openapi.json", include_in_schema=False)
def openapi_spec() -> dict:
    return app.openapi()

# CORS (contrato API §2.6): autoriza a la web app a llamarnos desde el navegador.
# PUT y DELETE se añaden por la consola de administración: sin ellos el navegador
# bloquea la escritura en el preflight, aunque el endpoint exista y funcione con curl.
# Sin credenciales todavía: la API sigue abierta (la autenticación es la tarea que
# viene después de montar la consola).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Montar routers. Cada uno añade sus endpoints a la app.
#
# /health queda ABIERTO a propósito: lo usa el healthcheck de docker-compose, que
# no tiene token ni debe tenerlo. No expone datos, solo "vivo/degradado".
app.include_router(health.router)

# /api/v1/config — ABIERTO, y tiene que serlo: el navegador lo pide ANTES de tener
# sesión, porque es lo que le dice a dónde ir a crearla. Exigir token aquí sería
# pedir la llave para entrar a recoger la llave. No expone nada secreto.
app.include_router(config_router.router)

# Familias 1-3 — de solo LECTURA sobre datos de demo. Siguen abiertas por ahora.
# Se cierran cuando la app de React sepa mandar el token (issue 2.2-D): entonces
# es añadirles una dependencia de autenticación.
# NO se hace ya porque hoy las llama el motor de reportes, que aún no manda token
# — cerrarlas ahora rompería los PDF sin cerrar ningún agujero real.
app.include_router(kpi.router)
app.include_router(uns.router)
app.include_router(alerts.router)
# Lectura de business_params (los SUPUESTOS del dinero) — abierta como las 1-3
# y se cierra con ellas. La ESCRITURA vive en admin (Familia 4), gateada abajo.
app.include_router(business.router)

# Familia 4 — ADMINISTRACIÓN. Esta sí, ahora.
#
# Es la única familia que ESCRIBE, y lo que escribe es kpi_catalog: o sea, qué se
# publica en el UNS y en qué tópico (ADR-021). Un retained mal puesto no caduca.
#
# Esta línea es todo el gateo, y por esto se hizo `admin` un router aparte desde
# el principio: ninguno de sus 8 endpoints responde sin un token con el grupo
# `admin`, y el noveno que se añada nacerá protegido sin que nadie se acuerde.
app.include_router(admin.router)
