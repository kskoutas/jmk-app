/**
 * JMK · Weather Service
 * ---------------------
 * Live forecasts από Open-Meteo (δωρεάν, χωρίς API key).
 * Cache 1 ώρα ανά (island, date) ώστε να μη χτυπάμε το API σε κάθε itinerary request.
 *
 * Επιστρέφει για κάθε μέρα:
 *   { date, tempMaxC, tempMinC, windKmh, precipMm, summary, suitable: ['no-rain','wind<25',...] }
 *
 * Τα activity records έχουν `weatherConditions` flags όπως ['wind<30','no-rain'].
 * Η συνάρτηση `isActivitySuitable(activity, forecast)` κάνει το matching.
 */
'use strict';

// Συντεταγμένες ανά island (centroid). Open-Meteo δέχεται lat/lon.
const ISLAND_COORDS = {
  'isl-naxos':     { lat: 37.10, lon: 25.38, tz: 'Europe/Athens' },
  'isl-paros':     { lat: 37.08, lon: 25.15, tz: 'Europe/Athens' },
  'isl-santorini': { lat: 36.40, lon: 25.43, tz: 'Europe/Athens' },
  'isl-mykonos':   { lat: 37.45, lon: 25.33, tz: 'Europe/Athens' },
  'isl-milos':     { lat: 36.69, lon: 24.42, tz: 'Europe/Athens' },
  'isl-rhodes':    { lat: 36.43, lon: 28.22, tz: 'Europe/Athens' },
  'isl-crete':     { lat: 35.34, lon: 25.13, tz: 'Europe/Athens' },
  'isl-corfu':     { lat: 39.62, lon: 19.92, tz: 'Europe/Athens' },
  'isl-zakynthos': { lat: 37.79, lon: 20.90, tz: 'Europe/Athens' },
  'isl-kefalonia': { lat: 38.18, lon: 20.57, tz: 'Europe/Athens' },
  'isl-lesvos':    { lat: 39.10, lon: 26.55, tz: 'Europe/Athens' },
  'isl-skiathos':  { lat: 39.16, lon: 23.49, tz: 'Europe/Athens' }
};

const cache = new Map();   // key = `${islandId}:${date}` → { ts, forecast }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 ώρα

/**
 * Φέρνει forecast για ένα island σε μια ημερομηνία (YYYY-MM-DD).
 * Αν το date είναι παρελθόν ή >16 μέρες στο μέλλον → επιστρέφει climate fallback.
 */
async function getForecast(islandId, date) {
  const coords = ISLAND_COORDS[islandId];
  if (!coords) return fallbackForecast(date, 'unknown island');

  const key = `${islandId}:${date}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.forecast;

  const today = new Date();
  const target = new Date(date);
  const daysAhead = Math.floor((target - today) / 86400000);

  // Open-Meteo forecast μέχρι 16 μέρες — αλλιώς γυρίζω fallback (κλιματικός μέσος όρος για Ελλάδα-καλοκαίρι).
  if (isNaN(target.getTime()) || daysAhead > 16) {
    const f = fallbackForecast(date, 'date out of forecast range');
    cache.set(key, { ts: Date.now(), forecast: f });
    return f;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
                `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code` +
                `&start_date=${date}&end_date=${date}&timezone=${encodeURIComponent(coords.tz)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const data = await res.json();
    const d = data.daily;
    const forecast = {
      date,
      tempMaxC: d.temperature_2m_max?.[0] ?? null,
      tempMinC: d.temperature_2m_min?.[0] ?? null,
      windKmh:  d.wind_speed_10m_max?.[0] ?? null,
      precipMm: d.precipitation_sum?.[0] ?? 0,
      weatherCode: d.weather_code?.[0] ?? null,
      summary: codeToSummary(d.weather_code?.[0]),
      source: 'open-meteo'
    };
    forecast.suitable = computeSuitableFlags(forecast);
    cache.set(key, { ts: Date.now(), forecast });
    return forecast;
  } catch (err) {
    console.warn('[weather] fetch failed, using fallback:', err.message);
    const f = fallbackForecast(date, err.message);
    cache.set(key, { ts: Date.now(), forecast: f });
    return f;
  }
}

function fallbackForecast(date, reason) {
  // Συντηρητικό fallback για ελληνικό καλοκαίρι: ηλιόλουστο, μέτριος αέρας.
  return {
    date,
    tempMaxC: 28,
    tempMinC: 22,
    windKmh:  20,
    precipMm: 0,
    weatherCode: 0,
    summary: 'Καλοκαιρινός μέσος όρος (fallback)',
    suitable: ['no-rain','wind<25','wind<28','wind<30'],
    source: 'fallback',
    fallbackReason: reason
  };
}

function computeSuitableFlags(f) {
  const flags = [];
  if ((f.precipMm || 0) < 1) flags.push('no-rain');
  if ((f.precipMm || 0) < 3) flags.push('low-rain');
  const w = Number(f.windKmh) || 0;
  for (const limit of [20, 25, 28, 30, 35, 40]) {
    if (w < limit) flags.push(`wind<${limit}`);
  }
  if ((f.tempMaxC || 0) < 32) flags.push('not-extreme-heat');
  return flags;
}

function codeToSummary(code) {
  // WMO weather codes (subset)
  const m = {
    0:'Καθαρός', 1:'Κυρίως καθαρός', 2:'Μερικώς συννεφιασμένος', 3:'Συννεφιασμένος',
    45:'Ομίχλη', 48:'Παγωμένη ομίχλη',
    51:'Ψιλόβροχο', 53:'Ψιλόβροχο', 55:'Έντονο ψιλόβροχο',
    61:'Βροχή', 63:'Βροχή', 65:'Έντονη βροχή',
    71:'Χιόνι', 73:'Χιόνι', 75:'Έντονο χιόνι',
    80:'Μπόρες', 81:'Μπόρες', 82:'Έντονες μπόρες',
    95:'Καταιγίδα', 96:'Καταιγίδα με χαλάζι', 99:'Καταιγίδα με χαλάζι'
  };
  return m[code] || 'Άγνωστο';
}

/**
 * Είναι το activity κατάλληλο για αυτή την πρόγνωση;
 * Λογική: όλα τα flags στο activity.weatherConditions πρέπει να καλύπτονται από το forecast.suitable.
 */
function isActivitySuitable(activity, forecast) {
  const required = activity.weatherConditions || [];
  if (required.length === 0) return true; // indoor / weather-agnostic
  if (!forecast || !forecast.suitable) return true; // αν δεν ξέρουμε καιρό, μη μπλοκάρουμε
  return required.every(flag => forecast.suitable.includes(flag));
}

module.exports = { getForecast, isActivitySuitable, ISLAND_COORDS };
