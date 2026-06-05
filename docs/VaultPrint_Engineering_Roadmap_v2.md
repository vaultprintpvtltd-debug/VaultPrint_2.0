# VaultPrint Core App — Engineering Roadmap v2.0
### Two-App Monorepo Architecture

`app.vaultprintpvtltd.online` · `kiosk.vaultprintpvtltd.online` · `admin.vaultprintpvtltd.online`

Multi-Kiosk Platform · Next.js 15 · TypeScript · Supabase · Razorpay · pnpm Workspaces

---

## 1. Core App Overview & Two-App Architecture

> **↻ CHANGE FROM v1.0** — The Kiosk Display App and Mobile Web App are now two separate Next.js applications on separate subdomains, in a single monorepo. All shared logic lives in `packages/`. The Print Agent is unchanged.

### 1.1 Four Subsystems

| Subsystem | Subdomain | Runs On | What It Is |
|---|---|---|---|
| Mobile App | `app.vaultprintpvtltd.online` | Vercel: `vaultprint-mobile` | Phone-facing Next.js app: upload, configure, pay, view OTP |
| Kiosk App | `kiosk.vaultprintpvtltd.online` | Vercel: `vaultprint-kiosk` | Kiosk display: QR code, OTP numpad, success screen |
| Admin Panel | `admin.vaultprintpvtltd.online` | Same Vercel as Kiosk App | Fleet management — middleware rewrite from `admin.` to `/admin/*` in Kiosk App |
| Print Agent | *(no web-facing URL)* | Kiosk PC via pm2 | Node.js polling agent — triggers physical printing |

### 1.2 Why Two Apps

| Concern | Single App (v1.0) | Two Apps (v2.0) |
|---|---|---|
| Design system | One config, compromises both contexts | Mobile: 360px-first. Kiosk: 1080p-first, large touch targets |
| Deployment | Kiosk bug forces mobile re-testing | Each app deploys and rolls back independently |
| Bundle size | Kiosk ships all mobile components | Each app ships only what it uses |
| URL clarity | `/kiosk/[id]` vs `/print/[id]` — same domain | `kiosk.` vs `app.` — instantly clear which context |
| Security surface | One middleware handles all auth | Each app's middleware scoped to exactly its routes |
| Chrome kiosk mode | Kiosk Chrome can navigate to mobile routes | Separate domain makes this impossible by default |

### 1.3 How The Two Apps Communicate

The two apps **never call each other directly**. Supabase is the only shared layer:

- Mobile App writes to `print_jobs` (creates session, uploads, pays, queues)
- Kiosk App reads `print_jobs` via Supabase Realtime (listens for `status = 'queued'`)
- Print Agent reads/writes `print_jobs` via Kiosk App API routes
- Both apps share the same Supabase project, same tables, same storage bucket

> **✓ TIP** — There are NO HTTP calls from `app.` to `kiosk.` or vice versa. No CORS issues. Supabase is the single source of truth for all state.

### 1.4 Multi-Kiosk Architecture — Unchanged

All multi-kiosk principles from v1.0 are preserved. Every kiosk is a row in the `kiosks` table. The `claim_next_job()` function ensures atomic, isolated job claiming. Adding Kiosk N takes 2 minutes: create the DB row in admin panel, copy the UUID and API key to the new PC's `.env`, run `pm2 start`.

---

## 2. Monorepo & Project Structure

> **ℹ NOTE** — pnpm workspaces. Two Next.js apps in `apps/`. Three shared packages in `packages/`. One print agent in `agent/`. One Supabase migrations folder. One Git repo.

### 2.1 Root Workspace

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

### 2.2 apps/mobile — Mobile Web App

```
apps/mobile/
├── app/
│   ├── (user)/
│   │   ├── start/page.tsx           /start?k=[kioskId] — QR entry, session create
│   │   └── print/[sessionId]/
│   │       ├── page.tsx             Step 1: File upload
│   │       ├── customize/page.tsx   Step 2: Print settings + live price
│   │       ├── payment/page.tsx     Step 3: Razorpay checkout
│   │       ├── otp/page.tsx         Step 4: OTP display + countdown
│   │       └── done/page.tsx        Completion screen
│   └── api/
│       ├── session/create/route.ts
│       ├── upload/presign/route.ts
│       ├── upload/confirm/route.ts
│       ├── jobs/[id]/settings/route.ts
│       ├── jobs/[id]/status/route.ts
│       ├── jobs/[id]/payment/order/route.ts
│       ├── jobs/[id]/payment/verify/route.ts
│       └── webhooks/razorpay/route.ts
├── components/user/                 FileDropzone, CustomizeForm, RazorpayButton, OTPDisplay
├── hooks/use-job-status.ts          TanStack Query polling for job status
├── middleware.ts                    Session ownership checks, payment rate limiting
├── next.config.ts
└── package.json                     Imports @vaultprint/db, @vaultprint/lib, @vaultprint/ui
```

