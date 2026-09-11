/* Catálogo de KPIs — la vista que demuestra que configurar no es desplegar: un
   PUT aquí cambia qué expone /api/v1/kpi sin tocar el servidor ni reiniciar nada.

   La lógica de cada KPI vive en su vista gold (regla anti-dilución del contrato
   §10.2: ningún consumidor calcula KPIs). Aquí solo se registra cuál es la vista,
   por qué columna se filtra el tiempo y en qué unidad se reporta.

   · Se enseñan TAMBIÉN los deshabilitados (GET /admin/kpis) — apagar en vez de
     borrar, o no habría forma de reencender.
   · Los 422 se muestran TAL CUAL: la API dice qué columnas existen, y eso es
     media ayuda contextual gratis.
   · Toda escritura confirma antes: cambia lo que ven los consumidores. */
import { useState } from 'react';

import { ApiError } from '../../api/client';
import { useAdminKpis, useDeleteKpi, usePutKpi } from '../../api/hooks';
import type { AdminKpi, KpiIn } from '../../api/types';
import { ConfirmDialog, ErrorState, Loading } from '../../components/ui';

const EMPTY: KpiIn = {
  view_name: '',
  topic: '',
  derived_from: '',
  time_column: 'hour',
  unit: '',
  description: '',
  enabled: true,
};

