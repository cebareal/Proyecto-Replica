// Tiempo de hoy con Open-Meteo (sin clave, HTTPS, CORS abierto).
// Documentación: https://open-meteo.com/en/docs · Datos bajo licencia CC BY 4.0.
// Uso gratuito solo no comercial (sin anuncios ni suscripciones):
// https://open-meteo.com/en/terms
// - La ciudad la elige la persona en Ajustes; solo sus coordenadas salen del teléfono.
// - Como mucho una petición por hora; el resultado se guarda en el dispositivo.
// - Si la API falla, tarda o limita (429), espera antes de reintentar y muestra
//   lo último guardado. La app nunca se rompe.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const CITY_KEY = 'hilo-city';
const CACHE_KEY = 'hilo-weather';
const BACKOFF_KEY = 'hilo-weather-retry';
const TIMEOUT_MS = 5000;
const FRESH_MS = 60 * 60 * 1000;               // una petición por hora como mucho
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000;   // 15 min tras un fallo
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

// Códigos WMO que usa Open-Meteo → icono y texto.
const WMO = [
  [[0], '☀️', 'Despejado', '🌙'],
  [[1], '🌤️', 'Casi despejado', '🌙'],
  [[2], '⛅', 'Parcialmente nublado'],
  [[3], '☁️', 'Nublado'],
  [[45, 48], '🌫️', 'Niebla'],
  [[51, 53, 55, 56, 57], '🌦️', 'Llovizna'],
  [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Lluvia'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'Nieve'],
  [[95, 96, 99], '⛈️', 'Tormenta'],
];
export function describe(code, isDay = true) {
  const row = WMO.find(([codes]) => codes.includes(code));
  if (!row) return { icon: '🌡️', label: 'Tiempo' };
  return { icon: !isDay && row[3] ? row[3] : row[1], label: row[2] };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Petición con tiempo máximo. Lanza un Error con .status (429, 500…) o .timeout.
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.retryAfter = Number(res.headers.get('Retry-After'));
      throw err;
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error('timeout'); err.timeout = true; throw err; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- ciudad ----------
export const getCity = () => {
  const c = storage.get(CITY_KEY);
  return c && num(c.lat) !== null && num(c.lon) !== null ? c : null;
};
export function setCity(c) {
  storage.set(CITY_KEY, { name: c.name, region: c.region, lat: c.lat, lon: c.lon });
  storage.del(CACHE_KEY);
  storage.del(BACKOFF_KEY);
}
export function clearCity() { storage.del(CITY_KEY); storage.del(CACHE_KEY); storage.del(BACKOFF_KEY); }

// Busca ciudades por nombre. Devuelve { results } o { error } con un mensaje para mostrar.
export async function searchCity(name) {
  const q = String(name || '').trim();
  if (q.length < 2) return { error: 'Escribe al menos 2 letras.' };
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=5&language=es&format=json`;
  try {
    const json = await getJSON(url);
    const results = (Array.isArray(json && json.results) ? json.results : [])
      .filter((r) => r && typeof r.name === 'string' && num(r.latitude) !== null && num(r.longitude) !== null)
      .map((r) => ({
        name: r.name.slice(0, 80),
        region: [r.admin1, r.country].filter((x) => typeof x === 'string' && x).join(', ').slice(0, 120),
        lat: Math.round(r.latitude * 100) / 100, // ~1 km: suficiente y más privado
        lon: Math.round(r.longitude * 100) / 100,
      }));
    return results.length ? { results } : { error: 'No he encontrado esa ciudad.' };
  } catch (e) {
    if (e.status === 429) return { error: 'Demasiadas búsquedas seguidas. Prueba en un minuto.' };
    return { error: e.timeout ? 'El servicio tarda demasiado. Prueba más tarde.' : 'No se pudo buscar. Revisa la conexión.' };
  }
}

// ---------- tiempo ----------
const sameCity = (w, c) => w && c && w.lat === c.lat && w.lon === c.lon;

// Lo que se puede mostrar ya, sin esperar a la red (o null si no hay nada guardado).
export function cachedWeather() {
  const c = getCity();
  const w = storage.get(CACHE_KEY);
  return sameCity(w, c) ? w : null;
}

function parse(json, city, today) {
  const cur = json && json.current;
  const d = json && json.daily;
  const temp = num(cur && cur.temperature_2m);
  const code = num(cur && cur.weather_code);
  if (temp === null || code === null) return null;
  const first = (arr) => (Array.isArray(arr) ? num(arr[0]) : null);
  return {
    lat: city.lat,
    lon: city.lon,
    fetchedAt: Date.now(),
    day: today,
    temp: Math.round(temp),
    code,
    isDay: cur.is_day !== 0,
    max: first(d && d.temperature_2m_max) === null ? null : Math.round(d.temperature_2m_max[0]),
    min: first(d && d.temperature_2m_min) === null ? null : Math.round(d.temperature_2m_min[0]),
    rain: first(d && d.precipitation_probability_max),
  };
}

let inflight = null;

// Devuelve el tiempo de hoy (o null si no hay ciudad). Nunca lanza errores.
export function todayWeather(today) {
  const city = getCity();
  if (!city) return Promise.resolve(null);
  const w = cachedWeather();
  if (w && w.day === today && Date.now() - w.fetchedAt < FRESH_MS) return Promise.resolve(w);
  const retryAt = Number(storage.get(BACKOFF_KEY)) || 0;
  if (Date.now() < retryAt || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve(w);
  if (!inflight) inflight = fetchWeather(city, today).finally(() => { inflight = null; });
  return inflight;
}

async function fetchWeather(city, today) {
  const url = `${FORECAST_URL}?latitude=${city.lat}&longitude=${city.lon}`
    + '&current=temperature_2m,weather_code,is_day'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=auto&forecast_days=1';
  try {
    const w = parse(await getJSON(url), city, today);
    if (!w) throw new Error('respuesta no válida');
    if (!sameCity(w, getCity())) return cachedWeather(); // la ciudad cambió mientras tanto
    storage.set(CACHE_KEY, w);
    storage.set(BACKOFF_KEY, 0);
    return w;
  } catch (e) {
    let wait = RETRY_AFTER_ERROR_MS;
    if (e.status === 429) wait = Number.isFinite(e.retryAfter) && e.retryAfter > 0 ? e.retryAfter * 1000 : 60 * 60 * 1000;
    storage.set(BACKOFF_KEY, Date.now() + Math.min(wait, MAX_RETRY_MS));
    return cachedWeather();
  }
}
