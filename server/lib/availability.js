/**
 * JMK · Activity Availability & Calendar
 * ---------------------------------------
 * Δομή availability ανά activity (αποθηκεύεται στο activity record):
 *
 *   activity.schedule = {
 *     weekly:        [1,1,1,1,1,1,0],  // Δευ..Κυρ — 1=ανοιχτά
 *     timeSlots:     [
 *       { id:'ts-morn', time:'10:00', durationMin:360, capacity:8, label:'Morning' },
 *       { id:'ts-aft',  time:'14:00', durationMin:240, capacity:6 }
 *     ],
 *     blockedDates:  ['2026-08-15','2026-08-16'],   // partner λείπει
 *     openDates:     [],                            // override για κλειστές μέρες
 *     minAdvanceHours: 12,
 *     maxAdvanceDays:  120,
 *     seasonStart:   '2026-05-01',
 *     seasonEnd:     '2026-10-15'
 *   }
 *
 * API:
 *   getAvailableDates(activity, fromDate, toDate, bookings)
 *     → array με { date, slots:[{slot, capacity, booked, available}] }
 *
 *   isSlotAvailable(activity, date, slotId, peopleRequested, bookings)
 *     → { ok, reason?, remaining? }
 *
 * Όλες οι ημερομηνίες σε ISO YYYY-MM-DD format. Τοπική ζώνη: Europe/Athens.
 */
'use strict';

const DAY_MS = 86400000;

/**
 * Επιστρέφει calendar grid από fromDate έως toDate.
 * @param {object} activity      - το activity record
 * @param {string} fromDate      - 'YYYY-MM-DD'
 * @param {string} toDate        - 'YYYY-MM-DD'
 * @param {array}  bookings      - όλα τα bookings αυτού του activity (για να μετράμε capacity used)
 * @returns {array} ένα entry ανά μέρα: { date, dayOfWeek, isOpen, reason?, slots:[...] }
 */
function getAvailableDates(activity, fromDate, toDate, bookings = []) {
  const sched = normalizeSchedule(activity.schedule);
  const start = new Date(fromDate);
  const end   = new Date(toDate);
  if (isNaN(start) || isNaN(end) || start > end) return [];

  const out = [];
  const now = new Date();

  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    const dow = (d.getDay() + 6) % 7; // Δευ=0..Κυρ=6 (αντί Sun=0..Sat=6)

    let isOpen = true;
    let reason = null;

    // Past date
    if (d < startOfDay(now)) {
      isOpen = false;
      reason = 'past';
    }
    // Min advance hours
    else if (sched.minAdvanceHours > 0 && (d.getTime() - now.getTime()) < sched.minAdvanceHours * 3600000) {
      isOpen = false;
      reason = 'too_soon';
    }
    // Max advance days
    else if (sched.maxAdvanceDays > 0 && (d.getTime() - now.getTime()) > sched.maxAdvanceDays * DAY_MS) {
      isOpen = false;
      reason = 'too_far';
    }
    // Season window
    else if (sched.seasonStart && iso < sched.seasonStart) {
      isOpen = false;
      reason = 'before_season';
    }
    else if (sched.seasonEnd && iso > sched.seasonEnd) {
      isOpen = false;
      reason = 'after_season';
    }
    // Blocked specifically
    else if (sched.blockedDates.includes(iso)) {
      isOpen = false;
      reason = 'blocked';
    }
    // Recurring weekly closed (unless openDates override)
    else if (sched.weekly[dow] === 0 && !sched.openDates.includes(iso)) {
      isOpen = false;
      reason = 'closed_dow';
    }

    const slots = isOpen
      ? sched.timeSlots.map(slot => {
          const booked = sumBooked(bookings, iso, slot.id);
          return {
            slotId:   slot.id,
            time:     slot.time,
            durationMin: slot.durationMin,
            label:    slot.label || slot.time,
            capacity: slot.capacity,
            booked,
            available: Math.max(0, slot.capacity - booked),
            soldOut:  booked >= slot.capacity
          };
        })
      : [];

    out.push({
      date: iso,
      dayOfWeek: dow,
      isOpen,
      reason,
      slots
    });
  }
  return out;
}

