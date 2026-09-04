"""Endpoint de salud — ¿está viva la API y puede hablar con la base de datos?

Lo usa el healthcheck de docker-compose y cualquier consumidor que quiera
verificar el servicio antes de llamarlo. Siempre responde 200 si el PROCESO está
vivo; el campo `db` indica aparte si la conexión a TimescaleDB responde.
"""
from fastapi import APIRouter

from ..db import fetch_one

# Un APIRouter es un grupo de endpoints que main.py "monta" en la app.
router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    try:
        fetch_one("SELECT 1 AS ok")
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "db": db_ok}
