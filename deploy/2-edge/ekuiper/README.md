# eKuiper — Streams y reglas del edge

Definiciones versionadas de los streams y reglas de eKuiper. eKuiper guarda su
estado en un volumen (`ekuiper_data`), pero esa config NO está en el repo; estos
archivos son la **fuente de verdad reproducible**. Si se recrea el contenedor o
se migra el edge, se reaplican desde aquí.

## Estructura

```
ekuiper/
  streams/   ← definiciones CREATE STREAM (origen MQTT)
  rules/     ← reglas (SQL + sink), una por archivo JSON
```

## Contrato

Las reglas publican según el **contrato UNS v0.1** (`docs/contracts/UNS.md`):

- Las **alarmas** (cruce de umbral) son eventos discretos → categoría `evt` (§4.4),
  envelope `{ts, src, evt_type, severity, msg, …}`.
- NO usan `dat/der`: esa subcategoría es para mediciones derivadas continuas
  (medias móviles, KPIs), no para alarmas.

## Aplicar la configuración

La REST API de eKuiper escucha en `:9081`. Desde el host del edge:

```bash
# 1) Crear el stream
curl -X POST http://localhost:9081/streams \
  -H "Content-Type: application/json" \
  -d "{\"sql\": \"$(tr -d '\n' < streams/coriolis_mass_flow.sql | sed 's/--[^\n]*//g')\"}"

# 2) Crear la regla
curl -X POST http://localhost:9081/rules \
  -H "Content-Type: application/json" \
  -d @rules/tank_level_high.json
```

> Más simple: pegar el SQL y el Data template en la UI del **eKuiper Manager**
> (`http://<edge>:9082`). Los archivos de este directorio son la referencia
> exacta de qué pegar.

## Operaciones útiles

```bash
curl http://localhost:9081/rules                       # listar reglas
curl http://localhost:9081/rules/tank_level_high/status # estado de una regla
curl -X POST http://localhost:9081/rules/tank_level_high/restart
curl -X DELETE http://localhost:9081/rules/tank_level_high
```

## Reglas registradas

| Regla | Lee de | Publica en | Condición |
|---|---|---|---|
*(sin reglas activas — el procesamiento de flujo se despliega montado e inactivo)*
