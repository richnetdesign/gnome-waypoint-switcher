#!/usr/bin/env bash
set -euo pipefail

FAILURES=0

grep_api() {
  local symbol="$1"
  local file="$2"
  if grep -R --line-number --fixed-strings "$symbol" "$file" >/dev/null; then
    echo "[WARN] Found GNOME 46+ API usage: $symbol"
    ((FAILURES++)) || true
  fi
}

grep_api "Main.wm.addKeybinding" extension.js
grep_api "Main.pushModal" extension.js
grep_api "Shell.WindowTracker" extension.js

if (( FAILURES > 0 )); then
  echo "Compatibility check flagged potential GNOME API changes." >&2
  exit 1
fi

echo "Compatibility check passed."