### 2.3 apps/kiosk — Kiosk Display App + Admin Panel

```
apps/kiosk/
├── app/
│   ├── (kiosk)/                     Kiosk display pages (no auth needed)
│   │   └── kiosk/[kioskId]/
│   │       ├── page.tsx             /kiosk/[id] — QR idle screen + Realtime
│   │       ├── enter-otp/page.tsx   OTP numpad entry
│   │       └── success/page.tsx     Print success + auto-return
│   ├── (admin)/                     Admin panel (Supabase Auth protected)
│   │   └── admin/
│   │       ├── login/page.tsx       Auth login
│   │       ├── page.tsx             Fleet dashboard
│   │       ├── kiosks/page.tsx      Kiosk CRUD + API key management
│   │       ├── jobs/page.tsx        Job history + refunds
│   │       └── pricing/page.tsx     Pricing editor
│   └── api/
│       ├── kiosk/heartbeat/route.ts
│       ├── kiosk/[id]/otp/route.ts
│       ├── kiosk/[id]/queue/route.ts
│       ├── kiosk/[id]/job/[jid]/route.ts
│       └── admin/kiosks/            + admin/jobs/[id]/refund/
├── components/kiosk/                QRCodeDisplay, OTPNumpad, SuccessScreen
├── components/admin/                FleetTable, JobsTable, PricingEditor
├── hooks/use-kiosk-realtime.ts      Supabase Realtime subscription
├── middleware.ts                    Subdomain rewrite for admin. + Supabase Auth + API key auth
├── next.config.ts
└── package.json                     Imports @vaultprint/db, @vaultprint/lib, @vaultprint/ui
```

### 2.4 packages/ — Shared Logic

| Package | Import As | Contents |
|---|---|---|
| `packages/db` | `@vaultprint/db` | `createBrowserClient`, `createServerClient`, database TypeScript types generated from Supabase schema |
| `packages/lib` | `@vaultprint/lib` | `otp.ts` (generate + bcrypt + verify), `razorpay.ts` (createOrder + isValidSignature), `email.ts` (AWS SES), `pdf.ts` (pdf-lib page count) |
| `packages/ui` | `@vaultprint/ui` | `Button`, `Input`, `Badge`, `Card` — base shadcn/ui components used by both apps |

> **⚠ IMPORTANT** — Nothing is duplicated between the two apps. Any change to `otp.ts` or `razorpay.ts` in `packages/lib` applies to both apps on the next build. Never copy-paste logic between apps — put it in `packages/`.

### 2.5 Admin Subdomain Routing

The Admin Panel lives as a route group inside `apps/kiosk`. The Kiosk App `middleware.ts` handles the `admin.` subdomain rewrite:

```ts
// apps/kiosk/middleware.ts (simplified)
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';

  // 1. admin.vaultprintpvtltd.online → rewrite to /admin/*
  if (host.startsWith('admin.')) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin' + url.pathname;
    return NextResponse.rewrite(url);
  }

  // 2. Protect /admin/* routes — require Supabase Auth session
  if (req.nextUrl.pathname.startsWith('/admin')) {
    // check session cookie → redirect to /admin/login if missing
  }

  // 3. Protect /api/kiosk/* — require Bearer API key
  if (req.nextUrl.pathname.startsWith('/api/kiosk')) {
    // SHA-256 hash Bearer token → compare kiosks.api_key_hash
  }
}
```

One Vercel project (`vaultprint-kiosk`) serves all three: `kiosk.vaultprintpvtltd.online`, `admin.vaultprintpvtltd.online`, and the kiosk API routes used by the print agent.

---

## 3. Database Schema — Multi-Kiosk Ready

The schema is identical to v1.0. Both apps connect to the same Supabase project. The Mobile App uses the schema for creating and managing sessions. The Kiosk App uses it for job claiming, OTP verification, and heartbeats.

