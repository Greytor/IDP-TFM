import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

# PROC_ROOT debe estar antes de importar psutil para que lea /host/proc del host.
if os.environ.get("HOST_PROC"):
    os.environ["PROC_ROOT"] = os.environ["HOST_PROC"]

import psutil
import docker
import paho.mqtt.client as mqtt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

MQTT_HOST  = os.environ.get("MQTT_HOST", "nanomq")
MQTT_PORT  = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "greytec/demo/campo/edge/iot2050/diag")
SRC        = os.environ.get("SRC", "iot2050")
INTERVAL   = int(os.environ.get("INTERVAL", "10"))
# Prefijo a quitar de los nombres de contenedor (ej. "greytec-node-red" → "node_red")
CTR_PREFIX = os.environ.get("CTR_PREFIX", "greytec-")

# Topic del plano definitional (contrato §4.0). Se deriva del de diag para que
# ambos apunten siempre a la misma celda: .../iot2050/diag -> .../iot2050/def
DEF_TOPIC  = os.environ.get("DEF_TOPIC") or MQTT_TOPIC.rsplit("/", 1)[0] + "/def"
DEF_REV    = int(os.environ.get("DEF_REV", "1"))

seq = 0


def _f(value, unit):
    return {"v": value, "u": unit, "q": "good"}


def host_metrics():
    fields = {}

    # CPU — intervalo 0 (no-bloqueante; primera llamada desde el módulo da 0.0,
    # las siguientes dan el % real desde la última vez que se llamó)
    cpu = psutil.cpu_percent(interval=None)
    fields["cpu_usage_pct"] = _f(round(cpu, 1), "%")

    # Memoria
    mem = psutil.virtual_memory()
    fields["mem_used_pct"] = _f(round(mem.percent, 1), "%")
    fields["mem_used_mb"]  = _f(round(mem.used / 1_048_576, 1), "MB")
    fields["mem_total_mb"] = _f(round(mem.total / 1_048_576, 1), "MB")

    # Disco (vista del host vía overlay — free space equivalente al host)
    try:
        disk = psutil.disk_usage("/")
        fields["disk_used_pct"] = _f(round(disk.percent, 1), "%")
        fields["disk_free_gb"]  = _f(round(disk.free / 1_073_741_824, 2), "GB")
    except Exception as e:
        log.debug("disk: %s", e)

    # Load average
    try:
        load1, *_ = psutil.getloadavg()
        fields["load_1m"] = _f(round(load1, 2), "")
    except Exception as e:
        log.debug("load: %s", e)

    # Uptime
    try:
        uptime_h = (time.time() - psutil.boot_time()) / 3600
        fields["uptime_h"] = _f(round(uptime_h, 2), "h")
    except Exception as e:
        log.debug("uptime: %s", e)

    # Red — bytes acumulados desde arranque del host
    try:
        net = psutil.net_io_counters()
        fields["net_tx_mb"] = _f(round(net.bytes_sent / 1_048_576, 1), "MB")
        fields["net_rx_mb"] = _f(round(net.bytes_recv / 1_048_576, 1), "MB")
    except Exception as e:
        log.debug("net: %s", e)

    # Temperatura (disponible en hardware con sensores; silencioso si no hay)
    try:
        temps = psutil.sensors_temperatures()
        for sensor_name, entries in temps.items():
            for i, entry in enumerate(entries):
                if entry.current and entry.current > 0:
                    label = (entry.label or f"{sensor_name}_{i}").lower().replace(" ", "_")
                    fields[f"temp_{label}_c"] = _f(round(entry.current, 1), "°C")
                    break  # primera lectura de cada sensor es suficiente
    except Exception:
        pass

    return fields


