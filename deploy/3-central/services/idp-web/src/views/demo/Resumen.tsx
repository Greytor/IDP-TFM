/* Portada del demo — lo que un gerente de planta tiene que leer en 30 segundos:
   ¿cómo va la celda AHORA? Jerarquía: 1 cifra crítica (OEE, la única en
   Electric), sus componentes, el acumulado de HOY, y las tarjetas del resto de
   KPIs del catálogo.

   Las tarjetas se construyen DESDE el catálogo (GET /api/v1/kpi): en otro
   cliente habrá otros KPIs y esta vista los pinta igual. TITLES/SUBLINE son
   preferencias de PRESENTACIÓN para los conocidos (los `description` del
   catálogo son técnicos — "fracción en RUNNING" no le dice nada a un gerente);
   para un KPI desconocido se cae al description y al primer campo numérico. */
import { Link } from 'react-router-dom';

import { useAlerts, useBusinessParams, useKpiCatalog, useKpiLive, useKpiSeries } from '../../api/hooks';
import type { KpiCatalogEntry, KpiRow } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState, Loading, SeverityBadge } from '../../components/ui';
import { ago, fmt, fmtDate, fmtUsd } from '../../lib/format';
import { plantMidnightIso } from '../../lib/time';

/** Campo titular por KPI conocido (presentación, no contrato). */
const HEADLINE: Record<string, string> = {
  oee: 'oee_pct',
  production: 'produced',
  availability: 'availability_pct',
  energy: 'kwh',
  energy_intensity: 'wh_per_bottle',
};

/** Título para humanos. Las tarjetas enseñan la CUBETA HORARIA en curso. */
const TITLES: Record<string, string> = {
  production: 'Producción · hora en curso',
  availability: 'Disponibilidad de línea · hora en curso',
  energy: 'Energía · hora en curso',
  energy_intensity: 'Intensidad energética · hora en curso',
};

function headlineOf(name: string, row: KpiRow): number | null {
  const preferred = HEADLINE[name];
  if (preferred && typeof row[preferred] === 'number') return row[preferred];
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'number' && k !== 'is_partial') return v;
  }
  return null;
}

const n = (row: KpiRow, k: string): number | null =>
  typeof row[k] === 'number' ? (row[k] as number) : null;

/* La sublínea explica el titular — y tiene que CUADRAR con él. La de
   disponibilidad enseñaba solo `% parada` y escondía `% falla`: con una falla
   larga se leía "80% · 0% parada", que parece un error (2026-07-17). El tiempo
   de línea se reparte en marcha + parada + falla: se enseñan las tres partes. */
function Subline({ name, row }: { name: string; row: KpiRow }) {
  if (name === 'availability') {
    const avail = n(row, 'availability_pct');
    const stopped = n(row, 'stopped_pct');
    const fault = n(row, 'fault_pct');
    if (stopped == null && fault == null) return null;
    // El resto hasta 100 es tiempo que no es marcha, parada ni falla (arranques
    // de línea): se enseña como "otros" para que la cuenta cierre a la vista
    // (2026-07-17 — antes el desglose sumaba ~95 y parecía un error).
    const otros =
      avail != null ? Math.max(0, 100 - avail - (stopped ?? 0) - (fault ?? 0)) : null;
    return (
      <span className={`sub num${(fault ?? 0) > 0 ? ' fault' : ''}`}>
        {fmt(stopped)} % parada · {fmt(fault)} % falla
        {otros != null ? ` · ${fmt(otros)} % otros` : ''}
      </span>
    );
  }
  if (name === 'production') {
    const good = n(row, 'good');
    const rejected = n(row, 'rejected');
    if (good == null && rejected == null) return null;
    return (
      <span className="sub num">
        {fmt(good, 0)} buenas · {fmt(rejected, 0)} rechazadas
      </span>
    );
  }
  if (name === 'energy') {
    const avg = n(row, 'avg_power_w');
    const max = n(row, 'max_power_w');
    if (avg == null && max == null) return null;
    // En kW: "2887 W medios" obligaba a dividir de cabeza (2026-07-17).
    return (
      <span className="sub num">
        potencia media {fmt(avg != null ? avg / 1000 : null)} kW · pico{' '}
        {fmt(max != null ? max / 1000 : null)} kW
      </span>
    );
  }
  return null;
}

