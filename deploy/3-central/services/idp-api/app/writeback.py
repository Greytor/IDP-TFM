"""Write-back de KPIs — devuelve al UNS los KPIs calculados (contrato UNS §7.6).

SEGUNDO punto de entrada de la imagen idp-api. NO es la API: es un proceso aparte,
en su propio contenedor:  python -m app.writeback

Cierra el lazo del UNS. Sin esto, el OEE vive atrapado en una vista SQL y el SCADA
—que no habla SQL— no puede verlo. Aquí vuelve al broker como mensaje retained, y
el consumidor operacional (§10.1) lo lee igual que cualquier otro tópico.

Cada tick:
  1. Relee kpi_catalog → un UPDATE desde la consola de administración surte efecto
     al siguiente ciclo, sin reiniciar nada.
  2. Consulta la última fila de cada vista gold.
  3. Publica RBE (§3.5): solo si algún campo cambió, o si venció el heartbeat.
  4. Limpia el retained de los KPIs que dejaron de publicarse.

Comparte db.py y config.py con la API — de ahí que vivan en la misma imagen.
"""
import json
import logging
import signal
import sys
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from psycopg import sql

from .config import settings
from .db import fetch_all, fetch_one, pool

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("writeback")

SRC = "idp-writeback"          # el `src` del envelope (§7.6)
CLIENT_ID = "greytec-kpi-writeback"

_running = True


def _stop(signum, frame) -> None:
    """SIGTERM de `docker stop` → salir del bucle limpiamente."""
    global _running
    log.info("Señal %s recibida, deteniendo…", signum)
    _running = False


def _sleep(seconds: int) -> None:
    """Duerme en tramos de 1 s para reaccionar rápido a SIGTERM (docker mata a los 10 s)."""
    for _ in range(seconds):
        if not _running:
            return
        time.sleep(1)


# ─────────────────────────────── catálogo y datos ───────────────────────────────

def load_catalog() -> list[dict]:
    """Los KPIs a publicar, releídos en CADA tick (config-como-datos en vivo)."""
    return fetch_all(
        """
        SELECT name, view_name, topic, derived_from, time_column, units
        FROM kpi_catalog WHERE enabled AND publish ORDER BY name
        """
    )


def latest_row(kpi: dict) -> dict | None:
    """Última cubeta de la vista gold del KPI."""
    query = sql.SQL("SELECT * FROM {view} ORDER BY {tcol} DESC LIMIT 1").format(
        view=sql.Identifier(kpi["view_name"]), tcol=sql.Identifier(kpi["time_column"])
    )
    return fetch_one(query)


def build_payload(row: dict, kpi: dict) -> dict:
    """Fila de la vista → payload {v,u,q} del contrato §7.6.

    `q` describe el estado del CÁLCULO, no de un sensor:
      · cubeta cerrada           → good      (dato final)
      · cubeta en curso          → uncertain (real pero provisional; is_partial)
      · campo NULL               → bad       (sin datos / división por cero)

    Solo salen los campos declarados en kpi_catalog.units — las columnas internas
    de la vista (ej. `muestras`) no llegan al namespace.
    """
    partial = bool(row.get("is_partial"))
    payload = {}
    for field, unit in kpi["units"].items():
        if field not in row:
            log.warning(
                "KPI '%s': el campo '%s' del catálogo no existe en la vista %s — revisa units",
                kpi["name"], field, kpi["view_name"],
            )
            continue
        value = row[field]
        quality = "bad" if value is None else ("uncertain" if partial else "good")
        payload[field] = {"v": value, "u": unit, "q": quality}
    return payload


def has_changed(prev: dict | None, current: dict) -> bool:
    """RBE (§3.5): publica si cambió algún valor O alguna calidad."""
    if prev is None:
        return True
    return any(
        prev.get(field, {}).get("v") != c["v"] or prev.get(field, {}).get("q") != c["q"]
        for field, c in current.items()
    )


