-- ════════════════════════════════════════════════════════════════════════════
-- SILVER LAYER — contexto + vistas interpretadas sobre el bronze (3 tablas)
-- ════════════════════════════════════════════════════════════════════════════
-- Aplicar en pgAdmin (Query Tool) o:  psql "$PG_DSN" -f silver.sql
-- Idempotente: re-ejecutable sin perder datos (CREATE IF NOT EXISTS / OR REPLACE,
-- INSERT ... ON CONFLICT DO NOTHING preserva ediciones manuales de asset_tags).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── CONTEXTO — diccionario de tags ──────────────────────────────────────────
-- Da semántica a cada (src, field): nombre legible, área, límites operativos.
-- NO almacena datos de proceso, solo metadata. Editable sin tocar el histórico.
-- `assets` y `asset_tags` se crean en consumers/redpanda-to-tsdb/init.sql y las
-- puebla ÍNTEGRAMENTE el consumidor desde la categoría `def` del UNS (§4.0).
--
-- Ya no queda ninguna siembra manual: los cuatro dispositivos de campo declaran su
-- diccionario en def-publisher/definitions.yml, y el gateway lo deriva del propio
-- payload que mide. Antes esto era un INSERT literal aquí, es decir, una aplicación
-- escribiendo directo en la capa derivada — justo lo que el contrato prohíbe.

-- Reconcilia tablas creadas por versiones anteriores (a las que les falta is_numeric)

-- ─── VISTA 1 — lecturas de proceso + salud (desempaqueta sensor_readings) ────
-- Una fila por (ts, src, field). Une el JSONB con asset_tags (INNER JOIN: solo
-- pasan los campos registrados en el diccionario). value tipado a FLOAT cuando
-- el tag es numérico; los booleanos/estados quedan en value_text.
--
-- Soporta las DOS formas de payload del contrato (§4.6):
--   {field: {v,u,q}}  → dat/raw (v0.2 y v0.3 normalizado por el consumer) + diag edge-health
--   {field: escalar}  → diag plano (coriolis §7.4.2, ESP32 §4.5): sin q — queda NULL
--
-- DROP ... CASCADE: las vistas gold dependen de esta — re-aplicar gold.sql después.
DROP VIEW IF EXISTS v_process_readings CASCADE;
CREATE VIEW v_process_readings AS
SELECT
    r.ts,
    r.src,
    f.field,
    CASE WHEN t.is_numeric THEN
        CASE WHEN jsonb_typeof(r.payload -> f.field) = 'object'
             THEN (r.payload -> f.field ->> 'v')::DOUBLE PRECISION
             ELSE (r.payload ->> f.field)::DOUBLE PRECISION
        END
    END AS value,
    CASE WHEN NOT t.is_numeric THEN
        CASE WHEN jsonb_typeof(r.payload -> f.field) = 'object'
             THEN (r.payload -> f.field ->> 'v')
             ELSE (r.payload ->> f.field)
        END
    END AS value_text,
    CASE WHEN jsonb_typeof(r.payload -> f.field) = 'object'
         THEN (r.payload -> f.field ->> 'q') END AS quality,
    t.display_name,
    t.unit,
    t.area,
    t.min_limit,
    t.max_limit,
    r.mqtt_topic
FROM sensor_readings r
CROSS JOIN LATERAL jsonb_object_keys(r.payload) AS f(field)
INNER JOIN asset_tags t ON t.src = r.src AND t.field = f.field;

-- ─── VISTA 2 — estado de dispositivos (expande device_status a filas) ────────
-- Cada señal booleana del sts como fila: ideal para State Timeline en Grafana.
-- DROP ... CASCADE: vistas gold pueden depender de esta — re-aplicar gold.sql después.
DROP VIEW IF EXISTS v_device_signals CASCADE;
CREATE VIEW v_device_signals AS
SELECT
    d.ts,
    d.src,
    e.key                  AS signal,
    (e.value #>> '{}')     AS value,   -- 'true' / 'false' / texto
    d.mqtt_topic
FROM device_status d
CROSS JOIN LATERAL jsonb_each(d.state) AS e(key, value);

-- Último estado conocido por dispositivo (un registro por src)
DROP VIEW IF EXISTS v_device_status_latest;
CREATE VIEW v_device_status_latest AS
SELECT DISTINCT ON (src) src, ts, state
FROM device_status
ORDER BY src, ts DESC;

-- ─── VISTA 3 — alarmas recientes (conveniencia sobre alerts) ─────────────────
DROP VIEW IF EXISTS v_alerts_recent;
CREATE VIEW v_alerts_recent AS
SELECT ts, src, evt_type, severity, value, threshold, unit, msg, mqtt_topic
FROM alerts
ORDER BY ts DESC;