export function Resumen() {
  const catalog = useKpiCatalog();

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">En vivo · se actualiza cada 15 s</div>
        <h1>Resumen de planta</h1>
      </div>

      <HeroOee />

      <EconomicoHoy />

      {catalog.isPending && <Loading />}
      {catalog.isError && <ErrorState error={catalog.error} />}
      {catalog.isSuccess && (
        <div className="stat-grid" style={{ marginTop: 14 }}>
          {catalog.data.data
            // oee lo enseña el héroe; business, la franja económica — repetirlos
            // como ficha suelta era ruido (y exponía la jerga del catálogo).
            .filter((k) => k.name !== 'oee' && k.name !== 'business')
            .map((k) => (
              <KpiCard key={k.name} kpi={k} />
            ))}
        </div>
      )}

      <UltimasAlarmas />
    </>
  );
}

/* La cifra crítica. Electric SOLO aquí, y sobre Ink — regla del kit aplicada
   con la disciplina del DMP (su score global es el único Electric de su app).

   Qué OEE se enseña (decisión 2026-07-17, convención de planta): el OEE es una
   métrica DE PERIODO, no instantánea — el titular es el ACUMULADO DE HOY
   (promedio de las horas cerradas, la misma regla que el PDF). La cubeta en
   curso era un artefacto: 6 min de parada en una hora de 10 min hundían el
   número sin significar nada. Mientras el día no tenga horas cerradas (00:00–
   00:59), se enseña la hora en curso, dicho en claro. La hora a hora vive en
   Grafana (vista del operador). */