### 3.1 kiosks

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Used in `/kiosk/[id]` URLs and agent `.env KIOSK_ID` |
| `name` | TEXT | e.g. `'BIT Mesra — Library Ground Floor'` |
| `location` | TEXT | Physical description |
| `status` | ENUM | `online` / `idle` / `printing` / `offline` |
| `printer_name` | TEXT | Exact OS printer name |
| `os_platform` | TEXT | `win32` / `darwin` / `linux` — set by agent on first heartbeat |
| `last_heartbeat` | TIMESTAMPTZ | Updated every 30s by agent. Admin flags offline if >90s |
| `api_key_hash` | TEXT | SHA-256 of API key. Kiosk App middleware validates all `/api/kiosk/*` calls |
| `settings` | JSONB | Optional overrides: `paper_sizes_supported`, `max_copies` |
| `created_at` | TIMESTAMPTZ | Set once at creation |

### 3.2 print_jobs

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Internal job ID |
| `session_id` | UUID UNIQUE | In Mobile App URL: `app./print/[session_id]` |
| `kiosk_id` | UUID FK | References `kiosks(id)`. Indexed. |
| `file_path` | TEXT | `print-files/{kiosk_id}/{job_id}.pdf` in private bucket |
| `file_name` | TEXT | Original filename for UI display |
| `total_pages` | INTEGER | Extracted by pdf-lib in Mobile App after upload |
| `pages_to_print` | TEXT | `'all'`, `'1-5'`, or `'1,3,5'` |
| `copies` | INTEGER | Default 1, max 50 |
| `color_mode` | ENUM | `bw` / `colour` |
| `paper_size` | TEXT | `A4` / `A3` / `Letter` |
| `orientation` | ENUM | `portrait` / `landscape` / `auto` |
| `duplex` | BOOLEAN | Default `false` |
| `billable_pages` | INTEGER | `pages_to_print_count × copies` |
| `price_per_page` | NUMERIC | Snapshot at time of order — never changes after |
| `total_price` | NUMERIC | `billable_pages × price_per_page` |
| `razorpay_order_id` | TEXT UNIQUE | Created by Mobile App payment API |
| `razorpay_payment_id` | TEXT | Returned after successful Razorpay checkout |
| `otp_hash` | TEXT | `bcrypt(otp, 10)`. Generated by Mobile App. Verified by Kiosk App. |
| `otp_expires_at` | TIMESTAMPTZ | 15 minutes from payment verification |
| `otp_attempts` | INTEGER | Incremented by Kiosk App OTP API. Expires job at 3. |
| `status` | ENUM | `created→uploaded→customized→payment_pending→paid→queued→printing→completed/failed/expired` |
| `error_message` | TEXT | Set by print agent on `failed` status |
| `completed_at` | TIMESTAMPTZ | Set by print agent on success |
| `created_at` / `updated_at` | TIMESTAMPTZ | Standard audit fields |

### 3.3 pricing_config

| Column | Type | Notes |
|---|---|---|
| `color_mode + paper_size + duplex` | UNIQUE composite | One pricing tier per combination |
| `price_per_page` | NUMERIC(10,2) | ₹ per page. Seeded with 6 defaults. |
| `is_active` | BOOLEAN | Inactive rows excluded from Mobile App price lookup |

### 3.4 audit_log

| Column | Details |
|---|---|
| `job_id` | FK to `print_jobs`. Nullable for kiosk-level events. |
| `kiosk_id` | FK to `kiosks`. |
| `event` | `uploaded` / `paid` / `otp_verified` / `print_started` / `completed` / `failed` / `expired` |
| `metadata` | JSONB: `payment_id`, `error`, `ip_address`, `os_platform`, `printer_name` |
| `created_at` | Immutable timestamp. Append-only. |

### 3.5 Critical Postgres Function: claim_next_job

> **⚠ IMPORTANT** — This is the most important piece of code in the system. It prevents double-printing across multiple kiosks. Called by the Kiosk App `/api/kiosk/[id]/queue` route, which the print agent polls.

```sql
CREATE OR REPLACE FUNCTION claim_next_job(p_kiosk_id UUID)
RETURNS TABLE(job_id UUID, file_path TEXT, settings JSONB) AS $$
DECLARE v_job print_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM print_jobs
    WHERE kiosk_id = p_kiosk_id AND status = 'queued'
    ORDER BY created_at ASC LIMIT 1
    FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE print_jobs SET
    status = 'printing', updated_at = NOW()
    WHERE id = v_job.id;

  RETURN QUERY SELECT v_job.id, v_job.file_path,
    jsonb_build_object('color_mode', v_job.color_mode,
    'copies', v_job.copies, 'duplex', v_job.duplex,
    'pages_to_print', v_job.pages_to_print);
END; $$ LANGUAGE plpgsql;
```

---

## 4. API Contract — Split By App

> **↻ CHANGE FROM v1.0** — API routes are now split between two apps. User flow APIs live in the Mobile App. Kiosk and admin APIs live in the Kiosk App. The print agent always calls the Kiosk App domain.

