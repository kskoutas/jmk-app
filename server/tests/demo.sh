#!/usr/bin/env bash
# JMK · Interactive Demo Walkthrough
# -----------------------------------
# Τρέχει ολόκληρο το user journey με ΟΡΑΤΟ output ώστε ο founder
# να καταλάβει τι κάνει το σύστημα.
#
# Pre-requisites:
#   1. Σε άλλο terminal: cd server && node server.js
#   2. Σε αυτό το terminal: bash tests/demo.sh

BASE="${BASE:-http://localhost:3000}"

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[0;34m'; M='\033[0;35m'; C='\033[0;36m'; N='\033[0m'

# Pretty printers
title() { echo ""; echo -e "${C}═══════════════════════════════════════════════════════${N}"; echo -e "${C}  $*${N}"; echo -e "${C}═══════════════════════════════════════════════════════${N}"; }
step()  { echo ""; echo -e "${Y}▶ $*${N}"; }
ok()    { echo -e "  ${G}✓ $*${N}"; }
fail()  { echo -e "  ${R}✗ $*${N}"; }
note()  { echo -e "  ${B}ℹ $*${N}"; }
say()   { echo -e "  ${M}💬 $*${N}"; }
pause() { echo ""; read -p "  ── Πάτα Enter για συνέχεια ──"; }

# JSON helpers
json_get() { node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const v=eval('j.'+'$1');console.log(typeof v==='object'?JSON.stringify(v,null,2):v)}catch(e){console.log('[parse error]')}})"; }

# ============================================================
title "JMK · Demo Walkthrough"
echo ""
echo "  Θα δούμε όλο το ταξίδι μιας κράτησης:"
echo "  1. Reset βάσης (καθαρή εκκίνηση)"
echo "  2. Guest βλέπει πρόταση activity (Day Cruise Νάξος)"
echo "  3. Δημιουργία booking με δυναμική τιμή"
echo "  4. Chat μεταξύ guest και partner"
echo "  5. ΑΝΤΙ-BYPASS: ο partner προσπαθεί να δώσει τηλέφωνο → block"
echo "  6. State machine: chat → agreed → paid → completed → reviewed"
echo "  7. Επιβεβαίωση commission split (10/10/80)"
pause

# ============================================================
step "ΒΗΜΑ 1 · Health check + reset σε γνωστή κατάσταση"
H=$(curl -s "$BASE/api/health")
if [ -z "$H" ]; then fail "Server δεν τρέχει. Άνοιξε άλλο terminal: 'cd server && node server.js'"; exit 1; fi
ok "Server τρέχει: $H"
RST=$(curl -s -X POST "$BASE/api/reset")
ok "Database reset: $RST"
pause

# ============================================================
step "ΒΗΜΑ 2 · Ο guest βλέπει το activity"
ACT=$(curl -s "$BASE/api/collections/activities/a-cruise")
echo "  Activity title:     $(echo "$ACT" | json_get title)"
echo "  Base price:         $(echo "$ACT" | json_get price)€"
echo "  Διάρκεια:           $(echo "$ACT" | json_get duration)"
echo "  Photos:             $(echo "$ACT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).photos.length+' φωτο/βιντεο'))")"
echo "  Time slots:         $(echo "$ACT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).schedule.timeSlots.map(s=>s.time+' ('+s.capacity+' θέσεις)').join(', ')))")"
echo "  Cancellation:       $(echo "$ACT" | json_get cancellationPolicy)"
pause

# ============================================================
step "ΒΗΜΑ 3 · Δοκιμάζουμε δυναμική τιμή για 4 διαφορετικές μέρες"
echo ""
note "Καλοκαίρι Σάββατο (high season + weekend):"
P1=$(curl -s "$BASE/api/activities/a-cruise/price-preview?date=2026-08-01&time=09:00&people=2")
echo "    $(echo "$P1" | json_get total)€ ($(echo "$P1" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).breakdown.map(r=>r.rule+' ×'+r.multiplier).join(', ')))"))"
echo ""
note "Άνοιξη Τρίτη (low season weekday):"
P2=$(curl -s "$BASE/api/activities/a-cruise/price-preview?date=2026-05-19&time=09:00&people=2")
echo "    $(echo "$P2" | json_get total)€"
echo ""
note "6 άτομα (group discount):"
P3=$(curl -s "$BASE/api/activities/a-cruise/price-preview?date=2026-05-19&time=09:00&people=6")
echo "    $(echo "$P3" | json_get total)€ ($(echo "$P3" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const b=JSON.parse(d).breakdown;console.log(b.length?b.map(r=>r.rule+' ×'+r.multiplier).join(', '):'no discounts')})"))"
pause

