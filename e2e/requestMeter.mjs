/**
 * Counts every request a browser run sends to the Supabase backend (docs/OPEN.md
 * Q104) and writes one JSON sample per process, which
 * scripts/e2e/request-budget.mjs sums per run and checks against
 * e2e/request-budgets.json.
 *
 * WHY. With no real users on it, prod's REST traffic was ~94% CI browser suites
 * (24 h to 09:00Z 2026-09-23: 105,824 of >=112,356 badge requests came from the
 * CI preview origin; 104,445 REST requests in the 03:00Z hour alone). Nothing
 * measured a run's own load, so nothing could say which run was the cost or
 * stop one from growing. This is that measurement.
 *
 * Plain JS on purpose: the Playwright fixture (e2e/prodTest.ts) imports it
 * through Playwright's TS pipeline, and scripts/audit/press-every-control.mjs /
 * measure-loading-states.mjs are run by `node` (22, no type stripping). Types:
 * ./requestMeter.d.mts.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { budgetFor, shapeKey } from "../scripts/e2e/request-budget.mjs";

/** Where samples go. Not test-results/: Playwright wipes that at the start of
 *  every invocation, and one workflow job runs several. */
export const REQUEST_BUDGET_DIR = process.env.REQUEST_BUDGET_DIR || "request-budget";

/**
 * The backend class of a URL, or null when it is not a Supabase request.
 * `rpc` is split out of `rest` because an RPC is where one request can cost a
 * whole query plan.
 */
export function classify(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/\.supabase\.(co|in)$/.test(u.hostname)) return null;
  const p = u.pathname;
  if (p.startsWith("/rest/v1/rpc/")) return "rpc";
  if (p.startsWith("/rest/v1/")) return "rest";
  if (p.startsWith("/auth/v1/")) return "auth";
  if (p.startsWith("/functions/v1/")) return "functions";
  if (p.startsWith("/storage/v1/")) return "storage";
  if (p.startsWith("/realtime/v1/")) return "realtime";
  return "other";
}

/** A password sign-in: the request a spec should make once per account per run, not per test. */
export const isSignIn = (url, method) =>
  method === "POST" && /\/auth\/v1\/token\?(?:.*&)?grant_type=password\b/.test(url);

/** The key a GET is deduplicated on: the exact path + query, as sent. (The
 *  summary groups these by shape: scripts/e2e/request-budget.mjs shapeKey.) */
export function requestKey(method, url) {
  try {
    const u = new URL(url);
    return `${method} ${u.pathname}${u.search}`;
  } catch {
    return `${method} ${url}`;
  }
}

/** A GET repeated to the same key within this window counts as a duplicate fetch. */
export const DUPLICATE_WINDOW_MS = 2_000;

/**
 * PACING. The budget step judges a run by its busiest WALL-CLOCK minute
 * (epoch minute buckets, summed over every sample of the label), so the meter
 * paces on exactly those buckets. Before a navigation (`page.goto`,
 * `page.reload`) and before each test, `pace()` holds until the current
 * minute has room for the next burst: this process's own count in the minute,
 * plus what earlier processes of the same label already recorded in it, plus
 * `reserve`, must stay at or under the ceiling. Otherwise it sleeps to the next
 * minute boundary. Measurement never happens inside a hold: the hold sits
 * BEFORE a navigation, never between a navigation and what a spec reads.
 *
 * The burst a gate reserves room for is LEARNED PER PAGE. Each gate carries a
 * key (the navigation's path; "" for a test's start), and the requests sent
 * between it and the next gate are that key's burst. A key seen before
 * reserves its own largest burst (at least PACE_MIN_RESERVE); a key never seen
 * reserves the largest burst of any key (`reserve`), capped at half the
 * ceiling. An empty minute admits any gate.
 *
 * Why per page (nightly-red #1794, measured 2026-09-26). With ONE learned
 * reserve for every gate:
 *  - capped at half the ceiling, a list page's burst landed on a part-filled
 *    minute every time it came round: a11y-prod-webkit hit 439 of 400
 *    (run 36263866330, 200/min per worker, reserve capped at 100);
 *  - uncapped (0d0010181), one burst bigger than the per-worker ceiling made
 *    EVERY gate wait for an empty minute, so every page cost a minute: both
 *    a11y legs were cancelled at 60 min at test ~330/368 (36271541309; the
 *    run before, 36263866330, took 42 and 49 min), and loading-states at 60 min
 *    (36272891811; the run before, 36267409284, took 25 min).
 * Per page, only the big page waits for room it needs; the small ones pack.
 * A never-seen page can still overshoot once, by at most its burst minus half
 * the ceiling; `topBursts` in the sample names the page when it does.
 */
export const PACE_MIN_RESERVE = 40;
/** Lands a released gate safely inside the next minute rather than on its edge. */
export const PACE_EDGE_MS = 250;

