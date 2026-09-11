/* Cliente de la API. La especificación la sirve el propio servicio en
   /openapi.json, navegable desde el Explorador de APIs de la consola.

   Todas las rutas son RELATIVAS (/api/v1/…): en producción las enruta nginx y
   en desarrollo el proxy de Vite. Mismo código, cero CORS — y CORS_ORIGINS de
   producción no se toca (traspaso 2.2-A, punto 2).

   Manejo uniforme de errores (criterio 2.2-A):
     401 → el token no vale: se relanza el login (lo hace quien nos escucha).
     403 → autenticado pero sin permiso. NO se reintenta el login: la
           distinción 401/403 la hace la API a propósito.
     503 → la API no responde (o la base detrás de ella).
   FastAPI devuelve {"detail": "…"} — se conserva porque los 422 de la Familia 4
   dicen qué columnas existen, y eso es ayuda contextual gratis (sprint 2.2-C). */
import { getAccessToken } from '../auth/auth';
import type {
  AdminHealth,
  AdminKpi,
  AlertRow,
  AppConfig,
  AssetTag,
  BizParamIn,
  BusinessParam,
  Envelope,
  KpiCatalogEntry,
  KpiDeleteResult,
  KpiIn,
  KpiRow,
  ServiceInfo,
  Severity,
  TimeParams,
  UnsTopic,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }

  /** Mensaje para humanos, según el criterio del issue 2.2-A. */
  get friendly(): string {
    if (this.status === 401) return 'La sesión caducó. Volviendo al inicio de sesión…';
    if (this.status === 403) return 'Tu usuario no tiene permiso para esta operación.';
    if (this.status === 503 || this.status === 0) return 'La API no responde.';
    return this.detail;
  }
}

/** Quien monte la app registra aquí qué hacer ante un 401 (relanzar login). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body != null) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'La API no responde.');
  }

  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (body?.detail) detail = JSON.stringify(body.detail);
    } catch {
      /* cuerpo no-JSON: se queda el genérico */
    }
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

function timeQuery(
  p: TimeParams & {
    severity?: string;
    limit?: number;
    prefix?: string;
    format?: string;
    download?: string;
    src?: string;
    alarms?: string;
  },
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/* ── Infraestructura ── */

export function fetchConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/v1/config');
}

/* ── Familia 1 — UNS ── */

export function getUnsTopics(prefix?: string): Promise<Envelope<UnsTopic[]>> {
  return request(`/api/v1/uns/topics${timeQuery({ prefix })}`);
}

/** Sin parámetros de tiempo → último valor conocido del tópico (contrato §3.1). */
export function getUnsLatest(topic: string): Promise<Envelope<KpiRow[]>> {
  return request(`/api/v1/uns/${topic}`);
}

/* ── Familia 2 — KPIs ── */

export function getKpiCatalog(): Promise<Envelope<KpiCatalogEntry[]>> {
  return request('/api/v1/kpi');
}

export function getKpiSeries(name: string, p: TimeParams): Promise<Envelope<KpiRow[]>> {
  return request(`/api/v1/kpi/${name}${timeQuery(p)}`);
}

export function getKpiLive(name: string): Promise<Envelope<KpiRow | null>> {
  return request(`/api/v1/kpi/${name}/live`);
}

/* ── Alarmas ── */

export function getAlerts(
  p: TimeParams & { severity?: Severity; limit?: number },
): Promise<Envelope<AlertRow[]>> {
  return request(`/api/v1/alerts${timeQuery(p)}`);
}

/* ── Parámetros de negocio (lectura pública: los SUPUESTOS del dinero) ── */

export function getBusinessParams(): Promise<Envelope<BusinessParam[]>> {
  return request('/api/v1/business-params');
}

/* ── Familia 4 — Administración (exige rol admin; el 403 manda) ── */

export function adminListKpis(): Promise<Envelope<AdminKpi[]>> {
  return request('/api/v1/admin/kpis');
}

export function adminPutKpi(name: string, body: KpiIn): Promise<Envelope<AdminKpi>> {
  return request(`/api/v1/admin/kpis/${name}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function adminDeleteKpi(name: string): Promise<Envelope<KpiDeleteResult>> {
  return request(`/api/v1/admin/kpis/${name}`, { method: 'DELETE' });
}

export function adminListTags(src?: string): Promise<Envelope<AssetTag[]>> {
  return request(`/api/v1/admin/asset-tags${timeQuery({ src })}`);
}

export function adminPutBusinessParam(
  param: string,
  body: BizParamIn,
): Promise<Envelope<BusinessParam>> {
  return request(`/api/v1/admin/business-params/${param}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** OJO: /admin/health NO usa el sobre {meta,data} — devuelve el objeto pelado. */
export function adminHealth(silenceMin: number): Promise<AdminHealth> {
  return request(`/api/v1/admin/health?silence_min=${silenceMin}`);
}

export function adminServices(): Promise<Envelope<ServiceInfo[]>> {
  return request('/api/v1/admin/services');
}
