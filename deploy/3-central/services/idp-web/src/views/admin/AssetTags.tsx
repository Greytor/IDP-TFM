/* Asset tags: el diccionario (src, field) → nombre, unidad, límites. Es lo que
   hace legible el dato crudo — silver hace INNER JOIN con esta tabla, así que un
   campo sin etiqueta NO aflora en la Familia 1.

   SOLO LECTURA por diseño. Esta tabla se materializa desde la categoría `def` del
   espacio de nombres, que publica el gateway: el productor es la autoridad sobre
   qué significan sus propias variables (contrato §4.0). Editarla desde aquí sería
   una aplicación escribiendo en una capa derivada (RNF4) y no serviría de nada: el
   consumidor reaplica el `def` retenido en cada reconexión del puente y revertiría
   el cambio. Para cambiar una etiqueta se edita definitions.yml en el borde, se
   sube `rev` y se republica. */
import { useMemo, useState } from 'react';

import { useAssetTags } from '../../api/hooks';
import { ErrorState, Loading } from '../../components/ui';

export function AssetTags() {
  const tags = useAssetTags();
  const [srcFilter, setSrcFilter] = useState<string>('todos');

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
          Materializado desde la categoría <code>def</code> — no se edita aquí
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