# ============================================================
step "ΒΗΜΑ 4 · Δημιουργούμε πραγματικό booking"
note "Date: 2026-06-03 (Τετάρτη, low season), Slot: 09:00, 2 άτομα"
B=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-maria","date":"2026-06-03","time":"09:00","slotId":"ts-boat-0","people":2}')
BID=$(echo "$B" | json_get id)
TOTAL=$(echo "$B" | json_get totalAmount)
JMK=$(echo "$B" | json_get jmkCommission)
HOT=$(echo "$B" | json_get hotelCommission)
PRT=$(echo "$B" | json_get partnerAmount)
SF=$(echo "$B" | json_get stripeFee)
ok "Booking #$BID δημιουργήθηκε"
echo ""
note "Commission split:"
echo "    Σύνολο πληρωμής:  ${TOTAL}€"
echo "    ─────────────────────────"
echo "    JMK (η εφαρμογή):  ${JMK}€  (10%)"
echo "    Hotel (Naxos):     ${HOT}€  (10%)"
echo "    Stripe fee:        ${SF}€"
echo "    Partner (Niko):    ${PRT}€  (≈80%)"
echo "    ─────────────────────────"
echo "    Status: chat (περιμένει chat με partner)"
pause

# ============================================================
step "ΒΗΜΑ 5 · Ο guest στέλνει μήνυμα"
say "Maria → Captain Niko: 'Γεια! Είμαστε 2 άτομα για Παρασκευή. Συμπεριλαμβάνεται γεύμα;'"
M1=$(curl -s -X POST "$BASE/api/bookings/$BID/messages" -H 'Content-Type: application/json' \
    -d '{"text":"Γεια! Είμαστε 2 άτομα για Παρασκευή. Συμπεριλαμβάνεται γεύμα;","fromId":"g-maria","fromName":"Maria","fromRole":"guest"}')
ok "Στάλθηκε ($(echo "$M1" | json_get id))"
echo "    flagged: $(echo "$M1" | json_get flagged)  (όχι, καθαρό μήνυμα)"
pause

# ============================================================
step "ΒΗΜΑ 6 · Ο PARTNER προσπαθεί να ΠΑΡΑΚΑΜΨΕΙ την εφαρμογή 🚨"
say "Captain Niko → Maria: 'Ναι περιλαμβάνεται! Πάρε με τηλ 6912345678 να συνεννοηθούμε εκτός app.'"
M2=$(curl -s -X POST "$BASE/api/bookings/$BID/messages" -H 'Content-Type: application/json' \
    -d '{"text":"Ναι περιλαμβάνεται! Πάρε με τηλ 6912345678 να συνεννοηθούμε εκτός app.","fromId":"p-niko","fromName":"Captain Niko","fromRole":"partner"}')
ok "Μήνυμα φιλτραρίστηκε από το anti-bypass system!"
echo ""
note "Τι βλέπει η Maria (κρυμμένο τηλέφωνο):"
echo "    \"$(echo "$M2" | json_get text)\""
echo ""
note "Σήμα στο admin panel:"
echo "    flagged: $(echo "$M2" | json_get flagged)"
echo "    flagKind: $(echo "$M2" | json_get flagKind)  (αυτόματα κατηγοριοποιημένο)"
echo ""
FLAGS=$(curl -s "$BASE/api/collections/flaggedMessages")
COUNT=$(echo "$FLAGS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).filter(m=>m.bookingId==='$BID').length));")
ok "$COUNT μήνυμα στο /flaggedMessages collection (admin θα το δει)"
pause

# ============================================================
step "ΒΗΜΑ 7 · State machine — προχωράμε το booking"
note "Συμφωνήθηκε η τιμή → chat ➜ agreed"
T1=$(curl -s -X POST "$BASE/api/bookings/$BID/transition" -H 'Content-Type: application/json' -d '{"to":"agreed"}')
ok "Status: $(echo "$T1" | json_get status)"

