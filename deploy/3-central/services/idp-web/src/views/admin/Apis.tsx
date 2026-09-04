/* Explorador de APIs (issue 2.2-C + 2.1-D): UN solo SwaggerUI con las specs de
   todos los servicios, alimentado por GET /api/v1/admin/services. Resuelve la
   queja de las dos /docs SIN fusionar los servicios (ADR-022: la separación es
   de ejecución; la unificación va en el borde).

   El registro devuelve rutas RELATIVAS a propósito: el navegador las resuelve
   contra su propio origen, y la misma imagen sirve en cualquier despliegue.

   swagger-ui-dist pesa: se importa DINÁMICAMENTE para que viva en su propio
   chunk y solo lo descargue quien entra aquí (el admin). El requestInterceptor
   añade el Bearer — así el "Try it out" de la Familia 4 funciona con la sesión
   de la consola. */
import { useEffect, useRef } from 'react';

import { useAdminServices } from '../../api/hooks';
import { getAccessToken } from '../../auth/auth';
import { ErrorState, Loading } from '../../components/ui';

export function Apis() {
  const services = useAdminServices();

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">
          Dos servicios, un explorador · el contrato de verdad es docs/contracts/API.md
        </div>
        <h1>Explorador de APIs</h1>
      </div>

      {services.isPending && <Loading />}
      {services.isError && <ErrorState error={services.error} />}
      {services.isSuccess && (
        <>
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            {services.data.data.map((s) => (
              <div className="stat" key={s.name}>
                <span className="label">{s.title}</span>
                <span className="val" style={{ fontSize: 18 }}>
                  <code>{s.base_path}</code>
                </span>
                <span className="sub">
                  {s.version ? `v${s.version} · ` : ''}
                  {s.families.join(' · ')}
                </span>
              </div>
            ))}
          </div>
          <SwaggerExplorer
            urls={services.data.data.map((s) => ({ url: s.openapi_url, name: s.title }))}
          />
        </>
      )}
    </>
  );
}

function SwaggerExplorer({ urls }: { urls: { url: string; name: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [bundle, preset] = await Promise.all([
        import('swagger-ui-dist/swagger-ui-bundle'),
        import('swagger-ui-dist/swagger-ui-standalone-preset'),
        // El CSS va con el mismo chunk perezoso.
        import('swagger-ui-dist/swagger-ui.css'),
      ]);
      if (!alive || !ref.current) return;
      const SwaggerUIBundle = bundle.default;
      const SwaggerUIStandalonePreset = preset.default;
      SwaggerUIBundle({
        domNode: ref.current,
        urls,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        // StandaloneLayout trae el desplegable de specs (opción `urls`).
        layout: 'StandaloneLayout',
        requestInterceptor: (req) => {
          const token = getAccessToken();
          if (token) req.headers = { ...req.headers, Authorization: `Bearer ${token}` };
          return req;
        },
      });
    })();
    return () => {
      alive = false;
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [urls]);

  return <div className="card" style={{ padding: 8 }} ref={ref} />;
}