### 4.1 Mobile App APIs (`app.vaultprintpvtltd.online/api/`)

| Method | Route | Request Body | Response |
|---|---|---|---|
| POST | `/api/session/create` | `{ kiosk_id }` | `{ session_id, kiosk_name, redirect_url }` |
| POST | `/api/upload/presign` | `{ session_id, file_name, file_size }` | `{ upload_url, file_path, expires_in }` |
| POST | `/api/upload/confirm` | `{ session_id, file_path }` | `{ ok, total_pages }` |
| PATCH | `/api/jobs/[id]/settings` | `{ pages_to_print, copies, color_mode, paper_size, orientation, duplex }` | `{ total_price, billable_pages, price_per_page }` |
| POST | `/api/jobs/[id]/payment/order` | `{ session_id }` | `{ razorpay_order_id, amount, currency, key_id }` |
| POST | `/api/jobs/[id]/payment/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` | `{ otp, expires_at }` — OTP shown once, never logged |
| GET | `/api/jobs/[id]/status` | `?session_id=string` | `{ status, completed_at, error_message }` |
| POST | `/api/webhooks/razorpay` | Razorpay webhook body | `{ ok }` — fallback payment confirm |

### 4.2 Kiosk App APIs (`kiosk.vaultprintpvtltd.online/api/`)

All kiosk endpoints require `Authorization: Bearer [api_key]` header. The print agent must set `KIOSK_API_BASE_URL=https://kiosk.vaultprintpvtltd.online` in its `.env`.

| Method | Route | Notes |
|---|---|---|
| POST | `/api/kiosk/heartbeat` | `{ kiosk_id, os_platform }` — updates `last_heartbeat`, `status=online` |
| POST | `/api/kiosk/[id]/otp` | `{ session_id, otp }` — verifies hash, expiry, attempts. Returns `{ valid, attempts_remaining }` |
| GET | `/api/kiosk/[id]/queue` | Calls `claim_next_job()`. Returns full job row + 2-min signed PDF URL, or null |
| PATCH | `/api/kiosk/[id]/job/[jid]` | `{ status: completed│failed, error_message? }` — agent reports result |

### 4.3 Admin APIs (`admin.vaultprintpvtltd.online` → kiosk app `/admin/*`)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/admin/kiosks` | All kiosks + live stats (jobs today, revenue today). Requires Supabase Auth. |
| POST | `/api/admin/kiosks` | Create kiosk. Generates UUID + API key (plain, returned once). Hashes key in DB. |
| PATCH | `/api/admin/kiosks/[id]` | Update name, location, `printer_name`. Or regenerate API key. |
| GET | `/api/admin/jobs` | Paginated job history. Filters: `kiosk_id`, `status`, `date_from`, `date_to` |
| POST | `/api/admin/jobs/[id]/refund` | Trigger Razorpay refund. Update `status=refunded`. Write `audit_log`. |

### 4.4 Print Agent `.env` — KIOSK_API_BASE_URL

```env
# agent/.env — add this line:
KIOSK_API_BASE_URL=https://kiosk.vaultprintpvtltd.online
```

```js
// Agent startup validation (agent.js):
if (!process.env.KIOSK_API_BASE_URL?.includes('kiosk.')) {
  console.error('[FATAL] KIOSK_API_BASE_URL must be the kiosk. subdomain');
  process.exit(1);
}
```

---

## 5. Mobile Web App — Pages & Components

Lives in `apps/mobile`. Deployed to `app.vaultprintpvtltd.online` on Vercel project `vaultprint-mobile`. Mobile-first design (max-width 480px). All pages are Next.js Server Components with Client Component islands.

### 5.1 `/start?k=[kioskId]` — QR Entry

Server Component only. No UI. Reads `?k=[kioskId]`. Validates kiosk exists and is online. Calls `POST /api/session/create`. Redirects to `/print/[sessionId]`.

| Check | On Failure |
|---|---|
| `kiosk_id` param present | Redirect to `/` with `error=invalid_kiosk` |
| Kiosk exists in DB | Show 'Kiosk not found' page |
| Kiosk status is not `offline` | Show 'Kiosk currently offline' page |
| Session created | Redirect to `/print/[sessionId]` |

### 5.2 `/print/[sessionId]` — Upload

| Component | Purpose |
|---|---|
| `<StepIndicator step={1} />` | Progress bar: Upload → Settings → Payment → OTP |
| `<FileDropzone />` | react-dropzone. PDF only. File name + size preview. 50MB guard. |
| `<UploadProgress />` | XHR to Supabase Storage presigned URL with live % bar |
| `<PageCountBadge />` | Shown after confirm: '12 pages detected' |
| `<ContinueButton />` | Disabled until upload confirmed. Navigates to `/customize` |

