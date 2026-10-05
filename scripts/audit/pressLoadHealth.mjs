/**
 * BOOT-HEALTH CLASSIFICATION FOR THE PRESS HARNESS — honour a heal, still fail a corpse.
 *
 * WHY THIS FILE EXISTS
 * `press-every-control.mjs` classified a route's boot snapshot at t≈0: it
 * called `settle()` (which returns fast, because the recoverable auth error
 * card carries no skeleton pulse) and then failed the route if the snapshot
 * text matched any error-screen pattern. Meanwhile `ProtectedRoute`'s auto-heal
 * (ProtectedRoute.tsx) does not fire its FIRST retry until 4000ms.
 *
 * So a stall that healed perfectly at 4s was still recorded as a hard FAIL —
 * a false red by construction, no matter what the app did (press #1582 on
 * /jobs/:id and /user/:id). Lengthening a timeout is NOT the fix: that hides a
 * real stall exactly as well as a healed one.
 *
 * WHAT THIS FILE DOES INSTEAD
 * The app now states, machine-readably, that it is retrying:
 * `[data-auth-retrying="true"]` (plus `aria-busy`) on the error card.
 *   - The signal is absent → nothing is self-healing; error copy is a FAIL now,
 *     with no extra waiting at all (a genuinely dead route fails as fast as before).
 *   - The signal is present → the harness WAITS for it to go away, bounded by
 *     `SELF_HEAL_MS`. Resolved → PASS, with the heal time recorded. Still up
 *     when the bound expires → FAIL, and the reason says the heal did not
 *     resolve, which is a different and more useful red than "error on load".
 *
 * The distinction preserved: a route that RECOVERS is a pass; a route still
 * broken after the heal has had its bound is a fail.
 *
 * PER-REQUEST TIMINGS
 * `summarizeTimings` exists because the leading hypothesis for the underlying
 * stall is request fan-out under CI load (/jobs/:id ≈ 35 Supabase requests vs
 * ≈19 on routes that pass, four shards concurrent against a free-tier project)
 * and nobody could test it: the harness wired `page.on("request"/"response")`
 * for `netFails` and recorded no timings at all. Now every run reports the
 * request count and the slow tail per route × persona, so the next person reads
 * a number instead of repeating the investigation.
 */

/**
 * Every "still loading" marker the app renders. The shared `<Skeleton>`
 * (src/components/ui/skeleton.tsx) shimmers with `animate-[shimmer_…]`, NOT
 * `animate-pulse`; a settle that only looked for `animate-pulse` never waited
 * for it, so /profile?tab=earnings was pressed while EarningsPageSkeleton was
 * still up (run 36986080914: "More Insights" not found after reload).
 * Guarded by src/test/pressSettleSeesSkeleton.test.tsx.
 */
export const LOADING_SEL = '[aria-busy="true"], [class*="animate-pulse"], [class*="animate-[shimmer"]';

/**
 * A LOADING STATE THAT IS ONLY WORDS IS STILL A LOADING STATE.
 *
 * nightly-red #2353, press run 37296257389 shard 8, /admin?view=people (admin):
 * three user rows "not found on a freshly loaded page". AdminUsers renders
 * `<p>Loading users…</p>` while the profiles read is in flight: no aria-busy,
 * no pulse, no shimmer, so LOADING_SEL saw NOTHING and settle() returned in
 * that gap. The rows then mounted with their per-row summaries still pending,
 * so "Audit W. … 1 completed …" re-enumerated as "Audit W. … East Baton Rouge
 * …" and its identity no longer matched. Measured against prod 2026-10-05
 * (read-only, 375 wide, settle exactly as the harness ran it): load 1 settled
 * with 0 rows mounted; load 3 settled with the list still aria-busy and the
 * "1 completed" chip missing from row 1. Twenty-odd screens use the same
 * text-only placeholder (src/test/pressSettleSeesLoadingText.test.tsx
 * inventories them from source).
 *
 * So the text itself counts: an element whose whole text is "Loading …" /
 * "Loading..." is a loading marker.
 */
export const LOADING_TEXT_RX_SOURCE = "^Loading\\b[^\\n]{0,80}?(?:…|\\.\\.\\.)$";

/**
 * How many "still loading" markers the document holds: LOADING_SEL matches
 * (outside aria-hidden, unless they are themselves aria-busy) plus every
 * rendered element whose whole text is a "Loading …" line. Self-contained on
 * purpose: Playwright serialises it into the page (settle()), and the guard
 * runs it in jsdom.
 */
export const countLoadingMarkers = ([loadingSel, textRxSource]) => {
  const bySel = [...document.querySelectorAll(loadingSel)].filter((e) => e.getAttribute("aria-busy") === "true" || !e.closest("[aria-hidden='true']")).length;
  const rx = new RegExp(textRxSource);
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let byText = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/Loading/.test(n.nodeValue || "")) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest("[hidden]") || (typeof getComputedStyle === "function" && getComputedStyle(el).display === "none")) continue;
    if (rx.test((el.textContent || "").replace(/\s+/g, " ").trim())) byText++;
  }
  return bySel + byText;
};

