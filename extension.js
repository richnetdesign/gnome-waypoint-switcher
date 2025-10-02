
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS_NAME  = 'ca.richyoung.WindowPicker';
const OBJ_PATH  = '/ca/richyoung/WindowPicker';
const IFACE     = 'ca.richyoung.WindowPicker';

const IFACE_XML = `
<node>
  <interface name="${IFACE}">
    <method name="Show"/>
  </interface>
</node>`;

const IGNORE_APP_IDS = new Set([
  'org.gnome.screenshot',
  'xwaylandvideobridge',
  'xwaylandvideobridge.desktop',
  'org.gnome.shell.screencast',
  'waylandtoxrecordingbridge',
  'waylandtoxrecordingbridge.desktop',
]);

const IGNORE_WM_CLASSES = new Set([
  'xwaylandvideobridgerecorder',
  'wayland to x recording bridge',
  'wayland-to-x-recording-bridge',
  'waylandtoxrecordingbridge',
  'waylandtox-recording-bridge',
]);

const IGNORE_TITLE_SUBSTRINGS = [
  'wayland recorder',
  'wayland to x recording bridge',
  'recording bridge',
];

const MOVE_PLACEMENTS = {
  'center-full': { type: 'full' },
  'left-top': { width: 0.5, height: 0.5, x: 0, y: 0 },
  'left-middle': { width: 0.5, height: 1.0, x: 0, y: 0 },
  'left-bottom': { width: 0.5, height: 0.5, x: 0, y: 0.5 },
  'right-top': { width: 0.5, height: 0.5, x: 0.5, y: 0 },
  'right-middle': { width: 0.5, height: 1.0, x: 0.5, y: 0 },
  'right-bottom': { width: 0.5, height: 0.5, x: 0.5, y: 0.5 },
};

let _ownId = 0;
let _exported = null;

function fuzzyScore(needle, hay) {
  // Simple subsequence score: characters in order = points, contiguous bonus
  needle = needle.toLowerCase();
  hay = hay.toLowerCase();
  let score = 0, j = 0, streak = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) {
    if (hay[i] === needle[j]) {
      j++; score += 5 + streak; streak++;
    } else {
      streak = 0;
    }
  }
  return j === needle.length ? score : 0;
}

function listWindows() {
  const tracker = Shell.WindowTracker.get_default();
  return global.get_window_actors().map(w => {
    const m = w.meta_window;
    const app = tracker.get_window_app(m);
    const info = {
      id: m.get_id(),
      title: String(m.get_title() || ""),
      appId: app ? app.get_id() : "",
      app: app ? app.get_name() : (m.get_wm_class() || ""),
      wmClass: m.get_wm_class() || "",
      icon: app || null,
    };
    return shouldIgnoreWindow(info) ? null : info;
  }).filter(Boolean);
}

function shouldIgnoreWindow(info) {
  const title = info.title.toLowerCase();
  const appId = info.appId.toLowerCase();
  const wmClass = info.wmClass.toLowerCase();

  if (IGNORE_APP_IDS.has(appId))
    return true;
  if (IGNORE_WM_CLASSES.has(wmClass))
    return true;
  return IGNORE_TITLE_SUBSTRINGS.some(substr => title.includes(substr));
}

