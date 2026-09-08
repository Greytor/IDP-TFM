-- ════════════════════════════════════════════════════════════════════════════
-- Bronze layer — landing zone del UNS, una tabla por forma de mensaje (contrato UNS v0.1)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── dat/raw + diag — datos numéricos con envelope {v,u,q} (§4.1) ─────────────
CREATE TABLE IF NOT EXISTS sensor_readings (
    ts          TIMESTAMPTZ NOT NULL,
    src         TEXT        NOT NULL,
    seq         BIGINT      NOT NULL,
    payload     JSONB       NOT NULL,
    mqtt_topic  TEXT,
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);
SELECT create_hypertable('sensor_readings', 'ts', if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sensor_readings
    ON sensor_readings (ts, src, seq);

-- ─── sts — estado operativo, campos planos (§4.2 / §7.4) ─────────────────────
-- Sin payload {v,u,q}: booleanos de estado (pump_on, alarm_jam, …).
-- 'state' guarda todos los campos planos menos el envelope (ts, src, mqtt_topic).
CREATE TABLE IF NOT EXISTS device_status (
    ts          TIMESTAMPTZ NOT NULL,
    src         TEXT        NOT NULL,
    state       JSONB       NOT NULL,
    mqtt_topic  TEXT,
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);
SELECT create_hypertable('device_status', 'ts', if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_status
    ON device_status (ts, src);

-- ─── evt — alarmas y eventos discretos (§4.4) ────────────────────────────────
-- Campos comunes extraídos + 'body' con el mensaje original completo.
CREATE TABLE IF NOT EXISTS alerts (
    ts          TIMESTAMPTZ NOT NULL,
    src         TEXT,
    evt_type    TEXT        NOT NULL,
    severity    TEXT        DEFAULT 'alarm',
    value       DOUBLE PRECISION,
    threshold   DOUBLE PRECISION,
    unit        TEXT,
    msg         TEXT,
    body        JSONB       NOT NULL,
    mqtt_topic  TEXT,
    ingested_at TIMESTAMPTZ DEFAULT NOW()
);
SELECT create_hypertable('alerts', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS ix_alerts_type ON alerts (evt_type, ts DESC);
-- Idempotencia (ADR-005): mismo evento re-entregado tras catch-up no se duplica.
-- evt no lleva seq en el contrato; (ts, src, evt_type) es la clave natural.
-- NOTA: si una instalación previa ya tiene duplicados, depurarlos antes de
-- aplicar este índice (DELETE de duplicados por ctid).
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts ON alerts (ts, src, evt_type);

-- ════════════════════════════════════════════════════════════════════════════
-- PLANO DEFINITIONAL — materializado desde la categoría `def` del UNS (§4.0)
-- ════════════════════════════════════════════════════════════════════════════
-- Estas dos tablas NO se rellenan a mano: las escribe `upsert_definition()` del
-- consumidor cuando llega un mensaje `def` retenido. Son datos DERIVADOS del UNS,
-- igual que las lecturas: si se borran, se reconstruyen resuscribiéndose a
-- `+/+/+/+/+/def`, porque el broker conserva los retenidos.
--
-- Antes de v0.4 este diccionario vivía como INSERT literal en silver.sql, es decir,
-- una aplicación escribiendo directo en la capa derivada: exactamente lo que el
-- contrato prohíbe. La categoría `def` cierra esa inconsistencia.

CREATE TABLE IF NOT EXISTS assets (
    src          TEXT PRIMARY KEY,
    rev          INTEGER NOT NULL DEFAULT 0,
    display_name TEXT    NOT NULL,
    asset_type   TEXT,
    area         TEXT    NOT NULL DEFAULT '',
    parent       TEXT,                      -- jerarquía de activos (self-reference laxa)
    protocol     TEXT,
    body         JSONB,                     -- el objeto `asset` íntegro, para no perder campos
    ingested_at  TIMESTAMPTZ DEFAULT NOW()
);

-- El topic del que vino la definición. Lo necesita el espejo del namespace
-- (GET /api/v1/uns/topics): sin esta columna el plano definitional se materializa
-- pero queda invisible en el árbol del espacio de nombres que lo transportó.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS mqtt_topic TEXT;

CREATE TABLE IF NOT EXISTS asset_tags (
    src          TEXT    NOT NULL,
    field        TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    unit         TEXT    NOT NULL DEFAULT '',
    area         TEXT    NOT NULL DEFAULT '',
    min_limit    DOUBLE PRECISION,
    max_limit    DOUBLE PRECISION,
    is_numeric   BOOLEAN NOT NULL DEFAULT TRUE,
    channel      TEXT,                      -- dat/raw | diag | sts  (§4.0)
    deadband     DOUBLE PRECISION,          -- umbral RBE normativo (§3.5)
    source       JSONB,                     -- procedencia protocolar (registro/NodeId)
    rev          INTEGER,                   -- revisión del `def` que lo escribió
    PRIMARY KEY (src, field)
);

-- Reconcilia despliegues anteriores a v0.4, donde asset_tags nacía en silver.sql
ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS channel  TEXT;
ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS deadband DOUBLE PRECISION;
ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS source   JSONB;
ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS rev      INTEGER;

-- Variables publicadas que ningún `def` declara: viola la Regla 0 del contrato (§11).
-- Debe devolver 0 filas. Es la comprobación que hace verificable el contrato.
-- jsonb_object_keys() se expande con CROSS JOIN LATERAL, no se llama dentro del
-- WHERE: PostgreSQL prohíbe las funciones que devuelven conjuntos en esa posición
-- («set-returning functions are not allowed in WHERE»). Es el mismo patrón que
-- usa v_process_readings en silver.sql.
CREATE OR REPLACE VIEW v_contrato_variables_sin_declarar AS
SELECT DISTINCT r.src, f.field
FROM   sensor_readings r
CROSS JOIN LATERAL jsonb_object_keys(r.payload) AS f(field)
WHERE  NOT EXISTS (
    SELECT 1 FROM asset_tags t
    WHERE t.src = r.src AND t.field = f.field
);
