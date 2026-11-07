#!/system/bin/sh
# ---------------------------------------------------------------------------
# VaultPrint agent supervisor — runs as ROOT, outside the Termux app.
#
# Started at boot by ~/.termux/boot/start-vaultprint (via su). Running under
# su's daemon instead of inside the Termux app matters: Android's activity
# manager kills idle app processes ("empty" processes) — and with them every
# child of the Termux app, which is how the agent died after a boot. Root
# processes started through su are not part of the app and are not killed.
#
# Root also has normal network access (the Termux user started via su lacks
# the inet group). The agent already needed root for USB printing.
#
# Restarts the agent 5 s after any exit; one copy only (pid file).
# ---------------------------------------------------------------------------

export PREFIX=/data/data/com.termux/files/usr
export HOME=/data/data/com.termux/files/home
export PATH="$PREFIX/bin:/system/bin:/system/xbin"
export LD_LIBRARY_PATH="$PREFIX/lib"
export TMPDIR="$PREFIX/tmp"
unset LD_PRELOAD

AGENT="$HOME/vaultprint/agent"
LOGS="$AGENT/logs"
PIDFILE="$AGENT/state/supervisor.pid"
mkdir -p "$LOGS" "$AGENT/state"

# Already running? The pid must still BE this supervisor — after a reboot the
# saved number usually belongs to some other process (checking only that the
# pid exists made the supervisor exit at boot).
OLD=$(cat "$PIDFILE" 2>/dev/null)
if [ -n "$OLD" ] && [ "$OLD" != "$$" ] && tr '\0' ' ' < "/proc/$OLD/cmdline" 2>/dev/null | grep -q 'supervise\.sh'; then
  exit 0
fi
echo $$ > "$PIDFILE"

log() { echo "[$(date -Iseconds)] [supervisor] $*" >> "$LOGS/agent.log"; }

# Wait up to 2 minutes for the network (Wi-Fi joins after boot)
i=0
until ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1 || [ $i -ge 60 ]; do
  i=$((i + 1))
  sleep 2
done
log "network wait finished after $((i * 2))s - starting agent (uid $(id -u))"

cd "$AGENT" || exit 1
while true; do
  if [ -f "$LOGS/agent.log" ] && [ "$(wc -c < "$LOGS/agent.log")" -gt 5242880 ]; then
    mv "$LOGS/agent.log" "$LOGS/agent.log.1"
  fi
  node agent.js >> "$LOGS/agent.log" 2>&1
  log "agent exited with code $? - restarting in 5s"
  sleep 5
done
