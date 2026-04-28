/**
 * JMK · Email Notifications
 * -------------------------
 * Wrapper με 3 modes:
 *   1. 'log'    (default σε dev) — τυπώνει στο console
 *   2. 'resend' — αν έχει RESEND_API_KEY env, στέλνει πραγματικά email
 *   3. 'sendgrid' — αν έχει SENDGRID_API_KEY env
 *
 * Templates ενσωματωμένα (απλό HTML — μπορείς να αντικαταστήσεις με κανονικό template engine).
 */
'use strict';

const MODE = process.env.EMAIL_MODE
  || (process.env.RESEND_API_KEY ? 'resend'
    : process.env.SENDGRID_API_KEY ? 'sendgrid'
    : 'log');

const FROM = process.env.EMAIL_FROM || 'JMK <noreply@jmk.app>';

async function send({ to, subject, html, text }) {
  if (!to || !subject) throw new Error('to and subject required');

  if (MODE === 'log') {
    console.log('\n📧 ─────── EMAIL (log mode) ───────');
    console.log('To:     ', to);
    console.log('Subject:', subject);
    console.log('Text:   ', text || stripHtml(html || ''));
    console.log('───────────────────────────────────\n');
    return { ok: true, mode: 'log' };
  }

  if (MODE === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM, to, subject, html, text })
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    return { ok: true, mode: 'resend', data: await res.json() };
  }

  if (MODE === 'sendgrid') {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: parseEmail(FROM).email, name: parseEmail(FROM).name },
        subject,
        content: [
          { type: 'text/plain', value: text || stripHtml(html || '') },
          ...(html ? [{ type: 'text/html', value: html }] : [])
        ]
      })
    });
    if (!res.ok) throw new Error(`sendgrid ${res.status}: ${await res.text()}`);
    return { ok: true, mode: 'sendgrid' };
  }

  throw new Error(`unknown EMAIL_MODE: ${MODE}`);
}

// ---- Template helpers ----
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function parseEmail(s) {
  const m = String(s).match(/^(.+?)\s*<(.+?)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: s };
}

const wrap = (title, body) => `<!doctype html>
<html lang="el"><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#f5f5f7;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <div style="font-size:24px;font-weight:700;color:#0F172A;margin-bottom:16px">JMK · ${title}</div>
    ${body}
    <hr style="margin:32px 0;border:0;border-top:1px solid #e5e7eb">
    <div style="font-size:12px;color:#6b7280">JMK · Vacation Navigator · jmk.app</div>
  </div>
</body></html>`;

// ---- Pre-built notifications ----
const templates = {
  bookingRequested: (booking, activity, partner) => ({
    to: partner.email,
    subject: `Νέο αίτημα κράτησης για "${activity.title}"`,
    html: wrap('Νέο αίτημα κράτησης', `
      <p>Γεια σου ${partner.name},</p>
      <p>Έχεις νέο αίτημα για <b>${activity.title}</b> στις <b>${booking.date}</b> ώρα <b>${booking.time}</b>.</p>
      <p>Άτομα: ${booking.people} · Ποσό: ${booking.totalAmount}€</p>
      <p>Μπες στην εφαρμογή για να συνομιλήσεις με τον guest.</p>
    `)
  }),

  bookingConfirmed: (booking, activity, guest) => ({
    to: guest.email,
    subject: `✅ Επιβεβαίωση κράτησης: ${activity.title}`,
    html: wrap('Η κράτηση σου επιβεβαιώθηκε', `
      <p>Γεια σου ${guest.name},</p>
      <p>Η κράτηση σου για <b>${activity.title}</b> στις <b>${booking.date} ${booking.time}</b> επιβεβαιώθηκε!</p>
      <p>Ποσό που χρεώθηκε: <b>${booking.totalAmount}€</b></p>
      <p>Καλή διασκέδαση!</p>
    `)
  }),

  paymentReceived: (booking, activity, partner) => ({
    to: partner.email,
    subject: `💰 Πληρωμή ${booking.partnerAmount}€ για "${activity.title}"`,
    html: wrap('Πληρωμή ελήφθη', `
      <p>Γεια σου ${partner.name},</p>
      <p>Ο guest πλήρωσε <b>${booking.totalAmount}€</b> για το <b>${activity.title}</b>.</p>
      <p>Θα λάβεις <b>${booking.partnerAmount}€</b> στο επόμενο payout.</p>
    `)
  }),

  reviewRequest: (booking, activity, guest) => ({
    to: guest.email,
    subject: `Πώς ήταν το ${activity.title};`,
    html: wrap('Άσε ένα review', `
      <p>Γεια σου ${guest.name},</p>
      <p>Ελπίζουμε να απόλαυσες το <b>${activity.title}</b>!</p>
      <p>Παρακαλούμε άσε μια κριτική για να βοηθήσεις άλλους ταξιδιώτες.</p>
    `)
  })
};

async function sendTemplate(name, ...args) {
  const tpl = templates[name];
  if (!tpl) throw new Error(`unknown template: ${name}`);
  const msg = tpl(...args);
  return send(msg);
}

module.exports = { send, sendTemplate, templates, MODE };
