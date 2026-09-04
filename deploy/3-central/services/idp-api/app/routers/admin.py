"""Administración — lo que consume la consola del IDP.

Diferencia con el resto de la API: estos endpoints ESCRIBEN. Y no escriben datos,
escriben CATÁLOGOS — las tablas que dicen cómo se interpreta y se publica el dato:

    kpi_catalog  → qué KPIs existen, de qué vista salen y cuáles se republican al UNS
    asset_tags   → cómo se llama y en qué unidad va cada (src, field) del dato crudo

Por qué eso importa: el catálogo NO es decoración. `kpi_catalog.publish` decide qué
se publica en el UNS, y `units` decide qué campos salen. Una fila mal puesta aquí no
da un error bonito — rompe el write-back o deja un endpoint devolviendo 500. De ahí
que casi todo este archivo sea VALIDACIÓN: se comprueba contra la base ANTES de
aceptar, para convertir un fallo silencioso en tiempo de lectura en un 422 claro en
tiempo de escritura.

AUTENTICACIÓN: todavía no hay (decisión consciente, se hará cuando el pipeline y la
consola estén montados). Mientras tanto estos endpoints NO deben exponerse por el
túnel público — solo por la LAN. Ver la nota en el contrato API.
"""
import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..common import envelope
from ..config import settings
from ..db import execute, fetch_all, fetch_one

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ─── Modelos ────────────────────────────────────────────────────────────────
# Pydantic valida la FORMA (tipos, campos que faltan) y devuelve un 422 con el
# detalle. Lo que Pydantic no puede saber es si la vista existe en la base: eso
# son las comprobaciones de más abajo.

class KpiIn(BaseModel):
    view_name: str = Field(..., description="Vista gold donde vive la lógica del KPI")
    topic: str = Field(..., description="Destino del write-back en el UNS")
    derived_from: str = Field("", description="src origen; varios separados por coma")
    time_column: str = Field("hour", description="Columna temporal de la vista")
    unit: str = Field("", description="Unidad titular del KPI")
    units: dict[str, str] = Field(
        default_factory=dict,
        description="campo → unidad. SUS CLAVES DEFINEN QUÉ SE PUBLICA al UNS.",
    )
    description: str = ""
    publish: bool = True
    enabled: bool = True


class TagIn(BaseModel):
    display_name: str
    unit: str = ""
    area: str = ""
    min_limit: float | None = None
    max_limit: float | None = None
    is_numeric: bool = True


class BizParamIn(BaseModel):
    value: float
    unit: str = ""
    description: str = ""


# ─── Validación contra la base ──────────────────────────────────────────────

def _columnas(vista: str) -> set[str]:
    """Columnas reales de una vista o tabla. Vacío si no existe.

    information_schema es el catálogo estándar de Postgres: aquí se le pregunta a la
    propia base qué existe, en vez de fiarnos de lo que nos manden.
    """
    filas = fetch_all(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s",
        (vista,),
    )
    return {f["column_name"] for f in filas}


def _validar_kpi(name: str, k: KpiIn) -> None:
    """Todo lo que tiene que ser cierto para que este KPI funcione de verdad.

    Sin esto, el catálogo acepta cualquier cosa y el error aparece LEJOS: un 500 en
    /api/v1/kpi/{name}, o un write-back publicando campos que no existen. Cada
    comprobación de aquí es un fallo que se descubre al guardar, no en producción.

    Orden deliberado: primero lo que se decide con puro Python, después lo que exige
    consultar la base. Es lo barato antes que lo caro, pero sobre todo evita que un
    error de bulto dependa de que la base conteste — con las comprobaciones al revés,
    un tópico con comodín daba 500 en vez de 422 cuando la base no estaba.
    """
    # Un tópico de PUBLICACIÓN no admite comodines ni barras sueltas (MQTT lo prohíbe:
    # los comodines son solo para suscribirse).
    if any(c in k.topic for c in "+#") or k.topic.startswith("/") or k.topic.endswith("/"):
        raise HTTPException(422, f"Tópico inválido para publicar: {k.topic!r}")

    if k.publish and not k.units:
        raise HTTPException(
            422,
            "publish=true pero units está vacío: no habría ningún campo que publicar. "
            "Declara los campos o pon publish=false.",
        )

    cols = _columnas(k.view_name)
    if not cols:
        raise HTTPException(422, f"La vista {k.view_name!r} no existe en la base")

    if k.time_column not in cols:
        raise HTTPException(
            422,
            f"{k.view_name!r} no tiene la columna temporal {k.time_column!r}. "
            f"Columnas disponibles: {', '.join(sorted(cols))}",
        )

    # Las claves de `units` son los campos que el write-back publicará al UNS: si una
    # no existe en la vista, la publicación fallaría al leerla.
    fantasma = sorted(set(k.units) - cols)
    if fantasma:
        raise HTTPException(
            422,
            f"units apunta a campos que {k.view_name!r} no tiene: {', '.join(fantasma)}. "
            f"Columnas disponibles: {', '.join(sorted(cols))}",
        )


