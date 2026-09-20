# IndexPilot — URL Discovery & Indexing Platform

A SaaS platform for submitting URLs in bulk — including third-party URLs and
backlinks you do not own — validating them, running them through a modular
discovery pipeline, verifying their index status over time, and reporting the
result.

> **The rule this product is built on:** processing success is not indexing. A
> provider accepting a submission never sets an "indexed" status. Only an index
> check does, and it records its own confidence and limitations alongside the
> verdict. There is no "guaranteed indexing" claim anywhere in this codebase.

---

## Stack

TypeScript monorepo (pnpm workspaces).

| Layer | Technology |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, Tailwind, Radix primitives, TanStack Query, React Hook Form + Zod, Recharts |
| API | Fastify 5, Zod, REST `/api/v1`, Server-Sent Events |
| Database | PostgreSQL + Prisma |
| Queues | Redis + BullMQ |
| Workers | Standalone Node service |
| Storage | S3-compatible (MinIO locally) or local filesystem |
| Tests | Vitest (unit + integration), Playwright (E2E + responsive) |

```
apps/web      Next.js UI (customer + admin) and the public /tools pages
apps/api      Fastify REST API, auth, RBAC, credits, SSE, public tool endpoints
apps/worker   BullMQ consumers (validation, discovery, verification, reports, maintenance)
packages/     config · shared · validation (SSRF, robots, meta, sitemap) · db (ledger) · providers (adapters)
```

---

## Quick start

**Prerequisites:** Node 20+, pnpm 9, Docker (for PostgreSQL and Redis).

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: <http://localhost:3000>
- API: <http://localhost:4000> (health at `/health`)
- Mailpit (dev inbox): <http://localhost:8025>
- MinIO console: <http://localhost:9001>

Seeded development accounts:

| Role | Email | Password |
| --- | --- | --- |
| Customer | `demo@indexpilot.local` | `Demo123!pass` |
| Super admin | `admin@indexpilot.local` | `Admin123!pass` |

> The seed refuses to run when `NODE_ENV=production`.

### Without Docker

Point `DATABASE_URL` and `REDIS_URL` at any PostgreSQL 14+ and Redis 6+ instance
and skip `docker compose up`. The compose file uses ports **5433** and **6380**
to avoid clashing with local installs.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | API + worker + web together |
| `pnpm dev:api` / `dev:worker` / `dev:web` | One service |
| `pnpm build` | Prisma generate + build all three services |
| `pnpm start:api` / `start:worker` / `start:web` | Run the built services |
| `pnpm typecheck` | Strict TypeScript across every package |
| `pnpm lint` / `pnpm lint:fix` | ESLint (zero warnings allowed) |
| `pnpm test` | Vitest — unit + integration |
| `pnpm test:e2e` | Playwright (starts the stack if it is not running) |
| `pnpm test:e2e:install` | Download the Playwright browser |
| `pnpm db:migrate` / `db:migrate:deploy` | Migrations (dev / production) |
| `pnpm db:seed` / `db:reset` / `db:studio` | Seed, reset, inspect |
| `pnpm verify` | typecheck + lint + tests |

Integration tests need PostgreSQL and Redis; they **skip themselves** with a
clear message when neither is reachable, so `pnpm test` still runs unit tests on
a bare machine.

---

## How it works

```
Submit ─▶ Validate ─▶ Queue ─▶ Discovery providers ─▶ Index verification ─▶ Report
          (SSRF-safe)                                  (scheduled, repeated)
```

1. **Submission** — paste, TXT/CSV upload, or API. URLs are normalized
   conservatively (query strings preserved), deduplicated within the payload and
   against the project, and priced before anything is charged.
2. **Credits** — URL rows and the debit commit in one transaction. If the balance
   cannot cover them, nothing is created and nothing is charged.
3. **Validation** — an SSRF-safe fetch records status, redirect chain, robots.txt
   verdict, `noindex` directives, canonical URL and content type. URLs that can
   never be crawled end here and their credit is refunded automatically.
4. **Discovery** — the URL is routed to providers by priority, with rate limits
   and health-based cooldown. Every attempt is recorded, including failures.
5. **Verification** — scheduled index checks record a verdict, a confidence score
   and a plain-English limitation note. Re-checked up to `VERIFICATION_MAX_CHECKS`.
6. **Reporting** — CSV export generated in the background and stored in S3.

### Status vocabulary

A URL carries three independent statuses (validation / processing / verification)
and the UI derives one label from them:

| Label | Meaning |
| --- | --- |
| `Discovery attempted` | A provider accepted the submission. **Not** an indexing claim. |
| `Crawl detected` | A crawl signal was observed. |
| `Index check pending` | Waiting for the next scheduled check. |
| `Indexed (confirmed)` | A check observed the URL in search results. |
| `Not confirmed indexed` | The check did not find it. Public lookups cannot see the whole index, so it may still be indexed. |
| `Blocked` | robots.txt, `noindex`, or network policy stopped it before processing. |

---

## Free public tools

Unauthenticated SEO tools under `/tools`, served from the same codebase as the
product. They are the acquisition channel: each route targets one keyword, needs
no account, and links into the paid platform.

Two engines back thirteen routes. The engines are real code; the routes are rows
in `tool_definitions` that admins can edit, disable and add to without a deploy.

