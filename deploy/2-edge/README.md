# Edge IOT2050 — Stack de adquisición (Greytec IDP)

Stack de adquisición y mensajería para el **Siemens IOT2050 Advanced**
(ARM, 2 GB RAM). Se prototipa en la **Gigabyte Brix** (x86, Debian,
`brix-edge`, `10.10.10.100`) y el mismo `docker-compose.yml` se despliega luego
en el IOT2050 (`10.10.10.4`). Ruta de despliegue: **`/opt/greytec-edge/`**.

Decisiones de referencia: [ADR-011](../../docs/adr/ADR-011-Gateway-IOT2050.md)
(stack edge), [ADR-003](../../../docs/adr/platform/ADR-003-NanoMQ.md) (broker),
[Contrato UNS v0.1](../../../docs/contracts/UNS.md).

## Servicios (sin base de datos)

| Servicio | Imagen | Puertos | Tope RAM | Rol |
|---|---|---|---|---|
| **NanoMQ** | `emqx/nanomq:0.25.1` | 1883, 8083 | 256M | Broker MQTT local + bridge QoS 1 store-and-forward a EMQX central |
| **Node-RED** | build (`nodered/`) | 1880 | 512M | Cliente Modbus TCP + OPC UA, normalización UNS, Dashboard local (`/ui`) |
| **eKuiper** | `lfedge/ekuiper:latest` | 9081 | 256M | Stream processing (deadband, KPIs, anomalías). Montado e inactivo |
| **eKuiper Manager** | `emqx/ekuiper-manager:latest` | 9082 | 192M | UI web de administración de eKuiper (admin/desarrollo) |
| **edge-health** | build (`edge-health/`) | — | 128M | Publica la salud del edge (host + contenedores) al UNS vía NanoMQ, topic `diag`, envelope dat `{v,u,q}` (UNS §7.5) |

Los topes de RAM son **límites (caps), no reservas**: el uso real en reposo es
mucho menor (NanoMQ ~10M, eKuiper ~30M, Node-RED ~100M). Caben de sobra en los
2 GB del IOT2050.

No corre TimescaleDB, Grafana ni ninguna BD: el historial es del stack central
(Dell/Proxmox). El bridge publica a **EMQX central `10.10.20.130:1883`** como
usuario `iot2050-bridge` (Publish Allow sobre `greytec/#`).

> ⚠ **`BRIDGE_CLIENT_ID` (en `.env`) debe ser único por dispositivo físico.**
> Dos equipos conectados a EMQX central con el mismo Client ID hacen que el
> broker desconecte silenciosamente al primero — es el mecanismo estándar de
> MQTT ante clientid duplicado, no un error visible. Cada nueva unidad
> (incluyendo el prototipo del Brix) necesita su propio valor.

```
clientes / sensores ──Modbus TCP / OPC UA──> Node-RED ──UNS──┐
                                                              v
                                        eKuiper <──> NanoMQ (:1883) ──bridge QoS1──> EMQX central
                                                              ^
   salud host+contenedores ── edge-health ──diag──┤
                                          Dashboard local <── Node-RED (/ui)
```

## Estructura

```
edge-iot2050/
├── docker-compose.yml
├── .env                  # credenciales reales
├── .env.example          # plantilla de variables
├── nanomq/
│   └── nanomq.conf.tpl   # plantilla HOCON; los __PLACEHOLDER__ se inyectan del .env al arrancar
├── nodered/
│   ├── Dockerfile        # node-red + modbus + opcua + dashboard
│   ├── settings.js       # credentialSecret desde env, dashboard en /ui
│   └── flows.json        # flujo inicial (construir aquí Modbus/OPC UA -> UNS)
├── edge-health/
│   ├── Dockerfile        # python + psutil + docker SDK + paho-mqtt
│   └── main.py           # salud host+contenedores -> topic diag (envelope dat)
└── telegraf/
    └── telegraf.conf     # ⚠️ NO ACTIVO — alternativa sub-árbol por métrica (UNS §7.5)
```

> eKuiper no tiene archivos en el host: usa volúmenes con nombre
> (`ekuiper_data`, `ekuiper_plugins`) y arranca inactivo. Las reglas se crean
> vía su REST API (`:9081`) cuando se necesiten.

