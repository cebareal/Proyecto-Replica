import * as db from './db.js';
import * as L from './logic.js';

const EXPORT_FORMAT = 'hilo';
const EXPORT_VERSION = 1;
const COLORS = ['#2f7d6d', '#3b6fb6', '#7a4fb5', '#c2417a', '#d0532c', '#b8862a', '#5b8c32', '#5f6b73'];
const WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WD_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const state = { habits: [], checks: new Map(), calMonth: null, calFor: null };
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
    <p class="muted">Hoy</p>
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
    const cls = ['day', sched ? 'sched' : '', done ? 'done' : '', inMonth ? '' : 'out', k === t ? 'today' : ''].join(' ');
    const label = `${fmtDate(k, { weekday: 'long', day: 'numeric', month: 'long' })}${done ? ', hecho' : ''}`;
    cells += `<button class="${cls}" data-cal="${k}" ${future ? 'disabled' : ''} aria-pressed="${done}" aria-label="${esc(label)}">${Number(k.slice(8))}</button>`;
    k = L.addDays(k, 1);
  } while (k < nextMonth || L.iso(k) !== 1);

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
        <button data-action="next-month" aria-label="Mes siguiente" ${m >= t.slice(0, 8) + '01' ? 'disabled' : ''}>›</button>
      </div>
      <div class="cal">${cells}</div>
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
  const tab = ['stats', 'ajustes'].includes(r.name) ? r.name : 'hoy';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
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

  if (a === 'prev-month' || a === 'next-month') {
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
