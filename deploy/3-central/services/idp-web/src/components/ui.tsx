/* Piezas compartidas. Regla heredada del journal 2.1 §5: un rojo que siempre
   está rojo enseña a ignorar los rojos — los estados de error dicen QUÉ pasó
   (403 no es 503) y solo se pintan cuando de verdad es un error. */
import type { ReactNode } from 'react';

import { ApiError } from '../api/client';
import type { Severity } from '../api/types';

export function Loading({ children = 'Cargando…' }: { children?: ReactNode }) {
  return <div className="state">{children}</div>;
}

export function ErrorState({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div className="state error" role="alert">
      <div className="big">{e ? e.friendly : 'Algo salió mal'}</div>
      {e && e.status > 0 && (
        <div>
          HTTP {e.status} · {e.detail}
        </div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

const SEV_CLASS: Record<Severity, string> = {
  info: 'steel',
  warn: 'warning',
  alarm: 'fault',
  critical: 'fault',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${SEV_CLASS[severity] ?? 'standby'}`}>{severity}</span>;
}

/** Frescura → semántico. El umbral por defecto casa con el heartbeat del edge. */
export function FreshnessBadge({ seconds, label }: { seconds: number | null; label: string }) {
  if (seconds == null) return <span className="badge standby">{label}: sin dato</span>;
  const cls = seconds < 120 ? 'online' : seconds < 600 ? 'warning' : 'fault';
  return (
    <span className={`badge ${cls}`}>
      {label} {seconds < 120 ? 'en línea' : 'con retraso'}
    </span>
  );
}

/** Sparkline SVG sin dependencias — la tendencia, no los detalles (para eso
    están los dashboards de Grafana). */
export function Sparkline({
  values,
  width = 180,
  height = 56,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const pts = values.filter((v) => v != null && !Number.isNaN(v));
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const d = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 6 - ((v - min) / span) * (height - 12)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--steel)" strokeWidth="1.5" />
      <circle
        cx={width}
        cy={height - 6 - ((pts[pts.length - 1] - min) / span) * (height - 12)}
        r="2.5"
        fill="var(--electric)"
      />
    </svg>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Confirmar',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className={`btn${danger ? ' danger' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Aplicando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
