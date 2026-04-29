/**
 * JMK · Restaurants & Delivery Orders
 * ------------------------------------
 * Διαφορετικό payment flow από τα activities:
 *
 *   Activity:   20% deposit upfront → 80% στο activity (όπως είναι)
 *   Restaurant: 20% deposit για κράτηση τραπεζιού (no-show protection)
 *               → 80% πληρωμή στο εστιατόριο όπως συνήθως
 *   Delivery:   100% prepayment μέσω app
 *               → app πληρώνει partner στο επόμενο payout cycle
 *               → guest δεν δίνει χρήματα στον driver
 *
 * Commission split παραμένει ίδιο (10% JMK + 10% hotel + 80% partner)
 * αλλά για delivery, η εφαρμογή κρατάει όλο το ποσό μέχρι το payout.
 */
'use strict';

const commission = require('./commission');

/**
 * Δημιουργεί order από cart items.
 * @param {object} ctx — { db, getOne, saveOne, genId, getSettings }
 * @param {object} input — { partnerId, hotelId, guestId, items: [{itemId, qty, notes?}], type: 'restaurant'|'delivery', deliveryAddress?, scheduledAt?, ... }
 */
function createOrder(ctx, input) {
  const { partnerId, hotelId, guestId, items, type } = input;
  if (!partnerId || !guestId || !Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('partnerId, guestId, items[] required'), { code: 400 });
  }
  if (!['restaurant', 'delivery'].includes(type)) {
    throw Object.assign(new Error('type must be restaurant|delivery'), { code: 400 });
  }

  const partner = ctx.getOne('partners', partnerId);
  if (!partner) throw Object.assign(new Error('partner not found'), { code: 404 });
  const hotel = hotelId ? ctx.getOne('hotels', hotelId) : null;

  // Resolve menu items + compute total
  const lines = [];
  let subtotal = 0;
  for (const cartItem of items) {
    const mi = ctx.getOne('menuItems', cartItem.itemId);
    if (!mi) throw Object.assign(new Error(`menu item not found: ${cartItem.itemId}`), { code: 404 });
    if (mi.partnerId !== partnerId) throw Object.assign(new Error(`item ${mi.id} not from this partner`), { code: 400 });
    if (mi.available === false) throw Object.assign(new Error(`item ${mi.id} not available`), { code: 409 });
    const qty = Math.max(1, Number(cartItem.qty) || 1);
    const lineTotal = round2(Number(mi.price) * qty);
    lines.push({
      itemId: mi.id,
      name: mi.name,
      price: mi.price,
      qty,
      notes: cartItem.notes || '',
      lineTotal
    });
    subtotal += lineTotal;
  }

  // Delivery fee (αν υπάρχει στο partner)
  const deliveryFee = type === 'delivery' ? (Number(partner.deliveryFee) || 0) : 0;
  const total = round2(subtotal + deliveryFee);

  // Commission split (ίδιο 10/10/80)
  const split = commission.calc(total, {
    hotelCommissionPct: hotel?.commissionPct,
    settings: ctx.getSettings ? ctx.getSettings() : {}
  });

  // Determine prepayment: delivery = 100%, restaurant = 20%
  const prepayPct = type === 'delivery' ? 100 : 20;
  const prepayAmount = round2(total * (prepayPct / 100));

  const order = {
    id: ctx.genId('o'),
    type,
    partnerId,
    hotelId: hotelId || null,
    guestId,
    items: lines,
    subtotal,
    deliveryFee,
    totalAmount:     split.total,
    partnerAmount:   split.partnerAmount,
    hotelCommission: split.hotelCommission,
    jmkCommission:   split.jmkCommission,
    stripeFee:       split.stripeFee,
    prepay: {
      pct:      prepayPct,
      amount:   prepayAmount,
      status:   'pending',
      intentId: null
    },
    deliveryAddress: input.deliveryAddress || null,
    scheduledAt:     input.scheduledAt || null,
    instructions:    input.instructions || '',
    status: 'placed',           // placed → confirmed → preparing → ready → delivered → reviewed
    createdAt: new Date().toISOString(),
    paidAt: null,
    deliveredAt: null
  };
  return order;
}

/**
 * State machine για orders.
 *   placed   → confirmed   (partner accepted)
 *   confirmed→ preparing
 *   preparing→ ready
 *   ready    → delivered
 *   delivered→ reviewed
 *   any      → cancelled
 */
const ORDER_STATES = ['placed','confirmed','preparing','ready','delivered','reviewed','cancelled'];
const ORDER_TRANSITIONS = {
  placed:    ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready:     ['delivered', 'cancelled'],
  delivered: ['reviewed'],
  reviewed:  [],
  cancelled: []
};

function canTransitionOrder(from, to) {
  return (ORDER_TRANSITIONS[from] || []).includes(to);
}

function round2(x) { return Math.round(x * 100) / 100; }

module.exports = { createOrder, canTransitionOrder, ORDER_STATES, ORDER_TRANSITIONS };
