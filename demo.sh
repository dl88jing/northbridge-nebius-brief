#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cmd="${1:-offline}"

echo "== Northbridge Brief =="
echo "Household: Avery & Morgan Quinn (pseudonyms)"
echo

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

case "$cmd" in
  offline|demo)
    echo "Running offline investigation (no API keys required)..."
    npx tsx scripts/demo.ts
    ;;
  dev|web)
    echo "Starting Next.js dashboard at http://127.0.0.1:3000"
    npm run dev
    ;;
  build)
    npm run build
    ;;
  *)
    echo "Usage: ./demo.sh [offline|dev|build]"
    exit 1
    ;;
esac
