# ─────────────────────────────────────────────────────────────────────────────
# NanoMQ — PLANTILLA de configuración (HOCON, formato NanoMQ >= 0.18)
#
# Los marcadores __PLACEHOLDER__ se sustituyen en el arranque del contenedor
# con las variables del .env (ver entrypoint en docker-compose.yml). No editar
# las credenciales aquí: van en .env y NUNCA se versionan.
#
# IMPORTANTE: solo claves documentadas. NanoMQ hace segfault (exit 139) ante
# claves desconocidas en el bloque del bridge (p.ej. qos dentro de forwards,
# o transparent) en vez de dar un error legible.
#
# Refs: ADR-003 (NanoMQ), ADR-013 (stack edge IOT2050)
#       https://nanomq.io/docs/en/latest/config-description/bridges.html
# ─────────────────────────────────────────────────────────────────────────────

# ── Listener MQTT local ──────────────────────────────────────────────────────
# Anónimo: Node-RED y eKuiper publican dentro de la red del compose sin auth.
listeners.tcp {
  bind = "0.0.0.0:1883"
}

# MQTT sobre WebSocket — útil para debug desde el navegador (MQTTX web).
listeners.ws {
  bind = "0.0.0.0:8083/mqtt"
}

# ── Parámetros del broker ────────────────────────────────────────────────────
mqtt {
  property_size        = 32
  max_packet_size      = 1MB
  max_mqueue_len       = 2048
  retry_interval       = 10s
  keepalive_multiplier = 1.25
}

# ── Logging ──────────────────────────────────────────────────────────────────
log {
  to    = [console]
  level = warn
}

# ── Bridge store-and-forward hacia EMQX central ──────────────────────────────
# QoS 1 + clean_start=false => sesión durable. Si la WAN cae, NanoMQ encola
# hasta max_send_queue_len mensajes y los entrega íntegros al reconectar.
# Al ritmo actual del lab (~2.1 msg/s: soft-plc dat+sts a 1 Hz + diag c/10 s),
# 10000 mensajes ≈ 80 min de backlog. Cumple el objetivo mínimo de 1 h; para
# el objetivo de 24 h, habilitar el cache en disco de abajo o subir la cola.
bridges.mqtt.emqx_central {
  server      = "mqtt-tcp://__EMQX_CENTRAL_HOST__:__EMQX_CENTRAL_PORT__"
  proto_ver   = 4                       # MQTT 3.1.1
  clientid    = "__BRIDGE_CLIENT_ID__"  # ÚNICO por dispositivo físico — ver .env
  keepalive   = 60s
  clean_start = false                   # sesión persistente en EMQX
  username    = "__BRIDGE_USERNAME__"
  password    = "__BRIDGE_PASSWORD__"

  # Reenvía TODO el namespace greytec al central conservando el topic original.
  # remote_topic="" => no reescribe el topic (forma documentada para wildcards).
  # OJO: en forwards NO va 'qos' (no es clave válida -> segfault).
  forwards = [
    {
      remote_topic = ""
      local_topic  = "greytec/#"
    }
  ]

  max_parallel_processes = 2
  max_send_queue_len     = 10000        # backlog hacia EMQX (store-and-forward)
  max_recv_queue_len     = 10000
  resend_interval        = 5000
}

# ── Persistencia en disco del backlog (opcional) ─────────────────────────────
# La cola en memoria de arriba (10000) ya cubre cortes de WAN. Para que el
# backlog sobreviva a reinicios del contenedor, descomentar este bloque y
# montar un volumen en mounted_file_path (ver docker-compose.yml).
#
# bridges.mqtt.cache {
#   disk_cache_size     = 102400
#   mounted_file_path   = "/opt/nanomq/"
#   flush_mem_threshold = 100
#   resend_interval     = 5000
# }
