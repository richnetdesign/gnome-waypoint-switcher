
# Window Switcher Popup (All-in-one, no wofi)

A GNOME Shell extension that shows a fuzzy window-title picker *inside* GNOME.
No unsafe mode, Wayland-safe. It exposes a simple D-Bus method `Show` so you can
bind it to **Super+R** using GNOME's Keyboard shortcuts.

## Install
1. Copy `window-switcher-popup@ai.richyoung.ca` to `~/.local/share/gnome-shell/extensions/`
2. Log out/in (Wayland) and enable:
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
