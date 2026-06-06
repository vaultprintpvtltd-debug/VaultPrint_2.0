# VaultPrint — Project Context

> **Version:** v2.0 · Two-App Monorepo Architecture  
> **Stack:** Next.js 15 · TypeScript · Supabase · Razorpay · pnpm Workspaces  
> **Author:** Aditya Vishwakarma · June 2026

---

## Overview

VaultPrint is a **QR-based, self-service document printing kiosk platform**. Users scan a QR code, upload a document on their phone, pay via Razorpay, receive a one-time PIN, and collect a printed document at the kiosk — no app install, no account, no staff.

The system supports a **fleet of kiosks** (colleges, hostels, government offices, co-working spaces) all managed from a single admin dashboard.

---

## Monorepo Structure

```
vaultprint/                          ← Git root, pnpm workspace
├── apps/
│   ├── mobile/                      ← Mobile App → app.vaultprintpvtltd.online
│   └── kiosk/                       ← Kiosk App → kiosk. + admin. subdomains
├── packages/
│   ├── db/                          ← @vaultprint/db — Supabase client + types
│   ├── lib/                         ← @vaultprint/lib — otp, razorpay, email, pdf
│   └── ui/                          ← @vaultprint/ui — shared shadcn/ui base components
├── agent/                           ← Print Agent (standalone Node.js, no Next.js)
├── supabase/migrations/             ← DB migrations (shared by both apps)
├── pnpm-workspace.yaml
└── package.json                     ← Root scripts: build:all, dev:mobile, dev:kiosk
```

---

## Four Subsystems

| Subsystem | Subdomain | Hosting | Purpose |
|---|---|---|---|
| **Mobile App** | `app.vaultprintpvtltd.online` | Vercel: `vaultprint-mobile` | Phone-facing flow: upload, configure, pay, OTP |
| **Kiosk App** | `kiosk.vaultprintpvtltd.online` | Vercel: `vaultprint-kiosk` | Kiosk display: QR code, OTP numpad, success screen |
| **Admin Panel** | `admin.vaultprintpvtltd.online` | Same Vercel as Kiosk App | Fleet management — middleware rewrite to `/admin/*` in Kiosk App |
| **Print Agent** | *(no URL)* | Kiosk PC via pm2 | Node.js polling agent — triggers physical printing |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5.x |
| Styling | Tailwind CSS v4 (separate configs per app) |
| Components | shadcn/ui (shared via `packages/ui`) |
| Database | Supabase (PostgreSQL, `ap-south-1`) |
| Auth | Supabase Auth (admin panel) + API key auth (kiosk agent) |
| Realtime | Supabase Realtime (kiosk job status updates) |
| Storage | Supabase Storage (private bucket: `print-files/`) |
| Payments | Razorpay |
| Email | AWS SES v3 |
| Print — Windows | Sumatra PDF CLI |
| Print — macOS/Linux | CUPS `lp` |
| Process Manager | pm2 |
| Rate Limiting | Upstash Redis |
| Monorepo | pnpm workspaces |
| Hosting | Vercel (two separate projects) |

---

## How the Two Apps Communicate

The apps **never call each other directly**. Supabase is the only shared layer.

```
Mobile App  ──writes──▶  print_jobs (Supabase)  ◀──reads──  Kiosk App
                                                              (via Realtime)
Print Agent  ──reads/writes──▶  print_jobs via Kiosk App API routes
```

- **No HTTP calls** from `app.` to `kiosk.` or vice versa
- **No CORS issues** — Supabase is the single source of truth

---

## Shared Packages

| Package | Import | Contents |
|---|---|---|
| `packages/db` | `@vaultprint/db` | `createBrowserClient`, `createServerClient`, generated TypeScript types |
| `packages/lib` | `@vaultprint/lib` | `otp.ts`, `razorpay.ts`, `email.ts`, `pdf.ts` — pure logic, no framework deps |
| `packages/ui` | `@vaultprint/ui` | `Button`, `Input`, `Badge`, `Card` — base shadcn/ui components |

