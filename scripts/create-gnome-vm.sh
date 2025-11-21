#!/usr/bin/env bash
set -euo pipefail

VM_NAME="gnome-extension-dev"
RAM_MB=4096
CPUS=2
DISK_GB=30
ISO_PATH="${ISO_PATH:-}"  # Provide GNOME OS / Fedora ISO via env or arg
SHARE_DIR="${HOME}/gnome-extension-share"

usage() {
  cat <<EOF
Usage: ISO_PATH=/path/to/gnome.iso $0

Creates a GNOME test VM (virt-install) and sets up a VirtIO 9p shared folder
mounted at ~/gnome-extension-share on the host.

After installation, add this to the guest’s /etc/fstab or manually mount:

  sudo mkdir -p /mnt/host-share
  sudo mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host-share

Copy extensions from the host into ${SHARE_DIR}, then inside the guest:

  cp -r /mnt/host-share/window-switcher-popup@ai.richyoung.ca ~/.local/share/gnome-shell/extensions/

EOF
}

if [[ -z "${ISO_PATH}" ]]; then
  usage
  exit 1
fi

mkdir -p "${SHARE_DIR}"

virt-install \
  --name "${VM_NAME}" \
  --memory "${RAM_MB}" \
  --vcpus "${CPUS}" \
  --disk size="${DISK_GB}",backing_store="${ISO_PATH}",bus=virtio \
  --cdrom "${ISO_PATH}" \
  --graphics spice \
  --video virtio \
  --network network=default \
  --filesystem source="${SHARE_DIR}",target=hostshare,accessmode=squash \
  --os-variant detect=on \
  --boot uefi

echo "VM ${VM_NAME} created. Shared folder at ${SHARE_DIR}."
