/**
 * JMK · Dynamic Pricing
 * ----------------------
 * Υπολογίζει την τελική τιμή με βάση: base price, season, day of week, last-minute,
 * group size discounts.
 *
 * activity.pricing = {
 *   base:           110,                 // βασική τιμή/άτομο (αν unit='person') ή/group (αν unit='group')
 *   unit:           'person'|'group',
 *   currency:       'EUR',
 *   highSeason:     { start:'2026-07-01', end:'2026-08-31', multiplier:1.20 },
 *   weekend:        { multiplier: 1.10, days:[5,6] },   // Σαβ=5, Κυρ=6 (στη βδομάδα μας Δευ=0)
 *   lastMinute:     { hoursBefore:48, multiplier:0.85 },
 *   earlyBird:      { daysBefore:30,  multiplier:0.90 },
 *   groupDiscounts: [{ minPeople:6, multiplier:0.95 }, { minPeople:10, multiplier:0.90 }]
 * }
 *
 * Αν δεν υπάρχει pricing object, χρησιμοποιείται το activity.price ως flat per-person.
 */
'use strict';

function compute({ activity, date, time, people = 1, now = new Date() }) {
  const p = normalize(activity.pricing, activity.price);
  const ppl = Math.max(1, Number(people) || 1);
  const target = parseDate(date, time);

  let unitPrice = p.base;
  const reasons = [];

  // High season
  if (p.highSeason && date >= p.highSeason.start && date <= p.highSeason.end) {
    unitPrice *= p.highSeason.multiplier;
    reasons.push({ rule: 'high_season', multiplier: p.highSeason.multiplier });
  }

  // Weekend
  if (p.weekend && p.weekend.days?.length) {
    const dow = (target.getDay() + 6) % 7; // Δευ=0..Κυρ=6
    if (p.weekend.days.includes(dow)) {
      unitPrice *= p.weekend.multiplier;
      reasons.push({ rule: 'weekend', multiplier: p.weekend.multiplier });
    }
  }

  // Last-minute discount
  if (p.lastMinute && p.lastMinute.hoursBefore > 0) {
    const hoursAhead = (target - now) / 3600000;
    if (hoursAhead > 0 && hoursAhead <= p.lastMinute.hoursBefore) {
      unitPrice *= p.lastMinute.multiplier;
      reasons.push({ rule: 'last_minute', multiplier: p.lastMinute.multiplier });
    }
  }

  // Early bird discount
  if (p.earlyBird && p.earlyBird.daysBefore > 0) {
    const daysAhead = (target - now) / 86400000;
    if (daysAhead >= p.earlyBird.daysBefore) {
      unitPrice *= p.earlyBird.multiplier;
      reasons.push({ rule: 'early_bird', multiplier: p.earlyBird.multiplier });
    }
  }

  // Group discounts (apply largest applicable)
  let groupMult = 1;
  if (Array.isArray(p.groupDiscounts)) {
    for (const gd of p.groupDiscounts.sort((a, b) => b.minPeople - a.minPeople)) {
      if (ppl >= gd.minPeople) { groupMult = gd.multiplier; break; }
    }
    if (groupMult !== 1) {
      unitPrice *= groupMult;
      reasons.push({ rule: 'group_discount', multiplier: groupMult });
    }
  }

  unitPrice = round2(unitPrice);
  const total = p.unit === 'group' ? unitPrice : round2(unitPrice * ppl);

  return {
    base:        p.base,
    unit:        p.unit,
    currency:    p.currency || 'EUR',
    unitPrice,
    people:      ppl,
    total,
    breakdown:   reasons
  };
}

function normalize(pricing, fallbackBase) {
  if (!pricing && typeof fallbackBase === 'number') {
    return { base: fallbackBase, unit: 'person', currency: 'EUR' };
  }
  return Object.assign({
    unit: 'person',
    currency: 'EUR'
  }, pricing || { base: fallbackBase || 0 });
}

function parseDate(dateStr, timeStr = '10:00') {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}

function round2(x) { return Math.round(x * 100) / 100; }

module.exports = { compute, normalize };
