-- ════════════════════════════════════════════════════════════════════════════
-- BENCHMARK — la medida que justifica ca_kpi_1h (CAPTURA 27 del capítulo 5)
-- ════════════════════════════════════════════════════════════════════════════
-- Produce las DOS capturas: el mismo KPI (OEE de la última hora) calculado por
-- el camino genérico sobre plata (ANTES) y por el agregado continuo (DESPUÉS).
--
-- CÓMO EJECUTAR en pgAdmin: bloque por bloque. Selecciona el texto con el ratón
-- y F5 — pgAdmin ejecuta solo lo seleccionado. Pestaña "Data Output" para el
-- plan; la captura se saca de ahí (o botón Explain > Analyze para el gráfico).
--
-- ⚠ Ejecuta CADA bloque DOS veces y captura la SEGUNDA. La primera paga la
--   caché fría del sistema de ficheros y no mide lo que se quiere comparar.
-- No modifica nada: BLOQUE 1 crea una vista auxiliar de solo lectura y BLOQUE 4
-- la borra.
-- ════════════════════════════════════════════════════════════════════════════


-- ╔═══ BLOQUE 1 — la vista ANTES del CAgg (camino genérico sobre plata) ══════╗
-- Es v_oee_hourly tal y como estaba: misma aritmética, misma salida, pero
-- agregando en vivo desde v_process_readings (CROSS JOIN LATERAL
-- jsonb_object_keys) en lugar de leer ca_kpi_1h.
DROP VIEW IF EXISTS v_oee_hourly_pre_cagg CASCADE;
CREATE VIEW v_oee_hourly_pre_cagg AS
WITH agg AS (
    -- Esto es exactamente lo que hoy tiene materializado el CAgg.
    SELECT
        time_bucket('1 hour', ts) AS hour,
        avg((value = 2)::int::numeric) FILTER (WHERE field = 'line_state') AS running_frac,
        max(value) FILTER (WHERE field = 'good_count') AS good_max,
        min(value) FILTER (WHERE field = 'good_count') AS good_min,
        max(value) FILTER (WHERE field = 'bad_count')  AS bad_max,
        min(value) FILTER (WHERE field = 'bad_count')  AS bad_min
    FROM v_process_readings
    WHERE src = 'plc-llenado-01'
    GROUP BY 1
), b AS (
    SELECT
        hour,
        running_frac                   AS availability,
        (good_max - good_min)::numeric AS good,
        (bad_max - bad_min)::numeric   AS rejected,
        least(1.0, greatest(extract(epoch FROM (now() - hour)) / 3600.0, 0.0))::numeric
            AS bucket_hours
    FROM agg
    WHERE good_max IS NOT NULL AND running_frac IS NOT NULL
), m AS (
    SELECT
        hour, availability, bucket_hours,
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
    (bucket_hours < 1.0)          AS is_partial
FROM m
ORDER BY hour;
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔═══ BLOQUE 2 — CAPTURA "ANTES"  (ejecutar 2 veces, capturar la 2ª) ════════╗
-- Qué buscar en el plan para el pie de figura:
--   · Function Scan on jsonb_object_keys ... loops=NNNNN  ← el nº de desempaquetados
--     del JSON: crece con el histórico. Es LA cifra que explica el coste.
--   · Buffers: shared hit=NNNNN                           ← bloques leídos
--   · Workers Launched: 2                                 ← ocupa 3 núcleos, no 1
--   · Sort Method: si pone `external merge Disk: NN MB`, la ordenación no cupo en
--     RAM (pasa con histórico grande; con pocas horas sale `quicksort Memory`)
--   · Execution Time: ~110 ms con 29 h de histórico; 1.347 ms con 252 h (jul-2026)
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT * FROM v_oee_hourly_pre_cagg ORDER BY hour DESC LIMIT 1;
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔═══ BLOQUE 3 — CAPTURA "DESPUÉS"  (ejecutar 2 veces, capturar la 2ª) ══════╗
-- Qué buscar en el plan:
--   · Scan sobre _hyper_NN_N_chunk (la hypertable materializada del CAgg): pocas
--     decenas de filas en ~0,05 ms — TODO el pasado resuelto ahí
--   · un segundo scan sobre sensor_readings con `Index Cond: ts >= <hora en curso>`:
--     es la real-time aggregation (materialized_only=false). Ese es el grueso del
--     tiempo, y está acotado por 1 hora de datos, NO por el histórico
--   · Buffers: shared hit ~10× menor que en el bloque 2
--   · Execution Time: ~10 ms — y no crece al crecer el pasado
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT * FROM v_oee_hourly ORDER BY hour DESC LIMIT 1;
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔═══ BLOQUE 3B — TABLA RESUMEN: ESTA es la captura ════════════════════════╗
-- Los planes completos son ilegibles en un PDF. Este bloque ejecuta los dos
-- caminos (dos veces cada uno, se queda con la segunda = caché caliente) y
-- extrae sólo las cifras que se comparan. Devuelve DOS FILAS: eso es la figura.
-- Selecciona TODO el bloque y F5. Tarda lo que tarden las 4 ejecuciones.
DROP TABLE IF EXISTS bench_plan;
CREATE TEMP TABLE bench_plan (escenario text, plan text);

DO $$
DECLARE
    q text; e text; linea text; acc text; i int;
BEGIN
    FOREACH q IN ARRAY ARRAY[
        'SELECT * FROM v_oee_hourly_pre_cagg ORDER BY hour DESC LIMIT 1',
        'SELECT * FROM v_oee_hourly          ORDER BY hour DESC LIMIT 1'
    ] LOOP
        e := CASE WHEN q LIKE '%pre_cagg%'
                  THEN 'A. Vista genérica sobre plata (antes)'
                  ELSE 'B. Agregado continuo ca_kpi_1h (después)' END;
        FOR i IN 1..2 LOOP           -- 1ª = caché fría, se descarta
            acc := '';
            FOR linea IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS) ' || q LOOP
                acc := acc || linea || E'\n';
            END LOOP;
        END LOOP;
        INSERT INTO bench_plan VALUES (e, acc);
    END LOOP;
