/**
 * Shared plumbing for the PROD audit suites (e2e/prod-audit/*): messy input
 * and deep-link / interruption journeys, driven against the deployed app as
 * the two shared test accounts (owner, 2026-09-12: "no mock mode ever").
 *
 * Sessions and contexts come from e2e/journeys/fixtures.ts (password grant in
 * CI, service-role magic link locally). Every write these suites cause lands
 * on rows the test accounts own and carries MARKER in its text, so
 * `cleanupMarked` can remove exactly what a run created.
 */
import type { APIRequestContext, BrowserContext, Locator, Page, Request, TestInfo } from "@playwright/test";
import { expect, test } from "../prodTest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findErrorScreen, readScreenText } from "../errorScreens";
import { isReadRpcPath } from "../readRpc";
import { measureLayout } from "../happy-path/auditRoutes";
import { ANON, SUPABASE_URL, getSession as journeySession, newUserContext, rest, type Role, type Session } from "../journeys/fixtures";

export { newUserContext, rest, SUPABASE_URL, ANON };
/** Q100: the funded open job fixture (a real Stripe TEST checkout as poster-e2e) — see fundedOpenJob.ts. */
export { ensureFundedOpenJob, retireFundedJob } from "./fundedOpenJob";
export { ensureFundedApplicantJob, retireApplicantFixtures } from "./fundedApplicantJob";
export type { Role, Session };

/** Every row a spec writes carries this in its text, so cleanup finds it. */
export const MARKER = "[E2E-PRODAUDIT]";

export const POSTER_ID = "71c56dfb-b326-4010-b960-b18dd3966e7f";
export const HELPER_ID = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

/** The four seeded accounts scripts/test-signin-link.mjs may mint for. */
export type Account = "poster" | "helper" | "incomplete" | "admin";
/**
 * A live session for any of the four accounts: the journeys' getSession, which
 * verifies every cached session against GoTrue (e2e/liveSession.ts) and
 * re-mints a revoked one. Measured 2026-09-13: a 40-minute-fresh but revoked
 * cache bounced a deep link to /login.
 */
export const sessionFor = (api: APIRequestContext, account: Account): Promise<Session> => journeySession(api, account);

/** Back-compat name used by the first two specs. */
export const getSession = (api: APIRequestContext, role: Role): Promise<Session> => sessionFor(api, role);

// ---------------------------------------------------------------------------
// Messy-input battery, shared by the URL sweep and the dialog explore.
// ---------------------------------------------------------------------------

export const XSS = `<img src=x onerror="window.__lhXss=1"><script>window.__lhXss=1</script>{{7*7}} ' OR 1=1; -- ../../etc/passwd`;
export const LONG_WORD = "Supercalifragilistic".repeat(10); // 200 chars, no break opportunity
export const WS = "   \t  ";
export const PASTE_5000 = "Lorem ipsum dolor sit amet. ".repeat(179).slice(0, 5000);
export const BATTERY: { tag: string; value: string; layout?: boolean }[] = [
  { tag: "empty", value: "" },
  { tag: "whitespace", value: WS },
  { tag: "paste-5000", value: PASTE_5000, layout: true },
  { tag: "long-word", value: LONG_WORD, layout: true },
  { tag: "multibyte", value: "Ça va 🦞🏠 日本 👨‍👩‍👧‍👦 مرحبا é", layout: true },
  { tag: "padded", value: "   padded value   " },
  { tag: "html-script", value: XSS, layout: true },
  { tag: "newlines", value: "line one\nline two\r\nline three" },
];
/** What a number field can hold: the browser refuses text into type=number. */
export const NUMBER_BATTERY: { tag: string; value: string }[] = [
  { tag: "empty", value: "" },
  { tag: "zero", value: "0" },
  { tag: "negative", value: "-5" },
  { tag: "decimal", value: "10.555" },
  { tag: "1e9", value: "1e9" },
];

export const TEXTLIKE =
  'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="search"], input[type="url"], input[type="password"], input[type="number"], textarea, [contenteditable="true"]';

/**
 * Names the explore never presses even behind the write firewall: they end the
 * session or the account.
 *
 * "Edit email" joins them, and the reason is the one already written beside
 * `EditEmailDialog.tsx` in GAPS: it rewrites an account's login address, and
 * every shared test account is a sign-in dependency for this whole suite. That
 * gap was written while the terms re-consent scrim was covering /admin, so
 * nothing was pressing the control and the decision cost nothing. With the
 * scrim gone the presser reaches it on the user-detail drawer — measured on
 * prod 2026-09-21, `explore: admin-people` swept "New email" and "Confirm new
 * email" — so the refusal has to be stated where the presser can read it, not
 * only in a comment.
 */
export const NEVER_PRESS = /sign ?out|log ?out|delete (my )?account|switch account|remove app|close account|edit email/i;
/** Chrome that is not a form: theme, menus, back, dismiss. */
export const SKIP_BUTTON = /back to|^back$|^close$|^×$|dismiss|skip|not now|toggle theme|dark mode|light mode|^menu$|open menu|notifications?$|^home$|^browse$|^messages$|^activity$|^profile$/i;