/**
 * Wait until `probe` (a page-side expression counting loading markers) has
 * read ZERO for `quietMs` in a row, bounded by `timeoutMs`. A single
 * marker-free instant is not "loaded": a lazy route can show a bare shell for
 * a few hundred ms between two loading stages (#2353, see LOADING_TEXT_RX_SOURCE).
 * A probe that throws (navigation in flight) counts as still loading.
 * @returns {Promise<{quiet: boolean, waitedMs: number}>}
 */
export async function awaitLoadingQuiet(page, { probe, quietMs, timeoutMs, pollMs = 50, now = () => Date.now() }) {
  const t0 = now();
  let quietSince = null;
  while (now() - t0 < timeoutMs) {
    const n = await Promise.resolve(page.evaluate(probe)).catch(() => 1);
    if (n === 0) {
      if (quietSince === null) quietSince = now();
      if (now() - quietSince >= quietMs) return { quiet: true, waitedMs: now() - t0 };
    } else {
      quietSince = null;
    }
    await page.waitForTimeout(pollMs);
  }
  return { quiet: false, waitedMs: now() - t0 };
}

/** The app's "I am retrying, do not call me broken yet" marker (ProtectedRoute.tsx). */
export const SELF_HEAL_SEL = '[data-auth-retrying="true"]';

/**
 * Bound on the wait. ProtectedRoute retries at 4s, then 8s, and each `refresh()`
 * carries its own ~6s fetch budget, so 25s covers the first retry landing plus
 * the second being attempted. Past that the route is not "slow", it is broken.
 */
export const SELF_HEAL_MS = Number(process.env.SELF_HEAL_MS ?? 25_000);

/**
 * Wait out an in-flight self-heal.
 * @returns {Promise<{healing: boolean, healed: boolean, waitedMs: number}>}
 *   healing — the app said it was retrying when we looked.
 *   healed  — the signal was gone before the bound expired.
 */
export async function awaitSelfHeal(page, { timeout = SELF_HEAL_MS, sel = SELF_HEAL_SEL } = {}) {
  const t0 = Date.now();
  const present = await page.locator(sel).count().catch(() => 0);
  if (!present) return { healing: false, healed: true, waitedMs: 0 };
  const healed = await page
    .waitForFunction((s) => !document.querySelector(s), sel, { timeout })
    .then(() => true)
    .catch(() => false);
  return { healing: true, healed, waitedMs: Date.now() - t0 };
}

/**
 * Decide whether a boot snapshot is a failure, given what the heal did.
 * `text` MUST be snapshotted AFTER `awaitSelfHeal` resolved, or this is back to
 * classifying at t≈0.
 * @returns {{fail: boolean, why: string, note: string|null}}
 */
export function classifyBoot({ text, errorRx, heal }) {
  const errored = errorRx.test(text ?? "");
  const healing = !!heal?.healing;
  const healed = !!heal?.healed;
  const waited = Math.round(heal?.waitedMs ?? 0);
  if (!errored) {
    return { fail: false, why: "", note: healing ? `self-healing auth card resolved in ${waited}ms — recovered, not a defect` : null };
  }
  // Error copy is still on screen. Only two shapes get here.
  if (healing && !healed) {
    return {
      fail: true,
      why: `error copy still rendered after the self-heal bound (${waited}ms, ${SELF_HEAL_MS}ms allowed) — the route did not recover`,
      note: null,
    };
  }
  // Either nothing claimed to be retrying, or the retrying card cleared and a
  // DIFFERENT error screen is underneath. Both are real reds, judged now.
  return {
    fail: true,
    why: "error boundary / error copy rendered on load",
    note: healing ? `an auth self-heal did resolve in ${waited}ms, but error copy remains — not the auth card` : null,
  };
}

/** Median / p95 over a numeric array, nearest-rank, no interpolation. */
function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * Collapse per-request timings into the numbers the fan-out hypothesis needs.
 * @param {Array<{ms: number, url: string, method?: string, failed?: boolean}>} timings
 */
export function summarizeTimings(timings, { slowest = 5, apiRx = /\/(rest|auth|functions|realtime|storage)\/v1\// } = {}) {
  const ms = timings.map((t) => t.ms).sort((a, b) => a - b);
  const api = timings.filter((t) => apiRx.test(t.url));
  const apiMs = api.map((t) => t.ms).sort((a, b) => a - b);
  return {
    requests: timings.length,
    apiRequests: api.length,
    failed: timings.filter((t) => t.failed).length,
    medianMs: pct(ms, 50),
    p95Ms: pct(ms, 95),
    maxMs: ms.length ? ms[ms.length - 1] : 0,
    apiMedianMs: pct(apiMs, 50),
    apiP95Ms: pct(apiMs, 95),
    slowest: [...timings].sort((a, b) => b.ms - a.ms).slice(0, slowest).map((t) => `${t.ms}ms ${t.method ?? "GET"} ${t.url}`),
  };
}
