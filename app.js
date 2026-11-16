import * as db from './db.js';
import * as L from './logic.js';
import { cachedQuote, dailyQuote } from './quote.js';
import * as W from './weather.js';
import * as H from './holidays.js';

const EXPORT_FORMAT = 'hilo';
const EXPORT_VERSION = 1;
const COLORS = ['#2f7d6d', '#3b6fb6', '#7a4fb5', '#c2417a', '#d0532c', '#b8862a', '#5b8c32', '#5f6b73'];
const WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WD_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const state = { habits: [], checks: new Map(), calMonth: null, calFor: null, citySearch: { q: '', results: [], error: '', busy: false } };
const $app = document.getElementById('app');

// ---------- utilidades ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const setOf = (id) => { let s = state.checks.get(id); if (!s) { s = new Set(); state.checks.set(id, s); } return s; };
const byOrder = (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
const active = () => state.habits.filter((h) => !h.archivedAt).sort(byOrder);
const archived = () => state.habits.filter((h) => h.archivedAt).sort(byOrder);
const findHabit = (id) => state.habits.find((h) => h.id === id);
const title = (h) => `${h.emoji ? esc(h.emoji) + ' ' : ''}${esc(h.name)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtDate = (k, opts) => new Intl.DateTimeFormat('es', opts).format(L.parse(k));

function freqLabel(h) {
  const s = h.schedule;
  if (s.type === 'daily') return 'Cada día';
  if (s.type === 'perWeek') return `${plural(s.times, 'vez', 'veces')} por semana`;
  const d = [...s.days].sort((a, b) => a - b);
  if (d.length === 5 && d.every((x, i) => x === i + 1)) return 'Entre semana';
  if (d.length === 2 && d[0] === 6 && d[1] === 7) return 'Fines de semana';
  return d.map((i) => WD[i - 1]).join(' · ');
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: no pasa nada */ } },
};

function applyTheme() {
  const t = storage.get('hilo-theme') || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

// ---------- datos ----------
async function load() {
  const { habits, checks } = await db.loadAll();
  state.habits = habits;
  state.checks = new Map();
  for (const c of checks) setOf(c.habitId).add(c.date);
}

async function toggle(id, date) {
  const s = setOf(id);
  if (s.has(date)) { s.delete(date); await db.removeCheck(id, date); }
  else { s.add(date); await db.addCheck(id, date); if (navigator.vibrate) navigator.vibrate(10); }
  render();
}

// ---------- vistas ----------
function quoteInner(q) {
  const credit = q.lang === 'en'
    ? `${q.source ? esc(q.source) + ' · ' : ''}vía ${q.link ? `<a href="${esc(q.link)}" target="_blank" rel="noopener">PositiveQuotation</a>` : 'PositiveQuotation'}`
    : '';
  return `<blockquote lang="${q.lang === 'en' ? 'en' : 'es'}">“${esc(q.text)}”</blockquote>
    <figcaption class="small muted">— ${esc(q.author || 'Anónimo')}${credit ? `<br>${credit}` : ''}</figcaption>`;
}

// Pinta la frase guardada al instante y, si hace falta, pide la de hoy sin bloquear la pantalla.
function refreshQuote(day) {
  dailyQuote(day).then((q) => {
    const el = document.getElementById('daily-quote');
    if (el && el.dataset.day === day) el.innerHTML = quoteInner(q);
  });
}

const OPEN_METEO = '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>';
const fmtTime = (ms) => new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

// loading: true mientras se espera la primera respuesta (aún no hay nada guardado).
function weatherInner(w, today, loading) {
  const city = W.getCity();
  if (!city) return '<a class="small" href="#/ajustes">🌤️ Elige tu ciudad en Ajustes para ver el tiempo aquí</a>';
  const place = `<span class="small muted">${esc(city.name)}</span>`;
  if (!w) return `<div class="row">${place}<span class="spacer"></span><span class="small muted">${loading ? 'Cargando el tiempo…' : 'Tiempo no disponible ahora'}</span></div>`;
  const d = W.describe(w.code, w.isDay);
  const fresh = w.day === today;
  const details = fresh
    ? [w.max !== null && w.min !== null ? `máx ${w.max}° · mín ${w.min}°` : '', w.rain !== null ? `lluvia ${w.rain} %` : ''].filter(Boolean).join(' · ')
    : 'sin actualizar desde otro día';
  return `<div class="row">
      <span class="w-icon" aria-hidden="true">${d.icon}</span>
      <div class="spacer"><strong class="w-temp">${w.temp} °C</strong> <span class="muted">${esc(d.label)}</span>
        <div class="small muted">${esc(details)}</div></div>
    </div>
    <div class="small muted w-foot">${esc(city.name)} · ${fresh ? '' : 'sin conexión · '}${fmtTime(w.fetchedAt)} · Datos: ${OPEN_METEO}</div>`;
}

function refreshWeather(day) {
  W.todayWeather(day).then((w) => {
    const el = document.getElementById('weather');
    if (el && el.dataset.day === day) el.innerHTML = weatherInner(w, day, false);
  });
}

function viewToday() {
  const t = L.todayKey();
  const all = active();
  const todays = all.filter((h) => L.scheduledOn(h, t));
  const others = all.filter((h) => !L.scheduledOn(h, t));
  let done = 0;
  let total = 0;

  const item = (h, interactive) => {
    const s = setOf(h.id);
    const checked = s.has(t);
    const st = L.streaks(h, s, t);
    let sub = freqLabel(h);
    if (h.schedule.type === 'perWeek') {
      const n = L.weekCount(s, t);
      const metBefore = n - (checked ? 1 : 0) >= h.schedule.times;
      if (interactive && (checked || !metBefore)) { total++; if (checked) done++; }
      sub = `${n}/${h.schedule.times} esta semana`;
    } else if (interactive) { total++; if (checked) done++; }
    const unit = st.unit === 'week' ? 'sem' : 'd';
    return `<li class="habit ${checked ? 'done' : ''}" style="--c:${h.color}">
      ${interactive ? `<button class="check" data-toggle="${h.id}" aria-pressed="${checked}" aria-label="${checked ? 'Desmarcar' : 'Marcar'} ${esc(h.name)}">✓</button>` : ''}
      <a class="info" href="#/habito/${h.id}"><span class="name">${title(h)}</span><span class="sub">${sub}</span></a>
      <span class="streak" aria-label="Racha de ${st.current}">${st.current > 0 ? `🔥 ${st.current}${unit}` : ''}</span>
    </li>`;
  };

  const list = todays.map((h) => item(h, true)).join('');
  const otherList = others.map((h) => item(h, false)).join('');
  const pct = total ? Math.round((done * 100) / total) : 0;
  const dateTitle = fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long' });

  let body;
  if (!all.length) {
    body = `<div class="empty card"><div class="big">🌱</div>
      <p><strong>Aún no tienes hábitos.</strong></p>
      <p class="muted">Empieza con uno a tres. Es mejor cumplir pocos que abandonar muchos.</p>
      <a class="btn btn-primary" href="#/nuevo">Crear mi primer hábito</a></div>`;
  } else {
    body = `
      <div class="progress" aria-label="Progreso de hoy">
        <div class="row small muted"><span>${done} de ${total} hechos</span><span class="spacer"></span><span>${pct} %</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>
      ${todays.length ? `<ul class="habits">${list}</ul>` : '<p class="muted">Hoy no toca ningún hábito. Descansa.</p>'}
      ${others.length ? `<details class="others"><summary>No tocan hoy (${others.length})</summary><ul class="habits">${otherList}</ul></details>` : ''}`;
  }

  return `<h1>${esc(dateTitle.charAt(0).toUpperCase() + dateTitle.slice(1))}</h1>
    ${(() => { const hol = H.holidayOn(t); return hol ? `<p class="holiday-today">🎉 Hoy es festivo: <strong>${esc(hol)}</strong></p>` : '<p class="muted">Hoy</p>'; })()}
    <section class="weather card" id="weather" data-day="${t}" aria-label="Tiempo de hoy">${weatherInner(W.cachedWeather(), t, true)}</section>
    <figure class="quote card" id="daily-quote" data-day="${t}" aria-label="Frase del día">${quoteInner(cachedQuote(t))}</figure>
    ${body}
    ${all.length ? '<a class="btn btn-primary fab" href="#/nuevo">＋ Nuevo hábito</a>' : ''}`;
}

function viewEdit(id) {
  const h = id ? findHabit(id) : null;
  if (id && !h) return viewMissing();
  const v = h || { name: '', emoji: '', color: COLORS[active().length % COLORS.length], schedule: { type: 'daily' }, reminder: null };
  const s = v.schedule;
  const days = s.type === 'weekdays' ? s.days : [1, 2, 3, 4, 5];
  const times = s.type === 'perWeek' ? s.times : 3;

  return `<a class="back" href="${h ? `#/habito/${h.id}` : '#/hoy'}">‹ Volver</a>
    <h1>${h ? 'Editar hábito' : 'Nuevo hábito'}</h1>
    <form id="habit-form" data-id="${h ? h.id : ''}" novalidate>
      <label>Nombre
        <input type="text" name="name" required maxlength="60" value="${esc(v.name)}" placeholder="Beber 2 litros de agua" autocomplete="off">
      </label>
      <label>Emoji <span class="hint">opcional</span>
        <input type="text" name="emoji" maxlength="8" value="${esc(v.emoji)}" placeholder="💧" autocomplete="off">
      </label>
      <fieldset><legend>Color</legend>
        <div class="choices">${COLORS.map((c, i) => `<label class="choice swatch"><input type="radio" name="color" value="${c}" ${c === v.color ? 'checked' : ''} aria-label="Color ${i + 1}"><span style="--sw:${c}"></span></label>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Frecuencia</legend>
        <div class="choices">
          ${[['daily', 'Cada día'], ['weekdays', 'Días concretos'], ['perWeek', 'X veces por semana']]
            .map(([val, lab]) => `<label class="choice"><input type="radio" name="type" value="${val}" ${s.type === val ? 'checked' : ''}><span>${lab}</span></label>`).join('')}
        </div>
        <div class="choices" data-for="weekdays" ${s.type === 'weekdays' ? '' : 'hidden'}>
          ${WD.map((d, i) => `<label class="choice"><input type="checkbox" name="days" value="${i + 1}" ${days.includes(i + 1) ? 'checked' : ''} aria-label="${WD_LONG[i]}"><span>${d}</span></label>`).join('')}
        </div>
        <label data-for="perWeek" ${s.type === 'perWeek' ? '' : 'hidden'}>Veces por semana
          <input type="number" name="times" min="1" max="7" inputmode="numeric" value="${times}">
          <span class="hint">Cualquier día vale. La racha cuenta semanas cumplidas, así que un día libre no la rompe.</span>
        </label>
      </fieldset>
      <label>Recordatorio <span class="hint">opcional</span>
        <input type="time" name="reminder" value="${esc(v.reminder || '')}">
        <span class="hint">Se pasa al Calendario del iPhone desde Ajustes → Exportar recordatorios.</span>
      </label>
      <p class="error" id="form-error" hidden></p>
      <button type="submit" class="btn btn-primary btn-block">Guardar</button>
      ${h ? `<div class="row">
        <button type="button" class="spacer" data-action="archive" data-id="${h.id}">${h.archivedAt ? 'Restaurar' : 'Archivar'}</button>
        <button type="button" class="btn-danger spacer" data-action="delete" data-id="${h.id}">Eliminar</button>
      </div>` : ''}
    </form>`;
}

function viewDetail(id) {
  const h = findHabit(id);
  if (!h) return viewMissing();
  const s = setOf(h.id);
  const t = L.todayKey();
  if (state.calFor !== id || !state.calMonth) { state.calMonth = t.slice(0, 8) + '01'; state.calFor = id; }
  const m = state.calMonth;
  const nextMonth = L.addMonths(m, 1);
  const start = L.startKey(h, s);
  const st = L.streaks(h, s, t);
  const r30 = L.rate(h, s, L.addDays(t, -29), t);
  const unit = st.unit === 'week' ? ['semana', 'semanas'] : ['día', 'días'];

  let cells = WD.map((d) => `<div class="wd" aria-hidden="true">${d}</div>`).join('');
  let k = L.weekStart(m);
  do {
    const inMonth = k.slice(0, 7) === m.slice(0, 7);
    const future = k > t;
    const done = s.has(k);
    const sched = L.scheduledOn(h, k) && k >= start;
    const hol = H.holidayOn(k);
    const cls = ['day', sched ? 'sched' : '', done ? 'done' : '', inMonth ? '' : 'out', k === t ? 'today' : '', hol ? 'holiday' : ''].join(' ');
    const label = `${fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}${hol ? `, festivo: ${hol}` : ''}${done ? ', hecho' : ''}`;
    cells += `<button class="${cls}" data-cal="${k}" ${future ? 'disabled' : ''} aria-pressed="${done}" aria-label="${esc(label)}">${Number(k.slice(8))}</button>`;
    k = L.addDays(k, 1);
  } while (k < nextMonth || L.iso(k) !== 1);
  const monthHolidays = H.holidaysOf(Number(m.slice(0, 4))).filter((x) => x.date.slice(0, 7) === m.slice(0, 7));
  const holList = monthHolidays.length
    ? `<p class="small muted holiday-list"><span class="hdot" aria-hidden="true"></span>Festivos: ${monthHolidays.map((x) => `${Number(x.date.slice(8))} · ${esc(x.name)}`).join(', ')}</p>`
    : '';

  return `<a class="back" href="#/hoy">‹ Hoy</a>
    <div style="--c:${h.color}">
      <div class="row"><h1 class="spacer">${title(h)}</h1><a class="btn" href="#/editar/${h.id}">Editar</a></div>
      <p class="muted">${freqLabel(h)}${h.reminder ? ` · aviso ${esc(h.reminder)}` : ''}${h.archivedAt ? ' · <strong>archivado</strong>' : ''}</p>
      <div class="stats-grid">
        <div class="stat"><b>${st.current}</b><span>racha actual (${st.current === 1 ? unit[0] : unit[1]})</span></div>
        <div class="stat"><b>${st.best}</b><span>mejor racha</span></div>
        <div class="stat"><b>${r30.pct === null ? '—' : r30.pct + ' %'}</b><span>últimos 30 días (${r30.done}/${r30.total})</span></div>
        <div class="stat"><b>${s.size}</b><span>veces hecho en total</span></div>
      </div>
      <div class="cal-head">
        <button data-action="prev-month" aria-label="Mes anterior">‹</button>
        <strong>${esc(fmtDate(m, { month: 'long', year: 'numeric' }))}</strong>
        <button data-action="next-month" aria-label="Mes siguiente" ${m >= L.addMonths(t.slice(0, 8) + '01', 12) ? 'disabled' : ''}>›</button>
      </div>
      <div class="cal">${cells}</div>
      ${holList}
      <p class="small muted" style="margin-top:10px">Toca un día pasado para marcarlo o desmarcarlo.</p>
    </div>`;
}

function viewStats() {
  const t = L.todayKey();
  const habits = active();
  if (!habits.length) return '<h1>Estadísticas</h1><p class="muted">Crea un hábito para ver tus números.</p>';
  const periods = [1, 3, 6, 12];
  const cell = (r) => (r.total ? `${r.pct} %<small>${r.done}/${r.total}</small>` : '—');
  const totals = periods.map(() => ({ done: 0, total: 0 }));

  const rows = habits.map((h) => {
    const s = setOf(h.id);
    const cols = periods.map((p, i) => {
      const r = L.rate(h, s, L.periodStart(t, p), t);
      totals[i].done += r.done;
      totals[i].total += r.total;
      return `<td>${cell(r)}</td>`;
    }).join('');
    const st = L.streaks(h, s, t);
    return `<tr><td><a href="#/habito/${h.id}" style="--c:${h.color}"><span class="dot"></span>${title(h)}</a>
      <small>racha ${st.current} · mejor ${st.best}</small></td>${cols}</tr>`;
  }).join('');

  const totalRow = totals.map((x) => `<td>${x.total ? Math.round((x.done * 100) / x.total) + ' %' : '—'}<small>${x.done}/${x.total}</small></td>`).join('');

  return `<h1>Estadísticas</h1>
    <p class="muted">Porcentaje cumplido: veces hechas entre veces que tocaba. Para "X veces por semana", semanas logradas.</p>
    <div class="table-wrap card" style="padding:4px 12px">
      <table>
        <thead><tr><th>Hábito</th>${periods.map((p) => `<th>${p} ${p === 1 ? 'mes' : 'meses'}</th>`).join('')}</tr></thead>
        <tbody><tr class="total"><td>Todos</td>${totalRow}</tr>${rows}</tbody>
      </table>
    </div>`;
}

function viewSettings() {
  const theme = storage.get('hilo-theme') || 'auto';
  const arch = archived();
  const withReminder = active().filter((h) => h.reminder).length;
  const city = W.getCity();
  const cs = state.citySearch;
  const reg = H.getRegion();
  const today = L.todayKey();
  const year = Number(today.slice(0, 4));
  const subs = H.subdivisions(year);
  const upcoming = [...H.holidaysOf(year), ...H.holidaysOf(year + 1)].filter((x) => x.date >= today).slice(0, 4);
  return `<h1>Ajustes</h1>
    <h2>Recordatorios</h2>
    <div class="card list">
      <p>Tienes ${plural(withReminder, 'hábito', 'hábitos')} con hora de aviso. En el iPhone, una app web no puede programar avisos sola, así que se pasan al <strong>Calendario</strong> como eventos que se repiten con alarma.</p>
      <button class="btn btn-primary" data-action="export-ics" ${withReminder ? '' : 'disabled'}>Exportar recordatorios (.ics)</button>
      <p class="small muted">Si cambias horas o hábitos, borra antes los eventos antiguos del calendario "Hilo" y vuelve a exportar, para no tenerlos duplicados.</p>
    </div>
    <h2>Copia de seguridad</h2>
    <div class="card list">
      <p>Tus datos solo están en este teléfono. Guarda una copia de vez en cuando (por ejemplo en Archivos o iCloud Drive).</p>
      <button class="btn" data-action="export-json">Exportar copia (.json)</button>
      <label class="btn" style="font-weight:400">Importar copia…<input type="file" accept="application/json,.json" data-action="import-json" hidden></label>
      <p class="small muted">Importar reemplaza todos los datos actuales.</p>
    </div>
    <h2>Apariencia</h2>
    <div class="card">
      <label>Tema
        <select data-action="theme">
          ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<option value="${v}" ${v === theme ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
    </div>
    <h2>Tiempo</h2>
    <div class="card list">
      ${city ? `<p>Ciudad: <strong>${esc(city.name)}</strong> <span class="muted">${esc(city.region || '')}</span></p>` : '<p>Elige tu ciudad para ver el tiempo en Hoy.</p>'}
      <form id="city-form" class="row" role="search">
        <input class="spacer" type="search" name="city" maxlength="80" value="${esc(cs.q)}" placeholder="Busca tu ciudad" aria-label="Ciudad" autocomplete="off">
        <button type="submit" class="btn" ${cs.busy ? 'disabled' : ''}>${cs.busy ? 'Buscando…' : 'Buscar'}</button>
      </form>
      ${cs.error ? `<p class="error">${esc(cs.error)}</p>` : ''}
      ${cs.results.length ? `<ul class="habits">${cs.results.map((r, i) => `<li class="habit">
          <span class="info"><span class="name">${esc(r.name)}</span><span class="sub">${esc(r.region)}</span></span>
          <button data-action="pick-city" data-i="${i}">Elegir</button></li>`).join('')}</ul>` : ''}
      ${city ? '<button data-action="clear-city">Quitar ciudad</button>' : ''}
      <p class="small muted">Solo se envían a ${OPEN_METEO} el nombre que buscas y las coordenadas aproximadas de la ciudad. Se actualiza como mucho una vez por hora.</p>
    </div>
    <h2>Festivos</h2>
    <div class="card list">
      <label>País
        <select data-action="holiday-country">
          ${[...new Set([reg.country, ...H.countries()])]
            .map((cc) => [cc, H.countryName(cc)]).sort((a, b) => a[1].localeCompare(b[1], 'es'))
            .map(([cc, name]) => `<option value="${cc}" ${cc === reg.country ? 'selected' : ''}>${esc(name)}</option>`).join('')}
        </select>
      </label>
      ${subs.length ? `<label>Comunidad o región
        <select data-action="holiday-sub">
          <option value="">Solo festivos nacionales</option>
          ${subs.map((s) => `<option value="${s}" ${s === reg.sub ? 'selected' : ''}>${esc(H.regionName(s))}</option>`).join('')}
        </select>
      </label>` : ''}
      ${upcoming.length
        ? `<div><p class="small muted" style="margin-bottom:4px">Próximos festivos</p>${upcoming.map((x) => `<div class="row small"><span>${esc(x.name)}</span><span class="spacer"></span><span class="muted">${esc(fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span></div>`).join('')}</div>`
        : '<p class="small muted">Sin datos de festivos todavía. Se descargan cuando hay conexión.</p>'}
      <p class="small muted">Se marcan en Hoy y en el calendario de cada hábito; no cambian rachas ni porcentajes. Datos: <a href="https://nagerholidays.com/" target="_blank" rel="noopener">Nager.Date</a>.</p>
    </div>
    <h2>Archivados (${arch.length})</h2>
    ${arch.length ? `<ul class="habits">${arch.map((h) => `<li class="habit" style="--c:${h.color}">
        <a class="info" href="#/habito/${h.id}"><span class="name">${title(h)}</span><span class="sub">${freqLabel(h)}</span></a>
        <button data-action="archive" data-id="${h.id}">Restaurar</button></li>`).join('')}</ul>`
      : '<p class="muted">Nada archivado.</p>'}
    <h2>Instalar en el iPhone</h2>
    <div class="card"><p>En Safari: botón Compartir → <strong>Añadir a pantalla de inicio</strong>. Después ábrela desde el icono; funciona sin conexión.</p></div>
    <p class="small muted" style="margin-top:20px">Hilo v1 · sin cuenta, sin anuncios, sin límites.</p>`;
}

const viewMissing = () => '<h1>No encontrado</h1><p><a href="#/hoy">Volver a Hoy</a></p>';

// ---------- router ----------
function route() {
  const parts = (location.hash || '#/hoy').slice(2).split('/');
  return { name: parts[0] || 'hoy', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function render() {
  const r = route();
  const views = {
    hoy: () => viewToday(),
    nuevo: () => viewEdit(null),
    editar: () => viewEdit(r.id),
    habito: () => viewDetail(r.id),
    stats: () => viewStats(),
    ajustes: () => viewSettings(),
  };
  $app.innerHTML = (views[r.name] || views.hoy)();
  const q = document.getElementById('daily-quote');
  if (q) refreshQuote(q.dataset.day);
  const w = document.getElementById('weather');
  if (w) refreshWeather(w.dataset.day);
  refreshHolidays(r.name);
  const tab = ['stats', 'ajustes'].includes(r.name) ? r.name : 'hoy';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// Descarga en segundo plano los festivos que la pantalla necesita y repinta solo si llegan datos nuevos.
function refreshHolidays(name) {
  const year = Number(L.todayKey().slice(0, 4));
  const jobs = [H.ensureYear(year)];
  if (name === 'habito' && state.calMonth) jobs.push(H.ensureYear(Number(state.calMonth.slice(0, 4))));
  if (name === 'ajustes') jobs.push(H.ensureYear(year + 1), H.ensureCountries());
  Promise.all(jobs).then((changed) => {
    const typing = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (changed.some(Boolean) && route().name === name && !typing) render();
  });
}

let lastRoute = '';
window.addEventListener('hashchange', () => {
  const now = route().name;
  render();
  if (now !== lastRoute) window.scrollTo(0, 0);
  lastRoute = now;
});

// ---------- acciones ----------
async function shareOrDownload(name, mime, text, preferShare) {
  const blob = new Blob([text], { type: mime });
  if (preferShare && navigator.canShare) {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

function readForm(form) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  const type = f.get('type');
  let schedule;
  if (type === 'weekdays') schedule = { type, days: f.getAll('days').map(Number) };
  else if (type === 'perWeek') schedule = { type, times: Math.max(1, Math.min(7, Number(f.get('times')) || 1)) };
  else schedule = { type: 'daily' };
  return {
    name,
    emoji: String(f.get('emoji') || '').trim(),
    color: f.get('color') || COLORS[0],
    schedule,
    reminder: f.get('reminder') || null,
  };
}

$app.addEventListener('submit', async (e) => {
  if (e.target.id === 'city-form') {
    e.preventDefault();
    const cs = state.citySearch;
    if (cs.busy) return;
    cs.q = String(new FormData(e.target).get('city') || '').trim();
    Object.assign(cs, { busy: true, error: '', results: [] });
    render();
    const r = await W.searchCity(cs.q);
    Object.assign(cs, { busy: false, error: r.error || '', results: r.results || [] });
    if (route().name === 'ajustes') render();
    return;
  }
  if (e.target.id !== 'habit-form') return;
  e.preventDefault();
  const form = e.target;
  const data = readForm(form);
  const err = form.querySelector('#form-error');
  const problem = !data.name ? 'Ponle un nombre.'
    : data.schedule.type === 'weekdays' && !data.schedule.days.length ? 'Elige al menos un día.' : '';
  if (problem) { err.textContent = problem; err.hidden = false; return; }

  const id = form.dataset.id;
  let habit;
  if (id) {
    habit = { ...findHabit(id), ...data };
    state.habits = state.habits.map((h) => (h.id === id ? habit : h));
  } else {
    const now = Date.now();
    habit = { id: uid(), ...data, createdAt: now, archivedAt: null, order: now };
    state.habits.push(habit);
  }
  await db.putHabit(habit);
  toast(id ? 'Guardado' : 'Hábito creado');
  location.hash = id ? `#/habito/${id}` : '#/hoy';
});

$app.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.name === 'type' && el.form) {
    el.form.querySelectorAll('[data-for]').forEach((n) => { n.hidden = n.dataset.for !== el.value; });
  }
  if (el.dataset.action === 'theme') { storage.set('hilo-theme', el.value); applyTheme(); }
  if (el.dataset.action === 'holiday-country') { H.setRegion(el.value, null); el.blur(); render(); }
  if (el.dataset.action === 'holiday-sub') {
    H.setRegion(H.getRegion().country, el.value || null);
    el.blur();
    toast(el.value ? `Festivos de ${H.regionName(el.value)}` : 'Solo festivos nacionales');
    render();
  }
  if (el.dataset.action === 'import-json' && el.files[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (data.format !== EXPORT_FORMAT || !Array.isArray(data.habits) || !Array.isArray(data.checks)) throw new Error('formato');
      const ok = data.habits.every((h) => h && typeof h.id === 'string' && typeof h.name === 'string' && h.schedule && h.schedule.type)
        && data.checks.every((c) => c && typeof c.habitId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date));
      if (!ok) throw new Error('contenido');
      if (!confirm(`Importar ${plural(data.habits.length, 'hábito', 'hábitos')} y ${data.checks.length} registros. Esto reemplaza todos tus datos actuales. ¿Seguir?`)) return;
      await db.replaceAll(data.habits, data.checks);
      await load();
      toast('Copia importada');
      render();
    } catch {
      toast('Ese archivo no es una copia válida de Hilo');
    } finally {
      el.value = '';
    }
  }
});

$app.addEventListener('click', async (e) => {
  const tgl = e.target.closest('[data-toggle]');
  if (tgl) { toggle(tgl.dataset.toggle, L.todayKey()); return; }

  const day = e.target.closest('[data-cal]');
  if (day && !day.disabled) { toggle(route().id, day.dataset.cal); return; }

  const act = e.target.closest('[data-action]');
  if (!act || act.tagName === 'SELECT' || act.tagName === 'INPUT') return;
  const a = act.dataset.action;

  if (a === 'pick-city') {
    const c = state.citySearch.results[Number(act.dataset.i)];
    if (!c) return;
    W.setCity(c);
    state.citySearch = { q: '', results: [], error: '', busy: false };
    toast(`Ciudad: ${c.name}`);
    render();
  } else if (a === 'clear-city') {
    W.clearCity();
    toast('Ciudad quitada');
    render();
  } else if (a === 'prev-month' || a === 'next-month') {
    state.calMonth = L.addMonths(state.calMonth, a === 'prev-month' ? -1 : 1);
    render();
  } else if (a === 'archive') {
    const h = findHabit(act.dataset.id);
    h.archivedAt = h.archivedAt ? null : Date.now();
    await db.putHabit(h);
    toast(h.archivedAt ? 'Archivado. Lo tienes en Ajustes.' : 'Restaurado');
    if (route().name === 'ajustes') render(); else location.hash = '#/hoy';
  } else if (a === 'delete') {
    const h = findHabit(act.dataset.id);
    if (!confirm(`¿Eliminar "${h.name}" y todo su historial? No se puede deshacer. (Archivar lo oculta sin borrar nada.)`)) return;
    await db.deleteHabit(h.id);
    state.habits = state.habits.filter((x) => x.id !== h.id);
    state.checks.delete(h.id);
    toast('Eliminado');
    location.hash = '#/hoy';
  } else if (a === 'export-json') {
    const checks = [];
    for (const [habitId, set] of state.checks) for (const date of set) checks.push({ habitId, date });
    const data = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), habits: state.habits, checks };
    await shareOrDownload(`hilo-copia-${L.todayKey()}.json`, 'application/json', JSON.stringify(data, null, 2), true);
  } else if (a === 'export-ics') {
    const { text, count } = L.toICS(active(), L.todayKey());
    if (!count) { toast('Ningún hábito tiene hora de aviso'); return; }
    await shareOrDownload('hilo-recordatorios.ics', 'text/calendar', text, false);
  }
});

// ---------- arranque ----------
applyTheme();
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
load().then(() => { lastRoute = route().name; render(); }).catch((err) => {
  $app.innerHTML = `<h1>No se pudieron cargar los datos</h1><p class="muted">${esc(err && err.message)}</p>`;
});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
