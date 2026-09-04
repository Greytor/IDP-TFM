/* Generación de reportes PDF (issue 2.2-B): rangos rápidos O una ventana de
   calendario/hora libre, previsualización incrustada y descarga.

   El selector personalizado se interpreta en HORA DE PLANTA (site_tz de
   /api/v1/config), el mismo criterio que el propio PDF: "de 06:00 a 14:00" es
   el turno de mañana de la planta, esté el navegador donde esté. Si la API aún
   no expone site_tz, se cae al huso del navegador.

   El endpoint es POST (contrato §3.3) con format=pdf&download=false → el PDF
   llega inline y se enseña en un iframe vía Blob URL. Un reporte largo puede
   pasar del minuto (nginx le da 300 s): la espera se dice, no se disimula. */
import { useEffect, useRef, useState } from 'react';

import { ApiError, generateReport } from '../../api/client';
import type { TimeParams } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { plantDateDaysAgo, plantToday, plantWallToIso } from '../../lib/time';

const RANGES = ['24h', '3d', '7d', '30d'] as const;
type Rango = (typeof RANGES)[number] | 'custom';

// Horas SIEMPRE en formato 24 h y elegibles de un desplegable, no tecleadas
// (decisión 2026-07-17: el datetime-local heredaba el formato 12 h del sistema
// y obligaba a escribir la hora). El reporte agrega por horas: el minuto no
// aporta y se fija a :00.
const HORAS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

type Estado =
  | { t: 'idle' }
  | { t: 'generando' }
  | { t: 'listo'; url: string; nombre: string; ms: number }
  | { t: 'error'; error: ApiError };

export function Reportes() {
  const { config } = useAuth();
  const [rango, setRango] = useState<Rango>('24h');
  // Preseleccionado a "los últimos 3 días completos": listo para generar sin
  // rellenar nada, y editable con dos clics. Fechas según el reloj de la
  // PLANTA: por la noche, la fecha del navegador puede ir un día por delante.
  const [desdeDia, setDesdeDia] = useState(() => plantDateDaysAgo(config.site_tz, 3));
  const [desdeHora, setDesdeHora] = useState('00');
  const [hastaDia, setHastaDia] = useState(() => plantToday(config.site_tz));
  const [hastaHora, setHastaHora] = useState('00');
  const [estado, setEstado] = useState<Estado>({ t: 'idle' });
  // El anexo cronológico puede ser MUCHAS páginas: por defecto fuera — el
  // resumen por evento (que siempre va) es el censo completo. Quien necesita
  // la evidencia línea a línea, marca la casilla.
  const [conAnexo, setConAnexo] = useState(false);
  const urlRef = useRef<string | null>(null);

  const desde = `${desdeDia}T${desdeHora}:00`;
  const hasta = `${hastaDia}T${hastaHora}:00`;

  // Los Blob URL no se liberan solos: al reemplazar o desmontar, se revocan.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const custom = rango === 'custom';
  const customValido = !custom || desde < hasta;

  function params(): TimeParams {
    if (!custom) return { range: rango };
    return {
      from: plantWallToIso(desde, config.site_tz),
      to: plantWallToIso(hasta, config.site_tz),
    };
  }

  function nombreArchivo(): string {
    const etiqueta = custom ? `${desdeDia}_${hastaDia}` : rango;
    return `greytec-produccion-${etiqueta}.pdf`;
  }

  async function generar() {
    setEstado({ t: 'generando' });
    const t0 = performance.now();
    try {
      const blob = await generateReport(params(), conAnexo ? 'full' : 'summary');
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setEstado({
        t: 'listo',
        url,
        nombre: nombreArchivo(),
        ms: Math.round(performance.now() - t0),
      });
    } catch (e) {
      setEstado({ t: 'error', error: e instanceof ApiError ? e : new ApiError(0, String(e)) });
    }
  }

  return (
    <>
      <div className="view-head">
        <div className="label crumbs">Familia 3 · el mismo motor que corre en el servidor</div>
        <h1>Reportes de producción</h1>
      </div>

      <div className="card">
        <div className="card-title">Generar reporte</div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="seg" role="tablist" aria-label="Rango del reporte">
            {RANGES.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={r === rango}
                className={r === rango ? 'on' : ''}
                onClick={() => setRango(r)}
              >
                {r}
              </button>
            ))}
            <button
              role="tab"
              aria-selected={custom}
              className={custom ? 'on' : ''}
              onClick={() => setRango('custom')}
            >
              Personalizado
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={conAnexo}
              onChange={(e) => setConAnexo(e.target.checked)}
            />
            incluir anexo cronológico de alarmas
          </label>
          <button className="btn" onClick={generar} disabled={estado.t === 'generando' || !customValido}>
            {estado.t === 'generando' ? 'Generando…' : 'Generar PDF'}
          </button>
          {estado.t === 'listo' && (
            <a className="btn outline" href={estado.url} download={estado.nombre}>
              Descargar
            </a>
          )}
          <div className="spacer" />
          {estado.t === 'listo' && (
            <span className="label num">renderizado en {(estado.ms / 1000).toFixed(1)} s</span>
          )}
        </div>

        {custom && (
          <div className="toolbar" style={{ marginTop: 14, marginBottom: 0, alignItems: 'flex-end' }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Desde</span>
              <div className="fecha-hora">
                <input type="date" value={desdeDia} max={hastaDia}
                       onChange={(e) => setDesdeDia(e.target.value)} />
                <select value={desdeHora} aria-label="Hora desde (formato 24 horas)"
                        onChange={(e) => setDesdeHora(e.target.value)}>
                  {HORAS.map((h) => <option key={h} value={h}>{h}:00</option>)}
                </select>
              </div>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Hasta</span>
              <div className="fecha-hora">
                <input type="date" value={hastaDia} min={desdeDia}
                       onChange={(e) => setHastaDia(e.target.value)} />
                <select value={hastaHora} aria-label="Hora hasta (formato 24 horas)"
                        onChange={(e) => setHastaHora(e.target.value)}>
                  {HORAS.map((h) => <option key={h} value={h}>{h}:00</option>)}
                </select>
              </div>
            </label>
            <span className="label" style={{ paddingBottom: 10 }}>
              hora de planta{config.site_tz ? ` · ${config.site_tz}` : ' (huso del navegador)'}
            </span>
          </div>
        )}
        {custom && !customValido && (
          <div className="callout error" role="alert" style={{ marginBottom: 0 }}>
            «Desde» debe ser anterior a «Hasta».
          </div>
        )}

        {estado.t === 'generando' && (
          <p className="label" style={{ marginTop: 12 }}>
            Componiendo datos y renderizando… un rango largo puede tardar más de un minuto.
          </p>
        )}
        {estado.t === 'error' && (
          <div className="callout error" role="alert">
            {estado.error.friendly}
            {estado.error.status > 0 && ` (HTTP ${estado.error.status})`}
            {estado.error.status === 422 && (
              <span style={{ display: 'block', marginTop: 4 }}>{estado.error.detail}</span>
            )}
          </div>
        )}
      </div>

      {estado.t === 'listo' && (
        <div className="frame" style={{ marginTop: 14 }}>
          <iframe src={estado.url} title="Reporte PDF" style={{ height: 'min(80vh, 900px)' }} />
        </div>
      )}
    </>
  );
}
