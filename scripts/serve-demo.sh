#!/bin/bash
# Sirve la demo local en http://localhost:8080
#
# Comprueba si existe una versión nueva del código (commit más reciente
# que el build actual). Si la hay, reconstruye dist automáticamente.
# Uso: npm run demo

set -e
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"

HEAD_DATE=$(git log -1 --format=%ct 2>/dev/null || echo 0)
DIST_DATE=$(stat -c %Y dist/_expo/static/js/web/entry-*.js 2>/dev/null | sort -rn | head -1 || echo 0)

if [ -z "$DIST_DATE" ] || [ "$HEAD_DATE" -gt "$DIST_DATE" ]; then
  echo "→ Versión nueva detectada. Reconstruyendo dist..."
  npx expo export --platform web
else
  echo "→ dist al día. Sin reconstrucción."
fi

echo "→ Sirviendo demo en http://localhost:$PORT"
exec npx --yes serve -s dist -l "$PORT"