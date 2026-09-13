/**
 * PRESS EVERY CONTROL — the gap-free successor to walk-every-control.mjs.
 *
 * The owner's complaint: "there is no way every button has been clicked to be
 * sure not failing." They were right. The walker had five holes, and this
 * file closes each one by construction rather than by care:
 *
 *   1. `labels.slice(0, 40)`     → there is NO cap. Every control is queued.
 *   2. default ROUTES=/dashboard → the route set is DERIVED FROM src/App.tsx
 *                                  (same regex as auditCatalogRoutes.test.ts),
 *                                  expanded with every Profile tab, every
 *                                  admin view and every legal tab.
 *   3. never pressed inside      → a press that opens a dialog / sheet /
 *      dialogs                     popover / menu ENQUEUES every control
 *                                  inside it, and those are pressed too, by
 *                                  replaying the opener chain (depth ≤ MAX_DEPTH).
 *   4. `new Set(labels)`         → controls are addressed by DOM PATH, so five
 *                                  identical "View" buttons are five presses.
 *   5. "content changed" = ok    → the classifier FAILS on an error toast, any
 *                                  error-boundary copy, a console error, an
 *                                  uncaught exception, a 4xx/5xx during the
 *                                  press, or NO observable change at all.
 *
 * PROD ONLY (owner, 2026-09-12: "no mock mode ever"). Every persona is a real
 * session on the shared test accounts (e2e/prodSessions.ts → poster-e2e,
 * helper-e2e, admin-e2e, incomplete-e2e), every :id is a real id, and every
 * press hits the real backend. Safety is in scripts/audit/pressProdSafety.mjs:
 *   - a MUTATING press (delete/pay/send/ban/cancel/submit/…) is allowed ONLY
 *     when its target is test-owned: the URL's record id resolves (read-only
 *     select) to a test account, or the row/card/dialog around the control
 *     names a test-owned entity, or the route's subject is the signed-in test
 *     account itself. Anything else is SKIPPED "not test-owned".
 *   - admin actions only against seed test targets (never self-scoped).
 *   - payment presses only while Stripe is in TEST mode (cs_test_ on a real
 *     Checkout Session, as prod-lifecycle.spec.ts detects it).
 *   - the shared SEED fixtures are never mutated; this run creates its own
 *     fixture job for /jobs/:id and cleans up everything it made afterwards.
 *
 * Coverage is reported per route: controls found, pressed, passed, failed,
 * skipped-with-reason. The exit code is 1 on any failed press, or on any
 * control that was neither pressed nor skipped for a DOCUMENTED reason.
 *
 * Screenshots (owner-approved 2026-09-12): NOT every press. Every FAILED press
 * gets a screenshot, plus a small sample per route (SAMPLE=n).
 *
 *   BASE=http://127.0.0.1:4173 node scripts/audit/press-every-control.mjs
 *   ROUTES=/dashboard,/profile?tab=earnings  … to narrow
 *   PERSONAS=customer                       … to narrow (anon,customer,helper,admin,incomplete)
 *   SHARD=1/4                               … CI sharding over the route list
 *   CLEANUP_SINCE=<iso>                     … clean-up only (the workflow's final job)
 *
 * Needs `.env` with VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SERVICE_ROLE_KEY (session minting only; nothing else reads it).
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cleanup, createPressJob, loadTestOwners, makeStripeProbe, mintAccounts, mutationGate, prodSelect,
  rowNamesTestOwner, snapshotProfile, urlOwnership,
} from "./pressProdSafety.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "../..");

// ---------------------------------------------------------------------------
// Route derivation — from the app, never from a hand-kept list.
// ---------------------------------------------------------------------------

/** Read `export const FLAG = true|false` out of src/config/*.ts. */
function flagValue(name) {
  const dir = resolve(REPO, "src/config");
  if (!existsSync(dir)) return null;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(resolve(dir, file), "utf8");
    const m = new RegExp(`export const ${name}\\s*=\\s*(true|false)`).exec(src);
    if (m) return m[1] === "true";
  }
  return null;
}

/**
 * Every `<Route path=…>` in src/App.tsx, with what wraps it. A route whose
 * element is ONLY a redirect (`<Navigate …/>`, `<XRedirect />`) is kept in the
 * list but marked, so the report can say "redirect — covered at its target"
 * rather than pressing the same target twice.
 */
