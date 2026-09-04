-- ════════════════════════════════════════════════════════════════════════════
-- CONTINUOUS AGGREGATE — rollup horario materializado que alimenta los KPIs
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA QUE RESUELVE (medido 2026-07-16):
--   SELECT * FROM v_oee_hourly ORDER BY hour DESC LIMIT 1  →  1.347 ms
--   El plan: 700.000 desempaquetados de jsonb_object_keys + sort de 16 MB a
--   DISCO (×3 workers) para producir 252 filas... y usar UNA. Cada 30 s, ×5 KPIs
--   = 22% de un núcleo permanente, creciendo lineal (a 30M filas ≈ 13 s/query →
--   el write-back deja de dar abasto en ~3 meses).
--
-- QUÉ ES UN CAgg:
--   Una TABLA que TimescaleDB mantiene sola. Guarda el rollup ya calculado; un
--   job en background actualiza SOLO las cubetas afectadas por el dato nuevo —
--   nunca recalcula el pasado. Es la diferencia entre recalcular tu saldo
--   sumando todos los movimientos desde 1990, o tenerlo guardado y sumarle el
--   último. 1.347 ms → ~5 ms, y deja de crecer con el histórico.
--
-- POR QUÉ AQUÍ Y NO SOBRE silver:
--   Un CAgg no admite LATERAL, así que no puede construirse sobre
--   v_process_readings (que usa CROSS JOIN LATERAL jsonb_object_keys). Se define
--   DIRECTAMENTE sobre la hypertable. Esto NO pierde genericidad: los KPIs ya
--   nombraban sus campos explícitamente (v_oee_hourly ya hardcodea 'good_count').
--   El camino genérico y lento (v_process_readings) sigue intacto para
--   exploración y la Familia 1 de la API, donde las consultas son desconocidas.
--
-- POR QUÉ FUNCIONA SIN LATERAL:
--   Con v0.3 (un tópico por variable), cada fila lleva UN solo campo en payload.
--   Los agregados IGNORAN los NULL, así que avg/max/min por campo salen solos:
--   una fila de 'good_count' aporta NULL a la columna de 'line_state' y se ignora.
--
-- ─── POR QUÉ UN SOLO CAgg AGRUPADO POR src (y no uno por dispositivo) ────────
--   Un CAgg por dispositivo no escala: línea 2 = 4 equipos = 4 CAggs nuevos;
--   10 líneas = 40 objetos que mantener. Agrupando por (hour, src) en UNO solo:
--     · Un dispositivo nuevo que publique campos YA conocidos (otra llenadora
--       con su line_state/good_count) aparece SOLO, sin tocar este archivo.
--     · Solo se edita si un KPI nuevo necesita un campo que aún no está aquí.
--   Coste: tabla ancha y dispersa — una fila de PLC deja en NULL las columnas de
--   energía y viceversa. Da igual: son ~250 filas × nº de dispositivos, y los
--   NULL no ocupan prácticamente nada.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ CÓMO EJECUTAR ESTE ARCHIVO — NO lo pegues entero de una vez ⚠⚠
--
--   refresh_continuous_aggregate() es un PROCEDURE, y PostgreSQL prohíbe CALL
--   dentro de un bloque de transacción. El detalle traicionero: **PostgreSQL
--   envuelve en una transacción IMPLÍCITA cualquier script multi-statement
--   enviado de una sola vez**. O sea que pegar el archivo completo en pgAdmin
--   falla con "cannot run inside a transaction block" AUNQUE no escribas BEGIN —
--   la transacción la pone el protocolo, no tú.
--
--   PROCEDIMIENTO en pgAdmin (Query Tool): ejecuta CADA BLOQUE por separado.
--   Selecciona el texto del bloque con el ratón y pulsa F5 — pgAdmin ejecuta
--   solo lo seleccionado. El bloque 3 (el CALL) va OBLIGATORIAMENTE solo.
--
--   Nunca envolver en BEGIN/COMMIT. Es seguro igual: este archivo solo AÑADE
--   objetos nuevos — nada de lo que hoy funciona depende de ellos todavía.
-- ════════════════════════════════════════════════════════════════════════════


