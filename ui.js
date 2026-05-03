import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// UI-related helper functions

/**
 * Create an inline button for window actions
 */
export function makeInlineButton(iconName, accessibleName) {
  const button = new St.Button({ style_class: 'winpick-inline-button', reactive: true, can_focus: true, accessible_name: accessibleName });
  button.set_child(new St.Icon({ icon_name: iconName, icon_size: 16 }));
  return button;
}

/**
 * Update the selection state of a row
 */
export function updateRowSelectionState(row, isSelected) {
  if (isSelected) {
    row.add_style_class_name('selected');
  } else {
    row.remove_style_class_name('selected');
  }
}

/**
 * Estimate page size for scrolling
 */
export function estimatePageSize() {
  // Simple heuristic: estimate 10 rows per page
  return 10;
}

/**
 * Ensure selection is visible in scroll container
 */
export function ensureSelectionVisible(scroll, selected) {
  if (!selected || !scroll)
    return;
  try {
    if (typeof scroll.scroll_child_to_visible === 'function') {
      let actor = scroll.get_clutter_actor();
      // todo
      actor.scroll_child_to_visible(selected);
      return;
    }
  } catch (_e) {}
  try {
    const vScroll = scroll.get_vscroll_bar ? scroll.get_vscroll_bar() : null;
    const adj = vScroll ? vScroll.get_adjustment() : null;
    if (!adj)
      return;
    const box = selected.get_allocation_box();
    const rowTop = box.y1;
    const rowBottom = box.y2;
    const lower = adj.get_lower ? adj.get_lower() : (adj.lower || 0);
    const upper = adj.get_upper ? adj.get_upper() : (adj.upper || (scroll ? scroll.height : 0));
    const current = adj.get_value ? adj.get_value() : adj.value;
    const page = (adj.get_page_size ? adj.get_page_size() : adj.page_size) || scroll.height || 1;
    let target = current;
    if (rowTop < current)
      target = rowTop;
    else if (rowBottom > current + page)
      target = rowBottom - page;
    target = Math.min(Math.max(target, lower), Math.max(lower, upper - page));
    if (Math.abs(target - current) > 1) {
      if (typeof adj.set_value === 'function')
        adj.set_value(target);
      else
        adj.value = target;
    }
  } catch (_e) {}
}