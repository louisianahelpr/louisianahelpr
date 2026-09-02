# lh-copy-content — launch audit lane report

Worktree: `~/.lh-audit/lh-copy-content` @ `b170609a` (origin/main).

## Scope covered this pass

This session picked up an in-progress lane — the bus already carried CC-001
(raw-error leakage, 22 sites/18 files) and CC-002 (own-job apply-toast design
hole), both filed by an earlier run of this same lane and both already marked
`fixed`/resolved by the orchestrator. This pass verified those fixes are real,
then swept for siblings and untouched territory:

- **Toast/error-copy surface** (the lane's largest, 517+ call sites): verified
  `src/lib/userFacingError.ts` is the actual mechanism behind CC-001's fix and
  re-swept for any `toast.error(<raw>.message)` call site that bypasses it —
  none found; the only match is a comment. Also swept for `alert()`,
  `window.confirm/prompt`, and residual "Something went wrong" toasts (none
  live — all three are either absent or comment-only).
- **Terminology**: "Pay It Forward" → "Gift Card" rename (shipped today) —
  swept every remaining source hit; all 12 are code comments/internal
  identifiers, zero user-facing strings still say the old name.
  "Helpr(s)"/"worker" — the two "Helprs (workers)" section titles in
  TermsSection.tsx/CommunitySection.tsx are a defensible legal/tax-classification
  label, not brand-noun drift.
- **Money/legal fee claims** ("no platform fee", "100%", "no fee charged"):
  grepped every such claim app-wide. Confirmed ME-006 (tip claim,
  `TermsSection.tsx:132`) is still open/unfixed. **Found and filed a sibling,
  CC-003**: the urgent-bonus toggle copy (`BudgetSection.tsx:360`) makes the
  same overclaim shape — "no platform fee applied" is literally true but "goes
  straight to the Helpr" isn't, because `netUrgentFeeDollars()` deducts
  Stripe's 2.9% marginal processing cost before payout.
- **Support/contact path**: read `contact-support/index.ts` end to end, then
  actually drove it — POSTed a real message
  (`https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/contact-support`,
  `topic: "other"`) and got `HTTP 200 {"sent":true}`. Confirmed the function
  calls `sendWithResend` (checks the Resend SDK's `error` field before
  reporting success — it does not silently drop a provider-side failure) and
  that `RESEND_API_KEY` is a configured secret on the linked prod project.
  Contact email is consistently `admin@louisianahelpr.com` everywhere
  user-facing (7 sites); the one `hello@louisianahelpr.com` hit is a test-mock
  constant, never rendered.
- **Route/redirect resolution**: curled `/support`, `/help`, `/legal`,
  `/legal?tab={terms,privacy,rules}`, `/data-rights`, `/rules`, `/terms`,
  `/privacy` against prod — all 200. Cross-referenced against `App.tsx`:
  `/terms`, `/privacy`, `/rules` are client-side `<Navigate>` redirects into
  `/legal?tab=...`, matching the SPA shell behavior (curl 200 is expected for
  every path on an SPA; this doesn't prove the client-rendered content is
  correct, only that the shell isn't 404ing — see UNVERIFIED below).
- **`broken-links.yml`** (CI, weekly): read the full workflow. It checks 8
  hardcoded URLs plus `lychee` against the homepage's outbound links only — it
  does **not** crawl `/legal?tab=`, in-app deep links, email templates, or
  overlay links. Last scheduled run (2026-09-01) passed. This is a real
  coverage gap in the CI guard, not something I could close in this pass (see
  UNVERIFIED / recommendations).
- Read `docs/audit/launch-2026-09/PROTOCOL.md` and the `lh-audit` skill in
  full per §0.

## Findings filed this pass

- **CC-003** (MEDIUM, not a blocker) — `BudgetSection.tsx:360` urgent-bonus
  copy overclaims "goes straight to the Helpr... no platform fee applied"
  when Stripe's 2.9% is netted out before payout. Money/legal-adjacent claim
  — **proposed, not shipped**, per standing constraint. Recommend the same
  fix direction as ME-006 (either the poster's checkout absorbs the marginal
  Stripe cost so the stated "goes straight to" claim becomes true, or the
  copy is softened to "the Helpr keeps it, minus a small card fee" to match
  TipDialog's own honest phrasing). This is a money-code change
  (`_shared/stripeFees.ts` / `create-payment`), out of this lane's territory
  to implement — relayed to team-lead.

## Verified working (with evidence)

1. **Raw-error leakage is closed.** `grep -rnE "toast\.error\(\s*[a-zA-Z_]+\.message"` across `src` returns zero live call sites (one comment). `userFacingError.ts` is in place and is the mechanism CC-001's fix commit (`d0e47a4f`, per the bus) relies on.
2. **No raw browser dialogs.** Zero live `alert()`, `window.confirm()`, `window.prompt()` in `src/` (two comments explicitly note they were avoided on purpose, e.g. `SecurityTab.tsx:178`).
3. **No dev/placeholder text ships.** Broad sweep for `lorem ipsum`, `TODO:`, `FIXME`, `example.com`, `test@test`, `john/jane doe` — zero hits outside test files and two comments referencing the word "placeholder" in a different sense.
4. **"Pay It Forward" fully retired from user-facing copy.** All 12 remaining source hits are code comments/internal names; `GiftCard.tsx`'s own docblock documents the rename and confirms the legacy route was removed after checking prod (`pif_credits` had 0 claimed rows).
5. **Support contact path works end-to-end.** Live POST to `contact-support` returned `200 {"sent":true}`; code path checks Resend's `error` field (never reports success on a provider failure); `RESEND_API_KEY` present in prod secrets.
6. **Contact email is consistent** — `admin@louisianahelpr.com` used at all 7 user-facing sites (`ReportDialog.tsx`, `ForceUpdateGate.tsx`, `WorkRecord.tsx`, `AccountBanned/Denied/Pending.tsx`, `HelpCenter.tsx` context). No stray second address reaches a user.
7. **`/terms`, `/privacy`, `/rules`, `/data-rights` redirects resolve** to their `/legal?tab=` / `/profile?tab=legal` targets in source and return 200 live.

## UNVERIFIED — could not fully reach, and why

- **Whether `/legal?tab=`, `/help`, and other SPA routes render correct
  content (vs. a client-side blank/error) live** — curl only proves the shell
  loads (expected 200 on every path for an SPA); I did not drive a browser
  this pass to screenshot the rendered DOM for each tab. Time-boxed out of
  this session; recommend `lh-route-walker` or a follow-up pass with Chrome
  MCP confirm actual content, not just HTTP status.
- **Receipt confirmation of the test support email** — the endpoint reports
  success and the code path is honest-on-failure by design, but I don't have
  inbox access to `admin@louisianahelpr.com` to see the message arrive. This
  is the strongest evidence obtainable without mailbox access.
- **Full 517-call-site toast copy grading** (does each one say what happened
  AND what to do) — I verified the *leak* class (raw internals) is closed and
  sampled broadly, but did not individually grade all 517 sites for
  actionability in this pass. That is a large remaining body of work; the
  structural fix (userFacingError.ts) is in place and load-bearing.
- **139 overlay instances and 40 forms** — not individually walked this pass
  for copy quality; time-boxed to the highest-yield surfaces (error copy,
  money claims, terminology, contact points) given the size of the full
  surface (802 items) and this session's budget.
- **Email template body copy** (20 templates) — not individually read for
  terminology/tone this pass.

## Recommendation for another lane / the orchestrator

- **`broken-links.yml` coverage gap**: only 8 static URLs + homepage outbound
  links are crawled. `/legal?tab=` variants, in-app deep links, and email
  template links are not covered by CI. Worth a follow-up to extend the
  crawl or hand it to `lh-seo-web`/`lh-email-delivery`.
- **CC-003** needs a money-lane owner (`lh-money-escrow` or the orchestrator)
  to decide the fix direction (absorb the Stripe cost vs. reword the claim),
  the same decision axis as ME-006.

## Out-of-scope conclusions (§6)

- No B2B/removed-feature copy encountered this pass.
- Marketing-claim substantiation (stats, testimonials) not re-audited this
  pass — out of budget; no changes suspected since a prior pass.