### 5.3 `/print/[sessionId]/customize` — Settings

| Component | Purpose |
|---|---|
| `<StepIndicator step={2} />` | Progress tracker |
| `<PageRangeInput />` | Text field: `'all'`, `'1-5'`, `'1,3,5'`. Validates against `total_pages` |
| `<ColorModeToggle />` | B&W / Colour toggle |
| `<CopiesInput />` | Number input 1–50 with +/- buttons |
| `<OrientationSelect />` | Portrait / Landscape / Auto |
| `<DuplexToggle />` | Double-sided toggle |
| `<LivePriceSummary />` | `'12 pages × ₹2 × 2 copies = ₹48'` — debounced PATCH call |
| `<PDFPreview />` | react-pdf viewer for selected pages (lazy-loaded) |
| `<ConfirmButton />` | `PATCH /api/jobs/[id]/settings` → navigate to `/payment` |

### 5.4 `/print/[sessionId]/payment` — Checkout

| Component | Purpose |
|---|---|
| `<OrderSummaryCard />` | Read-only: file name, pages, settings, total price |
| `<RazorpayButton />` | POST `/order` → open Razorpay modal → POST `/verify` on success |
| `<PaymentStatusHandler />` | Failure: show retry. Success: navigate to `/otp` |

### 5.5 `/print/[sessionId]/otp` — OTP Display

| Component | Purpose |
|---|---|
| `<OTPDisplay />` | Large 6-digit monospace OTP. Copy-to-clipboard button. |
| `<CountdownTimer />` | 15-minute ring. Red at 2 min remaining. |
| `<KioskInstructions />` | 'Walk to the kiosk and enter this code on the numpad' |
| `<EmailOTPButton />` | Optional backup delivery via AWS SES |
| `<JobStatusPoller />` | TanStack Query polling `/api/jobs/[id]/status` every 4s → redirects to `done` on `completed` |

---

## 6. Kiosk Display App — Pages & Realtime

Lives in `apps/kiosk`. Deployed to `kiosk.vaultprintpvtltd.online` on Vercel project `vaultprint-kiosk`. Chrome launched with `--kiosk` flag. Full-screen, no scrolling, large touch targets (minimum 64px). Supabase Realtime drives all screen transitions.

> **ℹ NOTE** — The kiosk Chrome browser is permanently pointed at `kiosk.vaultprintpvtltd.online/kiosk/[kioskId]`. It never visits `app.vaultprintpvtltd.online` — that is the phone user's domain.

### 6.1 `/kiosk/[kioskId]` — Idle / QR Screen

| Component | Purpose |
|---|---|
| `<KioskHeader />` | VaultPrint logo + kiosk name + current time |
| `<QRCodeDisplay />` | QR encodes `https://app.vaultprintpvtltd.online/start?k=[kioskId]`. Regenerates every 5 min. |
| `<InstructionStrip />` | 3-step: Scan QR → Upload & Pay on your phone → Enter OTP here |
| `<RealtimeListener />` | Supabase Realtime on `print_jobs` WHERE `kiosk_id = this AND status = 'queued'`. On event: `router.push('/kiosk/[id]/enter-otp')` |
| `<KioskStatusBar />` | Bottom: printer status, last job time |

### 6.2 `/kiosk/[kioskId]/enter-otp` — OTP Numpad

| Component | Purpose |
|---|---|
| `<OTPNumpad />` | 0–9 + delete + confirm. Touch and keyboard. Min 64×64px targets. |
| `<OTPInputDisplay />` | 6 boxes showing entered digits as dots |
| `<JobContextBar />` | `N pages · B&W · 2 copies` — from the queued job |
| `<AttemptWarning />` | '2 attempts remaining' after first wrong entry |
| `<ExpiryCountdown />` | 'Code expires in 4:32' |
| `<OTPSubmitHandler />` | `POST /api/kiosk/[id]/otp`. On valid: navigate to `/success`. On wrong: shake. On expired/exhausted: return to idle. |

### 6.3 `/kiosk/[kioskId]/success` — Print Success

| Component | Purpose |
|---|---|
| `<SuccessAnimation />` | Checkmark animation. 'Printing your document...' |
| `<PrintSummary />` | Final summary: pages, colour, copies |
| `<AutoReturnTimer />` | 'Returning home in 5 seconds' → `router.push('/kiosk/[id]')` |
| `<RealtimeCompletionListener />` | Listens for `status=completed` from print agent via Realtime |

