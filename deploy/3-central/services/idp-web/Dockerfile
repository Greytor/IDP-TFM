# Servicio `web` — nginx sirve la app y enruta el API. Ver ADR-022.
#
# nginx NO es un servicio aparte: ES el contenedor de la app. Servir estáticos y
# enrutar el API es un solo trabajo, y un segundo nginx solo para entregar un .js
# sería un salto de red regalado.
#
# Desde 2.2-A el servicio creció como estaba previsto: etapa de build de Node
# delante, nginx sirviendo el dist/. La SPA es un ARTEFACTO de build, no un
# runtime (ADR-023): en el servidor solo corre nginx.
#
# dist/ ya incluye public/ (Vite copia el publicDir al compilar): los logos de
# /brand/, el favicon y /proxy-check.html —el antiguo index de relleno, que
# sigue sirviendo de sonda del proxy— viajan solos.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine

# El mapa de rutas es PRODUCTO: `/api/v1/reports/` → reports:8001 es idéntico en
# todos los clientes, así que va DENTRO de la imagen (golden-stack §3, columna
# izquierda). Lo único per-cliente es ${SERVER_NAME}, que viene del .env.
#
# La imagen oficial procesa /etc/nginx/templates/*.template con envsubst al
# arrancar y deja el resultado en /etc/nginx/conf.d/. Sin scripts propios.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /app/dist /usr/share/nginx/html
