-- Stream eKuiper — lee el caudal másico del coriolis desde NanoMQ local.
-- Contrato v0.3+: un topic por variable, envelope PLANO ({ts, src, seq, v, u, q}),
-- así que el valor se accede como `v` y no como payload->campo->v.
--
-- eKuiper se despliega montado pero INACTIVO (ver deploy/2-edge/README.md): el
-- procesamiento de flujo es una capacidad condicional del borde (Cap. 3, Tabla 7).
-- Este stream queda como punto de partida cuando se active.

CREATE STREAM coriolis_mass_flow () WITH (
    DATASOURCE="greytec/demo/produccion/llenado/coriolis-01/dat/raw/mass_flow_kgh",
    FORMAT="json"
);
