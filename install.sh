#!/usr/bin/env bash
set -euo pipefail

# Quick installer for the GNOME Shell extension in this folder.

here="$(cd "$(dirname "$0")" && pwd)"
meta="$here/metadata.json"
if [[ ! -f "$meta" ]]; then
  echo "metadata.json not found next to install.sh" >&2
  exit 1
fi

uuid=$(sed -n 's/^\s*"uuid"\s*:\s*"\([^"]\+\)".*/\1/p' "$meta" | head -n1)
if [[ -z "${uuid:-}" ]]; then
  echo "Could not read uuid from metadata.json" >&2
  exit 1
fi

dest="$HOME/.local/share/gnome-shell/extensions/$uuid"
mkdir -p "$dest"

echo "Installing to: $dest"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude ".git" \
    --exclude ".gitignore" \
    --exclude "install.sh" \
    "$here/" "$dest/"
else
  # Fallback to cp (no delete of removed files)
  shopt -s dotglob
  cp -R "$here"/* "$dest/"
fi

# Compile GSettings schemas if present
if [[ -d "$dest/schemas" ]]; then
  if command -v glib-compile-schemas >/dev/null 2>&1; then
    echo "Compiling GSettings schemas..."
    glib-compile-schemas "$dest/schemas" || echo "Warning: failed to compile schemas"
  else
    echo "Note: glib-compile-schemas not found; keybindings may not load until compiled by the system."
  fi
fi

if command -v gnome-extensions >/dev/null 2>&1; then
  echo "Enabling extension: $uuid"
  if ! gnome-extensions info "$uuid" >/dev/null 2>&1; then
    echo "Note: GNOME may need a restart/logout before enabling."
  fi
  gnome-extensions enable "$uuid" || true
else
  echo "Tip: Install gnome-extensions CLI to manage extensions."
fi

echo "Done. If on Wayland: log out/in. On Xorg: press Alt+F2, type 'r', press Enter."
