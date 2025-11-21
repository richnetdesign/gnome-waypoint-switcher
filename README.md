
# Window Switcher Popup (All-in-one, no wofi)

A GNOME Shell extension that shows a fuzzy window-title picker *inside* GNOME.
No unsafe mode, Wayland-safe. It exposes a simple D-Bus method `Show` so you can
bind it to a global keyboard shortcut (suggested: **Super+Y**).

## Install

Quick install (copies into your user extensions dir and enables):

```
./install.sh
```

Notes:
- On Wayland, log out/in for GNOME Shell to pick up changes.
- On Xorg, press Alt+F2, type `r`, then Enter to reload.

Manual install:
1. Copy this folder (`window-switcher-popup@ai.richyoung.ca`) to `~/.local/share/gnome-shell/extensions/`
2. Enable it:
   ```
   gnome-extensions enable window-switcher-popup@ai.richyoung.ca
   ```

## Use
Trigger the popup:
```
gdbus call --session --dest ca.richyoung.WindowPicker --object-path /ca/richyoung/WindowPicker --method ca.richyoung.WindowPicker.Show
```

### Built-in Shortcut (default: Super+Y)
The extension ships with a configurable shortcut using GSettings. Default binding is `Super+Y`.

- Change it via CLI:
  ```
  gsettings set org.gnome.shell.extensions.window-switcher-popup show "['<Super>Y']"
  ```
- Or use `dconf Editor` at:
  - `/org/gnome/shell/extensions/window-switcher-popup/show`

You can also create an additional custom shortcut via Settings if you prefer.

### Bind a Custom Shortcut (optional)
Open **Settings → Keyboard → Keyboard Shortcuts → Custom Shortcuts**:
- Name: Window Picker
- Command:
  ```
  gdbus call --session --dest ca.richyoung.WindowPicker --object-path /ca/richyoung/WindowPicker --method ca.richyoung.WindowPicker.Show
  ```
- Shortcut: press **Super+Y** (or any preferred free combo)

(We avoid shipping a compiled GSettings schema; using a custom shortcut is simpler and works everywhere.)

See `KEYBOARD_SHORTCUTS.md` for more details, alternatives, and CLI setup.

## Behavior
- Shows only **icon + window title**.
- Fuzzy matches by subsequence on title/app name.
- Enter activates the top result, Esc closes.
- F5 manually refreshes the list in case you need a quick re-sync.
- Arrow keys move the selection; Enter activates the highlighted window.
- Right-click a row to select it without activating; inline buttons close or move windows.
- Optional app bar groups windows by app; toggle via `show-app-bar` (GSettings).

## Implementation Notes
- Wayland-safe: uses GNOME Shell UI and D-Bus, no external windows.
- D-Bus name `ca.richyoung.WindowPicker` exposes `Show()` to trigger the popup.
- Follows GNOME extension best practices:
  - Stylesheet added/removed on enable/disable.
  - Signals tracked and disconnected safely on close.
  - UI attached via `Main.layoutManager.addChrome()`.

## Recover From a Stuck Modal
In the unlikely event the popup fails to close (e.g. the modal stack gets out of
sync), you can disable the extension via D-Bus and re-enable it afterward:

```
gdbus call --session \
  --dest org.gnome.Shell.Extensions \
  --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.DisableExtension \
  'window-switcher-popup@ai.richyoung.ca'
```

Once the session is responsive again, re-enable the extension:

```
gdbus call --session \
  --dest org.gnome.Shell.Extensions \
  --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.EnableExtension \
  'window-switcher-popup@ai.richyoung.ca'
```

Both commands are safe to run repeatedly; they simply instruct GNOME Shell to
toggle the extension state, cleaning up any lingering modal in the process.

## Dev Reload on Wayland
GNOME 45+ caches ES modules for the lifetime of the Shell process, so disabling/enabling won’t reload JS on Wayland. Use a dev UUID to hot‑load changes without logging out:

```
./dev-install.sh
```

What it does:
- Copies the extension with a unique dev UUID (timestamped) and updates `metadata.json`.
- Disables any enabled sibling variants to avoid D-Bus name conflicts.
- Enables the new dev variant so the updated JS is imported fresh.

Re-run after changes to create a new dev variant. On Xorg you can still use Alt+F2 → r.

## Test in a VM
For quick GNOME testing, a helper script provisions a UEFI virtual machine and mounts a host share via VirtIO 9p:

```
ISO_PATH=/path/to/gnome.iso ./scripts/create-gnome-vm.sh
```

What it does:
- Creates VM `gnome-extension-dev` with 4 GB RAM / 2 vCPUs.
- Uses the ISO you provide (GNOME OS Nightly, Fedora Workstation, etc.).
- Sets up `~/gnome-extension-share` on the host and exposes it as a VirtIO filesystem (`hostshare`) in the guest.

After the VM boots, mount the share inside the guest:

```
sudo mkdir -p /mnt/host-share
sudo mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host-share
```

From there, copy the extension across:

```
cp -r /mnt/host-share/window-switcher-popup@ai.richyoung.ca \ 
      ~/.local/share/gnome-shell/extensions/
gnome-extensions enable window-switcher-popup@ai.richyoung.ca
```

Reload GNOME Shell (Alt+F2 → `r` on Xorg, or log out/in on Wayland) after copying. Update the ISO path or VM resources in the script if you need a different environment.
