/**
 * JMK · Payment Processing
 * ------------------------
 * Δουλεύει σε 2 modes:
 *   1. 'stub' (default σε dev) — fake payment intents, marks booking as paid αμέσως
 *   2. 'stripe' — αν STRIPE_SECRET_KEY env, χρησιμοποιεί πραγματικό Stripe API
 *
 * Σε production: ο guest βλέπει Stripe Checkout, πληρώνει με κάρτα/Apple Pay/Google Pay,
 * ο webhook επιβεβαιώνει την πληρωμή, marks booking ως 'paid', τρέχει commission split.
 */
'use strict';

const MODE = (process.env.STRIPE_SECRET_KEY ? 'stripe' : 'stub');

let stripe = null;
if (MODE === 'stripe') {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn('[payments] STRIPE_SECRET_KEY set but `stripe` library missing. Run `npm install stripe`. Falling back to stub.');
  }
}

/**
 * Δημιουργεί payment intent.
 * @returns { id, clientSecret, amount, currency, status }
 */
async function createIntent({ booking, currency = 'eur' }) {
  const amountCents = Math.round(Number(booking.totalAmount) * 100);

  if (MODE === 'stub' || !stripe) {
    return {
      id: 'pi_stub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      clientSecret: 'cs_stub_' + Math.random().toString(36).slice(2, 12),
      amount: amountCents,
      currency,
      status: 'requires_payment_method',
      mode: 'stub',
      bookingId: booking.id
    };
  }

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    description: `JMK booking ${booking.id}`,
    metadata: { bookingId: booking.id, hotelId: booking.hotelId, partnerId: booking.partnerId }
  });
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
    mode: 'stripe'
  };
}

/**
 * Επιβεβαιώνει stub payment (σε production γίνεται αυτόματα από Stripe webhook).
 */
async function confirmStub(intentId) {
  if (!intentId.startsWith('pi_stub_')) throw new Error('not a stub intent');
  return { id: intentId, status: 'succeeded', mode: 'stub' };
}

/**
 * Επαληθεύει Stripe webhook signature.
 */
function verifyWebhook(rawBody, signature, secret) {
  if (!stripe) throw new Error('stripe not configured');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = { createIntent, confirmStub, verifyWebhook, MODE };