class WinpickUI {
  constructor() {
    this._actor = new St.BoxLayout({ vertical: true, style_class: 'winpick-popup', reactive: true, can_focus: true });
    this._header = new St.BoxLayout({ vertical: false, style_class: 'winpick-header' });
    this._entry = new St.Entry({ style_class: 'winpick-entry', can_focus: true, hint_text: 'Filter windows…', x_expand: true });
    this._closeButton = new St.Button({ style_class: 'winpick-close', can_focus: true, reactive: true, accessible_name: 'Close window picker' });
    this._closeButton.set_child(new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 16 }));
    this._header.add_child(this._entry);
    this._header.add_child(this._closeButton);
    this._scroll = new St.ScrollView({ overlay_scrollbars: false, style_class: 'winpick-scroll' });
    this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this._list = new St.BoxLayout({ vertical: true, style_class: 'winpick-list' });
    this._scroll.add_child(this._list);
    this._actor.add_child(this._header);
    this._actor.add_child(this._scroll);

    this._events = [];
    this._modalActive = false;
    this._moveOverlay = null;
    this._moveModalActive = false;
    this._workspaceSignals = [];
    this._suppressRowActivate = false;
    this._selectionIndex = 0;

    this._windows = [];
    this._filtered = [];
  }

  open() {
    this._windows = listWindows();
    this._filtered = this._windows;
    this._selectionIndex = 0;
    this._rebuildList();

    Main.layoutManager.addChrome(this._actor);
    this._actor.width = 720;
    this._actor.height = 480;
    // Position centered on the active monitor (focused window or pointer)
    const monitors = Main.layoutManager.monitors;
    const focused = global.display.get_focus_window();
    let targetMonitor = null;
    if (focused) {
      try {
        const mi = focused.get_monitor();
        if (mi >= 0 && mi < monitors.length)
          targetMonitor = monitors[mi];
      } catch (_e) {}
    }
    if (!targetMonitor) {
      try {
        const [px, py] = global.get_pointer();
        targetMonitor = monitors.find(m => px >= m.x && px < m.x + m.width && py >= m.y && py < m.y + m.height) || Main.layoutManager.primaryMonitor;
      } catch (_e) {
        targetMonitor = Main.layoutManager.primaryMonitor;
      }
    }
    const mx = targetMonitor.x + Math.round((targetMonitor.width - this._actor.width) / 2);
    const my = targetMonitor.y + Math.round((targetMonitor.height - this._actor.height) / 2);
    this._actor.set_position(mx, my);
    Main.pushModal(this._actor);
    this._modalActive = true;
    this._entry.grab_key_focus();

    this._connect(this._entry.clutter_text, 'text-changed', () => this._onFilter());
    // Ensure ESC is caught even when the entry has focus
    this._connect(this._entry.clutter_text, 'key-press-event', (_a, ev) => this._onKey(ev));
    this._connect(global.stage, 'captured-event', (_a, ev) => {
      if (ev.type() !== Clutter.EventType.KEY_PRESS)
        return Clutter.EVENT_PROPAGATE;
      return this._onKey(ev);
    });
    this._connect(this._actor, 'key-press-event', (_a, ev) => this._onKey(ev));
    this._connect(this._closeButton, 'clicked', () => this.close());

    this._setupWorkspaceMonitors();
  }

  close() {
    this._closeMoveDialog();
    if (this._modalActive) {
      try { Main.popModal(this._actor); } catch (e) { log(`winpick: pop modal failed: ${e}`); }
      this._modalActive = false;
    }
    this._disconnectAll();
    this._disconnectWorkspaceSignals();
    if (this._actor) {
      try { Main.layoutManager.removeChrome(this._actor); } catch (_e) {}
      try { this._actor.destroy(); } catch (_e) {}
      this._actor = null;
      this._header = null;
      this._entry = null;
      this._closeButton = null;
      this._scroll = null;
      this._list = null;
    }
  }

  _rebuildList() {
    this._list.destroy_all_children();
    this._suppressRowActivate = false;
    const count = this._filtered.length;
    if (count === 0)
      this._selectionIndex = 0;
    else
      this._selectionIndex = Math.max(0, Math.min(this._selectionIndex, count - 1));
    this._selected = null;
    this._filtered.forEach((w, idx) => {
      const row = new St.Button({ style_class: 'winpick-row', reactive: true });
      const hb = new St.BoxLayout({ vertical: false, style_class: 'winpick-row-content', x_expand: true });
      const iconActor = w.icon ? w.icon.create_icon_texture(24) : new St.Icon({ icon_name: 'application-x-executable-symbolic', icon_size: 24 });
      const iconBin = new St.Bin({ style_class: 'winpick-icon' });
      iconBin.set_child(iconActor);
      const title = new St.Label({
        text: w.title,
        style_class: 'winpick-title',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.START,
      });
      title.clutter_text.set_line_alignment(Pango.Alignment.LEFT);
      title.clutter_text.set_justify(false);
      const actions = new St.BoxLayout({ vertical: false, style_class: 'winpick-row-actions', x_align: Clutter.ActorAlign.END });
      const closeBtn = this._makeInlineButton('window-close-symbolic', 'Close window');
      closeBtn.connect('clicked', () => {
        this._suppressRowActivate = true;
        this._closeWindow(w.id);
      });
      const moveBtn = this._makeInlineButton('go-top-symbolic', 'Move window');
      moveBtn.connect('clicked', () => {
        this._suppressRowActivate = true;
        this._openMoveDialog(w);
      });
      actions.add_child(closeBtn);
      actions.add_child(moveBtn);
      row.add_style_class_name(idx % 2 === 0 ? 'even' : 'odd');
      hb.add_child(iconBin);
      hb.add_child(title);
      hb.add_child(actions);
      row.add_child(hb);
      row.connect('clicked', () => {
        if (this._suppressRowActivate) {
          this._suppressRowActivate = false;
          return;
        }
        this._activate(w.id);
      });
      this._list.add_child(row);
      if (idx === this._selectionIndex) {
        row.add_style_pseudo_class('selected');
        this._selected = row;
      }
    });
    this._ensureSelectionVisible();
  }

  _connect(obj, signal, cb) {
    const id = obj.connect(signal, cb);
    this._events.push([obj, id]);
  }

  _disconnectAll() {
    this._events.forEach(([obj, id]) => { try { obj.disconnect(id); } catch (_e) {} });
    this._events = [];
  }

  _onFilter() {
    const q = this._entry.get_text().trim();
    this._selectionIndex = 0;
    if (!q) {
      this._filtered = this._windows;
    } else {
      this._filtered = this._windows
        .map(w => ({ w, s: Math.max(
          fuzzyScore(q, w.title),
          fuzzyScore(q, w.app),
        )}))
        .filter(o => o.s > 0)
        .sort((a,b) => b.s - a.s)
        .map(o => o.w);
    }
    this._rebuildList();
  }

  _onKey(ev) {
    const sym = ev.get_key_symbol();
    if (sym === Clutter.KEY_F5) {
      this._refreshWindows();
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Up) {
      this._moveSelection(-1);
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Down) {
      this._moveSelection(1);
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Page_Up) {
      this._moveSelection(Number.NEGATIVE_INFINITY);
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Page_Down) {
      this._moveSelection(Number.POSITIVE_INFINITY);
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Home) {
      this._moveSelection('home');
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_End) {
      this._moveSelection('end');
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Escape && this._moveOverlay) {
      this._closeMoveDialog();
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Escape) {
      this.close(); return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
      if (this._filtered.length > 0 && this._selectionIndex >= 0 && this._selectionIndex < this._filtered.length) {
        this._activate(this._filtered[this._selectionIndex].id);
      }
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  _activate(id) {
    const mw = global.get_window_actors().map(w => w.meta_window).find(m => m.get_id() === id);
    if (mw) {
      mw.activate(global.display.get_current_time_roundtrip());
    }
    this.close();
  }

  _closeWindow(id) {
    const mw = this._findMetaWindow(id);
    if (!mw)
      return;
    try {
      mw.delete(global.display.get_current_time_roundtrip());
    } catch (_e) {}
    this._refreshWindows();
  }

  _openMoveDialog(windowInfo) {
    this._closeMoveDialog();

    const overlay = new St.Widget({
      style_class: 'winpick-move-overlay',
      reactive: true,
      can_focus: true,
      layout_manager: new Clutter.BinLayout(),
    });
    overlay.set_size(global.stage.width, global.stage.height);
    overlay.set_position(0, 0);
    const dialog = new St.BoxLayout({ vertical: true, style_class: 'winpick-move-dialog' });

    const header = new St.BoxLayout({ vertical: false, style_class: 'winpick-move-header' });
    const title = new St.Label({ text: `Move "${windowInfo.title}"`, style_class: 'winpick-move-title', x_expand: true });
    const closeBtn = this._makeInlineButton('window-close-symbolic', 'Close move dialog');
    closeBtn.add_style_class_name('winpick-move-close');
    closeBtn.connect('clicked', () => this._closeMoveDialog());
    header.add_child(title);
    header.add_child(closeBtn);
    dialog.add_child(header);

    const monitors = Main.layoutManager.monitors;
    monitors.forEach((monitor, idx) => {
      const row = new St.BoxLayout({ vertical: true, style_class: 'winpick-move-row' });
      const label = new St.Label({
        text: `Monitor ${idx + 1}  (${monitor.width}×${monitor.height})`,
        style_class: 'winpick-move-monitor',
      });
      row.add_child(label);
      row.add_child(this._buildMonitorGrid(windowInfo, idx, monitor));
      dialog.add_child(row);
    });

    const footer = new St.BoxLayout({ vertical: false, style_class: 'winpick-move-footer' });
    footer.x_expand = true;
    const cancelBtn = this._makeMoveOption('Cancel', () => this._closeMoveDialog(), true);
    cancelBtn.x_align = Clutter.ActorAlign.END;
    cancelBtn.x_expand = true;
    footer.add_child(cancelBtn);
    dialog.add_child(footer);

    overlay.add_child(dialog);
    overlay.connect('button-press-event', (actor, event) => {
      if (event.get_source() !== overlay)
        return Clutter.EVENT_PROPAGATE;
      this._closeMoveDialog();
      return Clutter.EVENT_STOP;
    });
    dialog.connect('button-press-event', () => Clutter.EVENT_STOP);
    overlay.connect('key-press-event', (_actor, event) => {
      if (event.get_key_symbol() === Clutter.KEY_Escape) {
        this._closeMoveDialog();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    Main.uiGroup.add_child(overlay);
    this._moveOverlay = overlay;
    Main.pushModal(overlay);
    this._moveModalActive = true;
    overlay.grab_key_focus();

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      if (!this._moveOverlay || !dialog || !dialog.get_parent())
        return GLib.SOURCE_REMOVE;
      this._positionMoveDialog(dialog);
      return GLib.SOURCE_REMOVE;
    });
  }

  _closeMoveDialog() {
    if (this._moveModalActive) {
      try { Main.popModal(this._moveOverlay); } catch (e) { log(`winpick: pop move modal failed: ${e}`); }
      this._moveModalActive = false;
    }
    if (this._moveOverlay) {
      try { this._moveOverlay.destroy(); } catch (_e) {}
      this._moveOverlay = null;
    }
  }

  _moveWindow(id, monitorIndex, placement) {
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

  _refreshWindows() {
    this._windows = listWindows();
    this._onFilter();
  }

  _findMetaWindow(id) {
    return global.get_window_actors()
      .map(w => w.meta_window)
      .find(m => m.get_id() === id);
  }

  _makeInlineButton(iconName, accessibleName) {
    const button = new St.Button({ style_class: 'winpick-inline-button', reactive: true, can_focus: true, accessible_name: accessibleName });
    button.set_child(new St.Icon({ icon_name: iconName, icon_size: 16 }));
    return button;
  }

  _makeMoveOption(label, handler, isSecondary = false) {
    const button = new St.Button({ label, style_class: isSecondary ? 'winpick-move-cancel' : 'winpick-move-option', can_focus: true, reactive: true });
    button.connect('clicked', handler);
    button.connect('button-press-event', () => Clutter.EVENT_STOP);
    return button;
  }

  _buildMonitorGrid(windowInfo, monitorIndex, monitor) {
    const aspect = monitor.width / Math.max(1, monitor.height);
    const baseHeight = 140;
    let width = Math.round(baseHeight * aspect);
    width = Math.min(380, Math.max(160, width));
    const height = baseHeight;

    const container = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      style_class: 'winpick-monitor-box',
    });
    container.set_size(width, height);

    const layout = new Clutter.GridLayout();
    layout.set_row_spacing(Math.round(height / 6));
    layout.set_column_spacing(Math.round(width / 6));
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
      text: String(monitorIndex + 1),
      style_class: 'winpick-monitor-index',
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    container.add_child(indexLabel);

    return container;
  }

  _positionMoveDialog(dialog) {
    if (!this._actor)
      return;
    let [anchorX, anchorY] = this._actor.get_transformed_position();
    const anchorWidth = this._actor.width;
    const anchorHeight = this._actor.height;
    const dialogWidth = dialog.width;
    const dialogHeight = dialog.height;

    let x = Math.round(anchorX + (anchorWidth - dialogWidth) / 2);
    let y = Math.round(anchorY + (anchorHeight - dialogHeight) / 2);

    const stageWidth = global.stage.width;
    const stageHeight = global.stage.height;
    x = Math.max(0, Math.min(x, stageWidth - dialogWidth));
    y = Math.max(0, Math.min(y, stageHeight - dialogHeight));

    dialog.set_position(x, y);
  }

  _moveSelection(delta) {
    if (this._filtered.length === 0)
      return;
    if (!this._list)
      return;
    let next;
    if (delta === 'home') {
      next = 0;
    } else if (delta === 'end') {
      next = this._filtered.length - 1;
    } else {
      let step = typeof delta === 'number' ? delta : 0;
      if (!Number.isFinite(step)) {
        const direction = step > 0 ? 1 : -1;
        step = direction * this._estimatePageSize();
      }
      next = Math.max(0, Math.min(this._selectionIndex + step, this._filtered.length - 1));
    }
    if (next === this._selectionIndex)
      return;
    const previousRow = this._list.get_child_at_index(this._selectionIndex);
    if (previousRow)
      previousRow.remove_style_pseudo_class('selected');
    this._selectionIndex = next;
    const nextRow = this._list.get_child_at_index(this._selectionIndex);
    if (nextRow) {
      nextRow.add_style_pseudo_class('selected');
      this._selected = nextRow;
      this._ensureSelectionVisible();
    }
  }

  _ensureSelectionVisible() {
    if (!this._selected || !this._scroll)
      return;
    try {
      if (typeof this._scroll.scroll_child_to_visible === 'function')
        this._scroll.scroll_child_to_visible(this._selected);
    } catch (_e) {}
  }

  _estimatePageSize() {
    if (!this._scroll || this._scroll.height <= 0)
      return Math.min(5, Math.max(1, this._filtered.length));
    const itemHeight = 48; // approximate row height incl. spacing
    return Math.max(1, Math.min(this._filtered.length, Math.round(this._scroll.height / itemHeight)));
  }

  _setupWorkspaceMonitors() {
    this._disconnectWorkspaceSignals();
    const workspaceManager = global.workspace_manager;
    for (let i = 0; i < workspaceManager.n_workspaces; i++) {
      const ws = workspaceManager.get_workspace_by_index(i);
      if (ws)
        this._watchWorkspace(ws);
    }
    this._connect(workspaceManager, 'workspace-added', (_mgr, index) => {
      const ws = workspaceManager.get_workspace_by_index(index);
      if (ws)
        this._watchWorkspace(ws);
      this._refreshWindows();
    });
    this._connect(workspaceManager, 'workspace-removed', () => this._refreshWindows());
  }

  _watchWorkspace(workspace) {
    const addedId = workspace.connect('window-added', () => this._refreshWindows());
    const removedId = workspace.connect('window-removed', () => this._refreshWindows());
    this._workspaceSignals.push([workspace, addedId], [workspace, removedId]);
  }

  _disconnectWorkspaceSignals() {
    this._workspaceSignals.forEach(([obj, id]) => {
      try { obj.disconnect(id); } catch (_e) {}
    });
    this._workspaceSignals = [];
  }
}

class WindowPickerExtensionLegacy {
  constructor() {
    this._ui = null;
  }

  _showPopup() {
    if (this._ui) {
      try { this._ui.close(); } catch (_e) {}
      this._ui = null;
    }
    this._ui = new WinpickUI();
    this._ui.open();
  }

  enable() {
    // D-Bus: expose Show()
    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(IFACE_XML);
    const ifaceInfo = nodeInfo.interfaces[0];
    const impl = { Show: () => this._showPopup() };
    const exported = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, impl);
    _exported = exported;

    _ownId = Gio.DBus.own_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameOwnerFlags.DO_NOT_QUEUE,
      connection => { _exported.export(connection, OBJ_PATH); },
      null, null
    );
  }

  disable() {
    if (this._ui) { try { this._ui.close(); } catch (_e) {} this._ui = null; }
    if (_exported) { _exported.unexport(); _exported = null; }
    if (_ownId) { Gio.DBus.unown_name(_ownId); _ownId = 0; }
  }
}

export default class WindowPickerExtension extends Extension {
  enable() {
    this._impl = new WindowPickerExtensionLegacy();
    // Provide path/dir to legacy instance for stylesheet resolution
    this._impl.path = this.path;
    this._impl.dir = this.dir;
    this._impl.enable();

    // Register configurable keybinding via GSettings schema
    this._settings = this.getSettings();
    try {
      Main.wm.addKeybinding(
        'show',
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.ALL,
        () => this._impl._showPopup()
      );
    } catch (e) {
      log(`window-switcher-popup: failed to add keybinding: ${e}`);
    }
  }

  disable() {
    try { Main.wm.removeKeybinding('show'); } catch (_e) {}
    this._settings = null;
    if (this._impl) {
      this._impl.disable();
      this._impl = null;
    }
  }
}