function HeroOee() {
  const { config } = useAuth();
  const desde = plantMidnightIso(config.site_tz);
  const hoy = useKpiSeries('oee', { from: desde });
  const live = useKpiLive('oee');

  if (hoy.isPending || live.isPending) return <Loading>Leyendo OEE…</Loading>;
  if (hoy.isError && live.isError) return <ErrorState error={hoy.error} />;

  const cerradas = (hoy.data?.data ?? []).filter((r) => !r.is_partial);
  const media = (campo: string): number | null => {
    const vals = cerradas
      .map((r) => n(r, campo))
      .filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  let oee: number | null;
  let avail: number | null;
  let qual: number | null;
  let perf: number | null;
  let titulo: string;
  let nota: string;

  if (cerradas.length > 0) {
    oee = media('oee_pct');
    avail = media('availability_pct');
    qual = media('quality_pct');
    perf = media('performance_pct');
    titulo = 'OEE de hoy';
    nota = `promedio de ${cerradas.length} ${cerradas.length === 1 ? 'hora cerrada' : 'horas cerradas'} · se actualiza al cierre de cada hora`;
  } else {
    const row = live.data?.data ?? null;
    if (!row) return <Loading>Sin datos de OEE todavía.</Loading>;
    oee = n(row, 'oee_pct');
    avail = n(row, 'availability_pct');
    qual = n(row, 'quality_pct');
    perf = n(row, 'performance_pct');
    titulo = 'OEE · primera hora del día';
    nota = 'hora aún en curso — el acumulado del día aparece al cerrarla';
  }

  return (
    <section className="hero" aria-label="OEE de hoy">
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
      <div className="headline">
        <div className="label">{titulo}</div>
        <div className="val num">
          {fmt(oee)}
          <small> %</small>
        </div>
        <div className="when">{nota}</div>
      </div>
      <div className="parts">
        <div className="part">
          <div className="label">Disponibilidad</div>
          <div className="val num">{fmt(avail)} %</div>
        </div>
        <div className="part">
          <div className="label">Calidad</div>
          <div className="val num">{fmt(qual)} %</div>
        </div>
        <div className="part">
          <div className="label">Rendimiento</div>
          <div className="val num">{fmt(perf)} %</div>
        </div>
      </div>
      <BloqueHoy />
    </section>
  );
}

/* El acumulado del día en curso, desde la medianoche DE LA PLANTA. Sustituye al
   sparkline (2026-07-17: "esa gráfica es un poco extraña") por lo que un
   gerente pregunta primero: ¿cuánto llevamos hoy? */
function BloqueHoy() {
  const { config } = useAuth();
  const desde = plantMidnightIso(config.site_tz);
  const prod = useKpiSeries('production', { from: desde });
  const energia = useKpiSeries('energy', { from: desde });

  const filas = prod.data?.data ?? [];
  const suma = (campo: string) => filas.reduce((acc, r) => acc + (n(r, campo) ?? 0), 0);
  const botellas = suma('produced');
  const buenas = suma('good');
  const rechazadas = suma('rejected');
  const kwh = (energia.data?.data ?? []).reduce((acc, r) => acc + (n(r, 'kwh') ?? 0), 0);

  if (!prod.isSuccess || filas.length === 0) return null;

  return (
    <div className="parts hoy">
      <div className="part">
        <div className="label">Hoy · desde las 00:00</div>
        <div className="val num">
          {fmt(botellas, 0)} <small>botellas totales</small>
        </div>
        <div className="hoy-detalle num">
          <span className="buenas">{fmt(buenas, 0)} buenas</span>
          {' · '}
          <span className="rechazadas">{fmt(rechazadas, 0)} rechazadas</span>
          {' · '}
          {fmt(kwh)} kWh
        </div>
      </div>
    </div>
  );
}

/* La lectura de NEGOCIO del día: producción y energía × business_params (el
   KPI 'business' del catálogo). El usuario demo VE estos números y sus
   supuestos; cambiarlos exige rol admin (consola → Parámetros de negocio).
   Si el cliente no registró el KPI 'business', la franja no existe. */
function EconomicoHoy() {
  const { config } = useAuth();
  const desde = plantMidnightIso(config.site_tz);
  const negocio = useKpiSeries('business', { from: desde });
  const prod = useKpiSeries('production', { from: desde });
  const params = useBusinessParams();

  const filas = negocio.data?.data ?? [];
  if (!negocio.isSuccess || filas.length === 0) return null;

  const suma = (campo: string) =>
    filas.reduce((acc, r) => acc + (n(r, campo) ?? 0), 0);
  const margen = suma('margen_usd');
  const energia = suma('costo_energia_usd');
  const rechazos = suma('costo_rechazos_usd');
  const paradas = suma('costo_paradas_usd');

  const botellas = (prod.data?.data ?? []).reduce((acc, r) => acc + (n(r, 'produced') ?? 0), 0);
  const meta = params.data?.data.find((p) => p.param === 'meta_diaria')?.value ?? null;
  const avance = meta ? Math.min(100, (botellas / meta) * 100) : null;
  const vigencia = params.data?.data.length
    ? params.data.data.reduce((max, p) => (p.updated_at > max ? p.updated_at : max), '')
    : null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-title">Económico de hoy · desde las 00:00</div>
      <div className="econ-split">
        <div className="stat-grid" style={{ flex: 1 }}>
          <div className="stat">
            <span className="label">Margen ganado</span>
            <span className="val num">{fmtUsd(margen)}</span>
            <span className="sub">botellas buenas × margen</span>
          </div>
          <div className="stat" style={{ borderLeftColor: 'var(--steel)' }}>
            <span className="label">Costo energía</span>
            <span className="val num">{fmtUsd(energia)}</span>
            <span className="sub">kWh consumidos × tarifa</span>
          </div>
          <div className="stat" style={{ borderLeftColor: 'var(--fault)' }}>
            <span className="label">Costo rechazos</span>
            <span className="val num">{fmtUsd(rechazos)}</span>
            <span className="sub">material + reproceso</span>
          </div>
          <div className="stat" style={{ borderLeftColor: 'var(--warning)' }}>
            <span className="label">Margen no ganado</span>
            <span className="val num">{fmtUsd(paradas)}</span>
            <span className="sub warn">paradas y fallas (oportunidad)</span>
          </div>
        </div>
        {/* Los SUPUESTOS a la vista: un número de dinero sin sus parámetros no
            se entiende ni se defiende. Solo lo que el gerente necesita leer —
            dónde se editan es asunto del admin, no de esta pantalla. */}
        {params.isSuccess && params.data.data.length > 0 && (
          <aside className="params-aside" aria-label="Parámetros aplicados">
            <div className="label">Parámetros aplicados</div>
            {params.data.data.map((p) => (
              <div className="param-row" key={p.param}>
                <span className="p-name" title={p.param}>
                  {p.description || p.param}
                </span>
                <span className="p-val num">
                  {p.value.toLocaleString('es-EC', { maximumFractionDigits: 2 })} {p.unit}
                </span>
              </div>
            ))}
            <div className="p-foot num">vigentes al {vigencia ? fmtDate(vigencia) : '—'}</div>
          </aside>
        )}
      </div>
      {avance != null && (
        <div className="meta-row">
          <span className="label">Meta diaria</span>
          <div className="meter" role="meter" aria-valuenow={Math.round(avance)}
               aria-valuemin={0} aria-valuemax={100}
               aria-label={`Avance de la meta diaria: ${fmt(avance, 0)} %`}>
            <div className="meter-fill" style={{ width: `${avance}%` }} />
          </div>
          <span className="label num">
            {fmt(botellas, 0)} / {fmt(meta, 0)} botellas · {fmt(avance, 0)} %
          </span>
        </div>
      )}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: KpiCatalogEntry }) {
  const live = useKpiLive(kpi.name);

  const row = live.data?.data ?? null;
  const val = row ? headlineOf(kpi.name, row) : null;
  const decimals = val != null && Math.abs(val) >= 100 ? 0 : 1;

  return (
    <div className="stat">
      <span className="label" title={kpi.description}>
        {TITLES[kpi.name] ?? kpi.description ?? kpi.name}
      </span>
      <span className="val num">
        {live.isError ? '—' : fmt(val, decimals)}
        <small>{kpi.unit}</small>
      </span>
      {row && <Subline name={kpi.name} row={row} />}
    </div>
  );
}

