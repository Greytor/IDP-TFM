/* Contexto de sesión — edición del repositorio académico: SIN autenticación.

   ─── Por qué no hay login aquí ──────────────────────────────────────────────
   Lo que este trabajo demuestra es una arquitectura de datos: que cuatro fuentes
   heterogéneas y varios consumidores conviven sobre un mismo espacio de nombres
   sin acoplarse. El control de acceso a la capa de consumo es ortogonal a eso, y
   exigirlo obligaría a levantar un proveedor de identidad, registrar un cliente
   OIDC y disponer de un dominio antes de poder ver un solo dato.

   Quien clone este repositorio debe poder hacer `docker compose up` y entrar. Esa
   es la propiedad que se prioriza: reproducibilidad por encima de completitud.

   ─── Qué se conserva y por qué ──────────────────────────────────────────────
   La interfaz `AuthState` se mantiene intacta a propósito. Las vistas y el Shell
   siguen pidiendo `config`, `user`, `roles` e `isAdmin` como antes, así que
   reponer un proveedor real es sustituir este fichero y nada más: ni una vista
   cambia. El acoplamiento con la identidad queda confinado aquí.

   Lo único que sigue haciendo este componente es lo que de verdad hace falta para
   arrancar: pedir `/api/v1/config` y no montar la aplicación hasta tenerla.
*/
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { fetchConfig } from '../api/client';
import type { AppConfig } from '../api/types';

/** Perfil mínimo que consume el Shell. Misma forma que traía el token OIDC. */
export interface AppUser {
  profile: {
    preferred_username?: string;
    name?: string;
    sub: string;
  };
}

export interface AuthState {
  config: AppConfig;
  user: AppUser;
  roles: string[];
  isAdmin: boolean;
  logout: () => void;
}

/** Usuario local: no hay sesión que abrir ni cerrar. */
const USUARIO_LOCAL: AppUser = {
  profile: { preferred_username: 'operador', name: 'Operador', sub: 'local' },
};

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de <AuthProvider>');
  return v;
}

type Fase =
  | { t: 'cargando' }
  | { t: 'error'; detail: string }
  | { t: 'listo'; config: AppConfig };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>({ t: 'cargando' });

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const config = await fetchConfig();
        if (vivo) setFase({ t: 'listo', config });
      } catch (e) {
        if (vivo)
          setFase({
            t: 'error',
            detail:
              'No se pudo leer /api/v1/config. Comprueba que el servicio `api` ' +
              'está levantado y que nginx lo alcanza. ' +
              (e instanceof Error ? e.message : String(e)),
          });
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (fase.t === 'error') {
    return (
      <div className="splash">
        <div className="msg">La plataforma no responde</div>
        <div className="detail">{fase.detail}</div>
      </div>
    );
  }

  if (fase.t === 'cargando') {
    return (
      <div className="splash">
        <div className="msg">Cargando…</div>
      </div>
    );
  }

  const valor: AuthState = {
    config: fase.config,
    user: USUARIO_LOCAL,
    roles: ['admin'],
    isAdmin: true,
    logout: () => {
      /* sin sesión que cerrar */
    },
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
