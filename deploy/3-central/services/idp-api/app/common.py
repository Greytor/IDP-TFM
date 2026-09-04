"""Utilidades compartidas por todos los routers — convenciones del contrato API §2.

Aquí viven dos cosas que TODO endpoint usa, para no repetirlas:
  · resolve_range() — traduce from/to/range en dos fechas (convención §2.2)
  · envelope()      — arma el sobre {meta, data} de toda respuesta (§2.4)
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

# Sufijos de 'range' → argumento de timedelta. Ej: '24h' → hours=24, '7d' → days=7.
_UNITS = {"h": "hours", "d": "days", "w": "weeks", "m": "minutes"}


def resolve_range(desde: str | None, hasta: str | None, rango: str | None) -> tuple[datetime, datetime]:
    """from/to/range → (desde, hasta) en UTC. from/to ganan sobre range; default 24h."""
    ahora = datetime.now(timezone.utc)
    if desde or hasta:
        return (
            _parse_iso(desde) if desde else ahora - timedelta(days=1),
            _parse_iso(hasta) if hasta else ahora,
        )
    return ahora - _parse_range(rango or "24h"), ahora


def _parse_iso(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"Fecha inválida: {s!r} — usa ISO 8601 (2026-07-01T00:00:00Z)")


def _parse_range(r: str) -> timedelta:
    try:
        return timedelta(**{_UNITS[r[-1]]: int(r[:-1])})
    except (ValueError, KeyError, IndexError):
        raise HTTPException(422, f"range inválido: {r!r} — usa formato como 24h, 7d, 30d")


def envelope(data, **meta) -> dict:
    """Envuelve la respuesta en {meta, data} (§2.4). Añade count y generated_at solos."""
    meta.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
    if isinstance(data, list):
        meta.setdefault("count", len(data))
    return {"meta": meta, "data": data}
