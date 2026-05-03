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
  
  // Determine if this is a portrait monitor (width < height)
  const isPortrait = monitor.width < monitor.height;
  
  let width, height;
  
  if (isPortrait) {
    // For portrait monitors, use height as the base dimension
    height = baseHeight;
    width = Math.round(height * aspect);
    // Ensure width is within reasonable bounds
    width = Math.min(420, Math.max(120, width));
    // Adjust height to maintain aspect ratio
    height = Math.round(width / Math.max(0.1, aspect));
    height = Math.max(120, Math.min(420, height));
  } else {
    // For landscape monitors, use width as the base dimension
    width = baseHeight * aspect;
    width = Math.min(420, Math.max(120, width));
    height = baseHeight;
  }

  const container = new St.Widget({
    layout_manager: new Clutter.BinLayout(),
    style_class: 'winpick-monitor-box',
  });
  container.set_size(width, height);

  const bg = new St.Widget({
    style_class: 'winpick-monitor-bg',
    x_expand: true,
    y_expand: true,
  });
  container.add_child(bg);

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