/**
 * WRITE FIREWALL for the button-pressing explore. Reads are the real backend;
 * every POST/PATCH/DELETE to Supabase (REST, functions, storage) is refused at
 * the wire and logged, because an indiscriminate presser on PROD must not be
 * able to cancel a job, ban a user or send an email by pressing the wrong
 * "Confirm". Token refresh passes, and so do the read RPCs `../readRpc.ts` classifies. Edge
 * functions are NEVER passed — `stripe-payouts` reads, `create-payment` moves
 * money, and one POST body does not tell them apart. Targeted specs never use
 * this: they make real writes on test-owned rows and clean them up.
 */
/**
 * THE ONE WRITE EVERY FIREWALL HAS TO LET THROUGH.
 *
 * `TermsReconsentDialog`'s acceptance — `PATCH /rest/v1/profiles` carrying
 * `terms_version_accepted` — is not an admin action, a money move or anything
 * a presser could stumble into: it is the tester's own consent record, on the
 * tester's own row, and it is the ONLY way out of a non-dismissible gate that
 * otherwise covers every screen behind it (see `clearConsentGate`).
 *
 * Refusing it is how run 35692221560 left `admin@louisianahelpr.com` at
 * `terms_version_accepted = ''` even after 26 admin loads: `admin-views.spec.ts`
 * installs its firewall on the CONTEXT before its first `goto`, so every
 * acceptance it pressed was aborted at the wire, and the run ended before an
 * unfirewalled spec could land one. A fix that only works in the specs that
 * happen to arm their firewall late is not a fix.
 *
 * Narrow on purpose: the method, the path AND the body must all match, so no
 * other `profiles` write — and nothing on any other table — is let through.
 */
export function isConsentAcceptance(method: string, pathname: string, body: string | null): boolean {
  return method === "PATCH" && /\/rest\/v1\/profiles$/.test(pathname) && !!body && body.includes("terms_version_accepted");
}

export async function writeFirewall(ctx: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const m = req.method();
    const { pathname } = new URL(req.url());
    if (m === "GET" || m === "HEAD" || m === "OPTIONS" || /\/auth\/v1\/(token|user|logout)/.test(req.url())) return route.continue();
    if (m === "POST" && isReadRpcPath(pathname)) return route.continue();
    if (isConsentAcceptance(req.method(), pathname, req.postData())) return route.continue();
    blocked.push(`${m} ${pathname} ${(req.postData() ?? "").slice(0, 300)}`);
    await route.abort("blockedbyclient").catch(() => {});
  });
  return blocked;
}

export async function fieldLabel(field: Locator): Promise<string> {
  return field.evaluate((el) => {
    const e = el as HTMLInputElement;
    const lbl = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent : null;
    return `${e.tagName.toLowerCase()}[${e.type || "text"}] ${(lbl || e.getAttribute("aria-label") || e.placeholder || e.name || e.id || "?").trim().slice(0, 40)}`;
  });
}

/** id / placeholder / aria-label / name of the field and its six nearest ancestors: matched against the inventory's literal hints. */
export async function fieldSignature(field: Locator): Promise<string[]> {
  return field.evaluate((el) => {
    const out: string[] = [];
    const take = (e: Element | null) => {
      if (!e) return;
      for (const a of ["id", "placeholder", "aria-label", "name"]) {
        const v = e.getAttribute(a);
        if (v) out.push(v);
      }
    };
    take(el);
    const lbl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (lbl?.textContent) out.push(lbl.textContent.trim());
    let p = el.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) take(p);
    return out;
  });
}

/** docs/audit/form-inventory.md → file → the literal hints the scanner extracted. */
export function inventoryHints(): Map<string, string[]> {
  const md = readFileSync(join(process.cwd(), "docs/audit/form-inventory.md"), "utf8");
  const m = new Map<string, string[]>();
  for (const row of md.matchAll(/^\| `(src\/[^`]+)` \|[^|]*\|[^|]*\|[^|]*\| (.*) \|$/gm)) {
    m.set(row[1], row[2].split(" · ").map((s) => s.replace(/\\\|/g, "|").trim()).filter((s) => s.length > 2));
  }
  return m;
}

export function inventoryFiles(): string[] {
  const md = readFileSync(join(process.cwd(), "docs/audit/form-inventory.md"), "utf8");
  return [...md.matchAll(/^\| `(src\/[^`]+)`/gm)].map((x) => x[1]);
}

export interface SweepResult {
  problems: string[];
  notes: string[];
}

/**
 * The whole battery into ONE field, with health after every value. Reports a
 * value longer than the field's own maxLength, a 5,000-char paste a field
 * without maxLength accepted (note), and anything `health` finds. Leaves the
 * field holding `leave` (default: empty).
 */
