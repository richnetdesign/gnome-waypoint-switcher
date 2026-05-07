import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Development directory enumeration functionality
// This module will handle reading recent development directories
// from VSCode, VSCodium, and Codex sessions

/**
 * Structure for development directory items
 */
export class DevDirItem {
  constructor(path, source, workspaceFile = null) {
    this.path = path;
    this.source = source;
    this.workspaceFile = workspaceFile;
    this.timestamp = Date.now(); // Default to current time
  }
}

/**
 * Development directory sources
 */
export const DevDirSource = {
  CODEX: 'codex',
  VSCODE: 'vscode',
  VSCODIUM: 'vscodium'
};

/**
 * Helper to get home directory
 */
function getHomeDir() {
  return GLib.get_home_dir();
}

/**
 * Helper to join paths
 */
function joinPath(...parts) {
  return parts.join('/');
}

/**
 * Helper to expand ~ in paths
 */
function expandHome(path) {
  if (path.startsWith('~/')) {
    return joinPath(getHomeDir(), path.substring(2));
  }
  return path;
}

/**
 * Load development directories from various sources
 * This implements a simplified approach for GNOME Shell extensions
 */
export function loadDevDirs() {
  let items = [];
  
  // Read VSCode recent files (simplified - would require actual SQLite parsing in full implementation)
  const vscodeDb = joinPath(getHomeDir(), '.config', 'Code', 'User', 'globalStorage', 'state.vscdb');
  items = items.concat(readVscodeRecent(vscodeDb, DevDirSource.VSCODE));
  
  // Read VSCodium recent files (simplified)
  const vscodiumDb = joinPath(getHomeDir(), '.config', 'VSCodium', 'User', 'globalStorage', 'state.vscdb');
  items = items.concat(readVscodeRecent(vscodiumDb, DevDirSource.VSCODIUM));
  
  // Read Codex sessions (simplified)
  items = items.concat(readCodexSessions());
  
  // Sort by timestamp (newest first)
  items.sort((a, b) => b.timestamp - a.timestamp);
  
  // Remove duplicates based on path
  const seen = new Set();
  const uniqueItems = [];
  for (const item of items) {
    if (!seen.has(item.path)) {
      seen.add(item.path);
      uniqueItems.push(item);
    }
  }
  
  return uniqueItems;
}

/**
 * Read VSCode/VSCodium recent files - placeholder implementation
 * Note: Actual SQLite reading requires more complex implementation
 * that works with GNOME Shell's Gio database bindings
 */
function readVscodeRecent(dbPath, source) {
  const items = [];
  
  if (!GLib.file_test(dbPath, GLib.FileTest.EXISTS)) {
    return items;
  }
  
  try {
    // In a complete implementation, this would:
    // 1. Open the SQLite database using Gio
    // 2. Query the history.recentlyOpenedPathsList table
    // 3. Parse the JSON data to extract file paths and timestamps
    // 4. Handle workspace files and URI conversions
    
    // This is a simplified placeholder that would need actual database reading
    // to parse the real VSCode/VSCodium data
    
    log(`[devdir] VSCode database found at: ${dbPath}`);
    log(`[devdir] Would parse VSCode recent files from SQLite database`);
    
    // In a full implementation, this would return actual devdir items
    // For now, returning empty to avoid complexity
    return [];
  } catch (e) {
    log(`[devdir] Error reading VSCode database: ${e}`);
    return [];
  }
}

/**
 * Read Codex sessions from the session files - placeholder implementation
 */
function readCodexSessions() {
  const items = [];
  const codexPath = joinPath(getHomeDir(), '.codex', 'sessions');
  
  if (!GLib.file_test(codexPath, GLib.FileTest.EXISTS)) {
    return items;
  }
  
  try {
    // In a complete implementation, this would:
    // 1. Traverse the .codex/sessions directory structure
    // 2. Parse JSONL session files
    // 3. Extract development directories and timestamps
    
    log(`[devdir] Codex sessions directory found at: ${codexPath}`);
    log(`[devdir] Would parse Codex session files`);
    
    // This is a simplified placeholder - would parse actual Codex sessions
    return [];
  } catch (e) {
    log(`[devdir] Error reading Codex sessions: ${e}`);
    return [];
  }
}

/**
 * Get devdir items for display in the window switcher
 */
export async function getDevDirItems() {
  // This would return items that can be displayed in the window switcher UI
  // Each item would have a path, title, and potentially an icon
  const devDirs = loadDevDirs();
  
  // Return a simplified version for now, showing the structure
  return devDirs.map(item => ({
    path: item.path,
    title: item.path.split('/').pop() || item.path,
    source: item.source,
    icon: 'folder-symbolic'
  }));
}

/**
 * Launch a development directory
 */
export function launchDevDir(path) {
  // This would handle launching the development directory
  // Implementation would depend on the environment and tools available
  log(`Launching devdir: ${path}`);
  
  // In a real implementation, this would:
  // 1. Check if the directory exists
  // 2. Launch an appropriate editor (VSCode, VSCodium, etc.)
  // 3. Open the directory in that editor
  // 4. Handle any workspace files if applicable
  
  // For now, just log the action
  log(`[devdir] Would launch directory: ${path}`);
}