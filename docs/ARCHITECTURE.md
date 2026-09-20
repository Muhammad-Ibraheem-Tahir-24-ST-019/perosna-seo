# Architecture

IndexPilot is a URL discovery and indexing-status platform. Customers submit
large volumes of URLs — including URLs on domains they do not own — and the
platform validates them, runs them through a modular discovery pipeline,
verifies index status over time, and reports the outcome.

The single most important rule in this codebase:

> **Processing success is not indexing.** A provider accepting a submission, or a
> crawl signal being observed, never sets an "indexed" status. Only an explicit
> index check can do that, and it records its own confidence and limitations.

---

## 1. Services

| Service | Path | Responsibility |
| --- | --- | --- |
| Web | `apps/web` | Next.js 15 (App Router) UI for customers and admins. Proxies `/api/*` to the API so cookies stay first-party. |
| API | `apps/api` | Fastify 5 REST API, session/API-key auth, RBAC, validation, credit ledger writes, SSE. Enqueues work; never performs it inline. |
| Worker | `apps/worker` | BullMQ consumers: validation, discovery processing, index verification, report generation, maintenance. |

Shared code lives in `packages/`:

| Package | Responsibility |
| --- | --- |
| `config` | Zod-validated environment. Fails fast at boot with a readable message. |
| `shared` | Status model + derivation, error envelope, pagination cursors, crypto helpers, queue names and deterministic job ids. |
| `validation` | URL normalization, CSV/TXT parsing, **SSRF policy**, the safe fetcher, robots.txt and HTML signal extraction. |
| `db` | Prisma schema, client, **credit ledger**, audit log. |
| `providers` | Adapter boundary: discovery providers, index checkers, payment, email, storage. |

Each service is independently deployable and horizontally scalable. The worker
can be scaled separately from the API, which is the point of splitting them.

---

## 2. Request and job flow

```
Browser ── /api/* (same origin) ──▶ Next.js rewrite ──▶ Fastify API
                                                          │
                              auth → RBAC → Zod → service │
                                                          ▼
                                        PostgreSQL (rows + credit ledger)
                                                          │
                                                          ▼
                                              Redis / BullMQ queues
                                                          │
                                                          ▼
                                                      Worker
                              ┌───────────────┬───────────┴────────────┐
                              ▼               ▼                        ▼
                      url-validation    url-processing        index-verification
                      (SSRF-safe        (discovery            (records a verdict
                       pre-flight)       providers)            + its limitations)
```

### Submission, step by step

1. `POST /api/v1/projects/:id/urls` — text, array, or multipart upload.
2. Parse and normalize conservatively (query strings preserved).
3. Drop duplicates inside the payload, then duplicates already in the project.
4. **One transaction**: insert URL rows → debit exactly as many credits as rows
   actually created → write the batch snapshot. Insufficient balance rolls the
   whole thing back, so a customer is never charged for work that was not created.
5. After commit, enqueue one validation job per URL (deterministic job id).
6. Respond `202` with counts, credits charged, and remaining balance.

---

## 3. The three status dimensions

A single overloaded status enum cannot express "discovery submitted, index not
yet checked". So `UrlRecord` stores three independent dimensions and the UI label
is *derived* (`deriveOverallStatus` in `packages/shared/src/status.ts`):

```
validationStatus    RECEIVED → VALIDATING → VALID | INVALID | BLOCKED
processingStatus    NOT_QUEUED → QUEUED → PROCESSING → DISCOVERY_ATTEMPTED
                                                     → CRAWL_DETECTED | FAILED | CANCELLED
verificationStatus  NOT_CHECKED → PENDING → INDEXED_CONFIRMED
                                          | NOT_CONFIRMED_INDEXED | ERROR
```

`NOT_CONFIRMED_INDEXED` is deliberately distinct from "not indexed": a public
lookup cannot see the whole index, so absence is not proof of absence. That
caveat travels with the data into the UI and the CSV export.

---

## 4. Provider abstraction

Business logic never talks to a vendor. It talks to the interfaces in
`packages/providers/src/types.ts`:

- `DiscoveryProvider` — `validateConfig`, `submit`, `getStatus?`, `healthCheck`.
  Provider vocabulary is mapped to internal outcomes (`SUBMITTED`,
  `CRAWL_DETECTED`, `REJECTED`, `RATE_LIMITED`, `ERROR`) at the adapter edge.
  Shipped adapters: `mock` (local, deterministic, no network), `indexnow`
  (a real, documented protocol for Bing/Yandex/Seznam), `crawl-signal` /
  `sitemap-ping` (re-request the URL with the platform crawler and check sitemap
  inclusion — honest discoverability signals, no search engine contacted).
