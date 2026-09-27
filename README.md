# SEO Micro-Tools & IndexPilot Platform

[![Next.js 15](https://img.shields.io/badge/Next.js-15.1-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Free SEO Tools](https://img.shields.io/badge/100%25_Free-No_Login_Required-emerald)](https://github.com/abdulbasitameerali/Index-pilot)

A professional, high-performance **technical SEO micro-tools platform** engineered for SEO practitioners, growth marketers, and web engineers. Features **13 targeted SEO utilities** powered by server-side, SSRF-protected diagnostic engines with true **Arial pixel-width SERP calculations**, zero login barriers, and instant analysis.

---

## ⚡ Key Highlights

- **100% Free & Open Access**: No paygates, no forced account creation, and no credit card requirements.
- **True Desktop SERP Simulation**: Google measures snippet truncation in **pixels (~580px title, ~960px snippet)**, not character counts. Uses rendered Arial font advance metrics for pixel accuracy.
- **High-Intent SEO Tools**: 13 focused keyword landing pages covering Robots.txt testing, Meta tag audits, Title/Description pixel sizing, Canonical validation, and XML Sitemap verification.
- **SSRF-Protected Server Engine**: Server-side fetching eliminates CORS issues with strict IP allowlisting (rejects private subnets, localhost, AWS/GCP cloud metadata endpoints) and built-in 15-minute caching.
- **Optimized for AdSense & Core Web Vitals**: Pre-allocated fixed-dimension ad containers (`h-[90px]`, `data-ad-slot`) eliminate Cumulative Layout Shift (CLS). Full compliance pages (About, Contact, Privacy, Terms).
- **Modern Responsive Design**: Accessible 3-column navigation mega-menu, glassmorphic header, mobile drawer navigation, dark/light theme support, and semantic JSON-LD (`FAQPage`, `SoftwareApplication`) schemas.

---

## 🛠️ The 13 Free SEO Micro-Tools

All tools run on 3 high-speed server engines with in-memory caching and real-time validation:

| Engine | Tool Slug | Primary Capability |
| :--- | :--- | :--- |
| **Robots.txt & Crawling** | `/tools/robots-txt-tester` | Tests paths against robots.txt directives and highlights the exact matching rule. |
| | `/tools/robots-txt-checker` | Validates live robots.txt availability, HTTP status, and syntax errors. |
| | `/tools/robots-txt-validator` | Line-by-line syntax linter detecting unsupported directives and format mistakes. |
| **Meta Tags & SERP** | `/tools/meta-title-checker` | Calculates exact pixel length against desktop Google limits (~580px) with SERP preview. |
| | `/tools/meta-description-checker` | Slices description snippet at desktop pixel boundary (~960px) with truncation indicator. |
| | `/tools/meta-checker` | Audits `<title>`, `<meta description>`, OpenGraph, Twitter cards, and viewport. |
| | `/tools/title-tag-checker` | Analyzes title tag presence, character count, and pixel dimensions. |
| | `/tools/seo-title-checker` | Comprehensive SERP snippet preview with real Google search appearance styling. |
| | `/tools/canonical-checker` | Verifies canonical tag self-referencing, cross-domain links, and mismatch alerts. |
| **XML Sitemaps** | `/tools/sitemap-checker` | Checks XML sitemap HTTP response, gzip encoding, URL count, and structure. |
| | `/tools/sitemap-finder` | Auto-detects sitemap locations via `robots.txt` directives and standard paths. |
| | `/tools/sitemap-validator` | Validates XML schema compliance, lastmod timestamps, and broken link patterns. |
| | `/tools/xml-sitemap-checker` | Full sitemap health audit checking index files and child URL status. |

---

## 📐 Technology Architecture

```
Index-pilot (Monorepo)
├── apps/
│   ├── web/                     # Next.js 15 App Router Frontend & Standalone Tool APIs
│   │   ├── src/app/             # Pages: Homepage, 13 Tool Landers, About, Contact, Privacy, Terms
│   │   ├── src/app/api/v1/tools # SSRF-Safe Standalone API Route Handlers
│   │   ├── src/components/      # UI Design System: PublicShell, ToolsNav mega-menu, Brand logo
│   │   └── src/lib/server-tools # Diagnostic Engines (Robots, Meta/SERP, Sitemap) + Cache
│   ├── api/                     # Optional Fastify 5 REST backend for bulk jobs & queues
│   └── worker/                  # BullMQ Background Job Consumers
├── packages/
│   ├── shared/                  # Shared Tool Catalog, Engine Types, Constants
│   ├── validation/              # Zod schemas, Arial pixel-width calculator, SSRF guard
│   └── config/                  # Environment variable schema validation
└── docker-compose.prod.yml       # Production container orchestration
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: v20 or higher
- **pnpm**: v9 or higher (recommended)

### 1. Clone & Install
```bash
git clone https://github.com/abdulbasitameerali/Index-pilot.git
cd Index-pilot
pnpm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
*(Default settings work out-of-the-box for standalone tools without external dependencies).*

### 3. Start Development Server
To run the Next.js web application with all free SEO tools:
```bash
# Start Next.js web app (http://localhost:3000)
pnpm --filter @indexpilot/web dev
```

Or run the full monorepo stack:
```bash
pnpm dev
```

Visit **<http://localhost:3000>** in your browser.

---

## 🔌 Standalone REST API Endpoints

The web application exposes public, server-side API endpoints for programmatic analysis:

### 1. Test Robots.txt
```http
POST /api/v1/tools/robots
Content-Type: application/json

{
  "url": "https://example.com/robots.txt",
  "path": "/admin/dashboard",
  "userAgent": "Googlebot"
}
```
**Response:**
```json
{
  "success": true,
  "verdict": "disallowed",
  "matchingRule": "Disallow: /admin/",
  "lineNumber": 14,
  "sitemaps": ["https://example.com/sitemap.xml"],
  "cached": false
}
```

### 2. Inspect Meta Tags & SERP Dimensions
```http
POST /api/v1/tools/meta
Content-Type: application/json

{
  "url": "https://example.com"
}
```
**Response:**
```json
{
  "success": true,
  "title": "Example Domain — Free Diagnostic Tools",
  "titlePixels": 420,
  "titleTruncated": false,
  "description": "Comprehensive technical SEO diagnostic suite.",
  "descriptionPixels": 380,
  "descriptionTruncated": false,
  "canonical": "https://example.com/",
  "isCanonicalSelf": true,
  "cached": false
}
```

### 3. Check XML Sitemap
```http
POST /api/v1/tools/sitemap
Content-Type: application/json

{
  "url": "https://example.com/sitemap.xml"
}
```
**Response:**
```json
{
  "success": true,
  "sitemapUrl": "https://example.com/sitemap.xml",
  "urlCount": 42,
  "isSitemapIndex": false,
  "validXml": true,
  "cached": false
}
```

---

## 🔒 Security & Safe Fetching (SSRF Guard)

Every server-side URL request is passed through strict SSRF protection:
- **DNS Resolution Check**: Resolves hostname before connecting; private IPv4/IPv6 address blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`) are immediately aborted.
- **Cloud Metadata Blocking**: Restricts access to AWS/GCP/Azure link-local metadata endpoints (`169.254.169.254`).
- **Response Size & Timeout Limits**: Maximum body response capped at 2MB with a strict 7-second fetch timeout to prevent hanging connections.
- **In-Memory Rate Limiting**: Built-in 120 requests/hour per IP token bucket for public endpoints to prevent abuse.

---

## 🧪 Quality Assurance & Testing

```bash
# Type check all packages & apps
pnpm typecheck

# Lint codebase (ESLint)
pnpm lint

# Unit & integration tests
pnpm test

# End-to-end browser tests (Playwright)
pnpm test:e2e
```

---

## 🐳 Production Deployment

### Docker Deployment
Build and run using Docker Compose:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Health Check
- Web Health: `<http://localhost:3000>`
- API Liveness: `<http://localhost:4000/health/live>`
- API Readiness: `<http://localhost:4000/health/ready>`

---

## 📄 License & Attribution

Distributed under the MIT License. See `LICENSE` for details. Built for technical SEO specialists and web engineers worldwide.
