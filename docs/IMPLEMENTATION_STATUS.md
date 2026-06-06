# VaultPrint — Implementation Status
> **Last Updated:** June 6, 2026  
> **Architecture:** v2.0 (Two-App Monorepo + Polling Agent)

This document tracks the actual implementation progress against the PRD and Engineering Roadmap.

---

## 1. Foundation & Scaffolding ✅
- [x] **Monorepo Setup:** `apps/mobile`, `apps/kiosk`, `packages/db`, `packages/lib`, `packages/ui`, `agent/`
- [x] **Database Schema:** Tables (`kiosks`, `print_jobs`, `pricing_config`, `audit_log`) pushed to Supabase.
- [x] **Shared Database Client:** `@vaultprint/db` with split exports:
  - `@vaultprint/db` → client-safe (`createBrowserClient`, types)
  - `@vaultprint/db/server` → server-only (`createServerClient` using `next/headers`)
- [x] **Seeded Data:** `pricing_config` seeded with 4 default tiers (BW single, BW duplex, Colour single, Colour duplex).

## 2. Kiosk App & Admin System ✅
- [x] **Admin Authentication:** `apps/kiosk/app/(admin)/admin/login` — Supabase Auth `signInWithPassword`.
- [x] **Middleware Protection:** Routes `/admin/*` and `/api/admin/*` protected by Supabase Auth sessions.
- [x] **Subdomain Rewrite:** `admin.vaultprintpvtltd.online` → rewrites to `/admin/*` internally.
- [x] **Kiosk API Key Auth:** Middleware validates `Authorization: Bearer <key>` → SHA-256 hash → compare `kiosks.api_key_hash`. Passes `x-kiosk-id` as a **request** header to downstream route handlers.
- [x] **Fleet Management:** Admin dashboard to list kiosks and create new kiosks (crypto-secure 64-char API key, hashed on insert).
- [x] **Kiosk Idle/QR Screen:** Full-screen UI with live clock, status indicator, and QR code (`https://app.../start?k=[kiosk_id]&t=[timestamp]`). QR regenerates every 5 minutes.
- [x] **Realtime Listener:** Kiosk page subscribes to Supabase Realtime for `print_jobs` where `status = 'queued'` and `kiosk_id = [current kiosk]`. Auto-navigates to `/enter-otp`.
- [x] **Heartbeat API:** `POST /api/kiosk/heartbeat` — updates `last_heartbeat`, `os_platform`, transitions kiosk `offline → idle`.

## 3. Mobile App — Session & Upload ✅
- [x] **Session Creation:** `/start?k=[kioskId]` Server Component directly queries Supabase (no `fetch()` to own API — avoids Next.js deadlock). Validates kiosk UUID, checks offline status, inserts `print_jobs` row with `status: 'created'`, redirects to `/print/[sessionId]`.
- [x] **Presigned Upload API:** `POST /api/upload/presign` — validates session, enforces 50MB + PDF-only, generates Supabase Storage signed URL at `print-files/{kiosk_id}/{job_id}.pdf`. Uses pure `createClient` (not `@supabase/ssr`) to bypass cookie-override RLS bug.
- [x] **Upload Confirm API:** `POST /api/upload/confirm` — downloads file from Storage, uses `pdf-lib` to extract `total_pages`, updates `print_jobs` with `file_path`, `total_pages`, `status: 'uploaded'`.
- [x] **Upload UI:** Drag-and-drop React Dropzone with real-time XHR progress bar, file validation, success state showing page count, and "Continue to Settings" button.

## 4. Print Agent — Skeleton ✅
- [x] **`agent/package.json`:** Dependencies: `@supabase/supabase-js`, `dotenv`. Installed via `npm install` (agent is standalone, not in pnpm workspace).
- [x] **`agent/agent.js`:** Loads `.env`, validates config (KIOSK_ID, API_KEY, BASE_URL), detects `process.platform`, sends heartbeat POST every 30s with Bearer token. Includes structured logging and graceful shutdown handlers.
- [x] **`agent/ecosystem.config.js`:** pm2 config with auto-restart (max 50), 5s restart delay, log rotation to `agent/logs/`, 200MB memory limit.
- [x] **Startup Guard:** `KIOSK_API_BASE_URL` must contain `kiosk.` in production; `localhost` / `127.0.0.1` allowed for dev.
- [x] **Verified:** Agent ran for 11 minutes, all heartbeats returned `200 OK`, database confirmed `status: idle`, `os_platform: win32`, `last_heartbeat` updated.

## 5. Bug Fixes Applied
| Bug | Root Cause | Fix |
|---|---|---|
| Start page hung forever | Server Component called own API via `fetch()` causing Next.js deadlock | Query Supabase directly in the Server Component |
| Upload presign returned RLS violation | `@supabase/ssr` client read browser cookies, overriding service role key with user's anon session | Switched to pure `createClient` with `persistSession: false` |
| Middleware `x-kiosk-id` not reaching route handlers | `response.headers.set()` sets response headers, not request headers | Use `NextResponse.next({ request: { headers } })` pattern |
| Middleware didn't protect `/api/admin/*` | Only checked `pathname.startsWith('/admin')` | Added `pathname.startsWith('/api/admin')` check + matcher entry |

---

## 6. Next Steps
1. **Mobile App — Print Customization & Payment:** `/customize/[sessionId]` — B&W/Color, Duplex, Copies, page range → price calculation → Razorpay integration.
2. **Kiosk App — OTP Screen:** `/kiosk/[kioskId]/enter-otp` — numpad UI + `POST /api/kiosk/[id]/otp` backend validation.
3. **Print Agent — Queue Polling & Execution:** Poll `GET /api/kiosk/[id]/queue` every 3s, download PDF via signed URL, execute `SumatraPDF` (Windows) or `lp` (macOS/Linux), report completion/failure.
4. **Admin Dashboard:** Fleet overview, job history, pricing management, refund capabilities.
5. **RLS Policies:** Enable Row Level Security on all 4 tables before production deployment.
