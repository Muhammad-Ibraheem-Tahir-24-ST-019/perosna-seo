# REST API v1

Base URL: `https://<host>/api/v1`

The browser reaches the API through the Next.js rewrite at `/api/*`, so the
session cookie is first-party. Machine clients call the API service directly.

---

## Authentication

Two credentials are accepted.

**Session cookie** (browser). `ip_session` is `HttpOnly`, `SameSite=Lax`, and
`Secure` when `COOKIE_SECURE=true`. Because a cookie is ambient authority, every
unsafe method (`POST`/`PATCH`/`DELETE`) must also send the CSRF token:

```
x-csrf-token: <value of the readable ip_csrf cookie>
```

**API key** (machine). No CSRF requirement — the credential is never sent
automatically by a browser:

```
Authorization: Bearer ip_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are shown once at creation and stored only as a SHA-256 hash plus a prefix.

---

## Conventions

- JSON in, JSON out. `202 Accepted` means work was queued, not completed.
- **Errors** always use one envelope:

```json
{
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Not enough credits: 120 required, 48 available.",
    "details": { "required": 120, "available": 48 },
    "requestId": "0f1c0c0e-..."
  }
}
```

Codes: `BAD_REQUEST`, `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INSUFFICIENT_CREDITS`,
`PAYLOAD_TOO_LARGE`, `PROVIDER_ERROR`, `ACCOUNT_SUSPENDED`, `INTERNAL`.

- **Pagination** is cursor based:

```json
{ "items": [ ... ], "nextCursor": "eyJjcmVhdGVkQXQiOi..." }
```

Pass it back as `?cursor=...&limit=50` (limit is clamped to 1–200).

- **Idempotency**: send `Idempotency-Key: <unique-per-submission>` on submission
  endpoints. A replay returns the original result and charges nothing.
- **Rate limits**: 300 requests/minute per user (or per IP when anonymous);
  auth endpoints 10/min, submissions 30/min, uploads 10/min. `429` responses
  carry `retry-after`.

---

## Endpoints

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/auth/register` | `{ email, password, name? }` → `201` + session. Password ≥ 10 chars with a letter and a number. |
| `POST` | `/auth/login` | `{ email, password }`. Identical message for unknown email and wrong password. |
| `POST` | `/auth/logout` | Revokes the session server-side. |
| `GET` | `/auth/me` | Current user + credit balance. |
| `POST` | `/auth/forgot-password` | Always the same response, whether or not the address exists. |
| `POST` | `/auth/reset-password` | `{ token, password }`. Revokes all sessions. |
| `POST` | `/auth/verify-email` | `{ token }`. |
| `POST` | `/auth/change-password` | `{ currentPassword, newPassword }`. Revokes all sessions. |
| `PATCH` | `/auth/profile` | `{ name }`. |
| `GET` | `/auth/sessions` | Session metadata only — tokens are never returned. |
| `DELETE` | `/auth/sessions/:id` | Revoke one session. |

### Projects

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/projects` | `?includeArchived=true`. Each item carries computed stats. |
| `POST` | `/projects` | `{ name, description? }`. Duplicate active name → `409`. |
| `GET` | `/projects/:id` | |
| `PATCH` | `/projects/:id` | `{ name?, description?, status? }` (`ACTIVE` \| `ARCHIVED`). |
| `GET` | `/projects/:id/urls` | `?status=&search=&cursor=&limit=` |
| `GET` | `/projects/:id/events` | Server-Sent Events: `open`, `stats`, `reconnect`. |

### Submission

```http
POST /api/v1/projects/{projectId}/urls
Authorization: Bearer ip_live_...
Content-Type: application/json
Idempotency-Key: 2f8c-unique-key

{ "urls": ["https://example.com/a", "https://example.com/b"] }
```

`urls` accepts a newline-separated string or an array. Response `202`:

```json
{
  "batchId": "cmu5...",
  "received": 5,
  "accepted": 2,
  "duplicatesInPayload": 1,
  "duplicatesInProject": 0,
  "invalid": 2,
  "creditsCharged": 2,
  "creditsRemaining": 48,
  "invalidSamples": [{ "url": "javascript:alert(1)", "reason": "Unsupported protocol \"javascript\"..." }]
}
```

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects/:id/urls/preview` | Parses and prices a payload **without** charging. |
| `POST` | `/projects/:id/uploads` | `multipart/form-data`, field `file`, `.txt`/`.csv`/`.tsv`. Optional `columnIndex` field for ambiguous CSVs. |

