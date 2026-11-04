#!/system/bin/sh
# ---------------------------------------------------------------------------
# VaultPrint kiosk screen lock — Android 9 box, run as ROOT (su -c).
#
# Layers (the box's launcher can't install web apps and its WebView is too
# old, so the kiosk page runs in Chrome itself):
#   1. Chrome managed policy (root-written app restrictions): every site and
#      chrome:// page blocked except the kiosk site; incognito, sign-in,
#      sync, translate, notifications, geolocation and pop-ups off.
#   2. Lock-task pin: Home / Recents can't leave Chrome, no other app opens.
#   3. Status + navigation bars hidden (this Amlogic ROM's own bar ignores
#      immersive mode — it has a 'navbar' system setting); screen stays on.
#   4. The kiosk page enters browser full-screen on every touch (hides
#      Chrome's address bar and tabs) — apps/kiosk layout.
# The print agent runs `ensure` every 10 s: anything that unpins the screen
# is undone within seconds, unless staff maintenance mode is on.
#
#   kiosk.sh setup <kiosk-url>   one-time: remember the URL, apply policy
#   kiosk.sh lock                lock now (also leaves maintenance mode)
#   kiosk.sh unlock              staff maintenance: unpin, show bars, lift
#                                the Chrome policy, pause the watchdog for
#                                30 minutes (then it re-locks by itself)
#   kiosk.sh ensure              watchdog: re-lock unless in maintenance
#   kiosk.sh status
#
# Reversible: `kiosk.sh unlock` restores normal Android/Chrome behaviour.
# Touches: global policy_control, global stay_on_while_plugged_in, system navbar,
# /data/system/users/0/res_com.android.chrome.xml. State: /data/vaultprint-kiosk
# ---------------------------------------------------------------------------

STATE=/data/vaultprint-kiosk
CHROME=com.android.chrome
POLICY=/data/system/users/0/res_$CHROME.xml
mkdir -p $STATE && chmod 700 $STATE

lock_mode() {
  dumpsys activity activities 2>/dev/null | grep -m1 -o 'mLockTaskModeState=[A-Z]*' | cut -d= -f2
}

kiosk_url() { cat $STATE/url 2>/dev/null; }

# Chrome reads list policies as JSON strings ("s" entries). Android stores
# int/bool entries as element text — a value="" attribute crashes Chrome.
write_policy() {
  HOST=$(kiosk_url | sed -E 's#^https?://([^/:]+).*#\1#')
  [ -n "$HOST" ] || return 1
  ALLOW="[&quot;$HOST&quot;"
  [ -f $STATE/allow_extra ] && for h in $(cat $STATE/allow_extra); do ALLOW="$ALLOW,&quot;$h&quot;"; done
  ALLOW="$ALLOW]"
  cat > $POLICY.tmp <<EOF
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<restrictions>
<entry key="URLBlocklist" type="s">[&quot;*&quot;,&quot;chrome://*&quot;]</entry>
<entry key="URLAllowlist" type="s">$ALLOW</entry>
<entry key="IncognitoModeAvailability" type="i">1</entry>
<entry key="BrowserSignin" type="i">0</entry>
<entry key="SyncDisabled" type="b">true</entry>
<entry key="TranslateEnabled" type="b">false</entry>
<entry key="PasswordManagerEnabled" type="b">false</entry>
<entry key="SearchSuggestEnabled" type="b">false</entry>
<entry key="DefaultPopupsSetting" type="i">2</entry>
<entry key="DefaultNotificationsSetting" type="i">2</entry>
<entry key="DefaultGeolocationSetting" type="i">2</entry>
</restrictions>
EOF
  mv $POLICY.tmp $POLICY
  chown system:system $POLICY
  chmod 600 $POLICY
  restorecon $POLICY 2>/dev/null
}

# Show/hide the box's navigation bar; SystemUI reads it on start (restarts itself)
set_navbar() {
  [ "$(settings get system navbar)" = "$1" ] && return
  settings put system navbar "$1"
  pkill -f com.android.systemui
  sleep 3
}

chrome_task() {
  am stack list 2>/dev/null | grep "$CHROME/" | grep -m1 -o 'taskId=[0-9]*' | cut -d= -f2
}

do_lock() {
  URL=$(kiosk_url)
  [ -n "$URL" ] || { echo "not set up (run: kiosk.sh setup <kiosk-url>)"; return 2; }
  rm -f $STATE/maintenance

  if [ ! -f $POLICY ]; then
    write_policy
    am force-stop $CHROME   # Chrome applies policy on start
  fi
  settings put global policy_control "immersive.full=$CHROME"
  settings put global stay_on_while_plugged_in 7
  set_navbar 0

  # Exactly one tab: if Chrome isn't running, drop its saved tabs first
  pidof $CHROME >/dev/null || rm -rf /data/data/$CHROME/app_tabs/0/*
  # Reuse that tab: Chrome keys tabs by the launching application id
  am start -a android.intent.action.VIEW -d "$URL" -p $CHROME \
    --es com.android.browser.application_id vaultprint-kiosk >/dev/null 2>&1
  sleep 4

  TASK=$(chrome_task)
  [ -n "$TASK" ] || { echo "chrome task not found"; return 3; }
  am task lock "$TASK" >/dev/null 2>&1

  # Browsers only enter full-screen from a real tap: once the page has
  # loaded, tap a non-interactive spot (the "How it works" heading)
  sleep 8
  tap_for_fullscreen
  echo "locked (chrome task $TASK)"
}

# 1920x1080 screen: left column heading/description — no button there on any
# kiosk screen, with or without Chrome's toolbar showing
tap_for_fullscreen() {
  input tap 480 380
}

case "$1" in
  setup)
    [ -n "$2" ] || { echo "usage: kiosk.sh setup <kiosk-url> [extra-allowed-host ...]"; exit 64; }
    echo "$2" > $STATE/url
    shift 2
    echo "qipikfkszlwylauouksp.supabase.co $*" > $STATE/allow_extra
    write_policy && am force-stop $CHROME
    echo "kiosk url saved, Chrome policy applied"
    ;;
  lock)
    do_lock
    ;;
  unlock)
    touch $STATE/maintenance
    am task lock stop >/dev/null 2>&1
    settings put global policy_control null
    set_navbar 1
    rm -f $POLICY
    am force-stop $CHROME
    echo "unlocked (maintenance mode) - run 'kiosk.sh lock' to lock again"
    ;;
  ensure)
    # Maintenance expires after 30 minutes so a forgotten unlock can't leave
    # the kiosk open
    [ -n "$(find $STATE -name maintenance -mmin +30 2>/dev/null)" ] && rm -f $STATE/maintenance
    [ -f $STATE/maintenance ] && exit 0
    [ -f $STATE/url ] || exit 0
    [ "$(lock_mode)" = "NONE" ] || exit 0
    do_lock
    ;;
  status)
    echo "lock mode:   $(lock_mode)"
    echo "maintenance: $([ -f $STATE/maintenance ] && echo on || echo off)"
    echo "kiosk url:   $(kiosk_url)"
    echo "policy:      $([ -f $POLICY ] && echo applied || echo none)"
    echo "bars:        $(settings get global policy_control), navbar=$(settings get system navbar)"
    ;;
  *)
    echo "usage: kiosk.sh setup <url> | lock | unlock | ensure | status"
    exit 64
    ;;
esac
