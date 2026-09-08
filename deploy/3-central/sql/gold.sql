-- ════════════════════════════════════════════════════════════════════════════
-- GOLD LAYER — KPIs y agregados de negocio, listos para Grafana
-- ════════════════════════════════════════════════════════════════════════════
-- Depende de DOS cosas, y ambas tienen que existir antes:
--   · la capa silver (v_process_readings, v_device_signals)
--   · el agregado continuo ca_kpi_1h, de continuous_aggregates.sql — lo leen
--     v_production_hourly, v_throughput_1m, v_line_availability_hourly,
--     v_energy_hourly y v_oee_hourly.
-- ORDEN sobre una base limpia:  silver.sql → continuous_aggregates.sql → gold.sql
-- Invertir los dos últimos falla con «relation "ca_kpi_1h" does not exist».
--
-- Re-aplicar silver.sql arrastra estas vistas (hace DROP CASCADE), así que hay
-- que re-aplicar este archivo después. El CAgg no se ve afectado: cuelga de
-- bronce, no de plata.
--
-- Muestreo (contrato UNS v0.3, §3.5 — RBE): las muestras YA NO son uniformes.
-- Cada variable publica al cambiar (deadband) y como mínimo cada 30 s
-- (heartbeat). Implicaciones para estas vistas:
--   · avg() es "promedio de puntos publicados", no promedio ponderado en el
--     tiempo. El heartbeat acota el error: nunca hay más de 30 s sin muestra.
--   · Los contadores (good_count, energy_kwh…) siempre tienen ≥1 muestra por
--     bucket de 1 min gracias al heartbeat → los deltas por bucket funcionan.
--   · Si Node-RED cae, hay buckets vacíos — eso es señal de outage, no de 0.
--
-- Regla anti-dilución (contrato §10.2): TODO KPI vive aquí. Ningún consumidor
-- (Grafana, FastAPI, reportes) calcula KPIs por su cuenta.
--
-- Idempotente: DROP VIEW IF EXISTS ... CASCADE antes de cada CREATE.
-- ¿Por qué CASCADE? Hay vistas que dependen de otras (v_energy_intensity_hourly
-- hace JOIN de v_production_hourly y v_energy_hourly). Sin CASCADE, la SEGUNDA
-- aplicación del archivo falla: PostgreSQL no deja dropear una vista con
-- dependientes. Es seguro porque este archivo RECREA todas las vistas que dropea,
-- y el orden de creación va de dependencias → dependientes.
-- Cuidado al añadir vistas: si algo FUERA de este archivo llegara a depender de
-- una vista gold, CASCADE lo borraría sin recrearlo.
-- ════════════════════════════════════════════════════════════════════════════

-- Tasa nominal de la llenadora: 1200 kg/h ÷ 0.5 kg/botella = 2400 botellas/h.
-- Usada por v_oee_hourly como denominador de performance.

-- ─── Limpieza de vistas v0.2 retiradas (soft-plc / conveyor) ─────────────────
DROP VIEW IF EXISTS v_conveyor_availability_hourly CASCADE;


-- ─── ROLLUP 1 min — tendencia de todas las variables de proceso ──────────────
-- Granularidad cómoda para gráficos de días sin traer cada punto RBE.
-- Grafana: SELECT bucket AS time, avg FROM v_process_1m
--          WHERE src='coriolis-01' AND field='mass_flow_kgh' AND $__timeFilter(bucket)
-- (Es una VISTA: recalcula al leer. Cuando el histórico crezca, se materializa
--  como continuous aggregate de TimescaleDB — ver nota al pie.)
DROP VIEW IF EXISTS v_process_1m CASCADE;
CREATE VIEW v_process_1m AS
SELECT
    time_bucket('1 minute', ts) AS bucket,
    src,
    field,
    avg(value) AS avg,
    min(value) AS min,
    max(value) AS max,
    count(*)   AS n_samples   -- con RBE, la densidad de puntos ES información
FROM v_process_readings
WHERE value IS NOT NULL
GROUP BY 1, 2, 3;


