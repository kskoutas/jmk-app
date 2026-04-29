#!/usr/bin/env bash
# JMK · End-to-End Smoke Test
# ----------------------------
# Τρέχει ολόκληρο το user journey εναντίον ενός running server.
#
# Usage:
#   bash tests/e2e.sh                # default http://localhost:3000
#   BASE=https://jmk-server.onrender.com bash tests/e2e.sh
#
# Πριν τρέξει:
#   1. cd server && npm install && node server.js  (σε άλλο terminal)
#   2. Σε αυτό το terminal: bash tests/e2e.sh

set -uo pipefail
# Σημείωση: ΟΧΙ -e — θέλουμε να συνεχίσει να τρέχει ακόμα κι αν ένα assertion αποτύχει,
# ώστε να δούμε τι ακριβώς δουλεύει και τι όχι.

BASE="${BASE:-http://localhost:3000}"
PASS=0
FAIL=0

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; N='\033[0m'

log()  { echo -e "${Y}▶${N} $*"; }
pass() { PASS=$((PASS+1)); echo -e "  ${G}✓${N} $*"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${R}✗${N} $*"; }

# Helper: assert command output contains string
assert_contains() {
  local out="$1" expected="$2" label="$3"
  if echo "$out" | grep -q "$expected"; then pass "$label"; else fail "$label (expected: $expected, got: $out)"; fi
}

# Helper: extract JSON field via node (no jq dependency)
json() { node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);const v=$1;console.log(typeof v==='object'?JSON.stringify(v):v);}catch(e){console.log('');}});"; }

echo "=================================================="
echo "  JMK · E2E Smoke Test"
echo "  Target: $BASE"
echo "=================================================="

# ---- 1. Health ----
log "Health check"
H=$(curl -s "$BASE/api/health")
assert_contains "$H" '"ok":true' "GET /api/health"

# ---- 2. Reset DB σε γνωστή κατάσταση ----
log "Reset to seed"
R=$(curl -s -X POST "$BASE/api/reset")
assert_contains "$R" '"ok":true' "POST /api/reset"

# ---- 3. Δες seed data ----
log "Seed data exists"
HOTELS=$(curl -s "$BASE/api/collections/hotels")
COUNT=$(echo "$HOTELS" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).length))")
if [ "$COUNT" -ge 7 ]; then pass "hotels: $COUNT"; else fail "hotels too few: $COUNT"; fi

ACTIVITIES=$(curl -s "$BASE/api/collections/activities")
ACOUNT=$(echo "$ACTIVITIES" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).length))")
if [ "$ACOUNT" -ge 10 ]; then pass "activities: $ACOUNT"; else fail "activities too few: $ACOUNT"; fi

# ---- 4. Commission preview (10/10 split) ----
log "Commission preview"
PREV=$(curl -s "$BASE/api/commission/preview?total=100&hotelId=h-naxos-1")
assert_contains "$PREV" '"jmkCommission":10' "10% JMK commission"
assert_contains "$PREV" '"hotelCommission":10' "10% hotel commission"

# ---- 5. Weather ----
log "Weather forecast (Open-Meteo or fallback)"
TODAY=$(date +%Y-%m-%d)
W=$(curl -s "$BASE/api/weather?island=isl-naxos&date=$TODAY")
assert_contains "$W" '"suitable"' "weather returns suitability flags"

# ---- 6. Itinerary ----
log "Itinerary generator"
DATES_JSON='["'$TODAY'"]'
I=$(curl -s -X POST "$BASE/api/itinerary" -H 'Content-Type: application/json' \
    -d "{\"hotelId\":\"h-naxos-1\",\"dates\":$DATES_JSON,\"guestId\":\"g-maria\"}")
assert_contains "$I" '"plans"' "itinerary returns plans"
assert_contains "$I" '"Adventure"' "Adventure theme present"
assert_contains "$I" '"Relax"' "Relax theme present"
assert_contains "$I" '"Foodie"' "Foodie theme present"

# ---- 7. QR code ----
log "QR generation"
QR_HEAD=$(curl -s -o /dev/null -w "%{content_type}|%{http_code}" "$BASE/api/qr/hotel/h-naxos-1?format=png")
if echo "$QR_HEAD" | grep -q "image/png|200"; then pass "PNG QR ($QR_HEAD)"; else fail "PNG QR ($QR_HEAD)"; fi

QR_SVG=$(curl -s "$BASE/api/qr/hotel/h-naxos-1?format=svg")
assert_contains "$QR_SVG" '<svg' "SVG QR"

