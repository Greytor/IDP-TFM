import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy de desarrollo (traspaso 2.2-A, punto 2): la app llama SIEMPRE a rutas
// relativas (/api/v1/…). En producción las enruta nginx; en desarrollo las
// reenvía Vite a la API real. Mismo código, cero CORS — y CORS_ORIGINS de
// producción NO se toca.
//
// /brand no se proxea: los logos viven en public/brand/ y Vite los sirve igual
// que nginx lo hará en producción (misma ruta en los dos mundos).
const API = process.env.VITE_API_URL || 'http://localhost';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/auth': { target: API, changeOrigin: true },
      // Los usa el explorador de APIs de la consola (specs OpenAPI y salud).
      '/openapi.json': { target: API, changeOrigin: true },
      '/health': { target: API, changeOrigin: true },
    },
  },
  build: {
    // swagger-ui es pesado y solo lo visita el admin: va en su propio chunk
    // (se importa dinámicamente desde la vista), no en el bundle principal.
    chunkSizeWarningLimit: 1600,
  },
});
