
/* exported init enable disable */
const { Gio, GLib, Shell, St, Clutter } = imports.gi;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const BUS_NAME  = 'ca.richyoung.WindowPicker';
const OBJ_PATH  = '/ca/richyoung/WindowPicker';
const IFACE     = 'ca.richyoung.WindowPicker';

const IFACE_XML = `
<node>
  <interface name="${IFACE}">
    <method name="Show"/>
  </interface>
</node>`;

let _ownId = 0;
let _exported = null;
let _ui = null;

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
    return {
      id: m.get_id(),
      title: String(m.get_title() || ""),
      appId: app ? app.get_id() : "",
      app: app ? app.get_name() : (m.get_wm_class() || ""),
      icon: app || null,
    };
  });
}

class WinpickUI {
  constructor() {
    this._actor = new St.BoxLayout({ vertical: true, style_class: 'winpick-popup' });
    this._entry = new St.Entry({ style_class: 'winpick-entry', can_focus: true, hint_text: 'Filter windows…' });
    this._scroll = new St.ScrollView({ overlay_scrollbars: true });
    this._list = new St.BoxLayout({ vertical: true });
    this._scroll.add_actor(this._list);
    this._actor.add_child(this._entry);
    this._actor.add_child(this._scroll);

    this._events = [];
    this._modal = null;

    this._windows = [];
    this._filtered = [];
  }

  open() {
    this._windows = listWindows();
    this._filtered = this._windows;
    this._rebuildList();

    Main.uiGroup.add_child(this._actor);
    this._actor.width = 720;
    this._actor.height = 480;
    this._actor.set_position(
      Math.round((global.stage.width - this._actor.width)/2),
      Math.round(global.stage.height * 0.2));
    this._modal = Main.pushModal(this._actor);
    this._entry.grab_key_focus();

    this._events.push(this._entry.clutter_text.connect('text-changed', () => this._onFilter()));
    this._events.push(global.stage.connect('key-press-event', (_a, ev) => this._onKey(ev)));
  }

  close() {
    if (this._modal) {
      Main.popModal(this._actor);
      this._modal = null;
    }
    this._events.forEach(id => {
      try { global.stage.disconnect(id); } catch (e) {}
    });
    this._events = [];
    this._actor.destroy();
  }

  _rebuildList() {
    this._list.destroy_all_children();
    this._filtered.forEach((w, idx) => {
      const row = new St.Button({ style_class: 'winpick-row', reactive: true });
      const hb = new St.BoxLayout({ vertical: false });
      const icon = w.icon ? w.icon.create_icon_texture(24) : new St.Icon({ icon_name: 'application-x-executable-symbolic', icon_size: 24 });
      const title = new St.Label({ text: w.title, style_class: 'winpick-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
      hb.add_child(icon);
      hb.add_child(title);
      row.add_child(hb);
      row.connect('clicked', () => this._activate(w.id));
      this._list.add_child(row);
      if (idx === 0) this._selected = row;
    });
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
}

function showPopup() {
  if (_ui) {
    _ui.close();
    _ui = null;
  }
  _ui = new WinpickUI();
  _ui.open();
}

function enable() {
  // Load stylesheet
  Main.themeManager.add_theme_stylesheet(
    imports.misc.extensionUtils.getCurrentExtension().path + '/stylesheet.css'
  );

  // D-Bus: expose Show()
  const nodeInfo = Gio.DBusNodeInfo.new_for_xml(IFACE_XML);
  const ifaceInfo = nodeInfo.interfaces[0];
  const impl = { Show() { showPopup(); } };
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

function disable() {
  if (_ui) { try { _ui.close(); } catch (e) {} _ui = null; }
  if (_exported) { _exported.unexport(); _exported = null; }
  if (_ownId) { Gio.DBus.unown_name(_ownId); _ownId = 0; }
}

function init() {}