def container_metrics(docker_client):
    fields = {}
    try:
        containers = docker_client.containers.list()
    except Exception as e:
        log.warning("docker list: %s", e)
        return fields

    for c in containers:
        raw_name = c.name
        name = raw_name.removeprefix(CTR_PREFIX).replace("-", "_")

        fields[f"{name}_status"] = _f(c.status, "")

        try:
            stats = c.stats(stream=False)

            # Memoria
            mem_b = stats.get("memory_stats", {}).get("usage", 0)
            fields[f"{name}_mem_mb"] = _f(round(mem_b / 1_048_576, 1), "MB")

            # CPU %
            cpu_d = (
                stats["cpu_stats"]["cpu_usage"]["total_usage"]
                - stats["precpu_stats"]["cpu_usage"]["total_usage"]
            )
            sys_d = (
                stats["cpu_stats"]["system_cpu_usage"]
                - stats["precpu_stats"]["system_cpu_usage"]
            )
            n_cpu = stats["cpu_stats"].get("online_cpus") or len(
                stats["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])
            )
            cpu_pct = round((cpu_d / sys_d) * n_cpu * 100.0, 1) if sys_d > 0 else 0.0
            fields[f"{name}_cpu_pct"] = _f(cpu_pct, "%")

        except Exception as e:
            log.debug("stats %s: %s", name, e)

    return fields


# ── Plano definitional (contrato §4.0) ───────────────────────────────────────
# El gateway no puede declarar sus variables en un YAML estático como los
# dispositivos de campo: las métricas POR CONTENEDOR dependen de qué contenedores
# están corriendo, y eso cambia con el despliegue.
#
# La solución es construir el `def` a partir del payload real que se acaba de
# medir. Así la definición no puede divergir del flujo por construcción: si una
# variable se publica, está declarada, porque ambas salen del mismo diccionario.
#
# Si el conjunto de campos cambia (aparece o desaparece un contenedor), se
# republica con `rev` incrementado, que es exactamente el caso de uso que el
# contrato prevé para `rev`.

NOMBRES_HOST = {
    "cpu_usage_pct": "CPU del host",   "load_1m":      "Carga de CPU 1 min",
    "mem_used_pct":  "RAM usada",      "mem_used_mb":  "RAM usada",
    "mem_total_mb":  "RAM total",      "disk_used_pct": "Disco usado",
    "disk_free_gb":  "Disco libre",    "uptime_h":     "Tiempo en servicio",
    "net_rx_mb":     "Red recibido",   "net_tx_mb":    "Red enviado",
}

NOMBRES_METRICA_CTR = {
    "cpu_pct": "CPU", "mem_mb": "RAM", "status": "Estado",
}


def _describir(campo, unidad):
    """Nombre legible y área para una métrica, sin tabla estática que mantener."""
    if campo in NOMBRES_HOST:
        area = "Red" if campo.startswith("net_") else "Sistema"
        return NOMBRES_HOST[campo], area
    if campo.startswith("temp_"):
        # temp_package_id_0_c -> "Temperatura package id 0"
        cuerpo = campo[len("temp_"):].removesuffix("_c").replace("_", " ")
        return f"Temperatura {cuerpo}", "Temperatura"
    for sufijo, etiqueta in NOMBRES_METRICA_CTR.items():
        if campo.endswith("_" + sufijo):
            contenedor = campo[: -len(sufijo) - 1].replace("_", "-")
            return f"{etiqueta} de {contenedor}", "Contenedores"
    return campo.replace("_", " ").capitalize(), "Sistema"


def build_definition(payload, rev):
    """Deriva el mensaje `def` del payload medido (contrato §4.0)."""
    variables = {}
    for campo, valor in payload.items():
        unidad = valor.get("u", "")
        nombre, area = _describir(campo, unidad)
        es_num = isinstance(valor.get("v"), (int, float)) and not isinstance(valor.get("v"), bool)
        variables[campo] = {
            "display_name": nombre,
            "u": unidad,
            "type": "number" if es_num else "string",
            "channel": "diag",
            "area": area,
            # El gateway publica en cadencia fija, no por excepción: no hay deadband.
            "deadband": None,
            "source": {"protocol": "local", "collector": "psutil+docker"},
        }

    return {
        "ts": now_iso(),
        "src": SRC,
        "rev": rev,
        "contract": "0.4",
        "asset": {
            "display_name": "Gateway de adquisición de borde",
            "type": "gateway",
            "manufacturer": "Siemens",
            "model": "SIMATIC IOT2050 Advanced",
            "area": "Sistema",
            "parent": None,
            "protocol": "mqtt",
        },
        "variables": variables,
    }


def now_iso():
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def build_message(payload):
    global seq
    seq += 1
    return {"ts": now_iso(), "src": SRC, "seq": seq, "payload": payload}


def main():
    # Primera llamada de cpu_percent para inicializar la base del delta
    psutil.cpu_percent(interval=None)

    # Docker client (opcional — si el socket no está disponible, omite los ctr)
    try:
        docker_client = docker.DockerClient(base_url="unix:///var/run/docker.sock")
        docker_client.ping()
        log.info("Docker socket conectado")
    except Exception as e:
        log.warning("Docker socket no disponible: %s", e)
        docker_client = None

    # MQTT client con reconexión automática
    client = mqtt.Client(client_id=f"edge-health-{SRC}", clean_session=True)
    client.reconnect_delay_set(min_delay=2, max_delay=30)

    def on_connect(c, *_):
        log.info("MQTT conectado a %s:%d → %s", MQTT_HOST, MQTT_PORT, MQTT_TOPIC)

    def on_disconnect(c, userdata, rc):
        if rc != 0:
            log.warning("MQTT desconectado (rc=%d), reconectando…", rc)

    client.on_connect    = on_connect
    client.on_disconnect = on_disconnect

    while True:
        try:
            client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
            client.loop_start()
            break
        except Exception as e:
            log.warning("MQTT no disponible: %s — reintentando en 5 s", e)
            time.sleep(5)

    log.info("Publicando cada %d s", INTERVAL)

    campos_declarados = None   # conjunto de variables del último `def` publicado
    rev_actual = DEF_REV

    while True:
        try:
            payload = host_metrics()
            if docker_client:
                payload.update(container_metrics(docker_client))

            # ── def: solo cuando cambia el conjunto de variables (§4.0) ──
            campos = frozenset(payload)
            if campos != campos_declarados:
                if campos_declarados is not None:
                    rev_actual += 1     # el catálogo cambió: nueva revisión
                    log.info("El conjunto de métricas cambió (%+d campos), rev -> %d",
                             len(campos) - len(campos_declarados), rev_actual)
                definicion = build_definition(payload, rev_actual)
                client.publish(DEF_TOPIC, json.dumps(definicion, ensure_ascii=False),
                               qos=1, retain=True)      # §3.2: retenido
                campos_declarados = campos
                log.info("def publicado en %s (rev %d, %d variables)",
                         DEF_TOPIC, rev_actual, len(campos))

            msg = build_message(payload)
            client.publish(MQTT_TOPIC, json.dumps(msg, ensure_ascii=False), qos=1)
        except Exception as e:
            log.error("Error en ciclo: %s", e)

        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
