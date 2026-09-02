# lh-appsec — XSS, sanitisation, CSP, CSRF, clickjacking

**Sweep phase, 2026-09-02.** Worktree `~/.lh-audit/appsec` @ `origin/main` b170609a.
Evidence: `~/lh-audit-shots/appsec/`.

## What I fixed

**Nothing yet — I am in `permissionMode: plan` and the harness blocks edits to
`src/` and `supabase/` during the sweep.** All eight findings are filed with
reproductions and are ready to fix the moment the orchestrator releases the
FIX phase. See "Proposed fixes" at the bottom; A-001 and A-008 are one-line
escapes and should go first.

---

## Headline

Eight findings: **0 HIGH, 4 MEDIUM, 4 LOW. No launch blocker.**

**Two retractions, and they matter more than most of the findings** — both were
plausible, both would have produced real code changes, and both were false. They
are written up in full below so the next sweep does not re-derive them.

The app's own UGC-rendering discipline is genuinely good. Every user-typed string
that reaches a second person's screen renders as a React text node, and the one
place that had to hand-build a URL (`MessageBubble`) parses it and falls back to
inert text. **The defects are not in the React surface; they are in the two places
that leave it** — server-rendered email, and the Supabase storage origin.

---

## 1. Verified working (with artifact)

| Claim | Evidence |
|---|---|
| **Clickjacking is closed.** `frame-ancestors 'none'` AND `X-Frame-Options: DENY` on the live host | `served-headers.txt` (`curl -I https://www.louisianahelpr.com/`) |
| **CSRF is structurally not exploitable.** Session token lives in `localStorage` (web) / keychain (native) and travels as an `Authorization: Bearer` header, which a cross-origin form cannot set. The only `document.cookie` in the app is UI sidebar state (`ui/sidebar.tsx:63`) — not auth. CSP additionally pins `form-action 'self' https://checkout.stripe.com`. No cookie-authed endpoint, no `credentials: "include"`, no `withCredentials` anywhere | `src/integrations/supabase/client.ts:36`; repo-wide grep; `served-headers.txt` |
| **The two-layer CSP design is correct IN THE BUILT ARTEFACT, not just in source.** Web `dist/index.html` has 0 CSP meta tags (stripped, so it does not intersect with and over-restrict the Vercel header); Capacitor `dist/index.html` has exactly 1 and carries no `unsafe-eval`. The strip is gated `!isCapacitorBuild`, and *every* iOS build path sets `VITE_CAPACITOR_BUILD=1` — `ios-beta.yml:193`, `deploy.yml:288`, `ci_scripts/ci_post_clone.sh:50`, `fastlane/Fastfile:633` | Ran both builds in `~/.lh-audit/appsec`, exit=0 each. `npm run build` → `grep -c Content-Security-Policy dist/index.html` = **0**. `VITE_CAPACITOR_BUILD=1 npx vite build` → same grep = **1**, and `grep -o unsafe-eval dist/index.html` = empty. Output at `~/lh-audit-shots/appsec/served-headers.txt` for the paired live header |
| **No HTML-injection sink in the SPA.** The single client `innerHTML` (`mapMarkers.ts:170`) interpolates only internal category colours and CSS token values; the job title reaches the pin via `setAttribute` on the accessible name, never as markup. The three `dangerouslySetInnerHTML` in `Index.tsx:149-157` stringify module-level JSON-LD constants with no user input | Read `mapMarkers.ts:130-180`, `Index.tsx:30-157` |
| **Message rendering is correctly defended.** `MessageBubble.tsx:18` parses with `new URL()` and requires `protocol === "https:"`, falling back to inert `<p>{content}</p>` for both the `<img src>` and `<a href>` branches. Nothing renders message content as HTML | Read `MessageBubble.tsx:10-70`; grep for `dangerouslySetInnerHTML` in the messages tree returns none |
| **The AI Job Builder does not auto-publish.** Output lands in editable form state (`applyAiJob`) and `setStep("form")` — the poster reviews and edits before submit, satisfying the review-before-post requirement | `useJobEntry.ts:88-100`, `EntryChoice.tsx:400-403` |
| **Email templates escape by construction.** All render through `@react-email/render` → `react-dom/server`; every JSX child and attribute is escaped. `dangerouslySetInnerHTML` is the only bypass and there are exactly three | `_shared/email-templates/render.ts:20-27` |
| **`ai-job-builder` requires a real signed-in user.** A previously unauthenticated, billable endpoint now 401s without a JWT | `ai-job-builder/index.ts` auth block |

