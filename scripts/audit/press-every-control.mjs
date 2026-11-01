/**
 * PRESS EVERY CONTROL — the gap-free successor to walk-every-control.mjs.
 *
 * The owner's complaint: "there is no way every button has been clicked to be
 * sure not failing." They were right. The walker had five holes, and this
 * file closes each one by construction rather than by care:
 *
 *   1. `labels.slice(0, 40)`     → there is NO cap. Every control is queued.
 *   2. default ROUTES=/home → the route set is DERIVED FROM src/App.tsx
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
 *   ROUTES=/home,/profile?tab=earnings  … to narrow
 *   PERSONAS=customer                       … to narrow (anon,customer,helper,admin,incomplete)
 *   SHARD=1/4                               … CI sharding over the route list
 *   PRESS_QUEUE_DIR=<dir>                   … shards CLAIM rows from one shared queue instead
 *                                             (#1582); SHARD then only names the shard
 *   PRESS_LAST_WAVE=0                       … a later wave follows: stop at the budget and
 *                                             hand unwalked rows on instead of reporting them
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
  remintSession, restorePlan, restoreSource, rowNamesTestOwner, sessionStillAlive, snapshotAccounts, urlOwnership,
} from "./pressProdSafety.mjs";
import * as pressSafety from "./pressProdSafety.mjs";
import { isCaptchaGatedAuthRequest, isStripeWriteRequest, pressWriteKind, PRESS_WRITE_SURFACE_RX, SKIP_CAPTCHA_GATED, SKIP_STRIPE_WRITE_BLOCKED } from "./pressProdSafety.mjs";
import { LOADING_SEL, LOADING_TEXT_RX_SOURCE, SELF_HEAL_MS, SELF_HEAL_SEL, awaitLoadingQuiet, awaitSelfHeal, classifyBoot, countLoadingMarkers, summarizeTimings } from "./pressLoadHealth.mjs";
import {
  CHROME_SKIP, FOREIGN_FIXTURE_SKIP, LANDING_QUIET_MS, PACE_HEADROOM, cycleBurstEstimate, landingSettled, NOT_REACHED_STATUS, ceilingWaitMs, chromeDisposition, chromeKey,
  claimRow, drainedQueueShard, classifyConsoleError, classifyFailedResponse, clickFailureReason, queuedRowAction, releaseRow, isForeignSweepFixture, overTimeBudget, refusalIsDeath, rowDetailLines, tokenNeedsRefresh,
} from "./pressFailureClass.mjs";
import { budgetFor } from "../e2e/request-budget.mjs";
import { recordRouteProbePasses, routeProbePasses } from "./pressRouteProbe.mjs";

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
/**
 * Q1405: each row's wall time, from its own start to the next row's start (or
 * `endedAt` for the last), with its press count and the time spent waiting on
 * the request ceiling. Rows run one after another in a shard, so consecutive
 * starts bound each row. Slowest first.
 */
export function rowTimings(results, endedAt) {
  const started = results.filter((r) => typeof r.startedAt === "number");
  return started
    .map((r, i) => ({
      route: r.route,
      persona: r.persona,
      ms: Math.max(0, (started[i + 1]?.startedAt ?? endedAt) - r.startedAt),
      presses: r.pressed ?? 0,
      paceMs: r.paceMs ?? 0,
    }))
    .sort((a, b) => b.ms - a.ms);
}

