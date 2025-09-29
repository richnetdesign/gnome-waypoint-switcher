
# Window Switcher Popup (All-in-one, no wofi)

A GNOME Shell extension that shows a fuzzy window-title picker *inside* GNOME.
No unsafe mode, Wayland-safe. It exposes a simple D-Bus method `Show` so you can
bind it to **Super+R** using GNOME's Keyboard shortcuts.

## Install

Quick install (copies into your user extensions dir and enables):

```
./install.sh
```

Notes:
- On Wayland, log out/in for GNOME Shell to pick up changes.
- On Xorg, press Alt+F2, type `r`, then Enter to reload.

Manual install:
1. Copy this folder (`window-switcher-popup@ai.richyoung.ca`) to `~/.local/share/gnome-shell/extensions/`
2. Enable it:
   ```
   gnome-extensions enable window-switcher-popup@ai.richyoung.ca
   ```

## Use
Trigger the popup:
```
gdbus call --session --dest ca.richyoung.WindowPicker --object-path /ca/richyoung/WindowPicker --method ca.richyoung.WindowPicker.Show
```

### Bind to Super+R
Open **Settings → Keyboard → Keyboard Shortcuts → Custom Shortcuts**:
- Name: Window Picker
- Command:
  ```
  gdbus call --session --dest ca.richyoung.WindowPicker --object-path /ca/richyoung/WindowPicker --method ca.richyoung.WindowPicker.Show
  ```
- Shortcut: press **Super+R**

(We avoid shipping a compiled GSettings schema; using a custom shortcut is simpler and works everywhere.)

## Behavior
- Shows only **icon + window title**.
- Fuzzy matches by subsequence on title/app name.
- Enter activates the top result, Esc closes.

## Implementation Notes
- Wayland-safe: uses GNOME Shell UI and D-Bus, no external windows.
- D-Bus name `ca.richyoung.WindowPicker` exposes `Show()` to trigger the popup.
- Follows GNOME extension best practices:
  - Stylesheet added/removed on enable/disable.
  - Signals tracked and disconnected safely on close.
  - UI attached via `Main.layoutManager.addChrome()`.

## Dev Reload on Wayland
GNOME 45+ caches ES modules for the lifetime of the Shell process, so disabling/enabling won’t reload JS on Wayland. Use a dev UUID to hot‑load changes without logging out:

```
./dev-install.sh
```

What it does:
- Copies the extension with a unique dev UUID (timestamped) and updates `metadata.json`.
- Disables any enabled sibling variants to avoid D-Bus name conflicts.
- Enables the new dev variant so the updated JS is imported fresh.

Re-run after changes to create a new dev variant. On Xorg you can still use Alt+F2 → r.
