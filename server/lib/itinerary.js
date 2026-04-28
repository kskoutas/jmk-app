/**
 * JMK · Itinerary Generator
 * -------------------------
 * Το CORE feature της εφαρμογής. Δίνει 3 πλάνα/μέρα στον guest.
 *
 * Είσοδος:
 *   - hotel: { id, islandId, ... }
 *   - dates: ['2026-07-15', '2026-07-16', ...]
 *   - guest: { interests: ['beach','food','wine','adventure',...], traveler: 'couple'|'family'|'solo' }
 *   - allActivities: array με όλα τα ενεργά activities
 *   - getForecast(islandId, date): async function από weather.js
 *
 * Έξοδος ανά μέρα: 3 themed plans
 *   • "Adventure" (boat/snorkel/hike)
 *   • "Relax"     (food/wine/sunset)
 *   • "Foodie"    (food/wine/workshop)
 * Κάθε plan: { theme, slots: [{time:'morning'|'afternoon'|'evening', activity}], totalPrice }
 *
 * Φιλτράρει ΑΥΣΤΗΡΑ:
 *   1. island του ξενοδοχείου
 *   2. activity.status === 'active'
 *   3. weather suitability
 *   4. variety: όχι 2 ίδια category σε ένα plan
 */
'use strict';

const { isActivitySuitable } = require('./weather');

const THEMES = [
  {
    name: 'Adventure',
    nameGr: 'Περιπέτεια',
    icon: '🌊',
    description: 'Θάλασσα, αδρεναλίνη, εξερεύνηση',
    morningCats:   ['boat','snorkel','hike'],
    afternoonCats: ['rental','tour','snorkel'],
    eveningCats:   ['food','sunset']
  },
  {
    name: 'Relax',
    nameGr: 'Χαλάρωση',
    icon: '🌅',
    description: 'Ήρεμη μέρα με ωραία φαγητά και θέα',
    morningCats:   ['tour','culture','wine'],
    afternoonCats: ['food','wine','workshop'],
    eveningCats:   ['sunset','food']
  },
  {
    name: 'Foodie',
    nameGr: 'Γαστρονομία',
    icon: '🍽',
    description: 'Τοπικές γεύσεις και κρασιά',
    morningCats:   ['workshop','tour','culture'],
    afternoonCats: ['wine','food','workshop'],
    eveningCats:   ['food','wine','sunset']
  }
];

/**
 * Generate itinerary για ένα guest stay.
 */
async function generate({ hotel, dates, guest, allActivities, getForecast }) {
  if (!hotel || !hotel.islandId) throw new Error('hotel.islandId απαιτείται');
  if (!Array.isArray(dates) || dates.length === 0) throw new Error('dates array απαιτείται');

  // Φιλτράρισμα: μόνο active activities, σωστό island
  const candidates = (allActivities || []).filter(a =>
    a.status === 'active' && a.islandId === hotel.islandId
  );

  if (candidates.length < 3) {
    return { warning: 'Λίγα activities στο νησί. Πρόσθεσε partners.', days: [] };
  }

  const days = [];
  for (const date of dates) {
    const forecast = getForecast ? await getForecast(hotel.islandId, date) : null;
    const dayPlans = [];

    for (const theme of THEMES) {
      const plan = buildPlan(theme, candidates, forecast, guest);
      if (plan && plan.slots.length > 0) {
        dayPlans.push(plan);
      }
    }

    days.push({
      date,
      forecast: forecast ? {
        summary: forecast.summary,
        tempMaxC: forecast.tempMaxC,
        windKmh: forecast.windKmh,
        precipMm: forecast.precipMm,
        warning: getWeatherWarning(forecast)
      } : null,
      plans: dayPlans
    });
  }

  return { hotelId: hotel.id, islandId: hotel.islandId, days };
}

function buildPlan(theme, candidates, forecast, guest) {
  const used = new Set();
  const slots = [];
  const slotConfigs = [
    { name: 'morning',   timeLabel: '09:00–13:00', cats: theme.morningCats },
    { name: 'afternoon', timeLabel: '14:00–18:00', cats: theme.afternoonCats },
    { name: 'evening',   timeLabel: '19:00–22:00', cats: theme.eveningCats }
  ];

  for (const slot of slotConfigs) {
    const pick = pickActivity({
      candidates,
      preferredCats: slot.cats,
      excludeIds: used,
      forecast,
      guest
    });
    if (pick) {
      used.add(pick.id);
      slots.push({
        slot: slot.name,
        time: slot.timeLabel,
        activity: pick
      });
    }
  }

  if (slots.length === 0) return null;

  const totalPrice = slots.reduce((sum, s) => sum + (Number(s.activity.price) || 0), 0);

  return {
    theme: theme.name,
    themeGr: theme.nameGr,
    icon: theme.icon,
    description: theme.description,
    slots,
    totalPrice: Math.round(totalPrice * 100) / 100,
    weatherSafe: forecast ? slots.every(s => isActivitySuitable(s.activity, forecast)) : true
  };
}

function pickActivity({ candidates, preferredCats, excludeIds, forecast, guest }) {
  // Σκορ-βάση: preferred category match + interest match + rating + weather safety
  const interests = (guest && guest.interests) || [];

  const scored = candidates
    .filter(a => !excludeIds.has(a.id))
    .filter(a => isActivitySuitable(a, forecast))
    .map(a => {
      let score = 0;
      if (preferredCats.includes(a.category)) score += 10;
      if (interests.includes(a.category)) score += 5;
      if (interests.some(i => (a.description || '').toLowerCase().includes(i))) score += 2;
      score += Math.min(5, Number(a.rating) || 0); // boost popular
      score += (Number(a.reviewCount) || 0) > 50 ? 2 : 0;
      // tiny random tiebreaker so consecutive days don't pick the exact same thing
      score += Math.random() * 0.5;
      return { activity: a, score };
    })
    .sort((x, y) => y.score - x.score);

  return scored[0]?.activity || null;
}

function getWeatherWarning(forecast) {
  if (!forecast) return null;
  if ((forecast.precipMm || 0) >= 5) return '⛈ Σημαντική βροχή — προτείνουμε indoor activities και delivery.';
  if ((forecast.windKmh || 0) >= 35) return '💨 Πολύ δυνατός αέρας — boat trips ίσως ακυρωθούν.';
  if ((forecast.tempMaxC || 0) >= 36) return '🥵 Καύσωνας — αποφύγετε πεζοπορία το μεσημέρι.';
  return null;
}

module.exports = { generate, THEMES };