export function parseAppRoutes(appSrc = readFileSync(resolve(REPO, "src/App.tsx"), "utf8")) {
  const out = [];
  for (const m of appSrc.matchAll(/(\{\s*(\w+)\s*&&\s*)?<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    const guard = m[2];
    if (guard && flagValue(guard) === false) continue;
    const path = m[3];
    const el = m[4].trim();
    // The page itself, out of its route wrappers (error boundary, routeEl, sign-in gate):
    // `<RouteErrorBoundary>{routeEl(<ProtectedRoute><ExploreRedirect /></ProtectedRoute>)}</RouteErrorBoundary>`
    // is a redirect as much as a bare `<QuotesHubRedirect />` is (2026-10-20, /explore).
    const page = el
      .replace(/^<RouteErrorBoundary>\{([\s\S]*)\}<\/RouteErrorBoundary>$/, "$1")
      .replace(/^routeEl\(([\s\S]*)\)$/, "$1")
      .replace(/^<ProtectedRoute>([\s\S]*)<\/ProtectedRoute>$/, "$1")
      .trim();
    const redirect = /^<Navigate\b/.test(el) || /^<\w*Redirect\s*\/>$/.test(page);
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

/** The admin `View` union, parsed from src/pages/admin/Admin.tsx so a new view is walked. */
export function parseAdminViews(src = readFileSync(resolve(REPO, "src/pages/admin/Admin.tsx"), "utf8")) {
  const m = /type View\s*=\s*([^;]+);/.exec(src);
  if (!m) throw new Error("Could not find `type View` in src/pages/admin/Admin.tsx");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).filter((v) => v !== "home");
}

/** The Legal tabs, from the page's own union. */
export function parseLegalTabs() {
  const file = resolve(REPO, "src/pages/info/Legal.tsx");
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
      // OPS-4: a town page only exists for a real service and town (src/lib/townPages.mjs); /hire/test/test is the 404.
      .replace(/^\/hire\/:service\/:town$/, "/hire/handyman/lafayette")
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
import { ERROR_SCREEN_PATTERNS, textOutsideQuotedLogs } from "../../e2e/errorScreens.ts";
export const ERROR_BOUNDARY_RX = new RegExp(ERROR_SCREEN_PATTERNS.filter((p) => p.name !== "404 on a real route").map((p) => p.re.source).join("|"), "i");
/**
 * A SNAPSHOT result with `text` replaced by the screen's own copy: the
 * [data-quoted-log] spans (stored error text rendered as data, e.g. the admin
 * health alert list) removed, then collapsed and cut to 3000 chars — the text
 * ERROR_BOUNDARY_RX is tested against (Q101).
 */
export function screenErrorText(snap) {
  const { quoted = [], ...rest } = snap;
  return { ...rest, text: textOutsideQuotedLogs(snap.text ?? "", quoted).trim().replace(/\s+/g, " ").slice(0, 3000) };
}
/** Labels that MUTATE something. Pressed only on a test-owned target (see pressProdSafety.mjs). */
export const SENTRY_PROBE_RX = /uncaught:\s*Sentry uncaught test\b/i;
// end / leave / give up / turn down / escalate / take back (2026-10-17): a
// recurring series' "End series" and "Leave series", "Give up" its dates, a
// crew's "Turn Down" / "Leave Crew", a dispute's "Escalate to Admin" and a
// document's "Take It Back" named none of the words before them, so the sweep
// would press them ungated. Guard: src/test/pressGatesEveryIrreversibleControl.test.ts.
/*
 * "got it" (run 39014836855, leg 4): BackoutBanner's "Got it" calls
 * ack_backout_notice, and Declutter's "I got it" pays the seller. Neither word
 * was here, so the sweep pressed twelve "Got it"s on /posts as an ungated,
 * unrecorded read, cleared twelve backout notices on prod, and then reported
 * the cards those writes moved out of the "You" bucket as missing.
 */
/** The `why` prefix of a press the network gate caught writing ungated (networkGate). */
export const GATE_MISS = "GATE MISS";
/**
 * THE NETWORK GATE (lead, 2026-10-17): the guarantee under the words.
 * `handler` goes on the browser context with ctx.route(PRESS_WRITE_SURFACE_RX);
 * `arm()` before a press the gate did NOT class as mutating, `disarm()` after
 * it (returns what it caught). While armed, a request pressWriteKind calls a
 * write is aborted before it leaves and recorded as a miss, a side effect is
 * aborted and recorded apart; everything else, and everything while disarmed,
 * falls through to the routes registered before it.
 */
/**
 * How a caught request is named: METHOD and path, plus the grant_type or scope
 * of a GoTrue call, so "POST /auth/v1/token?grant_type=password" and
 * "POST /auth/v1/logout?scope=global" say which auth write it was.
 */
export function gateRequestLabel(method, url) {
  let u;
  try { u = new URL(String(url)); } catch { return `${method} ${String(url).slice(0, 120)}`; }
  const q = u.pathname.startsWith("/auth/v1/") ? ["grant_type", "scope"].filter((k) => u.searchParams.has(k)).map((k) => `${k}=${u.searchParams.get(k)}`).join("&") : "";
  return `${method} ${u.pathname}${q ? `?${q}` : ""}`;
}
export function networkGate() {
  let armed = null;
  return {
    arm() { armed = { misses: [], sideEffects: [] }; },
    disarm() {
      const caught = armed ?? { misses: [], sideEffects: [] };
      armed = null;
      return { misses: [...new Set(caught.misses)], sideEffects: [...new Set(caught.sideEffects)] };
    },
    async handler(route, req) {
      const kind = pressWriteKind({ method: req.method(), url: req.url(), body: req.postData() });
      if (!armed || kind === "read") return route.fallback();
      const request = gateRequestLabel(req.method(), req.url());
      (kind === "side-effect" ? armed.sideEffects : armed.misses).push(request);
      return route.abort("blockedbyclient");
    },
  };
}
export const DESTRUCTIVE_RX = /\b(delete|remove|pay|submit|send|ban|unban|confirm|release|refund|withdraw|cancel|accept|decline|hire|book|apply|block|report|sign out|log out|deactivate|unsubscribe|subscribe|upgrade|post job|publish|save|update|approve|deny|resolve|suspend|restore|reset|revoke|complete|mark|tip|boost|purchase|buy|checkout|end|leave|give up|turn down|escalate|take (?:it )?back|take down|close my shop|got it|unsave|reverse|connect (?:google|apple)|watch|unwatch)\b/i;
export { ACCOUNT_DESTROY_RX, SESSION_END_RX, PAYMENT_RX, SELF_ROUTE_RX } from "./pressProdSafety.mjs";
import { isDeclaredReadRpcPath } from "./declaredReadRpcs.mjs";
import { PAYMENT_RX, isAccountSettingToggle, isAdminStateToggle, isAdminWrite, isCommitControl, isNotificationOpen } from "./pressProdSafety.mjs";
import { RequestMeter } from "../../e2e/requestMeter.mjs";
/** Console lines the HARNESS causes, not the app. */
/**
 * Scripts only Vercel's edge serves. The harness runs against a local
 * `vite preview`, where /_vercel/insights/script.js and
 * /_vercel/speed-insights/script.js are always 404 — so any press that
 * mounted the app afresh ("Go back" on the 404 page) failed on a request that
 * cannot succeed off Vercel (runs 34744828202 and 34865377511). Ignored only
 * when the harness is NOT pointed at a Vercel host.
 */
export const HOST_ONLY_ASSET_RX = /\/_vercel\/(speed-)?insights\//;
export const ignoreHostOnlyAsset = (url, base) => HOST_ONLY_ASSET_RX.test(String(url ?? "")) && !/vercel\.app|louisianahelpr\.com/.test(String(base ?? ""));

/**
 * A TRUTHFUL PERMISSION REFUSAL IS NOT A DEFECT.
 *
 * Measured on run 35660182220 (2026-09-21): two presses failed on every route
 * that carries the bell, for the helper, incomplete and admin personas —
 *
 *   "Notifications › Turn on push notifications › Not Now"            error toast
 *   "Notifications › Turn on push notifications › Turn On Notifications"  same
 *   → "Notifications are off. Turn them on in your browser settings."
 *
 * That toast is the app telling the truth. A Playwright context grants no
 * notification permission, so `Notification.permission` is already "denied"
 * before the sweep touches anything, and `NotificationPanel.enablePush()`
 * (src/components/NotificationPanel.tsx:389-401) surfaces the settings hint for
 * BOTH buttons: `pushDeclineNeedsSettingsHint` only exempts the undecided
 * "prompt" state, and in CI the state is never "prompt". The press worked, the
 * product behaved, and the message was accurate.
 *
 * WHY NOT GRANT THE PERMISSION INSTEAD. That looked like the better fix — the
 * app would never need to refuse — but it deletes the controls. The row is
 * gated `showPushRow = pushSupported && !pushEnabled`
 * (NotificationPanel.tsx:547) with `pushEnabled = getPushPermission() === "granted"`
 * (:295), so a granted context hides the row AND the two rationale-dialog
 * buttons behind it: three pressed controls become zero found, and the app's
 * only ungated entry point to enabling push leaves the press inventory
 * altogether. A fix that shrinks the inventory is not a fix.
 *
 * So the denial stays and only the DEMONSTRABLY TRUE toast stops counting. All
 * three conditions must hold, and the third is read from the live page:
 *
 *   1. the toast is EXACTLY the permission-off copy (anchored; the two strings
 *      are asserted against NotificationPanel.tsx itself in
 *      src/test/pressPermissionRefusal.test.ts, so a copy change reopens this)
 *   2. the press is inside the push-permission prompt, not somewhere else
 *   3. the browser really has notifications denied
 *
 * Any of them failing still FAILS the press. The same toast while permission is
 * "granted" or "default" is a lie and is reported; a different error toast in
 * the same dialog is reported. This is not "ignore error toasts".
 */
export const PERMISSION_OFF_TOAST_RX = /^Notifications are off\.\s+Turn them on in your (?:browser|device) settings\.$/;
/** The push-permission prompt: the panel row that opens it, and the two buttons inside it. */
export const PUSH_PROMPT_LABEL_RX = /^(?:turn on push notifications|not now|turn on notifications)$/i;

export function isTruthfulPermissionRefusal({ toast, chain = [], permission } = {}) {
  if (!PERMISSION_OFF_TOAST_RX.test(String(toast ?? "").trim())) return false;
  if (permission !== "denied") return false;
  // "Not Now" in our own rationale never reaches the browser, so the app no
  // longer toasts for it at all (OPEN.md pushPermissionNudge item, 2026-10-02);
  // a permission-off toast there is a regression, not the truth.
  if (/^not now$/i.test(String(chain[chain.length - 1] ?? "").trim())) return false;
  return chain.some((label) => PUSH_PROMPT_LABEL_RX.test(String(label ?? "").trim()));
}

/*
 * ADDRESSING A CONTROL THAT LIVES IN A LIVE, SELF-CONSUMING LIST.
 *
 * Measured on run 35660182220 (2026-09-21): 193 of 228 failed presses were
 * "control not found on a freshly loaded page", and 183 of those 193 were
 * children of ONE overlay — the notification panel behind the bell.
 *
 * The harness presses a nested control by reloading the screen, replaying the
 * opener chain and re-addressing the control by the DOM path it was first seen
 * at. Three things make that path wrong for a notification row:
 *
 *   1. PRESSING A ROW CONSUMES IT. `NotificationPanel.handleClick` marks the
 *      notification read (NotificationPanel.tsx:532-533) and the panel's filter
 *      resolves to "unread" whenever anything is unread (:427-429), so the row
 *      is gone from the list on the next open and every row after it shifts up
 *      one `nth-of-type` AND one ordinal.
 *   2. THE FILTER IS NOT THE SAME ON EVERY OPEN. `filter` starts `null` and is
 *      decided once the rows land, so the panel can be enumerated in "all" and
 *      re-opened in "unread" (that is exactly what run 35660182220 shows: the
 *      "Unread" tab press reported "changed a toggle/field", i.e. it was NOT
 *      selected when the panel was walked).
 *   3. THE FALLBACK COULD NOT TELL THE ROWS APART. Re-addressing by identity
 *      used `tag | label | ordinal`, and `label` is truncated at 60 characters
 *      — 57 rows in that run shared the label "Payment secured in escrow Your
 *      payment for "[E2E DO NOT ACCE", leaving the ordinal as the only
 *      discriminator, and the ordinal is precisely what shifts in (1).
 *
 * So identity is the control's WHOLE text, plus its tag and href, with relative
 * timestamps normalised out — "7h ago" becomes "8h ago" during a 20-minute
 * shard, and an identity that drifts with the clock is not an identity.
 */
export const RELATIVE_TIME_RX =
  /\b(?:just now|yesterday|today|\d+\s*(?:s|m|h|d|w|mo|y)\s+ago|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\b/gi;

/** Position-independent identity for a control, stable across re-renders and clock drift. */
export function controlSignature(c) {
  const text = String(c.sigText ?? c.label ?? "")
    .replace(RELATIVE_TIME_RX, "<rel>")
    .replace(/\s+/g, " ")
    .trim();
  return [c.tag ?? "", c.type ?? "", c.href ?? "", text].join("\u0000");
}

/** Attach `sig` and an ordinal among identical signatures. Mutates and returns the list. */
export function withSignatures(list) {
  const seen = new Map();
  for (const c of list) {
    c.sig = controlSignature(c);
    const n = seen.get(c.sig) ?? 0;
    c.sigOrdinal = n;
    seen.set(c.sig, n + 1);
  }
  return list;
}

/**
 * The documented reason a control in a self-consuming list is not pressed. It
 * is NOT "the control is missing, shrug": it is only allowed when the run can
 * point at a control IT ALREADY PRESSED in the same overlay that has also
 * vanished — i.e. this list demonstrably loses the rows it is pressed on. The
 * proof (which pressed rows are gone) is recorded on the entry and printed in
 * coverage.md, so the excuse is never silent.
 */
export const CONSUMED_SKIP = "removed from the list by this run's own earlier press (self-consuming feed)";

export function consumedByEarlierPress({ sig, present, pressed }) {
  if (!sig || present.has(sig)) return null;
  // A COUNT IS NOT A DISAPPEARANCE. "Unread 103" becomes "Unread 46" as the
  // sweep reads rows, and the bottom-nav "Posts" tab carries its badge inside
  // its accessible name — both would otherwise look like controls this run had
  // made vanish, and would excuse anything that went missing beside them.
  const loose = new Set([...present].map(looseSignature));
  const gone = [...(pressed ?? [])].filter((s) => s !== sig && !present.has(s) && !loose.has(looseSignature(s)));
  return gone.length ? gone : null;
}

/** The signature with every run of digits blanked — a badge/count that ticked, same control. */
export function looseSignature(sig) {
  return String(sig).replace(/\d+/g, "#");
}

/**
 * A screen that bounced somewhere else on a LATER load. `/jobs/:id` for the
 * incomplete-profile persona landed on the job page on the first load and on
 * /complete-profile on a reload in run 35660182220, which made the bottom nav
 * "not found" ten times. The controls belong to the screen it went to, and that
 * screen is walked on its own row.
 */
export const BOUNCED_SKIP = "the screen redirected away on a later load; its controls are walked on the screen it went to";

/**
 * WHAT A MISSING CONTROL MEANS — one decision, in one place, so the two call
 * sites cannot drift and a test can drive it.
 *
 *   off the screen entirely  → BOUNCED: a late-resolving gate took us away;
 *                              the controls belong to where it went.
 *   on the screen, in a feed → CONSUMED, but only with proof (see above).
 *   on the screen, on a PAGE → nothing excuses it. A page is not a feed. Run
 *                              35692554813 excused seven page-level controls
 *                              on /account-banned before this line existed.
 */
export function missingControlDisposition({ scope, onSameScreen, consumed, transient = false, foreignFixture = false, rowConsumed = false }) {
  if (!onSameScreen) return BOUNCED_SKIP;
  // A page is not a feed, but a RECORD this run wrote to can leave it: see
  // ROW_CONSUMED_SKIP. Proof is required (rowGoneAfterOwnWrite).
  if (rowConsumed) return ROW_CONSUMED_SKIP;
  if (scope === "overlay" && consumed) return CONSUMED_SKIP;
  if (transient) return TRANSIENT_STATUS_SKIP;
  // Q128: reached through another sweep's live fixture row, which that sweep
  // moved on between loads (pressFailureClass.mjs, class 3).
  if (foreignFixture) return FOREIGN_FIXTURE_SKIP;
  return null;
}

/**
 * A CONTROL INSIDE A SELF-DISMISSING ANNOUNCEMENT.
 *
 * Run 35813177418: "Dismiss" failed "control not found on a freshly loaded
 * page" on /profile?tab=payment and /profile?tab=earnings (helper). The control
 * is PayoutCelebration's close button (src/components/wallet/PayoutCelebration.tsx):
 * a `role="status" aria-live="polite"` card that appears once per new payout,
 * advances `helpr_last_seen_payout_at` the moment it shows (so a reload never
 * shows it again) and closes itself after AUTO_DISMISS_MS = 4s. It is a toast
 * in all but library — and "inside a toast" is already a documented skip.
 *
 * Narrow on purpose: this ONLY applies when the control has gone missing, it
 * was enumerated inside a live status/alert region, and we are still on the
 * same screen. A control in such a region that IS there is pressed normally,
 * and a missing control anywhere else is still a failure.
 */
/**
 * THE RECORD LEFT THE LIST BECAUSE THIS RUN WROTE TO IT.
 *
 * #1582: /admin?view=reports, a report card carries Investigating, Message
 * <reported>, Message <reporter>, Resolve, Dismiss. Pressing Investigating (a
 * write, gated to a test-owned report since isAdminWrite) moves the report out
 * of the pending queue, so every later control of that card is gone on the
 * next load. That is the product working, not a missing control. Excused only
 * with proof: this run made a MUTATING press on a control whose record text
 * is exactly this control's, and no control with that record text is on the
 * reloaded screen. Any other missing control on a page still fails.
 */
/**
 * A CONTROL THAT STOPPED BEING A CONTROL BEFORE IT WAS REACHED.
 *
 * Run 36965978547 leg 1 (2026-10-02, /home customer) failed exactly one press:
 * `Notifications › New application Someone applied to "[SL-SEED] Cancelled
 * with reason"` — "no observable change". Read off prod and the app, not
 * guessed: that notification (08857a79…) has `job_id` AND `link` NULL, so
 * `notificationDestination()` is null and `NotificationPanel.isActionable` is
 * `!n.read` alone. Unread at enumeration it rendered `role="button"`; the
 * shared customer account is walked by six legs at once, and by the time this
 * leg reached the row it had been read (the after-shot shows the "All" filter
 * with every row untinted; prod shows read=true). A read row with nowhere to
 * go drops its role, tab stop and onClick by design — the press clicked a plain
 * <div>, which correctly does nothing.
 *
 * Same disposition as "disabled by the time it was reached": decided at press
 * time from the element itself, and narrow — it fires only when the addressed
 * element no longer matches the control selector at all. A control that still
 * IS a control and does nothing is still a FAIL.
 */
export const NO_LONGER_CONTROL_SKIP = "no longer a control by the time it was reached (lost its control role since enumeration)";
export function pressTimeDisposition({ isControl }) {
  if (!isControl) return NO_LONGER_CONTROL_SKIP;
  return null;
}
export const ROW_CONSUMED_SKIP = "its record left the list after this run's own mutating press on that same record";
export function rowGoneAfterOwnWrite({ rowText, mutatedRows, now }) {
  if (!rowText || !mutatedRows?.has(rowText)) return false;
  return !(now ?? []).some((c) => c.rowText === rowText);
}

/**
 * A PRESS THAT WROTE IS A MUTATING PRESS, WHATEVER ITS LABEL SAID.
 *
 * Release gate run 38459066451 (c16b0f0dc, 2026-10-14), shard 7, /posts
 * (customer): "Got it" on the poster's "[E2E DO NOT ACCEPT] J 7a4n6o" card
 * PASSED at 04:29:06Z, and the same card's "Job address: 100 Audit Way …"
 * then FAILED "control not found on a freshly loaded page". Read off prod, not
 * guessed: backout_notices e032d4ab… (offer_expired, that job) has
 * acknowledged_at = 2026-10-14 04:29:06.70Z, written by that press through
 * `ack_backout_notice`, and a cancelled job sits in Needs You only until its
 * banner is acknowledged (src/lib/backoutNotices.ts). The product worked; the
 * press consumed its own row. ROW_CONSUMED_SKIP exists for exactly this, but it
 * only learnt of writes from the LABEL gate (`entry.mutating`), and "Got it"
 * is not a label anyone would gate. Labels are a guess about what a button
 * does; the request is the fact (same rule as the Stripe-write backstop). So
 * the record text of a press that SENT a successful write is recorded too, and
 * the proof is otherwise unchanged: the same record text, gone from the
 * reloaded screen.
 *
 * What counts as a write: a 2xx PATCH / PUT / DELETE, or POST, to PostgREST or
 * Storage, EXCEPT a POST to an RPC whose name says it reads (`get_`, `is_`,
 * `has_`, `my_`, `search_`, `count_`, `list_`, `can_`, `client_compat_floor`)
 * or that every migration declares STABLE / IMMUTABLE (declaredReadRpcs.mjs),
 * and Storage's list/sign POSTs. Edge functions are not counted (several only
 * read, e.g. check-pro-subscription), so a function-only write still needs the
 * label gate. Misreading a read as a write cannot excuse anything by itself:
 * the record must ALSO be gone from the reloaded screen.
 */
export const READ_RPC_RX = /^(?:get|is|has|my|search|count|list|can)_|^client_compat_floor$/;
export function isWriteRequest({ method, url, status }) {
  const m = String(method ?? "").toUpperCase();
  if (!(Number(status) >= 200 && Number(status) < 300)) return false;
  let path;
  try { path = new URL(String(url)).pathname; } catch { return false; }
  if (!/\/(rest|storage)\/v1\//.test(path)) return false;
  if (m === "PATCH" || m === "PUT" || m === "DELETE") return true;
  if (m !== "POST") return false;
  const rpc = /\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/.exec(path);
  if (rpc) return !(READ_RPC_RX.test(rpc[1]) || isDeclaredReadRpcPath(path));
  if (/\/storage\/v1\/object\/(list|sign)\//.test(path)) return false;
  return true;
}

/**
 * A STALE NOTIFICATION FOR ANOTHER SWEEP'S FIXTURE, ANSWERED TRUTHFULLY.
 *
 * Same run, shard 4, /home (helper): "Notifications › Did you start this job?
 * "[E2E DO NOT ACCEPT] J 7a4n6o" was s…" raised the error toast "We can't open
 * this job right now — …". Read off prod: the notification (6bb02124…, link
 * /jobs/a24b1afb…) was written at 01:42Z by sweep_no_show_alerts while the
 * journeys' direct offer to the helper still stood; at 02:00Z the offer
 * expired ("You lost a job offer"), helper_id went NULL, and the job's start
 * had passed, so at the 02:39Z press the helper was neither a party to it nor
 * able to browse it. QuickApplyHandler shows that copy ONLY after both reads
 * came back with no row and no error (a transport or permission error gets
 * "Couldn't load this job"). The app told the truth about a fixture that the
 * e2e journeys and the crons moved on: class 3 of pressFailureClass.mjs,
 * reached through a notification instead of a list row.
 *
 * Narrow on purpose, and listed under "Error toasts not counted as defects":
 *   1. the opener chain names the journeys' marker and not this harness's own;
 *   2. the toast is EXACTLY the not-visible copy (src/test/pressStaleFixture.test.ts
 *      asserts it against QuickApplyHandler.tsx, so rewording reopens this).
 * Any other toast on that row, or that toast on any other row, still FAILS.
 */
export const NOT_VISIBLE_JOB_TOAST =
  "We can't open this job right now — it may have been filled or taken down. If you just got the alert, try again in a few minutes.";
export function isForeignFixtureGoneRefusal({ toast, chain } = {}) {
  return String(toast ?? "").trim() === NOT_VISIBLE_JOB_TOAST && isForeignSweepFixture(chain);
}

/**
 * THE BROWSER'S HTTP CACHE, PUT BACK FOR PUBLIC STORAGE OBJECTS.
 *
 * Playwright turns Chromium's HTTP cache OFF for a whole context as soon as any
 * route is registered (playwright-core 1.63: Network.setCacheDisabled follows
 * request interception, and interception uses pattern "*" whatever the route
 * glob, so narrowing the globs cannot help). This harness must route (the
 * Stripe-write and CAPTCHA backstops), and it reloads the screen before every
 * press, so every avatar was fetched again on every press. Run 38459066451
 * metered 3302 `GET …/avatars/:id/avatar.jpg` (its top repeated GET), and 2977
 * avatar GETs from the runner reached Supabase's edge in that window
 * (edge_logs, X11 Linux UA, 2026-10-14 01:00-06:30Z) — a load no real visitor
 * makes: the objects are served `cache-control: public, max-age=31536000`.
 *
 * So, per BrowserContext (one row = one fresh visitor), a public-object GET is
 * fetched once and answered from memory afterwards for as long as its own
 * `max-age` allows, which is what the disabled cache would have done. Only a
 * 200 with a positive max-age and no no-store / no-cache / private is kept; a
 * 400 for a missing object is never cached, so it fails on every load as
 * before. The meter skips a request this cache answers (it never reached the
 * backend) and counts the one that fills it.
 */
export const PUBLIC_OBJECT_PATH_RX = /\/storage\/v1\/object\/public\//;
export function cacheableFor({ status, cacheControl }) {
  if (Number(status) !== 200) return 0;
  const cc = String(cacheControl ?? "").toLowerCase();
  if (/\bno-store\b|\bno-cache\b|\bprivate\b/.test(cc)) return 0;
  const m = /\bmax-age=(\d+)/.exec(cc);
  return m ? Number(m[1]) * 1000 : 0;
}
export class PublicObjectCache {
  constructor() { this.entries = new Map(); this.served = 0; this.filled = 0; }
  /** The cached answer for this request, or null (an expired entry is dropped). */
  hit(method, url, now = Date.now()) {
    if (String(method).toUpperCase() !== "GET" || !PUBLIC_OBJECT_PATH_RX.test(String(url))) return null;
    const e = this.entries.get(url);
    if (!e) return null;
    if (now >= e.expires) { this.entries.delete(url); return null; }
    return e;
  }
  /** Keep a fetched answer when its own headers allow it. Returns true when kept. */
  store(url, { status, headers, body }, now = Date.now()) {
    if (!PUBLIC_OBJECT_PATH_RX.test(String(url))) return false;
    const ttl = cacheableFor({ status, cacheControl: headers?.["cache-control"] });
    if (!(ttl > 0)) return false;
    this.entries.set(url, { status, headers, body, expires: now + ttl });
    this.filled++;
    return true;
  }
}

export const TRANSIENT_STATUS_SKIP = "inside a transient status region that dismissed itself (an announcement, not page chrome)";
export const TRANSIENT_REGION_SEL = '[role="status"][aria-live], [role="alert"]';

/**
 * RADIX'S HIDDEN FORM MIRROR IS NOT A CONTROL.
 *
 * Run 35813177418, /complete-profile: `<input type=checkbox>` "NOT CLICKABLE"
 * — the resolved element is `<input value="on" tabindex="-1"
 * type="checkbox" aria-hidden="true"/>`. That is @radix-ui/react-checkbox's
 * BubbleInput: a native input rendered beside the real `<button
 * role="checkbox">` only so a surrounding <form> submits a value, styled
 * `pointer-events: none; opacity: 0`. No pointer and no assistive tech can
 * reach it, by construction. The real checkbox on that screen was pressed in
 * the same run and passed ("changed a toggle/field").
 *
 * All three conditions, read from the live element: aria-hidden, removed from
 * the tab order, and pointer-events none. A visible input missing any of them
 * is still pressed.
 */
export const FORM_MIRROR_SKIP = "hidden form mirror of a styled control (aria-hidden, tabindex -1, pointer-events none — the visible control is pressed)";
export function isHiddenFormMirror({ tag, ariaHidden, tabIndex, pointerEvents } = {}) {
  return tag === "input" && ariaHidden === "true" && Number(tabIndex) === -1 && pointerEvents === "none";
}

/**
 * A DESIGNED VALIDATION REFUSAL THAT HANDS YOU THE FIX.
 *
 * Run 35813177418, /admin?view=social: "Schedule" on a draft with no time
 * raised the error toast "Pick a date and time — a scheduled post with no time
 * would never be picked up." and opened the composer on that draft
 * (MarketingQueue.schedule: toast.error(issues[0].message); onEdit(row)). That
 * is the product refusing an unpublishable post and taking the user to the
 * field that fixes it — the correct outcome.
 *
 * Each entry is the EXACT copy, the file that prints it (a test asserts the
 * string is still there, so rewording reopens this), and the outcome that must
 * accompany it. An error toast that does not match, or matches without the
 * remediation surface opening, still fails.
 */
export const VALIDATION_REFUSALS = [
  {
    toast: "Pick a date and time — a scheduled post with no time would never be picked up.",
    source: "src/components/admin/marketing/marketingTypes.ts",
    requires: "opened an overlay",
  },
];
export function isDesignedValidationRefusal({ toast, changed } = {}) {
  const t = String(toast ?? "").trim();
  return VALIDATION_REFUSALS.some((v) => v.toast === t && changed === v.requires);
}

/**
 * PRESS PAYMENT CONTROLS AT A HUMAN PACE — THE LIMITER'S OWN PACE.
 *
 * Run 35813177418, /post-job (poster): the 11th "Finish Paying" press in 17s
 * got 429 from create-payment. Measured in edge_rate_limit_log: the poster
 * account hit bucket `create-payment` 11 times between 03:24:20 and 03:24:37,
 * all from this sweep; the function allows 10 per subject per minute
 * (supabase/functions/create-payment/index.ts checkRateLimit). No person
 * presses eleven checkout buttons in seventeen seconds, so the 429 measured
 * the sweep, not the app.
 *
 * The answer is not to excuse 429s (a real limiter bug would hide behind
 * that) but to never exceed the limit: after any press that POSTs
 * create-payment, the next payment-labelled press waits windowMs/maxRequests.
 * The pace is READ from the function's source, so tightening the limiter
 * slows the sweep instead of turning it red.
 */
export function paymentPaceMs(src = readFileSync(resolve(REPO, "supabase/functions/create-payment/index.ts"), "utf8")) {
  const m = /checkRateLimit\(req,\s*\{\s*windowMs:\s*([\d_]+),\s*maxRequests:\s*(\d+),\s*keyPrefix:\s*"create-payment"/.exec(src);
  if (!m) throw new Error("create-payment's checkRateLimit call not found — paymentPaceMs cannot derive the sweep's pace");
  const windowMs = Number(m[1].replace(/_/g, "")), max = Number(m[2]);
  return Math.ceil(windowMs / max) + 500;
}

const CONSOLE_NOISE = [
  /Service Worker registration blocked by Playwright/i,
  /Download the React DevTools/i,
  /\[vite\] connect/i,
  // A 406 from `.single()` with zero rows is real PostgREST behaviour the app
  // handles (maybeSingle → null); the network watcher excludes 406 too.
  /status of 406/i,
  // The network gate's own aborts (route.abort("blockedbyclient")): a side
  // effect or a gate miss is already recorded on the row; the browser's
  // console line about the refused request is the harness, not the app
  // (press-every-control 39225521269: "View <job>" FAILED on it after
  // record_job_view, a listed side effect, was aborted).
  /net::ERR_BLOCKED_BY_CLIENT/i,
];

/**
 * Every reason mutationGate can return: each `SKIP_*` export of
 * pressProdSafety.mjs, read from the module rather than retyped here, so a new
 * gate reason is documented the moment it exists.
 */
export const GATE_SKIPS = Object.entries(pressSafety).filter(([name]) => name.startsWith("SKIP_")).map(([, why]) => why);

/** Documented skip reasons. Anything else unpressed FAILS the coverage gate. */
export const DOCUMENTED_SKIPS = new Set([
  ...GATE_SKIPS,
  "disabled (inert by design)",
  // The same disposition, re-read at press time. `disabled (inert by design)`
  // is decided from the ENUMERATION snapshot; a control that was enabled then
  // and disabled by the time we reach it never hits it, and its click waits
  // out the full 16s and reports as a failed press. 76 of 126 failures in run
  // 35805671843 were exactly that — including 22 on /admin?view=notifications
  // where `disabled={!allPushOn}` is correct behaviour.
  "disabled by the time it was reached (enabled when enumerated)",
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
  "ends the session this sharded run is driving (a sign-out revokes the other shards too)",
  "account unavailable (persona not minted)",
  "file picker (opens the OS dialog; not a DOM outcome)",
  "inside a toast (transient; not page chrome)",
  "opener chain could not be replayed (parent press reported separately)",
  CONSUMED_SKIP,
  BOUNCED_SKIP,
  TRANSIENT_STATUS_SKIP,
  ROW_CONSUMED_SKIP,
  NO_LONGER_CONTROL_SKIP,
  FORM_MIRROR_SKIP,
  FOREIGN_FIXTURE_SKIP,
  CHROME_SKIP,
]);

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
export const OPEN_OVERLAY =
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
/**
 * THE RECORD A CONTROL ACTS ON: the nearest row, card or dialog around it. Its
 * text (`rowText`) is what the mutation gate reads to decide whether the
 * record is test-owned, and what ROW_CONSUMED_SKIP matches a vanished control
 * against.
 *
 * `[data-activity-card]` (run 39014836855, leg 4): the My Posts / My Jobs job
 * card (JobCardShell) is a plain div whose classes never say "card", so every
 * control on it resolved to NO record at all (rowText "", measured on prod
 * /posts as poster-e2e, 7 of 7 location chips). With no record, a write on a
 * card could neither be told apart from the same button on the next card nor
 * recognised when it removed its own card from the list.
 */
export const RECORD_ROW_SEL =
  'tr, li, article, [role="row"], [role="listitem"], [role="dialog"], [role="alertdialog"], [data-activity-card], [class*="card"], [class*="Card"]';

/** A record's text as ENUMERATE reads it (same collapse, same cut), for a press-time check. Runs in the page. */
export const LIVE_ROW_TEXT = (el, rowSel) => (el.closest(rowSel)?.innerText || "").replace(/\s+/g, " ").slice(0, 400);

/** Two reads of one record's text: equal, or equal once digits are blanked (a "3m ago" that ticked). */
export function sameRecord(a, b) {
  if (!a || !b) return false;
  return a === b || looseSignature(a) === looseSignature(b);
}

/**
 * The control with this signature INSIDE THIS RECORD on the screen as it is
 * now, or null when the record has left it. A label alone cannot find it: on
 * /posts every backed-out card carries an identical "Got it", so once one card
 * leaves the list both the DOM path and the signature ordinal point at the
 * NEXT card's button.
 */
export function recordControl(now, meta) {
  if (!meta?.rowText) return null;
  const inRecord = (now ?? []).filter((c) => sameRecord(c.rowText, meta.rowText));
  return inRecord.find((c) => c.sig === meta.sig) ??
    inRecord.find((c) => looseSignature(c.sig) === looseSignature(meta.sig)) ??
    null;
}

/**
 * A MUTATING press about to land on a different record than the one the gate
 * approved. The gate judged `meta.rowText`; the click must hit that record or
 * nothing. Returns "same" (click as addressed), "moved" (press `control`
 * instead) or "gone" (the record is no longer on the screen).
 */
export function pressTargetRecord({ liveRowText, meta, now }) {
  if (!meta?.rowText || sameRecord(liveRowText, meta.rowText)) return { verdict: "same" };
  const control = recordControl(now, meta);
  return control ? { verdict: "moved", control } : { verdict: "gone" };
}

const ENUMERATE = ({ controlSel, overlaySel, scope, base, transientSel, rowSel }) => {
  const root = scope === "overlay"
    ? [...document.querySelectorAll(overlaySel)].pop()
    : document.body;
  if (!root) return [];
  const pathFrom = (el, top) => {
    const parts = [];
    let n = el;
    while (n && n !== top) {
      const tag = n.tagName.toLowerCase();
      // A VIRTUALIZED ROW IS ADDRESSED BY ITS INDEX, NOT ITS POSITION.
      // @tanstack/react-virtual (src/components/VirtualList.tsx) mounts only
      // the rows in range and stamps each with `data-index`; scroll the list
      // and the wrapper at nth-of-type(11) is a DIFFERENT row. Run 36069319716,
      // /admin?view=people: "J3 Jean-Baptiste 3." at `div:nth-of-type(11)`
      // NOT CLICKABLE after scrollIntoViewIfNeeded moved the window under it.
      const di = n.getAttribute("data-index");
      const unique = di !== null && /^\d+$/.test(di) &&
        [...(n.parentElement?.children ?? [])].filter((c) => c.tagName === n.tagName && c.getAttribute("data-index") === di).length === 1;
      if (unique) { parts.unshift(`${tag}[data-index="${di}"]`); n = n.parentElement; continue; }
      let i = 1, s = n;
      while ((s = s.previousElementSibling)) if (s.tagName === n.tagName) i++;
      parts.unshift(`${tag}:nth-of-type(${i})`);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const out = [];
  // Q294: a modal already open when the page pass runs (/jobs/:id renders
  // JobDetailDialog as the page) covers everything behind it, and no overlay
  // pass ever runs for it because no press opened it. The page pass then owns
  // that modal's controls and nothing outside it; pressing the covered
  // background returned 9 NOT CLICKABLE on /jobs/:id (run 35905268411).
  const loadModal = scope !== "overlay"
    ? [...document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')].pop() ?? null
    : null;
  root.querySelectorAll(controlSel).forEach((el) => {
    if (loadModal) {
      if (!loadModal.contains(el)) return;
    // Page pass: a control inside an overlay belongs to the overlay pass.
    } else if (scope !== "overlay" && el.closest(overlaySel)) return;
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
      // The control's WHOLE accessible text, untruncated at 60 the way `label`
      // is. `controlSignature()` turns this into the identity the re-address
      // pass matches on; see the comment there for why 60 characters is not
      // enough to tell two rows of a live feed apart.
      sigText: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 240),
      href: href ?? "",
      tag: el.tagName.toLowerCase(),
      // isAdminStateToggle (pressProdSafety.mjs) reads it: a role="switch" is a
      // setting, and as admin a setting is platform-wide state (Q42).
      role: el.getAttribute("role"),
      // isCommitControl (pressProdSafety.mjs): the app's own marker for the
      // control that does the consequential thing (src/components/ui/dialog.tsx).
      commit: el.getAttribute("data-commit") || "",
      // isAccountSettingToggle (Q200): a toggle inside a <form> is a draft
      // field; one outside it saves the setting the moment it is pressed.
      inForm: el.closest("form") !== null,
      // Page chrome: the same on every route. An overlay it opens is walked
      // once per run (CHROME_SKIP, pressFailureClass.mjs).
      inChrome: el.closest('header, nav, [role="banner"], [role="navigation"]') !== null,
      type: el.getAttribute("type"),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      srOnly,
      active: on("aria-selected") || on("aria-current") || on("aria-pressed") || el.getAttribute("aria-current") === "page" ||
        el.dataset.state === "active" || el.closest('[data-state="active"]') !== null,
      external, self,
      inToast: el.closest("[data-sonner-toaster]") !== null,
      // A popup's close-only acknowledgement (DialogAcknowledgeAction,
      // dialog.tsx: a Radix Close that accepts no event handler). Its label may
      // match DESTRUCTIVE_RX ("Got it"), but it can only do what the dialog's
      // own × does, which the sweep presses ungated anyway. Honoured only inside
      // an open popup. See src/test/pressDrivesTheRealPressPath.test.tsx.
      dismissOnly: el.hasAttribute("data-popup-dismiss") && el.closest('[role="dialog"], [role="alertdialog"]') !== null,
      // See TRANSIENT_STATUS_SKIP / isHiddenFormMirror — read here, judged in node.
      inStatus: el.closest(transientSel) !== null,
      ariaHidden: el.getAttribute("aria-hidden"),
      tabIndex: el.tabIndex,
      pointerEvents: cs.pointerEvents,
      // The record this control acts on, as the user sees it: the nearest row / card / dialog.
      rowText: (el.closest(rowSel)?.innerText || "").replace(/\s+/g, " ").slice(0, 400),
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

/**
 * AN OVERLAY THAT IS STILL FILLING IS NOT AN OVERLAY YET.
 *
 * `settle()` waits on LOADING_SEL (aria-busy, animate-pulse, skeleton shimmer), and the notification
 * panel's first-load state carried neither — it renders `role="status"` with a
 * spinner and "Loading notifications…". So on run 35692554813 the panel was
 * enumerated before its rows landed, with two opposite outcomes on the same
 * screen in the same run:
 *
 *   - shards 1 and 3 enumerated FOUR controls (Close / Unread / All / the push
 *     row) and walked the /home bell with ZERO rows in it. Green, and
 *     vacuous: the rows the sweep exists to press were never seen.
 *   - shard 4 enumerated 50 rows and then re-opened the panel 50 times, each
 *     time before the rows arrived. All 50 were "control not found".
 *
 * So: after anything opens an overlay, wait for its control count and text
 * length to stop moving before reading it. Bounded — a feed that never settles
 * must not hang the sweep, it must be walked as it is.
 */
const OVERLAY_FINGERPRINT = ({ overlaySel, controlSel }) => {
  const root = [...document.querySelectorAll(overlaySel)].pop();
  if (!root) return "none";
  // STILLNESS IS NOT DONENESS. Measured against prod 2026-09-22: the panel sat
  // on "Loading notifications…" with exactly FOUR controls for over 4.5s —
  // perfectly stable, and the wrong answer. So while anything says it is busy
  // the fingerprint is deliberately unequal to its own next sample, and the
  // poll cannot conclude early; two stable samples are only accepted once the
  // screen has stopped claiming it is still working.
  if (document.querySelectorAll('[aria-busy="true"]').length) return `busy:${Date.now()}`;
  return `${root.querySelectorAll(controlSel).length}|${(root.innerText || "").length}`;
};

/**
 * What a reloaded screen holds when a control could not be found on it: the
 * control count, the mounted rows of any virtualized list (`data-index`, which
 * @tanstack/react-virtual stamps on every row it renders; src/components/VirtualList.tsx),
 * the scroll position, and whether the missing control's label is on the screen
 * as text at all. Runs in the page.
 */
export const RELOADED_SCREEN = ({ controlSel, label }) => {
  const idx = [...document.querySelectorAll("[data-index]")].map((e) => Number(e.getAttribute("data-index"))).filter((n) => Number.isFinite(n));
  const rows = idx.length ? `${idx.length} virtual row(s) mounted, index ${Math.min(...idx)}-${Math.max(...idx)}` : "no virtual rows";
  // Whitespace collapsed exactly as ENUMERATE collapsed `label`: a multi-line
  // row ("AW\nAudit W.\nActive") never contained its own one-line label, so
  // #2353 reported "label text absent" for rows that were on screen.
  const text = (document.body.innerText || document.body.textContent || "").replace(/\s+/g, " ");
  const onScreen = label ? (text.includes(label.slice(0, 30)) ? "label text present" : "label text absent") : "no label";
  return `[reloaded screen: ${document.querySelectorAll(controlSel).length} control(s); ${rows}; scrollY=${Math.round(window.scrollY)}; ${onScreen}; url=${location.pathname}${location.search}]`;
};

/** Structural fingerprint of the page; any difference is "something happened". */
export const SNAPSHOT = ({ overlaySel }) => {
  const stripStyle = (html) => html.replace(/\sstyle="[^"]*"/g, "").replace(/\sdata-(?:focus-visible|highlighted)[^\s>]*/g, "");
  const rootEl = document.getElementById("root");
  // #root AND every open overlay. Radix portals dialogs, popovers and menus
  // to <body>, OUTSIDE #root, so hashing #root alone made every change that
  // happens only inside a dialog invisible. Run 35813177418: "Manual Override
  // › Mark complete" set the dialog's choice and relabelled its primary
  // button "Set to completed" — all inside the portal — and was scored "no
  // observable change"; a notification row that stopped being role=button
  // once read, likewise.
  const overlayHtml = [...document.querySelectorAll(overlaySel)].map((o) => o.outerHTML).join("");
  const html = stripStyle((rootEl ? rootEl.innerHTML : "") + overlayHtml);
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
    // Raw here; `screenErrorText` (Node side) drops the [data-quoted-log]
    // spans — stored log text rendered as data, Q101 — then trims to 3000.
    text: document.body.innerText || "",
    quoted: [...document.querySelectorAll("[data-quoted-log]")]
      .filter((e) => !e.parentElement?.closest("[data-quoted-log]"))
      .map((e) => e.innerText || "")
      .filter((t) => t.trim()),
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
  // The panel's own give-up is LOAD_TIMEOUT_MS = 15s (NotificationPanel.tsx),
  // so anything shorter here enumerates a screen the app has not finished with.
  const OVERLAY_FILL_MS = Number(process.env.OVERLAY_FILL_MS ?? 16_000);
  const RUN_ID = process.env.RUN_ID ?? `${Date.now()}-${process.pid}`;
  // Q128 class 6: the sweep's own budget, below the job's timeout-minutes, so
  // it stops itself and reports instead of being cancelled with no report.
  const TIME_BUDGET_MS = Number(process.env.TIME_BUDGET_MIN ?? 0) * 60_000;
  const runStart = Date.now();
  mkdirSync(OUT, { recursive: true });

  // ---- sessions on the shared test accounts --------------------------------
  const { sessions, unavailable } = await mintAccounts(PERSONAS.filter((p) => p !== "anon"));
  for (const [p, why] of Object.entries(unavailable)) console.log(`::warning title=persona ${p} not covered::${why}`);

  // Snapshot only (Q272/Q325): the run-level "before" of every shared account,
  // taken once before any shard presses anything. Every restore reads this file.
  if (process.env.SNAPSHOT_OUT) {
    const snap = await snapshotAccounts(sessions);
    const unread = Object.entries(snap.profiles).filter(([p, v]) => v === null || snap.weeklyAvailability[p] === null).map(([p]) => p);
    writeFileSync(process.env.SNAPSHOT_OUT, JSON.stringify(snap, null, 2));
    console.log(`snapshot: ${Object.keys(snap.profiles).join(", ")} → ${process.env.SNAPSHOT_OUT}`);
    const notMinted = Object.keys(unavailable);
    if (unread.length || notMinted.length) {
      console.log(`FAIL: no restorable snapshot for ${[...unread, ...notMinted].join(", ")} — pressing without one leaves nothing to restore from`);
      process.exitCode = 1;
    }
    return;
  }
  const plan = restorePlan({ shard: process.env.SHARD, snapshotIn: process.env.SNAPSHOT_IN });
  if (plan.error) {
    console.log(`::error title=press restore plan::${plan.error}`);
    process.exitCode = 1;
    return;
  }
  const runSnapshot = process.env.SNAPSHOT_IN ? JSON.parse(readFileSync(process.env.SNAPSHOT_IN, "utf8")) : null;

  // Clean-up only: the workflow's final step, after every shard. With the
  // run-level snapshot it is also THE restore (Q272): profiles and the weekly
  // grid go back to what they were before the first shard started.
  if (process.env.CLEANUP_SINCE) {
    const since = Date.parse(process.env.CLEANUP_SINCE);
    const r = await cleanup({ sessions, since, profilesBefore: runSnapshot?.profiles ?? {}, weeklyAvailabilityBefore: runSnapshot?.weeklyAvailability });
    for (const l of r.log) console.log(`cleaned: ${l}`);
    for (const l of r.residue) console.log(`::warning title=clean-up residue::${l}`);
    writeFileSync(`${OUT}/cleanup.json`, JSON.stringify(r, null, 2));
    // Q52 (2026-09-23): residue and un-minted personas were ::warning:: and the
    // clean-up job stayed green having left rows on prod. Not cleaned is not green.
    const notMinted = Object.keys(unavailable);
    if (r.residue.length || notMinted.length) {
      console.log(`FAIL: clean-up left ${r.residue.length} residue row(s); personas not minted: ${notMinted.join(", ") || "none"}`);
      process.exitCode = 1;
    }
    return;
  }

  const owners = await loadTestOwners(sessions);
  const poster = sessions.customer ?? null;
  const helper = sessions.helper ?? null;
  const stripeMode = makeStripeProbe(poster, RUN_ID);
  // Q272: a shard of a sharded run restores nothing (the run's final step
  // does, from the run-level snapshot); an unsharded run restores itself.
  const selfSnapshot = plan.source === "self" ? await snapshotAccounts(sessions) : null;
  const restoreFrom = restoreSource(plan, runSnapshot, selfSnapshot);

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
  // WHETHER A LANDING URL IS "WALKED ON ITS OWN ROW" IS A PROPERTY OF THE APP,
  // NOT OF THIS SHARD. `isBounce` used the sharded list, so on run 35692554813
  // shard 4's /signup-pending → /home was NOT recognised as a bounce (the
  // dashboard lives in shard 3) and the dashboard was walked a second time —
  // by a second browser, signed in as the SAME shared poster account, against
  // the SAME live notification feed shard 3 was pressing. Hence the full set.
  const allRoutes = routeSet;
  // #1582: with PRESS_QUEUE_DIR set, shards CLAIM rows from one shared queue
  // (claimRow) instead of taking every n-th route, so a shard with time left
  // takes the next row while another is still on /admin?view=jobs.
  const QUEUE_DIR = process.env.PRESS_QUEUE_DIR || "";
  // Safe default: a run is its own last wave (reports what it did not reach)
  // unless told a later wave follows (PRESS_LAST_WAVE=0).
  const LAST_WAVE = process.env.PRESS_LAST_WAVE !== "0";
  if (process.env.SHARD && !QUEUE_DIR) {
    const [i, n] = process.env.SHARD.split("/").map(Number);
    routeSet = routeSet.filter((_, k) => k % n === i - 1);
  }

  // Same machine-wide queue as the Playwright suites (e2e/browserLock.ts), so
  // this can be started any time and simply waits for a free browser.
  const { acquireBrowserLock, releaseBrowserLock } = await import(pathToFileURL(resolve(REPO, "e2e/browserLock.ts")).href);
  await acquireBrowserLock();
  process.on("exit", () => releaseBrowserLock());
  const browser = await chromium.launch();
  // Q104: count this run's backend requests; scripts/e2e/request-budget.mjs
  // checks them against e2e/request-budgets.json. Flushed on exit too, so a
  // run that dies midway still leaves its load on the record.
  const requestMeter = new RequestMeter("press-every-control");
  requestMeter.attachBrowser(browser);
  process.on("exit", () => requestMeter.flush());
  // The load ceiling the budget step judges this run by (e2e/request-budgets.json),
  // and the recent press cycles' sizes. See ceilingWaitMs and cycleBurstEstimate.
  const LOAD_CEILING = budgetFor(JSON.parse(readFileSync(resolve(REPO, "e2e/request-budgets.json"), "utf8")).budgets, "press-every-control").ceilingPerMinute;
  // The budget step judges the WHOLE run's busiest minute (every shard's meter
  // summed), and press-wave.sh runs PRESS_WAVE_WIDTH shards side by side. Each
  // shard paced to the full ceiling on its own meter put two shards at up to
  // 2 x 340/min together: runs 36297439015 (542/min) and 36348328345 (618/min)
  // failed the 400/min ceiling that way. So each shard takes its share.
  const WAVE_WIDTH = Math.max(1, Number.parseInt(process.env.PRESS_WAVE_WIDTH ?? "1", 10) || 1);
  const recentCycles = [];
  let cycleStartTotal = null;
  const paceToCeiling = async (page) => {
    if (cycleStartTotal !== null) recentCycles.push(requestMeter.total - cycleStartTotal);
    if (recentCycles.length > 50) recentCycles.shift();
    const wait = ceilingWaitMs({ minutes: requestMeter.minutes, ceiling: Math.floor((LOAD_CEILING * PACE_HEADROOM) / WAVE_WIDTH), burst: cycleBurstEstimate(recentCycles) });
    if (wait > 0) await page.waitForTimeout(wait);
    cycleStartTotal = requestMeter.total;
  };
  // Shared across every route × persona: create-payment's limiter is per
  // account, and the same test accounts are walked row after row.
  const PAYMENT_PACE_MS = paymentPaceMs();
  const paymentClock = { last: 0 };
  const results = []; // one per route × persona
  let failedPresses = 0, undocumented = 0, totalFound = 0, totalPressed = 0, shots = 0;
  /** Every write an UNGATED press tried, aborted at the wire: { route, persona, label, requests }. Any one fails the run. */
  const gateMisses = [];
  const ownershipCache = new Map();
  /** chromeKey → the row where that header-chrome overlay control passed. */
  const chromePassedOn = new Map();
  /**
   * SESSION DEATH IS NOT A PRESS FAILURE.
   *
   * Run 35761400822 reported 274 failed presses across four shards. The
   * dominant cause was the harness's own auth dying: 39×`403 GET v1/user`,
   * 38×500 and 21×401 on shard 3 alone, with GoTrue answering
   * `session_not_found` — the session ROW was gone, not merely expired.
   *
   * CORRECTED 2026-09-22: an earlier version of this comment said "zero
   * /logout calls". That was measured over 17:40-18:15 and was true of THAT
   * WINDOW only. THE SWEEP SIGNED ITSELF OUT at 17:34-17:36, from the shard
   * runners, with this workflow's own 127.0.0.1:4173 referer — four POST
   * /logout, 204, actors helpr-e2e-poster-0902 (x2) and helpr-e2e-helper-0902.
   * The scope was GLOBAL, proven by arithmetic rather than a log line (GoTrue
   * does not record ?scope=): of four sessions minted per persona at 17:33,
   * admin pressed no logout and kept 4; seed-incomplete pressed ONE and kept 3
   * (local); poster pressed two and kept ZERO; helper pressed one and kept
   * ZERO. Only scope:"global" deletes every row for a user in one call, and
   * the only global sign-out in this app is SecurityTab.tsx:192, "Sign out
   * Everywhere" — corroborated by the same shard IP firing /recover x6 and
   * /factors x8 in those same minutes, which are that tab's other controls.
   *
   * So the token minted ONCE at run start was not merely stale: another shard
   * had revoked it for the whole account. Every press after that measured a
   * signed-out screen and was counted as a product defect.
   *
   * Two rules now:
   *   1. re-verify against GoTrue before a row, and again after any row whose
   *      API calls 401/403'd, re-minting rather than pressing on;
   *   2. count nothing measured with a dead session as a press failure — a run
   *      that lost its session has not measured the app, and says so.
   */
  const SESSION_VERIFY_MS = 5 * 60 * 1000;
  const sessionDeaths = [];   // every re-mint, with the row it was noticed on
  const sessionLostRows = []; // rows whose failures are NOT product defects
  const sessionRefreshes = []; // routine expiry refreshes (Q128) — not deaths
  let noticedOn = "run start";
  const ensureLiveSession = async (persona) => {
    const s = sessions[persona];
    if (!s) return null;
    // Q128 class 5: an access token about to expire is refreshed, not mourned.
    // A shard outlives the 1h token; letting it lapse made the page refresh
    // the one shared refresh token from several contexts, and counted the
    // refusal of an EXPIRED token as a death that failed the run.
    const refresh = async () => {
      try {
        const fresh = { account: s.account, ...(await remintSession(s.account)) };
        sessions[persona] = fresh;
        sessionRefreshes.push({ persona, account: s.account, noticedOn, at: new Date().toISOString() });
        return fresh;
      } catch (e) {
        console.log(`::warning title=press token refresh failed::${s.account}: ${String(e.message).slice(0, 160)} — treating as a session death`);
        return null;
      }
    };
    if (tokenNeedsRefresh(s.accessToken)) { const fresh = await refresh(); if (fresh) return fresh; }
    if (!s.suspect && Date.now() - s.at < SESSION_VERIFY_MS) return s;
    if (await sessionStillAlive(s)) { s.at = Date.now(); s.suspect = false; return s; }
    if (!refusalIsDeath(s.accessToken)) { const fresh = await refresh(); if (fresh) return fresh; }
    console.log(`::error title=press SESSION DIED::GoTrue refuses the ${s.account} session (noticed on ${noticedOn}) — re-minting; presses measured with it are not product defects`);
    try {
      const fresh = { account: s.account, ...(await remintSession(s.account)) };
      sessions[persona] = fresh;
      sessionDeaths.push({ persona, account: s.account, noticedOn, at: new Date().toISOString(), reminted: true });
      return fresh;
    } catch (e) {
      sessionDeaths.push({ persona, account: s.account, noticedOn, at: new Date().toISOString(), reminted: false, why: String(e.message).slice(0, 200) });
      unavailable[persona] = `${s.account}: session died mid-sweep and could not be re-minted (${String(e.message).slice(0, 160)})`;
      delete sessions[persona];
      return null;
    }
  };

  let queueStopped = false;
  let claimedElsewhere = 0;
  for (const [routeIdx, route] of routeSet.entries()) {
    if (queueStopped) break;
    if (route.redirect) {
      if (QUEUE_DIR && !claimRow({ dir: QUEUE_DIR, key: `${String(routeIdx).padStart(3, "0")}-redirect` })) { claimedElsewhere += 1; continue; }
      results.push({ route: route.url, persona: "-", status: "redirect", note: "pure redirect route — its target is walked on its own row", controls: [] });
      continue;
    }
    const personas = route.personas.filter((p) => PERSONAS.includes(p));
    for (const persona of personas) {
      const rowKey = `${String(routeIdx).padStart(3, "0")}-${persona}`;
      if (QUEUE_DIR) {
        const action = queuedRowAction({ overBudget: overTimeBudget({ startedAt: runStart, budgetMs: TIME_BUDGET_MS }), lastWave: LAST_WAVE });
        // An earlier wave out of time leaves every unclaimed row to the next wave.
        if (action === "stop") { queueStopped = true; break; }
        if (!claimRow({ dir: QUEUE_DIR, key: rowKey })) { claimedElsewhere += 1; continue; } // another shard has it
      }
      const rec = { route: route.url, persona, status: "ok", landedOn: null, found: 0, pressed: 0, passed: 0, failed: 0, skipped: 0, controls: [], notes: [], net: null, nonApp: [], startedAt: Date.now(), paceMs: 0 };
      results.push(rec);
      if (overTimeBudget({ startedAt: runStart, budgetMs: TIME_BUDGET_MS })) {
        rec.status = NOT_REACHED_STATUS;
        rec.notes.push(`not reached: the sweep's own time budget (${TIME_BUDGET_MS / 60_000} min) ran out first`);
        continue;
      }
      noticedOn = `${route.url} (${persona})`;
      const session = persona === "anon" ? null : await ensureLiveSession(persona);
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
      /**
       * STRIPE-WRITE BACKSTOP (owner, 2026-10-01: "Skip it on live").
       *
       * Run 36784893957 pressed "Set up payouts with Stripe" for both shared
       * accounts; its label passed no gate, stripe-connect `onboard` ran
       * accounts.create, and live Connect accounts acct_1ULXMy3ISOxM8qBC and
       * acct_1ULXMw40YhFTkeRO exist because of it. Labels are a guess about
       * what a button does; the request is the fact. So any request to a
       * Stripe-writing edge function is aborted here, in the browser, unless
       * the probe proved TEST mode — and the press that caused it is reported
       * SKIP_STRIPE_WRITE_BLOCKED below, not PASS and not dropped.
       */
      // See PublicObjectCache: the routes below turn Chromium's HTTP cache off
      // for this context, so public objects (avatars) are cached here instead,
      // and the request meter skips what this cache answers.
      const objectCache = new PublicObjectCache();
      ctx.__requestMeterSkip = (req) => !!objectCache.hit(req.method(), req.url());
      await ctx.route("**/storage/v1/object/public/**", async (route, req) => {
        if (req.method() !== "GET") return route.fallback();
        const cached = objectCache.hit("GET", req.url());
        if (cached) {
          objectCache.served++;
          return route.fulfill({ status: cached.status, headers: cached.headers, body: cached.body });
        }
        const res = await route.fetch().catch(() => null);
        // Could not fetch it from Node: let the browser make the request itself.
        if (!res) return route.continue();
        const body = await res.body();
        const headers = Object.fromEntries(Object.entries(res.headers()).filter(([k]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(k)));
        objectCache.store(req.url(), { status: res.status(), headers, body });
        return route.fulfill({ status: res.status(), headers, body });
      });
      const stripeBlocked = [];
      await ctx.route("**/functions/v1/**", async (route, req) => {
        if (isStripeWriteRequest(req.url(), req.postData()) && (await stripeMode()).mode !== "test") {
          stripeBlocked.push(`${req.method()} ${req.url().replace(/\?.*$/, "").split("/").pop()} ${String(req.postData() ?? "").slice(0, 60)}`);
          return route.abort("blockedbyclient");
        }
        return route.fallback();
      });
      /**
       * CAPTCHA BACKSTOP (Q1374). Supabase Auth CAPTCHA (Q1314) refuses a
       * sign-up / password grant / OTP / resend / password-reset call that has
       * no Turnstile token, and this build cannot get one (no
       * VITE_TURNSTILE_ENABLED; 127.0.0.1 is not a widget hostname). Runs
       * 38042662790 and 38238345303 failed every "Email me a password reset
       * link" on that 400, which says nothing about the app. Such a request is
       * aborted here and the press reported SKIP_CAPTCHA_GATED below.
       */
      const captchaBlocked = [];
      await ctx.route("**/auth/v1/**", async (route, req) => {
        if (isCaptchaGatedAuthRequest(req.url(), req.method(), req.postData())) {
          captchaBlocked.push(`${req.method()} ${new URL(req.url()).pathname.split("/").pop()}`);
          return route.abort("blockedbyclient");
        }
        return route.fallback();
      });

      /**
       * THE NETWORK GATE (networkGate, above). Registered last, so it sees
       * each request first. Armed around a press the gate did not class as
       * mutating, it aborts that press's writes before they leave: a GATE MISS
       * fails the run (end of main); a side effect of looking is noted only.
       * Anything else falls through to the Stripe and CAPTCHA backstops above.
       */
      const netGate = networkGate();
      await ctx.route(PRESS_WRITE_SURFACE_RX, netGate.handler);

      const page = await ctx.newPage();
      const consoleErrors = [];
      const netFails = [];
      // Q128 classes 1-2: our own telemetry refused, a vendor's 5xx. Listed in
      // coverage.md, never counted against the control that was pressed.
      const nonAppFails = rec.nonApp;
      const popups = [];
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        if (CONSOLE_NOISE.some((rx) => rx.test(t))) return;
        if (ignoreHostOnlyAsset(m.location()?.url, BASE)) return;
        const cls = classifyConsoleError({ text: t, locationUrl: m.location()?.url });
        if (cls !== "app") { nonAppFails.push(`${cls}: console ${t.replace(/\s+/g, " ").slice(0, 120)} (${String(m.location()?.url ?? "").replace(/\?.*$/, "").slice(0, 120)})`); return; }
        consoleErrors.push(t.replace(/\s+/g, " ").slice(0, 200));
      });
      page.on("pageerror", (e) => consoleErrors.push("uncaught: " + String(e.message).slice(0, 200)));
      page.on("response", (r) => {
        const s = r.status();
        if (ignoreHostOnlyAsset(r.url(), BASE)) return;
        if (s < 400 || s === 406) return;
        const line = `${s} ${r.request().method()} ${r.url().replace(/\?.*$/, "").split("/").slice(-2).join("/")}`;
        const cls = classifyFailedResponse({ url: r.url(), status: s });
        if (cls !== "app") { nonAppFails.push(`${cls}: ${s} ${r.request().method()} ${r.url().replace(/\?.*$/, "").slice(0, 160)}`); return; }
        netFails.push(line);
      });
      ctx.on("page", (p) => { popups.push(p.url()); p.close().catch(() => {}); });
      const downloads = [];
      page.on("download", (d) => { downloads.push(d.suggestedFilename()); d.cancel().catch(() => {}); });
      /**
       * THE OS FILE CHOOSER IS AN OUTCOME. Run 35813177418: "New post › Attach
       * image" and "Edit › Attach image" (MarketingComposerDialog.pickFile
       * clicks a hidden <input type=file>) were scored "moved focus only". The
       * press did exactly its job — it asked the OS for a file — and that
       * dialog is browser chrome the DOM never sees. With a listener attached
       * Playwright intercepts the chooser instead of showing it, so nothing
       * blocks the sweep. A button that does NOT open it still fails.
       */
      const fileChoosers = [];
      page.on("filechooser", (fc) => { fileChoosers.push(fc.isMultiple() ? "multiple" : "single"); });
      /**
       * API REQUESTS IN FLIGHT. `settle()` waits for aria-busy / pulses and a
       * fixed 600ms; a press whose request takes longer was classified before
       * its answer arrived. Run 35813177418, /admin?view=jobs: "Refund Poster ›
       * Issue Refund" was scored "moved focus only" at 03:25:56.4 while
       * create-payment's 409 (function_edge_logs, POST 03:25:56.412) was still
       * on its way — the outcome the press exists to measure was never seen.
       * So after a press, wait (bounded) for the backend calls it started.
       */
      const inflight = new Set();
      const isApiCall = (r) => ["fetch", "xhr"].includes(r.resourceType()) && /\/(rest|functions|auth|storage)\/v1\//.test(r.url());
      page.on("request", (r) => {
        if (!isApiCall(r)) return;
        inflight.add(r);
        if (r.method() === "POST" && /\/functions\/v1\/create-payment\b/.test(r.url())) paymentClock.last = Date.now();
      });
      page.on("requestfinished", (r) => inflight.delete(r));
      page.on("requestfailed", (r) => inflight.delete(r));
      // Successful backend writes, in order (see isWriteRequest): a press that
      // wrote has its record text added to mutatedRows whatever its label.
      const writes = [];
      page.on("requestfinished", async (r) => {
        if (!isApiCall(r) || r.method() === "GET" || r.method() === "HEAD" || r.method() === "OPTIONS") return;
        const res = await r.response().catch(() => null);
        if (res && isWriteRequest({ method: r.method(), url: r.url(), status: res.status() })) {
          writes.push(`${r.method()} ${new URL(r.url()).pathname.replace(/^.*\/v1\//, "")}`);
        }
      });
      const awaitApiQuiet = async (maxMs = 12_000) => {
        for (let waited = 0; inflight.size > 0 && waited < maxMs; waited += 100) await page.waitForTimeout(100);
      };
      /**
       * PER-REQUEST SEND/RESPONSE TIMING, recorded in CI.
       *
       * The listeners above existed only to collect 4xx/5xx into `netFails`, so
       * the one measurement the /jobs/:id and /user/:id stall needed — how long
       * each request actually took, under real CI load, with four shards
       * concurrent against the free-tier project — was never taken. It is now,
       * and `rec.net` carries the count and the slow tail into results.json.
       */
      const reqTimings = [];
      const shortUrl = (u) => u.replace(BASE, "").replace(/\?.*$/, "").slice(-90);
      page.on("requestfinished", (r) => {
        const t = r.timing();
        if (!t || !(t.responseEnd > 0)) return;
        reqTimings.push({ ms: Math.round(t.responseEnd), url: shortUrl(r.url()), method: r.method() });
      });
      page.on("requestfailed", (r) => {
        const t = r.timing();
        reqTimings.push({ ms: Math.max(0, Math.round(t?.responseEnd ?? 0)), url: shortUrl(r.url()), method: r.method(), failed: true });
      });

      // The record the URL names, resolved once per route × persona (read-only select as this account).
      const urlOwnedKey = `${persona}|${route.url}`;
      if (session && !ownershipCache.has(urlOwnedKey)) ownershipCache.set(urlOwnedKey, await urlOwnership(session, route.url, owners));
      const urlOwned = ownershipCache.get(urlOwnedKey) ?? { owned: false, why: "anonymous" };

      const gate = (label, meta, chainOwned) => mutationGate({ label, meta, chainOwned, persona, routeUrl: route.url, urlOwned, owners, stripeMode, note: (n) => rec.notes.push(n) });

      // A screen that says it is retrying is NOT settled — see pressLoadHealth.mjs.
      const settle = async () => {
        // Every LOADING_SEL marker AND every text-only "Loading …" line
        // (countLoadingMarkers), plus the self-heal card, must stay at ZERO
        // for SETTLE_MS in a row (awaitLoadingQuiet). #2353: settle used to
        // return at the first marker-free instant and then sleep SETTLE_MS
        // blind, but /admin?view=people has two such instants on a cold load
        // (measured 130-245ms of a bare shell between the route's "Loading…"
        // stages, then `<p>Loading users…</p>` which carried no marker at
        // all), so rows were read with their summaries still pending. Same
        // 600ms floor as before, now spent watching instead of sleeping.
        await awaitLoadingQuiet(page, {
          probe: `(${countLoadingMarkers.toString()})(${JSON.stringify([LOADING_SEL, LOADING_TEXT_RX_SOURCE])}) + document.querySelectorAll(${JSON.stringify(SELF_HEAL_SEL)}).length`,
          quietMs: SETTLE_MS,
          timeoutMs: 8000 + SETTLE_MS,
        });
      };
      // The URL the screen rests at after a clean load; any drift from it (a
      // filter param, a highlight, a navigation) means the DOM paths no longer
      // address the same controls, so the page is reloaded before the next press.
      let restingUrl = "";
      /** Result of the most recent self-heal wait — set by load(). */
      let lastHeal = { healing: false, healed: true, waitedMs: 0 };
      /**
       * A route whose heal has already been shown NOT to resolve never gets a
       * second full-length wait: load() runs again for every replayed opener
       * chain, and paying SELF_HEAL_MS on each would turn one broken route into
       * a run that never ends. The verdict is taken from the FIRST load anyway.
       */
      let healExhausted = false;
      const load = async () => {
        // After the first load the screen is re-entered at the URL it RESTED
        // on: a route that redirects on state (/jobs/:id → the list that owns
        // the job) can land somewhere else on a second visit, and then no DOM
        // path would match.
        await page.goto(restingUrl || BASE + route.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForFunction(() => (document.body.innerText || "").trim().length > 20, { timeout: 15_000 }).catch(() => {});
        await settle();
        // The auth error card appears only after the profile query's whole
        // budget (~12.5s) is spent, i.e. AFTER settle() has already returned.
        // Give its auto-heal its bounded chance before anything classifies this
        // screen; `lastHeal` is what the boot verdict is judged against.
        lastHeal = healExhausted ? { healing: false, healed: true, waitedMs: 0 } : await awaitSelfHeal(page, { timeout: SELF_HEAL_MS });
        if (lastHeal.healing && !lastHeal.healed) healExhausted = true;
      };
      /** Wait (bounded) until a stepwise redirect has stopped moving; see landingSettled. */
      const awaitLandedUrl = async (maxMs = 12_000) => {
        const samples = [{ t: Date.now(), url: page.url() }];
        const first = samples[0].url;
        while (!landingSettled(samples, LANDING_QUIET_MS) && Date.now() - samples[0].t < maxMs) {
          await page.waitForTimeout(250);
          samples.push({ t: Date.now(), url: page.url() });
        }
        if (page.url() !== first) await settle();
      };
      const sameScreen = (u) => {
        const a = new URL(u), b = new URL(BASE + route.url);
        const key = (x) => x.pathname + "|" + (x.searchParams.get("tab") ?? "") + "|" + (x.searchParams.get("view") ?? "");
        return key(a) === key(b);
      };
      /**
       * A route that lands somewhere else is a pure bounce (login, account
       * gates, the bare dashboard — walked on their own rows) OR a real
       * screen with state in its query (/jobs/:id → /posts?highlight=…,
       * /home?quickApply=…) that no other row reaches. The second kind is
       * walked HERE, on the screen it landed on.
       */
      const isBounce = (u) => {
        const x = new URL(u);
        return /^\/(login|signup|signup-pending|account-banned|complete-profile)(\/|$)/.test(x.pathname)
          || (!x.search && allRoutes.some((r) => r.url === x.pathname && r.personas.includes(persona)));
      };
      const atRest = () => page.url() === restingUrl;
      /**
       * THE BOTTOM DOCK HIDES ON SCROLL, AND A HIDDEN DOCK IS NOT A DEAD BUTTON.
       *
       * `MobileNav` slides the whole bar (curtain + pill + "Post a new job" FAB)
       * off the bottom edge when the user scrolls DOWN, and brings it back on
       * scroll UP. The buttons stay in the DOM the whole time, fully enabled, so
       * they enumerate, they resolve, and `scrollIntoViewIfNeeded` cannot help:
       * the bar is translated out of the viewport by CSS, not scrolled out of a
       * container. Playwright then burns its full 16s budget and the run reports
       * "NOT CLICKABLE".
       *
       * MEASURED, run 35805671843: 22 of the 48 non-switch failures were exactly
       * this — "Home"/"Posts"/"Jobs"/"Messages"/"Profile"/"Post a new job" on
       * /data-rights (which lands on /profile?tab=legal#download-your-data, i.e.
       * an ANCHOR that scrolls the page down on load) and on the two /jobs/<id>
       * rows. The Playwright log names it: "element is visible, enabled and
       * stable - scrolling into view if needed - done scrolling - element is
       * outside of the viewport". The screenshot of the failure shows the page
       * scrolled to the anchor with no dock on screen at all.
       *
       * So before pressing anything that is off-viewport, scroll every surface
       * that can scroll back to the top — the scroll-UP is what the component
       * listens for — and give it the transition to finish. Real dead controls
       * are unaffected: they are on screen, so this does nothing to them.
       */
      const revealIfScrolledAway = async (target) => {
        const box = await target.boundingBox().catch(() => null);
        const vh = page.viewportSize()?.height ?? 0;
        const offscreen = !box || box.y >= vh || box.y + box.height <= 0;
        if (!offscreen) return;
        /**
         * NEVER SCROLL INSIDE AN OVERLAY. Run 35813177418, /complete-profile:
         * "January 1, 1990 › October / November / December" NOT CLICKABLE. The
         * date-of-birth picker (DateWheelPicker.tsx) is three scroll wheels
         * whose value FOLLOWS scroll position — so resetting every scroller to
         * 0 here picked Month=January, Day=1, Year=2008 (the top of each
         * wheel; screenshot complete_profile_incomplete_unclickable_October-5
         * shows "January 1, 2008"). 2008 is the youngest allowed year, which
         * offers only Jan–Sep, so Oct–Dec ceased to exist under the click.
         * The dock this exists for is page chrome; an overlay's control is
         * brought into view by scrollIntoViewIfNeeded, as a user would.
         */
        const inOverlay = await target.evaluate((el, sel) => el.closest(sel) !== null, OPEN_OVERLAY).catch(() => false);
        if (inOverlay) return;
        await page
          .evaluate((sel) => {
            window.scrollTo({ top: 0, behavior: "auto" });
            document.querySelectorAll("*").forEach((el) => {
              if (el instanceof HTMLElement && el.scrollTop > 0 && !el.closest(sel) && el.getAttribute("role") !== "listbox") el.scrollTop = 0;
            });
          }, OPEN_OVERLAY)
          .catch(() => {});
        // The bar's return is a CSS transition, so a settled DOM is not enough.
        await page.waitForTimeout(700);
      };
      /**
       * A PRESS THAT NAVIGATES MUST NOT KILL THE ROW. Run 35813177418,
       * /profile?tab=subscription (customer AND helper): "Upgrade" sends the
       * browser to Stripe Checkout, the page's execution context was destroyed
       * mid-evaluate, and the uncaught throw turned the whole row into
       * "HARNESS ERROR" — two failures that measured nothing. A destroyed
       * context means a navigation is under way: wait for it to land and read
       * the new document (its URL then differs, which IS the outcome).
       */
      const snapshot = async () => {
        for (let attempt = 0; ; attempt++) {
          try { return screenErrorText(await page.evaluate(SNAPSHOT, { overlaySel: OPEN_OVERLAY })); }
          catch (e) {
            if (attempt >= 3 || !/Execution context was destroyed|navigat/i.test(String(e?.message))) throw e;
            await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
          }
        }
      };
      // Signatures are computed HERE, not in the page, so `controlSignature`
      // stays a plain exported function a unit test can drive.
      const enumerate = async (scope) =>
        withSignatures(await page.evaluate(ENUMERATE, { controlSel: CONTROL_SEL, overlaySel: OPEN_OVERLAY, scope, base: BASE, transientSel: TRANSIENT_REGION_SEL, rowSel: RECORD_ROW_SEL }));
      /**
       * Wait until the newest open overlay stops changing shape. Two identical
       * samples 250ms apart, capped at OVERLAY_FILL_MS; a still-moving overlay
       * is read as it is rather than hanging the run.
       */
      const settleOverlay = async () => {
        const fp = () => page.evaluate(OVERLAY_FINGERPRINT, { overlaySel: OPEN_OVERLAY, controlSel: CONTROL_SEL }).catch(() => "err");
        let last = await fp();
        for (let waited = 0; waited < OVERLAY_FILL_MS; waited += 250) {
          await page.waitForTimeout(250);
          const now = await fp();
          if (now === last) return true;
          last = now;
        }
        return false;
      };
      const slug = (s) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 80);
      const shoot = async (name) => {
        const file = `${OUT}/${slug(`${route.url}-${persona}-${name}`)}-${shots++}.png`;
        await page.screenshot({ path: file, fullPage: false }).catch(() => {});
        return file;
      };

      try {
        await paceToCeiling(page);
        await load();
        await awaitLandedUrl();
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
        const verdict = classifyBoot({ text: boot.text, errorRx: ERROR_BOUNDARY_RX, heal: lastHeal });
        if (verdict.note) rec.notes.push(verdict.note);
        if (verdict.fail) {
          rec.status = "error-on-load";
          rec.failed++; failedPresses++;
          rec.controls.push({ chain: [], label: "(page load)", result: "FAIL", why: verdict.why, shot: await shoot("load-error") });
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
            // A replayed opener is watched like its first press: an ungated one
            // never gets a write out on its second, third ... press either.
            if (!step.mutating) netGate.arm();
            await loc.first().click({ timeout: PRESS_TIMEOUT }).catch(() => {});
            await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [OPEN_OVERLAY, before], { timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(SETTLE_MS);
            const watched = netGate.disarm();
            if (watched.misses.length) {
              gateMisses.push({ route: route.url, persona, label: `${step.label} (replayed opener)`, requests: watched.misses });
              console.log(`::error title=press GATE MISS::${route.url} (${persona}) replayed opener "${step.label}" wrote ${watched.misses.join(", ")}; aborted`);
            }
            if ((await page.locator(OPEN_OVERLAY).count()) <= before) return false;
            await settleOverlay();
          }
          return true;
        };

        // The work queue: every control found on the page, then every control
        // found inside any overlay a press opened.
        const queue = (await enumerate("page")).map((c) => ({ chain: [], step: { scope: "page", path: c.path }, meta: c, depth: 0, chainOwned: false, scopeKey: "page", fromChrome: false }));
        const seenOverlays = new Set();
        /** scopeKey → the signatures of the controls this run has actually clicked in it. */
        const pressedInScope = new Map([["page", new Set()]]);
        /** Record texts (meta.rowText) this row's MUTATING presses acted on; see ROW_CONSUMED_SKIP. */
        const mutatedRows = new Set();
        let idx = 0;
        let pageDirty = false; // a press changed the resting page; reload before the next one

        while (idx < queue.length) {
          if (overTimeBudget({ startedAt: runStart, budgetMs: TIME_BUDGET_MS })) {
            // Q128 class 6: stop mid-row rather than be cancelled mid-row.
            if (QUEUE_DIR && !LAST_WAVE) {
              // #1582: an earlier wave hands the row back; the next wave walks it whole.
              releaseRow({ dir: QUEUE_DIR, key: rowKey });
              rec.status = "handed-on";
              rec.notes.push(`handed on: this wave's time budget ran out with ${queue.length - idx} control(s) unpressed; the next wave walks the row whole`);
              queueStopped = true;
              break;
            }
            rec.status = NOT_REACHED_STATUS;
            rec.notes.push(`cut short: the sweep's own time budget ran out with ${queue.length - idx} control(s) of this row unpressed`);
            break;
          }
          const item = queue[idx++];
          netGate.disarm(); // a press's window never outlives its own entry
          // Q1405: where a row's time goes. The pace wait (the request ceiling)
          // is timed apart from the press itself; rowTimings() turns both into
          // the "Where the time went" table in coverage.md.
          const pacedFrom = Date.now();
          await paceToCeiling(page);
          const paceMs = Date.now() - pacedFrom;
          rec.paceMs += paceMs;
          const { meta } = item;
          const chain = item.chain.map((s) => s);
          const label = meta.label || `<${meta.tag}${meta.type ? ` type=${meta.type}` : ""}>`;
          const entry = { chain: [...chain.map((s) => s.label), label], path: item.step.path, depth: item.depth, label, result: "", why: "", startedAt: Date.now(), paceMs };
          rec.controls.push(entry);
          rec.found++; totalFound++;

          const skip = (why) => { entry.result = "SKIP"; entry.why = why; rec.skipped++; };
          /**
           * Find this control again by IDENTITY rather than position: its
           * signature, then a digit-blind match (a badge that ticked is the
           * same control, accepted only when unambiguous), then the old
           * tag/label/ordinal.
           */
          const reAddress = (now, m) => {
            const bySig = now.filter((c) => c.sig === m.sig);
            const loose = m.sig ? now.filter((c) => looseSignature(c.sig) === looseSignature(m.sig)) : [];
            return (
              bySig[Math.min(m.sigOrdinal ?? 0, Math.max(bySig.length - 1, 0))] ??
              (loose.length === 1 ? loose[0] : undefined) ??
              now.find((c) => c.tag === m.tag && c.label === m.label && c.ordinal === m.ordinal)
            );
          };
          /**
           * Is this control gone because THIS RUN pressed it away? Only a scope
           * that has also lost a control this run clicked earns that answer;
           * the proof lands on the entry and in coverage.md.
           */
          const consumedHere = async (now) => {
            const present = new Set((now ?? (await enumerate(item.step.scope))).map((c) => c.sig));
            const gone = consumedByEarlierPress({ sig: meta.sig, present, pressed: pressedInScope.get(item.scopeKey ?? "") ?? new Set() });
            if (!gone) return false;
            entry.consumedProof = `${gone.length} control(s) this run pressed are gone from the same list, e.g. ${JSON.stringify(gone[0].slice(0, 120))}`;
            return true;
          };
          if (meta.disabled) { skip("disabled (inert by design)"); continue; }
          if (meta.srOnly) { skip("screen-reader only (pointer not expected)"); continue; }
          if (meta.active) { skip("already the active tab/route (no-op expected)"); continue; }
          if (meta.self) { skip("self-link (no-op expected)"); continue; }
          if (meta.external) { skip("external / new-tab link (covered by walk-every-control's new-tab pass)"); continue; }
          if (meta.type === "file") { skip("file picker (opens the OS dialog; not a DOM outcome)"); continue; }
          if (meta.inToast) { skip("inside a toast (transient; not page chrome)"); continue; }
          if (isHiddenFormMirror(meta)) { skip(FORM_MIRROR_SKIP); continue; }
          const ckey = chromeKey({ persona, chain: entry.chain.slice(0, -1), sig: meta.sig });
          const chromeWhy = chromeDisposition({ fromChrome: item.fromChrome, depth: item.depth, key: ckey, passedOn: chromePassedOn });
          if (chromeWhy) { entry.pressedOn = chromePassedOn.get(ckey); skip(chromeWhy); continue; }
          if ((DESTRUCTIVE_RX.test(label) && !meta.dismissOnly) || isNotificationOpen({ label, chain: entry.chain }) || isAdminWrite({ persona, label }) || meta.type === "submit" || isCommitControl(meta) || PAYMENT_RX.test(label) || isAdminStateToggle({ persona, meta, label }) || isAccountSettingToggle({ persona, meta, label })) {
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
          } else if (
            pageDirty ||
            !atRest() ||
            (await page.locator(OPEN_OVERLAY).count()) > 0 ||
            // WE MAY NOT EVEN BE ON THIS SCREEN ANY MORE.
            //
            // The three conditions above catch a page that CHANGED. None of
            // them catches a page that was LEFT. If an earlier press navigated
            // — and plenty do — every control still queued for this screen is
            // pressed against whatever route we drifted to.
            //
            // It stays invisible when the control is gone, because the missing-
            // control branch below already asks `sameScreen` and dispositions
            // it. It is NOT invisible when the control PERSISTS ACROSS ROUTES,
            // which is exactly what the bottom nav does: it still resolves, so
            // nothing re-addresses and nothing skips, and the click burns its
            // full 16s budget against an element that belongs to another
            // screen's layout.
            //
            // Measured, run 35768341847: `[/jobs/7d315f44… customer]` found 19
            // controls, pressed 2, and failed 4 — "Posts", "Jobs", "Messages",
            // "Profile", every one NOT CLICKABLE at 16000ms. The log gives the
            // game away: the resolved element is
            // `<button aria-label="Posts" aria-current="page" …>`. `aria-current`
            // means we were ALREADY on /posts. The job itself does not exist
            // in prod (`select … where id = '7d315f44-…'` returns no row), so
            // the route bounced and the sweep kept pressing the old inventory.
            //
            // Four fabricated product defects on one page, and the same shape
            // is available on every screen whose press navigates away.
            !sameScreen(page.url())
          ) {
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
            // The path moved (a toast or portal shifted nth-of-type, or a list
            // lost a row above this one). Find the same control by IDENTITY and
            // re-address it: signature first — the whole text, so two rows of
            // the same feed are told apart — then the old tag/label/ordinal.
            const now = await enumerate(item.step.scope);
            const again = reAddress(now, meta);
            if (again) { item.step.path = again.path; target = locate(item.step); entry.relocated = true; }
            else {
              // A route whose gate resolves after the first paint
              // (/account-banned for an un-banned account goes to /home
              // once `profile` lands; /profile for the incomplete persona goes
              // to /complete-profile) renders once, is enumerated, and then
              // redirects on EVERY later load — so ask where we are first.
              const onSameScreen = sameScreen(page.url());
              if (!onSameScreen) entry.bouncedTo = page.url().replace(BASE, "");
              const why = missingControlDisposition({
                scope: item.step.scope,
                onSameScreen,
                consumed: item.step.scope === "overlay" ? await consumedHere(now) : false,
                transient: !!meta.inStatus,
                foreignFixture: isForeignSweepFixture(entry.chain),
                rowConsumed: rowGoneAfterOwnWrite({ rowText: meta.rowText, mutatedRows, now }),
              });
              if (why) { skip(why); continue; }
            }
          }
          if (!(await target.count())) {
            entry.result = "FAIL"; entry.why = "control not found on a freshly loaded page (transient or non-deterministic DOM)";
            // What the reloaded screen DID hold, so the log alone can tell a
            // virtualized row that is not mounted from a row that is gone
            // (#1582: /admin?view=people "AW / ET / HH" not found, unexplained).
            entry.why += " " + (await page.evaluate(RELOADED_SCREEN, { controlSel: CONTROL_SEL, label: meta.label }).catch((e) => `[screen unreadable: ${String(e?.message).slice(0, 80)}]`));
            rec.failed++; failedPresses++;
            entry.shot = await shoot(`missing-${slug(label)}`);
            continue;
          }
          target = target.first();

          /*
           * THE GATE APPROVED ONE RECORD; THE CLICK MUST LAND ON IT (run
           * 39014836855 leg 4: twelve identical "Got it"s, each addressed by a
           * path that had shifted to the next card once an earlier ack moved
           * its own card out of the list). See pressTargetRecord. Read HERE,
           * once `target` is the element about to be clicked: after any reload
           * or replay above, not before them (ready/reds-1017-9 read it before
           * `let target` and threw on every gate-approved write;
           * src/test/pressDrivesTheRealPressPath.test.tsx runs this loop).
           */
          if (entry.mutating) {
            const liveRowText = await target.evaluate(LIVE_ROW_TEXT, RECORD_ROW_SEL).catch(() => null);
            if (liveRowText !== null) {
              const now = await enumerate(item.step.scope);
              const placed = pressTargetRecord({ liveRowText, meta, now });
              if (placed.verdict === "moved") {
                item.step.path = placed.control.path; target = locate(item.step).first(); entry.relocated = true;
              }
              if (placed.verdict === "gone") {
                if (rowGoneAfterOwnWrite({ rowText: meta.rowText, mutatedRows, now })) { skip(ROW_CONSUMED_SKIP); continue; }
                entry.result = "FAIL"; entry.why = "its record is no longer on the screen (a write here would have landed on a different record, so it was not pressed)";
                rec.failed++; failedPresses++;
                entry.shot = await shoot(`record-gone-${slug(label)}`);
                continue;
              }
            }
          }

          /**
           * IS IT STILL ENABLED? `meta.disabled` was read at ENUMERATION time,
           * and the skip at the top of this loop acts on that. A control that
           * was enabled when the page was inventoried and is disabled by the
           * time we reach it never hits that skip — the click just waits out
           * its whole 16s budget and is reported as a failed press.
           *
           * MEASURED, run 35805671843: 76 of 126 failures were exactly this.
           * `/profile?tab=notifications` 27+27 and `/admin?view=notifications`
           * 22, every one a `<button disabled role="switch">`. On the admin
           * screen it is CORRECT behaviour — those children carry
           * `disabled={!allPushOn}` and the master was off — so the sweep was
           * manufacturing 22 defects out of a design.
           *
           * A disabled control cannot be pressed. That is a documented SKIP,
           * which is the disposition this file already chose for the
           * enumeration-time case; re-reading it here just applies the same
           * decision at the moment it matters rather than minutes earlier.
           *
           * The reason is worded to keep the signal: a control that flips
           * state between inventory and press is worth seeing in the skip
           * list, and a page where EVERY control lands here still shows up as
           * a page with nothing pressed.
           */
          if (await target.isDisabled().catch(() => false)) {
            skip("disabled by the time it was reached (enabled when enumerated)");
            continue;
          }
          // Still a control at all? See NO_LONGER_CONTROL_SKIP.
          {
            const isControl = await target.evaluate((el, sel) => el.matches(sel), CONTROL_SEL).catch(() => true);
            const why = pressTimeDisposition({ isControl });
            if (why) { skip(why); continue; }
          }

          const before = await snapshot();
          // Was this control ALREADY in the state pressing it asks for? A tab
          // that is the selected tab, a toggle already on — pressing it is
          // supposed to do nothing, and "no observable change" is the correct
          // outcome, not a defect. Re-pressing the active "Notifications › All"
          // filter alone accounted for 11 failed presses on 2026-09-15.
          // Read BEFORE the click, and narrow: this never excuses a control
          // that was not already selected.
          const alreadyActive = await target
            .evaluate((el) =>
              el.getAttribute("aria-selected") === "true" ||
              el.getAttribute("aria-pressed") === "true" ||
              el.getAttribute("aria-checked") === "true" ||
              el.getAttribute("data-state") === "active" ||
              el.getAttribute("data-state") === "checked" ||
              el.getAttribute("aria-current") === "page")
            .catch(() => false);
          // Is this a SUBMIT button whose own form is already invalid? The
          // browser then refuses the submit and paints a NATIVE validation
          // bubble ("Please fill out this field.") — chrome the page's DOM does
          // not contain, so `snapshot()` cannot see it and the press reads as
          // "moved focus only". The press worked and the product behaved: the
          // form is simply incomplete. /reset-password › "Update password"
          // failed for exactly this reason every night (both inputs are
          // `required`; ResetPassword.tsx). Read BEFORE the click, like
          // alreadyActive, and narrowed to a control that actually owns a form.
          const blockedByValidation = await target
            .evaluate((el) => {
              const form = el.form ?? el.closest("form");
              if (!form || typeof form.checkValidity !== "function") return false;
              const submits = el.type === "submit" || el.getAttribute("type") === "submit";
              return submits && !form.checkValidity();
            })
            .catch(() => false);
          const errs0 = consoleErrors.length, net0 = netFails.length, pop0 = popups.length, dl0 = downloads.length, fc0 = fileChoosers.length, stripe0 = stripeBlocked.length, captcha0 = captchaBlocked.length, writes0 = writes.length;
          // See paymentPaceMs: never outrun create-payment's own limiter.
          if (PAYMENT_RX.test(label) && paymentClock.last) {
            const wait = paymentClock.last + PAYMENT_PACE_MS - Date.now();
            if (wait > 0) await page.waitForTimeout(wait);
          }
          /**
           * DID THE CONTROL ACKNOWLEDGE THE PRESS? Run 35813177418: "Refresh"
           * on /admin?view=notiflogs and /admin?view=payouts was scored "no
           * observable change". Both buttons go disabled and spin / read
           * "Refreshing…" while they refetch (AdminNotificationLogs.tsx,
           * AdminPayoutBatches.tsx), then return to rest over identical data —
           * the refetch worked, the screen correctly looks the same, and the
           * only evidence was on the button, gone before the after-snapshot.
           * So watch the pressed control's OWN subtree for a busy/label flip.
           * Counted only for a NON-mutating press (see the classifier): a write
           * that leaves the screen identical is indistinguishable from a dead
           * button, however briefly its label flickered.
           */
          await target.evaluate((el) => {
            const w = /** @type {any} */ (window);
            w.__pressAck?.disconnect?.();
            w.__pressAcked = false;
            w.__pressAck = new MutationObserver(() => { w.__pressAcked = true; });
            w.__pressAck.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled", "aria-busy", "aria-disabled", "class"] });
          }).catch(() => {});
          // Armed for the press and everything it sets off, up to the
          // classification below; a gated (mutating) press is not watched.
          if (!entry.mutating) netGate.arm();
          try {
            await revealIfScrolledAway(target);
            await target.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
            await target.click({ timeout: PRESS_TIMEOUT });
          } catch (e) {
            // Two retries: the layout may still have been settling under it.
            // The bottom nav's pill indicator and the FAB's halo animate for a
            // while after `settle()` returns, and Playwright refuses to click a
            // box that is still moving — five presses failed that way in run
            // 35660182220 and every one of them was on animated chrome. The
            // second retry gets a longer budget, and the reported message is
            // the LAST failure at 600 chars: the 300-char slice cut the log off
            // before the part that says WHY (unstable / intercepted / hidden),
            // which is why that red could not be read for nine days.
            let last = e;
            await page.waitForTimeout(500);
            try { await target.click({ timeout: PRESS_TIMEOUT }); last = null; }
            catch (e2) {
              last = e2;
              await page.waitForTimeout(1500);
              try { await target.click({ timeout: PRESS_TIMEOUT * 2 }); last = null; }
              catch (e3) { last = e3; }
            }
            if (last && (await target.count()) === 0) {
              // THE CONTROL LEFT BETWEEN BEING ADDRESSED AND BEING CLICKED.
              // Measured on /profile?tab=wrapped: "Go back" resolved, then
              // the tab re-rendered under it and the click spent its whole
              // budget waiting for a node that no longer existed. That is a
              // moved control, not an unclickable one — so look it up again by
              // identity and press it once more before saying anything.
              const now = await enumerate(item.step.scope);
              const again = reAddress(now, meta);
              if (again) {
                item.step.path = again.path;
                target = locate(item.step).first();
                entry.relocated = true;
                try { await target.click({ timeout: PRESS_TIMEOUT }); last = null; } catch (e4) { last = e4; }
              }
              if (last) {
                const onSameScreen = sameScreen(page.url());
                if (!onSameScreen) entry.bouncedTo = page.url().replace(BASE, "");
                const why = missingControlDisposition({
                  scope: item.step.scope,
                  onSameScreen,
                  consumed: item.step.scope === "overlay" ? await consumedHere(now) : false,
                  transient: !!meta.inStatus,
                  foreignFixture: isForeignSweepFixture(entry.chain),
                  rowConsumed: rowGoneAfterOwnWrite({ rowText: meta.rowText, mutatedRows, now }),
                });
                if (why) { skip(why); pageDirty = true; continue; }
              }
            }
            if (last) {
              entry.result = "FAIL"; entry.why = `NOT CLICKABLE (${clickFailureReason(last.message)}): ` + String(last.message).replace(/\s+/g, " ").slice(0, 600);
              rec.failed++; failedPresses++;
              entry.shot = await shoot(`unclickable-${slug(label)}`);
              pageDirty = true;
              continue;
            }
          }
          rec.pressed++; totalPressed++;
          if (entry.mutating && meta.rowText) mutatedRows.add(meta.rowText);
          // Remember WHAT was pressed in this scope: a control that vanishes
          // later is only excused when a control this run pressed is gone too.
          pressedInScope.get(item.scopeKey ?? "page")?.add(meta.sig);
          await awaitApiQuiet();
          await settle();
          // The request is the fact: a press that wrote consumed its record as
          // surely as a label-gated one (see isWriteRequest, ROW_CONSUMED_SKIP).
          if (writes.length > writes0) {
            entry.wrote = writes.slice(writes0, writes0 + 3);
            if (meta.rowText) mutatedRows.add(meta.rowText);
          }
          const acked = await page
            .evaluate(() => { const w = /** @type {any} */ (window); w.__pressAck?.disconnect?.(); return w.__pressAcked === true; })
            .catch(() => false);
          const after = await snapshot();

          // The press tried to write to Stripe and the backstop aborted it
          // (Stripe not in TEST mode). Not a PASS, not a FAIL: a documented
          // skip, with the blocked request named, and the page reloaded.
          if (stripeBlocked.length > stripe0) {
            rec.pressed--; totalPressed--;
            skip(SKIP_STRIPE_WRITE_BLOCKED);
            entry.stripeBlocked = stripeBlocked.slice(stripe0);
            rec.notes.push(`"${label}": Stripe write blocked on live — ${entry.stripeBlocked[0]}`);
            pageDirty = true;
            continue;
          }
          // The press called a CAPTCHA-guarded auth endpoint with no token and
          // the backstop aborted it: a documented skip, never PASS or FAIL.
          if (captchaBlocked.length > captcha0) {
            rec.pressed--; totalPressed--;
            skip(SKIP_CAPTCHA_GATED);
            entry.captchaBlocked = captchaBlocked.slice(captcha0);
            rec.notes.push(`"${label}": CAPTCHA-guarded auth call blocked (no Turnstile token in this build) — ${entry.captchaBlocked[0]}`);
            pageDirty = true;
            continue;
          }

          // The network gate's verdict on THIS press (see networkGate).
          const watched = netGate.disarm();
          if (watched.sideEffects.length) rec.notes.push(`"${label}": side-effect write(s) aborted, not counted: ${watched.sideEffects.join(", ")}`);
          if (watched.misses.length) {
            const requests = watched.misses;
            gateMisses.push({ route: route.url, persona, label, requests });
            entry.gateMiss = requests;
            entry.result = "FAIL";
            entry.why = `${GATE_MISS}: the gate did not class "${label}" as mutating, and it wrote: ${requests.join(", ")} (aborted before it left)`;
            rec.failed++; failedPresses++;
            console.log(`::error title=press GATE MISS::${route.url} (${persona}) "${label}" wrote ${requests.join(", ")}; aborted`);
            pageDirty = true;
            continue;
          }

          // ---- classify ------------------------------------------------
          const problems = [];
          const newErrToasts = after.errorToasts.filter((t) => !before.errorToasts.includes(t));
          if (newErrToasts.length) {
            // The one excuse an error toast gets: it is the permission-off copy,
            // pressed inside the push-permission prompt, while the browser
            // really has notifications denied. Read the permission from the page
            // rather than assuming it — see isTruthfulPermissionRefusal.
            const permission = await page
              .evaluate(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission))
              .catch(() => "unknown");
            const openedOverlay = after.overlays > before.overlays ? "opened an overlay" : "";
            const real = newErrToasts.filter((t) =>
              !isTruthfulPermissionRefusal({ toast: t, chain: entry.chain, permission }) &&
              !isDesignedValidationRefusal({ toast: t, changed: openedOverlay }) &&
              !isForeignFixtureGoneRefusal({ toast: t, chain: entry.chain }));
            const gone = newErrToasts.find((t) => isForeignFixtureGoneRefusal({ toast: t, chain: entry.chain }));
            if (gone) entry.excused = `another sweep's fixture the viewer can no longer open (class 3): "${gone}"`;
            const validation = newErrToasts.find((t) => isDesignedValidationRefusal({ toast: t, changed: openedOverlay }));
            if (validation) entry.excused = `designed validation refusal that opened the fix: "${validation}"`;
            if (real.length) problems.push(`error toast: "${real[0]}"`);
            const refusal = newErrToasts.find((t) => isTruthfulPermissionRefusal({ toast: t, chain: entry.chain, permission }));
            if (refusal) {
              entry.excused = `truthful permission refusal (Notification.permission = ${permission}): "${refusal}"`;
            }
          }
          if (ERROR_BOUNDARY_RX.test(after.text) && !ERROR_BOUNDARY_RX.test(before.text)) problems.push("error boundary / error copy rendered");
          // THE ONE CONSOLE ERROR THAT IS THE FEATURE.
          //
          // `/admin?view=health` ships a "Throw Uncaught" button whose entire
          // job is to throw an uncaught error so an admin can confirm Sentry is
          // still wired (`src/components/admin/AdminHealth.tsx:288-293` — a
          // `setTimeout` that throws `Sentry uncaught test — <ISO>`). Reporting
          // it is reporting the probe working. Narrow on purpose: the excuse is
          // keyed to that exact message, so any OTHER uncaught error from that
          // same button — or this message from any other press — is still red.
          const newErrs = consoleErrors.slice(errs0).filter((e) => !SENTRY_PROBE_RX.test(e));
          if (consoleErrors.slice(errs0).length > newErrs.length) {
            entry.excused = `deliberate Sentry probe: the "Throw Uncaught" button on /admin?view=health exists to raise this error`;
          }
          if (newErrs.length) problems.push(`console: ${newErrs[0]}`);
          const newNet = netFails.slice(net0);
          if (newNet.length) problems.push(`network: ${[...new Set(newNet)].slice(0, 3).join(" | ")}`);

          const changed =
            after.url !== before.url ? `navigated → ${after.url.replace(BASE, "")}` :
            popups.length > pop0 ? `opened a new tab (${popups[pop0]})` :
            downloads.length > dl0 ? `started a download (${downloads[dl0]})` :
            fileChoosers.length > fc0 ? "opened the OS file chooser" :
            after.overlays > before.overlays ? "opened an overlay" :
            after.overlays < before.overlays ? "closed the overlay" :
            after.toasts > before.toasts ? "showed a toast" :
            after.inputs !== before.inputs ? `revealed/removed a field (${before.inputs}→${after.inputs})` :
            after.state !== before.state ? "changed a toggle/field" :
            after.hash !== before.hash ? `changed the DOM (${after.body - before.body >= 0 ? "+" : ""}${after.body - before.body} chars)` :
            acked && !entry.mutating ? "the control went busy and returned (a read over unchanged data)" :
            after.focused !== before.focused ? "moved focus only" :
            "";
          if (!alreadyActive && !blockedByValidation) {
            // What was compared, so a "no observable change" can be read from
            // the log alone (#1582: the admin bell's "Stuck payment" row, whose
            // row links to /admin?view=people&user=…, scored this).
            if (!changed) problems.push(`no observable change [url ${before.url.replace(BASE, "")} → ${after.url.replace(BASE, "")}; overlays ${before.overlays}→${after.overlays}; toasts ${before.toasts}→${after.toasts}; acked=${acked}]`);
            else if (changed === "moved focus only") problems.push("no observable change (focus moved, nothing else)");
          }

          entry.outcome = changed || (blockedByValidation ? "native form validation blocked the submit (invisible to the DOM)" : "nothing");
          if (problems.length) {
            entry.result = "FAIL"; entry.why = problems.join("; ");
            rec.failed++; failedPresses++;
            entry.shot = await shoot(`fail-${slug(label)}`);
          } else {
            entry.result = "PASS"; rec.passed++;
            if (item.fromChrome && item.depth > 0 && !chromePassedOn.has(ckey)) chromePassedOn.set(ckey, `${route.url} (${persona})`);
            if (rec.pressed <= SAMPLE) entry.shot = await shoot(`sample-${slug(label)}`);
          }

          // ---- recurse into what it opened -----------------------------
          if (after.overlays > before.overlays && item.depth < MAX_DEPTH) {
            // Let it finish arriving, or the inventory is whatever happened to
            // have rendered in the first 600ms — see OVERLAY_FINGERPRINT.
            entry.overlayFilled = await settleOverlay();
            const inner = await enumerate("overlay");
            const key = inner.map((c) => c.path + c.label).join("|");
            if (inner.length && !seenOverlays.has(key)) {
              seenOverlays.add(key);
              const nextChain = [...chain, { ...item.step, label, mutating: !!entry.mutating }];
              const chainOwned = item.chainOwned || rowNamesTestOwner(meta.rowText, owners);
              const scopeKey = `overlay:${entry.chain.join(" › ")}`;
              if (!pressedInScope.has(scopeKey)) pressedInScope.set(scopeKey, new Set());
              const fromChrome = item.fromChrome || (item.depth === 0 && !!meta.inChrome);
              for (const c of inner) queue.push({ chain: nextChain, step: { scope: "overlay", path: c.path }, meta: c, depth: item.depth + 1, chainOwned, scopeKey, fromChrome });
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
      // A row whose API calls came back 401/403 may have been walked signed
      // OUT. Ask GoTrue rather than assume, and if the session is gone,
      // un-count this row: it did not measure the app. `suspect` forces the
      // re-mint on the next row, before anything else is pressed.
      if (session && netFails.some((f) => /^40[13] /.test(f)) && !(await sessionStillAlive(session))) {
        session.suspect = true;
        sessionLostRows.push({ route: route.url, persona, account: session.account, failed: rec.failed });
        console.log(`::error title=press SESSION DIED::${route.url} (${persona}) was walked with a dead ${session.account} session — ${rec.failed} failure(s) on this row are NOT product defects`);
        rec.status = "session-lost";
        rec.notes.push(`SESSION DIED mid-route: GoTrue refuses the ${session.account} session; this row did not measure the app`);
        for (const c of rec.controls) if (c.result === "FAIL") { c.result = "SESSION-LOST"; c.why = `not measured — the ${session.account} session was dead (was: ${c.why})`; }
        failedPresses -= rec.failed;
        rec.failed = 0;
      }
      const unpressed = rec.controls.filter((c) => c.result === "SKIP" && !DOCUMENTED_SKIPS.has(c.why)).length;
      undocumented += unpressed;
      rec.net = summarizeTimings(reqTimings);
      console.log(`[${route.url} ${persona}] net=${rec.net.requests}req api=${rec.net.apiRequests} p95=${rec.net.p95Ms}ms max=${rec.net.maxMs}ms${rec.net.failed ? ` failed=${rec.net.failed}` : ""}${rec.status === "error-on-load" ? " slowest: " + rec.net.slowest.join(" | ") : ""}`);
      // PublicObjectCache's effect, per row: answered from memory vs fetched.
      rec.objectCache = { served: objectCache.served, filled: objectCache.filled };
      if (objectCache.served) console.log(`[${route.url} ${persona}] public-object cache: served=${objectCache.served} filled=${objectCache.filled}`);
      console.log(`[${route.url} ${persona}] found=${rec.found} pressed=${rec.pressed} pass=${rec.passed} fail=${rec.failed} skip=${rec.skipped} undocumented=${unpressed}`);
      // Every failure and every undocumented skip, one line each (#1582: the
      // artifacts are not readable where the red is triaged; see rowDetailLines).
      for (const l of rowDetailLines({ route: route.url, persona, controls: rec.controls, documented: DOCUMENTED_SKIPS })) console.log(l);
      // Q1374: the budget is per PRESS (requests / presses), so the meter's
      // `tests` is this shard's presses; kept current for the exit-time flush.
      requestMeter.tests = totalPressed;
    }
  }
  if (queueStopped) console.log(`::warning title=press shard handed on::time budget reached; unclaimed rows are left in ${QUEUE_DIR} for the next wave`);
  requestMeter.tests = totalPressed;
  requestMeter.flush();
  await browser.close();

  // ---- clean up what the presses created --------------------------------------
  // Q128 class 5: the clean-up ran on tokens that had expired hours earlier
  // ("admin applications: HTTP 401 JWT expired" x11) and cleaned nothing.
  for (const p of Object.keys(sessions)) { noticedOn = "clean-up"; await ensureLiveSession(p); }
  const cleaned = await cleanup({ sessions, since: runStart - 60_000, profilesBefore: restoreFrom?.profiles ?? {}, weeklyAvailabilityBefore: restoreFrom?.weeklyAvailability });
  for (const l of cleaned.log) console.log(`cleaned: ${l}`);
  for (const l of cleaned.residue) console.log(`::warning title=clean-up residue::${l}`);

  // ---- coverage report ------------------------------------------------------
  const lines = [];
  lines.push("# press-every-control coverage", "", `prod width=${WIDTH} theme=${THEME} base=${BASE} run=${RUN_ID}`, "");
  // A session death is stated where nobody can mistake it for a defect count.
  if (sessionDeaths.length || sessionLostRows.length) {
    const lostFailures = sessionLostRows.reduce((n, r) => n + r.failed, 0);
    lines.push(
      `> **SESSION DEATH — THIS RUN DID NOT FULLY MEASURE THE APP.** GoTrue refused a session mid-sweep ${sessionDeaths.length} time(s); ${sessionLostRows.length} row(s) were walked signed out and their ${lostFailures} failure(s) are NOT product defects.`,
      "",
      ...sessionDeaths.map((d) => `- session died: **${d.account}** (${d.persona}) noticed on ${d.noticedOn} at ${d.at} — ${d.reminted ? "re-minted, sweep continued" : `COULD NOT RE-MINT: ${d.why}`}`),
      ...sessionLostRows.map((r) => `- not measured: ${r.route} (${r.persona}) — ${r.failed} failure(s) discarded`),
      "",
    );
  }
  const notReached = results.filter((r) => r.status === NOT_REACHED_STATUS);
  if (notReached.length) {
    lines.push(`> **TIME BUDGET — ${notReached.length} ROW(S) NOT REACHED.** The sweep stopped itself at its ${TIME_BUDGET_MS / 60_000}-minute budget (below the job's timeout) so this report exists; these rows were not measured:`, "",
      ...notReached.map((r) => `- not reached: ${r.route} (${r.persona})`), "");
  }
  const uncovered = results.filter((r) => r.status === "uncovered");
  if (uncovered.length) lines.push(`**UNCOVERED personas:** ${[...new Set(uncovered.map((r) => `${r.persona} (${r.notes[0]})`))].join("; ")}`, "");
  lines.push("| route | persona | found | pressed | pass | fail | skipped (documented) | undocumented |", "|---|---|---:|---:|---:|---:|---:|---:|");
  for (const r of results) {
    if (r.status === "redirect") { lines.push(`| ${r.route} | ${r.persona} | — | — | — | — | redirect → ${r.landedOn ?? "target"} | — |`); continue; }
    if (r.status === "uncovered") { lines.push(`| ${r.route} | ${r.persona} | — | — | — | — | UNCOVERED (${r.notes[0]}) | — |`); continue; }
    if (r.status === NOT_REACHED_STATUS) { lines.push(`| ${r.route} | ${r.persona} | — | — | — | — | NOT REACHED (time budget) | — |`); continue; }
    const doc = r.controls.filter((c) => c.result === "SKIP" && DOCUMENTED_SKIPS.has(c.why)).length;
    const undoc = r.controls.filter((c) => c.result === "SKIP" && !DOCUMENTED_SKIPS.has(c.why)).length;
    lines.push(`| ${r.route} | ${r.persona} | ${r.found} | ${r.pressed} | ${r.passed} | ${r.failed} | ${doc} | ${undoc} |`);
  }
  const fails = results.flatMap((r) => r.controls.filter((c) => c.result === "FAIL").map((c) => ({ ...c, route: r.route, persona: r.persona })));
  lines.push("", `## Failed presses (${fails.length})`, "");
  for (const f of fails) lines.push(`- **${f.route}** (${f.persona}) › ${f.chain.join(" › ")} — ${f.why}${f.shot ? ` — ${f.shot}` : ""}`);
  const skips = results.flatMap((r) => r.controls.filter((c) => c.result === "SKIP").map((c) => ({ ...c, route: r.route, persona: r.persona })));
  lines.push("", `## Unpressed controls (${skips.length}) — every one with its reason`, "");
  for (const s of skips) lines.push(`- ${s.route} (${s.persona}) › ${s.chain.join(" › ")} — ${s.why}${s.pressedOn ? ` (passed on ${s.pressedOn})` : ""}${DOCUMENTED_SKIPS.has(s.why) ? "" : "  **UNDOCUMENTED**"}`);
  const mutated = results.flatMap((r) => r.controls.filter((c) => c.mutating && c.result !== "SKIP").map((c) => `- ${r.route} (${r.persona}) › ${c.chain.join(" › ")} — ${c.result}: ${c.outcome ?? ""}`));
  lines.push("", `## Mutating presses on test-owned targets (${mutated.length})`, "", ...mutated);
  // An excused error toast must be VISIBLE, or the allow becomes the kind of
  // silent exemption nobody re-reads. Every one is listed with the permission
  // state that excused it.
  const excused = results.flatMap((r) => r.controls.filter((c) => c.excused).map((c) => `- ${r.route} (${r.persona}) › ${c.chain.join(" › ")} — ${c.excused}`));
  lines.push("", `## Error toasts not counted as defects (${excused.length})`, "", ...excused);
  // Same rule for the self-consuming lists: every excused row is listed with
  // the proof that this run's own presses are what removed it.
  const consumed = results.flatMap((r) => r.controls.filter((c) => c.consumedProof).map((c) => `- ${r.route} (${r.persona}) › ${c.chain.join(" › ")} — ${c.consumedProof}`));
  lines.push("", `## Rows the sweep consumed before it could press them (${consumed.length})`, "", ...consumed);
  // Q128: every reclassified request, listed — telemetry refusals (our own
  // reporter; they need their own look) and vendor 5xx. Not control failures.
  const nonApp = results.flatMap((r) => (r.nonApp ?? []).map((l) => `- ${r.route} (${r.persona}) — ${l}`));
  const telemetryCount = nonApp.filter((l) => l.includes(" — telemetry: ")).length;
  lines.push("", `## Request failures that are not the app's (${nonApp.length}; telemetry ${telemetryCount})`, "", ...nonApp);
  if (sessionRefreshes.length) lines.push("", `## Routine token refreshes (${sessionRefreshes.length}) — expiry, not session deaths`, "", ...sessionRefreshes.map((r) => `- ${r.account} (${r.persona}) before ${r.noticedOn} at ${r.at}`));
  lines.push("", `## Clean-up`, "", ...cleaned.log.map((l) => `- ${l}`), ...cleaned.residue.map((l) => `- **RESIDUE** ${l}`));
  // Q1405: the rows that cost the run its time budget, slowest first.
  const timed = rowTimings(results, Date.now());
  lines.push("", `## Where the time went (slowest rows)`, "", "| Row | Persona | Minutes | Presses | s / press | Pace wait (min) |", "|---|---|---|---|---|---|");
  for (const t of timed.slice(0, 15)) lines.push(`| ${t.route} | ${t.persona} | ${(t.ms / 60_000).toFixed(1)} | ${t.presses} | ${t.presses ? (t.ms / 1000 / t.presses).toFixed(1) : "-"} | ${(t.paceMs / 60_000).toFixed(1)} |`);
  writeFileSync(`${OUT}/coverage.md`, lines.join("\n") + "\n");
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ width: WIDTH, theme: THEME, runId: RUN_ID, uncovered: unavailable, gateMisses, sessionDeaths, sessionLostRows, sessionRefreshes, cleanup: cleaned, results }, null, 2));
  if (telemetryCount) console.log(`::warning title=press telemetry refused::${telemetryCount} request(s) to our own telemetry (Sentry/PostHog) were refused (429s are the reporter being rate-limited) — listed in coverage.md, not counted as control failures`);

  // Q94: the synthetic half of the user-error-screen close rule. Every screen
  // this shard walked cleanly is recorded, so ops_alert_condition can close a
  // real person's error-screen item only after a pass newer than it.
  const probePasses = routeProbePasses(results);
  const probe = await recordRouteProbePasses(probePasses, RUN_ID, { readEnvFile: () => readFileSync(".env", "utf8") });
  console.log(probe.ok ? `route probe: recorded ${probe.recorded} clean screen(s) in ops_route_probe` : `::warning title=route probe not recorded::${probe.why}`);

  const pressedOrDocumented = totalFound - undocumented;
  console.log(`\nfound=${totalFound} pressed=${totalPressed} failed=${failedPresses} undocumented-skips=${undocumented} coverage=${totalFound ? ((pressedOrDocumented / totalFound) * 100).toFixed(1) : "100.0"}%`);
  console.log(`wrote ${OUT}/coverage.md and ${OUT}/results.json (${shots} screenshots)`);
  if (sessionDeaths.length || sessionLostRows.length) {
    console.log(`SESSION DEATH: GoTrue refused a session ${sessionDeaths.length} time(s); ${sessionLostRows.length} row(s) not measured. This run did not fully measure the app — the press counts above are a floor, not a verdict.`);
  }
  // Q52 (2026-09-23): two more ways this run used to report green having
  // measured nothing. (1) An EMPTY inventory: found=0 printed coverage=100.0%.
  // (2) UNCOVERED personas (not minted) were a ::warning:: — every control on
  // their routes went unpressed and the run still exited 0.
  const uncoveredPersonas = Object.keys(unavailable);
  const drained = drainedQueueShard({ queueDir: QUEUE_DIR, rowsWalked: results.length, claimedElsewhere, stopped: queueStopped });
  if (drained) console.log(`queue drained: earlier waves claimed all ${claimedElsewhere} row(s); this shard had nothing left to press (Q1689)`);
  if (gateMisses.length) {
    console.log(`GATE MISS: ${gateMisses.length} press(es) the gate let through tried to write (each aborted before it left):`);
    for (const g of gateMisses) console.log(`  - ${g.route} (${g.persona}) "${g.label}": ${g.requests.join(", ")}`);
  }
  if (gateMisses.length > 0 || failedPresses > 0 || undocumented > 0 || sessionDeaths.length > 0 || (totalFound === 0 && !drained) || uncoveredPersonas.length > 0 || notReached.length > 0) {
    console.log(`FAIL: ${failedPresses} failed press(es), ${undocumented} control(s) unpressed without a documented reason, ${sessionDeaths.length} session death(s), ${totalFound} control(s) found, ${uncoveredPersonas.length} persona(s) uncovered${uncoveredPersonas.length ? ` (${uncoveredPersonas.join(", ")})` : ""}, ${notReached.length} row(s) not reached (time budget)`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
