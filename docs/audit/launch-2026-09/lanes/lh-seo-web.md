# lh-seo-web — launch audit lane report (2026-09-02)

## Scope (per orchestrator, 2026-09-02)

Owned: `/` (landing), `/browse`, `/jobs` (index), `/legal` + its `?tab=`
sections, `/help`, `/support`, `/login`, `/signup`, and the four account-state
screens — as seen by a crawler / link-unfurler, i.e. the server-rendered
markup, not the post-hydration DOM.

Explicitly OUT of scope by owner ruling (2026-09-02), not audited:
- `/user/:userId` — never public, will not become public; its login-wall meta
  in `api/share.ts` is deliberate and correct, not evaluated further.
- `/jobs/:id` (individual job) — signed-in only as of today. Verified the
  sitemap never listed individual job URLs, so nothing regressed there.

Out of scope per `PROTOCOL.md`/skill: copy quality, performance/CWV,
accessibility, route fit/overflow (owned by other lanes).

## Method

All claims below are against the **live production host**
(`https://www.louisianahelpr.com`), fetched with `curl` (no JS execution) —
this is deliberately what a non-JS crawler/social-unfurler sees, which is the
thing under test. Verified `api/share.ts`'s three vercel.json rewrites
(`/jobs/:id`, `/signup?ref=`, `/user/:userId`) by hitting them with real and
synthetic data (a live open job pulled read-only from prod via `execute_sql`,
a nonexistent UUID, a non-UUID id, a referral code). Verified the og-image
files load (200, correct content-type, correct pixel dimensions matching
their declared `og:image:width/height`) under a plain UA and under
`facebookexternalhit`/`Slackbot` UAs — CLAUDE.md records a prior incident
(email images) where a crawler UA got a 429 challenge a browser UA didn't; not
reproduced here, all UAs get the same 200.

## What I verified working

- **The three `api/share.ts` rewrites work exactly as documented** (curl,
  2026-09-02). `curl https://www.louisianahelpr.com/jobs/34ccf004-b710-4458-bd28-d30734fa0d03`
  (a real open job, read via `execute_sql` against `open_jobs_browse`) →
  `status=200`, `<title>Deep clean two bathrooms before guests arrive —
  Helpr</title>`, description `"Cleaning job in Lafayette · needed Wed, Sep 2
  · $88. ..."`, canonical `.../jobs/34ccf004-...`. `curl .../jobs/00000000-0000-0000-0000-000000000000`
  → `status=200`, title `"This job is no longer available — Helpr"`. `curl
  .../jobs/not-a-uuid` → same honest-absent card, not a crash. `curl
  .../signup?ref=abc123` → `status=200`, title `"You've been invited to
  Helpr"`; bare `curl .../signup` → falls through to the generic shell
  (no per-referrer cache poisoning). Query selects only
  `id,title,category,budget,location,date_needed,pricing_mode,expires_at` —
  grepped `api/share.ts` directly — so the "no `description`/`photos`/
  `customer_id`" privacy claim in the file's own comments matches the code.
- **og:image / og:image-square load correctly and are the declared size**
  (curl, 2026-09-02): `curl -o og.png .../og-image.png?v=h2` → `file og.png`
  = "PNG image data, 1200 x 630" (matches declared `og:image:width/height`);
  `og-image-square.png` = 1024×1024. `curl -A facebookexternalhit/1.1` and
  `-A Slackbot-LinkExpanding` both → `status=200 type=image/png size=119208`,
  same as a plain UA — no 429/challenge like the historical email-image
  incident (`emails-logo-blocked-by-vercel.md`).
- **JSON-LD (`LocalBusiness` + `Organization`, static in `index.html`) is
  honest and both blocks parse as valid JSON.** Every claim in them (area
  served, hours, contact email) matches what the app actually is.
- **Apex → www redirect is a real 307/308** and `/legal?tab=` variants each
  carry their own genuine, distinct client-side canonical
  (`PAGE_CANONICALS` in `legalSections.ts`) rather than colliding into one
  URL or duplicating three ways — this part is well-designed.
- **robots.txt `Allow: /` + sitemap.xml were internally consistent** (no
  drift: `node scripts/generate-sitemap.mjs --check` passed before I touched
  anything) and no private surface was listed in the sitemap.

## Findings filed (bus: `docs/audit/launch-2026-09/findings.jsonl`)

| id | severity | status | what |
|---|---|---|---|
| SW-001 | MEDIUM | **filed, not fixed** | Every route except the 3 share-rewrites serves byte-identical homepage `<title>`/description/canonical/OG to any non-JS consumer — `usePageMeta` only writes tags in a `useEffect`. |
| SW-002 | LOW | **filed, not fixed** | Same root cause, sharper consequence: the served canonical on every one of those routes points at the bare homepage, an active (not merely absent) wrong-canonical signal. |
| SW-003 | MEDIUM | **fixed** | `robots.txt` had zero `Disallow` rules; every authed/admin/account-state route returned 200 with the generic shell to a non-JS crawler (soft-privatepage). |
| SW-004 | LOW | **fixed** | Homepage injected a fabricated `BreadcrumbList` (Home → Legal) that doesn't describe any real trail on that page. |
| SW-005 | POLISH | **fixed** | Sitemap generator had no concept of query-string route variants, so `/legal?tab=community` and `/legal?tab=privacy` — each with their own real canonical — were undiscoverable except by crawl. |