export async function sweepField(page: Page, field: Locator, ctx: string, opts: { leave?: string; shoot?: (name: string) => Promise<unknown>; baseline?: Baseline } = {}): Promise<SweepResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const type = await field.evaluate((e) => (e as HTMLInputElement).type ?? "text").catch(() => "text");
  const maxLen = await field.evaluate((e) => (e as HTMLInputElement).maxLength ?? -1).catch(() => -1);
  const values = type === "number" ? [...NUMBER_BATTERY] : [...BATTERY];
  if (type !== "number" && maxLen > 0 && maxLen < 100_000) {
    values.push({ tag: `max(${maxLen})`, value: "x".repeat(maxLen) }, { tag: `max+1(${maxLen + 1})`, value: "x".repeat(maxLen + 1) });
  }
  for (const v of values) {
    const c = `${ctx} › ${v.tag}`;
    const filled = await field.fill(v.value, { timeout: 3_000 }).then(() => true).catch((e) => {
      notes.push(`${c}: fill refused (${String(e).split("\n")[0].slice(0, 80)})`);
      return false;
    });
    if (!filled) continue;
    await field.press("Tab").catch(() => {});
    await page.waitForTimeout(60);
    const got = await field.inputValue().catch(() => null);
    if (maxLen > 0 && got !== null && got.length > maxLen) problems.push(`${c}: value length ${got.length} exceeds maxLength ${maxLen}`);
    if (maxLen <= 0 && v.tag === "paste-5000" && got?.length === 5000 && type !== "search") notes.push(`${c}: no maxLength — 5,000 chars accepted`);
    const p = await health(page, c, { layout: !!("layout" in v && v.layout), settleMs: 0, baseline: opts.baseline });
    if (p.length) {
      problems.push(...p);
      if (opts.shoot) await opts.shoot(`FAIL-${c}`);
    }
  }
  await field.fill(opts.leave ?? "").catch(() => {});
  return { problems, notes };
}

/** REST call as a test account. RLS decides what that account may touch; nothing here escalates. */
export async function restAs(api: APIRequestContext, s: Session, method: "get" | "post" | "patch" | "delete", pathAndQuery: string, data?: unknown) {
  // `return=representation` with no `select=` is RETURNING *, and
  // `authenticated` has no table-level SELECT on public.jobs — 109 of its 110
  // columns, `offered_to_helper_id` withheld (20260915045110, verified live
  // 2026-09-19). `*` then raises 42501 and PostgREST answers 403 WITHOUT
  // running the write. That is how press-every-control's teardown leaked 26
  // fixture jobs onto prod (#1582); every write caller here already passes
  // `&select=id`, and this makes the next one that forgets safe too.
  // RPC paths are left alone: `select=` on an rpc call is not a column list.
  const needsSelect = method !== "get" && !pathAndQuery.startsWith("rpc/") && !/[?&]select=/.test(pathAndQuery);
  const url = needsSelect ? `${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}select=id` : pathAndQuery;
  return api[method](`${SUPABASE_URL}/rest/v1/${url}`, {
    headers: rest(s, method === "get" ? {} : { Prefer: "return=representation" }),
    ...(data === undefined ? {} : { data }),
  });
}

