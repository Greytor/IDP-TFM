# Pendientes antes de congelar

> Lo que falta para que el repositorio despliegue el contrato v0.4 completo. Ordenado por
> lo que hace falta de tu lado frente a lo que ya está resuelto.

---

## 1. Deadbands: reconciliados con `flows.json` ✅

Se compararon los umbrales declarados en `def` con los que aplica realmente cada nodo
`function` de Node-RED. Había **cuatro discrepancias**, todas resueltas a favor de lo
desplegado, que es la verdad:

| Variable | Contrato decía | Node-RED aplica | Resuelto |
|---|---|---|---|
| `medidor-02.current_a` | 0.3 | **0.05** | `def` y contrato §7.1 corregidos |
| `medidor-02.power_factor` | 0.05 | **0.01** | ídem |
| `medidor-02.frequency_hz` | 0.1 | **0.02** | ídem |
| `coriolis-01.drive_gain_pct` | 3 | **1** | ídem |

Además, el flujo publica en `diag` dos booleanas que no estaban declaradas
(`air_entrainment` y `plc_link_ok`); ya figuran en `definitions.yml`. Son 27 variables
declaradas en total.

Esto es precisamente lo que el plano definitional sirve para detectar, y conviene contarlo
así en el Capítulo 5: el contrato no solo documenta, **encuentra divergencias**.

**Mejora pendiente (no bloquea el despliegue):** que el nodo `function` lea los deadbands
del propio `def` retenido en vez de tenerlos escritos. Un nodo `mqtt in` suscrito a
`…/{cell}/def` que guarde el diccionario en contexto de flujo elimina la duplicación de
raíz. Mientras tanto, si se cambia un umbral hay que tocarlo en los dos sitios.

---

## 2. `edge-health` publica su `def` ✅

Resuelto sin fichero estático: el gateway **deriva su definición del payload que acaba de
medir**, así que no puede divergir del flujo por construcción — si una variable se publica,
está declarada, porque ambas salen del mismo diccionario.

Las métricas por contenedor, que dependen de qué contenedores corren, quedan cubiertas: si
el conjunto de campos cambia, se republica el `def` con `rev` incrementado. Los nombres
legibles se generan por regla (`nanomq_cpu_pct` → «CPU de nanomq»), sin tabla que mantener.

Consecuencia: **`silver.sql` ya no siembra nada a mano**. Era la última aplicación
escribiendo directo en la capa derivada.

---

## 3. Verificar la Regla 0 tras el primer despliegue

El contrato §11 exige correspondencia entre lo declarado y lo publicado. La comprobación ya
está montada como vista SQL:

```sql
SELECT * FROM v_contrato_variables_sin_declarar;
```

Debe devolver **cero filas**. Si devuelve alguna, hay una variable llegando a
`sensor_readings` que ningún `def` declara: o falta en el YAML, o Node-RED está publicando
algo que no debería.

La comprobación inversa (variables declaradas que nunca se publican) se hace comparando el
árbol retenido:

```bash
mosquitto_sub -h <broker> -t 'greytec/demo/produccion/llenado/+/def' -C 4 -v
mosquitto_sub -h <broker> -t 'greytec/demo/produccion/llenado/+/dat/raw/#' -W 60 -v
```

---

## 4. Orden de arranque en el primer despliegue

`def` debe existir en el broker antes de que lleguen las primeras lecturas, para que
`asset_tags` esté poblada cuando el consumidor materialice. No es estrictamente necesario
—el UPSERT de `def` es idempotente y las vistas plata se recalculan al leer— pero evita ver
huecos en Grafana durante el primer minuto.

```bash
# 1. Central primero: el broker y el registro deben estar listos
cd deploy/3-central && docker compose up -d

# 2. Borde: NanoMQ, el puente y la publicación de definiciones
cd ../2-edge && docker compose up -d --build

# 3. Campo: los cuatro dispositivos
cd ../1-campo && docker compose up -d --build

# 4. Verificar que el plano definitional llegó
docker logs greytec-def-publisher        # 4 topics publicados
docker exec -it greytec-timescaledb psql -U greytec -d greytec \
  -c "SELECT src, rev, display_name FROM assets ORDER BY src;"
```

Para republicar las definiciones tras editar el YAML, sin reconstruir la imagen:

```bash
cd deploy/2-edge && docker compose run --rm def-publisher
```

Recuerda **incrementar `rev`** del dispositivo que cambies: el UPSERT del consumidor ignora
las revisiones que no son mayores que la ya aplicada.

---

## 5. Revisión de contenido antes de publicar el repositorio

- `deploy/*/.env.example` no contiene secretos, pero **verifica que no subes ningún `.env`
  real**. El `.gitignore` ya los excluye.
- Las IP del laboratorio (`10.10.10.x`, `10.10.20.x`) aparecen en la documentación. Son
  direcciones privadas de un laboratorio y no exponen nada, pero decide si prefieres
  sustituirlas por marcadores antes de hacer público el repositorio.
- Ya no quedan dominios ni credenciales de proveedor de identidad: el stack se levanta
  en `http://localhost` y Grafana en `http://localhost:3000`.