-- ─── KPI — producción en vivo (últimos contadores publicados) ────────────────
-- good_count y bad_count llegan en topics SEPARADOS (v0.3): el último valor
-- de cada uno se toma por campo, no de un mismo mensaje. Sus ts pueden diferir
-- en segundos — irrelevante para un Stat de producción acumulada.
-- Panel Stat en Grafana: SELECT good, rejected, total, reject_pct FROM v_kpi_production_live
DROP VIEW IF EXISTS v_kpi_production_live CASCADE;
CREATE VIEW v_kpi_production_live AS
WITH latest AS (
    SELECT DISTINCT ON (field) field, ts, value
    FROM v_process_readings
    WHERE src = 'plc-llenado-01' AND field IN ('good_count', 'bad_count')
    ORDER BY field, ts DESC
)
SELECT
    max(ts)                                                  AS ts,
    (sum(value) FILTER (WHERE field = 'good_count'))::int    AS good,
    (sum(value) FILTER (WHERE field = 'bad_count'))::int     AS rejected,
    sum(value)::int                                          AS total,
    round((sum(value) FILTER (WHERE field = 'bad_count'))::numeric
          / nullif(sum(value)::numeric, 0) * 100, 2)         AS reject_pct
FROM latest;


-- ─── KPI — producción por hora (delta de contadores en cada cubeta) ──────────
-- produced = botellas nuevas en la hora = max - min del contador en ese bucket.
-- Nota: asume que el contador no se reinicia a mitad de hora (reinicio del
-- simulador → resetea a 0 → el delta de esa hora queda inflado; ver README).
-- Lee del CAgg ca_kpi_1h (ver continuous_aggregates.sql): la agregación ya
-- está materializada, aquí solo queda la aritmética sobre ~252 filas.
-- CASCADE: v_energy_intensity_hourly depende de esta vista. Se recrea abajo.
DROP VIEW IF EXISTS v_production_hourly CASCADE;
CREATE VIEW v_production_hourly AS
SELECT
    hour,
    ((good_max - good_min) + (bad_max - bad_min))::int AS produced,
    (good_max - good_min)::int                         AS good,
    (bad_max - bad_min)::int                           AS rejected,
    round((good_max - good_min)::numeric
          / nullif(((good_max - good_min) + (bad_max - bad_min))::numeric, 0) * 100, 2) AS quality_pct
FROM ca_kpi_1h
WHERE src = 'plc-llenado-01'
  AND good_max IS NOT NULL   -- preserva la semántica del INNER JOIN anterior
ORDER BY hour;


-- ─── KPI — throughput real (botellas/hora) derivado de los contadores ────────
-- Delta del contador normalizado por el tiempo REAL entre buckets: si el edge
-- estuvo caído N minutos, el delta acumulado se reparte en ese lapso en vez de
-- inflarse en un solo minuto. greatest(...,0) ignora reinicios del contador
-- (delta negativo → 0). El heartbeat garantiza ≥1 muestra/min con el edge vivo.
DROP VIEW IF EXISTS v_throughput_1m CASCADE;
CREATE VIEW v_throughput_1m AS
WITH per_min AS (
    SELECT
        time_bucket('1 minute', ts) AS bucket,
        max(value) FILTER (WHERE field = 'good_count')
          + max(value) FILTER (WHERE field = 'bad_count') AS total
    FROM v_process_readings
    WHERE src = 'plc-llenado-01' AND field IN ('good_count', 'bad_count')
    GROUP BY 1
)
SELECT
    bucket AS ts,
    round(greatest(total - lag(total) OVER (ORDER BY bucket), 0)::numeric
          / greatest(extract(epoch FROM bucket - lag(bucket) OVER (ORDER BY bucket)) / 60, 1)
          * 60, 0) AS bph
FROM per_min;


-- ─── KPI — disponibilidad de la línea por hora ───────────────────────────────
-- line_state: 0=STOPPED 1=STARTING 2=RUNNING 3=FAULT (contrato §7.4.1).
-- availability = fracción de muestras en RUNNING. Válido bajo RBE porque el
-- heartbeat de 30 s acota el espaciado de muestras (~time-weighted con error
-- ≤30 s por transición; las transiciones publican inmediato).
-- Las fracciones ya vienen calculadas del CAgg; aquí solo se pasan a %.
DROP VIEW IF EXISTS v_line_availability_hourly CASCADE;
CREATE VIEW v_line_availability_hourly AS
SELECT
    hour,
    round(running_frac * 100, 1) AS availability_pct,
    round(fault_frac * 100, 1)   AS fault_pct,
    round(stopped_frac * 100, 1) AS stopped_pct,
    state_samples                AS muestras
FROM ca_kpi_1h
WHERE src = 'plc-llenado-01' AND state_samples > 0
ORDER BY hour;