-- ╔═════════ BLOQUE 0 — solo si vienes de la versión de 2 CAggs ═════════════╗
-- Los CAggs ca_llenado_1h / ca_medidor_1h quedaron obsoletos: agrupaban por
-- dispositivo pero se llamaban como la línea (y la línea llenado tiene CUATRO
-- equipos: plc-llenado-01, coriolis-01, valvula-01, medidor-02). Los reemplaza
-- ca_kpi_1h. Si nunca los creaste, salta este bloque.
DROP MATERIALIZED VIEW IF EXISTS ca_llenado_1h CASCADE;
DROP MATERIALIZED VIEW IF EXISTS ca_medidor_1h CASCADE;
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔═══════════════════════════ BLOQUE 1 ═════════════════════════════════════╗
-- Rollup horario POR DISPOSITIVO de los campos que consumen los KPIs.
-- Sin WHERE: cualquier src entra. Los equipos que no publiquen un campo dejan
-- esa columna en NULL y las vistas gold los filtran por src.
--
-- materialized_only = false → REAL-TIME AGGREGATION: al consultar, TimescaleDB
-- une lo ya materializado + el crudo de la cubeta en curso. Sin esto, la hora
-- actual NO aparecería hasta materializarse y el SCADA vería la hora anterior.
CREATE MATERIALIZED VIEW IF NOT EXISTS ca_kpi_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket('1 hour', ts) AS hour,
    src,
    -- ── Estado de línea (0=STOPPED 1=STARTING 2=RUNNING 3=FAULT) → OEE, disponibilidad
    avg(((( payload->'line_state'->>'v')::float) = 2)::int::numeric) AS running_frac,
    avg(((( payload->'line_state'->>'v')::float) = 3)::int::numeric) AS fault_frac,
    avg(((( payload->'line_state'->>'v')::float) = 0)::int::numeric) AS stopped_frac,
    count(payload->'line_state'->>'v')                               AS state_samples,
    -- ── Contadores acumulativos → producción (max-min por cubeta = la hora)
    max((payload->'good_count'->>'v')::float) AS good_max,
    min((payload->'good_count'->>'v')::float) AS good_min,
    max((payload->'bad_count'->>'v')::float)  AS bad_max,
    min((payload->'bad_count'->>'v')::float)  AS bad_min,
    -- ── Energía → consumo horario e intensidad energética
    max((payload->'energy_kwh'->>'v')::float)     AS energy_max,
    min((payload->'energy_kwh'->>'v')::float)     AS energy_min,
    avg((payload->'active_power_w'->>'v')::float) AS power_avg,
    max((payload->'active_power_w'->>'v')::float) AS power_max
FROM sensor_readings
GROUP BY 1, 2
WITH NO DATA;   -- se materializa en el bloque 3, controladamente
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔══════════ BLOQUE 2 — SOLO esta línea, nada más seleccionado ═════════════╗
-- Carga inicial. Recorre todo el histórico: tarda ~1-2 min con 3M filas.
-- Debe ir SOLA: cualquier otra sentencia junto a un CALL = error 25001.
--
-- ⚠ El segundo argumento es `now() - 1 hour`, NO NULL. Con NULL se materializa
--   TAMBIÉN la cubeta en curso y el watermark se empuja más allá de ella → esa
--   hora queda CONGELADA en el valor del momento del refresh, y la real-time
--   aggregation deja de aplicarle (solo actúa por encima del watermark). El
--   SCADA vería la hora actual estancada hasta que la política la refresque.
--   Dejando el último tramo sin materializar, la hora en curso se calcula al
--   vuelo desde ~1h de crudo: siempre fresca y de todos modos en milisegundos.
CALL refresh_continuous_aggregate('ca_kpi_1h', NULL, now() - INTERVAL '1 hour');
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔═══════════════════════════ BLOQUE 3 ═════════════════════════════════════╗
-- ─── Política de refresco automático ────────────────────────────────────────
-- start_offset 6h  → recalcula las últimas 6 horas (absorbe dato que llegue tarde
--                     tras un corte del edge: el store-and-forward de NanoMQ)
-- end_offset   1h  → NO materializa la cubeta en curso; esa la resuelve la
--                     real-time aggregation leyendo solo ~1h de crudo (~1.500
--                     filas en vez de 700.000). De ahí salen los ~5 ms.
-- schedule 30 min  → con qué frecuencia corre el job en background
SELECT add_continuous_aggregate_policy('ca_kpi_1h',
    start_offset      => INTERVAL '6 hours',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists     => TRUE);
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ─── Verificación ───────────────────────────────────────────────────────────
-- 1) ¿Qué dispositivos entraron y con cuántas cubetas?
--    SELECT src, count(*) AS cubetas, max(hour) FROM ca_kpi_1h GROUP BY src;
--    Sano: plc-llenado-01 y medidor-02 con ~252 cubetas. Los que no publican
--    ninguno de estos campos (coriolis-01, valvula-01, iot2050) también salen,
--    con todas las columnas en NULL — inofensivo, las vistas los filtran.
--
-- 2) ¿Aparece la hora EN CURSO?  Prueba de que real-time aggregation funciona:
--    SELECT max(hour) FROM ca_kpi_1h;   -- debe ser la hora actual, no la anterior
--
-- 3) ¿Está activa la política?
--    SELECT view_name, schedule_interval FROM timescaledb_information.jobs
--    WHERE proc_name = 'policy_refresh_continuous_aggregate';
--
-- ─── AÑADIR UNA LÍNEA NUEVA ─────────────────────────────────────────────────
-- Si la línea 2 usa los mismos tipos de equipo, publica los MISMOS nombres de
-- campo → aparece sola en este CAgg, sin tocar este archivo. Solo hace falta:
--   1. una vista gold con su WHERE src = 'plc-linea2'  (en gold.sql)
--   2. una fila en kpi_catalog con su topic .../produccion/linea2/_kpi/oee
-- Este archivo solo se edita si un KPI necesita un CAMPO que aún no está arriba.
