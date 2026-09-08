# Despliegue y verificación

> Cómo se levanta el sistema completo y cómo se comprueba que el contrato se cumple.
> Las tres capas se despliegan con `docker compose up -d --build` desde su carpeta;
> lo que sigue es el orden entre ellas y las comprobaciones de cada paso.

## 1. Orden de arranque

El orden importa por una razón: **`def` debe existir en el broker antes de que lleguen
las primeras lecturas**, para que `asset_tags` esté poblada cuando el consumidor
materialice. No es estrictamente necesario —el UPSERT de `def` es idempotente y las
vistas plata se recalculan al leer— pero evita ver huecos en Grafana durante el primer
minuto.

```bash
# 1. Central primero: el broker y el registro deben estar listos
cd deploy/3-central && docker compose up -d

# 2. Borde: NanoMQ, el puente y la publicación de definiciones
cd ../2-edge && docker compose up -d --build

# 3. Campo: los cuatro dispositivos
cd ../1-campo && docker compose up -d --build
```

## 2. Capas plata y oro

La capa bronce la crea el propio consumidor al arrancar (`init.sql`, idempotente). Las
vistas derivadas se aplican a mano, y **siempre en este orden**: `silver.sql` hace
`DROP VIEW … CASCADE` y se lleva por delante las vistas de oro, que dependen de ella.

```bash
cd deploy/3-central
docker exec -i greytec-timescaledb psql -U <usuario> -d <bd> -v ON_ERROR_STOP=1 < sql/silver.sql
docker exec -i greytec-timescaledb psql -U <usuario> -d <bd> -v ON_ERROR_STOP=1 < sql/continuous_aggregates.sql
docker exec -i greytec-timescaledb psql -U <usuario> -d <bd> -v ON_ERROR_STOP=1 < sql/gold.sql
```

**El orden no es negociable.** `continuous_aggregates.sql` crea `ca_kpi_1h` leyendo
directamente de bronce, y cinco vistas de oro leen de ese agregado: aplicarlo después de
`gold.sql` falla con «relation "ca_kpi_1h" does not exist». La plata va primero porque
`gold.sql` también lee de `v_process_readings`.

`ON_ERROR_STOP=1` es igual de importante: sin él, `psql` imprime el error y **sigue
ejecutando el resto del fichero**, dejando la mitad de las vistas creadas y una salida que
parece correcta. Los tres ficheros son idempotentes y no tocan datos: re-aplicarlos es
seguro.

## 3. El plano definitional

```bash
docker logs greytec-def-publisher        # 4 topics publicados
docker exec -it greytec-timescaledb psql -U <usuario> -d <bd> \
  -c "SELECT src, rev, display_name FROM assets ORDER BY src;"
```

Si el borde se levantó antes que el central —por ejemplo al construir por capas—, las
definiciones se publicaron cuando aún no había nadie al otro lado del puente. Se
republican sin reconstruir la imagen:

```bash
cd deploy/2-edge && docker compose run --rm def-publisher
```

Eso cubre los cuatro dispositivos de la celda. La definición del **gateway** la publica
`edge-health`, y solo al arrancar: deriva sus variables del payload que mide, así que
únicamente vuelve a emitirla si cambia el conjunto de contenedores. Para forzarla basta
con reiniciarlo:

```bash
cd deploy/2-edge && docker compose restart edge-health
```

Al editar el modelo de datos hay que **incrementar `rev`** del dispositivo que cambie:
el UPSERT del consumidor ignora las revisiones que no son mayores que la ya aplicada.
Es también el mecanismo de administración del diccionario: se edita `definitions.yml`
en el gateway, se sube `rev` y se republica. El productor es la autoridad sobre la
definición de sus propias variables (contrato §4.0), así que no hay ninguna otra vía
de escritura — la vista de la aplicación central es de solo lectura por diseño.

## 4. Regla 0 del contrato

El contrato §11 exige correspondencia entre lo declarado y lo publicado. La
comprobación está montada como vista SQL y debe devolver **cero filas**:

```sql
SELECT * FROM v_contrato_variables_sin_declarar;
```

Si devuelve alguna, hay una variable llegando a `sensor_readings` que ningún `def`
declara: o falta en el YAML, o el gateway está publicando algo que no debería.

La comprobación inversa —variables declaradas que nunca se publican— se hace
comparando el árbol retenido:

```bash
mosquitto_sub -h <broker> -t 'greytec/demo/produccion/llenado/+/def' -C 4 -v
mosquitto_sub -h <broker> -t 'greytec/demo/produccion/llenado/+/dat/raw/#' -W 60 -v
```

## 5. Prueba de humo

`deploy/3-central/sql/smoke_test.sql` — solo SELECTs, seguro de correr en producción.
Cuatro bloques: bronce (¿llega?), calidad (¿se pierde algo?), plata (¿se interpreta?)
y oro (¿los indicadores son coherentes?). Cada consulta documenta qué resultado es
sano. Conviene correrlo tras cada despliegue o cambio de contrato.
