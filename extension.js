
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import {
  MOVE_PLACEMENTS,
  closeMoveDialog,
  moveWindow,
  buildMonitorGrid,
  positionMovePopup,
  makeMoveOption
} from './window-movement.js';
import {
  fuzzyScore,
  listWindows,
  shouldIgnoreWindow,
  getWindowGroupKey,
  getWindowPinKey,
  applyGroupFilter,
  sortPinnedFirst
} from './window-list.js';
import {
  makeInlineButton,
  updateRowSelectionState,
  estimatePageSize,
  ensureSelectionVisible
} from './ui.js';
import {
  loadDevDirs,
  getDevDirItems,
  launchDevDir
} from './devdir.js';

const BUS_NAME  = 'ca.richyoung.WindowPicker';
const OBJ_PATH  = '/ca/richyoung/WindowPicker';
const IFACE     = 'ca.richyoung.WindowPicker';

const IFACE_XML = `
<node>
  <interface name="${IFACE}">
    <method name="Show"/>
    <method name="ShowDevDir"/>
  </interface>
</node>`;

let _ownId = 0;
let _exported = null;

class WinpickUI {
  constructor(options = {}) {
    this._showAppBar = options.showAppBar !== false;
    this._enableMovePopover = options.enableMovePopover !== false;
    this._settings = options.settings || null;
    this._pinnedKeys = this._loadPinnedKeys();
    this._groupFilter = null;

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
    if (this._showAppBar) {
      this._appBar = new St.BoxLayout({ vertical: false, style_class: 'winpick-appbar', x_expand: true });
      this._actor.add_child(this._appBar);
    } else {
      this._appBar = null;
    }
    this._actor.add_child(this._scroll);

    this._events = [];
    this._modalActive = false;
    this._movePopup = null;
    this._moveStageSignals = [];
    this._moveAnchorActor = null;
    this._moveModalActive = false;
    this._workspaceSignals = [];
    this._suppressRowActivate = false;
    this._selectionIndex = 0;
    this._groupFilter = null;
    this._highlightWindow = null;
    this._highlightActor = null;
    this._highlightSignals = [];
    this._highlightTimeout = 0;

    this._windows = [];
    this._filtered = [];
  }

