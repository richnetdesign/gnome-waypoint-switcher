# Bulk multi-select & workspace move plan

## Goals
- Allow multi-select of windows (Ctrl+Click, optional keyboard toggle) without activating them.
- Provide a bulk action bar for selected windows with “send to workspace” and clear selection.
- Offer a small workspace picker popup (no screen dim) with existing workspaces and “New workspace”.
- Record recent bulk moves and allow pinning favorites for quick reuse.

## State
- `_multiSelected: Set<id>` separate from keyboard highlight `_selectionIndex`.
- Settings (GSettings):
  - `show-app-bar` (exists)
  - `bulk-history-size` (int, default 5)
  - `bulk-favorites` (array of strings like `workspace:2`, optional later monitor+workspace)

## UX changes
- Row interactions:
  - Ctrl+Click toggles membership in `_multiSelected`.
  - Keep existing left-click activate and right-click select-only.
  - New row class `winpick-row-bulk` to style multi-selected rows (distinct from keyboard highlight and visible-window red).
- Bulk bar (visible when selection size > 0):
  - Buttons: “Send to workspace…”, “Favorites” (if any), “Clear selection”.
  - Anchored workspace picker popup (similar to move popup), lists workspaces with names/indices and “New workspace”.
- Keyboard toggle (optional): Ctrl+Space to toggle current row into bulk selection.

## Behaviour
- Applying workspace move:
  - For each selected window, `mw.change_workspace(workspace)`; unminimize/raise if needed.
  - Clear selection after move, refresh list.
- History/favorites:
  - Track last N bulk moves (workspace index, count, timestamp).
  - Allow pinning favorites; render as quick buttons in bulk bar.

## Implementation steps
1) State & settings: add `_multiSelected`, new settings keys; schema update + CI schema check.
2) Row UI: Ctrl+Click toggle, new styles; ensure filter/app bar rebuild prunes invalid selections.
3) Bulk bar + workspace picker popup; handle outside click/esc; add “New workspace”.
4) Move logic: workspace change for all selected; clear selection; update history/favs.
5) History/favorites persistence; render quick-action buttons; expose pin/unpin from history entries.
6) Polish: scrolling reliability (vscroll adjustment), styling for bulk states, docs/README update.

## Edge cases
- Windows destroyed while selected: drop from selection when refreshing list.
- Filter/app bar hides selected windows: consider showing a “+N hidden selected” badge or auto-clear hidden selections.
- Workspace removed: drop matching history/favorites entries gracefully.
