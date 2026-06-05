# VaultPrint Core App — Product Requirements Document

| Field | Value |
|---|---|
| **Document Version** | 2.0 |
| **Status** | Draft |
| **Product** | VaultPrint Core App |
| **Author** | Aditya Vishwakarma |
| **Created** | June 2026 |
| **Last Updated** | June 2026 |
| **Scope** | Core kiosk printing platform (excludes marketing website) |
| **Change from v1.0** | Kiosk Display App and Mobile Web App are now separate Next.js applications on separate subdomains, in a shared monorepo |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [Success Metrics](#3-success-metrics)
4. [User Personas](#4-user-personas)
5. [User Stories](#5-user-stories)
6. [System Architecture — Two-App Model](#6-system-architecture--two-app-model)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Technical Requirements](#9-technical-requirements)
10. [Integration Requirements](#10-integration-requirements)
11. [Security Requirements](#11-security-requirements)
12. [Multi-Kiosk Requirements](#12-multi-kiosk-requirements)
13. [API Specifications](#13-api-specifications)
14. [Database Requirements](#14-database-requirements)
15. [Out of Scope — v1](#15-out-of-scope--v1)
16. [Acceptance Criteria](#16-acceptance-criteria)
17. [Risk Register](#17-risk-register)
18. [Dependencies](#18-dependencies)
19. [Glossary](#19-glossary)

---

## 1. Executive Summary

VaultPrint is a QR-based, self-service document printing kiosk platform. The core app is the actual product — the system that enables a user to scan a QR code, upload a document on their phone, pay securely via Razorpay, receive a one-time PIN, and collect a printed document from the kiosk. No staff involvement. No app installation. No account creation.

The platform is designed from day one to support a **fleet of kiosks** — colleges, hostels, government offices, co-working spaces — all managed from a single admin dashboard. Every kiosk is independent but shares the same codebase, infrastructure, and management interface.

**v2.0 Architecture Change:** The system is built as a **monorepo with two distinct Next.js applications**, each hosted on its own subdomain:

| App | Subdomain | Purpose |
|---|---|---|
| **Kiosk App** | `kiosk.vaultprintpvtltd.online` | Full-screen Chrome display on the physical kiosk machine — QR code, OTP numpad, success screen |
| **Mobile App** | `app.vaultprintpvtltd.online` | Mobile-first web app on the user's phone — upload, configure, pay, view OTP |
| **Admin Panel** | `admin.vaultprintpvtltd.online` | Fleet management, job history, pricing — accessed via same Kiosk App deployment with middleware rewrite |

Both apps share a common `packages/` layer containing database types, Supabase client helpers, OTP logic, Razorpay helpers, and email utilities. The Print Agent remains a standalone Node.js service in `/agent`.

This PRD defines all requirements across **four subsystems**:
- **Mobile Web App** — the phone-facing Next.js app at `app.vaultprintpvtltd.online`
- **Kiosk Display App** — the kiosk-facing Next.js app at `kiosk.vaultprintpvtltd.online`
- **Admin Panel** — the management interface at `admin.vaultprintpvtltd.online` (same deployment as Kiosk App, middleware-routed)
- **Print Agent** — the Node.js background service that triggers physical printing

---

## 2. Product Vision & Goals

### 2.1 Vision Statement

> *To make document printing as frictionless as sending a message — private, instant, and available anywhere.*

### 2.2 Product Goals

| # | Goal | Why It Matters |
|---|---|---|
| G1 | Zero friction for end users | Any user with a phone should complete a print job in under 60 seconds, with no downloads or logins |
| G2 | Complete document privacy | The user's file must never be seen by a human — only the OTP holder can release the print |
| G3 | 100% uptime per kiosk | A kiosk that is offline loses trust and revenue — the system must recover automatically |
| G4 | Infinite horizontal scale | Adding kiosk #10 or kiosk #100 must require zero code changes — admin panel entry only |
| G5 | Cross-platform hardware flexibility | Kiosks can run Windows, macOS, or Linux — the software must work identically on all three |
| G6 | Operator visibility | Kiosk owners must see live status, jobs, and revenue for every machine in their fleet |
| G7 | Clean separation of concerns | The kiosk display and the mobile user flow are different UX contexts — separate apps allow independent optimization, deployment, and design systems |

### 2.3 Non-Goals for v1

- Marketing website (separate project at `vaultprintpvtltd.online`)
- Native mobile app
- Multi-language / i18n support
- Loyalty or subscription system
- IoT sensor integration (ink/paper levels)
- Google Drive / Dropbox file import

---

## 3. Success Metrics

### 3.1 User-Facing KPIs

| Metric | Target | Measurement Method |
|---|---|---|
| Time from QR scan to OTP display | < 90 seconds (happy path) | Timestamps: `created_at` vs `otp_expires_at` minus 15 min |
| Payment success rate | > 92% | Razorpay dashboard — orders vs successful payments |
| OTP entry success rate (first attempt) | > 85% | `otp_attempts = 0` on completed jobs |
| Print failure rate | < 2% | `status = 'failed'` / total completed |
| Session abandon rate (after upload) | < 15% | Jobs stuck in `uploaded` or `customized` status |

### 3.2 System KPIs

| Metric | Target | Measurement Method |
|---|---|---|
| API response time (p95) | < 400ms | Vercel Analytics |
| Kiosk display page load | < 1.5s on 4G | Lighthouse / Speed Insights |
| Mobile app page load | < 2s on 4G | Lighthouse / Speed Insights |
| Print agent heartbeat loss | < 0.1% over 30 days | Supabase audit_log |
| Job claim race condition (double-print) | 0 occurrences | audit_log + physical observation |
| Uptime (both Next.js apps) | 99.9% | Vercel uptime monitor |

---

## 4. User Personas

*(Unchanged from v1.0 — see original document for full persona details)*

- **4.1 Priya** — End user, engineering student, prints from phone
- **4.2 Rahul** — Kiosk operator / IT admin, manages fleet
- **4.3 Print Agent** — Non-human; software persona driving reliability requirements

---

## 5. User Stories

*(All user stories from v1.0 are retained. The following notes clarify which app fulfils each story.)*

| ID | Story | Fulfilled By |
|---|---|---|
| US-01 | Scan QR code → upload page, no login | Mobile App (`app.`) |
| US-02 | Upload PDF, page count detected | Mobile App (`app.`) |
| US-03 | Choose B&W/colour, copies, page range, orientation, duplex | Mobile App (`app.`) |
| US-04 | See exact total price before paying | Mobile App (`app.`) |
| US-05 | Pay via UPI/card/wallet | Mobile App (`app.`) |
| US-06 | Receive 6-digit OTP after payment | Mobile App (`app.`) |
| US-07 | OTP shown with countdown timer | Mobile App (`app.`) |
| US-08 | Enter OTP on kiosk, document prints | Kiosk App (`kiosk.`) |
| US-09 | Document deleted after printing | Both apps + Agent |
| US-10 | OTP backup by email | Mobile App (`app.`) |
| US-11 | Error message + auto refund on failure | Both apps |
| US-12 | Retry OTP with remaining attempts shown | Kiosk App (`kiosk.`) |
| US-13 to US-20 | Admin stories | Admin Panel (`admin.` via `kiosk.`) |
| US-21 to US-24 | Print agent stories | Print Agent |

---

## 6. System Architecture — Two-App Model

### 6.1 Subdomain Map

| Subdomain | App | Vercel Deployment | Purpose |
|---|---|---|---|
| `vaultprintpvtltd.online` | Marketing site | Separate project | Landing page, business info (out of scope) |
| `app.vaultprintpvtltd.online` | Mobile App (`apps/mobile`) | Vercel project: `vaultprint-mobile` | User phone flow — upload, configure, pay, OTP |
| `kiosk.vaultprintpvtltd.online` | Kiosk App (`apps/kiosk`) | Vercel project: `vaultprint-kiosk` | Kiosk display — QR, OTP numpad, success |
| `admin.vaultprintpvtltd.online` | Admin Panel (inside `apps/kiosk`) | Same Vercel project as kiosk | Fleet management, routed by middleware |

### 6.2 Why Two Apps, Not One

| Concern | Single App (v1.0) | Two Apps (v2.0) |
|---|---|---|
| Design system | One Tailwind config, compromises for both contexts | Mobile app: 360px-first, touch-optimised. Kiosk app: 1080p-first, large touch targets |
| Deployment independence | A kiosk display bug forces re-testing mobile flow | Each app deploys, tests, and rolls back independently |
| Bundle size | Kiosk JS includes all mobile components (wasted) | Each app only ships what it uses |
| Chrome kiosk mode isolation | Kiosk Chrome can't accidentally navigate to mobile pages | Separate domain makes cross-navigation impossible by default |
| URL clarity | `/kiosk/[id]` vs `/print/[id]` — same domain, confusing | `kiosk.` vs `app.` — immediately clear which context you're in |
| Security surface | One middleware handles all auth | Each app's middleware is scoped to exactly its routes |

### 6.3 Shared Layer (Monorepo Packages)

Both apps import from shared packages. **Nothing is duplicated.**

| Package | Path | What It Contains |
|---|---|---|
| `@vaultprint/db` | `packages/db` | Supabase client (browser + server), generated TypeScript types, all DB query helpers |
| `@vaultprint/lib` | `packages/lib` | `otp.ts`, `razorpay.ts`, `email.ts`, `pdf.ts` — pure logic, no framework dependencies |
| `@vaultprint/ui` | `packages/ui` | Shared shadcn/ui base components (Button, Input, Badge) — not page-level components |

### 6.4 API Routes — Where They Live

All API routes live in the **Mobile App** (`apps/mobile/app/api/`) **except** kiosk-authentication endpoints and admin endpoints which live in the **Kiosk App** (`apps/kiosk/app/api/`).

| API Route Group | Lives In | Reason |
|---|---|---|
| `/api/session/create` | Mobile App | Called when user scans QR and lands on `app.` |
| `/api/upload/*` | Mobile App | User uploads file from phone |
| `/api/jobs/[id]/*` | Mobile App | User configures, pays, checks status |
| `/api/webhooks/razorpay` | Mobile App | Razorpay calls back to `app.` webhook URL |
| `/api/kiosk/heartbeat` | Kiosk App | Print agent pings `kiosk.` domain |
| `/api/kiosk/[id]/otp` | Kiosk App | OTP submitted from kiosk display on `kiosk.` |
| `/api/kiosk/[id]/queue` | Kiosk App | Agent polls `kiosk.` for jobs |
| `/api/kiosk/[id]/job/[jid]` | Kiosk App | Agent reports completion to `kiosk.` |
| `/api/admin/*` | Kiosk App | Admin panel is served from `kiosk.` / `admin.` |

### 6.5 Communication Between the Two Apps

The two apps do **not** call each other directly. They share data exclusively through **Supabase**:

- Mobile App writes to `print_jobs` (creates, pays, queues)
- Kiosk App reads from `print_jobs` via Supabase Realtime (listens for `status = queued`)
- Print Agent reads/writes `print_jobs` via Kiosk App API routes
- Both apps read `pricing_config` and `kiosks` tables

There are **no HTTP calls from `app.` to `kiosk.`** or vice versa. Supabase is the single source of truth.

---

## 7. Functional Requirements

### 7.1 Session Creation (QR Entry)

| ID | Requirement | App | Priority |
|---|---|---|---|
| FR-01 | The QR code on the kiosk screen MUST encode `https://app.vaultprintpvtltd.online/start?k=[kioskId]` | Kiosk App | P0 |
| FR-02 | Scanning the QR MUST open the Mobile App (`app.`) in the user's phone browser | Mobile App | P0 |
| FR-03 | The Mobile App MUST create a session (print_jobs row) and redirect to `/print/[sessionId]` | Mobile App | P0 |
| FR-04 | The Mobile App MUST validate the kiosk exists and is not offline before creating a session | Mobile App | P0 |
| FR-05 | Offline kiosk scans MUST show an informative error on the Mobile App, not a blank screen | Mobile App | P0 |
| FR-06 | The kiosk QR MUST refresh every 5 minutes | Kiosk App | P2 |

### 7.2 File Upload

*(Requirements FR-07 through FR-14 — all fulfilled by the Mobile App. Unchanged from v1.0.)*

| ID | Requirement | App |
|---|---|---|
| FR-07 | Supabase Storage presigned URL for direct browser upload | Mobile App |
| FR-08 | Server never handles file bytes | Mobile App |
| FR-09 | PDF only, MIME validated server-side | Mobile App |
| FR-10 | 50MB file size limit at presign stage | Mobile App |
| FR-11 | Page count extracted via pdf-lib after confirm | Mobile App |
| FR-12 | Real-time upload progress bar | Mobile App |
| FR-13 | Private bucket path: `print-files/{kiosk_id}/{job_id}.pdf` | Mobile App |
| FR-14 | Auto-delete files 24h after completion | Both (storage policy) |

### 7.3 Print Configuration

*(Requirements FR-15 through FR-20 — all fulfilled by the Mobile App. Unchanged from v1.0.)*

### 7.4 Payment

*(Requirements FR-21 through FR-26 — all fulfilled by the Mobile App. Unchanged from v1.0.)*

### 7.5 OTP System

| ID | Requirement | App | Priority |
|---|---|---|---|
| FR-27 | OTP generated with `crypto.randomInt(100000, 999999)` | Mobile App (generates) | P0 |
| FR-28 | OTP stored as bcrypt hash — never plaintext | Mobile App (stores) | P0 |
| FR-29 | OTP expires 15 minutes after generation | Mobile App (sets expiry) | P0 |
| FR-30 | Expired OTP verification returns clear expiry error | Kiosk App (verifies) | P0 |
| FR-31 | Max 3 wrong OTP attempts tracked per job | Kiosk App (verifies) | P0 |
| FR-32 | After 3 failed attempts, job status → `expired` | Kiosk App (verifies) | P0 |
| FR-33 | Plain OTP shown exactly once on Mobile App screen | Mobile App | P0 |
| FR-34 | Optional OTP email backup via AWS SES | Mobile App | P1 |
| FR-35 | 15-minute countdown timer on OTP display | Mobile App | P0 |

### 7.6 Kiosk Display

| ID | Requirement | App | Priority |
|---|---|---|---|
| FR-36 | Kiosk idle screen displays full-screen QR encoding `app.` URL | Kiosk App | P0 |
| FR-37 | Kiosk subscribes to Supabase Realtime — switches to OTP entry when job queued | Kiosk App | P0 |
| FR-38 | Large numeric numpad on OTP entry screen, touch and keyboard accessible | Kiosk App | P0 |
| FR-39 | Job context shown on OTP entry (pages, colour, copies) | Kiosk App | P1 |
| FR-40 | Success/printing screen shown after correct OTP | Kiosk App | P0 |
| FR-41 | Auto-return to idle QR screen after 5 seconds | Kiosk App | P0 |
| FR-42 | Wrong OTP entry shows remaining attempts | Kiosk App | P0 |
| FR-43 | All kiosk pages run full-screen with no browser chrome (`--kiosk` flag) | Kiosk App | P0 |

### 7.7 Print Agent

*(Requirements FR-44 through FR-54 — unchanged from v1.0. Agent polls `kiosk.vaultprintpvtltd.online` API routes.)*

| ID | Requirement | Note |
|---|---|---|
| FR-44 | Polls every 3 seconds | GET `kiosk./api/kiosk/[id]/queue` |
| FR-45 | `claim_next_job()` with `FOR UPDATE SKIP LOCKED` | DB-level |
| FR-46 | Detects OS at startup | `process.platform` |
| FR-47 | Windows: Sumatra PDF CLI | `SumatraPDF.exe -print-to` |
| FR-48 | macOS/Linux: CUPS `lp` command | Built-in |
| FR-49 | Downloads PDF via 2-min signed URL | From Kiosk App API |
| FR-50 | Deletes local temp PDF after every job | Always |
| FR-51 | Heartbeat every 30s | POST `kiosk./api/kiosk/heartbeat` |
| FR-52 | Managed by pm2, auto-restart on crash | — |
| FR-53 | Updates job to `completed` or `failed` | PATCH `kiosk./api/kiosk/[id]/job/[jid]` |
| FR-54 | Only processes jobs for its own `KIOSK_ID` | DB filter |

### 7.8 Admin Dashboard

*(Requirements FR-55 through FR-63 — all fulfilled by the Admin Panel at `admin.vaultprintpvtltd.online`. Middleware in the Kiosk App handles subdomain routing. Unchanged from v1.0.)*

---

## 8. Non-Functional Requirements

### 8.1 Performance

| ID | Requirement | Target | App |
|---|---|---|---|
| NFR-01 | API response time (p95, all endpoints) | < 400ms | Both |
| NFR-02 | Kiosk QR page initial load on 4G | < 1.5s | Kiosk App |
| NFR-03 | Mobile upload page initial load on 4G | < 2s | Mobile App |
| NFR-04 | Realtime event: payment → kiosk screen switch | < 500ms | Kiosk App |
| NFR-05 | PDF page count extraction | < 3s for 50 pages | Mobile App |
| NFR-06 | Print agent job pickup latency (queued → printing) | < 5 seconds | Agent |

### 8.2 Reliability, Scalability, Usability, Maintainability

*(NFR-07 through NFR-24 are unchanged from v1.0, now applying to both apps independently. Each app deploys, monitors, and rolls back independently on Vercel.)*

---

## 9. Technical Requirements

### 9.1 Technology Stack

| Layer | Technology | Applies To |
|---|---|---|
| Framework | Next.js 15 (App Router) | Both apps |
| Language | TypeScript 5.x | Both apps + Agent |
| Styling | Tailwind CSS v4 | Both apps (separate configs) |
| Components | shadcn/ui | Both apps (shared via `packages/ui`) |
| Database | Supabase (PostgreSQL, ap-south-1) | Both apps |
| Payments | Razorpay | Mobile App only |
| Email | AWS SES v3 | Mobile App only |
| Print (Windows) | Sumatra PDF CLI | Agent |
| Print (macOS/Linux) | CUPS lp | Agent |
| Process Manager | pm2 | Agent |
| Rate Limiting | Upstash Redis | Both apps (separate instances or shared) |
| Hosting | Vercel | Two separate Vercel projects |
| Monorepo Tooling | pnpm workspaces | Both apps + packages |

### 9.2 Monorepo Structure

```
vaultprint/                          Root — pnpm workspace
├── apps/
│   ├── mobile/                      Mobile App → app.vaultprintpvtltd.online
│   │   ├── app/
│   │   │   ├── (user)/
│   │   │   │   ├── start/page.tsx        /start?k=[kioskId]
│   │   │   │   └── print/[sessionId]/
│   │   │   │       ├── page.tsx          Upload step
│   │   │   │       ├── customize/        Print settings + live price
│   │   │   │       ├── payment/          Razorpay checkout
│   │   │   │       ├── otp/              OTP display + countdown
│   │   │   │       └── done/             Completion screen
│   │   │   └── api/
│   │   │       ├── session/create/
│   │   │       ├── upload/presign/
│   │   │       ├── upload/confirm/
│   │   │       ├── jobs/[id]/settings/
│   │   │       ├── jobs/[id]/status/
│   │   │       ├── jobs/[id]/payment/order/
│   │   │       ├── jobs/[id]/payment/verify/
│   │   │       └── webhooks/razorpay/
│   │   ├── components/
│   │   │   └── user/           FileDropzone, CustomizeForm, RazorpayButton, OTPDisplay
│   │   ├── hooks/
│   │   │   └── use-job-status.ts
│   │   ├── middleware.ts        Session ownership checks, rate limiting
│   │   ├── next.config.ts
│   │   └── package.json
│   │
│   └── kiosk/                       Kiosk App → kiosk.vaultprintpvtltd.online
│       ├── app/
│       │   ├── (kiosk)/
│       │   │   └── kiosk/[kioskId]/
│       │   │       ├── page.tsx          QR idle screen
│       │   │       ├── enter-otp/        OTP numpad
│       │   │       └── success/          Print success animation
│       │   ├── (admin)/
│       │   │   └── admin/
│       │   │       ├── page.tsx          Fleet dashboard
│       │   │       ├── login/            Auth login
│       │   │       ├── kiosks/           Kiosk management
│       │   │       ├── jobs/             Job history + refunds
│       │   │       └── pricing/          Pricing editor
│       │   └── api/
│       │       ├── kiosk/heartbeat/
│       │       ├── kiosk/[id]/otp/
│       │       ├── kiosk/[id]/queue/
│       │       ├── kiosk/[id]/job/[jid]/
│       │       └── admin/kiosks/
│       │           └── jobs/[id]/refund/
│       ├── components/
│       │   ├── kiosk/          QRCodeDisplay, OTPNumpad, SuccessScreen
│       │   └── admin/          FleetTable, JobsTable, PricingEditor
│       ├── hooks/
│       │   └── use-kiosk-realtime.ts
│       ├── middleware.ts        Admin auth (Supabase session), kiosk API key auth, subdomain rewrite for admin.
│       ├── next.config.ts
│       └── package.json
│
├── packages/
│   ├── db/                          Shared Supabase client + types
│   │   ├── client.ts                createBrowserClient
│   │   ├── server.ts                createServerClient
│   │   ├── types.ts                 Generated from Supabase schema
│   │   └── package.json
│   ├── lib/                         Shared pure logic
│   │   ├── otp.ts                   generateOTP, hashOTP, verifyOTP
│   │   ├── razorpay.ts              createOrder, isValidSignature
│   │   ├── email.ts                 sendOTPEmail, sendReceiptEmail (AWS SES)
│   │   ├── pdf.ts                   extractPageCount (pdf-lib)
│   │   └── package.json
│   └── ui/                          Shared base components
│       ├── button.tsx
│       ├── input.tsx
│       └── package.json
│
├── agent/                           Print Agent — standalone Node.js
│   ├── agent.js
│   ├── package.json
│   └── .env.example
│
├── supabase/                        DB migrations (shared)
│   ├── migrations/001_schema.sql
│   ├── migrations/002_functions.sql
│   └── seed.sql
│
├── pnpm-workspace.yaml
└── package.json
```

### 9.3 Admin Panel Subdomain Routing

The Admin Panel is **not a third Next.js app**. It is a route group inside `apps/kiosk`. The `middleware.ts` of the Kiosk App handles the subdomain rewrite:

```
Request: admin.vaultprintpvtltd.online/kiosks
→ middleware.ts detects hostname starts with 'admin.'
→ rewrites to /admin/kiosks internally
→ Supabase Auth session checked for /admin/* routes
→ Served from apps/kiosk/app/(admin)/admin/kiosks/page.tsx
```

This means:
- One Vercel project (`vaultprint-kiosk`) serves both `kiosk.` and `admin.` subdomains
- Kiosk display pages and admin pages are completely separate route groups
- Admin auth (Supabase session) and kiosk auth (API key) are separate middleware layers

### 9.4 Browser & OS Support

*(Unchanged from v1.0)*

---

## 10. Integration Requirements

*(Unchanged from v1.0, with one clarification: the Razorpay webhook URL is `https://app.vaultprintpvtltd.online/api/webhooks/razorpay` — the Mobile App domain, not the Kiosk App.)*

---

## 11. Security Requirements

### 11.1 Authentication & Authorisation

| Route Pattern | App | Auth Method | Enforcement |
|---|---|---|---|
| `app./api/kiosk-agnostic/*` | Mobile App | session_id cookie ownership | Route handler |
| `app./api/jobs/*/payment/*` | Mobile App | session_id ownership check | Route handler |
| `app./api/webhooks/razorpay` | Mobile App | `X-Razorpay-Signature` HMAC-SHA256 | Route handler |
| `kiosk./api/kiosk/*` | Kiosk App | Bearer token → SHA-256 hash → `kiosks.api_key_hash` | middleware.ts |
| `kiosk./api/kiosk/*/otp` | Kiosk App | API key + rate limit per IP | middleware.ts |
| `kiosk./admin/*` | Kiosk App (admin routes) | Supabase Auth session cookie | middleware.ts |
| `admin./` (via rewrite) | Kiosk App (admin routes) | Supabase Auth session cookie | middleware.ts |

### 11.2–11.4 OTP Security, File Security, Additional Measures

*(Unchanged from v1.0)*

---

## 12. Multi-Kiosk Requirements

*(MK-01 through MK-13 — all unchanged from v1.0. The two-app architecture strengthens isolation: kiosk Realtime subscriptions on `kiosk.` are physically separated from mobile API calls on `app.` at the domain level.)*

---

## 13. API Specifications

### 13.1 Mobile App API Routes (`app.vaultprintpvtltd.online/api/`)

*(All user flow endpoints from v1.0 Section 12.1 — unchanged. Base URL is now `app.vaultprintpvtltd.online`.)*

### 13.2 Kiosk App API Routes (`kiosk.vaultprintpvtltd.online/api/`)

*(All kiosk endpoints from v1.0 Section 12.2 — unchanged. Base URL is now `kiosk.vaultprintpvtltd.online`. Print agent `.env` must set `KIOSK_API_BASE_URL=https://kiosk.vaultprintpvtltd.online`.)*

#### New: `KIOSK_API_BASE_URL` in agent `.env`

The print agent must know which domain to hit. Add to `agent/.env`:
```
KIOSK_API_BASE_URL=https://kiosk.vaultprintpvtltd.online
```

All agent HTTP calls prefix with this URL:
- `POST ${KIOSK_API_BASE_URL}/api/kiosk/heartbeat`
- `GET ${KIOSK_API_BASE_URL}/api/kiosk/${KIOSK_ID}/queue`
- `PATCH ${KIOSK_API_BASE_URL}/api/kiosk/${KIOSK_ID}/job/${jobId}`

### 13.3 Admin API Routes (`admin.vaultprintpvtltd.online/api/` → rewrites to `kiosk.` internally)

*(All admin endpoints from v1.0 Section 12.3 — unchanged.)*

---

## 14. Database Requirements

*(Sections 14.1 through 14.4 — unchanged from v1.0 Sections 13.1–13.4. The schema is identical; both apps connect to the same Supabase project.)*

---

## 15. Out of Scope — v1

*(Unchanged from v1.0)*

---

## 16. Acceptance Criteria

### 16.1 Phase 1 — Foundation

- [ ] Scanning QR from kiosk (`kiosk.` domain) opens Mobile App (`app.` domain) on phone
- [ ] Mobile App creates session row and redirects to `/print/[sessionId]`
- [ ] Uploading a valid PDF stores file in Supabase Storage private bucket at correct path
- [ ] Kiosk QR page at `kiosk.vaultprintpvtltd.online/kiosk/[id]` displays correctly
- [ ] Admin panel accessible at `admin.vaultprintpvtltd.online` (routes to kiosk app `/admin/*`)
- [ ] New kiosk added from admin panel — UUID and API key generated
- [ ] Print agent heartbeat visible in admin dashboard — agent pings `kiosk.` domain

### 16.2 Phase 2 — Core Print Flow

- [ ] Live price updating on Mobile App customize page
- [ ] Razorpay test payment on Mobile App completes and generates OTP
- [ ] OTP displayed on `app.` — Kiosk App (`kiosk.`) switches to numpad within 1 second via Realtime
- [ ] Correct OTP entered at `kiosk.` → job moves to printing state
- [ ] Wrong OTP 3× on `kiosk.` → job expired

### 16.3 Phase 3 — Print Integration

*(Same as v1.0 — physical print testing, agent OS coverage, multi-kiosk isolation)*

### 16.4 Phase 4 — Admin & Launch

- [ ] `admin.vaultprintpvtltd.online` loads fleet dashboard (kiosk app middleware rewrite working)
- [ ] All three domains (`app.`, `kiosk.`, `admin.`) have valid HTTPS certificates
- [ ] Rate limiting on `app.` payment endpoints and `kiosk.` OTP endpoint working independently
- [ ] Sentry projects configured for both Vercel deployments and the print agent

---

## 17. Risk Register

| ID | Risk | Change from v1.0 |
|---|---|---|
| R01–R10 | All original risks unchanged | Mitigations unchanged |
| R11 | **New:** Mobile App deploys but Kiosk App deployment is stale — QR URLs correct but kiosk pages serve old code | **Mitigation:** Vercel GitHub integration deploys both apps from the same monorepo commit. Both must pass CI before merge. |
| R12 | **New:** Agent `.env` has wrong `KIOSK_API_BASE_URL` — agent calls `app.` domain instead of `kiosk.` | **Mitigation:** `agent.js` validates on startup: if `KIOSK_API_BASE_URL` doesn't include `kiosk.`, log a fatal error and exit. |
| R13 | **New:** CORS — Mobile App JavaScript tries to call Kiosk App API directly | **Mitigation:** No cross-app HTTP calls by design. Mobile App only writes to Supabase. Kiosk App only reads from Supabase. Realtime is the bridge. |

---

## 18. Dependencies

### 18.1 Additional Vercel Project

The two-app model requires **two Vercel projects** (not one):

| Project Name | Root Directory | Custom Domains |
|---|---|---|
| `vaultprint-mobile` | `apps/mobile` | `app.vaultprintpvtltd.online` |
| `vaultprint-kiosk` | `apps/kiosk` | `kiosk.vaultprintpvtltd.online`, `admin.vaultprintpvtltd.online` |

Both projects connect to the same GitHub monorepo. Each has its own environment variables set in the Vercel dashboard.

### 18.2 Additional Package Dependencies

| Package | Added To | Purpose |
|---|---|---|
| `pnpm-workspace.yaml` | Root | Monorepo workspace config |
| `typescript` (root) | Root | Shared TS config |
| `@vaultprint/db` (workspace) | Both apps | Internal package — no npm |
| `@vaultprint/lib` (workspace) | Both apps | Internal package — no npm |

---

## 19. Glossary

*(All terms from v1.0 retained, plus:)*

| Term | Definition |
|---|---|
| **Mobile App** | The Next.js application at `app.vaultprintpvtltd.online` — the user's phone-facing flow |
| **Kiosk App** | The Next.js application at `kiosk.vaultprintpvtltd.online` — the physical kiosk display and print agent API |
| **Admin Panel** | The admin interface at `admin.vaultprintpvtltd.online`, served by the Kiosk App via middleware subdomain rewrite |
| **Monorepo** | A single Git repository containing both Next.js apps, shared packages, the print agent, and database migrations |
| **pnpm workspaces** | The package manager feature that enables internal `@vaultprint/*` packages to be shared between apps without publishing to npm |
| **KIOSK_API_BASE_URL** | Environment variable in the print agent's `.env` — set to `https://kiosk.vaultprintpvtltd.online`. All agent HTTP calls use this base URL. |

---

*VaultPrint Core App PRD v2.0 — Document ends*
