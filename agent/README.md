# Print Agent

Standalone Node.js process that runs on each kiosk PC. Communicates with the Kiosk App's API routes (authenticated via Bearer API key) to send heartbeats and process print jobs.

## Quick Start

```bash
# Install dependencies (standalone, not part of pnpm workspace)
npm install

# Run directly
node agent.js

# Run with pm2 (production)
pm2 start ecosystem.config.js
pm2 logs vaultprint-agent
pm2 save    # persist across reboots
```

## Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `KIOSK_ID` | ✅ | UUID from admin panel when creating a kiosk |
| `KIOSK_API_KEY` | ✅ | 64-char hex key shown once during kiosk creation |
| `KIOSK_API_BASE_URL` | ✅ | `https://kiosk.vaultprintpvtltd.online` (prod) or `http://localhost:3001` (dev) |
| `PRINTER_NAME` | ❌ | Exact OS printer name (e.g. `Canon G2000 series`) |
| `SUPABASE_URL` | ❌ | Not used by agent directly — agent talks to kiosk API only |
| `SUPABASE_SERVICE_KEY` | ❌ | Not used by agent directly |

### Startup Guard
- In **production**: `KIOSK_API_BASE_URL` must contain `kiosk.` (prevents accidentally pointing at the wrong service).
- In **development**: `localhost` and `127.0.0.1` bypass this guard.

## What's Implemented

| Feature | Status | Details |
|---|---|---|
| Heartbeat | ✅ | `POST /api/kiosk/heartbeat` every 30s, plus the USB printer's state on Android (present / firmware / paper / error). |
| Queue claim | ✅ | `GET /api/kiosk/[id]/queue` every 3s — atomic `claim_next_job`; one job at a time. |
| Print — Android | ✅ | HP LaserJet 1020 over raw USB: Ghostscript → foo2zjs → `vp-usbprint` (`printers/zjs-usb.js`). Firmware uploaded automatically after every printer power-on. Canon PIXMA G2010: Ghostscript → Gutenprint (`vp-gutenprint`) → `vp-usbprint` (`printers/gutenprint-usb.js`). |
| Print — Windows | ✅ | SumatraPDF to an installed Windows printer. |
| Completion evidence | ✅ | Every final status carries evidence. Android: `inferred` (all bytes accepted + printer healthy after the expected print time — the 1020 has no readable page counter). Windows: `spooled`. |
| Crash safety | ✅ | `state/journal.json` records each job's stage; interrupted jobs are reported failed with whether pages may have printed — never reprinted automatically. |
| Kiosk screen lock | ✅ | Android only — see below. |
| Simulated printing | dev only | `PRINT_BACKEND=fake` must be set explicitly; never automatic. |

## Android box (Termux) — HP LaserJet 1020

Hardware verified: Amlogic TX3, Android 9 (32-bit ARM, rooted, SELinux permissive),
HP LaserJet 1020 (`03f0:2b17`). The kernel has no USB printer driver, so printing
uses raw usbfs as root; only `vp-usbprint` runs as root, everything else runs as
the Termux user.

**Setup** (inside the Termux app, from this directory):

```bash
VP_ACCEPT_HP_LICENSE=yes bash android/setup.sh   # read HP's plugin licence first
```

Builds `~/vaultprint/bin/{foo2zjs,vp-usbprint}`, extracts the 1020 firmware from
HP's signed HPLIP plugin into `~/vaultprint/firmware/` (never commit it), and runs
`npm install`. `.env` additionally needs `PRINT_BACKEND=zjs-usb` and
`STAFF_PIN_SHA256` (SHA-256 hex of the staff PIN).

### Canon PIXMA G2010 instead of the HP (`PRINT_BACKEND=gutenprint-usb`)

The G2010 (`04a9:183a`, IEEE-1284 `CMD:BJRaster3,IVEC`) is driven by
Gutenprint's *Canon G2000 series* driver, which is verified on this printer:

```
PDF ─ Ghostscript (pgmraw/ppmraw, A4, 300 dpi) ─▶ vp-gutenprint ─▶ vp-usbprint ─▶ USB
```

`vp-gutenprint` is a static armhf build. Build it on any x86-64 PC with Docker,
then copy it to the box:

```bash
sh android/build-gutenprint.sh                        # → gutenprint-armhf.tgz
tar xzf gutenprint-armhf.tgz -C ~/vaultprint          # → ~/vaultprint/gutenprint/
cp android/vp-gutenprint.sh ~/vaultprint/bin/vp-gutenprint && chmod 700 ~/vaultprint/bin/vp-gutenprint
```

`.env`: `PRINT_BACKEND=gutenprint-usb`, `PRINTER_USB_ID=04a9:183a`,
`PRINTER_NAME=Canon PIXMA G2010` (optional `GUTENPRINT_DRIVER`, default
`bjc-G2000-series`). There's no firmware step. The kiosk's printer capabilities
(`kiosks.config.printer`) must say `duplex: false`, because the G2010 can't print double-sided.
Verified: B&W end to end (kiosk code → agent → paper). Colour: not yet verified.

**Kiosk lock** (`android/kiosk.sh`, run as root):

```bash
su -c "sh android/kiosk.sh setup https://<kiosk-host>/kiosk/<kiosk-id>"   # once
su -c "sh android/kiosk.sh lock"      # status | unlock | ensure
```

Chrome is pinned (lock-task mode), restricted by managed policy to the kiosk site
only, the system bars are hidden and the screen stays on. Every 10 s the agent
re-locks if anything unpins it, and hides the bars again if they come back.

**Start on boot:** install **Termux:Boot** from the same source as Termux
(F-Droid here — the signing keys must match), open it once, then:

```bash
mkdir -p ~/.termux/boot && cp android/boot/start-vaultprint ~/.termux/boot/ && chmod 700 ~/.termux/boot/start-vaultprint
su -c "dumpsys deviceidle whitelist +com.termux"   # no battery-optimisation prompt at boot
```

The boot script immediately hands off to `android/supervise.sh` **as root**
(via `su`), which waits for the network, then runs and supervises the agent
(restart on exit, single instance, 5 MB log rotation); the agent's watchdog
locks the screen and taps it into full screen. The root hand-off matters:
about a minute after boot Android may kill the idle Termux app as an "empty"
process, and every process the app started dies with it. The root supervisor
isn't part of the app. Root also has network access, which the Termux user
lacks when started through `su`. On the TX3 the boot broadcast reaches
Termux:Boot ~80 s after boot, so the kiosk appears ~2 minutes after power-on.

**Staff exit:** on the kiosk screen, press and hold the VaultPrint logo for
5 seconds → staff PIN → the agent (127.0.0.1:4100) unlocks for maintenance. It
re-locks automatically after 30 minutes, or immediately with `kiosk.sh lock`.

**Rollback:** `su -c "sh android/kiosk.sh unlock"`, then remove
`/data/vaultprint-kiosk`. Nothing in the Android system partition is modified.

## pm2 Configuration

The `ecosystem.config.js` configures:
- **Auto-restart:** Up to 50 restarts, 5s delay between restarts
- **Logging:** `agent/logs/out.log` and `agent/logs/error.log`
- **Memory limit:** 200MB (auto-restarts if exceeded)
- **Watch:** Disabled (agent is long-running, not file-dependent)

## Verified

The agent was tested locally on Windows 11 (`win32`) for 11 minutes:
- All heartbeats returned `200 OK`
- Database confirmed: `status: idle`, `os_platform: win32`, `last_heartbeat` updated every 30s
