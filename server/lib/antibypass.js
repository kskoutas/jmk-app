/**
 * JMK · Anti-Bypass Detection v2
 * --------------------------------
 * Έξυπνη ανίχνευση μηνυμάτων όπου guest/partner προσπαθεί
 * να παρακάμψει την εφαρμογή για να αποφύγει την προμήθεια.
 *
 * Αναγνωρίζει:
 *   1. Direct contact info  (phone, email, IBAN, social)
 *   2. Solicitation phrases ("πάρε με τηλέφωνο", "out of app")
 *   3. Disguised numbers    ("έξι εννιά δύο" → 6912...)
 *   4. Payment circumvention ("πληρωμή σε μένα", "cash", "iban...")
 *   5. Off-platform meetings ("εκτός εφαρμογής")
 *   6. Risk score 0-100 ανά μήνυμα
 *   7. Cumulative risk ανά partner για auto-warn / auto-suspend
 *
 * Εξαγωγή: detect(text, lang?) → { flagged, kind, redactedText, riskScore, signals[] }
 */
'use strict';

// ============================================================
// Regex patterns
// ============================================================

// Phone — Greek/international (7-15 digits, optional +country)
const PHONE_RE  = /(\+?\d[\d\s\-().]{6,}\d)/;
// Email
const EMAIL_RE  = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// IBAN (Greek = GR + 25 digits, but match general)
const IBAN_RE   = /\b[A-Z]{2}\d{2}[A-Z0-9]{1,30}\b/i;
// Credit card (broad)
const CARD_RE   = /\b(?:\d[ \-]?){13,19}\b/;
// Social handles & messaging apps
const SOCIAL_RE = /\b(whats[\s-]?app|wa\.me|viber|telegram|t\.me|signal|messenger|fb\.me|insta(?:gram)?|snapchat|tiktok|@[a-z0-9_.]{3,})\b/i;
// URLs (excl. our domain)
const URL_RE    = /\b(?!.*jmk\.app|.*localhost)(?:https?:\/\/|www\.)[^\s]+/i;

// ============================================================
// Phrase patterns (Greek + English) — "intent" detection
// ============================================================
// Σημείωση: το \b (word boundary) δεν δουλεύει με ελληνικούς χαρακτήρες.
// Χρησιμοποιούμε (?:^|[\s.,!?;:·]) για start-of-token boundary.
const B = '(?:^|[\\s.,!?;:·"\'(])';   // boundary start (Greek-safe)