- `IndexChecker` — `MockIndexChecker` for development, `SerpApiIndexChecker` as a
  vendor-neutral adapter for a licensed SERP data API. With no credentials it
  returns `ERROR`, never a fabricated verdict.
- `PaymentProvider` — `MockPaymentProvider` (signed local webhooks) and
  `StripePaymentProvider` (REST + HMAC signature verification, no vendor SDK).
- `EmailProvider`, `StorageProvider` — log/SMTP and local/S3.

`ProviderRegistry` routes by `enabled → priority`, enforces a per-minute token
budget, and cools down a failing provider. A provider failure never stops a URL:
the processor walks to the next candidate.

Adding a provider = one adapter + one entry in `PROVIDER_FACTORIES` + one row in
`discovery_provider_configs`. No core changes.

---

## 5. Credits: an auditable ledger

`CreditTransaction` is append-only. `CreditWallet.cachedBalance` is a cache that
is only ever moved inside the same transaction as the ledger row.

Two invariants are enforced by the database, not by convention:

1. **Unique `(wallet, type, referenceType, referenceId)`** — a retried worker, a
   duplicated API submission, or a replayed payment webhook can only ever apply
   one movement. Replays return the original row.
2. **Conditional balance update** — `UPDATE ... WHERE cachedBalance + delta >= 0`
   returning the new balance. Concurrent debits serialise on the row; the loser
   sees zero rows and gets `INSUFFICIENT_CREDITS`. Twenty concurrent submissions
   against a balance of ten result in exactly ten successes (covered by a test).

`reconcileWallet()` recomputes the balance from the ledger; the admin user detail
screen shows any drift.

---

## 6. Idempotency and crash safety

| Risk | Mitigation |
| --- | --- |
| Duplicate API submission | `Idempotency-Key` → unique `(userId, idempotencyKey)` on `SubmissionBatch`; the stored snapshot is replayed. |
| Worker retry after success | Deterministic BullMQ job ids + status guards + unique `(urlId, attemptNumber)` on `ProcessingAttempt`. |
| Replayed payment webhook | Unique `(provider, providerEventId)` on `PaymentEvent` **and** a ledger movement keyed on the payment id. |
| Double refund | Ledger movement keyed on the URL id. |
| Duplicate verification round | Unique `(urlId, engine, round)` on `IndexCheck`. |
| Crash between commit and enqueue | The maintenance sweep re-queues URLs stuck in `RECEIVED`/`VALIDATING` or `QUEUED`/`PROCESSING` for more than five minutes. |
| Worker dies mid-job | BullMQ stalled-job recovery (`stalledInterval`, `maxStalledCount`), plus `JobRecord` rows for admin visibility and retry. |

> BullMQ rejects custom job ids containing `:`, so all deterministic ids use `-`
> (`packages/shared/src/constants.ts`). Getting this wrong silently drops jobs.

---

## 7. Realtime

`GET /api/v1/projects/:id/events` is a Server-Sent Events stream. Ownership is
checked before the stream opens; it emits aggregate counters for that one project
only, with heartbeats and a maximum duration. The client falls back to normal
polling if the stream drops and refetches canonical state on reconnect rather
than trusting accumulated deltas.

---

## 8. Data model highlights

- Dedup is scoped with `@@unique([projectId, normalizedUrlHash])` — two customers
  (and two campaigns of one customer) may legitimately track the same public URL.
- `UrlValidationResult` stores structured diagnostics (status, redirect chain,
  robots verdict, noindex source, canonical, content type, peer IP), not a boolean.
- `ProcessingAttempt` keeps every attempt including failures.
- `IndexCheck` keeps every check with engine, method, confidence and limitations.
- `AuditLog` records sensitive actions with actor, reason and metadata.
- Provider and payment secrets are stored AES-256-GCM encrypted and are never
  serialised to the browser.

---

## 9. Observability

- Structured JSON logs (pino) with redaction of authorization headers, cookies,
  CSRF tokens, passwords and API keys. Submitted URLs are logged without their
  query string, which routinely carries tokens.
- Request ids on every response and in every error envelope.
- `/health/live` (process), `/health/ready` (PostgreSQL + Redis),
  `/health` (aggregate: dependencies, worker freshness, queue backlog).
- `ApiUsageLog` powers the admin API-usage screen.

---

## 10. Technology choices worth noting

- **scrypt** (Node built-in) for password hashing — strong, no native build step,
  which keeps Windows/Alpine installs painless.
- **undici `Agent` with a pinned `lookup`** for fetching, so the address that was
  validated is the address connected to, while TLS still verifies the real
  hostname.
- **Radix primitives** for dialogs/drawers, because the mobile navigation
  requirements (focus trap, Escape, scroll lock, focus restore) are exactly what
  they implement correctly.
- **Prisma** with an explicit baseline migration in `packages/db/prisma/migrations`.