# ─── kpi_catalog ────────────────────────────────────────────────────────────

_KPI_COLS = ("name, view_name, topic, derived_from, time_column, unit, units, "
             "description, publish, enabled")


@router.get("/kpis")
def list_kpis() -> dict:
    """Catálogo COMPLETO, incluidos los deshabilitados.

    Esto lo distingue de /api/v1/kpi, que solo muestra `enabled` porque sirve a
    consumidores. La consola necesita ver también lo apagado — si no, no habría
    forma de volver a encenderlo.
    """
    return envelope(fetch_all(f"SELECT {_KPI_COLS} FROM kpi_catalog ORDER BY name"))


@router.get("/kpis/{name}")
def get_kpi(name: str) -> dict:
    fila = fetch_one(f"SELECT {_KPI_COLS} FROM kpi_catalog WHERE name = %s", (name,))
    if not fila:
        raise HTTPException(404, f"KPI no registrado: {name!r}")
    return envelope(fila)


@router.put("/kpis/{name}")
def upsert_kpi(name: str, k: KpiIn) -> dict:
    """Crea o reemplaza un KPI del catálogo.

    Es PUT y no POST a propósito: PUT es idempotente — mandarlo dos veces deja el
    mismo estado. Eso encaja con una consola declarativa ("que este KPI quede así")
    y evita el baile de "¿existe ya? ¿entonces POST o PATCH?".

    Lo que este endpoint NO hace: crear la vista. La lógica del KPI vive en gold.sql
    (regla anti-dilución del contrato UNS: ningún consumidor calcula KPIs). Aquí solo
    se REGISTRA una vista que ya existe — y por eso se valida que exista.
    """
    _validar_kpi(name, k)
    fila = execute(
        f"""
        INSERT INTO kpi_catalog ({_KPI_COLS})
        VALUES (%(name)s, %(view_name)s, %(topic)s, %(derived_from)s, %(time_column)s,
                %(unit)s, %(units)s, %(description)s, %(publish)s, %(enabled)s)
        ON CONFLICT (name) DO UPDATE SET
            view_name = EXCLUDED.view_name, topic = EXCLUDED.topic,
            derived_from = EXCLUDED.derived_from, time_column = EXCLUDED.time_column,
            unit = EXCLUDED.unit, units = EXCLUDED.units,
            description = EXCLUDED.description, publish = EXCLUDED.publish,
            enabled = EXCLUDED.enabled
        RETURNING {_KPI_COLS}
        """,
        {"name": name, **k.model_dump(), "units": _json(k.units)},
    )
    log.info("Catálogo: KPI %r guardado (publish=%s, enabled=%s)", name, k.publish, k.enabled)
    return envelope(fila)


@router.delete("/kpis/{name}")
def delete_kpi(name: str) -> dict:
    """Borra un KPI del catálogo.

    El retenido se limpia SOLO: el write-back relee el catálogo en cada tick (30 s) y
    su clear_removed() publica un retained vacío en los tópicos que ya no están
    (contrato UNS §7.6). No hay que hacer nada.

    Con una salvedad, y por eso se devuelve `retained_por_limpiar`: clear_removed()
    compara contra su estado EN MEMORIA, o sea contra lo que ha publicado ese
    proceso. Si el write-back está parado cuando borras (o se reinicia antes del
    siguiente tick), arranca sin memoria del tópico, nunca sabrá que existió y el
    retenido se queda huérfano en el broker para siempre. El campo avisa de ese caso.

    Si solo quieres apagarlo, es mejor un PUT con enabled=false: conserva la
    configuración, es reversible, y el write-back lo limpia igual.
    """
    fila = execute(
        "DELETE FROM kpi_catalog WHERE name = %s RETURNING name, topic, publish",
        (name,),
    )
    if not fila:
        raise HTTPException(404, f"KPI no registrado: {name!r}")
    aviso = fila["topic"] if fila["publish"] else None
    log.info("Catálogo: KPI %r borrado (retained por limpiar: %s)", name, aviso)
    return envelope({"deleted": fila["name"], "retained_por_limpiar": aviso})


# ─── asset_tags ─────────────────────────────────────────────────────────────

_TAG_COLS = "src, field, display_name, unit, area, min_limit, max_limit, is_numeric"


