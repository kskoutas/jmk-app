/**
 * JMK · Auto Pre-Payment (Deposit)
 * ----------------------------------
 * Όταν συμφωνηθεί τιμή στο chat, υπολογίζεται και χρεώνεται ΑΥΤΟΜΑΤΑ
 * το 20% deposit (= JMK 10% + Hotel 10% commission).
 *
 * Στόχος founder: «οτι δεν περναει απο το χερι σου» — μηδενική manual
 * παρέμβαση. Το deposit κλειδώνει το booking και διασφαλίζει ότι η
 * προμήθεια δεν μπορεί να παρακαμφθεί ακόμα κι αν ο partner προσπαθήσει
 * να μετακινήσει την τελική πληρωμή εκτός app.
 *
 * Flow:
 *   chat        → user/partner συμφωνούν στην τιμή
 *   /agree      → δημιουργία deposit intent (20%)
 *   confirmPay  → deposit καταβάλλεται → status='deposit_paid'
 *   completion  → υπόλοιπο 80% πληρώνεται (στον partner απευθείας ή μέσω app)
 *   /complete   → status='completed'
 *   /review     → status='reviewed'
 *
 * Αν deposit δεν πληρωθεί εντός 24h → auto-cancel.
 */
'use strict';

const DEFAULTS = {
  depositPct: 20.0,          // 20% του agreed amount
  depositExpiryHours: 24,    // αν δεν πληρωθεί σε 24h → auto-cancel
  refundPolicy: {
    flexible:  { hoursBeforeFullRefund: 24,  partialRefundPct: 50 },
    moderate:  { hoursBeforeFullRefund: 48,  partialRefundPct: 50 },
    strict:    { hoursBeforeFullRefund: 168, partialRefundPct: 0 }
  }
};

/**
 * Υπολογίζει το deposit για συμφωνημένη τιμή.
 * @param {number} agreedAmount  — το συνολικό ποσό που συμφωνήθηκε
 * @param {object} settings
 * @returns {{ depositAmount, depositPct, totalAgreed }}
 */
function calcDeposit(agreedAmount, settings = {}) {
  const pct = settings.depositPct ?? DEFAULTS.depositPct;
  const total = Number(agreedAmount) || 0;
  const dep = round2(total * (pct / 100));
  return { depositAmount: dep, depositPct: pct, totalAgreed: total };
}

/**
 * Υπολογίζει το refund σε περίπτωση cancel.
 * @param {object} booking
 * @param {object} activity — για cancellationPolicy
 * @param {Date}   now
 */
function calcRefund(booking, activity, now = new Date()) {
  const policy = activity?.cancellationPolicy || 'moderate';
  const rules = DEFAULTS.refundPolicy[policy] || DEFAULTS.refundPolicy.moderate;

  const eventTime = parseEventTime(booking.date, booking.time);
  const hoursAhead = (eventTime - now) / 3600000;

  const depositPaid = booking.deposit?.status === 'paid' ? (booking.deposit.amount || 0) : 0;
  const fullPaid = booking.status === 'paid' ? booking.totalAmount : 0;
  const totalPaid = Math.max(depositPaid, fullPaid);

  if (totalPaid === 0) {
    return { refundAmount: 0, refundPct: 0, reason: 'nothing_paid' };
  }

  if (hoursAhead >= rules.hoursBeforeFullRefund) {
    return { refundAmount: round2(totalPaid), refundPct: 100, reason: 'full_refund_window' };
  }

  if (hoursAhead < 0) {
    return { refundAmount: 0, refundPct: 0, reason: 'past_event' };
  }

  const partialAmount = round2(totalPaid * (rules.partialRefundPct / 100));
  return {
    refundAmount: partialAmount,
    refundPct: rules.partialRefundPct,
    reason: 'partial_refund'
  };
}

/**
 * Έλεγχος αν ένα deposit έχει λήξει (>24h χωρίς πληρωμή).
 */
function isDepositExpired(booking, now = Date.now()) {
  if (!booking.deposit) return false;
  if (booking.deposit.status !== 'pending') return false;
  const created = new Date(booking.deposit.createdAt || booking.createdAt).getTime();
  return (now - created) > DEFAULTS.depositExpiryHours * 3600000;
}

function parseEventTime(dateStr, timeStr = '10:00') {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1, hh || 10, mm || 0);
}

function round2(x) { return Math.round(x * 100) / 100; }

module.exports = { calcDeposit, calcRefund, isDepositExpired, DEFAULTS };
