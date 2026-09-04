"""Familia 2 — KPIs (contrato API §3.2). Dirigida por el kpi_catalog.

Endpoints GENÉRICOS: no hay un endpoint por KPI. Se lee el catálogo y se sirve la
vista gold que apunta. Añadir un KPI = fila en kpi_catalog + su vista, sin tocar
este archivo (contrato API §4.3).
"""
from fastapi import APIRouter, HTTPException, Query
from psycopg import sql

from ..common import envelope, resolve_range
from ..db import fetch_all, fetch_one

router = APIRouter(prefix="/api/v1/kpi", tags=["kpi"])


@router.get("")
def list_kpis() -> dict:
    """Lista el catálogo de KPIs disponibles (autodocumentación de la Familia 2)."""
    rows = fetch_all(
        "SELECT name, view_name, topic, unit, description "
        "FROM kpi_catalog WHERE enabled ORDER BY name"
    )
    return envelope(rows)


@router.get("/{name}")
def get_kpi(
    name: str,
    desde: str | None = Query(None, alias="from"),
    hasta: str | None = Query(None, alias="to"),
    rango: str | None = Query(None, alias="range"),
) -> dict:
    """Serie temporal del KPI registrado con ese nombre, filtrada por from/to/range."""
    kpi = _lookup(name)
    d, h = resolve_range(desde, hasta, rango)

    # view_name y time_column vienen del catálogo (controlados, no del usuario), pero
    # aun así se componen con Identifier: no se pueden parametrizar identificadores y
    # esto es la forma correcta y segura en psycopg de insertarlos en el SQL.
    query = sql.SQL(
        "SELECT * FROM {view} WHERE {tcol} >= %s AND {tcol} <= %s ORDER BY {tcol}"
    ).format(view=sql.Identifier(kpi["view_name"]), tcol=sql.Identifier(kpi["time_column"]))

    rows = fetch_all(query, (d, h))
    return envelope(rows, unit=kpi["unit"], **{"from": d.isoformat(), "to": h.isoformat()})


@router.get("/{name}/live")
def get_kpi_live(name: str) -> dict:
    """Última cubeta del KPI (el valor más reciente)."""
    kpi = _lookup(name)
    query = sql.SQL("SELECT * FROM {view} ORDER BY {tcol} DESC LIMIT 1").format(
        view=sql.Identifier(kpi["view_name"]), tcol=sql.Identifier(kpi["time_column"])
    )
    return envelope(fetch_one(query), unit=kpi["unit"])


def _lookup(name: str) -> dict:
    """Busca el KPI en el catálogo o lanza 404."""
    kpi = fetch_one(
        "SELECT view_name, time_column, unit FROM kpi_catalog WHERE name = %s AND enabled",
        (name,),
    )
    if not kpi:
        raise HTTPException(404, f"KPI no registrado: {name!r}")
    return kpi
