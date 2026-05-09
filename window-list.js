import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Window filtering and listing functions

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

/**
 * Calculate a fuzzy score for matching window titles
 */
export function fuzzyScore(needle, hay) {
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

/**
 * List all windows, excluding ignored ones
 */
export function listWindows() {
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
      stableSequence: typeof m.get_stable_sequence === 'function' ? m.get_stable_sequence() : null,
      icon: app || null,
    };
    return shouldIgnoreWindow(info) ? null : info;
  }).filter(Boolean);
}

/**
 * Check if a window should be ignored
 */
export function shouldIgnoreWindow(info) {
  const title = info.title.toLowerCase();
  const appId = info.appId.toLowerCase();
  const wmClass = info.wmClass.toLowerCase();

  if (IGNORE_APP_IDS.has(appId))
    return true;
  if (IGNORE_WM_CLASSES.has(wmClass))
    return true;
  return IGNORE_TITLE_SUBSTRINGS.some(substr => title.includes(substr));
}

/**
 * Apply grouping filter to windows
 */
export function getWindowGroupKey(windowInfo) {
  return windowInfo.appId || windowInfo.wmClass || windowInfo.app || windowInfo.title;
}

export function getWindowPinKey(windowInfo) {
  const identity = `${windowInfo.appId || ''}|${windowInfo.wmClass || ''}`;
  if (windowInfo.stableSequence !== null && windowInfo.stableSequence !== undefined)
    return `seq:${windowInfo.stableSequence}:${identity}`;
  if (windowInfo.id !== null && windowInfo.id !== undefined)
    return `id:${windowInfo.id}:${identity}`;
  return `meta:${identity}|${windowInfo.title}`;
}

export function applyGroupFilter(windows, groupFilter = null) {
  if (!groupFilter)
    return windows;

  return windows.filter(w => getWindowGroupKey(w) === groupFilter);
}

export function sortPinnedFirst(windows, pinnedKeys) {
  if (!pinnedKeys || pinnedKeys.size === 0)
    return windows;

  return windows.slice().sort((a, b) => {
    const aPinned = pinnedKeys.has(getWindowPinKey(a));
    const bPinned = pinnedKeys.has(getWindowPinKey(b));
    if (aPinned === bPinned)
      return 0;
    return aPinned ? -1 : 1;
  });
}