## 2. Defects — all filed in the bus

| ID | Sev | What |
|---|---|---|
| **A-001** | MEDIUM | **Email CTA `href` breaks out of its HTML attribute.** `msoButtonHtml` (`components.tsx:85,91`) interpolates `href`/`label` raw inside `dangerouslySetInnerHTML`. `sanitizeSameOriginLink` blocks schemes, whitespace and backslash but **not `"` or `>`**, so a slash-separated payload terminates the attribute and injects an element with a live event handler into another user's Helpr-branded email. Reachable by anyone who has merely **applied to the victim's job**. |
| **A-002** | MEDIUM | **AI Job Builder: client `messages` spread verbatim into the model call**, `Array.isArray` the only check — a free general-purpose Gemini proxy on the platform's key. Model output returned unvalidated and applied via a bare cast, so the tool schema's `enum`/`additionalProperties:false` is enforced nowhere on the path into the priced form. |
| **A-003** | MEDIUM | **`job-photos` is public with NULL size and MIME limits** (live prod). Every MIME/size gate is client-side only; content-type is stored per-object from the client. Arbitrary attacker-controlled content, including `text/html`, is anonymously fetchable from the Supabase origin. |
| **A-006** | MEDIUM | **`script-src 'unsafe-inline'`** with no nonce/hash — removes CSP's XSS mitigation. Posture only: no reachable sink found to pair it with. |
| **A-004** | LOW | **`public/_headers` is dead config** — Vercel does not read it. Proven: the served CSP matches `vercel.json` byte-for-byte and uniquely lacks `api.resend.com`. The two have already drifted; a future hardening edit there would silently do nothing. |
| **A-005** | LOW | **`api.openai.com` in `connect-src` is stale** — the AI path is server-side Gemini. An exfiltration destination granted for a client call that does not exist. |
| **A-007** | LOW | **Attacker-controlled `<img src>` in admin views.** `portfolio_urls`/`avatar_url` are client-writable free text rendered with no host validation — a tracking pixel that leaks an admin's IP/UA and reveals when an account is under review. `img-src https:` does not stop it. |
| **A-008** | LOW | **`marketing-blast.tsx`'s stated safety invariant is false.** `{{name}}` is replaced with unescaped `profiles.full_name` *before* the admin-authored body reaches `dangerouslySetInnerHTML`. Self-targeted, so low — but the comment asserting safety is wrong. |

## 3. RETRACTED — do not re-file these

### R-1. "Stored XSS via `javascript:` in `portfolio_urls` / job photos" — FALSE

A recon pass flagged 14 sites rendering client-writable URLs into `href` with no
scheme validation, and it is true that **React 18.3.1 does not strip
`javascript:`** — it only warns. I nearly filed it as HIGH.

I reproduced it instead. **`target="_blank"` suppresses `javascript:` execution in
both Chromium and WebKit**, and all 14 sites carry it:

```
href survived React? YES - NOT STRIPPED
chromium  #blank  executed=false      <- target="_blank"
chromium  #same   executed=true       <- same-tab control
webkit    #blank  executed=false
webkit    #same   executed=true
```

`~/lh-audit-shots/appsec/js-url-repro.mjs` renders the exact
`HelperWorkPhotos.tsx:34-40` JSX with the project's own React and clicks it in
both engines. `<img src="javascript:">` does not execute either.

**The finding only becomes real if any of those sites ever loses `target="_blank"`.**
What survives is the much smaller A-007 (tracking pixel), which is why that one is LOW.

### R-2. "`approval_status` / `id_verification_status` are client-writable" — FALSE

`information_schema.column_privileges` on live prod does show `authenticated`
holding `UPDATE` on both, which reads alarming. But the `tr_prevent_self_escalation`
BEFORE-UPDATE trigger pins ~45 columns — including both of these, `ban_status`,
`subscription_tier` and the whole Stripe linkage — back to `OLD` for any non-admin.
**A column GRANT is not an authorization conclusion on this schema; check the
triggers.** I did not relay this to `lh-authz-rls` precisely because I checked.

## 4. UNVERIFIED — could not reach, and why