  open() {
    this._windows = listWindows();
    this._filtered = this._sortWindows(this._windows);
    this._groupFilter = null;
    this._selectionIndex = 0;
    this._rebuildList();
    this._rebuildAppBar();

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
      const pinKey = getWindowPinKey(w);
      const isPinned = this._isPinned(w);
      const pinBtn = makeInlineButton(isPinned ? 'starred-symbolic' : 'non-starred-symbolic', isPinned ? 'Unpin window' : 'Pin window');
      pinBtn.add_style_class_name('winpick-pin-button');
      if (isPinned) {
        row.add_style_class_name('winpick-row-pinned');
        pinBtn.add_style_class_name('pinned');
      }
      pinBtn.connect('clicked', () => {
        this._suppressRowActivate = true;
        this._togglePin(pinKey);
      });
      const closeBtn = makeInlineButton('window-close-symbolic', 'Close window');
      closeBtn.connect('clicked', () => {
        this._suppressRowActivate = true;
        this._closeWindow(w.id);
      });
      actions.add_child(pinBtn);
      actions.add_child(closeBtn);
      if (this._enableMovePopover) {
        const moveBtn = makeInlineButton('go-top-symbolic', 'Move window');
        moveBtn.connect('clicked', () => {
          this._suppressRowActivate = true;
          this._openMoveDialog(w, moveBtn);
        });
        actions.add_child(moveBtn);
      }
      row.add_style_class_name(idx % 2 === 0 ? 'even' : 'odd');
      hb.add_child(iconBin);
      hb.add_child(title);
      hb.add_child(actions);
      row.add_child(hb);
      row._windowId = w.id;
      row.connect('clicked', () => {
        if (this._suppressRowActivate) {
          this._suppressRowActivate = false;
          return;
        }
        this._activate(w.id);
      });
      row.connect('button-press-event', (_actor, event) => {
        if (event.get_button && event.get_button() === Clutter.BUTTON_SECONDARY) {
          this._setSelection(idx);
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
      this._list.add_child(row);
      updateRowSelectionState(row, idx === this._selectionIndex);
    });
    ensureSelectionVisible(this._scroll, this._selected);
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
      this._filtered = this._sortWindows(applyGroupFilter(this._windows, this._groupFilter));
    } else {
      this._filtered = this._sortWindows(applyGroupFilter(this._windows, this._groupFilter)
        .map(w => ({ w, s: Math.max(
          fuzzyScore(q, w.title),
          fuzzyScore(q, w.app),
          fuzzyScore(q, w.appId),
          fuzzyScore(q, w.wmClass)
        ) }))
        .filter(w => w.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(w => w.w));
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
    if (sym === Clutter.KEY_Escape && this._movePopup) {
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

  _openMoveDialog(windowInfo, anchorActor) {
    if (!this._enableMovePopover)
      return;

    this._closeMoveDialog();
    this._moveAnchorActor = anchorActor || null;
    const popup = new St.BoxLayout({
      vertical: true,
      style_class: 'winpick-move-popup winpick-move-dialog',
      reactive: true,
      can_focus: true,
    });

    const header = new St.BoxLayout({ vertical: false, style_class: 'winpick-move-header' });
    const title = new St.Label({ text: `Move "${windowInfo.title}"`, style_class: 'winpick-move-title', x_expand: true });
    const closeBtn = this._makeInlineButton('window-close-symbolic', 'Close move dialog');
    closeBtn.add_style_class_name('winpick-move-close');
    closeBtn.connect('clicked', () => this._closeMoveDialog());
    header.add_child(title);
    header.add_child(closeBtn);
    popup.add_child(header);

    const monitors = Main.layoutManager.monitors;
    monitors.forEach((monitor, idx) => {
      const row = new St.BoxLayout({ vertical: true, style_class: 'winpick-move-row' });
      const label = new St.Label({
        text: `Monitor ${idx + 1}  (${monitor.width}×${monitor.height})`,
        style_class: 'winpick-move-monitor',
      });
      row.add_child(label);
      row.add_child(this._buildMonitorGrid(windowInfo, idx, monitor));
      popup.add_child(row);
    });

    const footer = new St.BoxLayout({ vertical: false, style_class: 'winpick-move-footer' });
    footer.x_expand = true;
    const cancelBtn = this._makeMoveOption('Cancel', () => this._closeMoveDialog(), true);
    cancelBtn.x_align = Clutter.ActorAlign.END;
    cancelBtn.x_expand = true;
    footer.add_child(cancelBtn);
    popup.add_child(footer);

    popup.connect('button-press-event', () => Clutter.EVENT_PROPAGATE);
    popup.connect('key-press-event', (_actor, event) => {
      if (event.get_key_symbol() === Clutter.KEY_Escape) {
        this._closeMoveDialog();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    Main.uiGroup.add_child(popup);
    this._movePopup = popup;

    const stagePressId = global.stage.connect('button-press-event', (_actor, event) => {
      if (!this._movePopup)
        return Clutter.EVENT_PROPAGATE;
      const source = event.get_source();
      if (this._isActorWithinMovePopup(source))
        return Clutter.EVENT_PROPAGATE;
      this._closeMoveDialog();
      return Clutter.EVENT_PROPAGATE;
    });
    this._moveStageSignals.push([global.stage, stagePressId]);

    const stageClickId = global.stage.connect('button-press-event', (_actor, event) => {
      if (!this._moveModalActive && !this._movePopup)
        return Clutter.EVENT_PROPAGATE;
      // Always close on outside click
      const source = event.get_source();
      if (this._isActorWithinMovePopup(source))
        return Clutter.EVENT_PROPAGATE;
      this.close();
      return Clutter.EVENT_PROPAGATE;
    });
    this._moveStageSignals.push([global.stage, stageClickId]);

    Main.pushModal(popup);
    this._moveModalActive = true;

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      if (!this._movePopup || !popup.get_parent())
        return GLib.SOURCE_REMOVE;
      this._positionMovePopup(popup);
      popup.grab_key_focus();
      return GLib.SOURCE_REMOVE;
    });
  }

  _closeMoveDialog() {
    closeMoveDialog.call(this);
  }

  _moveWindow(id, monitorIndex, placement) {
    moveWindow.call(this, id, monitorIndex, placement);
  }

  _refreshWindows() {
    this._windows = listWindows();
    this._onFilter();
  }

  _loadPinnedKeys() {
    if (!this._settings)
      return new Set();
    try {
      return new Set(this._settings.get_strv('pinned-windows'));
    } catch (_e) {
      return new Set();
    }
  }

  _savePinnedKeys() {
    if (!this._settings)
      return;
    try {
      this._settings.set_strv('pinned-windows', Array.from(this._pinnedKeys));
    } catch (e) {
      log(`window-switcher-popup: failed to save pinned windows: ${e}`);
    }
  }

  _isPinned(windowInfo) {
    return this._pinnedKeys.has(getWindowPinKey(windowInfo));
  }

  _sortWindows(windows) {
    return sortPinnedFirst(windows, this._pinnedKeys);
  }

  _togglePin(pinKey) {
    if (this._pinnedKeys.has(pinKey))
      this._pinnedKeys.delete(pinKey);
    else
      this._pinnedKeys.add(pinKey);
    this._savePinnedKeys();
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
    return makeMoveOption.call(this, label, handler, isSecondary);
  }

_buildMonitorGrid(windowInfo, monitorIndex, monitor) {
    return buildMonitorGrid.call(this, windowInfo, monitorIndex, monitor);
  }

  _positionMovePopup(popup) {
    positionMovePopup.call(this, popup);
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
        step = direction * estimatePageSize();
      }
      next = Math.max(0, Math.min(this._selectionIndex + step, this._filtered.length - 1));
    }
    this._setSelection(next);
  }

  _ensureSelectionVisible() {
    ensureSelectionVisible(this._scroll, this._selected);
  }

  _updateRowSelectionState(row, isSelected) {
    if (!row)
      return;
    if (isSelected) {
      row.add_style_pseudo_class('selected');
      if (row._windowId && this._isWindowVisible(row._windowId))
        row.add_style_class_name('winpick-row-selected-visible');
      else
        row.remove_style_class_name('winpick-row-selected-visible');
      this._selected = row;
    } else {
      row.remove_style_pseudo_class('selected');
      row.remove_style_class_name('winpick-row-selected-visible');
      if (this._selected === row)
        this._selected = null;
    }
  }

  _isWindowVisible(id) {
    const mw = this._findMetaWindow(id);
    if (!mw)
      return false;
    if (!mw.showing_on_its_workspace())
      return false;
    const workspace = mw.get_workspace();
    const activeWorkspace = global.workspace_manager.get_active_workspace();
    if (workspace && workspace !== activeWorkspace && !mw.is_on_all_workspaces())
      return false;
    return true;
  }

  _isActorWithinMovePopup(actor) {
    let current = actor;
    while (current) {
      if (current === this._movePopup || current === this._moveAnchorActor)
        return true;
      if (!current.get_parent)
        break;
      current = current.get_parent();
    }
    return false;
  }

  _estimatePageSize() {
    if (!this._scroll || this._scroll.height <= 0)
      return Math.min(5, Math.max(1, this._filtered.length));
    const itemHeight = 48; // approximate row height incl. spacing
    return Math.max(1, Math.min(this._filtered.length, Math.round(this._scroll.height / itemHeight)));
  }

  _setSelection(index) {
    if (this._filtered.length === 0 || !this._list)
      return;
    const next = Math.max(0, Math.min(index, this._filtered.length - 1));
    if (next === this._selectionIndex && this._selected)
      return;
    const previousRow = this._list.get_child_at_index(this._selectionIndex);
    if (previousRow)
      this._updateRowSelectionState(previousRow, false);
    this._selectionIndex = next;
    const nextRow = this._list.get_child_at_index(this._selectionIndex);
    if (nextRow) {
      this._updateRowSelectionState(nextRow, true);
      this._ensureSelectionVisible();
    } else {
      this._selected = null;
    }
  }

  _toggleFilter(appId) {
    if (this._groupFilter === appId)
      this._groupFilter = null;
    else
      this._groupFilter = appId;
    this._selectionIndex = 0;
    this._onFilter();
  }

  _applyWindowHighlight(_id) {
    // Highlight temporarily disabled; keep API to avoid runtime errors
  }

  _clearWindowHighlight() {
    this._highlightWindow = null;
    this._highlightActor = null;
    this._highlightSignals = [];
    this._highlightTimeout = 0;
  }

  _syncWindowHighlight() {
    // no-op placeholder
  }

  _applyGroupFilter(list) {
    return applyGroupFilter(list, this._groupFilter);
  }

  _rebuildAppBar() {
    if (!this._showAppBar || !this._appBar)
      return;
    this._appBar.destroy_all_children();
    const counts = new Map();
    this._windows.forEach(w => {
      const key = getWindowGroupKey(w) || 'unknown';
      const entry = counts.get(key) || { count: 0, icon: w.icon, app: w.app || key, appId: w.appId, key };
      entry.count += 1;
      counts.set(key, entry);
    });
    const items = Array.from(counts.values())
      .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app));
    items.forEach(item => {
      const btn = new St.Button({ style_class: 'winpick-appbutton', reactive: true, can_focus: true });
      const inner = new St.BoxLayout({ vertical: false, style_class: 'winpick-appbutton-inner' });
      const icon = item.icon ? item.icon.create_icon_texture(20) : new St.Icon({ icon_name: 'application-x-executable-symbolic', icon_size: 20 });
      const badge = new St.Label({
        text: String(item.count),
        style_class: 'winpick-appbutton-badge',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      badge.clutter_text.set_single_line_mode(true);
      badge.clutter_text.set_line_wrap(false);
      inner.add_child(icon);
      inner.add_child(badge);
      btn.set_child(inner);
      if (this._groupFilter === item.key)
        btn.add_style_pseudo_class('selected');
      btn.connect('clicked', () => this._toggleFilter(item.key));
      // btn.set_tooltip_text(item.app || item.appId || ''); // Removed due to missing method
      this._appBar.add_child(btn);
    });
    const clearBtn = new St.Button({ label: 'Clear', style_class: 'winpick-appbutton-clear', reactive: true, can_focus: true });
    clearBtn.connect('clicked', () => this._toggleFilter(null));
    this._appBar.add_child(clearBtn);
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
  constructor(settings = null) {
    this._ui = null;
    this._settings = settings;
  }

  _showPopup() {
    if (this._ui) {
      try { this._ui.close(); } catch (_e) {}
      this._ui = null;
    }
    const showAppBar = this._settings ?
      this._settings.get_boolean('show-app-bar') : true;
    const enableMovePopover = this._settings ?
      this._settings.get_boolean('enable-move-popover') : true;
    this._ui = new WinpickUI({ showAppBar, enableMovePopover, settings: this._settings });
    this._ui.open();
  }

  _showDevDir() {
    // Show development directories in the window switcher
    // This would integrate devdir items with the window list
    this._showPopup();
  }

  enable() {
    // D-Bus: expose Show() and ShowDevDir()
    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(IFACE_XML);
    const ifaceInfo = nodeInfo.interfaces[0];
    const impl = { 
      Show: () => this._showPopup(),
      ShowDevDir: () => this._showDevDir()
    };
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
    this._settings = this.getSettings();
    this._impl = new WindowPickerExtensionLegacy(this._settings);
    // Provide path/dir to legacy instance for stylesheet resolution
    this._impl.path = this.path;
    this._impl.dir = this.dir;
    this._impl.enable();

    // Register configurable keybinding via GSettings schema
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
