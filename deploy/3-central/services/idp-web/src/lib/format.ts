/* Formato de números y tiempos. La API devuelve ISO 8601 con offset (la hora de
   pared de la planta viaja en el dato — autodescriptivo, contrato §3.3); aquí se
   muestra en el reloj del navegador, que en el demo es el mismo huso. */

const nf1 = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 0 });
const nfUsd = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' });

export function fmtUsd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return nfUsd.format(v);
}

export function fmt(v: number | null | undefined, decimals: 0 | 1 = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return (decimals === 0 ? nf0 : nf1).format(v);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

/** "hace 3 min" — para frescura de datos. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  return agoSeconds((Date.now() - new Date(iso).getTime()) / 1000);
}

export function agoSeconds(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return '—';
  if (s < 0) s = 0;
  if (s < 90) return `hace ${Math.round(s)} s`;
  const m = s / 60;
  if (m < 90) return `hace ${Math.round(m)} min`;
  const h = m / 60;
  if (h < 36) return `hace ${fmt(h)} h`;
  return `hace ${fmt(h / 24)} días`;
}