# ---- 8. Booking creation ----
# Note: pricing is dynamic (high season/weekend/group). Use a low-season weekday to keep math predictable.
log "Booking flow"
B=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-maria","date":"2026-06-03","time":"09:00","slotId":"ts-boat-0","people":2}')
assert_contains "$B" '"status":"chat"' "booking created with status=chat"
# Verify 10/10 invariant: jmkCommission == hotelCommission (regardless of total)
INV=$(echo "$B" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.jmkCommission===j.hotelCommission?'eq':'neq')})")
if [ "$INV" = "eq" ]; then pass "10/10 invariant: JMK == Hotel commission"; else fail "10/10 invariant broken"; fi
# Verify both equal 10% of totalAmount
PCT=$(echo "$B" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);const r=Math.round((j.jmkCommission/j.totalAmount)*100);console.log(r)})")
if [ "$PCT" = "10" ]; then pass "JMK = 10% of total"; else fail "JMK percentage wrong: $PCT%"; fi
BID=$(echo "$B" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
echo "  → bookingId: $BID"

# ---- 9. Send chat message via REST (anti-bypass) ----
log "Chat REST + anti-bypass"
M=$(curl -s -X POST "$BASE/api/bookings/$BID/messages" -H 'Content-Type: application/json' \
    -d '{"text":"Γεια! Ποιες ώρες δουλεύεις; Email μου: test@example.com","fromId":"g-maria","fromName":"Maria","fromRole":"guest"}')
assert_contains "$M" '"flagged":true' "email detected as bypass attempt"
assert_contains "$M" '📧' "email redacted in displayed text"

# ---- 10. State transitions ----
log "Booking state machine"
T1=$(curl -s -X POST "$BASE/api/bookings/$BID/transition" -H 'Content-Type: application/json' -d '{"to":"agreed"}')
assert_contains "$T1" '"status":"agreed"' "chat → agreed"

T2=$(curl -s -X POST "$BASE/api/bookings/$BID/transition" -H 'Content-Type: application/json' -d '{"to":"paid"}')
assert_contains "$T2" '"status":"paid"' "agreed → paid"

# Invalid transition
T3=$(curl -s -X POST "$BASE/api/bookings/$BID/transition" -H 'Content-Type: application/json' -d '{"to":"chat"}')
assert_contains "$T3" 'cannot transition' "rejects illegal transition"

# ---- 11. Payment intent ----
log "Payment intent (stub mode)"
P=$(curl -s -X POST "$BASE/api/payments/intent" -H 'Content-Type: application/json' -d "{\"bookingId\":\"$BID\"}")
assert_contains "$P" '"clientSecret"' "intent has client secret"
assert_contains "$P" '"mode":"stub"' "stub mode active"

# ---- 12. Review (after completed) ----
log "Reviews"
curl -s -X POST "$BASE/api/bookings/$BID/transition" -H 'Content-Type: application/json' -d '{"to":"completed"}' > /dev/null
RV=$(curl -s -X POST "$BASE/api/reviews" -H 'Content-Type: application/json' \
     -d "{\"bookingId\":\"$BID\",\"rating\":5,\"text\":\"Φανταστικό!\",\"lang\":\"el\"}")
assert_contains "$RV" '"rating":5' "review created"

# ---- 13. Auth ----
log "Auth flow"
EMAIL="test-$(date +%s)@jmk.test"
REG=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"test1234\",\"role\":\"guest\",\"name\":\"Test User\"}")
assert_contains "$REG" '"token"' "register returns token"
TOKEN=$(echo "$REG" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

ME=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN")
assert_contains "$ME" "$EMAIL" "GET /me returns user"

# ============================================================
# v1.2 — Airbnb-style features
# ============================================================

# ---- Photos enriched in seed ----
log "Activity has photos"
ACT=$(curl -s "$BASE/api/collections/activities/a-cruise")
assert_contains "$ACT" 'unsplash.com' "activity has Unsplash photos in seed"
assert_contains "$ACT" '"isCover":true' "first photo marked as cover"

# ---- Schedule ----
log "Activity has schedule (timeSlots, weekly)"
assert_contains "$ACT" '"timeSlots"' "schedule.timeSlots present"
assert_contains "$ACT" '"weekly"' "schedule.weekly present"

# ---- Pricing rules ----
log "Activity has pricing rules"
assert_contains "$ACT" '"highSeason"' "pricing.highSeason present"
assert_contains "$ACT" '"weekend"' "pricing.weekend present"

# ---- Availability endpoint ----
log "Availability endpoint"
TODAY=$(date +%Y-%m-%d)
NEXT_MONTH=$(date -v+30d +%Y-%m-%d 2>/dev/null || date -d "+30 days" +%Y-%m-%d)
AVAIL=$(curl -s "$BASE/api/activities/a-cruise/availability?from=$TODAY&to=$NEXT_MONTH")
assert_contains "$AVAIL" '"days"' "availability returns days array"
assert_contains "$AVAIL" '"isOpen"' "days have isOpen flag"
assert_contains "$AVAIL" '"slots"' "days have slots"

# ---- Block date ----
log "Block & unblock date"
FUTURE=$(date -v+5d +%Y-%m-%d 2>/dev/null || date -d "+5 days" +%Y-%m-%d)
BL=$(curl -s -X POST "$BASE/api/activities/a-cruise/block-dates" -H 'Content-Type: application/json' -d "{\"dates\":[\"$FUTURE\"]}")
assert_contains "$BL" "$FUTURE" "blocked date returned"

# Booking on blocked date should fail
BAD=$(curl -s -w "|HTTP:%{http_code}" -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
   -d "{\"activityId\":\"a-cruise\",\"hotelId\":\"h-naxos-1\",\"guestId\":\"g-maria\",\"date\":\"$FUTURE\",\"time\":\"09:00\",\"slotId\":\"ts-boat-0\",\"people\":2}")
assert_contains "$BAD" "HTTP:409" "booking on blocked date returns 409"
assert_contains "$BAD" "slot_unavailable" "error message correct"

# Unblock
UB=$(curl -s -X POST "$BASE/api/activities/a-cruise/unblock-dates" -H 'Content-Type: application/json' -d "{\"dates\":[\"$FUTURE\"]}")

# ---- Pricing preview ----
log "Dynamic pricing preview"
PP=$(curl -s "$BASE/api/activities/a-cruise/price-preview?date=$FUTURE&time=09:00&people=2")
assert_contains "$PP" '"total"' "pricing returns total"
assert_contains "$PP" '"breakdown"' "pricing shows breakdown"

# Group discount: 6 ppl should trigger discount
PP6=$(curl -s "$BASE/api/activities/a-cruise/price-preview?date=$FUTURE&time=09:00&people=6")
assert_contains "$PP6" '"group_discount"' "6 ppl triggers group discount"

# ---- Activity details update ----
log "Activity details update"
DET=$(curl -s -X PATCH "$BASE/api/activities/a-cruise/details" -H 'Content-Type: application/json' \
    -d '{"languages":["el","en","de"],"rules":["No smoking","No pets"]}')
assert_contains "$DET" '"de"' "languages updated"
assert_contains "$DET" 'No smoking' "rules updated"

# ---- Photo upload (test with tiny PNG) ----
log "Photo upload"
# Create a 1x1 PNG via base64
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > /tmp/jmk-test.png
UP=$(curl -s -X POST "$BASE/api/uploads" -F "files=@/tmp/jmk-test.png" -F "activityId=a-wine")
assert_contains "$UP" '"uploads"' "upload returns uploads array"
assert_contains "$UP" '"url"' "uploaded file has url"

# ---- Verify photo attached ----
WINE=$(curl -s "$BASE/api/collections/activities/a-wine")
assert_contains "$WINE" 'jmk-test\|local\|cloudinary' "uploaded photo attached to activity"

# ============================================================
# v1.3 — Auto Pre-Payment + Anti-Bypass v2 + Moderation
# ============================================================

# ---- Anti-bypass v2: Greek phrase detection ----
log "Anti-bypass v2 — έξυπνη ανίχνευση"
AB1=$(curl -s -X POST "$BASE/api/antibypass/check" -H 'Content-Type: application/json' \
    -d '{"text":"Καλημέρα, να συνεννοηθούμε εκτός εφαρμογής για καλύτερη τιμή"}')
assert_contains "$AB1" '"flagged":true' "Detects εκτός εφαρμογής"
assert_contains "$AB1" 'offplatform' "Categorized as offplatform"

AB2=$(curl -s -X POST "$BASE/api/antibypass/check" -H 'Content-Type: application/json' \
    -d '{"text":"Πάρε με τηλέφωνο να τα πούμε"}')
assert_contains "$AB2" '"flagged":true' "Detects πάρε με τηλέφωνο"
assert_contains "$AB2" 'solicit_call' "Categorized as solicit_call"

AB3=$(curl -s -X POST "$BASE/api/antibypass/check" -H 'Content-Type: application/json' \
    -d '{"text":"Πληρώνεις απευθείας σε εμένα μετρητά"}')
assert_contains "$AB3" 'cash_payment' "Detects cash payment intent"

# Disguised numbers
AB4=$(curl -s -X POST "$BASE/api/antibypass/check" -H 'Content-Type: application/json' \
    -d '{"text":"Το νουμερό μου είναι έξι εννιά ένα δύο τρία τέσσερα πέντε έξι"}')
assert_contains "$AB4" 'disguised_number' "Detects disguised numbers"

# Risk score
SCORE=$(echo "$AB1" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{console.log(JSON.parse(d).riskScore)});")
if [ "$SCORE" -ge 30 ]; then pass "Risk score >= 30 (got $SCORE)"; else fail "Risk score too low: $SCORE"; fi

# ---- Auto deposit on agree ----
log "Auto 20% deposit when price agreed"
B=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-maria","date":"2026-06-10","time":"09:00","slotId":"ts-boat-0","people":2}')
BID=$(echo "$B" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id));")

