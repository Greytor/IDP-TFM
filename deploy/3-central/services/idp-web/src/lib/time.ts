/* Conversión de hora de pared de la PLANTA → instante UTC.

   El <input type="datetime-local"> devuelve una hora de pared sin zona
   ("2026-07-01T14:30"). Para un reporte, esa hora significa hora de PLANTA
   (site_tz de /api/v1/config): "el turno de las 14:00" es el de las 14:00 en la
   línea, esté el navegador donde esté — el mismo criterio que usa el PDF.

   JS no convierte pared→UTC en una zona arbitraria directamente; se hace con el
   truco estándar de Intl: interpreta la pared como si fuera UTC, mira qué pared
   muestra esa zona en ese instante, y corrige por la diferencia. Dos pasadas
   para el caso de borde de un cambio de hora (Ecuador no tiene DST, pero el
   código no debe depender de eso). */

function wallInZone(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // hour12:false puede dar "24" a medianoche; Date.UTC lo normaliza solo.
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/** La fecha de HOY según el reloj de la planta ("2026-07-17"). No es la del
    navegador: a las 23:30 de un gerente en Madrid, en la planta aún es ayer. */
export function plantToday(timeZone: string | undefined): string {
  if (!timeZone) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Medianoche de HOY en la planta, como instante ISO UTC — el "desde" de todo
    acumulado del día. */
export function plantMidnightIso(timeZone: string | undefined): string {
  return plantWallToIso(`${plantToday(timeZone)}T00:00`, timeZone);
}

/** La fecha de hace N días según el reloj de la planta ("2026-07-14"). Para
    prefijar selectores: la fecha del navegador puede ir un día por delante. */
export function plantDateDaysAgo(timeZone: string | undefined, dias: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  if (!timeZone) return d.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** "2026-07-01T14:30" en `timeZone` → ISO UTC ("2026-07-01T19:30:00.000Z"). */
export function plantWallToIso(wall: string, timeZone: string | undefined): string {
  if (!wall) return '';
  if (!timeZone) return new Date(wall).toISOString(); // huso del navegador

  // datetime-local da "YYYY-MM-DDTHH:MM" (16 chars); con step<60 añade ":SS".
  const pretend = new Date(`${wall.length === 16 ? `${wall}:00` : wall}Z`);
  // U = W − offset(U), con offset(U) = pared_que_muestra_la_zona(U) − U.
  let utcMs = pretend.getTime() - (wallInZone(pretend, timeZone) - pretend.getTime());
  // Segunda pasada: recalcular el offset EN el instante estimado (cerca de un
  // cambio de hora, el de la primera pasada puede ser el del lado equivocado).
  // ⚠ El offset se mide contra utcMs, NO contra pretend: restarlo contra
  // pretend ANULA la corrección y devuelve la pared como si fuera UTC — el bug
  // que mandaba "00:00 de planta" como 19:00 del día anterior (2026-07-17).
  utcMs = pretend.getTime() - (wallInZone(new Date(utcMs), timeZone) - utcMs);
  return new Date(utcMs).toISOString();
}