-- ─── KPI — energía de la celda por hora ──────────────────────────────────────
-- kwh = delta del acumulador energy_kwh (medidor real: nunca se resetea salvo
-- reinicio del simulador). avg/max de potencia activa para dimensionamiento.
-- Lee del CAgg ca_kpi_1h (ver continuous_aggregates.sql).
-- CASCADE: v_energy_intensity_hourly depende de esta vista. Se recrea abajo.
DROP VIEW IF EXISTS v_energy_hourly CASCADE;
CREATE VIEW v_energy_hourly AS
SELECT
    hour,
    round((energy_max - energy_min)::numeric, 3) AS kwh,
    round(power_avg::numeric, 0)                 AS avg_power_w,
    round(power_max::numeric, 0)                 AS max_power_w
FROM ca_kpi_1h
WHERE src = 'medidor-02' AND energy_max IS NOT NULL
ORDER BY hour;


-- ─── KPI — intensidad energética (Wh por botella producida) ──────────────────
-- Cruza energía y producción del mismo bucket horario. Sube cuando la celda
-- consume en vacío (paradas, fallas) — el argumento de eficiencia del demo.
DROP VIEW IF EXISTS v_energy_intensity_hourly CASCADE;
CREATE VIEW v_energy_intensity_hourly AS
SELECT
    e.hour,
    round(e.kwh * 1000 / nullif(p.produced, 0), 1) AS wh_per_bottle
FROM v_energy_hourly e
JOIN v_production_hourly p USING (hour);


-- ─── KPI — OEE por hora (disponibilidad × calidad × performance) ─────────────
-- availability = fracción del tiempo en RUNNING (line_state = 2)
-- quality      = good / (good + rejected) del delta horario
-- performance  = producido real / teórico (2400 bph nominal × tiempo RUNNING)
-- El speed_factor del PLC camina entre 0.85-1.0 → performance realista <100%.
--
-- CUBETA EN CURSO (bucket_hours): la hora actual está incompleta — a las 11:15
-- solo lleva 15 min de producción. Sin normalizar, el divisor asume 60 min y
-- performance sale a ~25% de lo real, hundiendo el OEE en CADA dashboard y
-- reporte. bucket_hours vale 1.0 en horas cerradas (least la topa) y la fracción
-- transcurrida en la hora en curso. Mismo principio que v_throughput_1m.
--
-- Los componentes se calculan UNA vez en la CTE 'm' y se reusan: antes la
-- fórmula de performance estaba duplicada (en performance_pct y dentro de
-- oee_pct), así que cualquier corrección había que hacerla en dos sitios.
-- Todo sale ya agregado del CAgg ca_kpi_1h: disponibilidad y contadores
-- vienen de la misma fila, así que desaparece el JOIN avail⋈prod de antes.
-- `now()` NO puede vivir en un CAgg (es volátil): por eso bucket_hours se
-- calcula aquí, en la vista. La capa de arriba hace la lógica; el CAgg, el peso.
DROP VIEW IF EXISTS v_oee_hourly CASCADE;
CREATE VIEW v_oee_hourly AS
WITH b AS (
    -- Mide cuánta hora lleva la cubeta.
    -- least(1.0, …) → horas cerradas valen 1.0; greatest(…, 0.0) protege de un
    -- ts futuro por desfase de reloj (bucket_hours nunca sale negativo).
    SELECT
        hour,
        running_frac                   AS availability,
        (good_max - good_min)::numeric AS good,
        (bad_max - bad_min)::numeric   AS rejected,
        least(1.0, greatest(extract(epoch FROM (now() - hour)) / 3600.0, 0.0))::numeric
            AS bucket_hours
    FROM ca_kpi_1h
    WHERE src = 'plc-llenado-01'
      AND good_max IS NOT NULL AND running_frac IS NOT NULL  -- = el INNER JOIN de antes
), m AS (
    -- Componentes en fracción 0-1, cada uno calculado una sola vez.
    SELECT
        hour,
        availability,
        bucket_hours,
        good / nullif(good + rejected, 0) AS quality,
        (good + rejected) / nullif(availability * 2400 * bucket_hours, 0) AS performance
    FROM b
)
SELECT
    hour,
    round(availability * 100, 1)  AS availability_pct,
    round(quality * 100, 1)       AS quality_pct,
    round(performance * 100, 1)   AS performance_pct,
    round(availability * coalesce(quality, 0) * coalesce(performance, 0) * 100, 1) AS oee_pct,
    (bucket_hours < 1.0)          AS is_partial   -- TRUE = hora en curso, aún incompleta
FROM m
ORDER BY hour;