@router.get("/asset-tags")
def list_tags(src: str | None = Query(None, description="Filtra por dispositivo")) -> dict:
    """Cómo se nombra y se mide cada (src, field) del dato crudo."""
    if src:
        return envelope(fetch_all(
            f"SELECT {_TAG_COLS} FROM asset_tags WHERE src = %s ORDER BY field", (src,)))
    return envelope(fetch_all(f"SELECT {_TAG_COLS} FROM asset_tags ORDER BY src, field"))


@router.put("/asset-tags/{src}/{field}")
def upsert_tag(src: str, field: str, t: TagIn) -> dict:
    """Crea o reemplaza la etiqueta de un (src, field). La PK es el par, va en la ruta."""
    if t.min_limit is not None and t.max_limit is not None and t.min_limit > t.max_limit:
        raise HTTPException(422, f"min_limit ({t.min_limit}) > max_limit ({t.max_limit})")
    fila = execute(
        f"""
        INSERT INTO asset_tags ({_TAG_COLS})
        VALUES (%(src)s, %(field)s, %(display_name)s, %(unit)s, %(area)s,
                %(min_limit)s, %(max_limit)s, %(is_numeric)s)
        ON CONFLICT (src, field) DO UPDATE SET
            display_name = EXCLUDED.display_name, unit = EXCLUDED.unit,
            area = EXCLUDED.area, min_limit = EXCLUDED.min_limit,
            max_limit = EXCLUDED.max_limit, is_numeric = EXCLUDED.is_numeric
        RETURNING {_TAG_COLS}
        """,
        {"src": src, "field": field, **t.model_dump()},
    )
    return envelope(fila)


@router.delete("/asset-tags/{src}/{field}")
def delete_tag(src: str, field: str) -> dict:
    fila = execute(
        "DELETE FROM asset_tags WHERE src = %s AND field = %s RETURNING src, field",
        (src, field),
    )
    if not fila:
        raise HTTPException(404, f"Etiqueta no registrada: {src}/{field}")
    return envelope({"deleted": f"{src}/{field}"})


# ─── business_params ────────────────────────────────────────────────────────
# El tercer catálogo: qué VALE el negocio (tarifa, margen, meta…). Lo leen las
# vistas gold (v_business_hourly) — un PUT aquí recalcula el dinero en la
# siguiente consulta, sin reiniciar nada. En un cliente real estas filas las
# escribe un conector desde su ERP contra estos mismos endpoints.

_BIZ_COLS = "param, value, unit, description, updated_at"


@router.get("/business-params")
def list_business_params() -> dict:
    return envelope(fetch_all(f"SELECT {_BIZ_COLS} FROM business_params ORDER BY param"))


@router.put("/business-params/{param}")
def upsert_business_param(param: str, b: BizParamIn) -> dict:
    """Crea o actualiza un parámetro. PUT idempotente, como todo en esta familia.

    Se admite cualquier clave con forma sana: un cliente puede añadir SU
    parámetro (p. ej. 'costo_hora_operario') y usarlo en SUS vistas gold sin
    tocar código — mismo principio que añadir un KPI al catálogo.

    unit/description vacíos NO pisan lo guardado: un conector de ERP que solo
    manda el precio no debe borrar la descripción que puso un humano.
    """
    import re
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", param):
        raise HTTPException(
            422, f"Nombre de parámetro inválido: {param!r} — minúsculas, dígitos y _")
    fila = execute(
        f"""
        INSERT INTO business_params (param, value, unit, description, updated_at)
        VALUES (%(param)s, %(value)s, %(unit)s, %(description)s, now())
        ON CONFLICT (param) DO UPDATE SET
            value = EXCLUDED.value,
            unit = coalesce(nullif(EXCLUDED.unit, ''), business_params.unit),
            description = coalesce(nullif(EXCLUDED.description, ''), business_params.description),
            updated_at = now()
        RETURNING {_BIZ_COLS}
        """,
        {"param": param, **b.model_dump()},
    )
    log.info("Negocio: parámetro %r = %s", param, b.value)
    return envelope(fila)


# ─── Registro de servicios ──────────────────────────────────────────────────

