/**
 * Is the app up, right now, for a stranger? The ONE definition of the check,
 * shared by both watchers:
 *   - scripts/uptime-check.mjs, run by .github/workflows/uptime.yml (GitHub
 *     Actions cron, which GitHub throttles: 164-558 min apart, Q936), and
 *   - api/uptime-heartbeat.ts, run by a Vercel Cron every 10 minutes (Q936,
 *     owner 2026-10-07: off GitHub, so a throttled or dead Actions schedule
 *     cannot hide an outage).
 *
 * Two questions:
 *   1. does the site answer 200?
 *   2. does the database answer a read the app itself makes —
 *      `open_jobs_browse?select=id&limit=1` — with 200 inside the timeout AND
 *      at least one row? An empty marketplace is never "up"; see probe().
 *
 * The second is the point: Vercel serves index.html from the CDN straight
 * through a total database outage (2026-09-13), so a site-only ping reports
 * green for the whole outage.
 *
 * TWO CONSECUTIVE FAILURES, not one: one run probes up to `rounds` rounds,
 * `roundGapMs` apart, and reports down only when two consecutive rounds both
 * fail, so one dropped connection never pages anyone.
 *
 * Verdicts: up | down | empty.
 *   empty: both answered, but every failure in the failed rounds was the
 *   database's ZERO-row answer (an empty guest marketplace, not an outage);
 *   only when `emptyIsWarning` (pre-launch, owner 2026-10-02), else down.
 */

/**
 * THE LAUNCH-DAY SWITCH, one constant for both watchers (owner 2026-10-02,
 * "Split the alert until launch"): before launch prod has no funded job, so a
 * database that answers 200 with ZERO rows is `empty` (a WARNING), not `down`.
 * Set it to false on launch day (docs/OPEN.md Q1131) and an empty marketplace
 * is an outage again, in uptime.yml AND the Vercel heartbeat.
 */
export const EMPTY_IS_WARNING_BEFORE_LAUNCH = true;

/**
 * One probe. Never throws: a thrown fetch IS the failure we are looking for.
 *
 * `expectRows`: a 200 carrying `[]` is NOT up (2026-09-21, nightly-red #1595:
 * an empty array is a 200, so a completely dark guest marketplace passed on
 * the status line alone).
 */
export async function probe(name, url, headers, { expectRows = false, timeoutMs = 10_000, fetchImpl = fetch } = {}) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: ac.signal, redirect: "follow" });
    const ms = Date.now() - started;
    // A 200 that took longer than the budget is a failure too — the owner
    // cares about "usable", not "eventually answered".
    if (res.status !== 200) {
      // The body says WHY (PostgREST and the gateway name the cause: "Invalid
      // API key" = a rotated key, "permission denied for table jobs" = a lost
      // grant), and a bare "HTTP 401" cannot tell those apart. On 2026-10-03
      // the alert said only "HTTP 401" while the cause was 42501 (PR #2161).
      const why = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
      return { name, ok: false, ms, detail: why ? `HTTP ${res.status}: ${why}` : `HTTP ${res.status}` };
    }
    if (ms > timeoutMs) return { name, ok: false, ms, detail: `200 but ${ms}ms > ${timeoutMs}ms` };
    if (expectRows) {
      let rows;
      try {
        rows = await res.json();
      } catch (e) {
        return { name, ok: false, ms, detail: `200 but the body is not JSON (${String(e?.message || e).slice(0, 80)})` };
      }
      if (!Array.isArray(rows)) return { name, ok: false, ms, detail: "200 but the body is not a row array" };
      if (rows.length === 0) {
        return { name, ok: false, empty: true, ms, detail: `200 in ${ms}ms but ZERO rows — a guest opening /browse sees an empty marketplace` };
      }
      return { name, ok: true, ms, detail: `200 in ${ms}ms, ${rows.length} row(s)` };
    }
    return { name, ok: true, ms, detail: `200 in ${ms}ms` };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - started, detail: e?.name === "AbortError" ? `no answer in ${timeoutMs}ms` : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** One round: the site and the database, together. */
export async function round({ siteUrl, supabaseUrl, key, restPath, timeoutMs, fetchImpl, userAgent = "louisianahelpr-uptime/1" }) {
  const checks = [probe("site", siteUrl, { "user-agent": userAgent }, { timeoutMs, fetchImpl })];
  if (supabaseUrl && key) {
    checks.push(
      probe(
        "database",
        `${supabaseUrl.replace(/\/+$/, "")}${restPath}`,
        { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" },
        // Zero rows is never up — see probe()'s note.
        { expectRows: true, timeoutMs, fetchImpl },
      ),
    );
  } else {
    // Never silently drop half the check: no key means we cannot answer the
    // question that matters, and saying "up" would be a lie.
    checks.push(Promise.resolve({ name: "database", ok: false, ms: 0, detail: "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set" }));
  }
  const results = await Promise.all(checks);
  return { ok: results.every((r) => r.ok), results };
}

/** Up to `rounds` rounds; the verdict, a one-line summary, and every round. */
export async function runUptime({
  siteUrl,
  supabaseUrl,
  key,
  restPath = "/rest/v1/open_jobs_browse?select=id&limit=1",
  timeoutMs = 10_000,
  rounds = 3,
  roundGapMs = 30_000,
  emptyIsWarning = true,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
  userAgent,
}) {
  const history = [];
  let consecutive = 0;
  let down = false;
  for (let i = 0; i < rounds; i++) {
    if (i > 0) await sleep(roundGapMs);
    const r = await round({ siteUrl, supabaseUrl, key, restPath, timeoutMs, fetchImpl, userAgent });
    history.push(r);
    log(`round ${i + 1}/${rounds}: ${r.ok ? "ok" : "FAIL"} — ${r.results.map((x) => `${x.name} ${x.detail}`).join("; ")}`);
    if (r.ok) {
      consecutive = 0;
      break; // one good round is enough: nothing consecutive can follow it.
    }
    consecutive += 1;
    if (consecutive >= 2) {
      down = true;
      break;
    }
  }
  const last = history[history.length - 1];
  const failing = last.results.filter((r) => !r.ok);
  // Empty, not down, only when EVERY failure in the failed rounds was the
  // database's zero-row answer, i.e. the site and the database both responded.
  // Any other failure in those rounds (a timeout, a 5xx, the site) is an outage.
  const onlyEmpty = history.slice(-consecutive).every((r) => r.results.every((x) => x.ok || x.empty));
  const status = !down ? "up" : onlyEmpty && emptyIsWarning ? "empty" : "down";
  const summary =
    status === "down"
      ? `DOWN — ${failing.map((r) => `${r.name}: ${r.detail}`).join(", ")} (${consecutive} consecutive failed rounds)`
      : status === "empty"
        ? `EMPTY — the site and the database answer, but open_jobs_browse returned ZERO rows in ${consecutive} consecutive rounds: no funded job is browsable (pre-launch, owner 2026-10-02)`
        : `up — ${last.results.map((r) => `${r.name} ${r.detail}`).join(", ")}`;
  return { status, summary, history, consecutive };
}