> **Rule:** Never duplicate logic between apps. All shared logic goes in `packages/`.

---

## Database Schema

### `kiosks`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Used in `/kiosk/[id]` URLs and agent `.env KIOSK_ID` |
| `name` | TEXT | e.g. `'BIT Mesra — Library Ground Floor'` |
| `location` | TEXT | Physical description |
| `status` | ENUM | `online` / `idle` / `printing` / `offline` |
| `printer_name` | TEXT | Exact OS printer name |
| `os_platform` | TEXT | `win32` / `darwin` / `linux` — set by agent on first heartbeat |
| `last_heartbeat` | TIMESTAMPTZ | Updated every 30s by agent. Flagged offline if >90s |
| `api_key_hash` | TEXT | SHA-256 of API key — validated by Kiosk App middleware |
| `settings` | JSONB | Optional overrides: `paper_sizes_supported`, `max_copies` |
| `created_at` | TIMESTAMPTZ | |

### `print_jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Internal job ID |
| `session_id` | UUID UNIQUE | In Mobile App URL: `app./print/[session_id]` |
| `kiosk_id` | UUID FK | References `kiosks(id)`. Indexed. |
| `file_path` | TEXT | `print-files/{kiosk_id}/{job_id}.pdf` in private bucket |
| `file_name` | TEXT | Original filename for display |
| `total_pages` | INTEGER | Extracted by `pdf-lib` in Mobile App |
| `pages_to_print` | TEXT | `'all'`, `'1-5'`, or `'1,3,5'` |
| `copies` | INTEGER | Default 1, max 50 |
| `color_mode` | ENUM | `bw` / `colour` |
| `paper_size` | TEXT | `A4` / `A3` / `Letter` |
| `orientation` | ENUM | `portrait` / `landscape` / `auto` |
| `duplex` | BOOLEAN | Default `false` |
| `billable_pages` | INTEGER | `pages_to_print_count × copies` |
| `price_per_page` | NUMERIC | Snapshot at time of order — immutable after |
| `total_price` | NUMERIC | `billable_pages × price_per_page` |
| `razorpay_order_id` | TEXT UNIQUE | Created by Mobile App payment API |
| `razorpay_payment_id` | TEXT | Returned after successful Razorpay checkout |
| `otp_hash` | TEXT | `bcrypt(otp, 10)` — generated by Mobile App, verified by Kiosk App |
| `otp_expires_at` | TIMESTAMPTZ | 15 minutes from payment verification |
| `otp_attempts` | INTEGER | Incremented by Kiosk App OTP API. Job expires at 3 failed attempts. |
| `status` | ENUM | `created→uploaded→customized→payment_pending→paid→queued→printing→completed/failed/expired` |
| `error_message` | TEXT | Set by print agent on `failed` status |
| `completed_at` | TIMESTAMPTZ | Set by print agent on success |
| `created_at` / `updated_at` | TIMESTAMPTZ | Standard audit fields |

### `pricing_config`

| Column | Type | Notes |
|---|---|---|
| `color_mode + paper_size + duplex` | UNIQUE composite | One tier per combination |
| `price_per_page` | NUMERIC(10,2) | ₹ per page. Seeded with 6 defaults. |
| `is_active` | BOOLEAN | Inactive rows excluded from Mobile App price lookup |

---

## API Routes

### Mobile App (`app.vaultprintpvtltd.online/api/`)

| Route | Method | Purpose |
|---|---|---|
| `/api/session/create` | POST | Creates `print_jobs` row when user scans QR |
| `/api/upload/presign` | POST | Returns Supabase Storage presigned URL |
| `/api/upload/confirm` | POST | Extracts page count via `pdf-lib` |
| `/api/jobs/[id]/settings` | PATCH | Saves print configuration |
| `/api/jobs/[id]/status` | GET | Job status polling |
| `/api/jobs/[id]/payment/order` | POST | Creates Razorpay order |
| `/api/jobs/[id]/payment/verify` | POST | Verifies Razorpay signature, generates OTP |
| `/api/webhooks/razorpay` | POST | Razorpay webhook callback |