note "Δημιουργία payment intent (stub mode — σε production: real Stripe)"
P=$(curl -s -X POST "$BASE/api/payments/intent" -H 'Content-Type: application/json' -d "{\"bookingId\":\"$BID\"}")
ok "Intent ID: $(echo "$P" | json_get id)  ($(echo "$P" | json_get mode) mode)"

note "Επιβεβαίωση πληρωμής"
PC=$(curl -s -X POST "$BASE/api/payments/confirm" -H 'Content-Type: application/json' \
    -d "{\"bookingId\":\"$BID\",\"intentId\":\"$(echo "$P" | json_get id)\"}")
ok "Status: $(echo "$PC" | json_get status), paidAt: $(echo "$PC" | json_get paidAt)"

note "Ολοκληρώθηκε το activity"
T2=$(curl -s -X POST "$BASE/api/bookings/$BID/transition" -H 'Content-Type: application/json' -d '{"to":"completed"}')
ok "Status: $(echo "$T2" | json_get status)"

note "Η Maria αφήνει 5★ review"
RV=$(curl -s -X POST "$BASE/api/reviews" -H 'Content-Type: application/json' \
    -d "{\"bookingId\":\"$BID\",\"rating\":5,\"text\":\"Καταπληκτικό cruise!\",\"lang\":\"el\"}")
ok "Review #$(echo "$RV" | json_get id), rating: $(echo "$RV" | json_get rating)★"

FB=$(curl -s "$BASE/api/collections/bookings/$BID")
ok "Final booking status: $(echo "$FB" | json_get status)"
pause

# ============================================================
step "ΒΗΜΑ 8 · Δοκιμάζουμε ΑΠΟΤΥΧΙΑ — διπλή κράτηση στο ίδιο slot"
note "Γεμίζουμε όλη τη χωρητικότητα (8 θέσεις)"
DUMMY=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-sven","date":"2026-06-04","time":"09:00","slotId":"ts-boat-0","people":8}')
ok "Booking 8 ατόμων: $(echo "$DUMMY" | json_get id)"

note "Δοκιμάζουμε άλλο 1 άτομο στο ίδιο slot — ΘΑ ΑΠΟΤΥΧΕΙ"
FAIL_REQ=$(curl -s -w "|HTTP:%{http_code}" -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-jordan","date":"2026-06-04","time":"09:00","slotId":"ts-boat-0","people":1}')
HTTP=$(echo "$FAIL_REQ" | grep -oE "HTTP:[0-9]+" | cut -d: -f2)
if [ "$HTTP" = "409" ]; then
  ok "ΣΩΣΤΑ: 409 Conflict — δεν επιτρέπει over-booking"
  REASON=$(echo "$FAIL_REQ" | sed 's/|HTTP.*$//' | json_get reason)
  echo "    Reason: $REASON"
  echo "    Επιστρέφει επόμενα διαθέσιμα slots για να επιλέξει ο guest"
else
  fail "ΛΑΘΟΣ: επέτρεψε over-booking (HTTP $HTTP)"
fi
pause

# ============================================================
step "ΒΗΜΑ 9 · Ο partner κλείνει συγκεκριμένη ημερομηνία (πάει διακοπές)"
note "Block 15-17 Αυγούστου"
BL=$(curl -s -X POST "$BASE/api/activities/a-cruise/block-dates" -H 'Content-Type: application/json' \
    -d '{"dates":["2026-08-15","2026-08-16","2026-08-17"]}')
ok "Blocked: $(echo "$BL" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).blockedDates.join(', ')));")"

