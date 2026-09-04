"""Alarmas y eventos por periodo (contrato API §3.4).

Familia 1 sirve `evt` direccionado POR TÓPICO. Esto es lo complementario: "todas
las alarmas del periodo", sin importar qué dispositivo las emitió — que es como
las mira un humano (tabla de reporte, panel de supervisión), no por tópico.
Lee de v_alerts_recent (silver).
"""
from fastapi import APIRouter, Query

from ..common import envelope, resolve_range
from ..db import fetch_all

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])


@router.get("")
def list_alerts(
    desde: str | None = Query(None, alias="from"),
    hasta: str | None = Query(None, alias="to"),
    rango: str | None = Query(None, alias="range"),
    severity: str | None = Query(None, description="info | warn | alarm | critical"),
    limit: int = Query(200, le=1000),
) -> dict:
    """Alarmas del periodo, de la más reciente a la más antigua."""
    d, h = resolve_range(desde, hasta, rango)

    sql = """
        SELECT ts, src, evt_type, severity, value, threshold, unit, msg
        FROM v_alerts_recent
        WHERE ts >= %(desde)s AND ts <= %(hasta)s
    """
    params: dict = {"desde": d, "hasta": h, "limit": limit}
    if severity:
        sql += " AND severity = %(severity)s"
        params["severity"] = severity
    sql += " ORDER BY ts DESC LIMIT %(limit)s"

    rows = fetch_all(sql, params)
    return envelope(rows, severity=severity, **{"from": d.isoformat(), "to": h.isoformat()})