export function CatalogoKpis() {
  const kpis = useAdminKpis();
  const put = usePutKpi();
  const del = useDeleteKpi();

  const [editing, setEditing] = useState<{ name: string; body: KpiIn; isNew: boolean } | null>(null);
  const [toggling, setToggling] = useState<AdminKpi | null>(null);
  const [deleting, setDeleting] = useState<AdminKpi | null>(null);

  function confirmToggle() {
    if (!toggling) return;
    const body: KpiIn = { ...toggling, enabled: !toggling.enabled };
    put.mutate(
      { name: toggling.name, body },
      { onSuccess: () => setToggling(null) },
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    del.mutate(deleting.name, { onSuccess: () => setDeleting(null) });
  }

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">Familia 4 · la lógica vive en la vista gold; aquí se registra</div>
        <h1>Catálogo de KPIs</h1>
      </div>

      <div className="toolbar">
        <span className="label">
          La lógica vive en la vista gold; aquí solo se registra. Para apagar, mejor
          `enabled=off` que borrar: es reversible.
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => setEditing({ name: '', body: { ...EMPTY }, isNew: true })}>
          Nuevo KPI
        </button>
      </div>

      {kpis.isPending && <Loading />}
      {kpis.isError && <ErrorState error={kpis.error} />}
      {kpis.isSuccess && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Vista gold</th>
                  <th>Dirección UNS</th>
                  <th>Unidad</th>
                  <th>Activo</th>
                  <th className="actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {kpis.data.data.map((k) => (
                  <tr key={k.name} className={k.enabled ? '' : 'off'}>
                    <td>
                      <strong>{k.name}</strong>
                      {k.description && (
                        <span className="label" style={{ display: 'block', letterSpacing: 0.5 }}>
                          {k.description}
                        </span>
                      )}
                    </td>
                    <td className="mono">{k.view_name}</td>
                    <td className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                      {k.topic}
                    </td>
                    <td>{k.unit || '—'}</td>
                    <td>
                      <Toggle
                        on={k.enabled}
                        label={`estado de ${k.name}`}
                        onClick={() => setToggling(k)}
                      />
                    </td>
                    <td className="actions">
                      <button
                        className="btn ghost"
                        onClick={() => {
                          const { name, ...body } = k;
                          setEditing({ name, body, isNew: false });
                        }}
                      >
                        Editar
                      </button>{' '}
                      <button className="btn danger" onClick={() => setDeleting(k)}>
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toggling && (
        <ConfirmDialog
          title={`Cambiar estado de '${toggling.name}'`}
          busy={put.isPending}
          onCancel={() => {
            put.reset();
            setToggling(null);
          }}
          onConfirm={confirmToggle}
        >
          <p>
            {toggling.enabled
              ? 'El KPI se apaga: desaparece de la API pública, pero conserva su configuración.'
              : 'El KPI se enciende: vuelve a estar disponible en /api/v1/kpi.'}
          </p>
          {put.isError && <PutError error={put.error} />}
        </ConfirmDialog>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Borrar '${deleting.name}' del catálogo`}
          confirmLabel="Borrar"
          danger
          busy={del.isPending}
          onCancel={() => {
            del.reset();
            setDeleting(null);
          }}
          onConfirm={confirmDelete}
        >
          <p>
            Se pierde su registro en el catálogo: la vista gold sigue existiendo en la
            base y se puede consultar por SQL, pero el KPI desaparece de la API. Si solo
            quieres apagarlo, cancela y usa el interruptor «Activo» — es reversible.
          </p>
          {del.isError && <PutError error={del.error} />}
        </ConfirmDialog>
      )}

      {editing && (
        <KpiEditor
          initial={editing}
          busy={put.isPending}
          error={put.isError ? put.error : null}
          onCancel={() => {
            put.reset();
            setEditing(null);
          }}
          onSave={(name, body) =>
            put.mutate({ name, body }, { onSuccess: () => setEditing(null) })
          }
        />
      )}
    </>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`badge ${on ? 'online' : 'standby'}`}
      style={{ cursor: 'pointer', border: 'none' }}
      aria-label={`Cambiar ${label}`}
      onClick={onClick}
    >
      {on ? 'sí' : 'no'}
    </button>
  );
}

/* El 422 de la API se muestra tal cual: dice qué columnas existen. */
function PutError({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div className="callout error" role="alert">
      {e ? `${e.status === 422 ? 'Validación: ' : ''}${e.detail}` : String(error)}
    </div>
  );
}

function KpiEditor({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: { name: string; body: KpiIn; isNew: boolean };
  busy: boolean;
  error: unknown | null;
  onSave: (name: string, body: KpiIn) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [body, setBody] = useState<KpiIn>(initial.body);

  const set = <K extends keyof KpiIn>(k: K, v: KpiIn[K]) => setBody((b) => ({ ...b, [k]: v }));

  function save() {
    onSave(name.trim(), body);
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{initial.isNew ? 'Nuevo KPI' : `Editar '${initial.name}'`}</h2>
        <p className="label" style={{ marginBottom: 14 }}>
          La vista gold debe existir ya en la base (gold.sql) — aquí solo se registra.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>Nombre</span>
            <input
              type="text"
              value={name}
              disabled={!initial.isNew}
              onChange={(e) => setName(e.target.value)}
              placeholder="scrap_rate"
            />
            {initial.isNew && <span className="hint">Será la ruta: /api/v1/kpi/&lt;nombre&gt;</span>}
          </label>
          <label className="field">
            <span>Vista gold</span>
            <input
              type="text"
              value={body.view_name}
              onChange={(e) => set('view_name', e.target.value)}
              placeholder="v_scrap_rate_hourly"
            />
          </label>
          <label className="field wide">
            <span>Dirección en el espacio de nombres</span>
            <input
              type="text"
              value={body.topic}
              onChange={(e) => set('topic', e.target.value)}
              placeholder="greytec/demo/produccion/llenado/_kpi/scrap_rate"
            />
            <span className="hint">
              La dirección canónica del KPI en la jerarquía (contrato §3.2). Sin comodines
              +/# ni barras al inicio o final.
            </span>
          </label>
          <label className="field">
            <span>Columna temporal</span>
            <input
              type="text"
              value={body.time_column}
              onChange={(e) => set('time_column', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Unidad titular</span>
            <input type="text" value={body.unit} onChange={(e) => set('unit', e.target.value)} />
          </label>
          <label className="field wide">
            <span>Descripción</span>
            <input
              type="text"
              value={body.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Derivado de (src)</span>
            <input
              type="text"
              value={body.derived_from}
              onChange={(e) => set('derived_from', e.target.value)}
              placeholder="plc-llenado-01, medidor-02"
            />
          </label>
          <div className="field">
            <span>Flags</span>
            <label className="check">
              <input
                type="checkbox"
                checked={body.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              enabled — visible para consumidores
            </label>
          </div>
        </div>

        {error != null && <PutError error={error} />}

        <div className="dialog-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className="btn" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Guardando…' : 'Guardar (PUT)'}
          </button>
        </div>
      </div>
    </div>
  );
}
