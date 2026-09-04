"""Configuración del servicio — leída desde variables de entorno.

pydantic-settings mapea cada campo a una variable de entorno con el MISMO nombre
en mayúsculas: el campo `pg_dsn` se llena con la variable de entorno `PG_DSN`.
Si una variable obligatoria falta, la app NO arranca y dice cuál falta — mejor
fallar en el arranque que a mitad de una petición.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Cadena de conexión a TimescaleDB. La inyecta docker-compose (ver PG_DSN del servicio).
    pg_dsn: str

    # ─── MQTT — solo lo usa el write-back; el contenedor de la API los ignora ────
    # Llevan default para que la API arranque sin necesidad de credenciales MQTT.
    mqtt_host: str = "emqx"
    mqtt_port: int = 1883
    mqtt_user: str = ""
    mqtt_password: str = ""

    # ─── Write-back (contrato UNS §7.6) ─────────────────────────────────────────
    writeback_tick_s: int = 30       # cada cuánto recalcula los KPIs
    writeback_heartbeat_s: int = 60  # republica aunque no haya cambiado (§3.5)

    # Orígenes autorizados a llamar la API desde un NAVEGADOR (contrato API §2.6).
    # Separados por coma. Solo afecta a navegadores: curl, PowerBI y el motor de PDF
    # ignoran CORS. Sin esto, la web app recibe la respuesta bloqueada por el navegador.
    cors_origins: str = "*"


    # ─── Config de arranque de la web app (GET /api/v1/config) ──────────────────
    # No los usa la API para nada propio: los SIRVE para que la SPA no tenga que
    # llevarlos escritos y así una misma compilación valga para todos los clientes.
    grafana_url: str = "http://localhost:3000"
    site_label: str = "Celda de llenado · Greytec Demo"
    # Huso de la PLANTA (el mismo SITE_TZ que usa el motor de reportes). La SPA lo
    # necesita para que el selector de fechas de un reporte signifique hora de
    # pared de la planta, esté el navegador donde esté — sin él, "el turno de las
    # 14:00" pedido desde otro huso saldría desplazado.
    site_tz: str = "America/Guayaquil"

    # Metadatos que FastAPI usa para la documentación automática en /docs.
    api_title: str = "Greytec IDP API"
    api_version: str = "0.1.0"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


# Instancia única importada por el resto de la app (from .config import settings).
settings = Settings()
