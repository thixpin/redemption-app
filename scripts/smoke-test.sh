#!/usr/bin/env bash
# End-to-end smoke test for the Redemption API — 12 checks covering every
# endpoint, happy paths and error paths. Creates one throwaway code/user per
# run (timestamped, harmless).
#
# Usage:
#   ./scripts/smoke-test.sh                                      # local (http://localhost:3000)
#   ./scripts/smoke-test.sh https://redemption-dev.thixpin.me    # dev
#   ./scripts/smoke-test.sh https://redemption-api.thixpin.me    # prod
#
# Exits non-zero if any check returns an unexpected HTTP status.
set -u

BASE="${1:-http://localhost:3000}"
CODE="SMOKE-$(date +%s)"
USER_ID="smokeuser-$(date +%s)"
FAIL=0

req() { # expected method path [json-body]
  local expected="$1" method="$2" path="$3" body="${4:-}"
  local args=(-sk -o /tmp/smoke.body -m 10 -w '%{http_code}' -X "$method" "$BASE$path")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  local status; status=$(curl "${args[@]}")
  if [ "$status" = "$expected" ]; then
    printf '  \033[32mPASS\033[0m [%s] %s %s\n' "$status" "$method" "$path"
  else
    printf '  \033[31mFAIL\033[0m [%s, expected %s] %s %s\n' "$status" "$expected" "$method" "$path"
    head -c 200 /tmp/smoke.body; echo
    FAIL=1
  fi
}

echo "Smoke-testing $BASE (code=$CODE user=$USER_ID)"
req 200 GET /health
req 200 GET /metrics
req 200 GET /api/codes
req 201 POST /api/codes "{\"code\":\"$CODE\",\"reward\":\"Smoke test\",\"maxRedemptions\":2}"
req 409 POST /api/codes "{\"code\":\"$CODE\",\"reward\":\"dup\"}"                # duplicate
req 400 POST /api/codes "{\"code\":\"missing-reward\"}"                          # invalid body
req 201 POST /api/redeem "{\"code\":\"$CODE\",\"userId\":\"$USER_ID\"}"
req 409 POST /api/redeem "{\"code\":\"$CODE\",\"userId\":\"$USER_ID\"}"          # same user again
req 404 POST /api/redeem "{\"code\":\"DOES-NOT-EXIST\",\"userId\":\"$USER_ID\"}" # unknown code
req 200 GET "/api/redemptions?userId=$USER_ID"
req 404 GET /definitely-not-here                                                 # unknown route
req 400 POST /api/redeem '{bad json'                                             # malformed JSON

if [ "$FAIL" = 0 ]; then
  echo "ALL 12 CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
fi
exit $FAIL