# Agree at €250 (different from initial estimate)
AG=$(curl -s -X POST "$BASE/api/bookings/$BID/agree" -H 'Content-Type: application/json' \
    -d '{"agreedAmount":250}')
assert_contains "$AG" '"deposit"' "Agree returns deposit details"
assert_contains "$AG" '"intent"' "Deposit includes payment intent"
assert_contains "$AG" '"status":"agreed"' "Booking status → agreed"

# Verify deposit is 20% of 250 = 50
DEPAMT=$(echo "$AG" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).deposit.amount));")
if [ "$DEPAMT" = "50" ]; then pass "Deposit = 20% of €250 = €50"; else fail "Deposit wrong: $DEPAMT"; fi

# Confirm deposit
CD=$(curl -s -X POST "$BASE/api/bookings/$BID/confirm-deposit" -H 'Content-Type: application/json' -d '{}')
assert_contains "$CD" '"status":"deposit_paid"' "After confirm → deposit_paid"

# ---- Refund calculation ----
log "Refund on cancel"
RF=$(curl -s -X POST "$BASE/api/bookings/$BID/refund" -H 'Content-Type: application/json' -d '{"reason":"guest_changed_mind"}')
assert_contains "$RF" '"refund"' "Refund object returned"
assert_contains "$RF" '"status":"cancelled"' "Booking marked cancelled"

