# idp-web — cómo tocar el frontend y desplegarlo tú mismo

> La SPA de React + el nginx del borde, en un solo servicio (ADR-022: nginx ES
> el contenedor de la app). Esta guía es el paso a paso para cambiar un color,
> un texto o una vista **sin pedírselo a nadie**, y subirlo al servidor.

---

## 1. El bucle de desarrollo (verlo antes de subirlo)

```powershell
cd core\compose\central\services\idp-web
npm install        # solo la primera vez, o si cambió package.json
npm run dev
```

con tu usuario de siempre. El proxy de Vite reenvía `/api` y `/auth` a
`http://localhost`, así que desarrollas contra los **datos reales de
producción** sin tocar nada del servidor.

Editas un archivo → guardas → el navegador se refresca solo (HMR). `Ctrl+C`
para parar.

## 2. Dónde se toca qué

| Quieres cambiar | Archivo |
|---|---|
| **Colores** (tokens del Brand Kit) | `src/styles/tokens.css` — ⚠️ solo si cambia el kit: son los MISMOS tokens del PDF y del login |
| Tipografía base, tamaños, etiquetas | `src/styles/base.css` |
| Layout, sidebar, tarjetas, botones, tablas | `src/styles/app.css` |
| Textos y lógica del **Resumen** | `src/views/demo/Resumen.tsx` |
| Dashboards / Reportes / Alarmas / Namespace | `src/views/demo/*.tsx` |
| Vistas de la **consola** admin | `src/views/admin/*.tsx` |
| Menú lateral (secciones, enlaces) | `src/layout/Shell.tsx` |
| Rutas (URLs de la app) | `src/App.tsx` |
| **Logos** | `public/brand/` — el sufijo dice PARA QUÉ FONDO es: `-dark` = tinta clara (fondo oscuro), `-light` = tinta oscura (fondo claro) |
| Formato de números y fechas | `src/lib/format.ts` |
| Cliente de la API (endpoints, tipos) | `src/api/client.ts` · `src/api/types.ts` |

## 3. Reglas que no se rompen (romperlas rompe el producto)

1. **Nada de config escrita en el código.** `client_id`, URL de Grafana,
   `site_tz`, `site_label`… se piden a `GET /api/v1/config`. Escribirlos en el
   bundle obliga a compilar por cliente → rompe el golden stack.
2. **`CORS_ORIGINS` no se toca.** Las llamadas van a rutas RELATIVAS
   (`/api/v1/…`): en dev las reenvía Vite, en producción nginx. Si ves un error
   de CORS, el arreglo NUNCA es añadir localhost a la lista de producción.
3. **Electric `#F5C800` solo en LA cifra crítica** (hoy: el OEE del héroe), y
   nunca sobre fondo claro. Orbitron solo para el logotipo.
4. **Nada de secretos**: todo lo que compilas es público en el navegador.
5. **Ocultar no protege.** La separación demo/admin es UX; quien manda es el
   403 de la API.
6. **Nada dice "demo"** en el producto — lo único demo es el usuario.

## 4. Compilar (la comprobación antes de subir)

```powershell
npm run build
```

Si termina en `✓ built in Xs`, está bien: TypeScript pasó y el bundle se
generó. Si da error, lo dice con archivo y línea — no subas hasta que compile.

> `dist/` local es un artefacto de prueba: acumula builds viejos y **no se
> despliega ni se versiona** (el servidor compila el suyo). Se puede borrar.

## 5. Desplegar, paso a paso

**Paso 1 — subir el código** (desde PowerShell, `cd` al repo primero — tu ruta
tiene un espacio y el scp sin comillas la parte en dos):

```powershell
cd "C:\...\IDP-Greytec\core\compose\central"
scp -r services/idp-web/src greytec@10.10.20.130:~/greytec-idp/core/compose/central/services/idp-web/
```

Si tocaste algo de `public/` (logos, favicon, proxy-check) o `nginx/`:

```powershell
scp -r services/idp-web/public services/idp-web/nginx greytec@10.10.20.130:~/greytec-idp/core/compose/central/services/idp-web/
```

> ⚠️ **NUNCA `scp -r services/idp-web` entero**: arrastraría `node_modules/`
> (cientos de MB) y `dist/`. Sube solo las carpetas que cambiaste.

**Paso 2 — reconstruir en el servidor:**

```powershell
ssh greytec@10.10.20.130
```
```bash
cd ~/greytec-idp/core/compose/central
docker compose up -d --build web
```

La imagen corre `npm ci` + `npm run build` por dentro (2-4 min la primera vez,
con caché después). El navegador del cliente no necesita nada instalado.

**Paso 3 — verificar** (cultura del repo: cuando digas "funciona", que sea
porque lo viste):

```bash
docker compose ps | grep web            # → Up (healthy)
curl -s http://127.0.0.1/ -H 'Host: localhost' | grep -oE 'assets/index-[^"]+\.js'
```

Ese hash de bundle debe ser NUEVO (distinto al de antes del deploy). Luego abre
`http://localhost` con **Ctrl+Shift+R** (sin el shift-refresh, el
navegador puede servirte el bundle viejo de su caché) y
`http://localhost/proxy-check.html` para ver la sonda en verde.

## 6. Trampas que ya nos mordieron

| Trampa | Qué pasa | Antídoto |
|---|---|---|
| `scp -r services/idp-web` entero | Subes cientos de MB de `node_modules` | scp solo `src/` (+`public/`/`nginx/` si cambiaron) |
| Un `index.html` suelto en `public/` | Pisa el index compilado de React al hacer build | `public/` no lleva index; el entry de Vite es el `index.html` de la RAÍZ del servicio |
| Refrescar sin `Ctrl+Shift+R` | Ves el bundle viejo de la caché y "el cambio no salió" | shift-refresh, o compara el hash del bundle |
| curls en ráfaga por el túnel dan `000` | Cloudflare corta peticiones repetidas rápidas | verifica desde el servidor: `curl -H 'Host: localhost' http://127.0.0.1/...` |
| Logo "invisible" | Pusiste el `-light` en fondo oscuro (o viceversa) | el sufijo dice para qué FONDO es, no de qué color es |

## 7. Qué NO se despliega así

- **API o reportes**: mismo patrón pero `scp` de su `app/` y
  `docker compose up -d --build api kpi-writeback` (comparten imagen) o
  `--build reports`.
- **SQL** (vistas, catálogos): `sql/*.sql` por pgAdmin envuelto en
  `BEGIN; … COMMIT;`, o el bloque incremental por `docker exec … psql`
  (ver `sql/README.md`).
- **nginx** cambia → es parte de la imagen de `web`: mismo `--build web`.
- Y después de todo deploy que funcione: **commit** — el servidor nunca debe
  correr código que el historial no tenga.