# ──────────────────────────────────── MQTT ──────────────────────────────────────

def connect_mqtt() -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=CLIENT_ID)
    if settings.mqtt_user:
        client.username_pw_set(settings.mqtt_user, settings.mqtt_password)

    for attempt in range(1, 21):
        try:
            client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=60)
            client.loop_start()  # hilo de fondo: mantiene la sesión y reconecta solo
            log.info("MQTT conectado a %s:%s", settings.mqtt_host, settings.mqtt_port)
            return client
        except OSError as e:
            log.warning("Esperando a MQTT (%d/20): %s", attempt, e)
            time.sleep(5)
    log.error("MQTT inalcanzable tras 20 intentos")
    sys.exit(1)


def clear_removed(client: mqtt.Client, state: dict, live_topics: set[str]) -> None:
    """Publica un retained VACÍO en los tópicos que dejaron de estar en el catálogo.

    Sin esto, poner publish=false dejaría el último valor congelado en el broker
    para siempre, y el SCADA seguiría mostrando un KPI que ya nadie calcula (§7.6).
    """
    for name in list(state):
        topic = state[name]["topic"]
        if topic not in live_topics:
            client.publish(topic, payload=b"", qos=1, retain=True)
            log.info("KPI '%s' retirado → retained limpiado en %s", name, topic)
            del state[name]


# ──────────────────────────────────── bucle ─────────────────────────────────────

def tick(client: mqtt.Client, state: dict, seq: int) -> int:
    """Un ciclo completo. Devuelve el `seq` actualizado."""
    catalog = load_catalog()
    clear_removed(client, state, {k["topic"] for k in catalog})

    now = time.time()
    for kpi in catalog:
        row = latest_row(kpi)
        if row is None:
            continue  # la vista aún no tiene datos

        payload = build_payload(row, kpi)
        if not payload:
            continue  # units vacío o mal configurado — ya se avisó

        prev = state.get(kpi["name"])
        heartbeat_due = prev is None or (now - prev["t"]) >= settings.writeback_heartbeat_s
        if not (heartbeat_due or has_changed(prev["payload"] if prev else None, payload)):
            continue

        seq += 1  # seq por PRODUCTOR, a través de todos sus KPIs (§3.4)
        bucket = row.get(kpi["time_column"])
        message = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "src": SRC,
            "derived_from": kpi["derived_from"],
            "transform": kpi["view_name"],   # trazabilidad: del mensaje a la lógica
            "seq": seq,
            "bucket": bucket.isoformat() if hasattr(bucket, "isoformat") else bucket,
            "payload": payload,
        }
        client.publish(
            kpi["topic"], json.dumps(message, default=str), qos=1, retain=True
        )
        state[kpi["name"]] = {"payload": payload, "t": now, "topic": kpi["topic"]}
        log.debug("Publicado %s (seq=%d)", kpi["topic"], seq)

    return seq


def main() -> None:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    pool.open()
    pool.wait(timeout=30.0)
    log.info("Pool de conexiones listo")

    client = connect_mqtt()
    state: dict[str, dict] = {}  # name → {payload, t, topic} — memoria del RBE
    seq = 0                      # reinicia a 0 en cada arranque (§3.4)

    log.info(
        "Write-back activo: tick %ds, heartbeat %ds",
        settings.writeback_tick_s, settings.writeback_heartbeat_s,
    )
    while _running:
        try:
            seq = tick(client, state, seq)
        except Exception:
            # Un fallo de DB o MQTT no debe matar el servicio: se reintenta al
            # siguiente tick. El pool de psycopg y paho reconectan por su cuenta.
            log.exception("Error en el ciclo; se reintenta en %ds", settings.writeback_tick_s)
        _sleep(settings.writeback_tick_s)

    client.loop_stop()
    client.disconnect()
    pool.close()
    log.info("Write-back detenido")


if __name__ == "__main__":
    main()
