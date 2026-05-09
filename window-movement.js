import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Move window placement configurations
export const MOVE_PLACEMENTS = {
  'center-full': { type: 'full' },
  'left-top': { width: 0.5, height: 0.5, x: 0, y: 0 },
  'left-middle': { width: 0.5, height: 1.0, x: 0, y: 0 },
  'left-bottom': { width: 0.5, height: 0.5, x: 0, y: 0.5 },
  'right-top': { width: 0.5, height: 0.5, x: 0.5, y: 0 },
  'right-middle': { width: 0.5, height: 1.0, x: 0.5, y: 0 },
  'right-bottom': { width: 0.5, height: 0.5, x: 0.5, y: 0.5 },
};

/**
 * Close the move dialog popup
 */
export function closeMoveDialog() {
  if (this._moveStageSignals) {
    this._moveStageSignals.forEach(([obj, id]) => {
      try { obj.disconnect(id); } catch (_e) {}
    });
  }
  this._moveStageSignals = [];
  if (this._moveModalActive) {
    try { Main.popModal(this._movePopup); } catch (_e) {}
    this._moveModalActive = false;
  }
  if (this._movePopup) {
    try { this._movePopup.destroy(); } catch (_e) {}
    this._movePopup = null;
  }
  this._moveAnchorActor = null;
}

/**
 * Move a window to a specific monitor with placement configuration
 */
export function moveWindow(id, monitorIndex, placement) {
  const mw = this._findMetaWindow(id);
  if (!mw)
    return;

  const monitors = Main.layoutManager.monitors;
  const monitor = monitors[monitorIndex];
  if (!monitor)
    return;

  mw.unmaximize(Meta.MaximizeFlags.BOTH);
  try { mw.move_to_monitor(monitorIndex); } catch (_e) {}

  const config = MOVE_PLACEMENTS[placement] || MOVE_PLACEMENTS['center-full'];
  if (!config)
    return;

  if (config.type === 'full') {
    mw.maximize(Meta.MaximizeFlags.BOTH);
  } else {
    let width = Math.max(1, Math.round(monitor.width * config.width));
    let height = Math.max(1, Math.round(monitor.height * config.height));
    let x = monitor.x + Math.round(monitor.width * config.x);
    let y = monitor.y + Math.round(monitor.height * config.y);

    x = Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - width));
    y = Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - height));

    try {
      mw.move_resize_frame(false, x, y, width, height);
    } catch (_e) {}
  }

  mw.activate(global.display.get_current_time_roundtrip());
  this._closeMoveDialog();
  this._refreshWindows();
}

/**
 * Build a monitor grid visualization for window placement
 */
export function buildMonitorGrid(windowInfo, monitorIndex, monitor) {
  const baseHeight = 140;
  const aspect = monitor.width / Math.max(1, monitor.height);
  const isPortrait = monitor.height > monitor.width;

  let width;
  let height;

  if (isPortrait) {
    width = 140;
    height = Math.round(width / Math.max(0.1, aspect));
  } else {
    width = Math.round(baseHeight * aspect);
    height = baseHeight;
  }

  width = Math.min(420, Math.max(120, width));
  height = Math.min(420, Math.max(120, height));

  const container = new St.Widget({
    layout_manager: new Clutter.BinLayout(),
    style_class: 'winpick-monitor-box',
  });
  container.set_size(width, height);
  if (isPortrait)
    container.add_style_class_name('winpick-monitor-box-portrait');

  const layout = new Clutter.GridLayout();
  layout.set_row_spacing(Math.max(6, Math.round(height / 10)));
  layout.set_column_spacing(Math.max(6, Math.round(width / 10)));
  const grid = new St.Widget({ layout_manager: layout, style_class: 'winpick-monitor-grid' });
  grid.set_size(width, height);

  const placements = [
    { placement: 'left-top', row: 0, col: 0, label: 'Top Left' },
    { placement: 'left-middle', row: 1, col: 0, label: 'Left Half' },
    { placement: 'left-bottom', row: 2, col: 0, label: 'Bottom Left' },
    { placement: 'center-full', row: 1, col: 1, label: 'Full Screen', extra: 'center' },
    { placement: 'right-top', row: 0, col: 2, label: 'Top Right' },
    { placement: 'right-middle', row: 1, col: 2, label: 'Right Half' },
    { placement: 'right-bottom', row: 2, col: 2, label: 'Bottom Right' },
  ];

  placements.forEach(({ placement, row, col, label, extra }) => {
    const btn = new St.Button({
      style_class: 'winpick-monitor-point',
      reactive: true,
      can_focus: true,
      accessible_name: `${label} on monitor ${monitorIndex + 1}`,
    });
    if (extra)
      btn.add_style_class_name(`winpick-monitor-point-${extra}`);
    btn.connect('clicked', () => {
      this._suppressRowActivate = true;
      this._moveWindow(windowInfo.id, monitorIndex, placement);
    });
    layout.attach(btn, col, row, 1, 1);
  });

  container.add_child(grid);

  const indexLabel = new St.Label({
    text: `${monitorIndex + 1}`,
    style_class: 'winpick-monitor-index',
  });
  indexLabel.set_position(8, 6);
  container.add_child(indexLabel);

  return container;
}

/**
 * Position the move dialog popup relative to an anchor actor
 */
export function positionMovePopup(popup) {
  const anchor = this._moveAnchorActor || this._selected || this._actor;
  if (!anchor || !popup)
    return;
  let [ax, ay] = anchor.get_transformed_position();
  let aw = 0, ah = 0;
  if (typeof anchor.get_transformed_size === 'function') {
    [aw, ah] = anchor.get_transformed_size();
  } else {
    aw = anchor.width || 0;
    ah = anchor.height || 0;
  }
  const pw = popup.width;
  const ph = popup.height;

  const stageWidth = global.stage.width;
  const stageHeight = global.stage.height;

  let x = ax + aw + 12;
  if (x + pw > stageWidth)
    x = ax - pw - 12;
  if (x < 6)
    x = 6;

  let y = ay + Math.round((ah - ph) / 2);
  if (y + ph > stageHeight)
    y = stageHeight - ph - 6;
  if (y < 6)
    y = 6;

  popup.set_position(Math.round(x), Math.round(y));
}

/**
 * Create a move option button
 */
export function makeMoveOption(label, handler, isSecondary = false) {
  const button = new St.Button({ label, style_class: isSecondary ? 'winpick-move-cancel' : 'winpick-move-option', can_focus: true, reactive: true });
  button.connect('clicked', handler);
  return button;
}
