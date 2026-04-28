/**
 * JMK · Commission Calculator
 * ---------------------------
 * Single source of truth για το commission split.
 *
 * Default split (επιβεβαιωμένο από founder 2026-04-28):
 *   • 10%  → JMK (η εφαρμογή)
 *   • 10%  → Hotel (το ξενοδοχείο που έφερε τον guest μέσω QR)
 *   • 80%  → Partner (ο πάροχος της δραστηριότητας)
 *
 * Hotel-specific override μέσω hotel.commissionPct (π.χ. premium hotels 12%).
 * Σε αυτή την περίπτωση, η JMK πάντα παίρνει 10%, και ο partner cut μειώνεται.
 *
 * Stripe fee: 1.4% + 0.25 EUR (default Greek rates), αφαιρείται από JMK cut.
 */
'use strict';

const DEFAULTS = {
  jmkPct:        10.0,   // πάντα 10%
  hotelPct:      10.0,   // override-able per hotel
  stripePct:     1.4,    // % του totalAmount
  stripeFlatEur: 0.25,   // σταθερό fee/transaction
  partnerMinPct: 70.0    // safety floor — ποτέ partner < 70%
};

/**
 * Υπολογίζει το split για ένα booking.
 * @param {number} totalAmount - Συνολικό ποσό σε EUR (π.χ. price × people)
 * @param {object} opts
 *   - hotelCommissionPct: αν δοθεί, override το default 10% του hotel
 *   - settings: το global settings object (μπορεί να αλλάξει defaults)
 * @returns {{partnerAmount, hotelCommission, jmkCommission, stripeFee, total}}
 */
function calc(totalAmount, opts = {}) {
  const total = Number(totalAmount) || 0;
  if (total <= 0) {
    return { partnerAmount: 0, hotelCommission: 0, jmkCommission: 0, stripeFee: 0, total: 0 };
  }

  const settings = opts.settings || {};
  const jmkPct      = settings.jmkCommissionPct       ?? DEFAULTS.jmkPct;
  const hotelPctDef = settings.defaultHotelCommissionPct ?? DEFAULTS.hotelPct;
  const stripePct   = settings.stripeFeePct           ?? DEFAULTS.stripePct;
  const stripeFlat  = settings.stripeFeeFlat          ?? DEFAULTS.stripeFlatEur;

  const hotelPct = (typeof opts.hotelCommissionPct === 'number')
    ? opts.hotelCommissionPct
    : hotelPctDef;

  const stripeFee       = round2(total * (stripePct / 100) + stripeFlat);
  const jmkCommission   = round2(total * (jmkPct / 100));
  const hotelCommission = round2(total * (hotelPct / 100));
  let   partnerAmount   = round2(total - jmkCommission - hotelCommission - stripeFee);

  // Safety floor — αν για κάποιο λόγο το partner cut έπεσε κάτω από το minimum,
  // ρίξε το hotel cut για να καλυφθεί. (Σπάνιο edge case με μεγάλα stripe fees σε μικρά bookings.)
  const minPartner = total * (DEFAULTS.partnerMinPct / 100);
  if (partnerAmount < minPartner) {
    const deficit = minPartner - partnerAmount;
    const adjusted = Math.max(0, hotelCommission - deficit);
    partnerAmount = round2(total - jmkCommission - adjusted - stripeFee);
    return {
      partnerAmount,
      hotelCommission: round2(adjusted),
      jmkCommission,
      stripeFee,
      total
    };
  }

  return { partnerAmount, hotelCommission, jmkCommission, stripeFee, total };
}

function round2(x) { return Math.round(x * 100) / 100; }

/**
 * Booking state machine. Επιτρεπόμενα transitions.
 *   pending  → chat            (guest κάνει request, partner δεν απάντησε ακόμα)
 *   chat     → agreed          (συμφώνησαν στις λεπτομέρειες)
 *   agreed   → paid            (guest πλήρωσε με Stripe)
 *   paid     → completed       (η δραστηριότητα ολοκληρώθηκε)
 *   completed→ reviewed        (ο guest άφησε review)
 *   any      → cancelled       (από οποιοδήποτε state, με reason)
 *   any      → disputed        (admin intervention)
 */
const STATES = ['pending', 'chat', 'agreed', 'paid', 'completed', 'reviewed', 'cancelled', 'disputed'];

const TRANSITIONS = {
  pending:   ['chat', 'cancelled'],
  chat:      ['agreed', 'cancelled'],
  agreed:    ['paid', 'cancelled'],
  paid:      ['completed', 'cancelled', 'disputed'],
  completed: ['reviewed', 'disputed'],
  reviewed:  ['disputed'],
  cancelled: [],
  disputed:  ['paid', 'completed', 'cancelled'] // admin can resolve
};

// Backwards-compat: old seed data uses 'confirmed' as a synonym for 'paid'
const ALIASES = { confirmed: 'paid' };

function normalizeState(s) {
  if (!s) return 'pending';
  return ALIASES[s] || s;
}

function canTransition(from, to) {
  const f = normalizeState(from);
  const t = normalizeState(to);
  if (!STATES.includes(t)) return false;
  return (TRANSITIONS[f] || []).includes(t);
}

module.exports = { calc, canTransition, normalizeState, STATES, TRANSITIONS, DEFAULTS };