const SOLICITATION_PATTERNS = [
  // Greek — call me / contact directly
  { re: new RegExp(`${B}(πάρε|παρε)\\s+(με|μας)\\s+(τηλέφωνο|τηλέφ|τηλ\\.?|κινητό)`, 'i'),       kind: 'solicit_call', score: 35, why: 'Έκκληση για κλήση εκτός app' },
  { re: new RegExp(`${B}(τηλεφών(η|ι)σ(ε|έ))\\s+(μου|μας)`, 'i'),                                kind: 'solicit_call', score: 35, why: 'Έκκληση για κλήση' },
  { re: new RegExp(`${B}(κάλεσέ?|κάλεσε)\\s+(με|μας|μου)`, 'i'),                                 kind: 'solicit_call', score: 30, why: 'Έκκληση για κλήση' },
  { re: new RegExp(`${B}(στείλε\\s+(μου|μας)\\s+sms|κάνε\\s+ring)`, 'i'),                        kind: 'solicit_call', score: 30, why: 'SMS εκτός app' },

  // Greek — message off platform
  { re: new RegExp(`(εκτός|εξω|έξω)\\s+(εφαρμογ(ή|ής|ης|ή)|app|πλατφόρμ)`, 'i'),                kind: 'offplatform',  score: 50, why: 'Πρόταση χρήσης εκτός εφαρμογής' },
  { re: new RegExp(`(μην?|μη)\\s+(βάλ(ει|εις|εται)|γρά(ψ|φ)ε(ι|ις|ται))\\s+(στην?|στο)\\s+εφαρμογ`, 'i'), kind: 'offplatform', score: 60, why: 'Παρότρυνση να μη χρησιμοποιηθεί η εφαρμογή' },
  { re: new RegExp(`(direct(ly)?|απ\\.?ευθείας|απευθείας)\\s+(μαζί|με|σε)\\s+(εμένα|εμενα|μένα|μου|με)`, 'i'), kind: 'offplatform', score: 40, why: 'Direct επικοινωνία' },

  // Greek — payment circumvention
  { re: new RegExp(`(μετρητ(ά|α)|cash|μ(ε|έ)\\s+τα\\s+χέρια)`, 'i'),                             kind: 'cash_payment', score: 55, why: 'Πρόταση πληρωμής σε μετρητά' },
  { re: new RegExp(`(πληρωμ(ή|η|ώνεις|ωνεις|ώσεις|ωσεις))\\s+(στο\\s+χέρι|σε\\s+εμένα|σε\\s+μένα|σε\\s+εμενα|σε\\s+μενα|κατευθείαν|απευθείας)`, 'i'), kind: 'cash_payment', score: 65, why: 'Πληρωμή εκτός app' },
  { re: new RegExp(`(πληρώνεις|πληρωνεις)\\s+(απευθείας|κατευθείαν|σε\\s+(εμένα|εμενα|μένα|μενα))`, 'i'), kind: 'cash_payment', score: 65, why: 'Πληρωμή απευθείας σε partner' },
  { re: new RegExp(`(IBAN|τραπεζικ(ή|η|ός|ος)\\s+λογαριασμ)`, 'i'),                              kind: 'bank_share',   score: 45, why: 'Κοινοποίηση IBAN/τραπεζ. λογ.' },
  { re: new RegExp(`(κατάθεσ(η|ε)|deposit\\s+to\\s+my)`, 'i'),                                   kind: 'bank_share',   score: 45, why: 'Πρόταση κατάθεσης σε λογαριασμό' },
  { re: new RegExp(`(revolut|paypal|venmo|wise|bitcoin|btc)\\s+(μου|μας|me|to\\s+me)`, 'i'),     kind: 'cash_payment', score: 50, why: 'P2P payment εκτός app' },

  // Greek — meet in person to settle
  { re: new RegExp(`(βρισκ(ό|ο)μαστε|meet)\\s+και\\s+(τα\\s+λέμε|talk)`, 'i'),                   kind: 'offplatform',  score: 25, why: 'Πρόταση συνάντησης για διευθέτηση' },

  // English versions (standard \b works fine for ASCII)
  { re: /\b(call|whatsapp|text|sms)\s+me\b/i,                                                    kind: 'solicit_call', score: 35, why: 'Solicits direct contact' },
  { re: /\b(off|outside)\s+(the\s+)?(app|platform)/i,                                            kind: 'offplatform',  score: 50, why: 'Off-platform suggestion' },
  { re: /\bdon'?t\s+book\s+(through|via|on)\s+(the\s+)?(app|platform)/i,                         kind: 'offplatform',  score: 65, why: 'Discourages app booking' },
  { re: /\b(pay\s+me\s+(directly|in\s+cash|cash)|cash\s+only)/i,                                 kind: 'cash_payment', score: 55, why: 'Direct/cash payment' }
];

// ============================================================
// Disguised numbers (Greek + English number words)
// ============================================================
const NUMBER_WORDS_EL = {
  'μηδέν':0,'μηδεν':0,'ένα':1,'ενα':1,'μία':1,'μια':1,'δύο':2,'δυο':2,'τρία':3,'τρια':3,
  'τέσσερα':4,'τεσσερα':4,'πέντε':5,'πεντε':5,'έξι':6,'εξι':6,'επτά':7,'επτα':7,'εφτά':7,'εφτα':7,
  'οκτώ':8,'οκτω':8,'οχτώ':8,'οχτω':8,'εννέα':9,'εννεα':9,'εννιά':9,'εννια':9
};
const NUMBER_WORDS_EN = {
  'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9
};

function detectDisguisedNumbers(text) {
  // Token-based scan: count consecutive number-words
  const tokens = text.toLowerCase().split(/[\s,.\-_]+/);
  let run = 0;
  let maxRun = 0;
  let runStart = -1;
  let bestStart = -1, bestEnd = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/[^\p{L}]/gu, '');
    if (NUMBER_WORDS_EL[t] !== undefined || NUMBER_WORDS_EN[t] !== undefined) {
      if (run === 0) runStart = i;
      run++;
      if (run > maxRun) { maxRun = run; bestStart = runStart; bestEnd = i; }
    } else {
      run = 0;
    }
  }
  // 6+ συνεχόμενοι αριθμητικοί όροι = πιθανό κρυμμένο τηλέφωνο
  if (maxRun >= 6) {
    return {
      flagged: true,
      kind: 'disguised_number',
      score: 50 + Math.min(20, maxRun * 2),
      why: `${maxRun} συνεχόμενα αριθμητικά λεκτικά (πιθανό κρυμμένο τηλέφωνο)`,
      tokens: tokens.slice(bestStart, bestEnd + 1)
    };
  }
  return null;
}