### Kiosk App (`kiosk.vaultprintpvtltd.online/api/`)

| Route | Method | Purpose |
|---|---|---|
| `/api/kiosk/heartbeat` | POST | Agent pings every 30s |
| `/api/kiosk/[id]/otp` | POST | OTP submitted from kiosk display |
| `/api/kiosk/[id]/queue` | GET | Agent polls for queued jobs (every 3s) |
| `/api/kiosk/[id]/job/[jid]` | PATCH | Agent reports `completed` or `failed` |
| `/api/admin/kiosks/` | CRUD | Admin panel kiosk management |
| `/api/admin/jobs/[id]/refund` | POST | Admin-triggered Razorpay refund |

---

## Authentication & Security

| Route Pattern | App | Auth Method |
|---|---|---|
| `app./api/*` | Mobile App | `session_id` cookie ownership check |
| `app./api/webhooks/razorpay` | Mobile App | `X-Razorpay-Signature` HMAC-SHA256 |
| `kiosk./api/kiosk/*` | Kiosk App | Bearer token → SHA-256 hash → `kiosks.api_key_hash` |
| `kiosk./api/kiosk/*/otp` | Kiosk App | API key + rate limit per IP |
| `admin./` | Kiosk App (via rewrite) | Supabase Auth session cookie |

### Admin Subdomain Rewrite (`apps/kiosk/middleware.ts`)

```ts
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';

  // admin.vaultprintpvtltd.online → rewrite to /admin/*
  if (host.startsWith('admin.')) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin' + url.pathname;
    return NextResponse.rewrite(url);
  }

  // Protect /admin/* — require Supabase Auth session
  if (req.nextUrl.pathname.startsWith('/admin')) {
    // check session cookie → redirect to /admin/login if missing
  }

  // Protect /api/kiosk/* — require Bearer API key
  if (req.nextUrl.pathname.startsWith('/api/kiosk')) {
    // SHA-256 hash Bearer token → compare kiosks.api_key_hash
  }
}
```

---

## Print Agent (`agent/`)

Standalone Node.js process (not in pnpm workspace). Runs on each kiosk PC managed by `pm2`.

### Current Implementation Status

| Behaviour | Status | Detail |
|---|---|---|
| **Heartbeat** | ✅ Implemented | `POST /api/kiosk/heartbeat` every 30s — updates `last_heartbeat`, `os_platform`, transitions `offline → idle` |
| **OS detection** | ✅ Implemented | `process.platform` detected at startup, sent with each heartbeat |
| **Crash recovery** | ✅ Implemented | `pm2` auto-restarts on crash (max 50, 5s delay) |
| **Queue Polling** | ⏳ Pending | `GET /api/kiosk/[id]/queue` every 3s |
| **Job Claiming** | ⏳ Pending | `claim_next_job()` with `FOR UPDATE SKIP LOCKED` |
| **Windows print** | ⏳ Pending | `SumatraPDF.exe -print-to` |
| **macOS/Linux print** | ⏳ Pending | CUPS `lp` command |
| **File handling** | ⏳ Pending | Download PDF via signed URL, delete local temp after each job |

### Agent `.env` Variables

```env
KIOSK_ID=<uuid-from-admin-panel>
KIOSK_API_KEY=<api-key-from-admin-panel>
KIOSK_API_BASE_URL=https://kiosk.vaultprintpvtltd.online   # prod
# KIOSK_API_BASE_URL=http://localhost:3001                  # dev
PRINTER_NAME=                                               # exact OS printer name
```

