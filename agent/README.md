# Print Agent

This directory contains the Node.js print agent that runs physically on the kiosk PC. It polls the Supabase database (via the Kiosk App's API routes) for queued print jobs and sends them to the local printer.

## Current Setup Status

The `.env` file for this agent has been manually populated with the credentials for a test kiosk:
- **Kiosk ID:** `243970a3-47a6-4220-95fd-719d8fa311fe`
- **API Key:** `181d...`
- **Base URL:** `https://kiosk.vaultprintpvtltd.online` (Currently pointing to production, should be overridden to `http://localhost:3001` during local dev testing).

## Agent Responsibilities
1. **Heartbeat:** Sends a POST request to `/api/kiosk/heartbeat` every 30s.
2. **Poll Queue:** Polls `/api/kiosk/[id]/queue` every 3s.
3. **Print Execution:** Uses `SumatraPDF.exe` (Windows) or `lp` (macOS/Linux) to print downloaded PDF files.
4. **Completion:** Calls `/api/kiosk/[id]/job/[job_id]` to mark jobs as `completed` or `failed`.

*Note: The actual agent code (Node.js script) is pending implementation in Phase 3.*