| Engine | Routes | What it does |
| --- | --- | --- |
| `ROBOTS_TXT` | `/tools/robots-txt-tester`, `-checker`, `-validator` | Fetches robots.txt, tests a path against the rules and **names the directive that decided it**, and lints the file line by line. |
| `PAGE_META` | `/tools/meta-checker`, `meta-title-checker`, `meta-description-checker`, `title-tag-checker`, `seo-title-checker`, `canonical-checker` | Title, description, canonical, headings and robots directives, with a live SERP preview. |
| `SITEMAP` | `/tools/sitemap-checker`, `sitemap-finder`, `sitemap-validator`, `xml-sitemap-checker` | Discovers the sitemap via robots.txt then common paths, validates the XML, and checks the URLs inside it. |

### Two things worth knowing

**Lengths are measured in pixels, not characters.** Google truncates by rendered
width, so `lllllllll` and `WWWWWWWWW` are the same character count and nowhere
near the same width. `packages/validation/src/pixel-width.ts` measures with Arial
advance widths, which is what the desktop SERP renders.

**These endpoints fetch URLs a stranger chose**, so they carry their own limits
on top of the global rate limiter:

- the same SSRF policy as the paid pipeline, with no relaxations;
- a per-IP hourly quota (`TOOLS_RATE_LIMIT_ANON_PER_HOUR`), separate from the
  API-wide limiter, because this one exists to protect *other people's* servers;
- a hard cap on URLs checked per sitemap run, so a sitemap with 50,000 entries
  cannot turn this service into a flood against the site that published it;
- robots.txt is honoured when crawling a sitemap's URLs — a tool that checks
  robots compliance must not itself ignore it;
- results are cached briefly (`TOOLS_CACHE_TTL_SECONDS`) so repeat checks of a
  popular domain hit it once, not once per visitor.

Redis being unavailable degrades the cache and the quota rather than taking the
tools down; the cache uses its own connection with fail-fast settings, because
the BullMQ client is configured to queue commands indefinitely.

### Admin

`/admin → Tools` lists every route with its run count, and opens an off-canvas
editor for the slug, copy, metadata and access flags. Completions are tracked
per route (`tool_runs`) rather than pageviews — that is the number that says
which tool to build on next.

---

## Configuration

Everything is environment driven and validated at boot (`packages/config`) — the
process fails fast with a readable message rather than starting half-configured.
`.env.example` documents every variable, grouped as APP, DATABASE, REDIS, AUTH,
URL VALIDATION / SSRF, SUBMISSION LIMITS, STORAGE, EMAIL, PAYMENTS, PROVIDERS and
OBSERVABILITY.

Ones worth knowing:

| Variable | Notes |
| --- | --- |
| `SESSION_SECRET` | 32+ chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ENCRYPTION_KEY` | 64 hex chars; encrypts provider/payment secrets at rest. |
| `ALLOW_PRIVATE_NETWORK_FETCH` | Development only. Refuses to boot in production. Never opens cloud metadata. |
| `CREDITS_PER_URL`, `SIGNUP_BONUS_CREDITS`, `MAX_URLS_PER_SUBMISSION` | Commercial knobs. |
| `PAYMENT_DRIVER` | `mock` (local, signed webhooks) or `stripe`. |
| `STORAGE_DRIVER` | `local` or `s3`. |
| `SERP_API_ENDPOINT` / `SERP_API_KEY` | Enables real index verification. Without them the checker reports an error instead of guessing. |

### Adding a discovery provider

1. Implement `DiscoveryProvider` in `packages/providers/src/discovery/`.
2. Map the provider's vocabulary to internal outcomes in that adapter.
3. Register it in `PROVIDER_FACTORIES` and add a row to
   `discovery_provider_configs` (or enable it in the admin panel).

No core changes required. Providers can be enabled, prioritised and rate-limited
from the admin panel at runtime.

---

## Admin

Beyond provider and package configuration, the admin panel can:

- **Sign in as a user** — a one-hour impersonated session. The session acts as
  that user, but a banner stays visible the whole time and every audit row keeps
  naming the real admin. An admin can never impersonate equal or greater
  privilege, and super admins cannot be impersonated at all.
- **Set a password directly**, for accounts that cannot receive the reset email.
  Every session is revoked and the action is audited; the password is never
  emailed or stored in plaintext.
- **Block and unblock accounts**, adjust credits, change roles (super admin
  only), revoke sessions, and grant individual accounts access to gated tools.

Every one of these requires a reason, which is written to the audit log with the
acting admin's identity.

---

## Production notes

- Build once, run three processes: `apps/api`, `apps/worker`, `apps/web`. Scale
  the worker independently of the API.
- Apply migrations with `pnpm db:migrate:deploy` (never `migrate dev`).
- Set `COOKIE_SECURE=true`, a real `SESSION_SECRET` and `ENCRYPTION_KEY`, and a
  `CORS_ORIGINS` allow-list.
- Health probes: `/health/live` (liveness), `/health/ready` (readiness —
  PostgreSQL + Redis), `/health` (aggregate for dashboards).
- Logs are structured JSON with request/job correlation ids and secret redaction.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — services, data model, status
  model, provider abstraction, idempotency guarantees.
- [`docs/API.md`](docs/API.md) — REST reference, auth, pagination, idempotency,
  error envelope.
- [`docs/SECURITY.md`](docs/SECURITY.md) — SSRF policy, auth, CSRF, money safety,
  and what is deliberately not claimed.