## Despliegue en el Brix

```bash
# En el Brix (vía ssh root@10.10.10.100), desde /opt/greytec-edge/
cp .env.example .env          # si no se copió el .env real; editar credenciales

# Node-RED corre como uid 1000 y escribe en ./nodered (bind-mount):
chown -R 1000:1000 /opt/greytec-edge/nodered

docker compose up -d --build  # --build compila la imagen de Node-RED
docker compose ps
docker compose logs -f nanomq # verificar "bridge" conectado a EMQX central
```

### Accesos

- **Node-RED editor:** http://10.10.10.100:1880
- **Dashboard operador:** http://10.10.10.100:1880/ui
- **eKuiper REST:** http://10.10.10.100:9081
- **eKuiper Manager (UI):** http://10.10.10.100:9082 (login `admin` / `public`; añade el servicio `http://ekuiper:9081`)
- **Salud del edge en el UNS:** topic `greytec/demo/campo/edge/iot2050/diag` (envelope dat `{v,u,q}`, cada 10 s; publicado por edge-health vía NanoMQ → bridge → EMQX central)
- **NanoMQ MQTT:** `10.10.10.100:1883` (anónimo en la red interna)

## Notas de operación

- **Secretos:** todo en `.env`. NanoMQ no lee `.env` directo: su
  config es una plantilla que se rellena con `sed` en el arranque del contenedor
  (ver `command:` en el compose). Node-RED recibe `NODE_RED_CREDENTIAL_SECRET`
  como variable de entorno.
- **Store-and-forward:** si cae la WAN, NanoMQ encola hasta `max_send_queue_len`
  (10000) mensajes en memoria y los entrega al reconectar. Para que el backlog
  sobreviva a reinicios del contenedor, descomentar el bloque
  `bridges.mqtt.cache` en `nanomq/nanomq.conf.tpl` y montar un volumen en su
  `mounted_file_path`.
- **Node-RED en ARM/IOT2050:** los tres nodos son JS puros; `--build` funciona
  igual en el IOT2050. Si `chown` se omite, Node-RED no podrá escribir flujos.
- **eKuiper:** queda montado e inactivo (sin streams ni reglas). Cuando se
  necesite procesar, los streams/reglas se dan de alta vía la REST API (`:9081`)
  o desde **eKuiper Manager** (`:9082`); la fuente MQTT por defecto ya apunta a
  `tcp://nanomq:1883`.
- **eKuiper Manager:** UI de administración, no dashboard de operador. Primera
  vez: login `admin`/`public` → *Add Service* → endpoint `http://ekuiper:9081`
  (se resuelve por nombre dentro de la red del compose).
- **edge-health (salud → UNS):** no hay UI local; la salud se observa en el
  stack central, igual que el resto del UNS. edge-health recolecta host (psutil
  sobre `/host/proc`) + contenedores (Docker SDK) y publica al **NanoMQ local**
  (`tcp://nanomq:1883`), no al central directo: el bridge reenvía `greytec/#`,
  así la salud sale por el mismo camino. Publica **un solo topic**
  `greytec/demo/campo/edge/iot2050/diag`, QoS 1, cada 10 s, con el envelope dat
  `{ts, src, seq, payload: {campo: {v,u,q}}}` (UNS §7.5) — así aterriza en
  `sensor_readings` por el mismo consumidor central. Corre como **root**
  (`user: "0:0"`) para leer `/var/run/docker.sock`; alternativa de menor
  privilegio: `group_add` con el GID de `getent group docker` (fijar por host).
- **telegraf/telegraf.conf:** alternativa **no activa** (sub-árbol por métrica,
  formato nativo Telegraf). Ver la nota de cabecera del archivo y UNS §7.5.
- **Saltos de línea:** si editas `nanomq.conf.tpl` desde Windows, guárdalo con
  LF (no CRLF) o fallará en Linux.

## Migrar al IOT2050

Copiar `/opt/greytec-edge/` al IOT2050 (misma ruta), ajustar IPs en `.env` si
cambian y repetir el despliegue. El Dashboard quedará en `http://10.10.10.4:1880/ui`.