END $$;

SELECT
    escenario                                                              AS "Camino de cálculo",
    round((substring(plan from 'Execution Time: ([0-9.]+) ms'))::numeric, 1)
                                                                           AS "Tiempo (ms)",
    round( (SELECT max((substring(p.plan from 'Execution Time: ([0-9.]+) ms'))::numeric) FROM bench_plan p)
         / (substring(plan from 'Execution Time: ([0-9.]+) ms'))::numeric , 1)
                                                                           AS "Veces más rápido",
    (substring(plan from 'shared hit=([0-9]+)'))::int                      AS "Bloques leídos",
    coalesce((substring(plan from 'jsonb_object_keys[^\n]*loops=([0-9]+)'))::int, 0)
                                                                           AS "Desempaquetados JSON",
    coalesce((substring(plan from 'Workers Launched: ([0-9]+)'))::int, 0) + 1
                                                                           AS "Núcleos ocupados",
    CASE WHEN plan LIKE '%external merge%' THEN 'sí, a disco' ELSE 'no, en RAM' END
                                                                           AS "¿Vuelca ordenación?"
FROM bench_plan
ORDER BY escenario;
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ╔═══ BLOQUE 4 — limpieza ══════════════════════════════════════════════════╗
DROP VIEW IF EXISTS v_oee_hourly_pre_cagg CASCADE;
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ─── OBLIGATORIO para el pie de figura: sobre cuánto histórico se midió ─────
-- El resultado del bloque 2 NO significa nada sin esto: su coste es proporcional
-- al histórico, así que la misma consulta da 110 ms con 29 horas y 1.347 ms con
-- 252. Anota siempre las tres cifras junto a la captura.
--   SELECT count(*) FROM sensor_readings WHERE src = 'plc-llenado-01';
--   SELECT min(ts), max(ts) FROM sensor_readings;
--   SELECT count(*) FROM ca_kpi_1h WHERE src = 'plc-llenado-01';   -- nº de cubetas
