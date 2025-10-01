
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
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
    this._actor = new St.BoxLayout({ vertical: true, style_class: 'winpick-popup' });
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
    this._modal = null;
    this._moveOverlay = null;
    this._moveModal = null;

    this._windows = [];
    this._filtered = [];
  }

  open() {
    this._windows = listWindows();
    this._filtered = this._windows;
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
    this._modal = Main.pushModal(this._actor);
    this._entry.grab_key_focus();

    this._connect(this._entry.clutter_text, 'text-changed', () => this._onFilter());
    // Ensure ESC is caught even when the entry has focus
    this._connect(this._entry.clutter_text, 'key-press-event', (_a, ev) => this._onKey(ev));
    this._connect(global.stage, 'captured-event', (_a, ev) => {
      if (ev.type() !== Clutter.EventType.KEY_PRESS)
        return Clutter.EVENT_PROPAGATE;
      return this._onKey(ev);
    });
    this._connect(this._closeButton, 'clicked', () => this.close());
  }

  close() {
    if (this._modal) {
      Main.popModal(this._actor);
      this._modal = null;
    }
    this._closeMoveDialog();
    this._disconnectAll();
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
    this._filtered.forEach((w, idx) => {
      const row = new St.Button({ style_class: 'winpick-row', reactive: true });
      const hb = new St.BoxLayout({ vertical: false, style_class: 'winpick-row-content' });
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
      const actions = new St.BoxLayout({ vertical: false, style_class: 'winpick-row-actions' });
      const closeBtn = this._makeInlineButton('window-close-symbolic', 'Close window');
      closeBtn.connect('button-press-event', () => Clutter.EVENT_STOP);
      closeBtn.connect('clicked', () => this._closeWindow(w.id));
      const moveBtn = this._makeInlineButton('go-top-symbolic', 'Move window');
      moveBtn.connect('button-press-event', () => Clutter.EVENT_STOP);
      moveBtn.connect('clicked', () => this._openMoveDialog(w));
      actions.add_child(closeBtn);
      actions.add_child(moveBtn);
      row.add_style_class_name(idx % 2 === 0 ? 'even' : 'odd');
      hb.add_child(iconBin);
      hb.add_child(title);
      hb.add_child(actions);
      row.add_child(hb);
      row.connect('clicked', () => this._activate(w.id));
      this._list.add_child(row);
      if (idx === 0) this._selected = row;
    });
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
    if (sym === Clutter.KEY_Escape && this._moveOverlay) {
      this._closeMoveDialog();
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Escape) {
      this.close(); return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
      // activate first item
      if (this._filtered.length > 0) {
        this._activate(this._filtered[0].id);
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
      layout_manager: new Clutter.BinLayout(),
    });
    overlay.set_size(global.stage.width, global.stage.height);
    overlay.set_position(0, 0);
    const dialog = new St.BoxLayout({ vertical: true, style_class: 'winpick-move-dialog' });
    dialog.x_align = Clutter.ActorAlign.CENTER;
    dialog.y_align = Clutter.ActorAlign.CENTER;

    const title = new St.Label({ text: `Move "${windowInfo.title}"`, style_class: 'winpick-move-title' });
    dialog.add_child(title);

    const monitors = Main.layoutManager.monitors;
    monitors.forEach((monitor, idx) => {
      const row = new St.BoxLayout({ vertical: false, style_class: 'winpick-move-row' });
      const label = new St.Label({ text: `Monitor ${idx + 1}`, style_class: 'winpick-move-monitor' });
      row.add_child(label);

      const fullBtn = this._makeMoveOption('Maximize', () => this._moveWindow(windowInfo.id, idx, 'full'));
      const leftBtn = this._makeMoveOption('Left Half', () => this._moveWindow(windowInfo.id, idx, 'left'));
      const rightBtn = this._makeMoveOption('Right Half', () => this._moveWindow(windowInfo.id, idx, 'right'));

      row.add_child(fullBtn);
      row.add_child(leftBtn);
      row.add_child(rightBtn);
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

    Main.uiGroup.add_child(overlay);
    this._moveOverlay = overlay;
    this._moveModal = Main.pushModal(overlay);
  }

  _closeMoveDialog() {
    if (this._moveModal) {
      Main.popModal(this._moveOverlay);
      this._moveModal = null;
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

    if (placement === 'full') {
      mw.maximize(Meta.MaximizeFlags.BOTH);
    } else {
      const halfWidth = Math.round(monitor.width / 2);
      let x = monitor.x;
      const y = monitor.y;
      let width = halfWidth;
      const height = monitor.height;
      if (placement === 'right') {
        x += monitor.width - halfWidth;
      }
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