/** The per-minute ceiling for a label, from e2e/request-budgets.json. Throws when there is none. */
export function ceilingFor(label, file = join(process.cwd(), "e2e", "request-budgets.json")) {
  const { budgets } = JSON.parse(readFileSync(file, "utf8"));
  const c = budgets ? budgetFor(budgets, label).ceilingPerMinute : undefined;
  if (typeof c !== "number" || !(c > 0)) throw new Error(`no ceilingPerMinute for ${label} in ${file}: every metered run needs one`);
  return c;
}

/** Requests per epoch minute that earlier processes of `label` already wrote to `dir`. */
export function priorMinutes(label, dir = REQUEST_BUDGET_DIR) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "summary.json") continue;
    let s;
    try {
      s = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      continue; // a sample mid-write by another process: it is counted by the budget step, not here
    }
    if (s.label !== label) continue;
    for (const [m, n] of Object.entries(s.minutes ?? {})) out[m] = (out[m] ?? 0) + n;
  }
  return out;
}

/**
 * Gate an IN-APP navigation (history.pushState + popstate) the way goto is
 * gated. Every route a client-side walk visits is a page load's worth of
 * requests, and none of them passes page.goto: route-retention-signed-in
 * walked 37 routes x 4 laps after ONE goto("/home") and sent 519 requests
 * between two gates, all charged to "/home" (prod-audit 36298506930 read 467
 * and 498/min against the 400 ceiling, #1754). No-op on an unmetered page.
 * src/test/requestBudget.test.ts fails any e2e file that pushes history
 * without calling this.
 */
export async function gateClientNav(page, path) {
  return typeof page?.__requestMeterGate === "function" ? page.__requestMeterGate(path) : 0;
}

/** The gate key of a navigation: its path, without origin, query or hash. */
export function pageKey(url) {
  if (typeof url !== "string") return "?";
  try {
    return new URL(url, "http://x").pathname;
  } catch {
    return url;
  }
}

export class RequestMeter {
  /** @param {string} label the run it belongs to (Playwright project, or script name) */
  constructor(label) {
    this.label = label;
    this.total = 0;
    this.byClass = {};
    this.signIns = 0;
    this.duplicates = 0;
    this.tests = 0;
    /** requests per wall-clock minute (epoch minute -> count), merged across workers later */
    this.minutes = {};
    /** duplicate GET counts per key, for the summary's top list */
    this.dupKeys = {};
    /** EVERY backend request by endpoint shape (shapeKey: ids -> :id), so an
     *  over-budget run names what it sent instead of only how much (Q104;
     *  privacy-journey 36158780317 went 81 -> 84 and nothing said which 3). */
    this.byShape = {};
    this.lastSeen = new Map();
    this.startedAt = Date.now();
    /** Pacing is off until paceTo(): the metered node scripts measure without it. */
    this.ceiling = 0;
    this.prior = {};
    this.reserve = PACE_MIN_RESERVE;
    this.sinceGate = 0;
    /** largest burst per gate key (see PACING), and the key of the last gate */
    this.bursts = {};
    this.lastKey = null;
    this.paceWaitMs = 0;
    this.clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
    /** Called with each hold's length before it sleeps (the fixture extends the test's timeout by it). */
    this.onPaceWait = null;
  }

  /**
   * Turn pacing on. `ceilingPerMinute` is the label's whole-run ceiling;
   * `workers` processes may share it at once, so each gets its share.
   * `prior` is what earlier processes of the label recorded, per epoch minute.
   */
  paceTo(ceilingPerMinute, { workers = 1, prior = priorMinutes(this.label), now, sleep } = {}) {
    this.ceiling = Math.floor(ceilingPerMinute / Math.max(1, workers));
    this.prior = prior;
    if (now) this.clock.now = now;
    if (sleep) this.clock.sleep = sleep;
    return this;
  }

  /**
   * Hold until the current minute has room for the burst `key` is expected to
   * send. `key` is the page about to load (its path), "" for a test's start.
   * Resolves with the ms held.
   */
  async pace(key = "") {
    if (!this.ceiling) return 0;
    if (this.lastKey !== null) this.bursts[this.lastKey] = Math.max(this.bursts[this.lastKey] ?? 0, this.sinceGate);
    this.reserve = Math.max(this.reserve, this.sinceGate);
    const known = this.bursts[key];
    const need = known === undefined ? Math.min(Math.floor(this.ceiling / 2), this.reserve) : Math.max(PACE_MIN_RESERVE, known);
    let held = 0;
    for (;;) {
      const t = this.clock.now();
      const m = Math.floor(t / 60_000);
      const used = (this.minutes[m] || 0) + (this.prior[m] || 0);
      // An empty minute always admits: a burst bigger than the whole share
      // cannot be split by a gate in front of it, and waiting would never end.
      if (used + need <= this.ceiling || used === 0) break;
      const ms = (m + 1) * 60_000 - t + PACE_EDGE_MS;
      if (this.onPaceWait) this.onPaceWait(ms);
      await this.clock.sleep(ms);
      held += ms;
    }
    this.lastKey = key;
    this.sinceGate = 0;
    this.paceWaitMs += held;
    return held;
  }

