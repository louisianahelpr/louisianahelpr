/**
 * WHAT A PRESS FAILURE IS NOT — docs/OPEN.md Q128.
 *
 * Triage of press-every-control run 35837735324 (e96adc16d, red, 2026-09-23).
 * Every class below was counted as a CONTROL failure (or, for the last two,
 * hid the run's real result) although the control did nothing wrong. Each
 * rule is narrow on purpose and each has its own test in
 * src/test/pressFailureClass.test.ts; nothing here is silent: the caller lists
 * every reclassified line in coverage.md.
 *
 *   1. TELEMETRY. "429 POST envelope/" on /profile?tab=earnings, /signup,
 *      /profile?tab=schedule, /profile?tab=home_history — Sentry's ingest
 *      rate-limiting OUR OWN reporter (and Chrome's console mirror of it,
 *      "Failed to load resource: ... 429"). Not the control's fault; the 429s
 *      still need their own look, so they are counted and printed apart.
 *   2. VENDOR 5xx. "500 GET apay-us.amazon.com/amazonpayMerchantId" on
 *      /post-job "Finish Paying" — Stripe's payment sheet asking Amazon Pay,
 *      which answered 500. A vendor answering 5xx is not our control. Only a
 *      5xx from a KNOWN vendor host with a real HTTP status: a 4xx, an
 *      unresolvable host (net::ERR_NAME_NOT_RESOLVED on a proof photo) or any
 *      host not on the list stays a failure.
 *   3. ANOTHER SWEEP'S LIVE FIXTURE. /admin?view=jobs "[E2E DO NOT ACCEPT] …
 *      › Refund Poster" — "control not found on a freshly loaded page". The
 *      row is a live fixture of the e2e journeys, which move it on (refund,
 *      release, cleanup) while this sweep runs. Only when the opener chain
 *      names that marker and NOT this harness's own "[PRESS DO NOT ACCEPT]".
 *   4. NOT CLICKABLE, UNREADABLE. /jobs/:id "Done — <date>" x3 — the 600-char
 *      slice was all selector and cut off the part of Playwright's call log
 *      that says WHY. The reason is now lifted to the front.
 *   5. ROUTINE TOKEN EXPIRY counted as a SESSION DEATH. A shard runs ~2.5h;
 *      the access token lives 1h. "GoTrue refuses the helper session" x3 and
 *      the clean-up's "HTTP 401 JWT expired" were expiry, and every "death"
 *      failed the run. A token about to expire is refreshed before the row,
 *      and only a token refused BEFORE its exp is a death.
 *   6. A CANCELLED SHARD IS A HIDDEN RED. Three shards hit timeout-minutes
 *      (150) and were cancelled: no coverage.md, no FAIL line, their failures
 *      only in the raw log. The sweep now stops itself inside its own budget,
 *      lists the rows it did not reach, writes the report, and fails loudly.
 */

/** Our own telemetry: the app's Sentry DSN host and PostHog (src/lib/sentry.ts, src/lib/posthog.ts). */
export const TELEMETRY_HOST_RX = /(^|\.)(sentry\.io|posthog\.com)$/i;

/**
 * Vendor hosts the app's CSP lets the page reach (index.html), plus Amazon Pay,
 * which Stripe's payment sheet calls from its own frame.
 */
export const VENDOR_HOST_RX =
  /(^|\.)(stripe\.com|stripe\.network|amazon\.com|apple-mapkit\.com|openstreetmap\.org|pwnedpasswords\.com|vercel-scripts\.com)$/i;

function hostOf(url) {
  try { return new URL(String(url ?? "")).hostname; } catch { return ""; }
}

/**
 * Who a failed request's host belongs to.
 * @returns {"app" | "telemetry" | "vendor"}
 */
export function requestOwner(url) {
  const host = hostOf(url);
  if (!host) return "app";
  if (TELEMETRY_HOST_RX.test(host)) return "telemetry";
  if (VENDOR_HOST_RX.test(host)) return "vendor";
  return "app";
}

/**
 * Classify one failed HTTP response.
 * @returns {"app" | "telemetry" | "vendor-5xx"}
 *   app        — counts against the control, as before.
 *   telemetry  — our reporter was refused; listed apart, never a control failure.
 *   vendor-5xx — a known vendor host answered 5xx; listed apart.
 */
