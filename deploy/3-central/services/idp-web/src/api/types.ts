/* Tipos del contrato API v0.2 (docs/contracts/API.md — la fuente de verdad, no
   Swagger). Verificados contra la API desplegada el 2026-07-17.

   El principio del contrato §3.2: los KPIs son dirigidos por catálogo y sus
   columnas varían por cliente. Por eso las series son Record<string, …> y no
   interfaces cerradas — cerrarlas rompería el golden stack (imagen idéntica,
   config por cliente). */

/** Sobre universal de toda respuesta v1 (contrato §2.4). */
export interface Envelope<T> {
  meta: {
    generated_at: string;
    count?: number;
    unit?: string;
    from?: string;
    to?: string;
    [k: string]: unknown;
  };
  data: T;
}

/** Convención de tiempo del contrato §2.2 — uniforme en TODO endpoint temporal. */
export interface TimeParams {
  from?: string;
  to?: string;
  range?: string; // '24h' | '3d' | '7d' | '30d' … (azúcar para from/to)
}

/* ── Infraestructura ── */

export interface AppConfig {
  grafana_url: string;
  site_label: string;
  /** Huso de la planta (IANA). Opcional: contra una API anterior a 2026-07-17
      no viene, y el selector de fechas cae al huso del navegador. */
  site_tz?: string;
}

/* ── Familia 1 — UNS ── */

export interface UnsTopic {
  topic: string;
  categoria: 'dat' | 'sts' | 'evt';
  mensajes: number;
  ultimo: string;
}

/** Fila de dat/raw y diag (v_process_readings). */
export interface UnsReading {
  ts: string;
  src: string;
  field: string;
  display_name: string | null;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  quality: string | null;
}

/* ── Familia 2 — KPIs ── */

export interface KpiCatalogEntry {
  name: string;
  view_name: string;
  topic: string;
  unit: string;
  description: string;
}

/** Fila de una vista gold: columnas por cliente; solo la temporal es segura. */
export type KpiRow = Record<string, number | string | boolean | null>;

/* ── Alarmas ── */

export type Severity = 'info' | 'warn' | 'alarm' | 'critical';

export interface AlertRow {
  ts: string;
  src: string;
  evt_type: string;
  severity: Severity;
  value: number | null;
  threshold: number | null;
  unit: string | null;
  msg: string;
}

/* ── Familia 4 — Administración ── */

/** Fila completa del catálogo (GET /admin/kpis incluye los deshabilitados). */
export interface AdminKpi {
  name: string;
  view_name: string;
  topic: string;
  derived_from: string;
  time_column: string;
  unit: string;
  /** campo → unidad. SUS CLAVES DEFINEN QUÉ SE PUBLICA al UNS. */
  units: Record<string, string>;
  description: string;
  publish: boolean;
  enabled: boolean;
}

/** Cuerpo del PUT /admin/kpis/{name} (el name va en la ruta). */
export type KpiIn = Omit<AdminKpi, 'name'>;

export interface AssetTag {
  src: string;
  field: string;
  display_name: string;
  unit: string;
  area: string;
  min_limit: number | null;
  max_limit: number | null;
  is_numeric: boolean;
}

export type TagIn = Omit<AssetTag, 'src' | 'field'>;

/** Parámetro de negocio (el "tercer catálogo": qué vale el negocio). */
export interface BusinessParam {
  param: string;
  value: number;
  unit: string;
  description: string;
  updated_at: string;
}

export type BizParamIn = Pick<BusinessParam, 'value' | 'unit' | 'description'>;

export interface KpiDeleteResult {
  deleted: string;
  /** Tópico cuyo retained puede quedar huérfano si el write-back estaba parado. */
  retained_por_limpiar: string | null;
}

/** /admin/health — OJO: NO usa el sobre {meta,data}; claves en español, tal cual. */
export interface AdminHealth {
  status: 'ok' | 'degraded' | 'down';
  db: boolean;
  error?: string;
  ingesta?: { tabla: string; ultimo: string | null; hace_s: number | null }[];
  dispositivos_mudos?: { src: string; ultimo: string; hace_s: number }[];
  kpis_rotos?: { name: string; view_name: string }[];
}

export interface ServiceInfo {
  name: string;
  title: string;
  version: string | null;
  base_path: string;
  openapi_url: string;
  docs_url: string;
  families: string[];
}