  /** Put the gate in front of a page's navigations. Idempotent. */
  pacePage(page) {
    if (page.__requestMeterPaced) return page;
    page.__requestMeterPaced = true;
    // In-app navigations (pushState + popstate) never pass goto/reload; they
    // gate through gateClientNav, which reads this.
    page.__requestMeterGate = (path) => this.pace(pageKey(path));
    for (const name of ["goto", "reload"]) {
      const original = page[name].bind(page);
      page[name] = async (...args) => {
        await this.pace(pageKey(name === "goto" ? args[0] : page.url?.()));
        return original(...args);
      };
    }
    return page;
  }

  /**
   * Record one request. Returns the class, or null when it was not a backend
   * request. `seen` scopes duplicate detection: one map per BrowserContext, so
   * two accounts fetching the same URL are not counted as a duplicate.
   */
  record(url, method, now = Date.now(), seen = this.lastSeen) {
    const cls = classify(url);
    if (!cls) return null;
    this.total++;
    this.sinceGate++;
    this.byClass[cls] = (this.byClass[cls] || 0) + 1;
    const shape = shapeKey(requestKey(method, url));
    this.byShape[shape] = (this.byShape[shape] || 0) + 1;
    const minute = Math.floor(now / 60_000);
    this.minutes[minute] = (this.minutes[minute] || 0) + 1;
    if (isSignIn(url, method)) this.signIns++;
    if (method === "GET" && cls !== "realtime") {
      const key = requestKey(method, url);
      const prev = seen.get(key);
      if (prev !== undefined && now - prev <= DUPLICATE_WINDOW_MS) {
        this.duplicates++;
        this.dupKeys[key] = (this.dupKeys[key] || 0) + 1;
      }
      seen.set(key, now);
    }
    return cls;
  }

  /** Count every request a BrowserContext sends, including its service workers'. */
  attach(context) {
    // Idempotent: Browser.newPage() creates its context through newContext(),
    // which attachBrowser() also wraps.
    if (context.__requestMeter) return context;
    context.__requestMeter = this;
    const seen = new Map();
    context.on("request", (req) => this.record(req.url(), req.method(), Date.now(), seen));
    context.on("page", (page) => this.pacePage(page));
    for (const page of context.pages()) this.pacePage(page);
    return context;
  }

  /**
   * Meter every context a Browser creates from now on, by wrapping its
   * `newContext` / `newPage` on this instance. Playwright's own `context`
   * fixture creates through the same instance, so specs that use the fixture
   * and specs that call `browser.newContext()` themselves are both counted.
   */
  attachBrowser(browser) {
    if (browser.__requestMeter) return browser;
    browser.__requestMeter = this;
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => this.attach(await newContext(...args));
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...args) => {
      const page = await newPage(...args);
      this.attach(page.context());
      return page;
    };
    return browser;
  }

  /**
   * Count every request a Playwright APIRequestContext (the `request` fixture)
   * sends. It emits no "request" events, so its methods are wrapped. A spec
   * whose backend traffic is all node-side (job-status-fixtures, when it
   * reuses its fixture) otherwise measures 0 and the budget step calls the
   * meter loose.
   */
  attachApi(api) {
    if (api.__requestMeter) return api;
    api.__requestMeter = this;
    const seen = new Map();
    for (const m of ["get", "post", "put", "patch", "delete", "head"]) {
      const orig = api[m].bind(api);
      api[m] = (url, ...rest) => {
        this.record(String(url), m.toUpperCase(), Date.now(), seen);
        return orig(url, ...rest);
      };
    }
    const fetch = api.fetch.bind(api);
    api.fetch = (urlOrRequest, options = {}) => {
      const url = typeof urlOrRequest === "string" ? urlOrRequest : urlOrRequest.url();
      const method = (options.method || (typeof urlOrRequest === "string" ? "GET" : urlOrRequest.method())).toUpperCase();
      this.record(url, method, Date.now(), seen);
      return fetch(urlOrRequest, options);
    };
    return api;
  }

  toJSON() {
    const topDup = Object.entries(this.dupKeys).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return {
      label: this.label,
      total: this.total,
      byClass: this.byClass,
      signIns: this.signIns,
      duplicates: this.duplicates,
      tests: this.tests,
      minutes: this.minutes,
      topDuplicates: Object.fromEntries(topDup),
      topBursts: Object.fromEntries(
        Object.entries({ ...this.bursts, ...(this.lastKey !== null ? { [this.lastKey]: Math.max(this.bursts[this.lastKey] ?? 0, this.sinceGate) } : {}) })
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5),
      ),
      byShape: this.byShape,
      paceWaitMs: this.paceWaitMs,
      startedAt: this.startedAt,
      endedAt: Date.now(),
    };
  }

  /** Write this process's sample. Safe to call more than once (last write wins). */
  flush() {
    mkdirSync(REQUEST_BUDGET_DIR, { recursive: true });
    const safe = this.label.replace(/[^A-Za-z0-9_.-]/g, "_");
    if (!this.file) this.file = join(REQUEST_BUDGET_DIR, `${safe}.${process.pid}.${this.startedAt}.json`);
    writeFileSync(this.file, JSON.stringify(this.toJSON(), null, 2));
    return this.file;
  }
}
