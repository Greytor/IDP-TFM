/* Catálogo de KPIs (issue 2.2-C) — la vista que demuestra la tesis del
   producto: configurar no es desplegar. Un PUT aquí surte efecto en el UNS en
   ≤30 s (el tick del write-back), sin tocar el servidor.

   Decisiones que vienen del contrato §3.4:
   · Se enseñan TAMBIÉN los deshabilitados (GET /admin/kpis) — apagar en vez de
     borrar, o no habría forma de reencender.
   · Los 422 se muestran TAL CUAL: la API dice qué columnas existen, y eso es
     media ayuda contextual gratis.
   · Toda escritura confirma antes: esto cambia lo que se publica al UNS.
   · Al borrar, si viene `retained_por_limpiar`, se avisa: ese retained puede
     quedar huérfano en el broker si el write-back estaba parado. */
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
  units: {},
  description: '',
  publish: true,
  enabled: true,
};

export function CatalogoKpis() {
  const kpis = useAdminKpis();
  const put = usePutKpi();
  const del = useDeleteKpi();

  const [editing, setEditing] = useState<{ name: string; body: KpiIn; isNew: boolean } | null>(null);
  const [toggling, setToggling] = useState<{ kpi: AdminKpi; field: 'enabled' | 'publish' } | null>(null);
  const [deleting, setDeleting] = useState<AdminKpi | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function confirmToggle() {
    if (!toggling) return;
    const { kpi, field } = toggling;
    const body: KpiIn = { ...kpi, [field]: !kpi[field] };
    put.mutate(
      { name: kpi.name, body },
      { onSuccess: () => setToggling(null) },
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    del.mutate(deleting.name, {
      onSuccess: (res) => {
        setDeleting(null);
        if (res.data.retained_por_limpiar) {
          setAviso(
            `El KPI '${res.data.deleted}' se borró, pero su tópico ` +
              `'${res.data.retained_por_limpiar}' publicaba retained. Si el ` +
              `write-back estaba parado en este momento, ese retained queda ` +
              `huérfano en el broker y hay que limpiarlo a mano (contrato §3.4).`,
          );
        }
      },
    });
  }

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">Familia 4 · un cambio aquí llega al UNS en ≤30 s</div>
        <h1>Catálogo de KPIs</h1>
      </div>

      {aviso && (
        <div className="callout" role="alert">
          {aviso}{' '}
          <button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => setAviso(null)}>
            Entendido
          </button>
        </div>
      )}

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
                  <th>Tópico UNS</th>
                  <th>Unidad</th>
                  <th>Publica</th>
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
                        on={k.publish}
                        label={`publicación de ${k.name}`}
                        onClick={() => setToggling({ kpi: k, field: 'publish' })}
                      />
                    </td>
                    <td>
                      <Toggle
                        on={k.enabled}
                        label={`estado de ${k.name}`}
                        onClick={() => setToggling({ kpi: k, field: 'enabled' })}
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
          title={`Cambiar ${toggling.field === 'publish' ? 'publicación' : 'estado'} de '${toggling.kpi.name}'`}
          busy={put.isPending}
          onCancel={() => {
            put.reset();
            setToggling(null);
          }}
          onConfirm={confirmToggle}
        >
          <p>
            {toggling.field === 'publish'
              ? toggling.kpi.publish
                ? 'Dejará de publicarse al UNS. El write-back limpia su retained en el siguiente tick.'
                : `Volverá a publicarse en '${toggling.kpi.topic}' (retained) en ≤30 s.`
              : toggling.kpi.enabled
                ? 'El KPI se apaga: desaparece de la API pública y del UNS, pero conserva su configuración.'
                : 'El KPI se enciende: vuelve a la API pública y, si publica, al UNS en ≤30 s.'}
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
            Se pierde su configuración (vista, tópico, unidades). Si solo quieres
            apagarlo, cancela y usa el interruptor «Activo» — es reversible.
          </p>
          {deleting.publish && (
            <div className="callout">
              Este KPI publica retained en <code>{deleting.topic}</code>. El
              write-back lo limpia solo en el siguiente tick — salvo que esté
              parado ahora mismo, en cuyo caso el retained queda huérfano.
            </div>
          )}
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
  // Las unidades se editan como filas campo→unidad; las CLAVES definen qué se
  // publica al UNS (contrato §3.4) — por eso el editor las trata con nombre.
  const [unitRows, setUnitRows] = useState<[string, string][]>(
    Object.entries(initial.body.units),
  );

  const set = <K extends keyof KpiIn>(k: K, v: KpiIn[K]) => setBody((b) => ({ ...b, [k]: v }));

  function save() {
    const units = Object.fromEntries(unitRows.filter(([k]) => k.trim() !== ''));
    onSave(name.trim(), { ...body, units });
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
            <span>Tópico UNS (destino del write-back)</span>
            <input
              type="text"
              value={body.topic}
              onChange={(e) => set('topic', e.target.value)}
              placeholder="greytec/demo/produccion/llenado/_kpi/scrap_rate"
            />
            <span className="hint">Sin comodines +/# ni barras al inicio o final.</span>
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
                checked={body.publish}
                onChange={(e) => set('publish', e.target.checked)}
              />
              publish — el write-back lo saca al UNS
            </label>
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

        <div className="field">
          <span>Campos publicados (campo → unidad)</span>
          <span className="hint">
            Las claves definen QUÉ columnas de la vista salen al UNS. publish=on con
            esto vacío se rechaza (422).
          </span>
          {unitRows.map(([k, v], i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                style={{ flex: 2, border: '1px solid var(--rule)', padding: '6px 8px' }}
                value={k}
                placeholder="columna"
                onChange={(e) =>
                  setUnitRows((rows) => rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))
                }
              />
              <input
                type="text"
                style={{ flex: 1, border: '1px solid var(--rule)', padding: '6px 8px' }}
                value={v}
                placeholder="unidad"
                onChange={(e) =>
                  setUnitRows((rows) => rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))
                }
              />
              <button
                className="btn ghost"
                onClick={() => setUnitRows((rows) => rows.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn outline"
            style={{ alignSelf: 'flex-start', marginTop: 6 }}
            onClick={() => setUnitRows((rows) => [...rows, ['', '']])}
          >
            Añadir campo
          </button>
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