// ============================================================
// Main detection
// ============================================================
function detect(text, opts = {}) {
  if (!text || typeof text !== 'string') {
    return { flagged: false, kind: null, redactedText: text, riskScore: 0, signals: [] };
  }

  const signals = [];
  let redacted = text;
  let riskScore = 0;
  let primaryKind = null;

  // Direct PII
  if (PHONE_RE.test(text)) {
    signals.push({ kind: 'phone', score: 60, why: 'Τηλέφωνο σε μήνυμα' });
    redacted = redacted.replace(PHONE_RE, '📵 [αριθμός κρυμμένος]');
    riskScore += 60; primaryKind = primaryKind || 'phone';
  }
  if (EMAIL_RE.test(text)) {
    signals.push({ kind: 'email', score: 55, why: 'Email σε μήνυμα' });
    redacted = redacted.replace(EMAIL_RE, '📧 [email κρυμμένο]');
    riskScore += 55; primaryKind = primaryKind || 'email';
  }
  if (IBAN_RE.test(text)) {
    signals.push({ kind: 'iban', score: 70, why: 'IBAN σε μήνυμα' });
    redacted = redacted.replace(IBAN_RE, '🏦 [IBAN κρυμμένο]');
    riskScore += 70; primaryKind = primaryKind || 'iban';
  }
  if (CARD_RE.test(text) && !PHONE_RE.test(text)) {
    // CARD_RE μπορεί να συμπίπτει με phone — αν είδαμε ήδη phone, παραλείπω
    signals.push({ kind: 'card', score: 75, why: 'Πιθανός αριθμός κάρτας' });
    redacted = redacted.replace(CARD_RE, '💳 [αριθμός κρυμμένος]');
    riskScore += 75; primaryKind = primaryKind || 'card';
  }
  if (SOCIAL_RE.test(text)) {
    signals.push({ kind: 'social', score: 50, why: 'Social handle / messaging app' });
    redacted = redacted.replace(SOCIAL_RE, '🚫 [social κρυμμένο]');
    riskScore += 50; primaryKind = primaryKind || 'social';
  }
  if (URL_RE.test(text)) {
    signals.push({ kind: 'external_url', score: 30, why: 'Εξωτερικό URL' });
    redacted = redacted.replace(URL_RE, '🔗 [σύνδεσμος κρυμμένος]');
    riskScore += 30; primaryKind = primaryKind || 'external_url';
  }

  // Phrase-based intent detection
  for (const p of SOLICITATION_PATTERNS) {
    if (p.re.test(text)) {
      signals.push({ kind: p.kind, score: p.score, why: p.why, matched: text.match(p.re)[0] });
      riskScore += p.score;
      primaryKind = primaryKind || p.kind;
    }
  }

  // Disguised numbers
  const dn = detectDisguisedNumbers(text);
  if (dn) {
    signals.push({ kind: dn.kind, score: dn.score, why: dn.why, tokens: dn.tokens });
    riskScore += dn.score;
    primaryKind = primaryKind || dn.kind;
    // Replace με placeholder
    const re = new RegExp(`(${dn.tokens.map(escapeRe).join('[\\s,.\\-_]+')})`, 'i');
    redacted = redacted.replace(re, '🔢 [αριθμητικά λεκτικά κρυμμένα]');
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);
  const flagged = signals.length > 0;

  return {
    flagged,
    kind: primaryKind,
    redactedText: redacted,
    riskScore,
    signals,
    severity: riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : riskScore > 0 ? 'low' : 'none'
  };
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { detect, SOLICITATION_PATTERNS };
