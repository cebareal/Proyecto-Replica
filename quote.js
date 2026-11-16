// Frase del día con la API PositiveQuotation (sin clave, HTTPS, CORS abierto).
// Documentación: https://positivequotation.com/developers/public-domain-quotes-api
// - Pide como mucho una frase al día y la guarda en el dispositivo.
// - Si la API falla, tarda o limita (429), espera antes de reintentar y muestra
//   la última frase guardada o una de reserva en español. La app nunca se rompe.

const API_URL = 'https://positivequotation.com/api/v1/quotes/random';
const CACHE_KEY = 'hilo-quote';
const BACKOFF_KEY = 'hilo-quote-retry';
const TIMEOUT_MS = 5000;
const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000; // 15 min tras un fallo de red o del servidor
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;    // nunca esperar más de un día

// Refranes populares en español (dominio público) para cuando no hay conexión.
const FALLBACK = [
  'Poco a poco se va lejos.',
  'Roma no se hizo en un día.',
  'La constancia vence lo que la dicha no alcanza.',
  'Gota a gota se llena la bota.',
  'Quien la sigue, la consigue.',
  'Más vale paso que dure que trote que canse.',
  'No por mucho madrugar amanece más temprano.',
];

const storage = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: no pasa nada */ } },
};

function fallbackFor(day) {
  const n = [...day].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return { day, text: FALLBACK[n % FALLBACK.length], author: 'Refrán popular', lang: 'es', source: null, link: null };
}

const safeLink = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

// Convierte la respuesta de la API en nuestro formato, o devuelve null si no es válida.
function parse(json, day) {
  const d = json && json.data;
  if (!d || typeof d.quote !== 'string' || !d.quote.trim()) return null;
  const src = d.source && typeof d.source === 'object' ? d.source : {};
  return {
    day,
    text: d.quote.trim().slice(0, 400),
    author: typeof d.attribution === 'string' ? d.attribution.slice(0, 120) : '',
    lang: 'en',
    source: [src.compiler, src.title].filter((x) => typeof x === 'string' && x).join(', ').slice(0, 200) || null,
    link: safeLink(d.detail_url) || safeLink(src.url),
  };
}

// Lo que se puede mostrar ya, sin esperar a la red.
export function cachedQuote(day) {
  const c = storage.get(CACHE_KEY);
  if (c && c.day === day && c.text) return c;
  return c && c.text ? { ...c, stale: true } : fallbackFor(day);
}

let inflight = null;

// Devuelve la frase de hoy. Solo llama a la API si hoy aún no hay una guardada
// y no estamos esperando por un fallo anterior. Nunca lanza errores.
export function dailyQuote(day) {
  const c = storage.get(CACHE_KEY);
  if (c && c.day === day && c.text) return Promise.resolve(c);
  const retryAt = Number(storage.get(BACKOFF_KEY)) || 0;
  if (Date.now() < retryAt || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return Promise.resolve(cachedQuote(day));
  }
  if (!inflight) inflight = fetchQuote(day).finally(() => { inflight = null; });
  return inflight;
}

async function fetchQuote(day) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, { signal: ctrl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 429) {
      const secs = Number(res.headers.get('Retry-After'));
      const wait = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 60 * 60 * 1000;
      storage.set(BACKOFF_KEY, Date.now() + Math.min(wait, MAX_RETRY_MS));
      return cachedQuote(day);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q = parse(await res.json(), day);
    if (!q) throw new Error('respuesta no válida');
    storage.set(CACHE_KEY, q);
    storage.set(BACKOFF_KEY, 0);
    return q;
  } catch {
    storage.set(BACKOFF_KEY, Date.now() + RETRY_AFTER_ERROR_MS);
    return cachedQuote(day);
  } finally {
    clearTimeout(timer);
  }
}