### URLs and jobs

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/urls` | `?projectId=&status=&search=&cursor=` |
| `GET` | `/urls/:id` | Full detail: validation diagnostics, every processing attempt, every index check. |
| `GET` | `/jobs/:id` | Poll one URL by its id: the three status dimensions plus recent job records. |
| `GET` | `/batches/:id` | Submission batch summary. |

### Credits and billing

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/credits` | `{ balance, lifetimeSpent }` |
| `GET` | `/credits/transactions` | Immutable ledger, newest first. |
| `GET` | `/billing/packages` | |
| `POST` | `/billing/checkout` | `{ packageId }` → `{ paymentId, checkoutUrl }` |
| `GET` | `/billing/payments` | |
| `POST` | `/webhooks/payments` | Provider → platform. Signature verified; replays are idempotent. |

### Reports

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/reports` | |
| `POST` | `/reports` | `{ projectId?, filter }` where filter is `all`, `indexed_confirmed`, `not_confirmed`, `failed`, `blocked`, `pending`. → `202` |
| `GET` | `/reports/:id` | |
| `GET` | `/reports/:id/download` | CSV stream. Links expire after seven days. |

### API keys

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api-keys` | Prefix + metadata only. |
| `POST` | `/api-keys` | `{ name }` → `{ apiKey, secret }`. **The secret is returned once.** |
| `DELETE` | `/api-keys/:id` | Revoke. |

### Admin

All routes require `ADMIN`; the ones marked 🔐 require `SUPER_ADMIN`.

| Method | Path | Action |
| --- | --- | --- |
| `GET` | `/admin/overview` | Users, URLs, revenue, credits, queues, provider health |
| `GET` | `/admin/users` | Search and page through customers |
| `GET` | `/admin/users/:id` | Profile, wallet, ledger reconciliation, payments, keys |
| `POST` | `/admin/users/:id/credits` | **Grant or remove credits.** Non-zero amount + reason, audited |
| `POST` | `/admin/users/:id/suspension` | Suspend/unsuspend; suspension revokes sessions |
| `PATCH` | `/admin/users/:id/role` | 🔐 Change role. Cannot change your own; cannot remove the last super admin |
| `POST` | `/admin/users/:id/password-reset` | Email a reset link and revoke sessions |
| `POST` | `/admin/users/:id/password` | **Set a password directly.** Revokes every session; reason required |
| `POST` | `/admin/users/:id/revoke-sessions` | Sign the account out everywhere |
| `POST` | `/admin/users/:id/impersonate` | **Sign in as this user.** Swaps your session cookie for a one-hour impersonated one |
| `GET` | `/admin/tools` · `/admin/tools/analytics` | Public tool catalogue and completion counts |
| `POST` | `/admin/tools` · `PATCH`/`DELETE` `/admin/tools/:id` | Create, edit and remove tool pages |
| `POST` | `/admin/tools/seed` | Import any built-in tool pages not yet in the database |
| `POST` | `/admin/users/:id/tool-access` | Grant a user access to a gated tool |
| `DELETE` | `/admin/users/:id/tool-access/:toolId` | Revoke that grant |
| `GET` | `/admin/projects` · `/admin/urls` | Cross-tenant listings |
| `POST` | `/admin/urls/:id/requeue` | Send a URL back through the whole pipeline |
| `GET` | `/admin/queues` · `/admin/jobs/failed` | Queue depth and dead jobs |
| `POST` | `/admin/jobs/:id/retry` | Retry a failed job |
| `GET` | `/admin/providers` | Provider list (never includes credentials) |
| `PATCH` | `/admin/providers/:id` | Enable/disable, priority, rate limit, daily cap |
| `PUT` | `/admin/providers/:id/credentials` | 🔐 Store credentials encrypted (write-only) |
| `GET` | `/admin/credit-packages` | All packages including hidden ones |
| `POST` | `/admin/credit-packages` | Create a package |
| `PATCH` | `/admin/credit-packages/:id` | Edit price, size, visibility |
| `DELETE` | `/admin/credit-packages/:id` | Delete, or retire it if it has been sold |
| `GET` | `/admin/payments` | All payments |
| `POST` | `/admin/payments/:id/refund` | Refund at the provider **and** claw back credits |
| `GET` | `/admin/audit-logs` · `/admin/api-usage` | Who did what; API traffic |

