/* El UNS en vivo — el consumidor que la Familia 1 no tenía (propuesta aceptada
   del traspaso 2.2-A: "es lo que diferencia este producto de un Grafana con
   datos"). El árbol ES el argumento de venta: la jerarquía ISA-95 del cliente,
   navegable, con el último valor de cada tópico al hacer clic.

   El árbol se construye desde GET /api/v1/uns/topics — nada va escrito: en la
   planta de otro cliente este mismo código pinta SU jerarquía. El prefijo común
   (aquí greytec/demo) se detecta y se muestra como raíz para no hacer scroll
   por niveles que no discriminan. */
import { useMemo, useState } from 'react';

import { useUnsLatest, useUnsTopics } from '../../api/hooks';
import type { KpiRow, UnsAsset, UnsTopic } from '../../api/types';
import { Empty, ErrorState, Loading } from '../../components/ui';
import { ago, fmtDateTime, fmt } from '../../lib/format';

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  /** Presente si este nodo es un tópico real del historiador. */
  topic?: UnsTopic;
}

function buildTree(topics: UnsTopic[]): { prefix: string; root: TreeNode } {
  // Prefijo común por segmentos: niveles que no discriminan van al encabezado.
  const split = topics.map((t) => t.topic.split('/'));
  let prefixLen = 0;
  if (split.length > 1) {
    const first = split[0];
    while (
      prefixLen < first.length - 1 &&
      split.every((s) => s.length > prefixLen + 1 && s[prefixLen] === first[prefixLen])
    ) {
      prefixLen++;
    }
  }
  const prefix = split[0]?.slice(0, prefixLen).join('/') ?? '';

  const root: TreeNode = { name: '', children: new Map() };
  for (const t of topics) {
    const segs = t.topic.split('/').slice(prefixLen);
    let node = root;
    for (const seg of segs) {
      if (!node.children.has(seg)) {
        node.children.set(seg, { name: seg, children: new Map() });
      }
      node = node.children.get(seg)!;
    }
    node.topic = t;
  }
  return { prefix, root };
}

export function Namespace() {
  const topics = useUnsTopics();
  const [selected, setSelected] = useState<UnsTopic | null>(null);

  const tree = useMemo(
    () => (topics.data ? buildTree(topics.data.data) : null),
    [topics.data],
  );

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">Unified Namespace · espejo histórico (Familia 1)</div>
        <h1>Namespace de la planta</h1>
      </div>

      {topics.isPending && <Loading>Descubriendo tópicos…</Loading>}
      {topics.isError && <ErrorState error={topics.error} />}
      {tree && (
        <>
          <div className="toolbar">
            <span className="badge steel mono">{tree.prefix || '(raíz)'}</span>
            <span className="label num">{topics.data!.data.length} tópicos con datos</span>
          </div>
          <div className="split">
            <div className="card">
              <div className="card-title">Árbol de tópicos</div>
              <div className="tree">
                <Branch node={tree.root} depth={0} selected={selected} onSelect={setSelected} />
              </div>
            </div>
            <TopicDetail topic={selected} />
          </div>
        </>
      )}
    </>
  );
}

function Branch({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: UnsTopic | null;
  onSelect: (t: UnsTopic) => void;
}) {
  const entries = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {entries.map((child) =>
        child.topic && child.children.size === 0 ? (
          <button
            key={child.name}
            type="button"
            className={`leaf${selected?.topic === child.topic.topic ? ' sel' : ''}`}
            onClick={() => onSelect(child.topic!)}
          >
            <span className="mono">{child.name}</span>
            <span className="cat">{child.topic.categoria}</span>
            <span className="meta num">{ago(child.topic.ultimo)}</span>
          </button>
        ) : (
          <details key={child.name} open={depth < 3}>
            <summary>
              <span className="mono">{child.name}</span>
            </summary>
            <Branch node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          </details>
        ),
      )}
    </>
  );
}

