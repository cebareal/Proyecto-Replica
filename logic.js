// Fechas, rachas, porcentajes y exportación .ics. Sin dependencias del DOM.
// Las fechas son claves locales "YYYY-MM-DD" (se comparan como texto).

export const pad = (n) => String(n).padStart(2, '0');
export const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return key(d); };
export const todayKey = () => key(new Date());
/** Día ISO de la semana: lunes = 1 … domingo = 7. */
export const iso = (k) => { const w = parse(k).getDay(); return w === 0 ? 7 : w; };
export const weekStart = (k) => addDays(k, 1 - iso(k));
export function addMonths(k, n) {
  const d = parse(k);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return key(d);
}

/** Primer día que cuenta: la creación o el primer registro, lo que sea antes. */
export function startKey(h, set) {
  let s = key(new Date(h.createdAt));
  for (const d of set) if (d < s) s = d;
  return s;
}

function endKey(h, today) {
  if (h.archivedAt) { const a = key(new Date(h.archivedAt)); return a < today ? a : today; }
  return today;
}

export function scheduledOn(h, k) {
  return h.schedule.type === 'weekdays' ? h.schedule.days.includes(iso(k)) : true;
}

export function weekCount(set, k) {
  const w = weekStart(k);
  let n = 0;
  for (let i = 0; i < 7; i++) if (set.has(addDays(w, i))) n++;
  return n;
}

/**
 * Unidades evaluables de un hábito entre from y to (incluidos):
 * días programados, o semanas para "X veces por semana".
 * Hoy (o la semana en curso) solo cuenta si ya está cumplido: así no rompe la racha.
 */
export function units(h, set, from, to, today) {
  const start = startKey(h, set);
  const end = endKey(h, today);
  const lo = from && from > start ? from : start;
  const hi = to && to < end ? to : end;
  const out = [];
  if (lo > hi) return out;

  if (h.schedule.type === 'perWeek') {
    for (let w = weekStart(lo); w <= hi; w = addDays(w, 7)) {
      const we = addDays(w, 6);
      let n = 0;
      let avail = 0;
      for (let i = 0; i < 7; i++) {
        const k = addDays(w, i);
        if (k >= start && (!h.archivedAt || k <= end)) avail++;
        if (set.has(k)) n++;
      }
      const target = Math.min(h.schedule.times, avail);
      const done = target > 0 && n >= target;
      const current = we >= today && !h.archivedAt;
      if (current && !done) continue;
      if (target === 0) continue;
      out.push({ done, from: w, to: we, n, target });
    }
  } else {
    for (let k = lo; k <= hi; k = addDays(k, 1)) {
      if (!scheduledOn(h, k)) continue;
      const done = set.has(k);
      if (k === today && !done) continue;
      out.push({ done, from: k, to: k });
    }
  }
  return out;
}

export function streaks(h, set, today) {
  let best = 0;
  let run = 0;
  for (const u of units(h, set, null, null, today)) {
    if (u.done) { run++; if (run > best) best = run; } else run = 0;
  }
  return { current: run, best, unit: h.schedule.type === 'perWeek' ? 'week' : 'day' };
}

export function rate(h, set, from, today) {
  const u = units(h, set, from, today, today);
  const done = u.filter((x) => x.done).length;
  return { done, total: u.length, pct: u.length ? Math.round((done * 100) / u.length) : null };
}

/** Inicio de un periodo de N meses que termina hoy. */
export const periodStart = (today, months) => addDays(addMonths(today, -months), 1);

// ---------- Recordatorios como calendario (.ics) ----------

const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const icsText = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function toICS(habits, today) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hilo//Habitos//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Hilo'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  let count = 0;
  for (const h of habits) {
    if (!h.reminder || h.archivedAt) continue;
    const [hh, mm] = h.reminder.split(':');
    let rule = 'FREQ=DAILY';
    let first = today;
    if (h.schedule.type === 'weekdays') {
      const days = [...h.schedule.days].sort((a, b) => a - b);
      rule = 'FREQ=WEEKLY;BYDAY=' + days.map((i) => ICS_DAYS[i - 1]).join(',');
      while (!days.includes(iso(first))) first = addDays(first, 1);
    }
    const title = (h.emoji ? h.emoji + ' ' : '') + h.name;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${h.id}@hilo`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${first.replace(/-/g, '')}T${hh}${mm}00`,
      'DURATION:PT5M',
      `RRULE:${rule}`,
      `SUMMARY:${icsText(title)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
    count++;
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n') + '\r\n', count };
}
