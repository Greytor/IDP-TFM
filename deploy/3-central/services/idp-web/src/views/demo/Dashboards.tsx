/* Grafana embebido (issue 2.2-B) — el iframe ES la vista: ocupa todo el
   espacio a la derecha de la barra lateral, sin marco (decisión 2026-07-17).
   Sin botonera propia: el Grafana de monitor ya está en kiosk con los enlaces
   entre dashboards, y el selector de tiempo y refresco los pone el usuario ahí
   dentro. Se abre en la portada (greytec-home) y desde sus enlaces se navega a
   operador/supervisor/gerencia sin salir del marco.

   grafana_url viene de /api/v1/config — escribirlo aquí rompería el golden
   stack. El embebido está autorizado por `frame-ancestors` en nginx: solo este
   IDP puede enmarcarlo. */
import { useAuth } from '../../auth/AuthProvider';

export function Dashboards() {
  const { config } = useAuth();

  return (
    <div className="dash-fill">
      <iframe
        src={`${config.grafana_url}/d/greytec-home?kiosk`}
        title="Dashboards de Grafana"
      />
    </div>
  );
}
