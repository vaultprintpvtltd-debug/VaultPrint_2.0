#!/data/data/com.termux/files/usr/bin/bash
# ---------------------------------------------------------------------------
# VaultPrint kiosk box setup — Android (Termux) + HP LaserJet 1020
#
# Run INSIDE the Termux app (it needs Termux's network access), from the
# agent directory:   bash android/setup.sh
#
# Installs into ~/vaultprint:
#   bin/foo2zjs        HP ZjStream driver, built from Debian's foo2zjs source
#   bin/vp-usbprint    USB printer tool (this directory), used via su
#   firmware/hp_laserjet_1020.fw
#                      HP firmware from HP's signed HPLIP plugin. Proprietary:
#                      only extracted when VP_ACCEPT_HP_LICENSE=yes is set,
#                      after you have read HP's plugin licence. Never commit it.
#
# Idempotent: re-running skips finished steps. Nothing outside Termux's own
# directories is modified. Undo: rm -rf ~/vaultprint; pkg uninstall clang
# ---------------------------------------------------------------------------
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VP="$HOME/vaultprint"
WORK="$VP/build"
mkdir -p "$VP/bin" "$VP/firmware" "$WORK"

FOO_URL="https://deb.debian.org/debian/pool/main/f/foo2zjs/foo2zjs_20200505dfsg0.orig.tar.xz"
FOO_SHA256="87465e6a31f8501b90508d50e97901d2cce8b5b3de5418cc156e66d5c500421b"
HPLIP_URL="https://www.openprinting.org/download/printdriver/auxfiles/HP/plugins/hplip-3.26.6-plugin.run"
HPLIP_SHA256="bb830712bfacc4567e8714522f1359a749df344786256c8513ededf3e9455325"
FW_SHA256="9a6d03c858d9cf64ba86fdbe6cf0beec1297d2e45e606162b19f3857efae4ff4"

say() { printf '\n== %s\n' "$*"; }

fetch() { # url dest sha256
  if [ -f "$2" ] && echo "$3  $2" | sha256sum -c --status; then return 0; fi
  curl -fL --retry 3 -o "$2" "$1"
  echo "$3  $2" | sha256sum -c --status || { echo "checksum mismatch for $2"; rm -f "$2"; exit 1; }
}

say "Termux packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y -o Dpkg::Options::=--force-confold install clang ghostscript nodejs curl xz-utils

say "foo2zjs (HP LaserJet 1018/1020/1022 driver)"
if [ ! -x "$VP/bin/foo2zjs" ]; then
  fetch "$FOO_URL" "$WORK/foo2zjs.orig.tar.xz" "$FOO_SHA256"
  rm -rf "$WORK/foo2zjs-src" && mkdir -p "$WORK/foo2zjs-src"
  tar -xJf "$WORK/foo2zjs.orig.tar.xz" -C "$WORK/foo2zjs-src" --strip-components=1
  (cd "$WORK/foo2zjs-src" && clang -O2 -o "$VP/bin/foo2zjs" foo2zjs.c jbig.c jbig_ar.c)
fi
# foo2zjs -h prints usage and exits 1 — only check that it runs
"$VP/bin/foo2zjs" -h 2>&1 | head -1 || true

say "vp-usbprint (USB printer tool)"
clang -O2 -Wall -Wextra -o "$VP/bin/vp-usbprint" "$AGENT_DIR/android/vp-usbprint.c"
chmod 755 "$VP/bin/"*

say "HP LaserJet 1020 firmware"
if [ -f "$VP/firmware/hp_laserjet_1020.fw" ] && echo "$FW_SHA256  $VP/firmware/hp_laserjet_1020.fw" | sha256sum -c --status; then
  echo "already installed"
elif [ "${VP_ACCEPT_HP_LICENSE:-}" != "yes" ]; then
  echo "SKIPPED: the firmware comes from HP's proprietary HPLIP plugin."
  echo "Read HP's licence (license.txt in the plugin), then re-run with:"
  echo "  VP_ACCEPT_HP_LICENSE=yes bash android/setup.sh"
else
  fetch "$HPLIP_URL" "$WORK/hplip-plugin.run" "$HPLIP_SHA256"
  # Extract the makeself payload WITHOUT executing the installer script
  OFFSET=$(head -n 591 "$WORK/hplip-plugin.run" | wc -c)
  tail -c +$((OFFSET + 1)) "$WORK/hplip-plugin.run" | gzip -cd \
    | tar -xOf - ./hp_laserjet_1020.fw.gz | gzip -cd > "$VP/firmware/hp_laserjet_1020.fw"
  echo "$FW_SHA256  $VP/firmware/hp_laserjet_1020.fw" | sha256sum -c --status \
    || { echo "firmware checksum mismatch"; rm -f "$VP/firmware/hp_laserjet_1020.fw"; exit 1; }
  echo "installed"
fi

say "Print agent dependencies"
(cd "$AGENT_DIR" && npm install --omit=dev --no-audit --no-fund)

say "Root access for USB (expects uid=0)"
/system/bin/su -c id || echo "WARNING: su failed — the agent cannot reach the USB printer"

say "Done"
ls -l "$VP/bin" "$VP/firmware"
