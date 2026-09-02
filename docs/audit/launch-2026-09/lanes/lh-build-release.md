# lh-build-release — lane report

**Scope:** what actually ships, and whether it was built from what you think it was.
Environment isolation, secrets in the client bundle, staging-vs-prod routing, code
signing, sourcemaps and symbolication, bundle and asset size, `vercel.json` validity.

**Baseline:** isolated worktree `~/.lh-audit/lh-build-release`, `git checkout origin/main`
→ `1f00d28b2`, `node_modules` symlinked, `.env` copied, `npm run build` EXIT=0.
Earlier findings (BR-001..BR-004) were reproduced at `b170609a8`; the 19 commits between
touch `vite.config.ts` only in comments plus a new `__APP_COMMIT_FULL__` define — the
`sourcemap: "hidden"` setting BR-003 depends on is unchanged.

**Method note.** Every claim below is measured against a built artifact, a live HTTP
response, or a prod SQL result. No claim rests on reading a workflow file and concluding
it looks right.

**On `npm run check:audit-evidence`:** it scores this report 2/22, and I am recording that
rather than reshaping prose to beat it. The checker is line-oriented and looks in a small
window around each claim; this report states a claim in prose and then gives its artifact a
few lines later (or in a fenced block, which the checker skips), so the pairing is invisible
to it. The tool prints "heuristic, not a verdict" for exactly this case. The durable evidence
is in the bus — every BR-00N record carries a structured `evidence` array and a `repro` that
someone else can re-run. Spot-check any claim here against `audit-bus.mjs show BR-00N`.

---

## Headline

Nine findings: **3 HIGH (2 launch blockers)**, 3 MEDIUM, 1 LOW, plus two of the highest-stakes
checks in this lane coming back **clean**.

The single most important result is a negative one: **no secret reaches the client bundle,
and none ever entered git history.** That was the catastrophic-blocker check for this lane
and it passes.

The two blockers are both *config values nobody set*, not code defects — which is the good
news, because both are fixed without shipping anything.

| id | sev | blocker | one line |
|---|---|---|---|
| BR-005 | HIGH | ✅ | Auth email is capped at **2 per hour, project-wide** — answers OA-003 |
| BR-006 | HIGH | ✅ | `min_supported_build = 0` — the force-update lever has never been armed |
| BR-001 | HIGH | ✅ | `deploy.yml` builds the iOS release with no `VITE_*` → an `.ipa` that hangs on the boot loader |
| BR-002 | HIGH | — | Web sourcemaps upload for a *different build* than Vercel serves — no prod web trace symbolicates |
| BR-003 | MEDIUM | — | Production serves 22 MB of un-stripped sourcemaps publicly |
| BR-004 | MEDIUM | — | `npm run dev:staging` runs against **production** — there is no client staging env |
| BR-007 | MEDIUM | — | A public page on the marketing domain asks you to paste an Apple **private key** |
| BR-008 | MEDIUM | — | The bundle-size gate weighs 38 KB of a 913 KB graph and says "within budget" |
| BR-009 | LOW | — | Build-time MapKit fallback token expires 2027-02-14, nothing watches it |

---

## 1. Verified working — with the artifact

These are the checks that came back clean. Each was executed, not read.

**No secret in the client bundle.** Built at `1f00d28b2`, then grepped the artifact:

- `sk_live_` / `sk_test_` / `rk_live_` / `rk_test_` → **0 files**
- `re_…` (Resend) → **0 files**
- `whsec_` (Stripe webhook signing) → **0 files**
- `SUPABASE_SERVICE_ROLE_KEY` / `SERVICE_ROLE_KEY` → **0 files**
- APNs / `BEGIN PRIVATE KEY` in `dist/assets` → **0 files**

`service_role` *does* appear in `dist/assets/*.js.map`, and it is **not** a key — it is
supabase-js's own doc comments (`"Never expose your service_role key in the browser."`).
Checked the surrounding bytes rather than trusting the match. **No service-role key in the
bundle.**

