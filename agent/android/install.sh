#!/system/bin/sh
# ---------------------------------------------------------------------------
# VaultPrint kiosk installer — runs ON the Android box, as root.
#
# Normally started by the PC setup tool (kiosk-setup/), which first installs
# the Termux + Termux:Boot apps and copies this bundle to
# /data/local/tmp/vaultprint-setup/:
#
#   install.sh  config.env  agent/  prebuilt/
#
# config.env:  KIOSK_ID, KIOSK_API_KEY, KIOSK_API_BASE_URL, STAFF_PIN
#
# Safe to run again: updates the software, keeps state/ and logs/.
# Prints "STEP <n>/<total> <text>" progress lines and ends with
# "RESULT OK ..." or "RESULT FAIL <reason>" for the setup tool.
# ---------------------------------------------------------------------------

SRC=$(cd "$(dirname "$0")" && pwd)
PKG=/data/data/com.termux
PREFIX=$PKG/files/usr
HOME_T=$PKG/files/home
VP=$HOME_T/vaultprint
TOTAL=9

step() { echo "STEP $1/$TOTAL $2"; }
fail() { echo "RESULT FAIL $*"; exit 1; }

[ "$(id -u)" = "0" ] || fail "installer must run as root"
[ -f "$SRC/config.env" ] || fail "config.env missing"
. "$SRC/config.env"
# The bundle holds the kiosk's API key: never leave it in /data/local/tmp
case "$SRC" in /data/local/tmp/*) trap 'rm -rf "$SRC"' EXIT ;; esac
[ -n "$KIOSK_ID" ] && [ -n "$KIOSK_API_KEY" ] && [ -n "$KIOSK_API_BASE_URL" ] || fail "config.env incomplete"

# ── 1. Termux present and unpacked ───────────────────────────────────────
step 1 "Preparing Termux"
pm path com.termux >/dev/null 2>&1 || fail "Termux app is not installed"
pm path com.termux.boot >/dev/null 2>&1 || fail "Termux:Boot app is not installed"
TUID=$(stat -c %u $PKG)
if [ ! -x $PREFIX/bin/apt ]; then
  am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1
  i=0
  until [ -x $PREFIX/bin/apt ] || [ $i -ge 90 ]; do i=$((i + 1)); sleep 2; done
  [ -x $PREFIX/bin/apt ] || fail "Termux did not finish its first start (is the screen on?)"
  sleep 5
fi

# Run a command as the Termux user (Termux's apt refuses root)
as_termux() {
  su $TUID /system/bin/sh -c "export PREFIX=$PREFIX HOME=$HOME_T PATH=$PREFIX/bin LD_LIBRARY_PATH=$PREFIX/lib TMPDIR=$PREFIX/tmp DEBIAN_FRONTEND=noninteractive LANG=en_US.UTF-8; $*"
}

# ── 2. Packages: Node.js, Ghostscript, adb (boot helper) ─────────────────
step 2 "Installing Node.js and Ghostscript (a few minutes on first setup)"
NEED=""
[ -x $PREFIX/bin/node ] && as_termux "node --version" >/dev/null 2>&1 || NEED="$NEED nodejs-lts"
[ -x $PREFIX/bin/gs ] || NEED="$NEED ghostscript"
[ -x $PREFIX/bin/adb ] || NEED="$NEED android-tools"
if [ -n "$NEED" ]; then
  as_termux "apt-get update -q" >/dev/null 2>&1 || fail "no internet for package download (check the box's Wi-Fi)"
  # Full upgrade first: new packages need the current base libraries
  as_termux "apt-get -y -q -o Dpkg::Options::=--force-confnew dist-upgrade" >/dev/null 2>&1
  as_termux "apt-get -y -q -o Dpkg::Options::=--force-confnew install $NEED" >/dev/null 2>&1 || fail "package install failed:$NEED"
fi
as_termux "node --version" >/dev/null 2>&1 || fail "Node.js does not start"
as_termux "gs --version" >/dev/null 2>&1 || fail "Ghostscript does not start"

# ── 3. Agent software ────────────────────────────────────────────────────
step 3 "Copying the VaultPrint software"
mkdir -p $VP/agent $VP/bin
# Keep the box's own state, logs and temp files across updates
(cd "$SRC/agent" && $PREFIX/bin/tar cf - --exclude=./state --exclude=./logs --exclude=./temp --exclude=./.env .) | (cd $VP/agent && $PREFIX/bin/tar xf -) \
  || fail "could not copy the agent"
mkdir -p $VP/agent/state $VP/agent/logs

# ── 4. Native helpers for this CPU ───────────────────────────────────────
step 4 "Installing printer helpers"
ABI=$(getprop ro.product.cpu.abi)
case "$ABI" in
  arm64-v8a) ARCH=arm64-v8a ;;
  armeabi-v7a|armeabi) ARCH=armeabi-v7a ;;
  *) fail "unsupported CPU $ABI" ;;
esac
cp "$SRC/prebuilt/$ARCH/vp-usbprint" $VP/bin/vp-usbprint || fail "vp-usbprint missing for $ARCH"
rm -rf $VP/gutenprint.new
mkdir -p $VP/gutenprint.new
$PREFIX/bin/tar xzf "$SRC/prebuilt/gutenprint-armhf.tgz" -C $VP/gutenprint.new || fail "could not unpack the Canon driver"
rm -rf $VP/gutenprint
mv $VP/gutenprint.new/gutenprint $VP/gutenprint
rm -rf $VP/gutenprint.new
cp $VP/agent/android/vp-gutenprint.sh $VP/bin/vp-gutenprint
chmod 755 $VP/bin/vp-usbprint $VP/bin/vp-gutenprint $VP/gutenprint/vp-gutenprint.bin

# ── 5. Kiosk identity ────────────────────────────────────────────────────
step 5 "Saving this kiosk's identity"
PIN_HASH=""
if [ -n "$STAFF_PIN" ]; then
  PIN_HASH=$(printf '%s' "$STAFF_PIN" | $PREFIX/bin/sha256sum | cut -d' ' -f1)
elif [ -f $VP/agent/.env ]; then
  PIN_HASH=$(grep '^STAFF_PIN_SHA256=' $VP/agent/.env | cut -d= -f2)
fi
cat > $VP/agent/.env <<EOF
KIOSK_ID=$KIOSK_ID
KIOSK_API_KEY=$KIOSK_API_KEY
KIOSK_API_BASE_URL=$KIOSK_API_BASE_URL
PRINT_BACKEND=${PRINT_BACKEND:-auto}
STAFF_PIN_SHA256=$PIN_HASH
EOF
chmod 600 $VP/agent/.env

# ── 6. Box settings: India time, always on, no lock screen ───────────────
step 6 "Configuring the box (time zone, screen always on)"
settings put global auto_time_zone 0
setprop persist.sys.timezone Asia/Kolkata
cmd alarm set-timezone Asia/Kolkata >/dev/null 2>&1
settings put global stay_on_while_plugged_in 7
settings put system screen_off_timeout 2147483647
locksettings set-disabled true >/dev/null 2>&1
dumpsys deviceidle whitelist +com.termux >/dev/null 2>&1
dumpsys deviceidle whitelist +com.termux.boot >/dev/null 2>&1

# ── 7. Start on boot ─────────────────────────────────────────────────────
step 7 "Setting up start on power-on"
mkdir -p $HOME_T/.termux/boot
cp $VP/agent/android/boot/start-vaultprint $HOME_T/.termux/boot/start-vaultprint
chmod 700 $HOME_T/.termux/boot/start-vaultprint $VP/agent/android/supervise.sh
# Termux:Boot only receives the boot broadcast after it has been opened once
am start -n com.termux.boot/.BootActivity >/dev/null 2>&1
sleep 2

# Everything in Termux's home belongs to the Termux app (label + owner)
LABEL=$(ls -Zd $HOME_T | awk '{print $1}')
chown -R $TUID:$TUID $HOME_T/.termux $VP
chmod -R go-rwx $VP
[ -n "$LABEL" ] && chcon -R "$LABEL" $HOME_T/.termux $VP 2>/dev/null

# ── 8. Kiosk screen (Chrome locked to the kiosk page) ────────────────────
step 8 "Locking the screen to the kiosk page"
PAGE_HOST=$(echo "$KIOSK_API_BASE_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
sh $VP/agent/android/kiosk.sh setup "$PAGE_HOST/kiosk/$KIOSK_ID?key=$KIOSK_API_KEY" >/dev/null 2>&1 \
  || fail "could not set up the kiosk screen"

# ── 9. Start (or restart) the agent ──────────────────────────────────────
step 9 "Starting VaultPrint"
OLD=$(cat $VP/agent/state/supervisor.pid 2>/dev/null)
if [ -n "$OLD" ] && tr '\0' ' ' < /proc/$OLD/cmdline 2>/dev/null | grep -q supervise\.sh; then
  kill "$OLD" 2>/dev/null
fi
pkill -f "node agent.js" 2>/dev/null
sleep 2
online_count() { n=$(grep -c 'Kiosk is now online' $VP/agent/logs/agent.log 2>/dev/null); echo "${n:-0}"; }
BEFORE=$(online_count)
nohup /system/bin/sh $VP/agent/android/supervise.sh </dev/null >/dev/null 2>&1 &

# Wait for the agent to come online (up to 2 minutes)
i=0
until [ "$(online_count)" -gt "$BEFORE" ] || [ $i -ge 60 ]; do
  i=$((i + 1)); sleep 2
done
if [ $i -ge 60 ]; then
  fail "VaultPrint did not come online — last log: $(tail -n 3 $VP/agent/logs/agent.log | tr '\n' ' ')"
fi
PRINTER=$(grep -E "Printer detected|Printer: +present" $VP/agent/logs/agent.log | tail -1 | sed -E 's/.*\] //')
echo "RESULT OK kiosk $KIOSK_ID online | $PRINTER"