/* Las últimas alarmas asoman en portada: en una planta, la ausencia de rojos ES
   información. El detalle completo vive en /alarmas. */
function UltimasAlarmas() {
  const alerts = useAlerts({ range: '24h', limit: 6 });

  return (
    <div className="card" style={{ marginTop: 14 }}>
      {/* Badge NEUTRO: los eventos son esporádicos, no un latido — pintar de
          ámbar "con retraso" cada vez que la planta lleva 3 min tranquila era
          un rojo-que-siempre-está-rojo (journal 2.1 §5). */}
      <div className="card-title">
        Últimas alarmas · 24 h
        {alerts.isSuccess && alerts.data.data[0] && (
          <span className="badge steel num">último {ago(alerts.data.data[0].ts)}</span>
        )}
      </div>
      {alerts.isPending && <Loading />}
      {alerts.isError && <ErrorState error={alerts.error} />}
      {alerts.isSuccess && alerts.data.data.length === 0 && (
        <div className="state">Sin eventos en las últimas 24 h.</div>
      )}
      {alerts.isSuccess && alerts.data.data.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <tbody>
              {alerts.data.data.map((a, i) => (
                <tr key={`${a.ts}-${i}`}>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    {ago(a.ts)}
                  </td>
                  <td>
                    <SeverityBadge severity={a.severity} />
                  </td>
                  <td className="mono">{a.src}</td>
                  <td>{a.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <Link to="/alarmas" className="label">
          Ver todas →
        </Link>
      </div>
    </div>
  );
}