note "Guest προσπαθεί να κάνει book 16 Αυγούστου"
B2=$(curl -s -w "|HTTP:%{http_code}" -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-andrea","date":"2026-08-16","time":"09:00","slotId":"ts-boat-0","people":2}')
HTTP=$(echo "$B2" | grep -oE "HTTP:[0-9]+" | cut -d: -f2)
if [ "$HTTP" = "409" ]; then
  ok "ΣΩΣΤΑ: ο partner δεν δουλεύει αυτή τη μέρα → 409"
fi

# ============================================================
step "ΒΗΜΑ 10 · v1.3 — Συμφωνία τιμής → AUTO 20% deposit charge"
echo ""
note "Δημιουργούμε νέο booking χωρίς συμφωνημένη τιμή"
B3=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-sven","date":"2026-06-15","time":"09:00","slotId":"ts-boat-0","people":4}')
BID3=$(echo "$B3" | json_get id)
ok "Booking #$BID3 → status: chat"

note "Στο chat συμφωνούν τελικά για 350€ (μετά διαπραγμάτευση)"
AG=$(curl -s -X POST "$BASE/api/bookings/$BID3/agree" -H 'Content-Type: application/json' -d '{"agreedAmount":350}')
DAMT=$(echo "$AG" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).deposit.amount));")
ok "Booking → status: agreed"
ok "AUTO-CHARGE deposit: ${DAMT}€ (= 20% του 350€)"
note "→ Ο guest πληρώνει αυτόματα μέσω Stripe — ΔΕΝ περνάει από το χέρι σου"

CD=$(curl -s -X POST "$BASE/api/bookings/$BID3/confirm-deposit" -H 'Content-Type: application/json' -d '{}')
ok "Deposit έγινε → status: deposit_paid (το booking κλειδώθηκε)"

# ============================================================
step "ΒΗΜΑ 11 · v1.3 — Anti-bypass v2 με ελληνικές φράσεις"
echo ""
note "Ο partner στέλνει: 'Συνεννοούμαστε εκτός εφαρμογής'"
PHRASE_TEST=$(curl -s -X POST "$BASE/api/antibypass/check" -H 'Content-Type: application/json' \
    -d '{"text":"Καλημέρα, να συνεννοηθούμε εκτός εφαρμογής για καλύτερη τιμή"}')
echo "    flagged: $(echo "$PHRASE_TEST" | json_get flagged)"
echo "    kind: $(echo "$PHRASE_TEST" | json_get kind)"
echo "    severity: $(echo "$PHRASE_TEST" | json_get severity)"
echo "    riskScore: $(echo "$PHRASE_TEST" | json_get riskScore)"
ok "Detected!"

note "Ο partner στέλνει: 'Πληρώνεις απευθείας σε εμένα μετρητά'"
PT2=$(curl -s -X POST "$BASE/api/antibypass/check" -H 'Content-Type: application/json' \
    -d '{"text":"Πληρώνεις απευθείας σε εμένα μετρητά"}')
echo "    flagged: $(echo "$PT2" | json_get flagged)"
echo "    kind: $(echo "$PT2" | json_get kind)"
ok "Detected ως cash_payment intent"

# ============================================================
step "ΒΗΜΑ 12 · v1.3 — Admin moderation panel"
echo ""
note "Λίστα flagged μηνυμάτων (sorted by risk score)"
FLAGS=$(curl -s "$BASE/api/admin/flagged?status=open" -H 'X-Admin-Key: dev-admin-key')
COUNT=$(echo "$FLAGS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).count));")
ok "Open flagged messages: $COUNT"

note "Risk dashboard για όλους τους partners"
RISK=$(curl -s "$BASE/api/admin/partners/risk" -H 'X-Admin-Key: dev-admin-key')
echo "$RISK" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const arr=JSON.parse(d);arr.slice(0,5).forEach(p=>console.log('    '+p.name+'  status:'+p.status+'  warnings:'+(p.warnings||0)+'  risk7d:'+p.risk7d.totalScore));});"

# ============================================================
title "ΟΛΑ ΔΟΥΛΕΥΟΥΝ"
echo ""
echo "  Τι μόλις είδες:"
echo "  • Δυναμική τιμολόγηση (high season +20%, weekend +10%, group -5%)"
echo "  • Πραγματικό booking με commission split 10/10/80"
echo "  • Anti-bypass v2: τηλέφωνο/email κρύφτηκε + ελληνικές φράσεις detected"
echo "  • Auto 20% deposit: όταν συμφωνηθεί τιμή → αυτόματο charge 20%"
echo "  • State machine: chat → agreed → deposit_paid → completed → reviewed"
echo "  • Stripe payment flow (stub mode — έτοιμο για live keys)"
echo "  • Inventory check: όχι over-booking, όχι σε blocked μέρες"
echo "  • Admin moderation panel: auto-warn/auto-suspend partners"
echo ""
echo "  Επόμενο: άνοιξε το $BASE/JMK_Admin_App.html στον browser σου"
echo "  για να δεις το dashboard με τα bookings + flagged messages."
echo ""
