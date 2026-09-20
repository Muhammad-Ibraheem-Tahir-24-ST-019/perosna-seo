# Security

The platform accepts URLs on domains the customer does not own, spends money on
behalf of customers, and stores third-party credentials. This document states
what is defended, how, and what is deliberately *not* claimed.

---

## 1. SSRF — the primary threat

Every server-side fetch targets an attacker-controlled URL by design. The policy
lives in `packages/validation/src/ssrf.ts` and is enforced by the fetcher in
`fetcher.ts`.

### Blocked

| Category | Examples |
| --- | --- |
| Loopback | `127.0.0.0/8`, `::1`, `localhost`, `ip6-localhost` |
| Private (RFC1918) | `10/8`, `172.16/12`, `192.168/16`, IPv6 ULA `fc00::/7` |
| Carrier-grade NAT | `100.64.0.0/10` |
| Link-local | `169.254.0.0/16`, `fe80::/10` |
| Cloud metadata | `169.254.169.254`, `169.254.170.2`, `100.100.100.200`, `fd00:ec2::254`, `metadata.google.internal`, `metadata`, `instance-data` |
| Multicast / reserved / broadcast | `224/4`, `240/4`, `255.255.255.255`, `::`, `ff00::/8`, documentation ranges |
| Container / internal names | any single-label host (`redis`, `postgres`, `minio`), `.local`, `.internal`, `.intranet`, `.lan`, `.home`, `.corp`, `.private`, `.test`, `.onion` |
| Obfuscated literals | decimal (`2130706433`), hex (`0x7f000001`), octal (`0177.0.0.1`), short form (`127.1`) |
| Embedded IPv4 in IPv6 | `::ffff:127.0.0.1`, `2002:7f00:1::` (6to4), `64:ff9b::a00:1` (NAT64) |
| Non-HTTP protocols | `file:`, `ftp:`, `gopher:`, `data:`, `javascript:` and everything except `http`/`https` |
| Infrastructure ports | 22, 25, 3306, 5432, 6379, 9200, 11211, 27017, … |

### How it is enforced

1. **Scheme** is checked first; only `http`/`https` continue.
2. **Hostname** policy runs before any DNS traffic.
3. **DNS is resolved once**, and *every* returned address is validated. A mixed
   answer (one public + one private address — the classic rebinding signature)
   rejects the host outright.
4. **The socket is pinned** to a validated address using an undici `Agent` with a
   custom `lookup`. The address that was checked is the address connected to,
   which closes the TOCTOU/DNS-rebinding window. TLS still uses the real hostname
   for SNI and certificate verification.
5. **Every redirect hop repeats steps 1–4** from scratch. Redirects are followed
   manually (never delegated to the HTTP client) precisely so this can happen.
6. **Resource limits**: connect/headers/body timeouts, a redirect cap, and a
   streamed body that is hard-capped and then torn down.

### The development escape hatch is narrow

`ALLOW_PRIVATE_NETWORK_FETCH=true` opens loopback and RFC1918 so developers can
point the platform at a local test server. It does **not** open cloud metadata or
link-local addresses — those stay blocked in every environment — and the config
loader refuses to boot with it enabled while `NODE_ENV=production`.

Covered by `tests/unit/ssrf.test.ts` and `tests/integration/safe-fetch.test.ts`,
which drives a real local server that redirects into the metadata endpoint, into
`file:`, and into the Redis port.

---

## 2. Authentication and sessions

- Passwords hashed with **scrypt** (Node built-in), per-password random salt,
  constant-time comparison. Minimum 10 characters with a letter and a digit.
- Sessions are opaque random tokens; only a SHA-256 hash is stored. Revocation is
  server-side, so a stolen cookie stops working immediately after logout.
- Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`,
  with a configurable domain.
- Login returns one identical message for an unknown email and a wrong password,
  and always performs a hash comparison to flatten timing.
- Password reset never reveals whether an address is registered. Tokens are
  single-use, hashed, and expire in one hour.
- Changing a password or resetting it revokes every existing session.
- Suspending an account revokes its sessions immediately.

## 3. CSRF

Cookie-authenticated unsafe methods require `x-csrf-token` to match the readable
`ip_csrf` cookie (double-submit), compared in constant time. API-key requests are
exempt because a browser never attaches them automatically. Login, registration,
password reset and webhooks are exempt by necessity and are protected by their
own rate limits or signatures.

## 4. Authorisation

- Roles: `USER`, `AGENCY` (reserved), `ADMIN`, `SUPER_ADMIN`.
- Enforced in the API and in the database query itself — every customer-facing
  query is scoped by `userId`. Hiding a button is never the control.
- Cross-tenant project access returns `404`, not `403`, so ids cannot be probed.
- Admin routes are gated by an `onRequest` hook on the whole plugin.
- Tested in `tests/integration/api.test.ts` ("tenant isolation", "admin").

## 5. API keys

Generated as `ip_live_` + 24 random bytes. Only a SHA-256 hash and a 16-character
prefix are stored; the secret is returned exactly once at creation and appears in
no list response, log or error. Keys are revocable and track `lastUsedAt`.

## 6. Money

- Credits are an append-only ledger; the wallet balance is a cache moved only
  inside the ledger transaction.
- Unique `(wallet, type, referenceType, referenceId)` makes every movement
  exactly-once: retries, duplicate submissions and replayed webhooks are no-ops.
- Debits use a conditional `UPDATE ... WHERE balance + delta >= 0`, so concurrent
  submissions cannot overspend (tested with 20 concurrent debits against 10 credits).
- Webhook signatures are verified before any business logic (HMAC-SHA256; Stripe's
  scheme includes a timestamp tolerance to prevent replay).
- Admin credit adjustments require a reason and are written to the audit log.

## 7. Input handling

- Every request body and query string is parsed with Zod; unknown fields are dropped.
- Uploads: extension allow-list (`.txt`, `.csv`, `.tsv`), size cap, and content is
  parsed as text regardless of the declared MIME type — the client's content type
  and filename are never trusted.
- CSV export escapes cells and neutralises leading `=`, `+`, `-`, `@` so a
  submitted URL cannot become a spreadsheet formula.
- URLs are length-limited, protocol-restricted, and credentials in URLs are rejected.
- Prisma parameterises all queries; the few raw statements are tagged templates
  with bound parameters.

## 8. Rate limiting and abuse

Global 300/min per authenticated user (per IP when anonymous); 10/min on auth
endpoints, 30/min on submissions, 10/min on uploads. The limiter runs after
authentication so a signed-in user gets their own budget rather than sharing an
office IP.

## 9. Secrets and logging

- Provider and payment secrets are encrypted at rest with AES-256-GCM and are
  never serialised to any API response, including admin endpoints.
- Logs redact authorization headers, cookies, CSRF tokens, passwords, API keys
  and session tokens.
- Submitted URLs are logged without their query string, because query strings
  routinely carry access tokens.
- Production error responses contain a code, a safe message and a request id —
  never a stack trace or a driver error.

## 10. Transport and headers

`@fastify/helmet` sets the security headers on the API; the web app adds
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` and a
restrictive `Permissions-Policy`. CORS is an explicit origin allow-list with
credentials enabled, not a wildcard.

## 11. What is not claimed

- The platform does **not** guarantee indexing, and no code path writes an
  "indexed" status from a provider response.
- Index verification is only as good as its data source. Without a licensed SERP
  data API configured, the checker reports `ERROR` rather than inventing a verdict,
  and negative results are always `NOT_CONFIRMED_INDEXED`.
- The development mock provider contacts no search engine and labels every result
  as simulated.

## 12. Reporting a vulnerability

Email the address in the deployment's support configuration with reproduction
steps. Please do not open a public issue for an unpatched vulnerability.
