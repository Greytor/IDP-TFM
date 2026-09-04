-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — valida el pipeline completo en TimescaleDB (bronze→silver→gold)
-- ════════════════════════════════════════════════════════════════════════════
-- Correr en pgAdmin (sección por sección) o:
--   docker exec -i greytec-timescaledb psql -U <USER> -d <DB> < smoke_test.sql
-- No modifica nada (solo SELECT). Cada bloque indica qué resultado es "sano".
--
-- Muestreo (contrato v0.3, RBE §3.5): la tasa por variable YA NO es fija.
-- Mínimo garantizado: 1 msg/variable cada 30 s (heartbeat) = ~2/min.
-- Máximo típico: 1 msg/variable/s (tasa de poll del edge) durante actividad.
-- ════════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════ 1. BRONZE — ¿llega el dato? ═══════════════════════╗

-- 1.1 Conteo por tabla. Sano: las 3 con filas > 0.
SELECT 'sensor_readings' AS tabla, count(*) FROM sensor_readings
UNION ALL SELECT 'device_status', count(*) FROM device_status
UNION ALL SELECT 'alerts',        count(*) FROM alerts;

-- 1.2 Frescura: ¿sigue fluyendo? Sano: antiguedad < ~35 s por src activo
--     (30 s de heartbeat + margen). Deben aparecer los 4 de la celda:
--     plc-llenado-01, coriolis-01, valvula-01, medidor-02 (+ iot2050 si activo).
SELECT src, max(ts) AS ultima, now() - max(ts) AS antiguedad
FROM sensor_readings
GROUP BY src
ORDER BY src;

-- 1.3 Tasa de ingestión (últimos 5 min) por dispositivo. Con RBE la tasa varía
--     con la actividad del proceso. Sano por src: entre ~10 (todo estable,
--     solo heartbeats) y ~300 (línea arrancando, todo cambiando).
SELECT src, count(*) AS msgs_5min
FROM sensor_readings
WHERE ts > now() - interval '5 minutes'
GROUP BY src
ORDER BY src;

-- 1.4 Densidad de publicación por variable (últimos 15 min) — el RBE en acción.
--     Informativo: active_power_w debe estar entre las más densas (compresor),
--     voltage_v y frequency_hz entre las más ralas (deadband alto vs ruido).
SELECT r.src, f.field, count(*) AS msgs_15min
FROM sensor_readings r
CROSS JOIN LATERAL jsonb_object_keys(r.payload) AS f(field)
WHERE r.ts > now() - interval '15 minutes'
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 20;


-- ╔════════════════════ 2. CALIDAD — ¿se pierde algo? ════════════════════════╗

-- 2.1 Huecos de secuencia en dat/raw (mensajes perdidos). seq es POR DISPOSITIVO
--     a través de todas sus variables (contrato §3.4) — se filtra dat/raw porque
--     el diag no lleva seq (queda en 0).
--     Sano: 0 filas. diff>1 = hueco; el reinicio del edge resetea seq (diff<0,
--     no aparece aquí, no es pérdida).
SELECT src, seq AS desde, seq + diff AS hasta, diff - 1 AS faltantes
FROM (
    SELECT src, seq,
           lead(seq) OVER (PARTITION BY src ORDER BY seq) - seq AS diff
    FROM sensor_readings
    WHERE mqtt_topic LIKE '%/dat/raw%'
) s
WHERE diff > 1
ORDER BY src, desde;

-- 2.2 Calidad de las lecturas. Sano: mayoría 'good'. 'uncertain' es NORMAL en
--     ráfagas: aire arrastrado en arranques (coriolis) y caídas del enlace PLC.
--     'bad' sostenido o 'uncertain' permanente = investigar.
--     quality NULL = campos del diag plano (no llevan q por diseño, §4.6).
SELECT quality, count(*) FROM v_process_readings GROUP BY quality;