/**
 * Έλεγχος αν συγκεκριμένο slot είναι διαθέσιμο για τόσα άτομα.
 */
function isSlotAvailable(activity, date, slotId, peopleRequested, bookings = []) {
  const sched = normalizeSchedule(activity.schedule);
  const slot = sched.timeSlots.find(s => s.id === slotId || s.time === slotId);
  if (!slot) return { ok: false, reason: 'slot_not_found' };

  const days = getAvailableDates(activity, date, date, bookings);
  const day = days[0];
  if (!day || !day.isOpen) return { ok: false, reason: day?.reason || 'closed' };

  const ds = day.slots.find(s => s.slotId === slot.id);
  if (!ds) return { ok: false, reason: 'slot_unavailable' };
  if (ds.available < peopleRequested) {
    return { ok: false, reason: 'not_enough_capacity', remaining: ds.available };
  }
  return { ok: true, remaining: ds.available - peopleRequested };
}

/**
 * Επιστρέφει τα επόμενα Ν διαθέσιμα slots μετά από συγκεκριμένη ημερομηνία.
 */
function nextAvailableSlots(activity, fromDate, count = 5, bookings = []) {
  const horizonEnd = new Date(new Date(fromDate).getTime() + 30 * DAY_MS).toISOString().slice(0, 10);
  const days = getAvailableDates(activity, fromDate, horizonEnd, bookings);
  const out = [];
  for (const day of days) {
    for (const slot of day.slots) {
      if (!slot.soldOut) {
        out.push({ date: day.date, ...slot });
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

// ---- Helpers ----
function normalizeSchedule(s = {}) {
  return {
    weekly:          (Array.isArray(s.weekly) && s.weekly.length === 7) ? s.weekly : [1,1,1,1,1,1,1],
    timeSlots:       Array.isArray(s.timeSlots) ? s.timeSlots.map(normalizeSlot) : [defaultSlot()],
    blockedDates:    Array.isArray(s.blockedDates) ? s.blockedDates : [],
    openDates:       Array.isArray(s.openDates) ? s.openDates : [],
    minAdvanceHours: typeof s.minAdvanceHours === 'number' ? s.minAdvanceHours : 12,
    maxAdvanceDays:  typeof s.maxAdvanceDays === 'number' ? s.maxAdvanceDays : 120,
    seasonStart:     s.seasonStart || null,
    seasonEnd:       s.seasonEnd || null
  };
}
function normalizeSlot(s, i = 0) {
  return {
    id:          s.id || `ts-${i}`,
    time:        s.time || '10:00',
    durationMin: s.durationMin || 180,
    capacity:    typeof s.capacity === 'number' ? s.capacity : 8,
    label:       s.label || ''
  };
}
function defaultSlot() {
  return { id: 'ts-default', time: '10:00', durationMin: 180, capacity: 8, label: 'Default' };
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function sumBooked(bookings, dateISO, slotId) {
  let total = 0;
  for (const b of (bookings || [])) {
    if (b.date !== dateISO) continue;
    if (slotId && b.slotId && b.slotId !== slotId) continue;
    if (slotId && !b.slotId && b.time && !slotMatchesTime(slotId, b.time)) continue;
    if (b.status === 'cancelled') continue;
    total += Number(b.people) || 0;
  }
  return total;
}
function slotMatchesTime(slotIdOrTime, time) {
  return String(slotIdOrTime).startsWith('ts-')
    ? false   // can't match without lookup
    : slotIdOrTime === time;
}

module.exports = {
  getAvailableDates,
  isSlotAvailable,
  nextAvailableSlots,
  normalizeSchedule
};