function TopicDetail({ topic }: { topic: UnsTopic | null }) {
  const latest = useUnsLatest(topic?.topic ?? null);

  if (!topic) {
    return (
      <Empty>
        Elige un tópico del árbol: verás su último valor tal como lo dejó el
        pipeline — la misma dirección a la que se suscribe un SCADA en MQTT.
      </Empty>
    );
  }

  const esDef = topic.categoria === 'def';

  return (
    <div className="card">
      <div className="card-title">{esDef ? 'Definición del activo' : 'Último valor'}</div>
      <p className="mono" style={{ fontSize: 12, wordBreak: 'break-all', marginBottom: 10 }}>
        {topic.topic}
      </p>
      <p className="label num" style={{ marginBottom: 12 }}>
        {esDef
          ? `revisión ${topic.mensajes} · materializada ${ago(topic.ultimo)}`
          : `${fmt(topic.mensajes, 0)} mensajes en el historiador · último ${ago(topic.ultimo)}`}
      </p>
      {latest.isPending && <Loading />}
      {latest.isError && <ErrorState error={latest.error} />}
      {latest.isSuccess && latest.data.data.length === 0 && (
        <Empty>Este tópico no tiene lecturas con etiqueta registrada (asset_tags).</Empty>
      )}
      {latest.isSuccess && esDef && (
        <Definicion
          asset={(latest.data.meta.asset as UnsAsset) ?? {}}
          rev={latest.data.meta.rev as number | undefined}
          variables={latest.data.data}
        />
      )}
      {latest.isSuccess && !esDef && latest.data.data.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Señal</th>
                <th>Valor</th>
                <th>Hora</th>
              </tr>
            </thead>
            <tbody>
              {latest.data.data.map((r, i) => {
                const label =
                  (r.display_name as string) ?? (r.field as string) ?? (r.signal as string) ?? '—';
                const value =
                  typeof r.value === 'number'
                    ? `${fmt(r.value)}${r.unit ? ` ${r.unit}` : ''}`
                    : ((r.value_text as string) ?? (r.msg as string) ?? String(r.value ?? '—'));
                return (
                  <tr key={i}>
                    <td>
                      {label}
                      {typeof r.field === 'string' && r.display_name ? (
                        <span className="label" style={{ display: 'block', letterSpacing: 1 }}>
                          {r.field}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{value}</td>
                    <td className="num">{fmtDateTime(r.ts as string)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* El `def` renderizado: identidad del activo y su diccionario de variables (§4.0).
   Es la única categoría con vista propia, y con motivo: las otras cinco transportan
   un valor medido, esta transporta el modelo de datos del activo. Meter ambas cosas
   en una tabla de "señal / valor" obligaba a concatenar cuatro campos en una cadena
   y perdía la identidad entera (fabricante, serie, protocolo, jerarquía). */
function Definicion({
  asset,
  rev,
  variables,
}: {
  asset: UnsAsset;
  rev?: number;
  variables: KpiRow[];
}) {
  const identidad: Array<[string, string]> = [];
  const add = (k: string, v?: string) => {
    if (v) identidad.push([k, v]);
  };
  add('Tipo', asset.type);
  add('Área', asset.area);
  add('Depende de', asset.parent);
  add('Fabricante', [asset.manufacturer, asset.model].filter(Boolean).join(' · '));
  add('Nº de serie', asset.serial);
  add('Protocolo', asset.protocol);
  add('Dirección', asset.endpoint);

  const limites = (r: KpiRow): string => {
    const lo = r.min_limit as number | null;
    const hi = r.max_limit as number | null;
    if (lo == null && hi == null) return '—';
    return `${lo ?? '−∞'} … ${hi ?? '+∞'}`;
  };

  return (
    <>
      {asset.display_name ? (
        <p style={{ fontWeight: 600, marginBottom: 8 }}>
          {asset.display_name}
          {rev != null ? (
            <span className="label" style={{ marginLeft: 8 }}>
              rev {rev}
            </span>
          ) : null}
        </p>
      ) : null}

      {identidad.length > 0 ? (
        <div className="tbl-wrap" style={{ marginBottom: 16 }}>
          <table className="tbl">
            <tbody>
              {identidad.map(([k, v]) => (
                <tr key={k}>
                  <td className="label" style={{ width: '35%' }}>
                    {k}
                  </td>
                  <td className="mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Unidad</th>
              <th>Canal</th>
              <th>Umbral</th>
              <th>Límites</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((r, i) => (
              <tr key={i}>
                <td>
                  {(r.display_name as string) || (r.field as string)}
                  <span className="label" style={{ display: 'block', letterSpacing: 1 }}>
                    {r.field as string}
                  </span>
                </td>
                <td>{(r.unit as string) || '—'}</td>
                <td className="mono">{(r.channel as string) || '—'}</td>
                <td className="num">{r.deadband == null ? '—' : fmt(r.deadband as number)}</td>
                <td className="num">{limites(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
