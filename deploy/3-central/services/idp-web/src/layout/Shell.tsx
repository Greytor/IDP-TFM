/* Shell de la app: sidebar Ink + contenido Linen (patrón del DMP — mismo kit,
   mismo cliente en la misma reunión). En móvil la sidebar se vuelve un cajón.

   La sección CONSOLA solo se PINTA para el rol admin — comodidad, no seguridad:
   quien manda es el 403 de la API (traspaso 2.2-A, punto 4). */
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthProvider';

const DEMO_LINKS = [
  { to: '/', label: 'Resumen', end: true },
  { to: '/dashboards', label: 'Dashboards' },
  { to: '/reportes', label: 'Reportes' },
  { to: '/alarmas', label: 'Alarmas' },
  { to: '/namespace', label: 'Namespace' },
];

const ADMIN_LINKS = [
  { to: '/admin/kpis', label: 'Catálogo KPIs' },
  { to: '/admin/tags', label: 'Asset tags' },
  { to: '/admin/negocio', label: 'Parámetros de negocio' },
  { to: '/admin/salud', label: 'Salud del pipeline' },
  { to: '/admin/apis', label: 'Explorador de APIs' },
];

export function Shell() {
  const { config, user, roles, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  const username =
    user.profile.preferred_username || user.profile.name || user.profile.sub;

  const nav = (
    <nav aria-label="Principal">
      {/* "Planta", no "Demo": lo único demo es el usuario, nunca el producto. */}
      <div className="nav-section">Planta</div>
      {DEMO_LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          onClick={() => setOpen(false)}
        >
          {l.label}
        </NavLink>
      ))}
      {isAdmin && (
        <>
          <div className="nav-section">Consola</div>
          {ADMIN_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </NavLink>
          ))}
        </>
      )}
    </nav>
  );

  return (
    <div className="shell">
      <div className="topbar">
        <img src="/brand/logo-dark.svg" alt="" />
        <span className="wordmark wm-name">Greytec IDP</span>
        <button
          className="menu-btn"
          aria-label="Abrir menú"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          ☰
        </button>
      </div>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/brand/logo-dark.svg" alt="Greytec" />
          <div>
            <div className="wordmark wm-name">Greytec</div>
            <div className="wm-sub">Industrial Data Platform</div>
          </div>
        </div>
        {nav}
        <div className="sidebar-foot">
          <div className="site-label">{config.site_label}</div>
          <span className="who">{username}</span>
          <span className="role">{roles.includes('admin') ? 'admin' : 'demo'}</span>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