-- ═══════════════════════════════════════════════════════════════════════════
-- CATÁLOGO DE KPIs — registro único que alimenta la API y el write-back
-- ═══════════════════════════════════════════════════════════════════════════
-- Una fila por KPI: enlaza nombre ↔ vista gold ↔ tópico MQTT (contrato API §4).
-- Lo leen DOS servicios:
--   · la API      → sirve GET /api/v1/kpi/{name} leyendo view_name
--   · write-back  → publica view_name al topic (_kpi/*) en EMQX (retained)
-- Config-como-datos, igual que asset_tags: añadir un KPI = crear su vista arriba
-- + insertar una fila aquí. Cero código en la API ni en el write-back.
-- El topic sigue §2.3 del contrato UNS (namespace reservado '_' para calculados).
--
-- Es TABLA (no vista): CREATE IF NOT EXISTS + INSERT ON CONFLICT DO NOTHING la
-- hacen idempotente y preservan ediciones manuales al re-aplicar gold.sql.
CREATE TABLE IF NOT EXISTS kpi_catalog (
    name         TEXT PRIMARY KEY,             -- 'oee' (== hoja del tópico, por convención)
    view_name    TEXT NOT NULL,                -- vista gold donde vive la lógica
    topic        TEXT NOT NULL,                -- destino del write-back en el UNS
    derived_from TEXT NOT NULL DEFAULT '',     -- src origen (contrato §4.1.b); varios = separados por coma
    time_column  TEXT NOT NULL DEFAULT 'hour', -- columna temporal de la vista (filtros from/to)
    unit         TEXT NOT NULL DEFAULT '',     -- unidad titular del KPI (la usa la API en meta)
    -- Mapa campo → unidad para el write-back. Mismo rol que asset_tags para el dato
    -- crudo: asset_tags mapea (src,field)→unidad; esto mapea (kpi,field)→unidad.
    -- SUS CLAVES DEFINEN QUÉ CAMPOS SE PUBLICAN al UNS — lo que no esté aquí no sale
    -- (ej. 'muestras' es un conteo interno que al SCADA no le sirve).
    units        JSONB NOT NULL DEFAULT '{}'::jsonb,
    description  TEXT NOT NULL DEFAULT '',
    publish      BOOLEAN NOT NULL DEFAULT TRUE, -- ¿el write-back lo publica a MQTT?
    enabled      BOOLEAN NOT NULL DEFAULT TRUE  -- desactivar sin borrar la fila
);

-- Reconcilia catálogos creados antes de v0.3.2 (les faltan estas columnas)
ALTER TABLE kpi_catalog ADD COLUMN IF NOT EXISTS derived_from TEXT NOT NULL DEFAULT '';
ALTER TABLE kpi_catalog ADD COLUMN IF NOT EXISTS units JSONB NOT NULL DEFAULT '{}'::jsonb;

-- El tópico se ancla al NIVEL DE LÍNEA, no al sitio: un KPI como el OEE pertenece a
-- una línea concreta, no a la planta entera. Así la línea 2 publica su propio
-- 'greytec/demo/produccion/linea2/_kpi/oee' sin colisionar, y ambos son comparables.
-- (§2.3 del contrato UNS permite el namespace reservado '_' en cualquier nivel.)
INSERT INTO kpi_catalog (name, view_name, topic, derived_from, time_column, unit, units, description) VALUES
('production',       'v_production_hourly',        'greytec/demo/produccion/llenado/_kpi/production',       'plc-llenado-01',            'hour', 'botellas',
    '{"produced":"botellas","good":"botellas","rejected":"botellas","quality_pct":"%"}',
    'Producción por hora (buenas/rechazadas/calidad)'),
('oee',              'v_oee_hourly',               'greytec/demo/produccion/llenado/_kpi/oee',              'plc-llenado-01',            'hour', '%',
    '{"availability_pct":"%","quality_pct":"%","performance_pct":"%","oee_pct":"%"}',
    'OEE horario y sus componentes (disponibilidad×calidad×performance)'),
('availability',     'v_line_availability_hourly', 'greytec/demo/produccion/llenado/_kpi/availability',     'plc-llenado-01',            'hour', '%',
    '{"availability_pct":"%","fault_pct":"%","stopped_pct":"%"}',
    'Disponibilidad de línea por hora (fracción en RUNNING)'),
('energy',           'v_energy_hourly',            'greytec/demo/produccion/llenado/_kpi/energy',           'medidor-02',                'hour', 'kWh',
    '{"kwh":"kWh","avg_power_w":"W","max_power_w":"W"}',
    'Energía por hora + potencia media/máx'),
('energy_intensity', 'v_energy_intensity_hourly',  'greytec/demo/produccion/llenado/_kpi/energy_intensity', 'medidor-02,plc-llenado-01', 'hour', 'Wh/botella',
    '{"wh_per_bottle":"Wh/botella"}',
    'Intensidad energética (Wh por botella producida)')
ON CONFLICT (name) DO NOTHING;

-- Reconcilia el mapa de unidades en filas sembradas antes de v0.3.2
UPDATE kpi_catalog SET units = '{"produced":"botellas","good":"botellas","rejected":"botellas","quality_pct":"%"}'      WHERE name='production'       AND units = '{}'::jsonb;
UPDATE kpi_catalog SET units = '{"availability_pct":"%","quality_pct":"%","performance_pct":"%","oee_pct":"%"}'         WHERE name='oee'              AND units = '{}'::jsonb;
UPDATE kpi_catalog SET units = '{"availability_pct":"%","fault_pct":"%","stopped_pct":"%"}'                             WHERE name='availability'     AND units = '{}'::jsonb;
UPDATE kpi_catalog SET units = '{"kwh":"kWh","avg_power_w":"W","max_power_w":"W"}'                                      WHERE name='energy'           AND units = '{}'::jsonb;
UPDATE kpi_catalog SET units = '{"wh_per_bottle":"Wh/botella"}'                                                          WHERE name='energy_intensity' AND units = '{}'::jsonb;

-- Los tópicos v0.3.2 se movieron de nivel sitio → nivel línea. Reconcilia filas ya
-- sembradas con el tópico viejo (el ON CONFLICT de arriba no actualiza existentes).
UPDATE kpi_catalog SET topic = replace(topic, 'greytec/demo/_kpi/', 'greytec/demo/produccion/llenado/_kpi/')
WHERE topic LIKE 'greytec/demo/_kpi/%';
UPDATE kpi_catalog SET derived_from = 'plc-llenado-01'            WHERE name IN ('production','oee','availability') AND derived_from = '';
UPDATE kpi_catalog SET derived_from = 'medidor-02'                WHERE name = 'energy'            AND derived_from = '';
UPDATE kpi_catalog SET derived_from = 'medidor-02,plc-llenado-01' WHERE name = 'energy_intensity' AND derived_from = '';


-- ═══════════════════════════════════════════════════════════════════════════
-- NOTA — dos caminos, a propósito
-- ═══════════════════════════════════════════════════════════════════════════
-- Los 5 KPIs del catálogo leen de CAggs materializados (continuous_aggregates.sql):
-- son CONSULTAS CONOCIDAS — te comprometiste con ellas al registrarlas. Bajar sus
-- campos al CAgg no pierde genericidad porque el KPI ya los nombraba (v_oee_hourly
-- siempre supo que existe 'good_count'). 1.347 ms → ~5 ms, y deja de crecer.
--
-- Las vistas de ABAJO (v_process_1m, v_kpi_production_live, v_throughput_1m) siguen
-- leyendo de v_process_readings (LATERAL, genérico, lento). Es deliberado: sirven
-- consultas AD-HOC y exploración, donde los campos no se conocen de antemano y un
-- campo nuevo debe aparecer solo. Las consulta un humano desde Grafana — que espere
-- 1 s no es problema; lo que no escalaba era un proceso preguntando cada 30 s.
--
-- Misma lógica que indexar las consultas que sabes que vas a correr, y no todas
-- las columnas por si acaso. Si alguna de estas tres pasa a consultarse en bucle,
-- toca darle su CAgg (y necesitaría uno de 1 minuto, no de 1 hora).
--
-- Bronze (sensor_readings) no se toca: sigue aterrizando el JSONB crudo tal como
-- llegó. El CAgg es una materialización de silver, no una violación del medallón.


-- ═══════════════════════════════════════════════════════════════════════════
-- PARÁMETROS DE NEGOCIO — el tercer catálogo (2026-07-17)
-- ═══════════════════════════════════════════════════════════════════════════
-- asset_tags dice qué SIGNIFICA cada señal; kpi_catalog dice qué KPIs EXISTEN;
-- business_params dice qué VALE el negocio. Los tres son config-como-datos y
-- los tres son la interfaz con los sistemas del cliente: hoy estas filas las
-- edita la consola admin (Familia 4); en un cliente real, un conector las
-- sincroniza desde su ERP escribiendo esta MISMA tabla. La plataforma no
-- distingue quién escribe — ese es el punto.
--
-- Viven en la base y no en un .env porque las FÓRMULAS que los usan viven en
-- SQL (regla anti-dilución): una vista no puede leer variables de entorno. Y
-- porque lo que está en una tabla se cambia en caliente desde la consola —
-- configurar no es desplegar.
CREATE TABLE IF NOT EXISTS business_params (
    param       TEXT PRIMARY KEY,           -- 'tarifa_kwh'
    value       NUMERIC NOT NULL,
    unit        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    -- Todo número de dinero se defiende con sus supuestos: el PDF imprime
    -- "calculado con parámetros al <updated_at>". Sin esta columna, un costo
    -- en una reunión es un número que nadie puede respaldar.
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semillas del demo — genéricas y defendibles, NO precios de ningún cliente.
-- ON CONFLICT DO NOTHING: lo que el admin edite en la consola sobrevive a
-- re-aplicar este archivo.
-- Descripciones CORTAS a propósito: se pintan en el panel "Parámetros
-- aplicados" de la web — son texto de cara al gerente, no documentación
-- interna (esa va en estos comentarios).
INSERT INTO business_params (param, value, unit, description) VALUES
('tarifa_kwh',       0.10, '$/kWh',         'Tarifa eléctrica'),
('margen_botella',   0.08, '$/botella',     'Margen por botella buena'),
('costo_rechazo',    0.12, '$/botella',     'Costo por botella rechazada'),
('meta_diaria',      40000, 'botellas/día', 'Meta de producción diaria'),
('tasa_nominal_bph', 2400, 'botellas/hora', 'Capacidad nominal de la línea')
ON CONFLICT (param) DO NOTHING;


-- ─── KPI — económico por hora ────────────────────────────────────────────────
-- Producción y energía × parámetros de negocio. Un producto por ahora: la
-- celda simula un solo SKU; el día que haya dos, esta vista gana la dimensión
-- producto — y solo esta vista, ni la API ni el front cambian (catálogo).
--
-- costo_paradas_usd es MARGEN NO GANADO (costo de oportunidad), no dinero
-- gastado: margen × botellas que la tasa nominal habría producido en el tiempo
-- no disponible. Por eso el reporte lo lista aparte y no lo resta de nada.
-- bucket_hours normaliza la hora en curso, igual que en v_oee_hourly.
DROP VIEW IF EXISTS v_business_hourly CASCADE;
CREATE VIEW v_business_hourly AS
WITH p AS (
    SELECT
        max(value) FILTER (WHERE param = 'tarifa_kwh')       AS tarifa_kwh,
        max(value) FILTER (WHERE param = 'margen_botella')   AS margen,
        max(value) FILTER (WHERE param = 'costo_rechazo')    AS costo_rechazo,
        max(value) FILTER (WHERE param = 'tasa_nominal_bph') AS tasa_nominal
    FROM business_params
)
SELECT
    pr.hour,
    round(pr.good * p.margen, 2)                       AS margen_usd,
    round(coalesce(e.kwh, 0) * p.tarifa_kwh, 2)        AS costo_energia_usd,
    round(pr.rejected * p.costo_rechazo, 2)            AS costo_rechazos_usd,
    round((1 - coalesce(a.availability_pct, 100) / 100.0)
          * p.tasa_nominal * p.margen
          * least(1.0, greatest(extract(epoch FROM (now() - pr.hour)) / 3600.0, 0.0))::numeric,
          2)                                           AS costo_paradas_usd
FROM v_production_hourly pr
CROSS JOIN p
LEFT JOIN v_energy_hourly e USING (hour)
LEFT JOIN v_line_availability_hourly a USING (hour)
ORDER BY pr.hour;

-- Registro en el catálogo. publish=FALSE a propósito: los márgenes no pintan
-- nada en el broker de planta (el SCADA no necesita precios, y es información
-- sensible). Sirve por API (web, PDF, BI); si un día debe salir al UNS, es
-- girar este flag desde la consola.
INSERT INTO kpi_catalog (name, view_name, topic, derived_from, time_column, unit, units, description, publish) VALUES
('business', 'v_business_hourly', 'greytec/demo/produccion/llenado/_kpi/business', 'plc-llenado-01,medidor-02', 'hour', 'USD',
    '{"margen_usd":"USD","costo_energia_usd":"USD","costo_rechazos_usd":"USD","costo_paradas_usd":"USD"}',
    'Económico por hora — margen y costos (energía, rechazos, paradas) según business_params', FALSE)
ON CONFLICT (name) DO NOTHING;