export async function selectAs<T>(api: APIRequestContext, s: Session, pathAndQuery: string): Promise<T> {
  const r = await restAs(api, s, "get", pathAndQuery);
  expect(r.ok(), `select ${pathAndQuery}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as T;
}

/** Delete this run's rows: messages and applications carrying MARKER, as the account that owns them. */
export async function cleanupMarked(api: APIRequestContext, s: Session): Promise<string[]> {
  const removed: string[] = [];
  const enc = encodeURIComponent(`*${MARKER}*`);
  for (const [table, col] of [["messages", "content"], ["applications", "message"]] as const) {
    const r = await restAs(api, s, "delete", `${table}?${col}=like.${enc}&select=id`);
    if (r.ok()) {
      const rows = (await r.json()) as { id: string }[];
      removed.push(...rows.map((x) => `${table}/${x.id}`));
    }
  }
  return removed;
}

/**
 * Loading states that are DESIGNED, bounded and not this step's fault. The job
 * map preview pulses grey while Apple's 807KB MapKit script and its geocode
 * run, under its own 15s watchdog that ends in "Map preview isn't available
 * right now" (JobLocationPreview.tsx) — so it is a legitimate transient, not a
 * screen that never finished. It is asserted directly by the deep-link specs.
 */
const DESIGNED_LOADERS = '[aria-label="Loading map"]';

/** detectStuckOrBlank, minus the designed loaders above. */
function stuckIgnoringDesignedLoaders(ignore: string): string | null {
  const text = (document.body?.innerText ?? "").trim();
  if (text.length < 20) return `blank page (${text.length} chars of text)`;
  if (document.getElementById("boot-loader")) return "boot loader still showing";
  const skip = (e: Element) => e.closest("[aria-hidden='true']") || (ignore && e.closest(ignore));
  const busy = [...document.querySelectorAll('[aria-busy="true"]')].filter((e) => !skip(e)).length;
  const pulses = [...document.querySelectorAll('[class*="animate-pulse"]')].filter((e) => !skip(e)).length;
  if (busy || pulses) return `still loading (${busy} aria-busy, ${pulses} skeleton pulses)`;
  return null;
}

/**
 * The post-action assertion set: no error screen, not stuck/blank, typed
 * markup never executed, and (when asked) zero horizontal overflow.
 */
export async function health(page: Page, ctx: string, opts: { layout?: boolean; allow?: string[]; settleMs?: number; baseline?: Baseline } = {}): Promise<string[]> {
  const problems: string[] = [];
  // A loader is only "stuck" once a real user's patience has run out.
  const deadline = Date.now() + (opts.settleMs ?? 8_000);
  let stuck: string | null;
  for (;;) {
    stuck = await page.evaluate(stuckIgnoringDesignedLoaders, DESIGNED_LOADERS).catch(() => "page not evaluable");
    if (!stuck || Date.now() > deadline) break;
    await page.waitForTimeout(300);
  }
  // A screen element that was ALREADY loading before this step (the job-detail
  // map preview has its own 15s watchdog) is not something this step broke.
  // Typing must not INTRODUCE a stuck state; that is what is asserted.
  if (stuck && stuck !== opts.baseline?.stuck) problems.push(`${ctx}: ${stuck}`);
  // Quoted log text ([data-quoted-log], e.g. the admin health alert list) is
  // excluded by findErrorScreen when handed readScreenText's result (Q101).
  const screen = await page.evaluate(readScreenText).catch(() => ({ text: "", quoted: [] as string[] }));
  const err = findErrorScreen(screen, opts.allow ?? []);
  if (err) problems.push(`${ctx}: error screen "${err.name}" — ${err.excerpt}`);
  // A screen measured through a non-dismissible scrim was not measured. See
  // `clearConsentGate`: without this, the whole admin half of the suite counted
  // zero fields, credited zero files and reported PASS (prod, 2026-09-21).
  if (await consentGate(page).count().catch(() => 0)) {
    problems.push(
      `${ctx}: the terms re-consent gate is covering the screen, so nothing behind it was measured. ` +
        `clearConsentGate() could not clear it — the account under test has a profiles.terms_version_accepted ` +
        `behind LATEST_TERMS_VERSION and the acceptance write did not land (a write firewall refuses it).`,
    );
  }
  const xss = await page
    .evaluate(() => ({ ran: (window as unknown as { __lhXss?: number }).__lhXss ?? 0, img: document.querySelectorAll('img[src="x"]').length }))
    .catch(() => ({ ran: 0, img: 0 }));
  if (xss.ran || xss.img) problems.push(`${ctx}: typed markup EXECUTED/INJECTED (ran=${xss.ran}, img=${xss.img})`);
  if (opts.layout) {
    const l = await measureLayout(page).catch(() => null);
    if (l && (l.overflowPx > 0 || l.overflowOffenders.length)) {
      problems.push(`${ctx}: horizontal overflow ${l.overflowPx}px — ${l.overflowOffenders.slice(0, 3).join(" | ")}`);
    }
  }
  return problems;
}

/** What the screen already looked like before a step, so a step is judged on what it CHANGED. */
export interface Baseline {
  stuck: string | null;
}

export async function baselineOf(page: Page): Promise<Baseline> {
  return { stuck: await page.evaluate(stuckIgnoringDesignedLoaders, DESIGNED_LOADERS).catch(() => null) };
}

/** Screenshot to disk under the test's output dir AND attach it, so a human can open and LOOK. */
export async function shoot(page: Page, info: TestInfo, name: string): Promise<string> {
  const safe = name.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);
  const path = info.outputPath(`${safe}.png`);
  await page.screenshot({ path, fullPage: false }).catch(() => {});
  await info.attach(`${safe}.png`, { path, contentType: "image/png" }).catch(() => {});
  return path;
}

/** Health check that fails the step, with a screenshot named after it. */
export async function assertHealthy(page: Page, info: TestInfo, step: string, opts: { layout?: boolean; allow?: string[]; settleMs?: number } = {}): Promise<void> {
  const problems = await health(page, step, { layout: true, ...opts });
  await shoot(page, info, problems.length ? `FAIL-${step}` : step);
  expect(problems, `[${step}] at ${page.url()}\n${problems.join("\n")}`).toEqual([]);
}

/**
 * Collect WRITES to URLs matching `re` from now on.
 *
 * HEAD is a read: PostgREST answers a count query with HEAD, and the apply flow
 * fires three of them right after applying. Counting those as writes made a
 * single application look like four (measured 2026-09-13) — which is exactly
 * how a double-submit check gets muted for crying wolf.
 */
export function watchWrites(page: Page, re: RegExp): Request[] {
  const hits: Request[] = [];
  const READ = new Set(["GET", "HEAD", "OPTIONS"]);
  page.on("request", (r) => {
    if (!READ.has(r.method()) && re.test(r.url())) hits.push(r);
  });
  return hits;
}

/**
 * Wait for the SPA to settle after a navigation: boot loader gone, network quiet.
 *
 * Plus a deploy-in-flight guard. When a lazy chunk 404s because a new build
 * landed mid-navigation, the app recovers itself (chunkReload.ts): it drops the
 * service worker and caches and reloads with `?_v=<now>`. Until Q199
 * (2026-09-23) its 10s guard then refused a second reload, so a reload that
 * landed on a half-propagated deploy showed an error screen — measured on prod
 * 2026-09-13 at /messages/a/b/c. It now retries quietly on
 * CHUNK_RELOAD_SCHEDULE_MS; either way the `?_v=` URL is a deploy artifact,
 * not the screen under test, so once (and only once) we let the recovery
 * finish and reload.
 */
export async function settle(page: Page, ms = 600): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForFunction(() => !document.getElementById("boot-loader"), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(ms);
  if (new URL(page.url()).searchParams.has("_v")) {
    test.info().annotations.push({ type: "stale-bundle", description: `the app recovered from a stale chunk at ${page.url()}` });
    await page.waitForTimeout(3_000);
    const clean = new URL(page.url());
    clean.searchParams.delete("_v");
    await page.goto(clean.toString());
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForFunction(() => !document.getElementById("boot-loader"), null, { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(ms);
  }
  // Last, so it sees the screen the spec is about to measure. A no-op on every
  // load whose account is current — which, after the first clear, is all of
  // them. See `clearConsentGate`.
  await clearConsentGate(page).catch(() => false);
}

/**
 * THE RE-CONSENT GATE IS NOT "THE SCREEN" — CLEAR IT, OR SAY SO OUT LOUD.
 *
 * `TermsReconsentDialog` (src/components/TermsReconsentDialog.tsx) opens on
 * EVERY authed load whose profile row carries a `terms_version_accepted` behind
 * `LATEST_TERMS_VERSION`, and it is deliberately non-dismissible: "I Agree" is
 * the only way out, Escape does nothing, and Radix leaves everything behind it
 * `aria-hidden` with `pointer-events: none`.
 *
 * MEASURED ON PROD, run 35559129731 (2026-09-21). The account behind
 * `PLAYWRIGHT_ADMIN_EMAIL` is not one of the seed accounts, so
 * scripts/audit/prod-seed.mjs — which pre-accepts the current Terms on every
 * row it writes — never touched it, and its row still read
 * `terms_version_accepted = ''`. This gate therefore covered all twenty-one
 * admin screens of that run:
 *
 *   - `sweep: admin-referrals` counted ZERO visible text-like fields and
 *     reported "the form did not render" — of a form that had rendered
 *     perfectly behind the scrim. Its own error-context snapshot shows the
 *     stat tiles, the tab strip and the Overview panel, with the alertdialog
 *     stacked on top.
 *   - the twenty admin EXPLORES pressed nothing, swept nothing, credited
 *     nothing — and reported PASS. Eighteen admin dialogs then landed in the
 *     coverage test's "no sweep, no explore credit and no stated gap" list,
 *     where they read as missing tests rather than as blocked ones.
 *
 * That is the defect class, and it is a vacuity class: one full-screen gate
 * turns a driving suite into a silent no-op that still reports green. Two
 * halves, both needed —
 *
 *   1. PRESS THE GATE'S OWN BUTTON, exactly as the operator whose account this
 *      is would. Called from `settle`, so it runs on every navigation and, for
 *      the sweep and the explore alike, BEFORE `writeFirewall` goes up — the
 *      acceptance is a real write, it lands, and the account is clear for the
 *      rest of the run and every run after it. Version-agnostic: the next bump
 *      of LATEST_TERMS_VERSION heals itself the same way.
 *   2. `health()` FAILS ON A GATE IT COULD NOT CLEAR (below), so a screen
 *      measured through a scrim can never again be scored as measured.
 */
export function consentGate(page: Page): Locator {
  return page
    .locator('[role="alertdialog"], [role="dialog"]')
    .filter({ hasText: /take a moment to re-?agree/i })
    .filter({ visible: true })
    .first();
}

/**
 * Pages this process has already given the gate its grace period. The gate
 * mounts only once the profiles read resolves, so the FIRST load of a context
 * is worth waiting on; every later navigation on the same page is not, and
 * paying that wait on all of them would add minutes to a run that reloads
 * after every press. `health()` is the backstop for a late one.
 */
const gateWaited = new WeakSet<Page>();

/** Press "I Agree" on the re-consent gate if it is up. True when one was cleared. */
export async function clearConsentGate(page: Page, appearMs = 2_500): Promise<boolean> {
  const gate = consentGate(page);
  if (appearMs > 0 && !gateWaited.has(page)) {
    gateWaited.add(page);
    await gate.waitFor({ state: "visible", timeout: appearMs }).catch(() => {});
  }
  if (!(await gate.count().catch(() => 0))) return false;
  const agree = gate.getByRole("button", { name: /^i agree$/i }).first();
  if (!(await agree.isVisible().catch(() => false))) return false;
  await agree.click({ timeout: 5_000 }).catch(() => {});
  // The dialog stays up while the write runs (TermsReconsentDialog keeps it
  // open on purpose), so wait for it to go rather than for the click.
  //
  // Bounded, because one caller cannot clear it and must not pay for trying:
  // `admin-views.spec.ts` installs its own write firewall on the CONTEXT before
  // its first goto, so the acceptance PATCH is refused there and the gate stays
  // up for all 26 of its views. That is survivable (it asserts the landed path
  // and the error-screen list, neither of which the gate touches) and it is
  // self-limiting — `deep-links.spec.ts` runs three spec files later with no
  // firewall and clears it for the rest of the run — but a 20s wait × 26 views
  // is six minutes of a 300-minute budget spent waiting for a write that was
  // refused before it left the page.
  const gone = await gate
    .waitFor({ state: "hidden", timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  test.info().annotations.push({
    type: "consent-gate",
    description: `${gone ? "cleared" : "STILL UP after pressing I Agree"} at ${page.url()}`,
  });
  return gone;
}

/** Dismiss the onboarding tour / birthday / any stray modal that is not the one under test. */
export async function dismissChrome(page: Page): Promise<void> {
  const b = page.getByRole("button", { name: /skip tour|^skip$|not now|maybe later|got it/i }).filter({ visible: true }).first();
  if (await b.isVisible().catch(() => false)) await b.click({ timeout: 2_000 }).catch(() => {});
}

/** Real seeded records the specs open dialogs from. Resolved live, never hard-coded, so a reseed cannot strand a spec. */
export interface Fixtures {
  /** An open, escrowed job posted by poster-e2e that helper-e2e has NOT applied to (apply target). */
  openJob: { id: string; title: string } | null;
  /** A job in progress between the two accounts (complete / dispute / cancel dialogs). */
  inProgressJob: { id: string; title: string } | null;
  /** A job the poster has open with a pending application from helper-e2e (applicants panel). */
  jobWithPendingApplicant: { id: string; title: string } | null;
  /** A disputed job between the two (dispute timeline). */
  disputedJob: { id: string; title: string } | null;
  /** A completed job between the two (review form). */
  completedJob: { id: string; title: string } | null;
  /** A job with an existing message thread between the two accounts (thread deep link). */
  threadJob: { id: string; title: string } | null;
  /**
   * HELPER-SIDE FIXTURES, from ANY poster — the helper's own assigned jobs,
   * read as the helper. The three above are all poster-e2e's jobs, and three
   * helper-card states live only on jobs the seeded pairs posted
   * (`5eed0a10-…` rows, is_seed): a job the helper CONFIRMED but has not left
   * for (ActiveJobSection's "Cancel Job" → abort-reason box), one the helper
   * is on the way to or working (its "Report a problem" chip → DisputeDialog),
   * and a dispute the OTHER side filed (DisputedSection's "Respond to
   * Dispute" box). Measured on prod 2026-09-23: poster-e2e had no disputed
   * job at all, which is exactly what the sweep reported, while the helper
   * was assigned one. Titles are picked unique among the helper's own jobs,
   * because a card is opened by its title and five lifecycle rows share one.
   */
  helperConfirmedJob: { id: string; title: string } | null;
  helperEnRouteJob: { id: string; title: string } | null;
  helperDisputedJob: { id: string; title: string } | null;
  /** A job id that does not exist. */
  goneJobId: string;
}

export async function resolveFixtures(api: APIRequestContext, poster: Session, helper: Session): Promise<Fixtures> {
  type J = { id: string; title: string; status: string; payment_status: string; helper_id: string | null };
  const jobs = await selectAs<J[]>(api, poster, `jobs?customer_id=eq.${poster.user.id}&select=id,title,status,payment_status,helper_id&order=created_at.desc&limit=200`);
  const apps = await selectAs<{ job_id: string; status: string }[]>(api, helper, `applications?helper_id=eq.${helper.user.id}&select=job_id,status`);
  const appliedIds = new Set(apps.map((a) => a.job_id));
  const msgs = await selectAs<{ job_id: string; sender_id: string; receiver_id: string }[]>(
    api, helper, `messages?select=job_id,sender_id,receiver_id&or=(sender_id.eq.${helper.user.id},receiver_id.eq.${helper.user.id})&order=created_at.desc&limit=100`,
  );
  const threadJobIds = new Set(msgs.filter((m) => m.sender_id === poster.user.id || m.receiver_id === poster.user.id).map((m) => m.job_id));
  const pick = (f: (j: J) => boolean) => {
    const j = jobs.find(f);
    return j ? { id: j.id, title: j.title } : null;
  };
  type H = {
    id: string; title: string; status: string; disputed_at: string | null; disputed_by: string | null; dispute_helper_response: string | null;
    helper_confirmed_at: string | null; helper_on_the_way_at: string | null; helper_completed_at: string | null; poster_completed_at: string | null;
  };
  const mine = await selectAs<H[]>(
    api, helper,
    `jobs?helper_id=eq.${helper.user.id}&status=in.(in_progress,disputed)&select=id,title,status,disputed_at,disputed_by,dispute_helper_response,helper_confirmed_at,helper_on_the_way_at,helper_completed_at,poster_completed_at&order=created_at.desc&limit=200`,
  );
  const titleCount = new Map<string, number>();
  for (const j of mine) titleCount.set(j.title, (titleCount.get(j.title) ?? 0) + 1);
  const pickMine = (f: (j: H) => boolean) => {
    const j = mine.find((x) => titleCount.get(x.title) === 1 && f(x));
    return j ? { id: j.id, title: j.title } : null;
  };
  const live = (j: H) => j.status === "in_progress" && !j.disputed_at && !j.helper_completed_at && !j.poster_completed_at;
  return {
    openJob: pick((j) => j.status === "open" && j.payment_status === "escrow" && !appliedIds.has(j.id)),
    inProgressJob: pick((j) => j.status === "in_progress" && j.helper_id === helper.user.id),
    jobWithPendingApplicant: pick((j) => j.status === "open" && apps.some((a) => a.job_id === j.id && a.status === "pending")),
    disputedJob: pick((j) => j.status === "disputed" && j.helper_id === helper.user.id),
    completedJob: pick((j) => j.status === "completed" && j.helper_id === helper.user.id),
    threadJob: pick((j) => threadJobIds.has(j.id)),
    helperConfirmedJob: pickMine((j) => live(j) && !!j.helper_confirmed_at && !j.helper_on_the_way_at),
    helperEnRouteJob: pickMine((j) => live(j) && !!j.helper_on_the_way_at),
    helperDisputedJob: pickMine((j) => j.status === "disputed" && !!j.disputed_by && j.disputed_by !== helper.user.id && !j.dispute_helper_response),
    goneJobId: "00000000-0000-4000-8000-00000000dead",
  };
}

/**
 * LIVE STATE FOR `messyInputForms.ts`'s `prepare` STEPS, not a config object.
 *
 * `FORMS` is a plain array literal evaluated at module import — before
 * `messy-input.spec.ts`'s `beforeAll` has resolved a single session or
 * fixture — so a `FormSpec`'s `url` can never hold a real job id or a real
 * account's user id. Its `prepare(page)` callback runs at TEST time, safely
 * after `beforeAll`, so `prepare` bodies read this box instead: populate it
 * once fixtures and sessions exist, then let every `prepare` that needs a
 * dynamic id (a message thread, a profile to report, an admin's search
 * target) call `page.goto` itself with the real value, rather than the sweep
 * ever hard-coding a job id that a reseed or a completed lifecycle run can
 * change out from under it.
 */
export const runtime: {
  fixtures: Fixtures | null;
  userId: Partial<Record<Account, string>>;
  email: Partial<Record<Account, string>>;
  /** Q100: the funded open job of poster-e2e with helper-e2e's PENDING application (fundedApplicantJob.ts). */
  applicantJob: { id: string; title: string } | null;
} = {
  fixtures: null,
  userId: {},
  email: {},
  applicantJob: null,
};

/**
 * SERVICE ROLE, ONLY TO UNDO WHAT A SPEC CREATED. Read from `.env`, which
 * exists locally and — for the length of the test step — in prod-audit.yml
 * ("Provide the service-role key to the seeded-account minter"). Used by
 * `ensureMessyInputState`'s cleanup for rows no test account may delete
 * (`reports` and `helper_credentials` have no DELETE policy for anyone), and
 * by nothing else. Null when there is no key: then nothing is created that
 * could not be removed.
 */
function serviceRoleKey(): string | null {
  try {
    const m = /^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m.exec(readFileSync(join(process.cwd(), ".env"), "utf8"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    // No .env (a CI job that never minted the key): null is the documented
    // answer, and every caller then creates nothing it could not remove.
    return null;
  }
}

/** A 1×1 PNG — the same fixture document scripts/audit/prod-seed.mjs uses for avatars and ID photos. */
const SEED_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * THE ADMIN QUEUES THE MESSY-INPUT SWEEP OPENS A DIALOG FROM MUST HOLD A ROW
 * THE DIALOG CAN OPEN ON — make sure they do, on test-owned records, and hand
 * back the undo.
 *
 * - Reports: "Message <name>" renders only on a report that is new/pending or
 *   investigating (AdminReports.tsx). If prod holds none, the shared poster
 *   files one against the shared helper, carrying MARKER, deleted afterwards
 *   with the service role (no role may delete a report through RLS).
 * - Credentials: "Reject" renders only on a pending credential that HAS a
 *   document (`license_status === "pending" && license_url`). Measured on
 *   prod 2026-09-23: the queue's only row was the helper's seeded
 *   `trade_license`, `submitted` with `document_url` NULL — a queue row with
 *   no Approve and no Reject on it. Migration 20260923101130 (Q102) then added
 *   `helper_credentials_pending_review_needs_document`: a trade_license /
 *   insurance row in unverified/submitted can no longer exist without a
 *   document, so ANY row this query returns already has one — "attach a
 *   document to a document-less pending row" is a state prod refuses to
 *   create, and its old undo (setting `document_url` back to NULL) would be
 *   refused too. When the helper holds no pending credential at all, it
 *   submits one WITH a document (INSERT → the trigger forces status
 *   'submitted', the CHECK requires the document up front) and the service
 *   role deletes it afterwards.
 *
 * Returns what it did (for the report annotation) and an undo that never
 * throws, so a teardown failure cannot mask the sweep's own result.
 */
export async function ensureMessyInputState(
  api: APIRequestContext,
  s: { poster: Session; helper: Session; admin: Session },
): Promise<{ did: string[]; undo: (api: APIRequestContext) => Promise<string[]> }> {
  const did: string[] = [];
  // Each undo runs on the API context it is HANDED: Playwright refuses to
  // reuse beforeAll's `request` in afterAll (measured, first local run: the
  // restore threw "Fixture { request } from beforeAll cannot be reused").
  const undo: Array<(a: APIRequestContext) => Promise<string>> = [];
  const svc = serviceRoleKey();
  const svcDelete = async (a: APIRequestContext, table: string, id: string) => {
    if (!svc) return `${table}/${id}: NOT removed (no service-role key)`;
    const r = await a.delete(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
    return `${table}/${id}: ${r.ok() ? "removed" : `NOT removed (${r.status()})`}`;
  };

  const open = await selectAs<{ id: string }[]>(api, s.admin, `reports?status=in.(pending,new,investigating)&select=id&limit=1`);
  if (!open.length && svc) {
    const r = await restAs(api, s.poster, "post", "reports", {
      reporter_id: s.poster.user.id, reported_id: s.helper.user.id, reported_type: "user", reason: "Something else",
      description: `${MARKER} messy-input admin-reports fixture — never acted on`,
    });
    expect(r.ok(), `seed an open report: ${r.status()} ${await r.text()}`).toBe(true);
    const id = ((await r.json()) as { id: string }[])[0].id;
    did.push(`created report ${id}`);
    undo.push((a) => svcDelete(a, "reports", id));
  }

  type C = { id: string; status: string; document_url: string | null };
  const creds = await selectAs<C[]>(
    api, s.helper,
    `helper_credentials?user_id=eq.${s.helper.user.id}&credential_type=in.(trade_license,insurance)&status=in.(unverified,submitted)&select=id,status,document_url`,
  );
  if (creds.length) {
    // helper_credentials_pending_review_needs_document (Q102) guarantees every
    // row this query can return already carries a document — there is no
    // document-less pending row left to patch, so a reviewable row already
    // exists and there is nothing to do.
  } else if (svc) {
    // Q130: document_url must be the helper's OWN uploaded user-documents
    // object, `<uid>/credentials/trade_license-<13 digits>.<ext>`
    // (trg_helper_credential_document_is_own) — a data: URL is refused. So the
    // helper uploads the pixel first, exactly as a member would, then submits.
    // Undo order: the row (service role), THEN the object — while a row names
    // it the member cannot delete it (is_submitted_credential_object).
    const svcKey: string = svc;
    const docPath = `${s.helper.user.id}/credentials/trade_license-${Date.now()}.png`;
    const up = await api.post(`${SUPABASE_URL}/storage/v1/object/user-documents/${docPath}`, {
      headers: rest(s.helper, { "Content-Type": "image/png", "x-upsert": "false" }),
      data: Buffer.from(SEED_PIXEL.split(",")[1], "base64"),
    });
    expect(up.ok(), `upload a fixture credential document: ${up.status()} ${await up.text()}`).toBe(true);
    const r = await restAs(api, s.helper, "post", "helper_credentials", {
      user_id: s.helper.user.id, credential_type: "trade_license", trade_category: "handyman",
      license_number: `${MARKER} messy-input`, license_state: "LA", document_url: docPath,
    });
    expect(r.ok(), `submit a fixture credential: ${r.status()} ${await r.text()}`).toBe(true);
    const id = ((await r.json()) as { id: string }[])[0].id;
    did.push(`submitted credential ${id}`);
    undo.push(async (a) => {
      const row = await svcDelete(a, "helper_credentials", id);
      const del = await a.delete(`${SUPABASE_URL}/storage/v1/object/user-documents`, {
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, "Content-Type": "application/json" },
        data: { prefixes: [docPath] },
      });
      return `${row}; user-documents/${docPath}: ${del.ok() ? "removed" : `NOT removed (${del.status()})`}`;
    });
  }

  return {
    did,
    // The undo mints FRESH sessions (sessionFor re-verifies and re-mints): a
    // full run is ~55 minutes, and the helper's beforeAll token had expired by
    // the time the first full local run restored the credential (401, measured).
    undo: async (a: APIRequestContext) => {
      const out: string[] = [];
      for (const u of undo.reverse()) out.push(await u(a).catch((e) => `undo failed: ${String(e).slice(0, 120)}`));
      return out;
    },
  };
}
