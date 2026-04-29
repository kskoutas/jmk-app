/**
 * JMK · Moderation & Risk Scoring
 * --------------------------------
 * Cumulative risk tracking ανά partner. Auto-warn / auto-suspend
 * όταν ξεπεραστούν thresholds.
 *
 * Στρατηγική:
 *   - Κάθε flagged μήνυμα → προστίθεται στο partner.riskHistory
 *   - Σκορ 7-ημέρου παράθυρου > 150 → auto-warn
 *   - Σκορ 7-ημέρου > 300 → auto-suspend (status='paused')
 *   - Άμεση suspension αν severity='high' και partner ήδη warned
 *
 * Επιπλέον: admin actions για manual warn/suspend/resolve.
 */
'use strict';

// ============================================================
// Risk thresholds
// ============================================================
const THRESHOLDS = {
  warnScore7d:    150,
  suspendScore7d: 300,
  warnCount7d:    3,
  suspendCount7d: 5,
  windowMs:       7 * 24 * 3600000
};

/**
 * Επιστρέφει cumulative risk για έναν partner τις τελευταίες 7 μέρες.
 * @param {array} flaggedMessages — όλα τα flaggedMessages records
 * @param {string} partnerId
 * @param {number} now — timestamp (default: τώρα)
 */
function partnerRisk7d(flaggedMessages, partnerId, now = Date.now()) {
  const cutoff = now - THRESHOLDS.windowMs;
  const items = flaggedMessages.filter(fm =>
    fm.fromRole === 'partner' &&
    (fm.from === partnerId || fm.partnerId === partnerId) &&
    new Date(fm.createdAt).getTime() >= cutoff &&
    !fm.dismissed
  );
  const totalScore = items.reduce((s, m) => s + (Number(m.riskScore) || 0), 0);
  return {
    partnerId,
    count: items.length,
    totalScore,
    items: items.map(i => ({ id: i.id, score: i.riskScore, kind: i.kind, createdAt: i.createdAt }))
  };
}

/**
 * Αποφασίζει τι auto-action πρέπει να γίνει για έναν partner.
 * Επιστρέφει: 'none' | 'warn' | 'suspend'
 */
function recommendAction(risk7d, partnerStatus) {
  // Already suspended → no further action
  if (partnerStatus === 'paused' || partnerStatus === 'rejected') return 'none';

  // High threshold → suspend
  if (risk7d.totalScore >= THRESHOLDS.suspendScore7d || risk7d.count >= THRESHOLDS.suspendCount7d) {
    return 'suspend';
  }
  // Lower threshold → warn (αν δεν έχει ήδη warning)
  if (risk7d.totalScore >= THRESHOLDS.warnScore7d || risk7d.count >= THRESHOLDS.warnCount7d) {
    return 'warn';
  }
  return 'none';
}

/**
 * Εφαρμόζει warning σε partner.
 * @param {object} ctx — { db, genId, bumpVersion }
 */
function warnPartner(ctx, partnerId, reason) {
  const partner = getOne(ctx.db, 'partners', partnerId);
  if (!partner) return null;
  partner.warnings = (partner.warnings || 0) + 1;
  partner.lastWarnedAt = new Date().toISOString();
  partner.lastWarnReason = reason;
  saveOne(ctx, 'partners', partner);

  // Notification
  const note = {
    id: ctx.genId('n'),
    toRole: 'partner',
    toId: partnerId,
    type: 'warning',
    title: '⚠ Προειδοποίηση από JMK',
    body: reason || 'Παραβίαση όρων χρήσης (anti-bypass).',
    read: false,
    createdAt: new Date().toISOString(),
    actionable: false
  };
  saveOne(ctx, 'notifications', note);
  return { partner, notification: note };
}

/**
 * Suspends partner (status → 'paused'), και βάζει pause σε όλα τα activities τους.
 */
function suspendPartner(ctx, partnerId, reason) {
  const partner = getOne(ctx.db, 'partners', partnerId);
  if (!partner) return null;
  partner.status = 'paused';
  partner.suspendedAt = new Date().toISOString();
  partner.suspendReason = reason;
  saveOne(ctx, 'partners', partner);

  // Pause all activities
  const allActivitiesRows = ctx.db.prepare('SELECT data FROM collections WHERE collection=?').all('activities');
  for (const r of allActivitiesRows) {
    const a = JSON.parse(r.data);
    if (a.partnerId === partnerId && a.status === 'active') {
      a.status = 'paused';
      a.pausedReason = 'partner_suspended';
      saveOne(ctx, 'activities', a);
    }
  }

  // Notification
  const note = {
    id: ctx.genId('n'),
    toRole: 'partner',
    toId: partnerId,
    type: 'suspended',
    title: '🚫 Ο λογαριασμός σου ανεστάλη',
    body: reason || 'Επανειλημμένη παραβίαση anti-bypass.',
    read: false,
    createdAt: new Date().toISOString(),
    actionable: true
  };
  saveOne(ctx, 'notifications', note);
  return { partner, notification: note };
}

/**
 * Reactivate partner (admin action).
 */
function reactivatePartner(ctx, partnerId, reason) {
  const partner = getOne(ctx.db, 'partners', partnerId);
  if (!partner) return null;
  partner.status = 'approved';
  partner.reactivatedAt = new Date().toISOString();
  partner.reactivatedReason = reason;
  saveOne(ctx, 'partners', partner);
  return partner;
}

/**
 * Auto-process ένα flagged μήνυμα: αποφασίζει αν πρέπει να γίνει warn/suspend.
 * Επιστρέφει what was done.
 */
function processFlaggedMessage(ctx, flaggedMessage) {
  if (flaggedMessage.fromRole !== 'partner') return { action: 'none', reason: 'not_partner' };
  const partnerId = flaggedMessage.from || flaggedMessage.partnerId;
  if (!partnerId) return { action: 'none', reason: 'no_partner_id' };

  // Get all flagged για αυτόν τον partner
  const allFlagged = ctx.db.prepare('SELECT data FROM collections WHERE collection=?').all('flaggedMessages').map(r => JSON.parse(r.data));
  const risk = partnerRisk7d(allFlagged, partnerId);

  const partner = getOne(ctx.db, 'partners', partnerId);
  if (!partner) return { action: 'none', reason: 'partner_not_found' };

  const action = recommendAction(risk, partner.status);
  if (action === 'warn') {
    warnPartner(ctx, partnerId, `Auto-warn: ${risk.count} ύποπτα μηνύματα τις τελευταίες 7 μέρες (score ${risk.totalScore})`);
    return { action: 'warn', risk };
  }
  if (action === 'suspend') {
    suspendPartner(ctx, partnerId, `Auto-suspend: ${risk.count} ύποπτα μηνύματα τις τελευταίες 7 μέρες (score ${risk.totalScore})`);
    return { action: 'suspend', risk };
  }
  return { action: 'none', risk };
}

// ============================================================
// Helpers
// ============================================================
function getOne(db, collection, id) {
  const r = db.prepare('SELECT data FROM collections WHERE collection=? AND id=?').get(collection, id);
  return r ? JSON.parse(r.data) : null;
}
function saveOne(ctx, collection, obj) {
  const now = Date.now();
  ctx.db.prepare('INSERT OR REPLACE INTO collections(collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(collection, obj.id, JSON.stringify(obj), now, now);
  if (ctx.bumpVersion) ctx.bumpVersion();
}

module.exports = {
  THRESHOLDS,
  partnerRisk7d,
  recommendAction,
  warnPartner,
  suspendPartner,
  reactivatePartner,
  processFlaggedMessage
};
