// Festivos con Nager.Date (sin clave, HTTPS, CORS abierto).
// Documentación: https://nagerholidays.com/api · Condiciones: https://nagerholidays.com/legal/termsofservice
// Uso permitido: proyectos privados o sin ánimo de lucro (el uso comercial exige patrocinio).
// Se usa la API v3 porque devuelve el nombre local del festivo (en español para España).
// - Una petición por país y año; se guarda en el dispositivo y se renueva cada 30 días.
// - Si la API falla, tarda o limita (429), espera antes de reintentar y usa lo guardado.
// - Solo marca los festivos: no cambia rachas ni porcentajes.

const API = 'https://date.nager.at/api/v3';
const REGION_KEY = 'hilo-holiday-region';
const COUNTRIES_KEY = 'hilo-holiday-countries';
const cacheKey = (cc, year) => `hilo-holidays-${cc}-${year}`;
const backoffKey = (what) => `hilo-holidays-retry-${what}`;
const TIMEOUT_MS = 5000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // los festivos casi no cambian
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

// Nombres de las comunidades autónomas (la API solo da los códigos).
const ES_REGIONS = {
  'ES-AN': 'Andalucía', 'ES-AR': 'Aragón', 'ES-AS': 'Asturias', 'ES-CB': 'Cantabria',
  'ES-CE': 'Ceuta', 'ES-CL': 'Castilla y León', 'ES-CM': 'Castilla-La Mancha', 'ES-CN': 'Canarias',
  'ES-CT': 'Cataluña', 'ES-EX': 'Extremadura', 'ES-GA': 'Galicia', 'ES-IB': 'Islas Baleares',
  'ES-MC': 'Región de Murcia', 'ES-MD': 'Comunidad de Madrid', 'ES-ML': 'Melilla', 'ES-NC': 'Navarra',
  'ES-PV': 'País Vasco', 'ES-RI': 'La Rioja', 'ES-VC': 'Comunidad Valenciana',
};
export const regionName = (code) => ES_REGIONS[code] || code;

let countryNames = null;
try { countryNames = new Intl.DisplayNames(['es'], { type: 'region' }); } catch { /* navegador antiguo */ }
export const countryName = (cc) => { try { return (countryNames && countryNames.of(cc)) || cc; } catch { return cc; } };

// ---------- ajustes ----------
export function getRegion() {
  const r = storage.get(REGION_KEY);
  const country = r && /^[A-Z]{2}$/.test(r.country) ? r.country : 'ES';
  const sub = r && typeof r.sub === 'string' && r.sub.startsWith(country + '-') ? r.sub : null;
  return { country, sub, chosen: !!r };
}
export function setRegion(country, sub) {
  storage.set(REGION_KEY, { country, sub: sub && sub.startsWith(country + '-') ? sub : null });
}

// ---------- red ----------
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('Retry-After'));
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function waiting(what) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return Date.now() < (Number(storage.get(backoffKey(what))) || 0);
}
function failed(what, e) {
  let wait = RETRY_AFTER_ERROR_MS;
  if (e && e.status === 429) wait = Number.isFinite(e.retryAfter) && e.retryAfter > 0 ? e.retryAfter * 1000 : 60 * 60 * 1000;
  if (e && e.status === 404) wait = MAX_RETRY_MS; // país sin datos: no insistir hoy
  storage.set(backoffKey(what), Date.now() + Math.min(wait, MAX_RETRY_MS));
}

const inflight = new Map();
function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

// ---------- festivos ----------
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Algunos países traen el nombre local en inglés (p. ej. Paraguay, 1 de enero).
// Se traduce al leer, así también arregla las listas ya guardadas en el teléfono.
const EN_ES = {
  "New Year's Day": 'Año Nuevo', 'Christmas Day': 'Navidad', 'Christmas Eve': 'Nochebuena',
  'Good Friday': 'Viernes Santo', 'Maundy Thursday': 'Jueves Santo', 'Easter Sunday': 'Domingo de Pascua',
  'Easter Monday': 'Lunes de Pascua', 'Labour Day': 'Día del Trabajo', "All Saints' Day": 'Día de Todos los Santos',
  'Epiphany': 'Epifanía', 'Assumption Day': 'Asunción de la Virgen', 'Immaculate Conception': 'Inmaculada Concepción',
  "New Year's Eve": 'Nochevieja',
};
const toSpanish = (name) => EN_ES[name] || name;

