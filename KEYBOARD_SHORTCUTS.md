# Keyboard Shortcut: Trigger Window Picker

This extension includes a built‑in keybinding (default: `Super+Y`) and also exposes a D‑Bus method you can bind to any custom shortcut.

## Built‑in keybinding
- Default: `Super+Y`.
- Change via CLI:
  - `gsettings set org.gnome.shell.extensions.window-switcher-popup show "['<Super>Y']"`
- Or with dconf Editor at `/org/gnome/shell/extensions/window-switcher-popup/show`.

## Quick setup (GUI) for a custom shortcut
- Open `Settings → Keyboard → Keyboard Shortcuts → Custom Shortcuts`.
- Add a new shortcut:
  - Name: `Window Picker`
  - Command:
    - `gdbus call --session --dest ca.richyoung.WindowPicker --object-path /ca/richyoung/WindowPicker --method ca.richyoung.WindowPicker.Show`
  - Shortcut: press your preferred combo. Suggested default: `Super+Y` (commonly free on stock GNOME).
- Test: press your shortcut. You can also test from a terminal using the same command.

## Resolving conflicts
- If GNOME reports the binding is already in use, either:
  - Pick a different combo, or
  - Unbind/replace the conflicting shortcut in the same Keyboard settings page.

### Alternative suggestions likely to be free
- `Super+Y` (recommended)
- `Super+U`
- `Super+O`
- `Super+T`

Avoid: `Super+Space`, `Super+Tab`, `Super+A`, `Super+L`, `Super+M`, workspace shortcuts, media keys.

## Command-line setup (optional)
If you prefer, you can add a custom shortcut via `gsettings`.

- Check current custom bindings:
  - `gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings`
- Add a new binding at `custom0` (use `custom1`, `custom2`, etc. if taken):
  - `gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']"`
  - `gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name 'Window Picker'`
  - `gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command "gdbus call --session --dest ca.richyoung.WindowPicker --object-path /ca/richyoung/WindowPicker --method ca.richyoung.WindowPicker.Show"`
  - `gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding '<Super>Y'`

## Notes
- Ensure the extension is enabled:
  - `gnome-extensions enable window-switcher-popup@ai.richyoung.ca`
- After installing/updating the extension, reload GNOME Shell:
  - Wayland and GNOME 50+: log out/in, or use the included `./dev-install.sh` during development
  - Older Xorg sessions: `Alt+F2` -> type `r` -> `Enter`
- The popup also closes on `Esc` and activates the top match on `Enter`.
