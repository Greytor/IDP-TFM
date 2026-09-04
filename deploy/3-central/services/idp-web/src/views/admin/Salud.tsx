/* Salud del PIPELINE (GET /api/v1/admin/health) — no del proceso: frescura de
   ingesta por tabla, dispositivos mudos y KPIs cuyo view_name ya no existe.

   Límite honesto del endpoint (contrato §3.4): solo ve lo que la base alcanza.
   Un silencio no distingue "broker caído" de "celda parada" — y esta vista lo
   dice en vez de fingir que lo sabe. */
import { useState } from 'react';

import { useAdminHealth } from '../../api/hooks';
import { Empty, ErrorState, Loading } from '../../components/ui';
import { agoSeconds, fmtDateTime } from '../../lib/format';

const SILENCIOS = [5, 10, 30] as const;

export function Salud() {
  const [silencio, setSilencio] = useState<(typeof SILENCIOS)[number]>(10);
  const health = useAdminHealth(silencio);

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">
          ¿Está entrando dato y es coherente lo que hay? · se refresca cada 30 s
        </div>
        <h1>Salud del pipeline</h1>
      </div>

      <div className="toolbar">
        <span className="label">Umbral de silencio</span>
        <div className="seg" role="tablist" aria-label="Umbral de silencio">
          {SILENCIOS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={s === silencio}
              className={s === silencio ? 'on' : ''}
              onClick={() => setSilencio(s)}
            >
              {s} min
            </button>
          ))}
        </div>
      </div>

      {health.isPending && <Loading />}
      {health.isError && <ErrorState error={health.error} />}
      {health.isSuccess && <HealthBody h={health.data} silencio={silencio} />}
    </>
  );
}

function HealthBody({
  h,
  silencio,
}: {
  h: import('../../api/types').AdminHealth;
  silencio: number;
}) {
  const badge =
    h.status === 'ok' ? 'online' : h.status === 'degraded' ? 'warning' : 'fault';
  return (
    <>
      <div className="card">
        <div className="card-title">
          Veredicto
          <span className={`badge ${badge}`}>{h.status}</span>
        </div>
        <p style={{ fontSize: 14 }}>
          {h.status === 'ok' &&
            'Entra dato fresco, ningún dispositivo calla y el catálogo es coherente.'}
          {h.status === 'degraded' &&
            'Algo pide atención: mira las secciones de abajo. Un silencio no distingue "broker caído" de "celda parada" — esta vista solo ve la base.'}
          {h.status === 'down' && (
            <>
              La base de datos no responde{h.error ? `: ${h.error}` : '.'}
            </>
          )}
        </p>
      </div>

      {h.ingesta && (
        <div className="card">
          <div className="card-title">Frescura de ingesta (reloj de la base)</div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tabla bronze</th>
                  <th>Último dato</th>
                  <th>Antigüedad</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {h.ingesta.map((i) => {
                  const fresca = i.hace_s != null && i.hace_s < silencio * 60;
                  return (
                    <tr key={i.tabla}>
                      <td className="mono">{i.tabla}</td>
                      <td className="num">{fmtDateTime(i.ultimo)}</td>
                      <td className="num">{agoSeconds(i.hace_s)}</td>
                      <td>
                        <span className={`badge ${fresca ? 'online' : 'warning'}`}>
                          {fresca ? 'fresca' : 'silenciosa'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          Dispositivos mudos · más de {silencio} min sin publicar
        </div>
        {!h.dispositivos_mudos?.length ? (
          <Empty>Ninguno. Todos los dispositivos publican dentro del umbral.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Última publicación</th>
                  <th>Silencio</th>
                </tr>
              </thead>
              <tbody>
                {h.dispositivos_mudos.map((d) => (
                  <tr key={d.src}>
                    <td className="mono">{d.src}</td>
                    <td className="num">{fmtDateTime(d.ultimo)}</td>
                    <td className="num" style={{ color: 'var(--fault)' }}>
                      {agoSeconds(d.hace_s)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">KPIs rotos · catálogo apuntando a vistas inexistentes</div>
        {!h.kpis_rotos?.length ? (
          <Empty>Ninguno. Todo el catálogo apunta a vistas que existen.</Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Vista que falta</th>
                </tr>
              </thead>
              <tbody>
                {h.kpis_rotos.map((k) => (
                  <tr key={k.name}>
                    <td>
                      <strong>{k.name}</strong>
                    </td>
                    <td className="mono" style={{ color: 'var(--fault)' }}>
                      {k.view_name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
