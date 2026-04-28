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
log "Booking flow"
B=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
    -d '{"activityId":"a-cruise","hotelId":"h-naxos-1","guestId":"g-maria","date":"2026-08-01","time":"10:00","people":2}')
assert_contains "$B" '"status":"chat"' "booking created with status=chat"
assert_contains "$B" '"jmkCommission":22' "JMK gets 10% (22 of 220)"
assert_contains "$B" '"hotelCommission":22' "Hotel gets 10% (22 of 220)"
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

# ---- Summary ----
echo ""
echo "=================================================="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "=================================================="
[ "$FAIL" -eq 0 ] || exit 1
