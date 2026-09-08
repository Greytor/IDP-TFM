/* Parámetros de negocio — el tercer catálogo: qué VALE el negocio.

   Un PUT aquí recalcula el dinero (KPI 'business', vista v_business_hourly) en
   la siguiente consulta, sin reiniciar nada — configurar no es desplegar, con
   plata. En un cliente real estas filas las escribe un conector desde su ERP
   contra los mismos endpoints; esta pantalla es el modo manual.

   Toda escritura confirma antes: cambia los números de dinero de la web y de
   todos los PDFs que se generen desde ese momento. */
import { useState } from 'react';

import { ApiError } from '../../api/client';
import { useBusinessParams, usePutBusinessParam } from '../../api/hooks';
import type { BizParamIn, BusinessParam } from '../../api/types';
import { ErrorState, Loading } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

const EMPTY: BizParamIn = { value: 0, unit: '', description: '' };

export function ParametrosNegocio() {
  const params = useBusinessParams();
  const put = usePutBusinessParam();

  const [editing, setEditing] = useState<{ param: string; body: BizParamIn; isNew: boolean } | null>(null);

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">
          Los leen las vistas gold — un cambio recalcula el dinero al instante
        </div>
        <h1>Parámetros de negocio</h1>
      </div>

      <div className="toolbar">
        <span className="label">
          Hoy los editas aquí; en un cliente, su ERP escribe esta misma tabla por
          la API. Todo número monetario de la plataforma declara estos supuestos.
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => setEditing({ param: '', body: { ...EMPTY }, isNew: true })}>
          Nuevo parámetro
        </button>
      </div>

      {params.isPending && <Loading />}
      {params.isError && <ErrorState error={params.error} />}
      {params.isSuccess && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Parámetro</th>
                  <th>Valor</th>
                  <th>Unidad</th>
                  <th>Descripción</th>
                  <th>Actualizado</th>
                  <th className="actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {params.data.data.map((p: BusinessParam) => (
                  <tr key={p.param}>
                    <td className="mono">{p.param}</td>
                    <td className="num">
                      <strong>{p.value}</strong>
                    </td>
                    <td>{p.unit || '—'}</td>
                    <td>{p.description || '—'}</td>
                    <td className="num">{fmtDateTime(p.updated_at)}</td>
                    <td className="actions">
                      <button
                        className="btn ghost"
                        onClick={() =>
                          setEditing({
                            param: p.param,
                            body: { value: p.value, unit: p.unit, description: p.description },
                            isNew: false,
                          })
                        }
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <ParamEditor
          initial={editing}
          busy={put.isPending}
          error={put.isError ? put.error : null}
          onCancel={() => {
            put.reset();
            setEditing(null);
          }}
          onSave={(param, body) =>
            put.mutate({ param, body }, { onSuccess: () => setEditing(null) })
          }
        />
      )}
    </>
  );
}

function ParamEditor({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: { param: string; body: BizParamIn; isNew: boolean };
  busy: boolean;
  error: unknown | null;
  onSave: (param: string, body: BizParamIn) => void;
  onCancel: () => void;
}) {
  const [param, setParam] = useState(initial.param);
  const [body, setBody] = useState<BizParamIn>(initial.body);

  const set = <K extends keyof BizParamIn>(k: K, v: BizParamIn[K]) =>
    setBody((b) => ({ ...b, [k]: v }));

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog narrow" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{initial.isNew ? 'Nuevo parámetro' : `Editar '${initial.param}'`}</h2>
        <p className="label" style={{ marginBottom: 14 }}>
          El cambio afecta a todos los cálculos monetarios desde este momento: las
          vistas de oro lo leen en la siguiente consulta, sin reiniciar nada.
        </p>

        <label className="field">
          <span>Nombre</span>
          <input
            type="text"
            value={param}
            disabled={!initial.isNew}
            onChange={(e) => setParam(e.target.value)}
            placeholder="costo_hora_operario"
          />
          {initial.isNew && (
            <span className="hint">
              minúsculas, dígitos y _. Un parámetro nuevo solo surte efecto si una
              vista gold lo usa.
            </span>
          )}
        </label>
        <label className="field">
          <span>Valor</span>
          <input
            type="number"
            step="any"
            value={Number.isNaN(body.value) ? '' : body.value}
            onChange={(e) => set('value', e.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          <span>Unidad</span>
          <input type="text" value={body.unit} onChange={(e) => set('unit', e.target.value)}
                 placeholder="$/kWh" />
        </label>
        <label className="field">
          <span>Descripción</span>
          <input type="text" value={body.description}
                 onChange={(e) => set('description', e.target.value)} />
        </label>

        {error != null && (
          <div className="callout error" role="alert">
            {error instanceof ApiError ? error.detail : String(error)}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className="btn"
            onClick={() => onSave(param.trim(), body)}
            disabled={busy || !param.trim() || Number.isNaN(body.value)}
          >
            {busy ? 'Guardando…' : 'Guardar (PUT)'}
          </button>
        </div>
      </div>
    </div>
  );
}
