#!/usr/bin/env bash
# Agent Office Codex relay.
# Receives a raw Codex hook JSON payload on stdin and forwards it to the
# local Agent Office server. If the desktop app is closed, it starts it first.

set -u

SERVER_URL="http://127.0.0.1:3334/codex-event"
HEALTH_URL="http://127.0.0.1:3334/health"
TOKEN_FILE="$HOME/.agent-office/auth-token"
APP_BUNDLE_ID="com.agentoffice.app"

PAYLOAD="$(cat)"
[ -n "$PAYLOAD" ] || exit 0

server_ready() {
  /usr/bin/curl -sf --max-time 0.4 "$HEALTH_URL" >/dev/null 2>&1
}

if ! server_ready; then
  /usr/bin/open -gj -b "$APP_BUNDLE_ID" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    server_ready && break
    /bin/sleep 0.25
  done
fi

server_ready || exit 0
[ -r "$TOKEN_FILE" ] || exit 0

TOKEN="$(/bin/cat "$TOKEN_FILE" 2>/dev/null)"
[ -n "$TOKEN" ] || exit 0

/usr/bin/curl -sf   -X POST "$SERVER_URL"   -H "Content-Type: application/json"   -H "Authorization: Bearer $TOKEN"   --data-binary "$PAYLOAD"   --max-time 1   >/dev/null 2>&1 || true

exit 0