export function parseAppRoutes(appSrc = readFileSync(resolve(REPO, "src/App.tsx"), "utf8")) {
  const out = [];
  for (const m of appSrc.matchAll(/(\{\s*(\w+)\s*&&\s*)?<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    const guard = m[2];
    if (guard && flagValue(guard) === false) continue;
    const path = m[3];
    const el = m[4].trim();
    const redirect = /^<Navigate\b/.test(el) || /^<\w*Redirect\s*\/>$/.test(el);
    out.push({
      path,
      redirect,
      protected: el.includes("ProtectedRoute"),
      admin: el.includes("AdminRoute"),
    });
  }
  return out;
}

/** The Profile `Tab` union, parsed from its source so a new tab is walked. */
export function parseProfileTabs(src = readFileSync(resolve(REPO, "src/pages/profile/types.ts"), "utf8")) {
  const m = /export type Tab\s*=\s*([^;]+);/.exec(src);
  if (!m) throw new Error("Could not find `export type Tab` in src/pages/profile/types.ts");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/** The admin `View` union, parsed from src/pages/Admin.tsx so a new view is walked. */
export function parseAdminViews(src = readFileSync(resolve(REPO, "src/pages/Admin.tsx"), "utf8")) {
  const m = /type View\s*=\s*([^;]+);/.exec(src);
  if (!m) throw new Error("Could not find `type View` in src/pages/Admin.tsx");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).filter((v) => v !== "home");
}

/** The Legal tabs, from the page's own union. */
export function parseLegalTabs() {
  const file = resolve(REPO, "src/pages/Legal.tsx");
  if (!existsSync(file)) return ["terms", "privacy", "community"];
  const src = readFileSync(file, "utf8");
  const m = /type\s+(?:Legal)?Tab\s*=\s*([^;]+);/.exec(src);
  if (!m) return ["terms", "privacy", "community"];
  const tabs = [...m[1].matchAll(/"([a-z_-]+)"/g)].map((x) => x[1]);
  return tabs.length ? tabs : ["terms", "privacy", "community"];
}

/**
 * Concrete URLs to visit, with the persona set each applies to.
 *
 * PERSONAS: `anon` visits everything (a protected route lands on /login —
 * that is detected and reported as a redirect, not pressed twice); `customer`
 * visits everything; `helper` visits the protected routes (same route, a
 * different set of controls); `admin` visits /admin and its views.
 */
export function deriveRouteSet({ seedJobId, helperId, customerId, adminViews, jobIds = [seedJobId] }) {
  const routes = parseAppRoutes();
  const profileTabs = parseProfileTabs();
  const legalTabs = parseLegalTabs();
  const PROTECTED = ["anon", "customer", "helper", "incomplete"];
  const set = [];
  const push = (url, base, personas) => set.push({ url, base: base.path, personas, redirect: base.redirect });

  for (const r of routes) {
    if (r.path === "*") {
      push("/this-route-does-not-exist", r, ["anon", "customer"]);
      continue;
    }
    let url = r.path
      .replace(":userId", helperId)
      .replace(/^\/jobs\/:id$/, `/jobs/${seedJobId}`)
      .replace(/:[a-zA-Z]+/g, "test")
      .replace(/\/\*$/, "/x");
    if (r.admin) {
      push(url, r, ["admin"]);
      for (const v of adminViews) push(`${url}?view=${v}`, r, ["admin"]);
      continue;
    }
    const personas = r.protected ? PROTECTED : ["anon", "customer"];
    if (r.path === "/jobs/:id") {
      // Every real job the run resolved (the press fixture + one per state the test accounts own).
      for (const id of jobIds) push(`/jobs/${id}`, r, personas);
      continue;
    }
    if (r.path === "/profile") {
      push(url, r, personas);
      for (const t of profileTabs) if (t !== "landing") push(`${url}?tab=${t}`, r, personas);
      continue;
    }
    if (r.path === "/legal") {
      for (const t of legalTabs) push(`${url}?tab=${t}`, r, personas);
      continue;
    }
    if (r.path === "/user/:userId") {
      push(url, r, personas);
      push(`/user/${customerId}`, r, personas);
      continue;
    }
    push(url, r, personas);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Classifier vocabulary
// ---------------------------------------------------------------------------
// The ONE shared list of error-screen signatures (e2e/errorScreens.ts), so a
// new error surface is caught by every harness at once.
import { ERROR_SCREEN_PATTERNS } from "../../e2e/errorScreens.ts";
export const ERROR_BOUNDARY_RX = new RegExp(ERROR_SCREEN_PATTERNS.filter((p) => p.name !== "404 on a real route").map((p) => p.re.source).join("|"), "i");
/** Labels that MUTATE something. Pressed only on a test-owned target (see pressProdSafety.mjs). */
export const DESTRUCTIVE_RX = /\b(delete|remove|pay|submit|send|ban|unban|confirm|release|refund|withdraw|cancel|accept|decline|hire|apply|block|report|sign out|log out|deactivate|unsubscribe|subscribe|upgrade|post job|publish|save|update|approve|deny|resolve|suspend|restore|reset|revoke|complete|mark|tip|boost|purchase|buy|checkout)\b/i;
export { ACCOUNT_DESTROY_RX, PAYMENT_RX, SELF_ROUTE_RX } from "./pressProdSafety.mjs";
import { PAYMENT_RX } from "./pressProdSafety.mjs";
/** Console lines the HARNESS causes, not the app. */
const CONSOLE_NOISE = [
  /Service Worker registration blocked by Playwright/i,
  /Download the React DevTools/i,
  /\[vite\] connect/i,
  // A 406 from `.single()` with zero rows is real PostgREST behaviour the app
  // handles (maybeSingle → null); the network watcher excludes 406 too.
  /status of 406/i,
];

/** Documented skip reasons. Anything else unpressed FAILS the coverage gate. */
export const DOCUMENTED_SKIPS = new Set([
  "disabled (inert by design)",
  "screen-reader only (pointer not expected)",
  "already the active tab/route (no-op expected)",
  "self-link (no-op expected)",
  "external / new-tab link (covered by walk-every-control's new-tab pass)",
  "not test-owned (mutating control; target is not a test-account record)",
  "not test-owned (mutating control; no record id in the URL and the row names no test entity)",
  "admin action without a seed test target",
  "shared SEED fixture (test-owned, but other sweeps depend on it; the run's own fixture covers the action)",
  "payment control — Stripe is not in TEST mode",
  "would destroy or lock the shared test account",
  "account unavailable (persona not minted)",
  "file picker (opens the OS dialog; not a DOM outcome)",
  "inside a toast (transient; not page chrome)",
  "opener chain could not be replayed (parent press reported separately)",
]);

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
const OPEN_OVERLAY =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]';

const CONTROL_SEL =
  'button, a[href], summary, input[type="checkbox"], input[type="radio"], input[type="file"], ' +
  '[role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"], ' +
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]';

/**
 * Enumerate visible controls, each with a DOM path RELATIVE to `scopeSel`
 * (document.body for the page; the newest open overlay for a recursion).
 * Runs in the page.
 */
const ENUMERATE = ({ controlSel, overlaySel, scope, base }) => {
  const root = scope === "overlay"
    ? [...document.querySelectorAll(overlaySel)].pop()
    : document.body;
  if (!root) return [];
  const pathFrom = (el, top) => {
    const parts = [];
    let n = el;
    while (n && n !== top) {
      const tag = n.tagName.toLowerCase();
      let i = 1, s = n;
      while ((s = s.previousElementSibling)) if (s.tagName === n.tagName) i++;
      parts.unshift(`${tag}:nth-of-type(${i})`);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const out = [];
  root.querySelectorAll(controlSel).forEach((el) => {
    // Page pass: a control inside an overlay belongs to the overlay pass.
    if (scope !== "overlay" && el.closest(overlaySel)) return;
    // The overlay pass owns only the newest overlay's controls.
    if (scope === "overlay" && [...document.querySelectorAll(overlaySel)].pop() !== el.closest(overlaySel)) return;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const srOnly = el.closest(".sr-only") !== null || el.classList.contains("sr-only");
    if (!srOnly && (r.width < 4 || r.height < 4)) return;
    if (cs.visibility === "hidden" || cs.display === "none") return;
    const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const on = (a) => el.getAttribute(a) === "true" || el.closest(`[${a}="true"]`) !== null;
    const href = el.getAttribute("href");
    let external = false, self = false;
    if (href != null) {
      if (/^(mailto|tel|sms):/i.test(href) || el.getAttribute("target") === "_blank") external = true;
      else {
        try {
          const u = new URL(href, location.href);
          if (u.origin !== location.origin) external = true;
          else if (u.pathname === location.pathname && u.search === location.search) self = true;
        } catch { external = true; }
      }
    }
    out.push({
      path: pathFrom(el, root),
      label,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      srOnly,
      active: on("aria-selected") || on("aria-current") || on("aria-pressed") || el.getAttribute("aria-current") === "page" ||
        el.dataset.state === "active" || el.closest('[data-state="active"]') !== null,
      external, self,
      inToast: el.closest("[data-sonner-toaster]") !== null,
      // The record this control acts on, as the user sees it: the nearest row / card / dialog.
      rowText: (el.closest('tr, li, article, [role="row"], [role="listitem"], [role="dialog"], [role="alertdialog"], [class*="card"], [class*="Card"]')?.innerText || "").replace(/\s+/g, " ").slice(0, 400),
    });
  });
  // Ordinal among controls sharing a label and tag, so a control can be found
  // again by identity when its DOM path has moved (a toast, a portal, a
  // re-ordered list between two loads of the same screen).
  const seen = new Map();
  for (const c of out) {
    const k = c.tag + "|" + c.label;
    c.ordinal = seen.get(k) ?? 0;
    seen.set(k, c.ordinal + 1);
  }
  void base;
  return out;
};

/** Structural fingerprint of the page; any difference is "something happened". */
const SNAPSHOT = ({ overlaySel }) => {
  const stripStyle = (html) => html.replace(/\sstyle="[^"]*"/g, "").replace(/\sdata-(?:focus-visible|highlighted)[^\s>]*/g, "");
  const rootEl = document.getElementById("root");
  const html = rootEl ? stripStyle(rootEl.innerHTML) : "";
  let h = 0;
  for (let i = 0; i < html.length; i++) h = (h * 31 + html.charCodeAt(i)) | 0;
  return {
    url: location.href,
    hash: h,
    body: (document.body.innerText || "").length,
    overlays: document.querySelectorAll(overlaySel).length,
    toasts: document.querySelectorAll("[data-sonner-toast]").length,
    errorToasts: [...document.querySelectorAll('[data-sonner-toast][data-type="error"]')].map((t) => (t.innerText || "").trim().slice(0, 120)),
    inputs: document.querySelectorAll("input, textarea, select").length,
    state: [...document.querySelectorAll('[role="switch"], [aria-checked], [aria-expanded], [aria-selected], [aria-pressed], input, select, textarea, details')]
      .map((e) => [e.getAttribute("aria-checked"), e.getAttribute("aria-expanded"), e.getAttribute("aria-selected"), e.getAttribute("aria-pressed"),
        e.tagName === "DETAILS" ? String(e.open) : e.type === "checkbox" || e.type === "radio" ? String(e.checked) : (e.value ?? "")].join("/")).join(","),
    focused: document.activeElement ? document.activeElement.tagName + ":" + (document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "").trim().slice(0, 30) : "",
    text: (document.body.innerText || "").trim().replace(/\s+/g, " ").slice(0, 3000),
  };
};

async function main() {
  const BASE = (process.env.BASE ?? "http://127.0.0.1:4173").replace(/\/$/, "");
  const OUT = process.env.OUT ?? resolve(REPO, "test-results/press-every-control");
  const WIDTH = Number(process.env.WIDTH ?? 375);
  const THEME = process.env.THEME ?? "light";
  const MAX_DEPTH = Number(process.env.MAX_DEPTH ?? 3);
  const SAMPLE = Number(process.env.SAMPLE ?? 2);
  const PERSONAS = (process.env.PERSONAS ?? "anon,customer,helper,admin,incomplete").split(",");
  const SETTLE_MS = Number(process.env.SETTLE_MS ?? 600);
  const PRESS_TIMEOUT = Number(process.env.PRESS_TIMEOUT ?? 8000);
  const RUN_ID = process.env.RUN_ID ?? `${Date.now()}-${process.pid}`;
  const runStart = Date.now();
  mkdirSync(OUT, { recursive: true });

  // ---- sessions on the shared test accounts --------------------------------
  const { sessions, unavailable } = await mintAccounts(PERSONAS.filter((p) => p !== "anon"));
  for (const [p, why] of Object.entries(unavailable)) console.log(`::warning title=persona ${p} not covered::${why}`);

  // Clean-up only: the workflow's final job, after every shard.
  if (process.env.CLEANUP_SINCE) {
    const since = Date.parse(process.env.CLEANUP_SINCE);
    const r = await cleanup({ sessions, since, profilesBefore: {} });
    for (const l of r.log) console.log(`cleaned: ${l}`);
    for (const l of r.residue) console.log(`::warning title=clean-up residue::${l}`);
    writeFileSync(`${OUT}/cleanup.json`, JSON.stringify(r, null, 2));
    return;
  }

  const owners = await loadTestOwners(sessions);
  const poster = sessions.customer ?? null;
  const helper = sessions.helper ?? null;
  const stripeMode = makeStripeProbe(poster, RUN_ID);
  const profilesBefore = {};
  for (const [p, s] of Object.entries(sessions)) profilesBefore[p] = await snapshotProfile(s);

  // ---- real ids ------------------------------------------------------------
  // The run's own fixture job (mutating presses land here), plus one
  // test-owned job per state so /jobs/:id is walked in every shape it takes.
  const jobIds = [];
  if (poster) {
    try { jobIds.push((await createPressJob(poster, RUN_ID)).id); }
    catch (e) { console.log(`::warning title=press fixture job not created::${e.message}`); }
    try {
      const mine = await prodSelect(poster, `jobs?select=id,status&customer_id=eq.${poster.userId}&order=created_at.desc&limit=100`);
      const byState = new Map();
      for (const j of mine) if (!byState.has(j.status)) byState.set(j.status, j.id);
      for (const id of byState.values()) if (!jobIds.includes(id) && jobIds.length < 5) jobIds.push(id);
    } catch { /* the fixture alone still covers the route */ }
  }
  if (!jobIds.length) jobIds.push("00000000-0000-4000-8000-000000000000");
  const helperId = helper?.userId ?? poster?.userId ?? "00000000-0000-4000-8000-000000000000";
  const customerId = poster?.userId ?? helperId;

  let routeSet = deriveRouteSet({ seedJobId: jobIds[0], jobIds, helperId, customerId, adminViews: parseAdminViews() });
  if (process.env.ROUTES) {
    const want = process.env.ROUTES.split(",");
    // A url, or a base path such as /jobs/:id (every row derived from it).
    routeSet = want.flatMap((u) => {
      const hit = routeSet.filter((r) => r.url === u || r.base === u);
      return hit.length ? hit : [{ url: u, base: u, personas: ["anon", "customer", "helper", "incomplete"], redirect: false }];
    });
  }
  if (process.env.SHARD) {
    const [i, n] = process.env.SHARD.split("/").map(Number);
    routeSet = routeSet.filter((_, k) => k % n === i - 1);
  }

  // Same machine-wide queue as the Playwright suites (e2e/browserLock.ts), so
  // this can be started any time and simply waits for a free browser.
  const { acquireBrowserLock, releaseBrowserLock } = await import(pathToFileURL(resolve(REPO, "e2e/browserLock.ts")).href);
  await acquireBrowserLock();
  process.on("exit", () => releaseBrowserLock());
  const browser = await chromium.launch();
  const results = []; // one per route × persona
  let failedPresses = 0, undocumented = 0, totalFound = 0, totalPressed = 0, shots = 0;
  const ownershipCache = new Map();

  for (const route of routeSet) {
    if (route.redirect) {
      results.push({ route: route.url, persona: "-", status: "redirect", note: "pure redirect route — its target is walked on its own row", controls: [] });
      continue;
    }
    const personas = route.personas.filter((p) => PERSONAS.includes(p));
    for (const persona of personas) {
      const rec = { route: route.url, persona, status: "ok", landedOn: null, found: 0, pressed: 0, passed: 0, failed: 0, skipped: 0, controls: [], notes: [] };
      results.push(rec);
      const session = persona === "anon" ? null : sessions[persona];
      if (persona !== "anon" && !session) {
        rec.status = "uncovered";
        rec.notes.push(`account unavailable (persona not minted): ${unavailable[persona] ?? "not requested"}`);
        continue;
      }

      const ctx = await browser.newContext({
        viewport: { width: WIDTH, height: WIDTH <= 430 ? 812 : 900 },
        colorScheme: THEME, deviceScaleFactor: 2,
        // Block the Workbox service worker, as playwright.config.ts does for
        // happy-path: its NetworkFirst handler answers ahead of the page and
        // made every press look like a 401 (first run, 2026-09-12).
        serviceWorkers: "block",
      });
      await ctx.addInitScript((t) => { try { localStorage.setItem("helpr-theme", t); localStorage.setItem("helpr_welcomed", "1"); } catch { /* blocked */ } }, THEME);
      if (session) {
        await ctx.addInitScript(([k, v]) => {
          try {
            localStorage.setItem(k, v);
            localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
          } catch { /* blocked */ }
        }, [session.key, session.value]);
      }

      const page = await ctx.newPage();
      const consoleErrors = [];
      const netFails = [];
      const popups = [];
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        if (CONSOLE_NOISE.some((rx) => rx.test(t))) return;
        consoleErrors.push(t.replace(/\s+/g, " ").slice(0, 200));
      });
      page.on("pageerror", (e) => consoleErrors.push("uncaught: " + String(e.message).slice(0, 200)));
      page.on("response", (r) => {
        const s = r.status();
        if (s >= 400 && s !== 406) netFails.push(`${s} ${r.request().method()} ${r.url().replace(/\?.*$/, "").split("/").slice(-2).join("/")}`);
      });
      ctx.on("page", (p) => { popups.push(p.url()); p.close().catch(() => {}); });
      const downloads = [];
      page.on("download", (d) => { downloads.push(d.suggestedFilename()); d.cancel().catch(() => {}); });

      // The record the URL names, resolved once per route × persona (read-only select as this account).
      const urlOwnedKey = `${persona}|${route.url}`;
      if (session && !ownershipCache.has(urlOwnedKey)) ownershipCache.set(urlOwnedKey, await urlOwnership(session, route.url, owners));
      const urlOwned = ownershipCache.get(urlOwnedKey) ?? { owned: false, why: "anonymous" };

      const gate = (label, meta, chainOwned) => mutationGate({ label, meta, chainOwned, persona, routeUrl: route.url, urlOwned, owners, stripeMode, note: (n) => rec.notes.push(n) });

      const settle = async () => {
        await page.waitForFunction(() => {
          const busy = document.querySelectorAll('[aria-busy="true"]').length;
          const pulses = [...document.querySelectorAll('[class*="animate-pulse"]')].filter((e) => !e.closest("[aria-hidden='true']")).length;
          return busy === 0 && pulses === 0;
        }, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(SETTLE_MS);
      };
      // The URL the screen rests at after a clean load; any drift from it (a
      // filter param, a highlight, a navigation) means the DOM paths no longer
      // address the same controls, so the page is reloaded before the next press.
      let restingUrl = "";
      const load = async () => {
        // After the first load the screen is re-entered at the URL it RESTED
        // on: a route that redirects on state (/jobs/:id → the list that owns
        // the job) can land somewhere else on a second visit, and then no DOM
        // path would match.
        await page.goto(restingUrl || BASE + route.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForFunction(() => (document.body.innerText || "").trim().length > 20, { timeout: 15_000 }).catch(() => {});
        await settle();
      };
      const sameScreen = (u) => {
        const a = new URL(u), b = new URL(BASE + route.url);
        const key = (x) => x.pathname + "|" + (x.searchParams.get("tab") ?? "") + "|" + (x.searchParams.get("view") ?? "");
        return key(a) === key(b);
      };
      /**
       * A route that lands somewhere else is a pure bounce (login, account
       * gates, the bare dashboard — walked on their own rows) OR a real
       * screen with state in its query (/jobs/:id → /my-posts?highlight=…,
       * /dashboard?quickApply=…) that no other row reaches. The second kind is
       * walked HERE, on the screen it landed on.
       */
      const isBounce = (u) => {
        const x = new URL(u);
        return /^\/(login|signup|signup-pending|account-pending|account-denied|account-banned|complete-profile)(\/|$)/.test(x.pathname)
          || (!x.search && routeSet.some((r) => r.url === x.pathname && r.personas.includes(persona)));
      };
      const atRest = () => page.url() === restingUrl;
      const snapshot = () => page.evaluate(SNAPSHOT, { overlaySel: OPEN_OVERLAY });
      const enumerate = (scope) => page.evaluate(ENUMERATE, { controlSel: CONTROL_SEL, overlaySel: OPEN_OVERLAY, scope, base: BASE });
      const slug = (s) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 80);
      const shoot = async (name) => {
        const file = `${OUT}/${slug(`${route.url}-${persona}-${name}`)}-${shots++}.png`;
        await page.screenshot({ path: file, fullPage: false }).catch(() => {});
        return file;
      };

      try {
        await load();
        const landed = page.url();
        rec.landedOn = landed.replace(BASE, "");
        if (!sameScreen(landed)) {
          if (isBounce(landed)) {
            rec.status = "redirect";
            rec.notes.push(`redirected to ${rec.landedOn} — that screen is walked on its own row`);
            await ctx.close();
            console.log(`[${route.url} ${persona}] → redirect ${rec.landedOn}`);
            continue;
          }
          rec.notes.push(`redirected to ${rec.landedOn} — walked here, on the screen it landed on`);
        }
        restingUrl = landed;
        const boot = await snapshot();
        if (ERROR_BOUNDARY_RX.test(boot.text)) {
          rec.status = "error-on-load";
          rec.failed++; failedPresses++;
          rec.controls.push({ chain: [], label: "(page load)", result: "FAIL", why: "error boundary / error copy rendered on load", shot: await shoot("load-error") });
        }

        // Locator for a chain element: page-level path is relative to <body>;
        // overlay-level paths are relative to the NEWEST open overlay.
        const locate = (step) => step.scope === "overlay"
          ? page.locator(OPEN_OVERLAY).last().locator(":scope > " + step.path)
          : page.locator("body > " + step.path);

        /** Re-establish the screen and replay every opener in `chain`. */
        const replay = async (chain) => {
          if (!atRest() || chain.length === 0 || (await page.locator(OPEN_OVERLAY).count()) > 0) {
            await load();
          }
          for (const step of chain) {
            const loc = locate(step);
            if (!(await loc.count())) return false;
            const before = await page.locator(OPEN_OVERLAY).count();
            await loc.first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            await loc.first().click({ timeout: PRESS_TIMEOUT }).catch(() => {});
            await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [OPEN_OVERLAY, before], { timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(SETTLE_MS);
            if ((await page.locator(OPEN_OVERLAY).count()) <= before) return false;
          }
          return true;
        };

        // The work queue: every control found on the page, then every control
        // found inside any overlay a press opened.
        const queue = (await enumerate("page")).map((c) => ({ chain: [], step: { scope: "page", path: c.path }, meta: c, depth: 0, chainOwned: false }));
        const seenOverlays = new Set();
        let idx = 0;
        let pageDirty = false; // a press changed the resting page; reload before the next one

        while (idx < queue.length) {
          const item = queue[idx++];
          const { meta } = item;
          const chain = item.chain.map((s) => s);
          const label = meta.label || `<${meta.tag}${meta.type ? ` type=${meta.type}` : ""}>`;
          const entry = { chain: [...chain.map((s) => s.label), label], path: item.step.path, depth: item.depth, label, result: "", why: "" };
          rec.controls.push(entry);
          rec.found++; totalFound++;

          const skip = (why) => { entry.result = "SKIP"; entry.why = why; rec.skipped++; };
          if (meta.disabled) { skip("disabled (inert by design)"); continue; }
          if (meta.srOnly) { skip("screen-reader only (pointer not expected)"); continue; }
          if (meta.active) { skip("already the active tab/route (no-op expected)"); continue; }
          if (meta.self) { skip("self-link (no-op expected)"); continue; }
          if (meta.external) { skip("external / new-tab link (covered by walk-every-control's new-tab pass)"); continue; }
          if (meta.type === "file") { skip("file picker (opens the OS dialog; not a DOM outcome)"); continue; }
          if (meta.inToast) { skip("inside a toast (transient; not page chrome)"); continue; }
          if (DESTRUCTIVE_RX.test(label) || meta.type === "submit" || PAYMENT_RX.test(label)) {
            const why = await gate(label, meta, item.chainOwned);
            if (why) { skip(why); continue; }
            entry.mutating = true;
          }

          // Baseline: the resting page with the opener chain replayed.
          if (chain.length) {
            if (!(await replay(chain))) {
              // Once more from a clean load before giving up on it.
              await load();
              if (!(await replay(chain))) { skip("opener chain could not be replayed (parent press reported separately)"); continue; }
            }
          } else if (pageDirty || !atRest() || (await page.locator(OPEN_OVERLAY).count()) > 0) {
            await load();
            pageDirty = false;
          }

          let target = locate(item.step);
          if (!(await target.count())) {
            await load(); pageDirty = false;
            if (chain.length && !(await replay(chain))) { skip("opener chain could not be replayed (parent press reported separately)"); continue; }
            target = locate(item.step);
          }
          if (!(await target.count())) {
            // The path moved (a toast or portal shifted nth-of-type). Find the
            // same control by identity — tag, label, ordinal — and re-address it.
            const again = (await enumerate(item.step.scope)).find((c) => c.tag === meta.tag && c.label === meta.label && c.ordinal === meta.ordinal);
            if (again) { item.step.path = again.path; target = locate(item.step); entry.relocated = true; }
          }
          if (!(await target.count())) {
            entry.result = "FAIL"; entry.why = "control not found on a freshly loaded page (transient or non-deterministic DOM)";
            rec.failed++; failedPresses++;
            entry.shot = await shoot(`missing-${slug(label)}`);
            continue;
          }
          target = target.first();

          const before = await snapshot();
          const errs0 = consoleErrors.length, net0 = netFails.length, pop0 = popups.length, dl0 = downloads.length;
          try {
            await target.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
            await target.click({ timeout: PRESS_TIMEOUT });
          } catch (e) {
            // One retry: the layout may still have been settling under it.
            await page.waitForTimeout(500);
            try { await target.click({ timeout: PRESS_TIMEOUT }); }
            catch {
              entry.result = "FAIL"; entry.why = "NOT CLICKABLE: " + String(e.message).replace(/\s+/g, " ").slice(0, 300);
              rec.failed++; failedPresses++;
              entry.shot = await shoot(`unclickable-${slug(label)}`);
              pageDirty = true;
              continue;
            }
          }
          rec.pressed++; totalPressed++;
          await settle();
          const after = await snapshot();

          // ---- classify ------------------------------------------------
          const problems = [];
          const newErrToasts = after.errorToasts.filter((t) => !before.errorToasts.includes(t));
          if (newErrToasts.length) problems.push(`error toast: "${newErrToasts[0]}"`);
          if (ERROR_BOUNDARY_RX.test(after.text) && !ERROR_BOUNDARY_RX.test(before.text)) problems.push("error boundary / error copy rendered");
          const newErrs = consoleErrors.slice(errs0);
          if (newErrs.length) problems.push(`console: ${newErrs[0]}`);
          const newNet = netFails.slice(net0);
          if (newNet.length) problems.push(`network: ${[...new Set(newNet)].slice(0, 3).join(" | ")}`);

          const changed =
            after.url !== before.url ? `navigated → ${after.url.replace(BASE, "")}` :
            popups.length > pop0 ? `opened a new tab (${popups[pop0]})` :
            downloads.length > dl0 ? `started a download (${downloads[dl0]})` :
            after.overlays > before.overlays ? "opened an overlay" :
            after.overlays < before.overlays ? "closed the overlay" :
            after.toasts > before.toasts ? "showed a toast" :
            after.inputs !== before.inputs ? `revealed/removed a field (${before.inputs}→${after.inputs})` :
            after.state !== before.state ? "changed a toggle/field" :
            after.hash !== before.hash ? `changed the DOM (${after.body - before.body >= 0 ? "+" : ""}${after.body - before.body} chars)` :
            after.focused !== before.focused ? "moved focus only" :
            "";
          if (!changed) problems.push("no observable change");
          else if (changed === "moved focus only") problems.push("no observable change (focus moved, nothing else)");

          entry.outcome = changed || "nothing";
          if (problems.length) {
            entry.result = "FAIL"; entry.why = problems.join("; ");
            rec.failed++; failedPresses++;
            entry.shot = await shoot(`fail-${slug(label)}`);
          } else {
            entry.result = "PASS"; rec.passed++;
            if (rec.pressed <= SAMPLE) entry.shot = await shoot(`sample-${slug(label)}`);
          }

          // ---- recurse into what it opened -----------------------------
          if (after.overlays > before.overlays && item.depth < MAX_DEPTH) {
            const inner = await enumerate("overlay");
            const key = inner.map((c) => c.path + c.label).join("|");
            if (inner.length && !seenOverlays.has(key)) {
              seenOverlays.add(key);
              const nextChain = [...chain, { ...item.step, label }];
              const chainOwned = item.chainOwned || rowNamesTestOwner(meta.rowText, owners);
              for (const c of inner) queue.push({ chain: nextChain, step: { scope: "overlay", path: c.path }, meta: c, depth: item.depth + 1, chainOwned });
              entry.opened = inner.length;
            }
            // Close it so the next page-level control starts clean.
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(300);
            if ((await page.locator(OPEN_OVERLAY).count()) > before.overlays) pageDirty = true;
          } else if (after.url !== before.url || after.overlays !== before.overlays || after.inputs !== before.inputs || after.state !== before.state || after.hash !== before.hash) {
            pageDirty = true;
          }
          if (chain.length) pageDirty = true;
        }
      } catch (e) {
        rec.status = "harness-error";
        rec.notes.push("HARNESS ERROR: " + String(e.message).replace(/\s+/g, " ").slice(0, 300));
        rec.failed++; failedPresses++;
      }
      await ctx.close();
      const unpressed = rec.controls.filter((c) => c.result === "SKIP" && !DOCUMENTED_SKIPS.has(c.why)).length;
      undocumented += unpressed;
      console.log(`[${route.url} ${persona}] found=${rec.found} pressed=${rec.pressed} pass=${rec.passed} fail=${rec.failed} skip=${rec.skipped}${rec.failed ? " :: " + rec.controls.filter((c) => c.result === "FAIL").slice(0, 4).map((c) => `"${c.chain.join(" › ")}" — ${c.why}`).join(" ;; ") : ""}`);
    }
  }
  await browser.close();

  // ---- clean up what the presses created --------------------------------------
  const cleaned = await cleanup({ sessions, since: runStart - 60_000, profilesBefore });
  for (const l of cleaned.log) console.log(`cleaned: ${l}`);
  for (const l of cleaned.residue) console.log(`::warning title=clean-up residue::${l}`);

  // ---- coverage report ------------------------------------------------------
  const lines = [];
  lines.push("# press-every-control coverage", "", `prod width=${WIDTH} theme=${THEME} base=${BASE} run=${RUN_ID}`, "");
  const uncovered = results.filter((r) => r.status === "uncovered");
  if (uncovered.length) lines.push(`**UNCOVERED personas:** ${[...new Set(uncovered.map((r) => `${r.persona} (${r.notes[0]})`))].join("; ")}`, "");
  lines.push("| route | persona | found | pressed | pass | fail | skipped (documented) | undocumented |", "|---|---|---:|---:|---:|---:|---:|---:|");
  for (const r of results) {
    if (r.status === "redirect") { lines.push(`| ${r.route} | ${r.persona} | — | — | — | — | redirect → ${r.landedOn ?? "target"} | — |`); continue; }
    if (r.status === "uncovered") { lines.push(`| ${r.route} | ${r.persona} | — | — | — | — | UNCOVERED (${r.notes[0]}) | — |`); continue; }
    const doc = r.controls.filter((c) => c.result === "SKIP" && DOCUMENTED_SKIPS.has(c.why)).length;
    const undoc = r.controls.filter((c) => c.result === "SKIP" && !DOCUMENTED_SKIPS.has(c.why)).length;
    lines.push(`| ${r.route} | ${r.persona} | ${r.found} | ${r.pressed} | ${r.passed} | ${r.failed} | ${doc} | ${undoc} |`);
  }
  const fails = results.flatMap((r) => r.controls.filter((c) => c.result === "FAIL").map((c) => ({ ...c, route: r.route, persona: r.persona })));
  lines.push("", `## Failed presses (${fails.length})`, "");
  for (const f of fails) lines.push(`- **${f.route}** (${f.persona}) › ${f.chain.join(" › ")} — ${f.why}${f.shot ? ` — ${f.shot}` : ""}`);
  const skips = results.flatMap((r) => r.controls.filter((c) => c.result === "SKIP").map((c) => ({ ...c, route: r.route, persona: r.persona })));
  lines.push("", `## Unpressed controls (${skips.length}) — every one with its reason`, "");
  for (const s of skips) lines.push(`- ${s.route} (${s.persona}) › ${s.chain.join(" › ")} — ${s.why}${DOCUMENTED_SKIPS.has(s.why) ? "" : "  **UNDOCUMENTED**"}`);
  const mutated = results.flatMap((r) => r.controls.filter((c) => c.mutating && c.result !== "SKIP").map((c) => `- ${r.route} (${r.persona}) › ${c.chain.join(" › ")} — ${c.result}: ${c.outcome ?? ""}`));
  lines.push("", `## Mutating presses on test-owned targets (${mutated.length})`, "", ...mutated);
  lines.push("", `## Clean-up`, "", ...cleaned.log.map((l) => `- ${l}`), ...cleaned.residue.map((l) => `- **RESIDUE** ${l}`));
  writeFileSync(`${OUT}/coverage.md`, lines.join("\n") + "\n");
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ width: WIDTH, theme: THEME, runId: RUN_ID, uncovered: unavailable, cleanup: cleaned, results }, null, 2));

  const pressedOrDocumented = totalFound - undocumented;
  console.log(`\nfound=${totalFound} pressed=${totalPressed} failed=${failedPresses} undocumented-skips=${undocumented} coverage=${totalFound ? ((pressedOrDocumented / totalFound) * 100).toFixed(1) : "100.0"}%`);
  console.log(`wrote ${OUT}/coverage.md and ${OUT}/results.json (${shots} screenshots)`);
  if (failedPresses > 0 || undocumented > 0) {
    console.log(`FAIL: ${failedPresses} failed press(es), ${undocumented} control(s) unpressed without a documented reason`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