@router.get("/services")
def services() -> dict:
    """Los servicios del IDP y dónde está la spec de cada uno.

    Para qué: que la consola pinte **un solo explorador con todas las APIs** —
    SwaggerUI acepta varias specs con un desplegable (opción `urls`). Resuelve la
    queja de las dos `/docs` **sin fusionar los servicios**, que era el punto de
    ADR-022: la separación es de EJECUCIÓN, la unificación va en el BORDE.

    Rutas RELATIVAS a propósito. Este endpoint no sabe —ni debe— por qué dominio
    entró el usuario: hoy `localhost`, en una instalación real será otro. Que las
    resuelva el navegador contra su propio origen es lo que permite que la misma
    imagen sirva en cualquier despliegue. Poner el dominio aquí obligaría a
    configurarlo, y ya hay bastantes sitios donde escribirlo mal.

    Lo que este endpoint NO hace, y es deliberado: **no consulta la salud de los
    demás**. Hoy la dependencia va `reports → api`; que la API llame a reports
    cerraría un ciclo. El navegador puede pedir los dos `/health` por su cuenta.
    """
    return envelope([
        {
            "name": "api",
            "title": settings.api_title,
            "version": settings.api_version,
            "base_path": "/api/v1",
            # La spec exige token válido (main.py); la consola la pide con su
            # Bearer. docs_url es None: el Swagger público se retiró — el
            # explorador ES esta consola.
            "openapi_url": "/openapi.json",
            "docs_url": None,
            "families": ["uns", "kpi", "alerts", "business", "admin"],
        },
        {
            "name": "reports",
            "title": "Greytec IDP — Reportes",
            # Su versión la sirve él mismo en su OpenAPI; aquí no se duplica para
            # no tener dos verdades sobre lo mismo.
            "version": None,
            "base_path": "/api/v1/reports",
            "openapi_url": "/api/v1/reports/openapi.json",
            "docs_url": "/api/v1/reports/docs",
            "families": ["reports"],
        },
    ])


# ─── Salud del pipeline ─────────────────────────────────────────────────────

@router.get("/health")
def admin_health(silencio_min: int = Query(10, alias="silence_min")) -> dict:
    """Salud del PIPELINE, no del proceso.

    /health (el de siempre) responde "¿estoy vivo?" — lo usa docker-compose. Este
    responde "¿está entrando dato y es coherente lo que hay?", que es lo que necesita
    la consola. Se construye solo con lo que la API alcanza a ver: la base.

    Y eso es justo su límite, que conviene tener claro: si EMQX se cae, esto lo verá
    como silencio (correcto), pero no sabe distinguir "el broker está caído" de "la
    celda está parada". Para el estado de los CONTENEDORES hace falta otra fuente
    (el dashboard de salud que quedó para esta misma fase).
    """
    try:
        fetch_one("SELECT 1")
    except Exception as e:
        # Sin base no hay nada más que mirar: se dice y se sale.
        return {"status": "down", "db": False, "error": str(e)}

    # ¿Sigue entrando dato? Se mira el reloj de la BASE (now()), no el de este
    # contenedor: comparar contra un reloj distinto del que escribió el dato daría
    # antigüedades falsas.
    ingesta = fetch_all("""
        SELECT 'sensor_readings' AS tabla, max(ts) AS ultimo,
               extract(epoch FROM (now() - max(ts)))::int AS hace_s FROM sensor_readings
        UNION ALL
        SELECT 'device_status', max(ts), extract(epoch FROM (now() - max(ts)))::int FROM device_status
        UNION ALL
        SELECT 'alerts', max(ts), extract(epoch FROM (now() - max(ts)))::int FROM alerts
    """)

    mudos = fetch_all("""
        SELECT src, max(ts) AS ultimo, extract(epoch FROM (now() - max(ts)))::int AS hace_s
        FROM sensor_readings GROUP BY src
        HAVING extract(epoch FROM (now() - max(ts))) > %s ORDER BY 3 DESC
    """, (silencio_min * 60,))

    rotos = _kpis_rotos()

    # El veredicto es explícito: 'ok' solo si entra dato Y el catálogo es coherente.
    fresco = any(i["hace_s"] is not None and i["hace_s"] < silencio_min * 60 for i in ingesta)
    estado = "ok" if fresco and not rotos and not mudos else "degraded"

    return {
        "status": estado,
        "db": True,
        "ingesta": ingesta,
        "dispositivos_mudos": mudos,   # llevan más de silence_min sin publicar
        "kpis_rotos": rotos,           # catálogo apuntando a vistas que no existen
    }


def _kpis_rotos() -> list[dict]:
    """KPIs del catálogo cuya vista ya no existe.

    Pasa de verdad: alguien renombra una vista en gold.sql y el catálogo se queda
    apuntando al nombre viejo. El síntoma sería un 500 en /api/v1/kpi/{name}; esto lo
    convierte en algo que la consola puede enseñar antes de que lo note un usuario.
    """
    return fetch_all("""
        SELECT k.name, k.view_name
        FROM kpi_catalog k
        WHERE k.enabled AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables t
            WHERE t.table_schema = 'public' AND t.table_name = k.view_name
        )
        ORDER BY k.name
    """)


def _json(d: dict) -> str:
    """psycopg no adapta un dict de Python a JSONB por su cuenta; se manda serializado."""
    import json
    return json.dumps(d)