### 6.4 Admin Panel (same deployment, middleware-routed from `admin.`)

| Route | Purpose |
|---|---|
| `/admin` (fleet dashboard) | Grid: one card per kiosk — status, jobs today, revenue today, last heartbeat. Polls `/api/admin/kiosks` every 30s. |
| `/admin/kiosks` | Add/edit/delete kiosks. Generate API key (shown once). Regenerate key. |
| `/admin/jobs` | Paginated table: session ID, kiosk, pages, price, status, timestamp. Filters. Refund action. |
| `/admin/pricing` | Inline edit all `pricing_config` rows. Toggle `is_active`. |
| `/admin/login` | Supabase Auth email + password. Redirects to `/admin` on success. |

---

## 7. Print Agent — Cross-Platform Node.js

Lives in `agent/`. Runs on the kiosk PC via pm2. Polls the Kiosk App (`kiosk.vaultprintpvtltd.online`) for jobs. OS-agnostic code with platform-specific print commands.

> **↻ CHANGE FROM v1.0** — Only change from v1.0: the agent now calls `kiosk.vaultprintpvtltd.online` instead of a single Next.js app URL. Add `KIOSK_API_BASE_URL` to agent `.env`.

### 7.1 Agent Loop — Four Responsibilities

| Task | Interval | Kiosk App Route Called |
|---|---|---|
| Claim and print jobs | Every 3 seconds | `GET /api/kiosk/[id]/queue` |
| Report job result | After each job | `PATCH /api/kiosk/[id]/job/[jid]` |
| Send heartbeat | Every 30 seconds | `POST /api/kiosk/heartbeat` |
| Stale job recovery | Once at startup | Direct Supabase query (no API call needed) |

### 7.2 Print Commands — Windows vs macOS/Linux

#### Windows — Sumatra PDF

| Setting | Sumatra CLI Flag |
|---|---|
| B&W | `-print-settings "monochrome"` |
| Colour | `-print-settings "color"` |
| Duplex long edge | `-print-settings "duplexlong"` |
| Copies (e.g. 3) | `-print-settings "3x"` |
| Page range (2–5) | `-print-settings "2-5"` |
| Full example | `SumatraPDF.exe -print-to "Canon G2000" -print-settings "monochrome,duplexlong,2x,2-5" file.pdf` |

#### macOS & Linux — CUPS (lp command)

| Setting | lp Flag |
|---|---|
| Printer name | `-d printer-name` (find with: `lpstat -p`) |
| B&W | `-o ColorModel=KGray` (or `-o print-color-mode=monochrome`) |
| Colour | `-o ColorModel=RGB` |
| Duplex long edge | `-o sides=two-sided-long-edge` |
| Single sided | `-o sides=one-sided` |
| Copies (3) | `-n 3` |
| Page range (2–5) | `-o page-ranges=2-5` |
| Full example | `lp -d Canon_G2000 -n 2 -o ColorModel=KGray -o sides=two-sided-long-edge -o page-ranges=1-5 file.pdf` |

### 7.3 agent/.env — Complete Variable List

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key — full DB access |
| `KIOSK_ID` | UUID of this kiosk row (created in admin panel) |
| `KIOSK_API_KEY` | Plain API key generated in admin panel (stored hashed in DB) |
| `KIOSK_API_BASE_URL` | `https://kiosk.vaultprintpvtltd.online` — **NEW in v2.0** |
| `PRINTER_NAME` | Windows: `'Canon G2000 series'` · Mac/Linux: `'Canon_G2000'` |

---

## 8. Middleware & Security

### 8.1 Mobile App middleware.ts

| Route | Auth | Rate Limit |
|---|---|---|
| All `/api/jobs/*/payment/*` | `session_id` ownership check (job.session_id in cookie) | 10 req/min per IP |
| All `/api/*` | Public (`session_id` is implicit ownership token) | None |
| `POST /api/webhooks/razorpay` | `X-Razorpay-Signature` HMAC-SHA256 | None — Razorpay server only |

### 8.2 Kiosk App middleware.ts

| Route / Condition | Auth | Rate Limit |
|---|---|---|
| hostname starts with `admin.` | Rewrite to `/admin/*` internally | None |
| `/admin/*` | Supabase Auth session cookie | Standard |
| `/api/kiosk/*` | Bearer token → SHA-256 → `kiosks.api_key_hash` | 20 req/min per `kiosk_id` |
| `/api/kiosk/*/otp` | API key + IP rate limit | 5 req/min per IP — OTP brute-force protection |

### 8.3 OTP Security (unchanged from v1.0)