## What I fixed

1. **`public/robots.txt`** — added `Disallow` for every authenticated/
   admin/account-state path (`/admin`, `/dashboard`, `/profile`, `/messages`,
   `/post-job`, `/my-jobs`, `/my-posts`, `/payment-success`, `/gift-card`,
   `/settings`, `/availability`, `/earnings`, `/schedule`, `/saved-helpers`,
   `/complete-profile`, `/warnings`, `/activity`, `/data-rights`,
   `/account-pending`, `/account-denied`, `/account-banned`,
   `/signup-pending`, `/forgot-password`, `/reset-password`, `/user/`,
   `/jobs/`), while leaving `/jobs` (the public index) crawlable. This is a
   **mitigation**, not the full fix — `Disallow` stops routine crawling but
   doesn't guarantee a URL with inbound links stays out of the index, and the
   underlying pages still serve 200 + generic tags if fetched directly (that
   residual is SW-001/SW-002, still open). A complete fix needs server-side
   per-route noindex, which is outside what a static `robots.txt` edit can do.
2. **`src/pages/Index.tsx`** — removed the fabricated `BreadcrumbList` JSON-LD
   and its now-unused definition. `webAppSchema` and `faqSchema` (both
   accurate) are untouched.
3. **`scripts/generate-sitemap.mjs`** — added `parseExtraLegalTabPaths()`,
   which reads `PAGE_CANONICALS` from `legalSections.ts` (not hand-typed, so
   it can't drift from what `Legal.tsx` actually sets) and includes
   `/legal?tab=community` + `/legal?tab=privacy` in the generated sitemap.
   Also fixed `normalize()`, used by `--check`, to compare `pathname + search`
   instead of `pathname` alone — it previously would have silently collided
   `/legal` and its two tab variants into one entry and missed real drift.
   Regenerated `public/sitemap.xml` (6 → 8 URLs); `--check` passes clean.

## What I deliberately did NOT fix, and why

- **SW-001 / SW-002 — the actual root cause (client-only meta).** Fixing this
  properly means extending the `api/share.ts` SSR-rewrite pattern (or an
  equivalent) to more routes — `/legal`, `/help`, `/support`, `/browse`, the
  `/jobs` index — which means adding `rewrites` entries to `vercel.json`.
  `vercel.json` is explicitly out of my authority (orchestrator-only, and
  CLAUDE.md records three separate production outages from edits to that
  file). I filed both findings with full evidence and am relaying the
  recommendation to `team-lead` rather than touching that file myself.
- **Individual `/jobs/:id` and `/user/:userId` optimization** — out of scope
  per the owner's explicit 2026-09-02 ruling; not audited further, per
  instruction.

## Coverage manifest

| surface | non-JS meta checked | notes |
|---|---|---|
| `/` | ✅ clean | canonical, title, description, OG, JSON-LD all correct for the homepage itself |
| `/jobs` (index) | ⚠️ SW-001 | generic homepage meta server-side; correct only after JS |
| `/browse` | ⚠️ SW-001 | same |
| `/legal`, `?tab=community`, `?tab=privacy` | ⚠️ SW-001 (meta) / ✅ (canonicals are real, now in sitemap) | |
| `/help` | ⚠️ SW-001 | |
| `/support` | ⚠️ SW-001 | |
| `/login` | ⚠️ SW-001 | correctly excluded from sitemap already |
| `/signup` (no ref) | ⚠️ SW-001 | correctly excluded from sitemap already |
| `/signup?ref=<code>` | ✅ clean | via `api/share.ts` rewrite, verified live |
| `/jobs/:id` | ✅ clean (found/absent/malformed all verified with real + synthetic data) | out of scope for further optimization per owner ruling; page itself is signed-in only |
| `/user/:userId` | not audited | out of scope per owner ruling |
| account-state screens (`/account-pending`, `/account-denied`, `/account-banned`, `/signup-pending`) | ⚠️ SW-001/SW-003 | now `Disallow`ed in robots.txt; correctly absent from sitemap already |
| `robots.txt` | ✅ fixed (SW-003) | |
| `sitemap.xml` | ✅ fixed (SW-005), verified all 8 URLs 200 via curl, none private | |
| structured data (`LocalBusiness`, `Organization`, `WebApplication`, `FAQPage`) | ✅ clean, `BreadcrumbList` fixed (SW-004) | no fabricated claims remain |
| og:image / og:image-square | ✅ clean | 200 under browser + 2 crawler UAs, correct dimensions |

## UNVERIFIED / not exercised
- Live share-card rendering inside actual iMessage/Slack/Facebook clients
  (only the raw HTTP response + tag values were checked, not each platform's
  own scraper/cache behavior) — no way to self-provision those consumers from
  this environment; the HTTP-level evidence (correct tags, correct absolute
  image URL, 200 status, no UA-based cloaking) is the closest available proof
  and is what the evidence bar asks for.
- `npm run typecheck` / `vitest` gate — not run per standing instruction
  (stagger gates, ask team-lead); `node scripts/parsecheck.mjs` run clean on
  every file I touched. Requesting the gate from team-lead before this is
  considered fully verified.

## Files touched

- `public/robots.txt`
- `src/pages/Index.tsx`
- `scripts/generate-sitemap.mjs`
- `public/sitemap.xml` (generated)
- `docs/audit/launch-2026-09/findings.jsonl` (bus appends)
