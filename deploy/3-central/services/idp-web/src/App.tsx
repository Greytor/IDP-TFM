/* Rutas de la app. La sección /admin va tras un guard de ROL — que es UX, no
   seguridad: aunque alguien fuerce la ruta, cada llamada a /api/v1/admin/*
   vuelve con 403 y la vista lo dice. Quien manda es la API. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ApiError } from './api/client';
import { useAuth } from './auth/AuthProvider';
import { Shell } from './layout/Shell';
import { Apis } from './views/admin/Apis';
import { AssetTags } from './views/admin/AssetTags';
import { CatalogoKpis } from './views/admin/CatalogoKpis';
import { ParametrosNegocio } from './views/admin/ParametrosNegocio';
import { Salud } from './views/admin/Salud';
import { Alarmas } from './views/demo/Alarmas';
import { Dashboards } from './views/demo/Dashboards';
import { Namespace } from './views/demo/Namespace';
import { Resumen } from './views/demo/Resumen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Un 4xx no se cura reintentando (401 ya relanza el login por su lado);
      // un fallo de red o un 5xx merece un segundo intento y no más.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <div className="state" style={{ marginTop: 40 }}>
        <div className="big">Esta sección requiere el rol admin</div>
        <p>
          Tu usuario tiene rol demo. Si crees que deberías administrar la
          plataforma, pide el grupo <code>admin</code> en el gestor de identidad.
        </p>
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Resumen />} />
            <Route path="dashboards" element={<Dashboards />} />
            <Route path="alarmas" element={<Alarmas />} />
            <Route path="namespace" element={<Namespace />} />
            <Route
              path="admin"
              element={
                <RequireAdmin>
                  <Navigate to="/admin/kpis" replace />
                </RequireAdmin>
              }
            />
            <Route path="admin/kpis" element={<RequireAdmin><CatalogoKpis /></RequireAdmin>} />
            <Route path="admin/tags" element={<RequireAdmin><AssetTags /></RequireAdmin>} />
            <Route path="admin/negocio" element={<RequireAdmin><ParametrosNegocio /></RequireAdmin>} />
            <Route path="admin/salud" element={<RequireAdmin><Salud /></RequireAdmin>} />
            <Route path="admin/apis" element={<RequireAdmin><Apis /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
