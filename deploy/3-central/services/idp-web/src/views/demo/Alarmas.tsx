/* Alarmas del periodo (GET /api/v1/alerts) con filtros de rango y severidad.
   La tabla dice la verdad sobre su tope: la API limita, y si el conteo llega
   al límite se avisa en vez de fingir que eso es "todo". */
import { useState } from 'react';

import { useAlerts } from '../../api/hooks';
import type { Severity } from '../../api/types';
import { Empty, ErrorState, Loading, SeverityBadge } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

const RANGES = ['24h', '3d', '7d', '30d'] as const;
const SEVERITIES: (Severity | 'todas')[] = ['todas', 'info', 'warn', 'alarm', 'critical'];
const LIMIT = 500;

export function Alarmas() {
  const [range, setRange] = useState<(typeof RANGES)[number]>('24h');
  const [sev, setSev] = useState<Severity | 'todas'>('todas');

  const alerts = useAlerts({
    range,
    severity: sev === 'todas' ? undefined : sev,
    limit: LIMIT,
  });

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">Eventos del pipeline · v_alerts_recent</div>
        <h1>Alarmas</h1>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Rango">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === range}
              className={r === range ? 'on' : ''}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="Severidad">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={s === sev}
              className={s === sev ? 'on' : ''}
              onClick={() => setSev(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {alerts.isSuccess && (
          <span className="label num">
            {alerts.data.data.length}
            {alerts.data.data.length >= LIMIT ? `+ (tope ${LIMIT})` : ''} eventos
          </span>
        )}
      </div>

      {alerts.isPending && <Loading />}
      {alerts.isError && <ErrorState error={alerts.error} />}
      {alerts.isSuccess && alerts.data.data.length === 0 && (
        <Empty>Sin eventos con estos filtros. En una planta, eso es buena noticia.</Empty>
      )}
      {alerts.isSuccess && alerts.data.data.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Severidad</th>
                  <th>Origen</th>
                  <th>Tipo</th>
                  <th>Mensaje</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {alerts.data.data.map((a, i) => (
                  <tr key={`${a.ts}-${i}`}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDateTime(a.ts)}
                    </td>
                    <td>
                      <SeverityBadge severity={a.severity} />
                    </td>
                    <td className="mono">{a.src}</td>
                    <td className="mono">{a.evt_type}</td>
                    <td>{a.msg}</td>
                    <td className="num">
                      {a.value != null
                        ? `${a.value}${a.unit ? ` ${a.unit}` : ''}${a.threshold != null ? ` / ${a.threshold}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