- `crypto.randomInt(100000, 999999)` — cryptographically secure
- bcrypt hash stored in DB (rounds=10). Plain OTP never stored or logged.
- 15-minute expiry enforced server-side in Kiosk App OTP verify route
- Max 3 wrong attempts → job `status = expired`
- Rate limit: 5 OTP verify requests per minute per IP via Upstash Redis
- Single use: `otp_hash` cleared on successful verification

### 8.4 File Security (unchanged)

- Private Supabase Storage bucket — no public URLs
- File path includes `kiosk_id + job_id` — cross-kiosk access architecturally impossible
- 2-minute signed URLs for print agent. 10-minute signed URLs for PDF preview.
- Auto-delete 24h after completion via storage lifecycle policy

---

## 9. Build Phases — 4-Week Roadmap

### Phase 1 — Foundation (Week 1)

Scaffolding, DB, QR kiosk page, file upload. No payment.

> **✓ TIP** — No physical printer needed for Phase 1 or 2.

| Task | App / Location |
|---|---|
| Init pnpm workspace at root. Create `apps/mobile`, `apps/kiosk`, `packages/db`, `packages/lib`, `packages/ui`. | Root |
| Install Next.js 15 + TypeScript + Tailwind v4 + shadcn/ui in both apps. | `apps/mobile` + `apps/kiosk` |
| Create `packages/db`: Supabase client browser + server helpers. | `packages/db` |
| Run `001_schema.sql` + `002_functions.sql` migrations. Seed `pricing_config`. | `supabase/migrations/` |
| Create private `print-files` Supabase Storage bucket. Set 24h lifecycle. Enable Realtime on `print_jobs`. | Supabase dashboard |
| Build `apps/mobile`: `/start?k=[id]` session creation. `/print/[id]` file upload with presigned URL flow. | `apps/mobile` |
| Build `apps/kiosk`: `/kiosk/[id]` QR display page. QR encodes `app.vaultprintpvtltd.online/start?k=[id]`. | `apps/kiosk` |
| `middleware.ts` in `apps/kiosk`: `admin.` subdomain rewrite + Supabase Auth protection for `/admin/*`. | `apps/kiosk` |
| Build `/admin/kiosks` page + `POST /api/admin/kiosks`: create kiosk, generate + hash API key. | `apps/kiosk` |
| Print agent skeleton: Supabase connection + heartbeat loop calling `KIOSK_API_BASE_URL`. | `agent/` |
| Deploy both Vercel projects. Confirm `app.` and `kiosk.` subdomains resolve with HTTPS. | Vercel |

### Phase 2 — Core Print Flow (Week 2)

Full web flow: configure, pay, OTP, kiosk verify, job queued. No physical print.

| Task | App / Location |
|---|---|
| Customize page: live pricing, all 6 setting controls, `PDFPreview`. | `apps/mobile` |
| `PATCH /api/jobs/[id]/settings`: validate settings, lookup `pricing_config`, return price. | `apps/mobile` |
| Razorpay integration: `POST /api/jobs/[id]/payment/order` + `/verify` with HMAC check. | `apps/mobile` |
| `packages/lib/otp.ts`: `generateOTP` (crypto.randomInt), `hashOTP` (bcrypt), `verifyOTP` (expiry + attempts). | `packages/lib` |
| `packages/lib/razorpay.ts`: `createOrder`, `isValidSignature`. | `packages/lib` |
| `/otp` page: `OTPDisplay`, `CountdownTimer`, `useJobStatus` polling hook. | `apps/mobile` |
| `POST /api/webhooks/razorpay`: idempotent fallback payment confirmation. | `apps/mobile` |
| `POST /api/kiosk/[id]/otp` route: verify hash, expiry, attempts. Return valid/invalid. | `apps/kiosk` |
| `OTPNumpad` + `OTPInputDisplay` + `enter-otp` page. Full touch-accessible numpad. | `apps/kiosk` |
| `/kiosk/[id]/success` page with `AutoReturnTimer` (5s → back to idle). | `apps/kiosk` |
| `useKioskRealtime` hook: subscribe to `print_jobs` WHERE `kiosk_id=id AND status=queued`. Auto-navigate to `enter-otp`. | `apps/kiosk` |
| Verify: pay on `app.` → OTP shown on phone → `kiosk.` switches to numpad < 1 second via Realtime. | Both apps |

### Phase 3 — Print Integration (Week 3)

Physical printer. Print agent complete. All platforms tested.

