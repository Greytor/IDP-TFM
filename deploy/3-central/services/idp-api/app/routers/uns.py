"""Familia 1 — UNS (contrato API §3.1). El tópico MQTT ES la ruta.

Espejo histórico del namespace: quien conoce el árbol de suscripciones del UNS
sabe exactamente qué consultar aquí, sin aprender un esquema nuevo.

    MQTT:  suscribe a  greytec/demo/campo/brix/plc-llenado-01/dat/raw/good_count
    API:   GET /api/v1/uns/greytec/demo/campo/brix/plc-llenado-01/dat/raw/good_count

Enruta por la CATEGORÍA del tópico, igual que el consumer redpanda-to-tsdb pero
al revés (lee en lugar de escribir):
    dat/raw + diag  → v_process_readings   (mediciones desempaquetadas)
    sts             → v_device_signals     (señales de estado)
    evt + dat/der   → alerts               (eventos y alarmas)
"""
from fastapi import APIRouter, HTTPException, Query

from ..common import envelope, resolve_range
from ..db import fetch_all

router = APIRouter(prefix="/api/v1/uns", tags=["uns"])

# agg → intervalo de time_bucket. Lista blanca: el valor viaja como PARÁMETRO
# de la consulta, nunca interpolado en el SQL.
_AGG = {"minute": "1 minute", "hour": "1 hour", "day": "1 day"}


# OJO al orden: /topics se declara ANTES que /{topic:path}. El catch-all :path
# es voraz y se tragaría la palabra "topics" — FastAPI resuelve por orden de
# declaración, así que la ruta concreta debe ir primero.
@router.get("/topics")
def list_topics(prefix: str | None = None) -> dict:
    """Descubre qué tópicos existen en el historiador (las 3 tablas bronze).

    Es el índice del espejo: sin esto, un consumidor no sabría qué direcciones
    tienen datos. Filtra por prefijo igual que un wildcard de MQTT.
    """
    rows = fetch_all(
        """
        SELECT mqtt_topic AS topic, 'dat' AS categoria,
               count(*) AS mensajes, max(ts) AS ultimo
        FROM sensor_readings WHERE mqtt_topic LIKE %(like)s GROUP BY 1
        UNION ALL
        SELECT mqtt_topic, 'sts', count(*), max(ts)
        FROM device_status WHERE mqtt_topic LIKE %(like)s GROUP BY 1
        UNION ALL
        SELECT mqtt_topic, 'evt', count(*), max(ts)
        FROM alerts WHERE mqtt_topic LIKE %(like)s GROUP BY 1
        ORDER BY 1
        """,
        {"like": f"{prefix}%" if prefix else "%"},
    )
    return envelope(rows, prefix=prefix)


@router.get("/{topic:path}")
def get_topic(
    topic: str,
    desde: str | None = Query(None, alias="from"),
    hasta: str | None = Query(None, alias="to"),
    rango: str | None = Query(None, alias="range"),
    agg: str | None = None,
) -> dict:
    """Datos de un tópico. Sin parámetros de tiempo → último valor; con ellos → serie."""
    categoria = _categoria(topic)

    if agg and agg not in _AGG:
        raise HTTPException(422, f"agg inválido: {agg!r} — usa {'/'.join(_AGG)}")
    if agg and categoria != "dat":
        raise HTTPException(422, f"agg solo aplica a datos de proceso, no a '{categoria}'")

    # §3.1: sin ningún parámetro de tiempo, se devuelve el último valor conocido
    # (el equivalente histórico del mensaje retained del broker).
    if not (desde or hasta or rango):
        rows = _latest(topic, categoria)
        return envelope(rows, topic=topic, categoria=categoria)

    d, h = resolve_range(desde, hasta, rango)
    rows = _history(topic, categoria, d, h, agg)
    return envelope(
        rows, topic=topic, categoria=categoria, agg=agg or "raw",
        **{"from": d.isoformat(), "to": h.isoformat()},
    )


def _categoria(topic: str) -> str:
    """Deduce la categoría UNS del tópico (misma lógica que el consumer, en espejo)."""
    seg = topic.strip("/").split("/")
    if "sts" in seg:
        return "sts"
    if "evt" in seg or "der" in seg:
        return "evt"
    return "dat"  # dat/raw y diag


def _latest(topic: str, categoria: str) -> list[dict]:
    """Último valor por campo/señal de ese tópico."""
    if categoria == "dat":
        return fetch_all(
            """
            SELECT DISTINCT ON (field) ts, src, field, display_name,
                   value, value_text, unit, quality
            FROM v_process_readings WHERE mqtt_topic = %s
            ORDER BY field, ts DESC
            """,
            (topic,),
        )
    if categoria == "sts":
        return fetch_all(
            """
            SELECT DISTINCT ON (signal) ts, src, signal, value
            FROM v_device_signals WHERE mqtt_topic = %s
            ORDER BY signal, ts DESC
            """,
            (topic,),
        )
    return fetch_all(
        """
        SELECT ts, src, evt_type, severity, value, threshold, unit, msg
        FROM alerts WHERE mqtt_topic = %s ORDER BY ts DESC LIMIT 1
        """,
        (topic,),
    )


def _history(topic: str, categoria: str, desde, hasta, agg: str | None) -> list[dict]:
    """Serie temporal del tópico en la ventana pedida."""
    if categoria == "dat":
        if agg:
            return fetch_all(
                """
                SELECT time_bucket(%(bucket)s::interval, ts) AS ts, field,
                       avg(value) AS avg, min(value) AS min, max(value) AS max,
                       count(*) AS n_samples
                FROM v_process_readings
                WHERE mqtt_topic = %(topic)s AND ts >= %(desde)s AND ts <= %(hasta)s
                GROUP BY 1, 2 ORDER BY 1
                """,
                {"bucket": _AGG[agg], "topic": topic, "desde": desde, "hasta": hasta},
            )
        return fetch_all(
            """
            SELECT ts, src, field, display_name, value, value_text, unit, quality
            FROM v_process_readings
            WHERE mqtt_topic = %s AND ts >= %s AND ts <= %s
            ORDER BY ts
            """,
            (topic, desde, hasta),
        )
    if categoria == "sts":
        return fetch_all(
            """
            SELECT ts, src, signal, value FROM v_device_signals
            WHERE mqtt_topic = %s AND ts >= %s AND ts <= %s ORDER BY ts
            """,
            (topic, desde, hasta),
        )
    return fetch_all(
        """
        SELECT ts, src, evt_type, severity, value, threshold, unit, msg
        FROM alerts WHERE mqtt_topic = %s AND ts >= %s AND ts <= %s ORDER BY ts DESC
        """,
        (topic, desde, hasta),
    )