export function classifyFailedResponse({ url, status }) {
  const owner = requestOwner(url);
  if (owner === "telemetry") return "telemetry";
  if (owner === "vendor" && Number(status) >= 500) return "vendor-5xx";
  return "app";
}

/**
 * Chrome mirrors every failed resource load into the console as
 * "Failed to load resource: the server responded with a status of N ()",
 * with the resource's URL only in the message's location. Classify that
 * mirror exactly like the response it mirrors; every other console error
 * (and a network-level failure with no status) is the app's.
 */
export function classifyConsoleError({ text, locationUrl }) {
  const m = /Failed to load resource: the server responded with a status of (\d{3})/.exec(String(text ?? ""));
  if (!m) return "app";
  return classifyFailedResponse({ url: locationUrl, status: Number(m[1]) });
}

/** This harness's own fixtures (pressProdSafety.PRESS_MARKER) vs the e2e journeys' live fixtures. */
export const OWN_FIXTURE_MARKER = "[PRESS DO NOT ACCEPT]";
export const FOREIGN_FIXTURE_MARKER = "[E2E DO NOT ACCEPT]";
export const FOREIGN_FIXTURE_SKIP =
  "on another sweep's live fixture ([E2E DO NOT ACCEPT]), which that sweep moved on between loads";

/** True when the control was reached through a row that is another sweep's live fixture. */
export function isForeignSweepFixture(chain) {
  const text = (chain ?? []).map(String).join(" › ");
  return text.includes(FOREIGN_FIXTURE_MARKER) && !text.includes(OWN_FIXTURE_MARKER);
}

/** Playwright call-log phrases that say why a click never landed. */
const CLICK_REASONS = [
  // "- <div class=…></div> intercepts pointer events": the covering element is
  // the text between the call log's last "- " and the phrase.
  [/- ([^-][^]*?) intercepts pointer events/gi, (m) => `covered: ${m[1].split(" - ").pop().slice(0, 160)} intercepts pointer events`],
  [/element is not visible/gi, () => "not visible"],
  [/element is not enabled|element is disabled/gi, () => "not enabled"],
  [/element is not stable/gi, () => "still moving (not stable)"],
  [/element is outside of the viewport/gi, () => "outside the viewport"],
  [/element was detached from the DOM/gi, () => "detached from the DOM"],
  [/element is not attached to the DOM/gi, () => "not attached to the DOM"],
];

/** The reason a Playwright click timed out, lifted out of its call log (the LAST reason logged wins). */
export function clickFailureReason(message) {
  const msg = String(message ?? "").replace(/\s+/g, " ");
  let best = null, end = -1;
  for (const [rx, fmt] of CLICK_REASONS) {
    for (const m of msg.matchAll(rx)) {
      const e = m.index + m[0].length;
      if (e > end) { end = e; best = fmt(m); }
    }
  }
  return best ?? "reason not in the call log";
}

