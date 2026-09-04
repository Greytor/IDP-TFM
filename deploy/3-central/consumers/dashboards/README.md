# Dashboards Grafana — Demo Greytec IDP

> 4 dashboards versionados como JSON, uno por audiencia + uno de navegación.
> Grafana es un **consumidor analítico** del UNS (contrato §10.2): todo lo que
> muestran sale de las vistas silver/gold de TimescaleDB — **ningún panel
> calcula KPIs por su cuenta** (regla anti-dilución). Si un panel necesita un
> KPI nuevo, primero se agrega la vista en `../../sql/gold.sql`.

## Los 4 dashboards

| Archivo | UID | Audiencia | Ventana | Refresco | Responde a |
|---|---|---|---|---|---|
| `00-home.json` | `greytec-home` | Aterrizaje del demo | 24 h | 30 s | "¿Qué estoy viendo?" — estado vivo + navegación a las 3 vistas |
| `01-operador.json` | `greytec-operador` | Operador de celda | 1 h | 10 s | "¿Qué está pasando AHORA?" |
| `02-supervisor.json` | `greytec-supervisor` | Supervisor de turno | 24 h | 1 min | "¿Cómo va el turno?" |
| `03-gerencia.json` | `greytec-gerencia` | Gerencia | 30 d | 5 min | "¿Cómo va el negocio?" |

**Por qué varios y no uno:** cada audiencia necesita ventana de tiempo, refresco
y tipo de panel distintos. Es el mismo principio del §4.6 del contrato UNS — la
forma sigue el patrón de consumo — aplicado a visualización.

### 00 — Home (menú)
- Fila de estado vivo: estado de línea (color de fondo), OEE 24 h, botellas de
  hoy, alertas 24 h.
- Tres tiles markdown con descripción y link a cada vista de rol.
- Es la página que se deja abierta en `http://localhost:3000` al recibir a alguien.

### 01 — Operador
- **6 stats en vivo**: estado, buenas, rechazadas, % rechazo, drive gain, potencia.
- **State timeline** del estado de línea (las bandas rojas son atascos).
- **Caudal consigna vs. real** y **válvula setpoint vs. posición** — el lazo de
  control visible; el desfase entre curvas es la dinámica real de la celda.
- **Drive gain (NOA)** con umbral rojo en 40%: los picos son aire arrastrado y
  correlacionan con las caídas del panel de **densidad** — el argumento de
  mantenimiento predictivo del demo.
- **Potencia activa** (los pulsos cuadrados son el compresor).
- **Tabla de alarmas** (`v_alerts_recent`), severidad coloreada.

### 02 — Supervisor
- Stats del turno (últimas 8 h): producido, disponibilidad, calidad, energía.
- Producción por hora (barras apiladas buenas/rechazadas).
- Disponibilidad por hora (RUNNING/FAULT/STOPPED apilado).
- Throughput real vs. nominal (línea roja = 2400 bph).
- Calidad por hora, energía por hora, potencia media/pico.

### 03 — Gerencia
- 4 stats grandes del período visible: OEE, producción, disponibilidad, energía.
- **OEE y componentes** — la gráfica insignia: cuando el OEE cae, el componente
  que cae explica el porqué (disponibilidad → atascos; calidad → episodios;
  performance → línea lenta).
- Producción y energía por día, disponibilidad por día.
- **Intensidad energética (Wh/botella)** — `v_energy_intensity_hourly` (gold):
  sube cuando la celda consume sin producir.

## Cómo aplicarlos (importar en Grafana)

**Requisito único:** el datasource TimescaleDB debe ser el **default** de
Grafana (Connections → Data sources → tu PostgreSQL → activar "Default").
Los JSON no fijan datasource a propósito — así funcionan en cualquier
instancia sin editar UIDs.

**Método recomendado — Import:**
1. Grafana → Dashboards → **New → Import**.
2. Pega el contenido completo del `.json` en "Import via dashboard JSON model" → **Load**.
3. **Import**. Repetir para los 4 archivos.

**Método alternativo — JSON Model de un dashboard existente:**
Dashboard → Settings (⚙) → **JSON Model** → reemplazar todo el contenido →
Save changes. Útil para actualizar un dashboard ya importado.

**El orden no importa**, pero importa importar los 4: la navegación se arma sola.

## Cómo funciona la navegación

- Cada dashboard lleva el tag **`greytec-demo`** y un *dashboard link* de tipo
  "dashboards por tag": Grafana pinta automáticamente botones hacia todos los
  dashboards que tengan ese tag, en la barra superior de cada uno.
- Los tiles del Home enlazan por **UID fijo** (`/d/greytec-operador`, etc.) —
  por eso los UID están definidos en el JSON: sobreviven re-importaciones y
  los links nunca se rompen.