# ---- Auto-moderation: partner sends 3 flagged → warn ----
log "Auto-moderation: partner risk tracking"
# Reset για clean state
curl -s -X POST "$BASE/api/reset" > /dev/null

# Send 3 flagged messages from p-niko on different bookings
for i in 1 2 3; do
  curl -s -X POST "$BASE/api/bookings/b-2826/messages" -H 'Content-Type: application/json' \
    -d "{\"text\":\"Πάρε με τηλέφωνο 6912345$i$i$i να συμφωνήσουμε εκτός εφαρμογής μετρητά\",\"fromId\":\"p-niko\",\"fromName\":\"Niko\",\"fromRole\":\"partner\"}" > /dev/null
done

# Check that partner now has warnings
RISK=$(curl -s "$BASE/api/admin/partners/risk" -H 'X-Admin-Key: dev-admin-key')
NIKO_RISK=$(echo "$RISK" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const arr=JSON.parse(d);const n=arr.find(x=>x.id==='p-niko');console.log(n?(n.warnings||0)+'|'+n.status:'notfound')});")
WARNINGS=$(echo "$NIKO_RISK" | cut -d'|' -f1)
STATUS=$(echo "$NIKO_RISK" | cut -d'|' -f2)
if [ "$WARNINGS" -ge 1 ] || [ "$STATUS" = "paused" ]; then
  pass "Partner auto-warned/suspended (warnings=$WARNINGS, status=$STATUS)"
else
  fail "Partner not auto-warned (warnings=$WARNINGS, status=$STATUS)"
fi

# ---- Admin endpoints ----
log "Admin moderation panel"
FLAGS=$(curl -s "$BASE/api/admin/flagged?status=open" -H 'X-Admin-Key: dev-admin-key')
assert_contains "$FLAGS" '"items"' "Admin gets flagged items list"
assert_contains "$FLAGS" '"riskScore"' "Items include risk score"

# Suspend partner manually
SUSP=$(curl -s -X POST "$BASE/api/admin/partners/p-naxoshike/suspend" -H 'X-Admin-Key: dev-admin-key' -H 'Content-Type: application/json' -d '{"reason":"Testing"}')
assert_contains "$SUSP" '"status":"paused"' "Manual suspend works"

# Reactivate
REA=$(curl -s -X POST "$BASE/api/admin/partners/p-naxoshike/reactivate" -H 'X-Admin-Key: dev-admin-key' -H 'Content-Type: application/json' -d '{"reason":"Testing reactivation"}')
assert_contains "$REA" '"status":"approved"' "Reactivate works"

# Without admin key → 403
NOAUTH=$(curl -s -w "|HTTP:%{http_code}" "$BASE/api/admin/flagged")
assert_contains "$NOAUTH" 'HTTP:403' "Unauthorized blocked"

# ---- Summary ----
echo ""
echo "=================================================="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "=================================================="
[ "$FAIL" -eq 0 ] || exit 1
