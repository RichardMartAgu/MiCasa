#!/bin/bash
# Notificaciones a Telegram.
# Uso: bash scripts/notify-telegram.sh "Mensaje"
# Lee TELEGRAM_BOT_TOKEN de ~/telegram-opencode-bot/.env y usa el último chat_id
# conocido (cache local). Si no hay chat_id, instruye al usuario a enviar /start.

set -e
BOT_DIR="${TELEGRAM_BOT_DIR:-$HOME/telegram-opencode-bot}"
MSG="${1:?Uso: notify-telegram.sh \"mensaje\"}"

TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$BOT_DIR/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$TOKEN" ] || { echo "ERROR: TELEGRAM_BOT_TOKEN vacío en $BOT_DIR/.env"; exit 1; }

CACHE_DIR="$HOME/.cache/telegram-opencode-bot"
CHAT_ID_FILE="$CACHE_DIR/chat_id"
CHAT_ID="${LAST_TELEGRAM_CHAT_ID:-}"
if [ -z "$CHAT_ID" ] && [ -f "$CHAT_ID_FILE" ]; then
  CHAT_ID=$(cat "$CHAT_ID_FILE")
fi

if [ -z "$CHAT_ID" ]; then
  CHAT_ID=$(curl -s --max-time 10 "https://api.telegram.org/bot${TOKEN}/getUpdates" \
    | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ids = [m['message']['chat']['id'] for m in d.get('result', []) if 'message' in m]
    print(ids[-1] if ids else '')
except Exception:
    pass")
  if [ -n "$CHAT_ID" ]; then
    mkdir -p "$CACHE_DIR"
    echo "$CHAT_ID" > "$CHAT_ID_FILE"
  fi
fi

if [ -z "$CHAT_ID" ]; then
  echo "ERROR: sin chat_id de Telegram. Envía /start al bot en Telegram y reintenta."
  exit 1
fi

PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'chat_id': '$CHAT_ID', 'text': sys.argv[1]}))" "$MSG")
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H "Content-Type: application/json" -d "$PAYLOAD")
echo "telegram send: $HTTP"
[ "$HTTP" = "200" ]