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
import { expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findErrorScreen } from "../errorScreens";
import { measureLayout } from "../happy-path/auditRoutes";
import { ANON, SUPABASE_URL, getSession as journeySession, newUserContext, rest, type Role, type Session } from "../journeys/fixtures";

export { newUserContext, rest, SUPABASE_URL, ANON };
export type { Role, Session };

/** Every row a spec writes carries this in its text, so cleanup finds it. */
export const MARKER = "[E2E-PRODAUDIT]";

export const POSTER_ID = "71c56dfb-b326-4010-b960-b18dd3966e7f";
export const HELPER_ID = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

/** The four seeded accounts scripts/test-signin-link.mjs may mint for. */
export type Account = "poster" | "helper" | "incomplete" | "admin";
const MINT_NAME: Record<Account, string> = { poster: "poster-e2e", helper: "helper-e2e", incomplete: "incomplete-e2e", admin: "admin-e2e" };
const CACHE_DIR = join(process.cwd(), "node_modules", ".cache", "lh-journeys");
const memo = new Map<Account, Session>();

/** GoTrue's own answer: a JWT that PostgREST still accepts is dead once the session row is revoked (403). */
async function sessionAlive(api: APIRequestContext, s: Session): Promise<boolean> {
  const r = await api.get(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${s.access_token}` } });
  return r.ok();
}

function mint(account: Account): Session {
  const out = execFileSync("node", [join(process.cwd(), "scripts/test-signin-link.mjs"), MINT_NAME[account], "--session", "--json"], { cwd: process.cwd(), encoding: "utf8" });
  return (JSON.parse(out) as { session: Session }).session;
}

/**
 * A live session for any of the four accounts. poster/helper go through the
 * journeys' getSession (password grant in CI, magic-link mint locally) and are
 * then VERIFIED against /auth/v1/user: a global sign-out elsewhere revokes the
 * session while its cached JWT still passes PostgREST, and the app signs the
 * tab out at its first getUser() — measured 2026-09-13 as "deep link bounced
 * to /login" with a 40-minute-fresh cache. A dead cache is deleted and re-minted.
 * incomplete/admin are mint-only (no password secrets exist for them), cached
 * on disk like the journeys do so GoTrue's magic-link rate limit is not hit.
 */
export async function sessionFor(api: APIRequestContext, account: Account): Promise<Session> {
  const m = memo.get(account);
  if (m && (m.expires_at ?? 0) * 1000 > Date.now() + 10 * 60_000 && (await sessionAlive(api, m))) return m;
  let s: Session;
  if (account === "poster" || account === "helper") {
    s = await journeySession(api, account);
    if (!(await sessionAlive(api, s))) {
      rmSync(join(CACHE_DIR, `${account}.json`), { force: true });
      s = await journeySession(api, account, true);
      expect(await sessionAlive(api, s), `${account}: even a freshly obtained session is refused by /auth/v1/user`).toBe(true);
    }
  } else {
    const file = join(CACHE_DIR, `${MINT_NAME[account]}.json`);
    let disk: Session | null = null;
    if (existsSync(file)) {
      try {
        disk = JSON.parse(readFileSync(file, "utf8")) as Session;
      } catch {
        // A corrupt cache file is a cache miss: mint below.
        disk = null;
      }
    }
    if (disk && (disk.expires_at ?? 0) * 1000 > Date.now() + 20 * 60_000 && (await sessionAlive(api, disk))) s = disk;
    else {
      s = mint(account);
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(s), { mode: 0o600 });
    }
  }
  memo.set(account, s);
  return s;
}

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

/** Names the explore never presses even behind the write firewall: they end the session or the account. */
export const NEVER_PRESS = /sign ?out|log ?out|delete (my )?account|switch account|remove app|close account/i;
/** Chrome that is not a form: theme, menus, back, dismiss. */
export const SKIP_BUTTON = /back to|^back$|^close$|^×$|dismiss|skip|not now|toggle theme|dark mode|light mode|^menu$|open menu|notifications?$|^home$|^browse$|^messages$|^activity$|^profile$/i;

/**
 * WRITE FIREWALL for the button-pressing explore. Reads are the real backend;
 * every POST/PATCH/DELETE to Supabase (REST, RPC, functions, storage) is
 * refused at the wire and logged, because an indiscriminate presser on PROD
 * must not be able to cancel a job, ban a user or send an email by pressing
 * the wrong "Confirm". Token refresh passes. Targeted specs never use this:
 * they make real writes on test-owned rows and clean them up.
 */
export async function writeFirewall(ctx: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const m = req.method();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS" || /\/auth\/v1\/(token|user|logout)/.test(req.url())) return route.continue();
    blocked.push(`${m} ${new URL(req.url()).pathname} ${(req.postData() ?? "").slice(0, 300)}`);
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
  return api[method](`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
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
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  const err = findErrorScreen(text, opts.allow ?? []);
  if (err) problems.push(`${ctx}: error screen "${err.name}" — ${err.excerpt}`);
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

/** Collect non-GET requests to URLs matching `re` from now on. */
export function watchWrites(page: Page, re: RegExp): Request[] {
  const hits: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "OPTIONS" && re.test(r.url())) hits.push(r);
  });
  return hits;
}

/** Wait for the SPA to settle after a navigation: boot loader gone, network quiet. */
export async function settle(page: Page, ms = 600): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForFunction(() => !document.getElementById("boot-loader"), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(ms);
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
  return {
    openJob: pick((j) => j.status === "open" && j.payment_status === "escrow" && !appliedIds.has(j.id)),
    inProgressJob: pick((j) => j.status === "in_progress" && j.helper_id === helper.user.id),
    jobWithPendingApplicant: pick((j) => j.status === "open" && apps.some((a) => a.job_id === j.id && a.status === "pending")),
    disputedJob: pick((j) => j.status === "disputed" && j.helper_id === helper.user.id),
    completedJob: pick((j) => j.status === "completed" && j.helper_id === helper.user.id),
    threadJob: pick((j) => threadJobIds.has(j.id)),
    goneJobId: "00000000-0000-4000-8000-00000000dead",
  };
}