| Cell | Why |
|---|---|
| End-to-end proof that `job-photos` serves an uploaded `text/html` with that content-type | Would require writing an attack artifact to the **production public** bucket. I declined that mutation without owner approval. Bucket config and per-object client-supplied `mimetype` are both proven from live prod; only the final fetch is inferred. |
| Whether A-001's injected markup survives a real Gmail/Apple Mail/Outlook sanitizer | I proved the breakout at the HTML-parse layer (jsdom). I did not send mail to a live client. This is why A-001 is MEDIUM, not HIGH — I am assuming the mail client strips `onload`, which caps impact at injected anchors and tracking images. |
| CR/LF header injection via `subject: title` (`send-notification-email:229,283`) | `title` is caller-supplied and never stripped of control characters, unlike the `cleanLine()`/`sanitizeHeaderValue` used elsewhere. Whether it is exploitable depends on Resend's JSON API encoding CR/LF before SMTP, which I could not test. Reported as an **inconsistent control**, not a proven finding — relayed to `lh-email-delivery`. |

## 5. Out-of-scope conclusions (PROTOCOL §6)

- **Certificate pinning — wontfix, deliberately.** WKWebView over ATS-enforced
  HTTPS to Supabase/Stripe. Pinning breaks on routine cert rotation, Apple
  discourages it, and it would not have prevented a single finding above.
- **Jailbreak/root detection — wontfix.** Consumer marketplace. No local secret
  store worth defending; the session token is already in the keychain on native.
- **Dependency CVEs, endpoint auth, RLS, session storage, secrets in the bundle** —
  other lanes' territory. Not duplicated. `_shared/rate-limit.ts` correctly left
  alone (durable server-side counter, not an in-memory Map).

## 6. Coverage manifest

Opened and assessed: `AiJobBuilder.tsx`, `ai-job-builder/index.ts`,
`useJobEntry.ts`, `EntryChoice.tsx`, `MessageBubble.tsx`, `RichMessageInput.tsx` +
`richMessageInput/ViolationDialog.tsx`, `mapMarkers.ts`, `Index.tsx`,
all 18 files in `_shared/email-templates/`, `render.ts`, `safe-strings.ts`,
`send-notification-email`, `create-notification`, `send-marketing-blast`,
`email-unsubscribe`, `contact-support`, `HelperWorkPhotos.tsx`,
`admin/userDetail/{DocumentsTab,DetailHeader}.tsx`, `JobCardPhotoStrip.tsx`,
`admin/adminJobs/JobDetailDialog.tsx`, `PhotoProof.tsx`,
`DisputeTimelineDialog.tsx`, `admin/adminDisputes/DisputeCard.tsx`,
`HelperRevisionCard.tsx`, `vercel.json`, `public/_headers`, `index.html`,
`vite.config.ts`, `client.ts`, plus every upload call site in `src/` and
`supabase/functions/`.

Live-state queries (read-only, prod `fncmgoasalhdgfwzhsqa`): column privileges
and triggers on `profiles`, `pg_get_functiondef(prevent_self_escalation)`,
`storage.buckets`, `storage.objects` mimetype distribution.
Builds: `npm run build` and `VITE_CAPACITOR_BUILD=1 vite build`, both greppedded.

## 7. Proposed fixes (awaiting FIX-phase release)

1. **A-001** — escape `href` and `label` inside `msoButtonHtml` with the existing
   `htmlEscape` from `safe-strings.ts`. One line each, two call sites. *(Touches
   the email layer — I will ask the orchestrator to run `lh-silent-failure` over
   the diff since it sits on the notification path.)*
2. **A-008** — escape the `{{name}}` substitution at `send-marketing-blast:449`,
   and correct the now-false comment at `marketing-blast.tsx:20-36`.
3. **A-005 / A-004** — drop `api.openai.com` from `connect-src`; delete
   `public/_headers` or add a header comment naming it inert. **`vercel.json` is
   guarded by `scripts/check-vercel-config.mjs` and has taken prod down three
   times — I will not add keys, only remove a token from an existing value.**
4. **A-003** — set `allowed_mime_types` + `file_size_limit` on `job-photos` and
   the four unbounded buckets. **Data-model adjacent → queued for owner review,
   not fixed unilaterally.**
5. **A-002** — validate `messages` shape (roles allowlist, length cap) and
   validate the model's tool output against the declared schema before returning.
6. **A-007** — require `https:` + an expected storage host before rendering
   `portfolio_urls`/`avatar_url` as `<img src>`.