### Startup Guards
- **Production:** `KIOSK_API_BASE_URL` must contain `kiosk.` — fatal exit otherwise.
- **Development:** `localhost` and `127.0.0.1` bypass this guard.

### Running the Agent

```bash
cd agent && npm install     # first time only
node agent.js               # direct run
pm2 start ecosystem.config.js  # production (auto-restart + logs)
```

---

## Supabase MCP — Usage Notes

This project uses the **Supabase MCP** for database operations. When working on this project via MCP:

- **Project:** single Supabase project shared by both `apps/mobile` and `apps/kiosk`
- **Region:** `ap-south-1`
- **Client helpers:** always import from `@vaultprint/db`, not directly from `@supabase/supabase-js`
  - Browser: `createBrowserClient` from `packages/db/client.ts`
  - Server (Route Handlers / Server Components): `createServerClient` from `packages/db/server.ts`
- **Types:** auto-generated from Supabase schema into `packages/db/types.ts` — regenerate after any migration with `supabase gen types typescript`
- **Realtime:** used in `apps/kiosk/hooks/use-kiosk-realtime.ts` — subscribes to `print_jobs` where `status = 'queued'` and `kiosk_id = [current kiosk]`
- **Storage:** private bucket `print-files/`. Files live at `print-files/{kiosk_id}/{job_id}.pdf`. Auto-deleted 24h after completion via storage policy.
- **Migrations:** all SQL lives in `supabase/migrations/`. Run `supabase db push` from the repo root.

## Gotchas & Technical Guidelines

1. **Next.js `fetch` Deadlocks:** 
   - **Rule:** *Never* call your own API routes (e.g. `fetch('/api/...')`) from a Server Component.
   - **Reason:** In Next.js development mode, the local server handles requests synchronously. Calling an internal API route from a Server Component blocks the thread, causing the request to hang indefinitely.
   - **Solution:** Query the database directly inside the Server Component instead.

2. **Supabase SSR vs. Service Role:**
   - **Rule:** When writing background API routes that *must* bypass RLS (like generating presigned storage URLs or webhook handlers), **do not** use `createServerClient` from `@supabase/ssr`.
   - **Reason:** `createServerClient` automatically reads browser cookies. If a user happens to have an active session cookie (e.g., from logging into the Admin panel), the SSR client will silently override your `SUPABASE_SERVICE_KEY` with the user's `anon` or `authenticated` access token, leading to unexpected RLS violation errors.
   - **Solution:** Use a pure `createClient` from `@supabase/supabase-js` with `auth: { persistSession: false, autoRefreshToken: false }` to ensure it acts as a true backend service role.

3. **Middleware Request vs. Response Headers:**
   - **Rule:** To pass data from middleware to a route handler (e.g., `x-kiosk-id`), use `NextResponse.next({ request: { headers } })`, **not** `response.headers.set()`.
   - **Reason:** `response.headers.set()` only sets **response** headers sent back to the browser. Route handlers read `request.headers`, which won't contain those values.
   - **Solution:** Clone the incoming request headers, add your custom values, and pass them via the `request` option of `NextResponse.next()`.

4. **Next.js Static Prerendering with `useSearchParams`:**
   - **Rule:** If you use `useSearchParams()` in a Client Component, you MUST wrap it in a `<Suspense>` boundary.
   - **Reason:** During the production build (`next build`), Next.js attempts to statically prerender pages. Dynamic hooks like `useSearchParams` cause a "CSR bailout" exception because the URL parameters are not known at build time.
   - **Solution:** Wrap the component rendering the hook with `<Suspense fallback={...}>`.