function parseList(json) {
  if (!Array.isArray(json)) return null;
  return json
    .filter((h) => h && isDate(h.date) && (typeof h.localName === 'string' || typeof h.name === 'string'))
    .filter((h) => !Array.isArray(h.types) || h.types.includes('Public'))
    .map((h) => ({
      date: h.date,
      name: String(h.localName || h.name).slice(0, 100),
      subs: Array.isArray(h.counties) ? h.counties.filter((c) => typeof c === 'string') : null,
    }));
}

// Lista guardada de un país y año (o null).
const cached = (cc, year) => {
  const c = storage.get(cacheKey(cc, year));
  return c && Array.isArray(c.list) ? c : null;
};

// Pide a la API el año si falta o está viejo. Devuelve true si hay datos nuevos.
export function ensureYear(year, cc = getRegion().country) {
  const c = cached(cc, year);
  if (c && Date.now() - c.fetchedAt < REFRESH_MS) return Promise.resolve(false);
  const what = `${cc}-${year}`;
  if (waiting(what)) return Promise.resolve(false);
  return once(what, async () => {
    try {
      const list = parseList(await getJSON(`${API}/PublicHolidays/${year}/${cc}`));
      if (!list) throw new Error('respuesta no válida');
      storage.set(cacheKey(cc, year), { fetchedAt: Date.now(), list });
      storage.set(backoffKey(what), 0);
      return true;
    } catch (e) {
      failed(what, e);
      return false;
    }
  });
}

// Festivos de un año que aplican a la región elegida, ya guardados (sin red).
export function holidaysOf(year) {
  const { country, sub } = getRegion();
  const c = cached(country, year);
  if (!c) return [];
  return c.list
    .filter((h) => !h.subs || (sub && h.subs.includes(sub)))
    .map((h) => ({ ...h, name: toSpanish(h.name) }));
}

// Festivo de un día (clave AAAA-MM-DD) o null. Si hay dos el mismo día, los une.
export function holidayOn(dayKey) {
  const names = holidaysOf(Number(dayKey.slice(0, 4))).filter((h) => h.date === dayKey).map((h) => h.name);
  return names.length ? [...new Set(names)].join(' · ') : null;
}

// Comunidades que aparecen en los datos del país (para el selector de Ajustes).
export function subdivisions(year) {
  const { country } = getRegion();
  const c = cached(country, year);
  const set = new Set(country === 'ES' ? Object.keys(ES_REGIONS) : []);
  if (c) for (const h of c.list) for (const s of h.subs || []) set.add(s);
  return [...set].sort((a, b) => regionName(a).localeCompare(regionName(b), 'es'));
}

// ---------- países ----------
export function countries() {
  const c = storage.get(COUNTRIES_KEY);
  return c && Array.isArray(c.list) ? c.list : [];
}
export function ensureCountries() {
  const c = storage.get(COUNTRIES_KEY);
  if (c && Array.isArray(c.list) && Date.now() - c.fetchedAt < REFRESH_MS) return Promise.resolve(false);
  if (waiting('countries')) return Promise.resolve(false);
  return once('countries', async () => {
    try {
      const json = await getJSON(`${API}/AvailableCountries`);
      const list = (Array.isArray(json) ? json : []).map((x) => x && x.countryCode).filter((cc) => /^[A-Z]{2}$/.test(cc || ''));
      if (!list.length) throw new Error('respuesta no válida');
      storage.set(COUNTRIES_KEY, { fetchedAt: Date.now(), list });
      return true;
    } catch (e) {
      failed('countries', e);
      return false;
    }
  });
}
