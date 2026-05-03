# Window Switcher Popup — Project Notes for Agents

## What This Extension Does
- **Purpose**: Provide an in-shell window switcher popup for GNOME with fuzzy matching, keyboard navigation, and inline actions (activate, close, move).
- **Triggering**: Exposed via D-Bus (`ca.richyoung.WindowPicker / Show`). Default shortcut is `Super+Y`, configurable through GSettings (`org.gnome.shell.extensions.window-switcher-popup show`).
- **UI Structure**:
  - Root popup (St.BoxLayout) with search entry and scrollable window list.
  - Rows include icon, title, inline “close” and “move” buttons.
  - Move button opens anchored context popup with proportional monitor previews (7 placement points).
  - Selected row highlights; if the underlying window is currently visible on the active workspace, the row turns red.

## Current Behaviour & Keybindings
- Fuzzy filtering updates list on text change.
- Keyboard shortcuts: `Esc` close, `Enter` activates selection, arrows move selection, `PageUp/PageDown`, `Home/End`, `F5` refresh.
- Move popup behaves like a context menu: anchored to invoking button, disappears on outside click or `Esc`, no stage dimming.
- Move popup can be hidden with GSettings key `enable-move-popover`.

## Implementation Details
- **GNOME Modules**: uses `Main.pushModal`, `St`, `Clutter`, `Meta`, `Pango`, `Shell`.
- **Modal handling**: main popup uses `pushModal`; move popup is manual (no modal) to avoid background dimming—watch for focus/anchor state.
- **Visibility Highlight**: `_isWindowVisible()` checks workspace + `showing_on_its_workspace()` to decide red highlight class.
- **Selection Scroll**: `_ensureSelectionVisible()` tries `scroll_child_to_visible`, falls back to manual scroll.
- **Monitor Popup**: `_positionMovePopup()` anchors relative to button or selected row; monitor grid uses actual resolution to scale.
- **Ignore List**: hardcoded app IDs / WM classes / titles for recorder utilities.

## Known Quirks & Gotchas
- **Wayland caching**: GNOME 45+ caches ES modules; use `./dev-install.sh` (creates timestamped UUID) or restart shell.
- **Typelib availability**: running JS/GI commands outside shell may lack `Meta`/`St` typelibs; avoid expecting them in CLI Python.
- **Modal stack**: keep `this._modalActive` in sync to avoid stuck modal—use `_closeMoveDialog()` before destroying popup.
- **Anchored popup**: remember to disconnect `captured-event` and null `_moveAnchorActor` during teardown to prevent leaks.
- **Focus**: call `grab_key_focus()` after showing context popup to capture Esc.
- **Scroll geometry**: transformed positions include stage offset; ensure fallback scroll uses stage coordinates (done).

## Debugging / Recovery Tips
- Reload extension: `gnome-extensions disable/enable window-switcher-popup@ai.richyoung.ca` or use README D-Bus commands.
- If popup gets stuck: `DisableExtension` then `EnableExtension` via D-Bus (documented in README).
- To inspect monitors: `Main.layoutManager.monitors` (objects with `x/y/width/height`).
- Window metadata: access via `global.get_window_actors()` → `meta_window` (for app ID, workspace, etc.).
- When adding signals, push to `_events` or `_moveStageSignals` and ensure disconnect in `_disconnectAll()` / `_closeMoveDialog()`.

## Suggested Future Enhancements
- Hover preview for monitor placement buttons without selection change.
- Consider optional hover indicator in window list or real-time update when switching workspace.
- Add tests or logging around `_estimatePageSize()` if selection scroll seems off on very short lists.

Keep this file updated when behaviour or tooling changes.