-- 2.3 Campos que LLEGAN pero NO están en asset_tags (no se verán en silver).
--     Sano: 0 filas. Si aparece algo, agrégalo al diccionario en silver.sql.
SELECT DISTINCT r.src, f.field
FROM sensor_readings r
CROSS JOIN LATERAL jsonb_object_keys(r.payload) AS f(field)
LEFT JOIN asset_tags t ON t.src = r.src AND t.field = f.field
WHERE t.field IS NULL
ORDER BY r.src, f.field;

-- 2.4 Tags en asset_tags SIN datos (typo en el diccionario o dispositivo
--     inactivo). Informativo: no debe haber filas de dispositivos retirados (
--     en v0.3; se conservan por el histórico).
SELECT t.src, t.field
FROM asset_tags t
WHERE NOT EXISTS (
    SELECT 1 FROM sensor_readings r
    WHERE r.src = t.src AND r.payload ? t.field
)
ORDER BY t.src, t.field;


-- ╔══════════════════════ 3. SILVER — ¿se interpreta? ════════════════════════╗

-- 3.1 Última lectura de cada variable de la celda, con nombres y límites.
SELECT DISTINCT ON (src, field)
       src, field, display_name, value, value_text, quality, unit, area
FROM v_process_readings
WHERE src IN ('plc-llenado-01', 'coriolis-01', 'valvula-01', 'medidor-02')
ORDER BY src, field, ts DESC;

-- 3.2 Valores fuera de rango operativo ahora mismo. Informativo — drive_gain_pct
--     fuera de rango (>40) = episodio de aire arrastrado: el insight NOA.
SELECT ts, src, display_name, value, unit, min_limit, max_limit
FROM v_process_readings
WHERE value > max_limit OR value < min_limit
ORDER BY ts DESC
LIMIT 20;

-- 3.3 Estado (sts) de los 4 dispositivos de la celda.
SELECT src, ts, state
FROM v_device_status_latest
WHERE src IN ('plc-llenado-01', 'coriolis-01', 'valvula-01', 'medidor-02')
ORDER BY src;

-- 3.4 Salud del coriolis (diag NOA, payload plano → quality NULL es correcto).
SELECT ts, field, value, value_text
FROM v_process_readings
WHERE src = 'coriolis-01' AND area = 'Salud instrumento'
ORDER BY ts DESC
LIMIT 10;


-- ╔════════════════════════ 4. GOLD — ¿KPIs coherentes? ══════════════════════╗

-- 4.1 Producción en vivo. Sano: total = good + rejected; reject_pct 1-4%
--     (sube durante episodios de calidad del simulador).
SELECT * FROM v_kpi_production_live;

-- 4.2 Disponibilidad de la línea por hora. Sano: 0-100%, suma de los tres
--     estados ≈ 100% (falta STARTING); muestras ≥ 120/hora (heartbeat 30s).
SELECT * FROM v_line_availability_hourly ORDER BY hour DESC LIMIT 5;

-- 4.3 Producción por hora. Sano: produced = good + rejected; quality_pct 96-99%.
SELECT * FROM v_production_hourly ORDER BY hour DESC LIMIT 5;

-- 4.4 Energía de la celda. Sano: kwh coherente con avg_power_w
--     (kwh ≈ avg_power_w / 1000 en una hora completa).
SELECT * FROM v_energy_hourly ORDER BY hour DESC LIMIT 5;

-- 4.5 OEE por hora. Sano: oee_pct ≈ availability × quality × performance / 10000;
--     típico del simulador: 50-85% (mundo real de referencia: 60-85%).
SELECT * FROM v_oee_hourly ORDER BY hour DESC LIMIT 5;

-- 4.6 Rollup 1 min — la query exacta que usará Grafana para tendencias.
SELECT bucket, avg, min, max, n_samples
FROM v_process_1m
WHERE src = 'coriolis-01' AND field = 'mass_flow_kgh'
ORDER BY bucket DESC
LIMIT 5;