- Si creas un dashboard nuevo y quieres que aparezca en la navegación: solo
  agrégale el tag `greytec-demo`.

## Acceso sin login (público, solo estos 4)

**No uses el toggle "Public dashboard"** (Share → Public dashboard) de cada
tablero — esa función es para embeber UN dashboard aislado al internet
anónimo: no resuelve el datasource default (error típico: *"Query does not
contain a valid data source identifier"*) y no soporta navegar a otros
dashboards (los links del Home dan *"Dashboard not found"* porque apuntan a
la ruta normal `/d/<uid>`, que exige sesión).

Lo correcto es **acceso anónimo a nivel de organización** (rol Viewer) +
**una carpeta con permisos** para que ese acceso solo vea estos 4 dashboards:

1. **Habilitar acceso anónimo** — ya está en `../docker-compose.yml`
   (`GF_AUTH_ANONYMOUS_*`). Aplicar en el host:
   ```bash
   docker compose up -d grafana
   ```
   Si tu organización no se llama "Main Org." (Grafana → Administration →
   Orgs), ajusta `GF_AUTH_ANONYMOUS_ORG_NAME` antes de aplicar.

2. **Crear la carpeta del demo** — Dashboards → New → New folder →
   `Demo Greytec`. Mueve los 4 dashboards ahí (Dashboard Settings → General →
   Folder, o selección múltiple en la lista → Move).

3. **Restringir todo lo demás** (si en algún momento agregas dashboards que
   NO deben ser públicos): esa carpeta/dashboard → pestaña **Permissions** →
   quita el acceso de rol "Viewer" y deja solo Admin/Editor. Por defecto
   Grafana muestra todo a "Viewer" salvo que se restrinja explícitamente —
   la carpeta `Demo Greytec` se queda abierta, las demás se cierran.
   Si hoy Grafana solo tiene estos 4 dashboards, este paso no urge — solo
   aplica cuando agregues algo que no deba verse.

4. **Desactiva el toggle "Public dashboard"** que ya activaste en Home (Share
   → Public dashboard → apagar) — es innecesario y redundante con el acceso
   anónimo, y es la causa del error del datasource. Con acceso anónimo, la
   sesión ve el dashboard como cualquier Viewer logueado — el datasource
   default se resuelve igual que en tu propia sesión, sin tocar los JSON.

5. **Fija el Home dashboard de la organización** (si no, el anónimo cae en el
   "Welcome to Grafana" de la instancia, no en el tuyo): con sesión de admin,
   **Administration → General → Default preferences** → campo **Home
   Dashboard** → selecciona "Greytec IDP — Demo" → **Save**. Aplica al
   instante, sin reiniciar Grafana — el anónimo hereda esta preferencia del
   org al no tener una propia.

Resultado: cualquiera que abra `http://localhost:3000` sin loguearse ve
exactamente los 4 dashboards del demo, navega libre entre ellos, y no puede
editar nada ni ver otra cosa que exista en la instancia.

## Para presentar el demo

- **Guiado**: abre `/d/greytec-home` y navega con los tiles o los botones del
  tag. `d` + `k` (o el ícono de monitor en la esquina) activa modo kiosko
  (oculta menús de Grafana) — se ve limpio en pantalla grande; `Esc` lo saca.
- **Autónomo (opcional)**: Dashboards → Playlists → New, agrega los 4 por tag
  `greytec-demo`, intervalo 30-60 s, y arráncala en modo kiosko — rota sola
  en un TV sin intervención.

## Cómo modificar y mantener versionado

1. Edita el dashboard en la UI de Grafana (paneles, colores, umbrales).
2. Settings (⚙) → **JSON Model** → copia todo.
3. Pega sobre el archivo correspondiente en esta carpeta y commitea.

Nota: al exportar, Grafana agrega campos de estado (`version`, `iteration`,
`id`) — no molestan; puedes dejarlos o quitarlos, pero **no borres el `uid`**
(romperías los links del Home).

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| Paneles "No data" en todo | El datasource TimescaleDB no es el default, o silver/gold no están aplicados (`psql < silver.sql` y luego `gold.sql`) |
| Gerencia vacía / OEE en blanco | `v_oee_hourly` necesita al menos 1 hora completa de datos — normal recién desplegado |
| Solo faltan paneles de un dispositivo | Ese simulador no publica o sus campos no están en `asset_tags` — correr bloque 2.3 del `smoke_test.sql` |
| Links del Home rotos | El dashboard destino se importó con otro UID — reimportar sin editar el `uid` del JSON |
| Producción por hora con un pico absurdo | Reinicio de los simuladores a mitad de hora (contadores vuelven a 0) — ver caveat en `../../sql/README.md` |
