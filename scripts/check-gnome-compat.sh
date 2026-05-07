#!/usr/bin/env bash
set -euo pipefail

if ! grep -q '"50"' metadata.json; then
  echo "[FAIL] metadata.json does not declare GNOME Shell 50 support." >&2
  exit 1
fi

if command -v glib-compile-schemas >/dev/null 2>&1; then
  glib-compile-schemas --strict --dry-run schemas
else
  echo "[WARN] glib-compile-schemas not found; skipping schema validation." >&2
fi

echo "Compatibility check passed."