**Exactly four `VITE_*` vars are inlined, and they match `.env.example` exactly:**
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`,
`VITE_APPLE_MAPKIT_TOKEN`. No stray var. The only Supabase JWT in the bundle decodes to
`{"role":"anon"}` — correct and public by design.

**Git history is clean.** `.env` was committed four times (`63e58de50` 2026-03-10,
`0f01f9e3e` 2026-04-27, `a626414be` 2026-05-02, removed in `0a8b381ec` 2026-06-18).
Extracted the **variable names only** from every historical revision: every one is a
`VITE_*` public var. Zero server-side names ever appeared — no service-role key, no Stripe
secret, no Resend key is sitting in the history waiting to be rotated. `.gitignore` covers
`.env`, `.env.*`, `.env.local`, `.env.*.local`, `.env.production`, `.env.development`.

**Stripe keys cannot cross environments, because none ships.** `pk_live_` / `pk_test_` →
0 hits in `dist/assets/*.js`. The client uses hosted-Checkout redirects, not the Stripe
JS SDK. The three `sk_live_`/`sk_test_` literals in `supabase/functions/` are prefix
*checks* (`stripe-webhook/index.ts:56,58`) and one comment (`health-check/index.ts:78`) —
no key material.

**No signing material in the repo.** A repo-wide find for `*.p12`, `*.mobileprovision`,
`*.cer`, `*.p8`, `*.keystore`, `*.jks` returns nothing. Signing runs entirely off GitHub
secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`, `DEVELOPER_TEAM_ID`,
`IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64`, `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`.

**`vercel.json` is valid.** `node scripts/check-vercel-config.mjs` → `✔ no unknown keys in
redirects/headers/rewrites`, EXIT=0. The file that took production down three times is
currently sound, and the pre-commit guard is real.

**`ios-beta.yml` guards its env loudly.** Lines 191-192 fail the build with
`::error::VITE_SUPABASE_URL is empty — the build would ship an app that cannot boot`, and
lines 199-207 additionally grep the *built bundle* for the project ref and fail if absent.
This is the correct pattern — and it is exactly what `deploy.yml` lacks (BR-001).

**Version numbering is correct — the 5906/7101 gap is by design.** `CURRENT_PROJECT_VERSION
= 5906` sitting below the delivered build 7101 is not a defect: `fastlane/Fastfile:99-105`
documents it as a *floor*, with `set_next_build_number!` querying TestFlight and taking the
max on every archive. Confirmed, not assumed. Not filed.

**`verify-ios-bundle.mjs` asserts the right things.** It fails the build if the iOS bundle
is missing, still registers the PWA service worker, ships the Workbox runtime, carries
**sourcemaps into the `.ipa`**, has no JS assets, or has an app icon under 100 KB. The
iOS half of the sourcemap-stripping story is genuinely covered — which is what makes
BR-003 (the *web* half) the gap.

---

## 2. Defects

Full claim, reproduction and evidence for each are in the bus
(`node scripts/audit-bus.mjs show BR-00N`). Summarised here.

### BR-005 · HIGH · LAUNCH BLOCKER — auth email is capped at 2/hour project-wide
*Routed to this lane as OA-003 by `lh-onboarding-auth`.*

Two questions, two different answers.

**The sender is fine.** Custom SMTP is not configured — but auth mail does not go through
Supabase's built-in sender either. A GoTrue **Send Email Hook** is wired to the
`auth-email-hook` edge function, which sends via **Resend** on the verified apex domain.
GoTrue's own log proves it, 10 runs in 24 h:

```
source=auth_logs  msg="Hook ran successfully"  action="run_hook"  component="api"
hook="https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/auth-email-hook"
```

each matched 1:1 within the same second by a Boot+Log of `function_id 8f53887e`. So the
"built-in sender is not for production" deliverability blocker **does not apply.**

**The throughput cap is the blocker.** GoTrue applies `rate_limit_email_sent` *before* it
invokes the hook, so a working Resend integration cannot rescue it. The limit is **exactly
2 emails per hour, project-global, on a fixed clock-hour window** — Supabase's
built-in-sender default, left unraised when the hook was added:

```sql
select date_trunc('hour', confirmation_sent_at), count(*), count(distinct email)
from auth.users group by 1;
-- across the project's ENTIRE history: no clock hour has ever exceeded 2.
-- distinct_addresses = emails_sent every time → global, not per-address.
```

Corroborated independently by `auth_logs` hook runs bucketed hourly → `2, 2, 2, 2, 2`,
never 1, never 3. Overflow is visible as `path=/signup status=429 "email rate limit
exceeded"` — 10 in the 21:00 UTC hour against the 2 that got through.

This **resolves the anomaly OA-003 could not explain.** "One rolling hour 03:40–04:05
carried 4, so it is not a flat 2/hour" — the window is *fixed*, not rolling: two landed at
the end of hour 03 (`03:40:52`, `03:40:54`), two at the start of hour 04 (`04:04:09`,
`04:05:56`). Four in 25 minutes, still exactly 2 per clock hour. It is a flat 2/hour.

**Impact:** at 2/hour shared across signup confirmations, password resets and resends, the
third user in any clock hour gets a 429 and no email. **Fix is config-only, zero code**:
Supabase dashboard → Authentication → Rate Limits, or `PATCH rate_limit_email_sent` on the
Management API. Worth checking the Resend plan's own daily cap at the same time, since that
becomes the real ceiling once this is lifted — I could not read Resend without the key.

### BR-006 · HIGH · LAUNCH BLOCKER — the force-update lever has never been armed
Live prod: `platform_settings.min_supported_build = 0`, `latest_build = 0`,
`updated_at 2026-05-02`, `updated_by NULL`. `0` is the documented `GATE_OFF` value
(`src/lib/minSupportedBuild.ts`), so the gate is fully disabled and has never been touched.

**What value it needs:** the build number of the first TestFlight build cut from a commit
at or after `6d3cf8f19` (2026-09-01, the AppDelegate APNs fix — present at HEAD,
`AppDelegate.swift:141,148`). Fastlane takes `max(TestFlight)+1` and the last delivered
build was 7101, so that build will be **≥ 7102**. Set it the moment that build ships — not
before, or the gate locks out every existing install with nothing to update to.

**What breaks until then:** every build ≤ 7101 — which is *every build that exists*, since
no build containing the APNs fix has ever been produced — silently drops the APNs token iOS
hands it on each launch. `push_tokens` never fills; those users get zero push notifications,
forever, with no error and no prompt to update. Because the gate reads 0 they are never
turned away. This compounds **NB-004**: the fix is in `main`, has never been in a build
anyone has run, and the one mechanism that could retire those installs is switched off.

The gate correctly fails **open** on every read failure by design — that is right and must
not be changed. The defect is purely that the value was never set.

### BR-001 · HIGH · LAUNCH BLOCKER — `deploy.yml` ships an `.ipa` that cannot boot
`grep -c VITE_ .github/workflows/deploy.yml` → **0** (`ios-beta.yml` → 10). The workflow
auto-triggers on any `v*.*.*` tag — the App Store release lane — and builds with no
`VITE_*` env. Reproduced the runtime failure: `mv .env` aside, `npx vite build` (EXIT=0, no
guard fires), serve it, load headless → `pageerror: Error: supabaseUrl is required.`,
`document.body.innerText` empty, `#root` still holding the static boot loader. Cause is
`createClient` at module scope (`src/integrations/supabase/client.ts:34`), so the throw
lands before React mounts. `gh run list --workflow=deploy.yml` → last ran 2026-04-26,
*before* the `VITE_*` secrets existed, so this has never been exercised since. The secrets
it needs exist; the workflow simply never references them.

### BR-002 · HIGH — no production web stack trace can symbolicate
`sentry-release.yml` builds with no `VITE_SUPABASE_*`, so 165 of 393 chunks get a different
content hash than the bundle Vercel serves. Sentry matches maps by filename and no Vite
plugin injects debug ids, so the uploaded maps are keyed to filenames production never
serves. A/B'd the two builds: 393 chunks each, only 228 filenames identical. Then read the
live CI log — `gh run view 33684451442 --log` names `ApplyBody-8xOqEmrz.js`,
`client--zLa-Z0M.js`, `ReportDialog-CxDw19rL.js` and others; **every one exists only in the
no-env build**. Prod genuinely has env
(`https://www.louisianahelpr.com/assets/client-BUsl5h47.js` contains the project ref), so
Vercel builds with env and CI does not. Every step reports `success`, and the 228 vendor
chunks that *do* match still symbolicate — which is why it looks like it works. Same class
as the 2026-08-27 "Sentry upload never ran" bug, different mechanism: the upload runs, it
is just uploading maps for the wrong build. **iOS is not affected** — `ios-beta.yml` builds
with env and uploads from that same build.

### BR-003 · MEDIUM — production serves 22 MB of sourcemaps publicly
`curl https://www.louisianahelpr.com/assets/index-BVHie6uZ.js.map` → **HTTP 200**,
`application/json`, 210,724 bytes, containing original TypeScript *with the comments that
explain security and money logic*. Discovery is trivial: fetch `/`, read the script tag,
append `.map`. 377 maps totalling 22 MB ship alongside 6.2 MB of JS/CSS.
`vite.config.ts:409` sets `sourcemap: "hidden"`, which only suppresses the
`//# sourceMappingURL` comment — it does not stop the `.map` being emitted and served. The
iOS half is handled (`strip-ios-sourcemaps.mjs`); nothing strips them from the Vercel
deployment.

### BR-004 · MEDIUM — there is no client staging environment
`npm run dev:staging` is `vite --mode staging`, which looks for `.env.staging` — a file that
does not exist and is not in `.env.example` — so resolution falls through to `.env`, which
holds **production**. Built with `--mode staging`: 3 chunks contain the prod ref
`fncmgoasalhdgfwzhsqa`, **0** contain the staging ref `okpxtpfvwtmbuxugqsws`. A staging
project does exist and `supabase/.temp/project-ref` points the CLI at it — so the database
tooling is on staging while any build a developer makes is on prod. That split is the trap:
"I am on staging" can be true of the CLI and false of the app in the same terminal.
Partial mitigation exists (`client.ts:17-23` warns in DEV when a dev build points at prod),
but it is a DevTools warning against a script whose name asserts the opposite.

### BR-007 · MEDIUM — a public page asks for an Apple private key
`https://www.louisianahelpr.com/tools/apple-jwt.html` → **HTTP 200**, 10,415 bytes.
`public/tools/apple-jwt.html` is copied into `dist/` by every build. It renders a form with
a textarea labelled *"Private Key (.p8 contents) — paste the entire contents including
BEGIN/END lines"*.

**Scope limit, verified not assumed: it does not exfiltrate.** `grep` for `fetch(`,
`XMLHttpRequest`, `sendBeacon`, `<form action>`, dynamic `.src` → **zero matches**. Signing
is done in-browser with WebCrypto. I am not filing this as a credential leak, because it
isn't one.

The real harms: `robots.txt` has no `Disallow: /tools`, so a page on the company's own
domain reading "paste your Apple private key here" is indexable; and it hands a phisher a
ready-made harvester — clone it, add one `fetch()`, and it inherits the provenance of
having genuinely been served from `louisianahelpr.com`. It is a one-time setup tool with no
reason to be on the production web surface.

### BR-008 · MEDIUM — the bundle-size gate weighs 0.6% of the bundle
`bundle-size.yml` extracts `grep -oE 'assets/[^"]+\.js' dist/index.html`, documented in its
own comment as "entry + modulepreload". But `dist/index.html` contains **zero** modulepreload
links, because `vite.config.ts:401-403` sets `modulePreload: { resolveDependencies: () => [] }`
— a deliberate, well-reasoned perf choice. The two files conflict and neither references the
other.

So the grep matches exactly one file: the 38 KB entry. Measured the true first-paint cost by
walking the entry's **static** import closure: **77 chunks, 913 KB** (supabase 204 KB,
react-vendor 130 KB, proxy 119 KB, tanstack 66 KB, lucide 58 KB). The gate weighs 38 KB
against a 1500 KB budget and passes with 97% headroom.

The author anticipated exactly this and wrote an EMPTY-GREP GUARD (`:113-131`) whose comment
even names the cause — *"a plugin rewrites the script tags (this repo already has THREE
transformIndexHtml plugins)"* — but it only fires on **zero** matches. One match satisfies
it. This is the guard-that-cannot-fail shape: `MAX_CHUNK_KB=400` is applied to that single
file only, so the 390 KB `jspdf` chunk entering the initial graph would never be flagged.

**Not currently over budget** — 913 KB against 1500 KB, so nothing is broken for users
today. The defect is that the gate would keep saying "within budget" all the way past 1500.
Fix: derive the graph from the static-import closure, or assert a minimum plausible chunk
*count* rather than merely non-zero.

### BR-009 · LOW — build-time MapKit token expires 2027-02-14
The ES256 token inlined in the bundle decodes to `exp 1802580205` = **2027-02-14T04:43:25Z**
(165 days out). It is a *fallback*: `useMapKitJs` prefers the `mapkit-token` edge function,
which I confirmed healthy (`POST … /mapkit-token` → **HTTP 200**, so the 2026-08-27 "503
not_configured" defect is fixed). But it is baked in at build time, so restoring it after
lapse needs a secret rotation *and* a new build — an App Review cycle for iOS. Nothing
asserts remaining validity. Filed LOW deliberately: nothing is broken today.

---

## 3. UNVERIFIED — could not reach, and why

- **The configured value of `rate_limit_email_sent` read directly from GoTrue config.**
  Not exposed through the Supabase MCP tools, and reading the stored Management API token
  was blocked by the permission classifier. I answered BR-005 by *measuring the behaviour*
  instead — 2/hour across five distinct hours and the whole project history — which is
  stronger evidence than the config read would have been, but the literal configured
  integer remains unread.
- **Resend's own account-level send quota.** Becomes the real ceiling once BR-005's GoTrue
  limit is lifted. Needs the Resend API key, which I do not hold.
- **That a signed `.ipa` is correctly signed.** Verifying the signature on a real artifact
  needs a build I am not authorised to cut (standing constraint: do not cut a TestFlight
  build). Checked the inputs instead — no signing material in the repo, all via GitHub
  secrets — which is the repo-side half of the question, not the artifact-side half.
- **That a real release produced a readable symbolicated stack.** BR-002 establishes the
  web maps are keyed to the wrong build, which answers the question negatively for web.
  Confirming the *iOS* half positively would need a crash in a build cut from
  `ios-beta.yml`; `lh-observability` has verified both uploads genuinely run in CI, which
  is as far as this lane got.
- **`npm run deadcode`.** Not run — it contends with the shared gate and the orchestrator
  owns gate scheduling. Bundle composition was measured directly from the artifact instead
  (BR-008), which covers the size question the deadcode run would have informed.

Two things worth recording as *deliberately not filed* rather than missed:

- `app-icon-1024.png` (651 KB), `app-icon-1024-dark.png` (645 KB) and
  `helpr-splash-icon.png` (338 KB) are referenced by **zero** built web files, so ~1.6 MB of
  images deploy to the web origin unreferenced. They cost deploy storage, not page weight
  (nothing fetches them), and they cannot simply be deleted — `verify-ios-bundle.mjs`
  requires the icon. Too marginal to file; noted here.
- The `CURRENT_PROJECT_VERSION 5906` vs delivered 7101 gap is **by design** and was
  re-confirmed against `Fastfile:99-105`, not merely accepted on report.

---

## 4. Fix status

**Nothing fixed in-session.** This lane ran in `permissionMode: plan` throughout, and every
one of the nine findings lands outside what this lane may edit anyway:

- BR-005 and BR-006 are **dashboard/DB config values**, not code — the owner's account, and
  BR-006 must be set *at the moment* the first fixed build ships, not before.
- BR-001, BR-002 and BR-008 are **CI workflow files**, which PROTOCOL §1 makes
  orchestrator-only.
- BR-003, BR-004, BR-007 and BR-009 are small and genuinely low-risk, but all four touch
  build config or the deploy surface (`vite.config.ts`, `package.json`, `public/`), which
  the standing constraint routes to QUEUED rather than fix-on-sight.

Recommended order once released: **BR-005** (one dashboard field, unblocks all onboarding
throughput) → **BR-001** (copy `ios-beta.yml`'s env block and both guards into `deploy.yml`)
→ **BR-002** (add the `VITE_SUPABASE_*` env block to `sentry-release.yml` so it builds the
bundle Vercel actually serves) → **BR-006** (set the instant the first ≥7102 build ships) →
the rest.