5. **Supabase-JS Strict Type Inference (Returns `never`):**
   - **Rule:** If you see `Property 'X' does not exist on type 'never'` during a Supabase query, it usually means your TypeScript schema does not exactly match the query (e.g., missing Postgres defaults handling on `.insert()`).
   - **Reason:** `supabase-js`'s generic type inference is extremely rigid. If the expected `Insert` type doesn't mark default DB columns as optional, calling `.insert()` without them evaluates to `never`, breaking all subsequent chained methods (`select()`, `single()`).
   - **Solution:** Rather than fighting deep generic circular constraints in `types.ts`, explicitly cast the client for that specific query (`await (supabase as any).from(...)`).

6. **Vercel Monorepo Build Commands (pnpm v10+):**
   - **Rule:** In `vercel.json`, use `pnpm --filter @vaultprint/[app] run build`.
   - **Reason:** `pnpm build --filter ...` is invalid syntax because `build` is not a native top-level pnpm command (unlike npm). Using invalid syntax will cause the Vercel deployment to fail with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`.

---

## Key Business Rules

1. **OTP:** 6-digit, stored as `bcrypt` hash, expires 15 minutes after generation, max 3 failed attempts before job is `expired`.
2. **File privacy:** PDFs stored in a private Supabase bucket. Server never handles file bytes (presigned upload). Deleted 24h after completion.
3. **Pricing snapshot:** `price_per_page` is snapshotted into `print_jobs` at order time — admin pricing changes do not retroactively affect existing jobs.
4. **Job claiming:** uses `FOR UPDATE SKIP LOCKED` at the DB level — zero double-prints even across concurrent agents on the same kiosk fleet.
5. **No cross-app HTTP:** `app.` and `kiosk.` only share state through Supabase. Never add direct HTTP calls between the two apps.
6. **Adding a kiosk:** create a row in the `kiosks` table via the admin panel → copy the UUID and API key to the new PC's `agent/.env` → `pm2 start`. Zero code changes required.

---

## Vercel Deployments

| Vercel Project | Root Directory | Custom Domains |
|---|---|---|
| `vaultprint-mobile` | `apps/mobile` | `app.vaultprintpvtltd.online` |
| `vaultprint-kiosk` | `apps/kiosk` | `kiosk.vaultprintpvtltd.online`, `admin.vaultprintpvtltd.online` |

Both connect to the same GitHub monorepo. Each has its own environment variables set in the Vercel dashboard. CI must pass for both apps before merging.

---

## File Upload Flow (Supabase Storage)

```
User phone browser
  → POST /api/upload/presign (Mobile App)
      → Supabase Storage presigned URL returned
  → PUT <presigned-url> (direct from browser — server never touches file bytes)
  → POST /api/upload/confirm (Mobile App)
      → pdf-lib extracts page count from storage
      → print_jobs.status updated to 'uploaded'
```

Storage path: `print-files/{kiosk_id}/{job_id}.pdf`  
Bucket: private (no public access)  
Size limit: 50 MB  
File type: PDF only (MIME validated server-side)

---

## OTP Flow (Cross-App via Supabase)

```
Mobile App                    Supabase                    Kiosk App
   │                             │                             │
   │── payment verified ────────▶│                             │
   │── write otp_hash ──────────▶│                             │
   │── status = 'queued' ───────▶│◀──── Realtime subscription ─│
   │                             │──── push event ────────────▶│
   │                             │                 show numpad │
   │                             │◀──── POST /api/kiosk/otp ───│
   │                             │──── verify bcrypt ─────────▶│
   │                             │──── status = 'printing' ───▶│
   │                             │                  Print Agent │
   │                             │◀──── poll /queue ───────────│
   │                             │──── download PDF ──────────▶│
   │                             │                    print job │
   │                             │◀──── PATCH /job/[id] ───────│
   │                             │──── status = 'completed' ──▶│
```

---

## Implementation Progress

For a detailed breakdown of what has been built so far across the Kiosk, Mobile, and Agent subsystems, see the live tracker at `docs/IMPLEMENTATION_STATUS.md`.

---

*VaultPrint Project Context — use this file as the reference for all AI-assisted development, Supabase MCP queries, and skill usage in this monorepo.*
