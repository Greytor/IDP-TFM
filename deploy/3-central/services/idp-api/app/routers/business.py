"""Parámetros de negocio — lectura de los SUPUESTOS detrás del dinero.

Los valores CALCULADOS (margen, costos) viajan por /api/v1/kpi/business como
cualquier KPI (Familia 2, dirigida por catálogo). Este endpoint expone los
parámetros con los que se calcularon y su `updated_at`, para que la web y el
PDF impriman los supuestos al pie: un número de dinero sin sus supuestos es un
número que nadie puede defender en una reunión.

Solo LECTURA, y abierta como las Familias 1-3 (se cierra con ellas en 2.2-D):
el usuario demo ve los resultados y los supuestos. ESCRIBIRLOS es otra cosa —
eso vive en la Familia 4 y exige rol admin.
"""
from fastapi import APIRouter

from ..common import envelope
from ..db import fetch_all

router = APIRouter(prefix="/api/v1/business-params", tags=["business"])


@router.get("")
def list_business_params() -> dict:
    """Los parámetros vigentes, con su fecha de última edición."""
    return envelope(fetch_all(
        "SELECT param, value, unit, description, updated_at "
        "FROM business_params ORDER BY param"
    ))
