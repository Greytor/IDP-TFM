/* Asset tags (issue 2.2-C): el diccionario (src, field) → nombre, unidad,
   límites. Es lo que hace legible el dato crudo — silver hace INNER JOIN con
   esta tabla, así que un campo sin etiqueta NO aflora en la Familia 1. */
import { useMemo, useState } from 'react';

import { ApiError } from '../../api/client';
import { useAssetTags, useDeleteTag, usePutTag } from '../../api/hooks';
import type { AssetTag, TagIn } from '../../api/types';
import { ConfirmDialog, ErrorState, Loading } from '../../components/ui';

const EMPTY: TagIn = {
  display_name: '',
  unit: '',
  area: '',
  min_limit: null,
  max_limit: null,
  is_numeric: true,
};

export function AssetTags() {
  const tags = useAssetTags();
  const put = usePutTag();
  const del = useDeleteTag();

  const [srcFilter, setSrcFilter] = useState<string>('todos');
  const [editing, setEditing] = useState<{ src: string; field: string; body: TagIn; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<AssetTag | null>(null);

  const sources = useMemo(() => {
    const s = new Set((tags.data?.data ?? []).map((t) => t.src));
    return ['todos', ...[...s].sort()];
  }, [tags.data]);

  const rows = (tags.data?.data ?? []).filter(
    (t) => srcFilter === 'todos' || t.src === srcFilter,
  );

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">
          Un campo sin etiqueta no aflora en la API (INNER JOIN de silver)
        </div>
        <h1>Asset tags</h1>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Dispositivo">
          {sources.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={s === srcFilter}
              className={s === srcFilter ? 'on' : ''}
              onClick={() => setSrcFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() => setEditing({ src: '', field: '', body: { ...EMPTY }, isNew: true })}
        >
          Nueva etiqueta
        </button>
      </div>

      {tags.isPending && <Loading />}
      {tags.isError && <ErrorState error={tags.error} />}
      {tags.isSuccess && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>Campo</th>
                  <th>Nombre</th>
                  <th>Unidad</th>
                  <th>Área</th>
                  <th>Límites</th>
                  <th className="actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={`${t.src}/${t.field}`}>
                    <td className="mono">{t.src}</td>
                    <td className="mono">{t.field}</td>
                    <td>{t.display_name}</td>
                    <td>{t.unit || '—'}</td>
                    <td>{t.area || '—'}</td>
                    <td className="num">
                      {t.min_limit != null || t.max_limit != null
                        ? `${t.min_limit ?? '−∞'} … ${t.max_limit ?? '+∞'}`
                        : '—'}
                    </td>
                    <td className="actions">
                      <button
                        className="btn ghost"
                        onClick={() =>
                          setEditing({
                            src: t.src,
                            field: t.field,
                            body: {
                              display_name: t.display_name,
                              unit: t.unit,
                              area: t.area,
                              min_limit: t.min_limit,
                              max_limit: t.max_limit,
                              is_numeric: t.is_numeric,
                            },
                            isNew: false,
                          })
                        }
                      >
                        Editar
                      </button>{' '}
                      <button className="btn danger" onClick={() => setDeleting(t)}>
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

      {deleting && (
        <ConfirmDialog
          title={`Borrar etiqueta ${deleting.src}/${deleting.field}`}
          confirmLabel="Borrar"
          danger
          busy={del.isPending}
          onCancel={() => {
            del.reset();
            setDeleting(null);
          }}
          onConfirm={() =>
            del.mutate(
              { src: deleting.src, field: deleting.field },
              { onSuccess: () => setDeleting(null) },
            )
          }
        >
          <p>
            Sin etiqueta, las lecturas de <code>{deleting.field}</code> de{' '}
            <code>{deleting.src}</code> dejarán de aflorar en la Familia 1 (el
            INNER JOIN de silver las filtra). El dato crudo sigue entrando a
            bronze — no se pierde, solo deja de interpretarse.
          </p>
          {del.isError && (
            <div className="callout error">
              {del.error instanceof ApiError ? del.error.detail : String(del.error)}
            </div>
          )}
        </ConfirmDialog>
      )}

      {editing && (
        <TagEditor
          initial={editing}
          busy={put.isPending}
          error={put.isError ? put.error : null}
          onCancel={() => {
            put.reset();
            setEditing(null);
          }}
          onSave={(src, field, body) =>
            put.mutate({ src, field, body }, { onSuccess: () => setEditing(null) })
          }
        />
      )}
    </>
  );
}

function TagEditor({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: { src: string; field: string; body: TagIn; isNew: boolean };
  busy: boolean;
  error: unknown | null;
  onSave: (src: string, field: string, body: TagIn) => void;
  onCancel: () => void;
}) {
  const [src, setSrc] = useState(initial.src);
  const [field, setField] = useState(initial.field);
  const [body, setBody] = useState<TagIn>(initial.body);

  const set = <K extends keyof TagIn>(k: K, v: TagIn[K]) => setBody((b) => ({ ...b, [k]: v }));
  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>
          {initial.isNew ? 'Nueva etiqueta' : `Editar ${initial.src}/${initial.field}`}
        </h2>
        <p className="label" style={{ marginBottom: 14 }}>
          La clave es el par (src, field) tal como publica el dispositivo en el UNS.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>src (dispositivo)</span>
            <input
              type="text"
              value={src}
              disabled={!initial.isNew}
              onChange={(e) => setSrc(e.target.value)}
              placeholder="coriolis-01"
            />
          </label>
          <label className="field">
            <span>field (campo del payload)</span>
            <input
              type="text"
              value={field}
              disabled={!initial.isNew}
              onChange={(e) => setField(e.target.value)}
              placeholder="mass_flow_kgh"
            />
          </label>
          <label className="field">
            <span>Nombre para humanos</span>
            <input
              type="text"
              value={body.display_name}
              onChange={(e) => set('display_name', e.target.value)}
              placeholder="Caudal másico"
            />
          </label>
          <label className="field">
            <span>Unidad</span>
            <input
              type="text"
              value={body.unit}
              onChange={(e) => set('unit', e.target.value)}
              placeholder="kg/h"
            />
          </label>
          <label className="field">
            <span>Área</span>
            <input
              type="text"
              value={body.area}
              onChange={(e) => set('area', e.target.value)}
              placeholder="llenado"
            />
          </label>
          <div className="field">
            <span>Tipo</span>
            <label className="check">
              <input
                type="checkbox"
                checked={body.is_numeric}
                onChange={(e) => set('is_numeric', e.target.checked)}
              />
              is_numeric — el valor es un número
            </label>
          </div>
          <label className="field">
            <span>Límite inferior</span>
            <input
              type="number"
              value={body.min_limit ?? ''}
              onChange={(e) => set('min_limit', num(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Límite superior</span>
            <input
              type="number"
              value={body.max_limit ?? ''}
              onChange={(e) => set('max_limit', num(e.target.value))}
            />
          </label>
        </div>

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
            onClick={() => onSave(src.trim(), field.trim(), body)}
            disabled={busy || !src.trim() || !field.trim() || !body.display_name.trim()}
          >
            {busy ? 'Guardando…' : 'Guardar (PUT)'}
          </button>
        </div>
      </div>
    </div>
  );
}