**Refund semantics.** The clawback is keyed on the payment, so refunding twice
reverses once. If the customer has already spent the credits the call returns
`409` with `{ granted, available, shortfall }`; repeat it with
`{"allowPartial": true}` to reverse only what remains. Partial reversals are
recorded in the audit log.

Provider credentials are never included in any admin response, and the audit log
records only which key names were set — never their values.

**Impersonation semantics.** `POST /admin/users/:id/impersonate` replaces the
caller's session cookie with one that acts as the target user and carries
`impersonatedBy` on `/auth/me`, so the UI can show a persistent banner. An admin
cannot impersonate equal or greater privilege, and super admins cannot be
impersonated at all. The session expires after an hour; `POST
/auth/stop-impersonation` ends it early. Both the start and the end are audited
against the real admin, not the impersonated user.

### Public tools

These are the only endpoints under `/api/v1` that work without authentication.
Signing in raises the quota but is never required.

| Method | Path | Action |
| --- | --- | --- |
| `GET` | `/tools` | List the enabled, listed tool pages |
| `GET` | `/tools/:slug` | One tool's copy and metadata |
| `POST` | `/tools/robots` | `{ url, paths?, userAgent?, slug? }` — fetch and lint robots.txt, test paths |
| `POST` | `/tools/meta` | `{ url, slug? }` — title, description, canonical, headings, SERP preview |
| `POST` | `/tools/sitemap` | `{ url, checkUrls?, slug? }` — find, validate and status-check a sitemap |

Every run response carries `meta` (`cached`, `cacheAgeSeconds`, `durationMs`)
and `quota` (`remaining`, `limit`, `resetSeconds`). The quota is also returned as
`x-tool-quota-limit` / `x-tool-quota-remaining` headers, and exhausting it
returns `429` with a `RATE_LIMITED` envelope.

`slug` is optional and names the landing page the run came from; it is recorded
for analytics and decides which tool's access rules apply.

These endpoints fetch a URL the caller chose, so they enforce the full SSRF
policy, a per-IP hourly quota separate from the API-wide limiter, and a hard cap
on how many URLs one sitemap run may request. See the README for the reasoning.

### Health

`GET /health/live`, `GET /health/ready`, `GET /health` (also mirrored under
`/api/v1/health` so the browser can reach it through the same proxy).

---

## Typical automation loop

```bash
# 1. Create a project (once)
curl -X POST https://your-host/api/v1/projects \
  -H "Authorization: Bearer $IP_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Nightly backlinks"}'

# 2. Submit URLs (idempotent - safe to retry)
curl -X POST https://your-host/api/v1/projects/$PROJECT/urls \
  -H "Authorization: Bearer $IP_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: nightly-$(date +%F)" \
  -d '{"urls":["https://example.com/a","https://example.com/b"]}'

# 3. Poll status
curl https://your-host/api/v1/jobs/$URL_ID -H "Authorization: Bearer $IP_KEY"

# 4. Export
curl -X POST https://your-host/api/v1/reports \
  -H "Authorization: Bearer $IP_KEY" -H "Content-Type: application/json" \
  -d '{"projectId":"'$PROJECT'","filter":"all"}'
```

## Reading statuses correctly

`DISCOVERY_ATTEMPTED` and `CRAWL_DETECTED` describe work the platform performed.
Only `verificationStatus` speaks about the search index, and
`NOT_CONFIRMED_INDEXED` means "this check did not find it" — not "it is not
indexed". Each `IndexCheck` carries `confidence` and a `limitations` string;
surface them rather than rounding to a yes/no.