/** Decode a JWT's exp (ms since epoch), or null. */
export function jwtExpiryMs(token) {
  try {
    const part = String(token ?? "").split(".")[1];
    if (!part) return null;
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Refresh margin: a row can take many minutes, so refresh well before exp. */
export const TOKEN_REFRESH_MARGIN_MS = 15 * 60 * 1000;

/** The token expires (or has expired) within the margin — refresh it; this is not a death. */
export function tokenNeedsRefresh(token, now = Date.now(), marginMs = TOKEN_REFRESH_MARGIN_MS) {
  const exp = jwtExpiryMs(token);
  return exp !== null && exp - now <= marginMs;
}

/**
 * A refused session is a DEATH only if the token was not already expired when
 * it was refused. An expired token being refused is GoTrue doing its job.
 */
export function refusalIsDeath(token, now = Date.now()) {
  const exp = jwtExpiryMs(token);
  return exp === null || exp > now;
}

export const NOT_REACHED_STATUS = "not-reached";

/**
 * The sweep's own time budget. `budgetMs` must be below the job's
 * timeout-minutes so the run stops itself, reports what it did not reach and
 * fails with that reason, instead of being cancelled with no report.
 * @returns {boolean} true when no new row should be started.
 */
export function overTimeBudget({ startedAt, now = Date.now(), budgetMs }) {
  if (!(budgetMs > 0)) return false;
  return now - startedAt >= budgetMs;
}

/**
 * THE SWEEP PACES ITSELF TO THE PROD LOAD CEILING.
 *
 * e2e/request-budgets.json sets `ceilingPerMinute` (400) for every label, and
 * the budget step fails a run whose busiest wall-clock minute exceeds it. Run
 * 36069319716: shard 1 peaked at 599 and shard 4 at 587 while their averages
 * were ~190/min (25,986 and 18,275 requests over ~135 min). The peaks are
 * bursts: a reload plus an opened feed plus the navigation a press starts.
 *
 * So before each press cycle the harness asks how many metered requests the
 * current minute already holds, and when this minute's count plus the largest
 * burst one cycle has produced so far would pass the ceiling, it waits for the
 * next minute. Same idea as paymentPaceMs: the limit is read, not guessed, so
 * tightening the ceiling slows the sweep instead of turning it red.
 *
 * @returns {number} milliseconds to wait before the next cycle (0 = go now).
 */
export function ceilingWaitMs({ minutes, now = Date.now(), ceiling, burst }) {
  if (!(ceiling > 0)) return 0;
  const minute = Math.floor(now / 60_000);
  const used = minutes?.[minute] ?? 0;
  if (used === 0 || used + Math.min(burst, ceiling) <= ceiling) return 0;
  return (minute + 1) * 60_000 - now + 50;
}

/** The burst estimate before any cycle has been measured; measured cycles only raise it. */
export const MIN_CYCLE_BURST = 100;

/**
 * AN OVERLAY OPENED FROM THE HEADER IS THE SAME OVERLAY ON EVERY ROUTE.
 *
 * Run 36069319716 did not reach 32 rows (14 + 7 + 11 + 0) inside its 135-minute
 * budget, and the rows it never reached were the ones after the admin views:
 * /jobs/:id x2, /legal, /terms, /support, /rules, /browse. Each admin view took
 * 12-17 minutes and found 54-85 controls whatever the view: /admin?view=export
 * 63, subscriptions 60, banreview 60, jobs 60, credentials 60. Those ~55 shared
 * controls are the admin menu (AdminTopBar's "Open the admin menu" opens
 * AdminSidebar's sheet: 25 view rows, their pin buttons and the footer) plus
 * the bell's panel. Every one is pressed through an opener chain, so each costs
 * a reload, a replay of the opener and an overlay fill, and the same sheet was
 * walked once per admin view: 25 times a night, per persona.
 *
 * A control inside an overlay whose opener is page chrome (inside <header> or
 * <nav>) renders the same controls with the same destinations on every route.
 * Once such a control has PASSED on one row of this run, the same control (same
 * persona, same opener chain, same signature) on a later row is not pressed
 * again, and the entry names the row where it passed. A control that FAILED is
 * pressed again on every row, so a failure is never hidden behind an earlier
 * one; page-level chrome (the bell, the menu button, the dock) is still pressed
 * on every row.
 */
export const CHROME_SKIP =
  "header chrome overlay: this identical control (same persona, opener and target) already passed on an earlier row of this run";

/** Identity of a chrome-overlay control across rows. */
export function chromeKey({ persona, chain, sig }) {
  return [persona, ...(chain ?? []), sig ?? ""].join("\u0001");
}

/** CHROME_SKIP when this overlay control already passed elsewhere in the run, else null. */
export function chromeDisposition({ fromChrome, depth, key, passedOn }) {
  if (!fromChrome || !(depth > 0)) return null;
  return passedOn.has(key) ? CHROME_SKIP : null;
}

/**
 * A ROUTE THAT REDIRECTS IN STEPS LANDS ON ITS LAST URL.
 *
 * Signed in, /jobs/:id renders <Navigate to="/home?quickApply=<id>">
 * (src/pages/jobs/JobDetail.tsx); for the job's own poster QuickApplyHandler
 * then replaces that with /posts?highlight=<id>, and JobListPage drops
 * `highlight` after its first paint. Run 36069319716,
 * `/jobs/4a980ec0… customer`: the dock's "Posts", "Jobs", "Messages",
 * "Profile" were enumerated with none of them the current tab, then failed
 * NOT CLICKABLE with the resolved element `<button aria-label="Posts"
 * aria-current="page">`: the screen was inventoried mid-redirect and pressed
 * on a different one.
 *
 * The landing is read once the URL has held still for `quietMs`.
 * @param {{ t: number, url: string }[]} samples in time order
 */
export function landingSettled(samples, quietMs) {
  if (!samples.length) return false;
  const last = samples[samples.length - 1];
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].url === last.url) i--;
  return last.t - samples[i].t >= quietMs;
}
export const LANDING_QUIET_MS = 1500;
