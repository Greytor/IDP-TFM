import json
import logging
import os
import sys
import time

import psycopg2
from confluent_kafka import Consumer, KafkaError, KafkaException

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "redpanda:9092")
# dat.raw admite un segmento extra opcional: la variable en topics v0.3 (…dat.raw.mass_flow_kgh)
KAFKA_PATTERN   = os.environ.get("KAFKA_PATTERN", "^greytec\\..*\\.(def|dat\\.raw(\\.[a-z0-9_]+)?|dat\\.der|sts|diag|evt)$")
KAFKA_GROUP     = os.environ.get("KAFKA_GROUP", "greytec-tsdb-writer")
PG_DSN          = os.environ["PG_DSN"]

# Campos del envelope que NO forman parte del estado plano de un sts
STS_ENVELOPE = {"ts", "src", "seq", "mqtt_topic"}

INSERT_READING = """
    INSERT INTO sensor_readings (ts, src, seq, payload, mqtt_topic)
    VALUES (%s, %s, %s, %s::jsonb, %s)
    ON CONFLICT (ts, src, seq) DO NOTHING
"""

# ── Plano definitional (contrato §4.0) ───────────────────────────────────────
# `def` es RETENIDO: el broker lo reentrega en cada reconexión del bridge, así que
# este consumidor lo recibe repetidas veces con el mismo `rev`. El UPSERT
# condicionado por `rev` hace que reprocesarlo sea gratis, y evita que una revisión
# vieja reentregada tras un corte pise a una nueva ya aplicada.
UPSERT_ASSET = """
    INSERT INTO assets (src, rev, display_name, asset_type, area, parent, protocol, body,
                        mqtt_topic, ingested_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    ON CONFLICT (src) DO UPDATE SET
        rev          = EXCLUDED.rev,
        display_name = EXCLUDED.display_name,
        asset_type   = EXCLUDED.asset_type,
        area         = EXCLUDED.area,
        parent       = EXCLUDED.parent,
        protocol     = EXCLUDED.protocol,
        body         = EXCLUDED.body,
        mqtt_topic   = EXCLUDED.mqtt_topic,
        ingested_at  = NOW()
    WHERE assets.rev < EXCLUDED.rev
"""

UPSERT_TAG = """
    INSERT INTO asset_tags (src, field, display_name, unit, area, min_limit, max_limit,
                            is_numeric, channel, deadband, source, rev)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (src, field) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        unit         = EXCLUDED.unit,
        area         = EXCLUDED.area,
        min_limit    = EXCLUDED.min_limit,
        max_limit    = EXCLUDED.max_limit,
        is_numeric   = EXCLUDED.is_numeric,
        channel      = EXCLUDED.channel,
        deadband     = EXCLUDED.deadband,
        source       = EXCLUDED.source,
        rev          = EXCLUDED.rev
    WHERE asset_tags.rev IS NULL OR asset_tags.rev <= EXCLUDED.rev
"""

INSERT_STATUS = """
    INSERT INTO device_status (ts, src, state, mqtt_topic)
    VALUES (%s, %s, %s::jsonb, %s)
    ON CONFLICT (ts, src) DO NOTHING
"""

INSERT_ALERT = """
    INSERT INTO alerts (ts, src, evt_type, severity, value, threshold, unit, msg, body, mqtt_topic)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
"""


def wait_for_pg():
    for i in range(20):
        try:
            conn = psycopg2.connect(PG_DSN)
            conn.autocommit = False
            log.info("PostgreSQL connected")
            return conn
        except psycopg2.OperationalError as e:
            log.warning("Waiting for PostgreSQL (%d/20): %s", i + 1, e)
            time.sleep(5)
    log.error("PostgreSQL not reachable after 20 attempts")
    sys.exit(1)


def init_schema(conn):
    with open("/app/init.sql") as f:
        sql = f.read()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    log.info("Schema ready")


def process(conn, body, kafka_topic):
    """Enruta cada mensaje a su tabla según la categoría del topic (contrato UNS).

    El router mira solo los últimos segmentos del topic (la categoría), nunca
    el nombre del dispositivo — por diseño (UNS §4.6/§11): un dispositivo nuevo
    que siga el contrato no requiere tocar este archivo, solo registrar sus
    campos en asset_tags (silver.sql) para que aparezcan en las vistas.
    """
    mqtt_topic = body.get("mqtt_topic", kafka_topic.replace(".", "/"))
    parts = kafka_topic.split(".")

    if parts[-1] == "def":
        upsert_definition(conn, body, mqtt_topic)                      # §4.0 definitional
    elif parts[-1] == "sts":
        insert_status(conn, body, mqtt_topic)
    elif parts[-1] == "diag":
        insert_reading(conn, body, mqtt_topic)                        # agrupado (§4.5)
    elif parts[-2:] == ["dat", "raw"]:
        insert_reading(conn, body, mqtt_topic)                        # v0.2 agrupado (transición)
    elif len(parts) >= 3 and parts[-3:-1] == ["dat", "raw"]:
        insert_reading_flat(conn, body, mqtt_topic, field=parts[-1])  # v0.3 por variable (§4.1)
    elif parts[-2:] == ["dat", "der"] or parts[-1] == "evt":
        insert_alert(conn, body, mqtt_topic)
    else:
        log.debug("Categoría no manejada: %s", kafka_topic)


