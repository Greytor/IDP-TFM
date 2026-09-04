"""Publicador del plano definitional del UNS (contrato §4.0).

QUÉ HACE: lee `definitions.yml` y publica un mensaje **retenido** por dispositivo en
`{base}/{cell}/def` con la identidad del activo y el diccionario de sus variables.

QUÉ NO HACE: leer los instrumentos. Eso es Node-RED. Aquí no hay ni Modbus ni OPC UA.

─── Por qué existe este servicio y no lo publica Node-RED ────────────────────────────
La definición y la adquisición cambian a ritmos distintos y por motivos distintos. El
flujo de Node-RED cambia cuando cambia *cómo se lee*; la definición cambia cuando cambia
*qué significa lo leído*. Separarlos permite que el modelo de datos de la instalación viva
en un fichero versionado, legible y diffeable, en vez de sepultado dentro de un nodo
`function` de un JSON de 3.000 líneas.

Consecuencia práctica: para dar de alta un instrumento nuevo se edita un YAML, no un flujo.

─── Por qué retenido y por qué al arrancar ──────────────────────────────────────────
`retain=true` es lo que hace el namespace autodescriptivo (contrato §4.0): un consumidor
que se suscribe a `+/+/+/+/+/def` recibe el modelo completo de la planta en el instante de
conectarse, sin pedírselo a nadie y sin esperar a que algo cambie. Es la diferencia entre
un namespace que transporta valores y uno que además explica qué son.

El servicio publica, verifica y termina (`restart: on-failure`): no hay nada que mantener
vivo. Si el broker pierde los retenidos, basta relanzarlo.

─── Acoplamiento conocido ───────────────────────────────────────────────────────────
Los `deadband` declarados aquí deben coincidir con los que aplica el nodo `function` de
Node-RED. Hoy esa coincidencia es manual y es la deuda técnica principal de esta pieza;
La vista `v_contrato_variables_sin_declarar` del consumidor central la detecta.
"""
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import yaml

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("def-publisher")

MQTT_HOST = os.environ.get("MQTT_HOST", "nanomq")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER") or None
MQTT_PASS = os.environ.get("MQTT_PASSWORD") or None
DEFS_PATH = os.environ.get("DEFINITIONS_PATH", "/app/definitions.yml")


def ahora_iso() -> str:
    """ISO 8601 UTC con milisegundos, como exige el contrato §3.1."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def construir_mensajes(defs: dict) -> list[tuple[str, dict]]:
    """Convierte el YAML en la lista de (topic, payload) del contrato §4.0."""
    base = defs["base_topic"].rstrip("/")
    contrato = str(defs["contract"])
    ts = ahora_iso()
    mensajes = []

    for cell, d in defs["devices"].items():
        variables = {}
        for nombre, v in d["variables"].items():
            # `nota` es documentación para el lector del YAML, no parte del contrato.
            variables[nombre] = {k: val for k, val in v.items() if k != "nota"}

        payload = {
            "ts": ts,
            "src": cell,                 # contrato §3.3: src == cell del topic
            "rev": d["rev"],             # §4.0: revisión, NO se reinicia al arrancar
            "contract": contrato,
            "asset": d["asset"],
            "variables": variables,
        }
        # Un dispositivo puede vivir fuera del árbol de la celda (p.ej. el gateway,
        # que cuelga de campo/edge). `base_topic` propio lo permite sin duplicar fichero.
        raiz = d.get("base_topic", base).rstrip("/")
        mensajes.append((f"{raiz}/{cell}/def", payload))

    return mensajes


def validar(defs: dict) -> list[str]:
    """Comprobaciones que evitan publicar una definición inconsistente."""
    errores = []
    canales_validos = {"dat/raw", "dat/der", "diag", "sts"}

    for cell, d in defs["devices"].items():
        if d["asset"].get("parent") == cell:
            errores.append(f"{cell}: se declara padre de sí mismo")
        if not isinstance(d.get("rev"), int):
            errores.append(f"{cell}: 'rev' debe ser un entero (§4.0)")
        for nombre, v in d["variables"].items():
            if nombre != nombre.lower() or " " in nombre:
                errores.append(f"{cell}.{nombre}: el nombre debe ser snake_case (§3.1)")
            for campo in ("display_name", "u", "type", "channel"):
                if campo not in v:
                    errores.append(f"{cell}.{nombre}: falta '{campo}'")
            if v.get("channel") not in canales_validos:
                errores.append(f"{cell}.{nombre}: canal '{v.get('channel')}' no válido")
            lo, hi = v.get("min_limit"), v.get("max_limit")
            if lo is not None and hi is not None and lo >= hi:
                errores.append(f"{cell}.{nombre}: min_limit >= max_limit")

    return errores


def main() -> int:
    with open(DEFS_PATH, encoding="utf-8") as f:
        defs = yaml.safe_load(f)

    errores = validar(defs)
    if errores:
        for e in errores:
            log.error("definitions.yml — %s", e)
        log.error("No se publica nada: la definición debe ser válida antes de entrar al UNS")
        return 1

    mensajes = construir_mensajes(defs)
    log.info("%d definiciones válidas, %d variables en total",
             len(mensajes), sum(len(p["variables"]) for _, p in mensajes))

    cli = mqtt.Client(client_id="greytec-def-publisher", clean_session=True)
    if MQTT_USER:
        cli.username_pw_set(MQTT_USER, MQTT_PASS)

    for intento in range(1, 21):
        try:
            cli.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
            break
        except OSError as e:
            log.warning("Broker no disponible (%s), reintento %d/20", e, intento)
            time.sleep(3)
    else:
        log.error("No se pudo conectar a %s:%s", MQTT_HOST, MQTT_PORT)
        return 1

    cli.loop_start()
    for topic, payload in mensajes:
        info = cli.publish(topic, json.dumps(payload, ensure_ascii=False),
                           qos=1, retain=True)   # §3.2: retenido, obligatorio
        info.wait_for_publish(timeout=10)
        log.info("publicado %s (rev %d, %d variables)",
                 topic, payload["rev"], len(payload["variables"]))

    cli.loop_stop()
    cli.disconnect()
    log.info("Plano definitional publicado. El namespace ya se autodescribe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
