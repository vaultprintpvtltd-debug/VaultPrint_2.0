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
| Heartbeat | ✅ | `POST /api/kiosk/heartbeat` every 30s. Updates `last_heartbeat`, `os_platform`, transitions `offline → idle`. |
| Queue Polling | ⏳ Pending | `GET /api/kiosk/[id]/queue` every 3s |
| Print Execution | ⏳ Pending | `SumatraPDF.exe` (Windows) / `lp` (macOS/Linux) |
| Job Completion | ⏳ Pending | `PATCH /api/kiosk/[id]/job/[jid]` → `completed` or `failed` |
| Graceful Shutdown | ✅ | Handles `SIGINT`, `SIGTERM`, uncaught exceptions |

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