def upsert_definition(conn, body, mqtt_topic):
    """`def` — materializa el plano definitional en `assets` y `asset_tags` (§4.0).

    Es el punto donde el diccionario de variables deja de estar escrito a mano en SQL
    y pasa a derivarse del UNS, como exige el principio de que ninguna aplicación
    escribe directamente en un sistema derivado.
    """
    src   = body.get("src")
    rev   = body.get("rev")
    act   = body.get("asset") or {}
    vars_ = body.get("variables") or {}

    if not (src and isinstance(rev, int)):
        log.warning("def sin src o rev en %s, descartando", mqtt_topic)
        return

    with conn.cursor() as cur:
        cur.execute(UPSERT_ASSET, (
            src, rev,
            act.get("display_name", src), act.get("type"), act.get("area", ""),
            act.get("parent"), act.get("protocol"), json.dumps(act),
            mqtt_topic,
        ))
        aplicado = cur.rowcount > 0

        for campo, v in vars_.items():
            cur.execute(UPSERT_TAG, (
                src, campo,
                v.get("display_name", campo),
                v.get("u", ""),
                act.get("area", ""),
                v.get("min_limit"), v.get("max_limit"),
                v.get("type") in ("number", "int"),
                v.get("channel"),
                v.get("deadband"),
                json.dumps(v.get("source") or {}),
                rev,
            ))
    conn.commit()

    if aplicado:
        log.info("def aplicado: %s rev=%s (%d variables)", src, rev, len(vars_))
    else:
        log.debug("def ya vigente: %s rev=%s", src, rev)


def insert_reading(conn, body, mqtt_topic):
    """dat/raw v0.2 (transición) + diag — envelope {ts, src, seq, payload: {field: {v,u,q}}}."""
    ts      = body.get("ts")
    src     = body.get("src")
    seq     = body.get("seq", 0)
    payload = body.get("payload")

    if not (ts and src and payload):
        log.warning("Reading sin ts/src/payload en %s, descartando", mqtt_topic)
        return

    with conn.cursor() as cur:
        cur.execute(INSERT_READING, (ts, src, seq, json.dumps(payload), mqtt_topic))
        if cur.rowcount == 0:
            log.debug("[SKIP] Duplicado ts=%s src=%s seq=%s", ts, src, seq)
    conn.commit()


def insert_reading_flat(conn, body, mqtt_topic, field):
    """dat/raw v0.3 — un topic por variable, envelope plano {ts, src, seq, v, u, q}.

    Se normaliza a la misma forma de storage que v0.2 ({field: {v,u,q}}) para
    que sensor_readings y las vistas silver (jsonb_object_keys) no necesiten
    distinguir versión del contrato — el campo llega del topic, no del payload.
    """
    ts  = body.get("ts")
    src = body.get("src")
    seq = body.get("seq", 0)

    if not (ts and src and "v" in body):
        log.warning("Reading v0.3 sin ts/src/v en %s, descartando", mqtt_topic)
        return

    payload = {field: {"v": body["v"], "u": body.get("u", ""), "q": body.get("q", "good")}}
    with conn.cursor() as cur:
        cur.execute(INSERT_READING, (ts, src, seq, json.dumps(payload), mqtt_topic))
        if cur.rowcount == 0:
            log.debug("[SKIP] Duplicado ts=%s src=%s seq=%s", ts, src, seq)
    conn.commit()


def insert_status(conn, body, mqtt_topic):
    """sts — campos planos de estado (§4.2 / §7.4)."""
    ts  = body.get("ts")
    src = body.get("src")

    if not (ts and src):
        log.warning("Status sin ts/src en %s, descartando", mqtt_topic)
        return

    state = {k: v for k, v in body.items() if k not in STS_ENVELOPE}

    with conn.cursor() as cur:
        cur.execute(INSERT_STATUS, (ts, src, json.dumps(state), mqtt_topic))
    conn.commit()


def insert_alert(conn, body, mqtt_topic):
    """dat/der + evt — alarmas/eventos de eKuiper (§4.4)."""
    ts       = body.get("ts")
    src      = body.get("src", "ekuiper")
    evt_type = body.get("evt_type") or body.get("alert_id")

    if not (ts and evt_type):
        log.warning("Alerta sin ts/evt_type en %s, descartando", mqtt_topic)
        return

    with conn.cursor() as cur:
        cur.execute(INSERT_ALERT, (
            ts, src, evt_type,
            body.get("severity", "alarm"),
            body.get("value"),
            body.get("threshold"),
            body.get("unit"),
            body.get("msg"),
            json.dumps(body),
            mqtt_topic,
        ))
    conn.commit()


def main():
    conn = wait_for_pg()
    init_schema(conn)

    consumer = Consumer({
        "bootstrap.servers": KAFKA_BOOTSTRAP,
        "group.id": KAFKA_GROUP,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
    })
    consumer.subscribe([KAFKA_PATTERN])
    log.info("Suscrito a patrón '%s' como grupo %s", KAFKA_PATTERN, KAFKA_GROUP)

    try:
        while True:
            msg = consumer.poll(timeout=2.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                raise KafkaException(msg.error())

            try:
                body = json.loads(msg.value())
            except json.JSONDecodeError as e:
                log.error("JSON inválido en offset %d: %s", msg.offset(), e)
                consumer.commit(message=msg)
                continue

            try:
                process(conn, body, msg.topic())
            except psycopg2.Error as e:
                log.error("Error DB: %s", e)
                conn.rollback()
                conn = wait_for_pg()
                continue  # no hace commit — Redpanda re-entrega al reiniciar

            consumer.commit(message=msg)

    except KeyboardInterrupt:
        log.info("Deteniendo consumer")
    finally:
        consumer.close()
        conn.close()


if __name__ == "__main__":
    main()
