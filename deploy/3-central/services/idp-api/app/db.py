"""Acceso a TimescaleDB — la ÚNICA capa que habla con Postgres.

Usa un POOL de conexiones: en vez de abrir y cerrar una conexión por petición
(lento), mantiene un puñado de conexiones vivas y las presta. Cada request toma
una del pool, la usa y la devuelve.

row_factory=dict_row hace que cada fila llegue como diccionario {columna: valor}
en vez de una tupla anónima — así los routers escriben row["oee_pct"] en vez de
row[3], que es ilegible y frágil.

Los routers solo usan fetch_all / fetch_one. No conocen el pool ni psycopg: si
algún día cambiamos de driver o de base, se toca SOLO este archivo.
"""
import logging

from psycopg.rows import dict_row
from psycopg.types.numeric import FloatLoader
from psycopg_pool import ConnectionPool

from .config import settings

log = logging.getLogger(__name__)


def _configure(conn) -> None:
    """Se ejecuta en cada conexión nueva del pool.

    NUMERIC → float en vez de Decimal. Motivo: FastAPI serializa Decimal como
    STRING ("84.7") para no perder precisión, y eso obliga a cada consumidor
    (PowerBI, gráficos JS, pandas) a castear. Con float, el JSON lleva números
    de verdad (84.7). Aceptamos la precisión de float: son KPIs redondeados a
    1-2 decimales, no importes contables.
    """
    conn.adapters.register_loader("numeric", FloatLoader)


# open=False: el pool NO se conecta al importar el módulo. Lo abrimos explícitamente
# en el arranque de la app (lifespan en main.py), para controlar el momento.
pool = ConnectionPool(
    settings.pg_dsn,
    min_size=1,
    max_size=5,
    open=False,
    configure=_configure,
    kwargs={"row_factory": dict_row},
)


def fetch_all(sql, params: tuple | dict | None = None) -> list[dict]:
    """Ejecuta una consulta de LECTURA y devuelve todas las filas como lista de dicts.

    params acepta tupla (para marcadores %s) o dict (para marcadores %(nombre)s,
    útil cuando el mismo valor se repite en la consulta).
    """
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def fetch_one(sql, params: tuple | dict | None = None) -> dict | None:
    """Igual que fetch_all pero devuelve la primera fila (o None si no hay)."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def execute(sql, params: tuple | dict | None = None) -> dict | None:
    """Ejecuta una ESCRITURA (INSERT/UPDATE/DELETE). Devuelve la fila del RETURNING,
    o None si la sentencia no devuelve nada.

    Hasta hoy la API era de solo lectura; esto lo usa únicamente el router de
    administración, que es el que toca los catálogos (kpi_catalog, asset_tags).
    Nunca escribe en las tablas de datos: el dato entra por el pipeline del UNS,
    no por la API.

    El commit no se gestiona a mano: `with pool.connection()` confirma la
    transacción al salir del bloque, y hace rollback si salta una excepción. Por eso
    un fallo a mitad de un upsert no deja el catálogo a medias.
    """
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            # cur.description es None cuando no hay RETURNING (p.ej. un DELETE simple).
            return cur.fetchone() if cur.description else None