| Task | Location |
|---|---|
| Complete `agent.js`: `buildCmd()` for `win32`/`darwin`/`linux`. All setting combinations. | `agent/` |
| `POST /api/kiosk/heartbeat` + `GET /api/kiosk/[id]/queue` (calls `claim_next_job` RPC). | `apps/kiosk` |
| `PATCH /api/kiosk/[id]/job/[jid]`: agent reports `completed` or `failed`. | `apps/kiosk` |
| Test all Sumatra PDF modes on Windows: B&W, colour, duplex, copies, page range. | Physical hardware |
| Test all CUPS lp modes on macOS and Linux: same test matrix. | Physical hardware |
| Multi-kiosk test: two agents on different machines, same Supabase — confirm isolation. | Physical hardware |
| Stale job recovery on agent boot. Temp file cleanup after every job. | `agent/` |
| Full E2E physical test: QR scan on phone → paper in hand at kiosk. | Both apps + agent |
| pm2 setup on all three OS platforms. Auto-start confirmed after reboot. | Kiosk PCs |

### Phase 4 — Admin + Launch (Week 4)

| Task | Location |
|---|---|
| Admin fleet dashboard: live kiosk grid, jobs today, revenue today. | `apps/kiosk /admin` |
| Admin jobs table: paginated, filters, refund action. | `apps/kiosk /admin` |
| Admin pricing editor: inline edit, toggle `is_active`. | `apps/kiosk /admin` |
| AWS SES domain verification. `packages/lib/email.ts` OTP backup + receipt emails. | `packages/lib` + AWS |
| Upstash Redis rate limiting in both `apps/mobile` and `apps/kiosk` middleware. | Both middlewares |
| HTTP security headers in both `next.config.ts` files (CSP, X-Frame-Options, HSTS). | Both apps |
| Sentry: `@sentry/nextjs` in both apps. `@sentry/node` in agent. | All three codebases |
| pg_cron: enable + schedule `expire_stale_jobs()` every 5 minutes. | Supabase dashboard |
| Final DNS: both Vercel projects pointed at subdomains. HTTPS confirmed on all three. | DNS + Vercel |
| Soft launch: Kiosk 1 live. Monitor first 50 real jobs via Sentry + Supabase logs. | Production |

---

## 10. Deployment Checklist

### 10.1 Two Vercel Projects

| Project | Root Directory | Custom Domains | Environment Variables |
|---|---|---|---|
| `vaultprint-mobile` | `apps/mobile` | `app.vaultprintpvtltd.online` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| `vaultprint-kiosk` | `apps/kiosk` | `kiosk.vaultprintpvtltd.online`, `admin.vaultprintpvtltd.online` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_KIOSK_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |

> **ℹ NOTE** — Both projects connect to the same GitHub monorepo. Vercel detects changes in `apps/mobile` for project 1 and `apps/kiosk` for project 2. A change to `packages/lib` triggers builds in both.

### 10.2 Supabase Setup

- Create project in `ap-south-1` (Mumbai)
- Run migrations: `001_schema.sql` → `002_functions.sql` → `seed.sql`
- Create `print-files` bucket → **PRIVATE**. Set 24h lifecycle.
- Enable Realtime on `print_jobs` table (`status` column minimum)
- Enable pg_cron. Schedule `expire_stale_jobs()` every 5 minutes.
- Copy `SUPABASE_URL` and both keys into both Vercel project env vars and `agent/.env`

### 10.3 Per-Kiosk PC Setup

1. Install Node.js LTS. Install Sumatra PDF (Windows) or verify CUPS (Mac/Linux).
2. Create `~/vaultprint/` folder. Copy `agent.js` + `.env` (including `KIOSK_API_BASE_URL`).
3. Run: `npm install && npm install -g pm2`
4. Run: `pm2 start agent.js --name vaultprint-agent && pm2 save && pm2 startup`
5. Create Chrome kiosk shortcut: `chrome.exe --kiosk kiosk.vaultprintpvtltd.online/kiosk/[kioskId]`
6. Add Chrome shortcut to OS startup folder. Enable auto-login for kiosk user.

### 10.4 Adding a New Kiosk (2-Minute Process)

1. Open `admin.vaultprintpvtltd.online` → Kiosks → Add New Kiosk → fill name, location, `printer_name`, OS
2. Copy the generated UUID (`KIOSK_ID`) and API key (shown once only)
3. On the new PC: create `.env` with `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `KIOSK_ID`, `KIOSK_API_KEY`, `KIOSK_API_BASE_URL`, `PRINTER_NAME`
4. Run `pm2 start agent.js`. Done — new kiosk appears live in fleet dashboard within 30 seconds.

---

*VaultPrint Engineering Roadmap v2.0 — Document ends*
