import {
  test as base,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readLiveCache, sessionAlive, writeCache } from "../liveSession";
import { detectStuckOrBlank, findErrorScreen } from "../errorScreens";
import { deviceProfile, type Rotation } from "./scenarios";

/**
 * Shared plumbing for the USER JOURNEY suite (e2e/journeys/*).
 *
 * The journeys drive this checkout's LOCAL build (playwright.config.ts's
 * baseURL; never the deployed site, which costs Vercel edge requests — see
 * src/test/noTestTrafficOnVercel.test.ts) against the REAL backend with the
 * two shared E2E accounts: the same pair,
 * title marker, sweeper and Stripe tripwire as e2e/prod-lifecycle.spec.ts.
 *
 * SESSIONS. Two sources, and neither changes a credential:
 *   1. CI: PLAYWRIGHT_POSTER_EMAIL/_PASSWORD + PLAYWRIGHT_HELPER_EMAIL/_PASSWORD
 *      -> GoTrue password grant (exactly what prod-lifecycle does).
 *   2. Local: no passwords on this machine, so scripts/test-signin-link.mjs
 *      --session --json mints a one-time magic-link session from .env's
 *      service-role key. It is allowlisted to the seeded test accounts and
 *      never touches the password.
 * If neither is available every journey skips with that reason stated.
 */

export const SUPABASE_URL = (process.env.PLAYWRIGHT_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
export const ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";
export const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

/** Shared with prod-lifecycle and its sweeper, which finds rows by it. */
export const E2E_TITLE_MARKER = "[E2E DO NOT ACCEPT]";

export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * poster/helper are the two shared journey accounts (required). admin and
 * incomplete are the seed accounts scripts/audit/prod-seed.mjs owns (admin
 * role → /admin; avatar-less profile → /complete-profile renders); optional,
 * see optionalSession.
 */
export type Role = "poster" | "helper" | "admin" | "incomplete";
export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  token_type?: string;
  user: { id: string; email?: string };
};

const REPO_ROOT = process.cwd();

function envCreds(role: Role) {
  // PLAYWRIGHT_POSTER_EMAIL, PLAYWRIGHT_ADMIN_PASSWORD, … — the CI secrets.
  const key = role.toUpperCase();
  const email = process.env[`PLAYWRIGHT_${key}_EMAIL`];
  const password = process.env[`PLAYWRIGHT_${key}_PASSWORD`];
  return email && password ? { email, password } : null;
}

/** Can getSession(role) succeed here? Password secret in CI, or a local .env to mint from. */
export function sessionAvailable(role: Role): boolean {
  return Boolean(envCreds(role)) || (!process.env.CI && existsSync(join(REPO_ROOT, ".env")));
}

/** getSession for an optional account: null (never a throw) when it cannot be signed in here. */
export async function optionalSession(api: APIRequestContext, role: Role): Promise<Session | null> {
  return sessionAvailable(role) ? getSession(api, role) : null;
}

export function sessionsAvailable(): { ok: boolean; why: string } {
  if (envCreds("poster") && envCreds("helper")) return { ok: true, why: "password grant" };
  if (!process.env.CI && existsSync(join(REPO_ROOT, ".env"))) return { ok: true, why: "local magic-link mint" };
  return {
    ok: false,
    why:
      "No session source: set PLAYWRIGHT_POSTER_EMAIL/_PASSWORD + PLAYWRIGHT_HELPER_EMAIL/_PASSWORD, " +
      "or run locally with .env (service-role) so scripts/test-signin-link.mjs can mint one.",
  };
}

const sessionCache = new Map<Role, Session>();

export async function getSession(api: APIRequestContext, role: Role, fresh = false): Promise<Session> {
  const isAlive = (s: Session) => sessionAlive(SUPABASE_URL, ANON, s.access_token);
  const cached = sessionCache.get(role);
  if (!fresh && cached && (cached.expires_at ?? 0) * 1000 > Date.now() + 10 * 60_000 && (await isAlive(cached))) return cached;
  sessionCache.delete(role);
  const creds = envCreds(role);
  let session: Session;
  if (creds) {
    /**
     * THE SUITE'S OWN SIGN-IN NEEDS HEADROOM AND A SECOND CHANCE.
     *
     * This POST inherited `actionTimeout` — 20s for the prod-audit project —
     * with no retry, and one slow grant does not fail one test: it fails the
     * spec file's `beforeAll`, and every test in that file is reported "did
     * not run". Measured twice on 2026-09-22: run 35692221560 lost 29 tests
     * that way, and 35695851818 lost 103 — the whole of messy-input.spec.ts —
     * to a single timed-out grant at 06:52.
     *
     * It is not that GoTrue is down. Prod's own `auth_logs` for that minute
     * show the password grants COMPLETING, at p50 1.71s and max 10.18s (11.01s
     * the minute before, against 0.24-0.79s while the same run's earlier specs
     * were passing). A cap two seconds above the service's observed worst case,
     * with nothing behind it, is a coin flip — and losing it costs a hundred
     * tests, not one.
     *
     * So: an explicit timeout that is not the UI action budget, and one retry.
     * A throw and a non-2xx are the same event here, so both retry; the second
     * failure carries the first's reason, because "sign-in failed" without it
     * is what made this look like an outage rather than a tight bound.
     */
    const SIGNIN_TIMEOUT_MS = 45_000;
    const attempt = async () => {
      const r = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        headers: { apikey: ANON, "Content-Type": "application/json" },
        data: creds,
        timeout: SIGNIN_TIMEOUT_MS,
      });
      if (!r.ok()) throw new Error(`${r.status()} ${await r.text()}`);
      return (await r.json()) as Session;
    };
    let first: unknown;
    session = await attempt().catch(async (e: unknown) => {
      first = e;
      await new Promise((res) => setTimeout(res, 2_000));
      return attempt();
    }).catch((second: unknown) => {
      const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
      expect(
        false,
        `sign-in failed for the ${role} twice (${SIGNIN_TIMEOUT_MS}ms each, 2s apart)\n` +
          `  first:  ${say(first)}\n  second: ${say(second)}`,
      ).toBe(true);
      throw second;
    });
  } else {
    // GoTrue rate-limits magic links (429), so a minted session is reused from
    // disk while its access token has 20+ minutes left AND GoTrue still accepts
    // it (e2e/liveSession.ts: a revoked session keeps a valid-looking JWT, and
    // the specs would silently run signed out). A dead cache is deleted.
    const cacheFile = sessionCacheFile(role);
    const disk = fresh ? null : await readLiveCache<Session>(cacheFile, { minFreshMs: 20 * 60_000, isAlive });
    if (disk) {
      sessionCache.set(role, disk);
      return disk;
    }
    const out = execFileSync(
      "node",
      [join(REPO_ROOT, "scripts/test-signin-link.mjs"), `${role}-e2e`, "--session", "--json"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    session = (JSON.parse(out) as { session: Session }).session;
    writeCache(cacheFile, session);
  }
  expect(session.access_token, `no access token for the ${role}`).toBeTruthy();
  expect(await isAlive(session), `${role}: a freshly obtained session is refused by /auth/v1/user`).toBe(true);
  sessionCache.set(role, session);
  return session;
}

/** Disk cache path for a locally minted session. */
export function sessionCacheFile(role: Role): string {
  return join(REPO_ROOT, "node_modules", ".cache", "lh-journeys", `${role}.json`);
}

/**
 * Drop every cached session for a role (memory and the local disk cache), so
 * the next getSession mints a new one. Call after anything that revokes the
 * account's sessions, e.g. Log Out, which today is global.
 */
export function forgetSession(role: Role) {
  sessionCache.delete(role);
  rmSync(sessionCacheFile(role), { force: true });
}

export function rest(session: Session, extra: Record<string, string> = {}) {
  return {
    apikey: ANON,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * HOW SLOW PROD WAS WHILE THIS TEST RAN.
 *
 * WHY (issue #1595, run 35691377627, 2026-09-22). Two of that run's three
 * failures were one fact: between 05:42 and 05:45 UTC every prod REST call the
 * app made took tens of seconds. `/rest/v1/messages` (the inbox's base query)
 * took **43.8s**, `/rest/v1/profiles` 44.1s, `user_blocks` 43.5s, `user_roles`
 * 36.1s, the realtime handshake 25s — and `/auth/v1/token?grant_type=password`
 * never completed at all, which is the "Connection trouble. Check your signal
 * and try again." in `03-account`'s failure screenshot. The inbox assertion's
 * 30s budget expired while the data was still on the wire.
 *
 * Both reds READ as product defects — a blank inbox, a sign-in that does not
 * take — and cost a day of diagnosis each, because nothing in the run said
 * how slow the backend was. The numbers were in the trace the whole time. This
 * hoists them into the test's own annotations so the next degraded window
 * explains itself on the run page instead of in a downloaded zip.
 *
 * Diagnostic only: it never fails a test. A journey that passes slowly is
 * still a pass, and a red run is not excused by a slow number beside it.
 */
const SLOW_BACKEND_MS = 10_000;
let backendCalls = 0;
let slowBackendCalls = 0;
let slowestBackend = { ms: 0, url: "" };

function resetBackendLatency() {
  backendCalls = 0;
  slowBackendCalls = 0;
  slowestBackend = { ms: 0, url: "" };
}

/** One line for the annotations, or null when nothing was slow. */
function backendLatencyReport(): string | null {
  if (!slowBackendCalls) return null;
  return (
    `${slowBackendCalls} of ${backendCalls} prod calls took over ${SLOW_BACKEND_MS / 1_000}s; ` +
    `slowest ${(slowestBackend.ms / 1_000).toFixed(1)}s on ${slowestBackend.url}`
  );
}

/**
 * A fresh context, signed in by seeding the session before first paint (once
 * per tab, so a later in-app sign-out is not undone by the next navigation),
 * with the onboarding tour dismissed. Phone-sized by default: 375-class is the
 * primary surface (CLAUDE.md).
 */
export async function newUserContext(
  browser: Browser,
  session: Session | null,
  opts: { desktop?: boolean; rotation?: Rotation; timezoneId?: string } = {},
): Promise<BrowserContext> {
  const device = opts.rotation ? deviceProfile(opts.rotation.device) : null;
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    userAgent: test.info().project.use.userAgent,
    viewport: device?.viewport ?? (opts.desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 }),
    hasTouch: device?.hasTouch ?? !opts.desktop,
    colorScheme: device?.colorScheme ?? "light",
    serviceWorkers: "block",
    // Explicit when given: the machine's own zone is otherwise inherited, and a
    // timezone test that silently runs in the runner's zone proves nothing.
    ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
  });
  await ctx.addInitScript(
    ({ key, val, textScale }) => {
      try {
        if (val && !window.sessionStorage.getItem("__journey_seeded")) {
          window.localStorage.setItem(key, val);
          window.sessionStorage.setItem("__journey_seeded", "1");
        }
        window.localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
        );
      } catch {
        /* storage blocked: the journey fails visibly at its first signed-in assertion */
      }
      if (textScale) {
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.style.fontSize = `${textScale * 100}%`;
          document.documentElement.style.setProperty("--user-text-scale", String(textScale));
        });
      }
    },
    { key: AUTH_STORAGE_KEY, val: session ? JSON.stringify(session) : "", textScale: device?.textScale ?? 0 },
  );
  // Not on the `slow` row: that rotation INJECTS 3-8s per call below, so its
  // numbers would say nothing about prod.
  if (opts.rotation?.network !== "slow") {
    ctx.on("requestfinished", (req) => {
      if (!req.url().startsWith(SUPABASE_URL)) return;
      const ms = req.timing().responseEnd;
      if (!(ms > 0)) return;
      backendCalls += 1;
      if (ms < SLOW_BACKEND_MS) return;
      slowBackendCalls += 1;
      if (ms > slowestBackend.ms) slowestBackend = { ms, url: req.url().slice(SUPABASE_URL.length, SUPABASE_URL.length + 90) };
    });
  }
  if (opts.rotation?.network === "slow") {
    // 3-8s on every backend call, deterministic per URL so a re-run is the same run.
    await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
      const u = route.request().url();
      let h = 0;
      for (const ch of u) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      await new Promise((r) => setTimeout(r, 3_000 + (h % 5_000)));
      await route.continue().catch(() => {});
    });
  } else if (opts.rotation?.network === "drops") {
    // The FIRST write the user makes drops on the wire; everything after goes through.
    let dropped = false;
    await ctx.route(`${SUPABASE_URL}/rest/v1/**`, async (route) => {
      if (!dropped && route.request().method() !== "GET" && !route.request().url().includes("error_logs")) {
        dropped = true;
        test.info().annotations.push({ type: "network-drop", description: route.request().url().slice(0, 160) });
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue().catch(() => {});
    });
  }
  return ctx;
}

/** Announce an uncovered leg where CI shows it (same channel prod-lifecycle uses). */
export function announceUncovered(title: string, detail: string) {
  console.log(`::warning title=${title}::${detail}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      appendFileSync(summary, `- **${title}.** ${detail}\n`);
    } catch {
      /* the ::warning:: above still lands */
    }
  }
}

/** Skip the rest of a journey with an explicit, visible annotation, never a silent pass. */
export function skipUncovered(title: string, detail: string): never {
  announceUncovered(title, detail);
  test.info().annotations.push({ type: "uncovered", description: `${title}: ${detail}` });
  test.skip(true, `${title}: ${detail}`);
  throw new Error("unreachable");
}

/** `cs_test_` / `cs_live_`: the tripwire from prod-lifecycle.spec.ts (copied, because importing a spec re-registers its tests). */
export function stripeModeFromCheckoutUrl(url: string): "test" | "live" | "unknown" {
  const m = /\/(cs_(test|live)_[A-Za-z0-9]+)/.exec(url);
  if (!m) return "unknown";
  return m[2] === "live" ? "live" : "test";
}

export const TEST_CARD = {
  number: "4242 4242 4242 4242",
  expiry: "12 / 34",
  cvc: "123",
  zip: "70801",
  name: "Journey Test",
  line1: "100 Audit Way",
  city: "Baton Rouge",
};

/** Fill and submit Stripe's hosted Checkout the way prod-lifecycle learned it behaves. */
export async function payOnStripeCheckout(page: Page) {
  const cardNumber = page.locator("#cardNumber");
  const methodRadio = page.getByRole("radio").first();
  /**
   * Stripe's own page can fail to come up, and it says so in its own words:
   * "Something went wrong — You might be having a network connection problem,
   * the link might be expired, or the payment provider cannot be reached at the
   * moment." e2e-journeys 34927100318 (journeys-webkit) captured exactly that
   * screen and then spent 60s waiting for a card field that was never going to
   * render; the same checkout had worked in WebKit two runs earlier.
   *
   * One reload of the SAME session url is the honest response to a third-party
   * page that did not load — it is not a retry of the payment (nothing was
   * submitted). If Stripe errors again, the failure now names Stripe instead of
   * reading as a missing field in our own form.
   *
   * ASKED AT THE WRONG MOMENT until 2026-09-22. This probe ran ONCE, the
   * instant the page was handed over, and Stripe had not decided yet — so it
   * answered false and the run then sat 60s on `#cardNumber` while
   * "Something went wrong" was painting behind it. That is exactly what
   * e2e-journeys 35691377627 (journeys-webkit, 02-marketplace.spec.ts:278)
   * reported: "Stripe Checkout never rendered a payment field", with Stripe's
   * own error heading in the failure snapshot. Chromium funded the same job
   * from the same `cs_test_` session minutes earlier, and `describe.serial`
   * took J3/J4/J5 down with it, so one third-party hiccup read as our form
   * being broken and left the whole WebKit money chain dark.
   *
   * RACE the two outcomes instead of guessing which one to wait for: whichever
   * Stripe renders first ends the wait. The session was minted seconds ago and
   * verified `cs_test_` by the caller, so an error that SURVIVES a reload is
   * Stripe's, not an expired link of ours — and an uncovered money leg is
   * reported as uncovered rather than as a false red.
   */
  const brokenPanel = page.getByText(/Something went wrong/i).first();
  const paymentField = cardNumber.or(methodRadio);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await expect(
      paymentField.or(brokenPanel),
      "Stripe Checkout rendered neither a payment field nor an error of its own",
    ).toBeVisible({ timeout: 60_000 });
    if (!(await brokenPanel.isVisible().catch(() => false))) break;
    test.info().annotations.push({
      type: "stripe-checkout-error",
      description: `attempt ${attempt}: Stripe's own "Something went wrong" page at ${page.url()}`,
    });
    if (attempt === 2) {
      skipUncovered(
        "Stripe Checkout did not load",
        `Stripe's hosted page answered with its own "Something went wrong" twice, across a reload, for a ` +
          `Checkout Session minted seconds earlier and verified cs_test_. Nothing was submitted and nothing ` +
          `was charged. The funding leg and everything chained off it did NOT run on this engine.`,
      );
    }
    // One reload of the SAME session url — not a retry of the payment, since
    // nothing was ever submitted.
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(2_000);
  }
  await expect(paymentField, "Stripe Checkout never rendered a payment field").toBeVisible({ timeout: 30_000 });
  if (!(await cardNumber.isVisible().catch(() => false))) await methodRadio.click({ force: true });
  await cardNumber.waitFor({ state: "visible", timeout: 30_000 });
  await cardNumber.fill(TEST_CARD.number);
  await page.locator("#cardExpiry").fill(TEST_CARD.expiry);
  await page.locator("#cardCvc").fill(TEST_CARD.cvc);
  for (const [id, value] of [
    ["#billingName", TEST_CARD.name],
    ["#billingAddressLine1", TEST_CARD.line1],
    ["#billingLocality", TEST_CARD.city],
    ["#billingPostalCode", TEST_CARD.zip],
  ] as const) {
    const field = page.locator(id);
    if ((await field.count()) && (await field.isVisible().catch(() => false))) {
      await field.fill(value).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  const linkOptIn = page.locator("#enableStripePass");
  if ((await linkOptIn.count()) && (await linkOptIn.isChecked().catch(() => false))) {
    await linkOptIn.uncheck({ force: true }).catch(() => {});
  }
  // The billing-address autocomplete can swallow the first Pay tap, so blur,
  // tap, and tap again if still on Stripe, naming any inline error it shows.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.getByRole("heading", { name: /^Pay / }).first().click().catch(() => {});
    await page.getByTestId("hosted-payment-submit-button").click();
    const left = await page
      .waitForURL((url) => !url.host.endsWith("checkout.stripe.com"), { timeout: 40_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
    const complaints = await page.locator('[role="alert"], .FieldError').allInnerTexts().catch(() => [] as string[]);
    console.log(`Stripe Pay attempt ${attempt} did not leave checkout: ${complaints.join(" | ") || "no inline error"}`);
  }
  throw new Error("Stripe Checkout never submitted after 3 Pay taps");
}

/**
 * Owner rule: no screen is ever an error page. Call after every navigation and
 * action. Fails with the pattern name; the journey fixture adds the screenshot.
 * A still-loading screen is given `settleMs` to finish before it counts.
 */
export async function assertHealthy(page: Page, where: string, opts: { allow?: string[]; settleMs?: number } = {}) {
  const deadline = Date.now() + (opts.settleMs ?? 15_000);
  let stuck: string | null;
  for (;;) {
    const text = await page.locator("body").innerText().catch(() => "");
    const err = findErrorScreen(text, opts.allow ?? []);
    expect(err, `${where}: error screen "${err?.name}" at ${page.url()} — ${err?.excerpt}`).toBeNull();
    stuck = await page.evaluate(detectStuckOrBlank).catch(() => "evaluate failed");
    if (!stuck || Date.now() > deadline) break;
    await page.waitForTimeout(500);
  }
  expect(stuck, `${where}: stuck or blank at ${page.url()}`).toBeNull();
}

/** Service-role (local .env) or admin-account (CI) token that may read error_logs, else null. */
async function errorLogReader(api: APIRequestContext): Promise<{ apikey: string; token: string } | null> {
  const envPath = join(REPO_ROOT, ".env");
  if (!process.env.CI && existsSync(envPath)) {
    const m = /^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m.exec(readFileSync(envPath, "utf8"));
    if (m) {
      const key = m[1].trim().replace(/^["']|["']$/g, "");
      return { apikey: key, token: key };
    }
  }
  const email = process.env.PLAYWRIGHT_ADMIN_EMAIL;
  const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
  if (email && password) {
    const r = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON, "Content-Type": "application/json" },
      data: { email, password },
    });
    if (r.ok()) return { apikey: ANON, token: ((await r.json()) as Session).access_token };
  }
  return null;
}

type Journey = {
  /** Register a page so it is screenshotted if the journey fails. */
  track: (name: string, page: Page) => Page;
  /** A named milestone screenshot, attached to the report and kept under test-results. */
  milestone: (page: Page, name: string) => Promise<void>;
  /** LIFO cleanup, run even when the journey fails. Non-fatal, but announced. */
  cleanup: (label: string, fn: () => Promise<unknown>) => void;
  /**
   * Expect ONE specific report the journey itself provokes on purpose (e.g. a
   * parish-less ZIP). Matched against the message; anything else still fails.
   */
  allowReport: (message: RegExp, why: string) => void;
};

export const test = base.extend<{ journey: Journey }>({
  journey: async ({ request }, provide, testInfo: TestInfo) => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    resetBackendLatency();
    const pages = new Map<string, Page>();
    const clientReports: string[] = [];
    const allowed: RegExp[] = [];
    // Local development only: lets later steps be built while a known, filed
    // defect is waiting to deploy. Refused in CI so it can never hide one there.
    if (process.env.JOURNEY_ALLOW_REPORTS) {
      if (process.env.CI) throw new Error("JOURNEY_ALLOW_REPORTS is local-only and must not be set in CI");
      allowed.push(new RegExp(process.env.JOURNEY_ALLOW_REPORTS));
      testInfo.annotations.push({ type: "allowed-report", description: `local override: ${process.env.JOURNEY_ALLOW_REPORTS}` });
    }
    const cleanups: Array<{ label: string; fn: () => Promise<unknown> }> = [];
    const dir = testInfo.outputPath("milestones");
    mkdirSync(dir, { recursive: true });
    let n = 0;

    await provide({
      track: (name, page) => {
        pages.set(name, page);
        // Every report() the client fires lands as a POST to error_logs; catch it at the wire.
        page.on("request", (req) => {
          if (req.method() === "POST" && req.url().includes("/rest/v1/error_logs")) {
            clientReports.push(`${name} @ ${page.url()}: ${(req.postData() ?? "").slice(0, 400)}`);
          }
        });
        return page;
      },
      milestone: async (page, name) => {
        // Let the screen finish loading first, so a milestone shows the screen and not its skeleton.
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        const file = join(dir, `${String(++n).padStart(2, "0")}-${name.replace(/[^a-z0-9-]+/gi, "_")}.png`);
        await page.screenshot({ path: file }).catch(() => {});
        await testInfo.attach(`milestone: ${name}`, { path: file, contentType: "image/png" }).catch(() => {});
      },
      allowReport: (message, why) => {
        allowed.push(message);
        testInfo.annotations.push({ type: "allowed-report", description: `${message}: ${why}` });
      },
      cleanup: (label, fn) => {
        cleanups.push({ label, fn });
      },
    });

    // Always annotated, so a SLOW GREEN run is visible too — that is the
    // warning that the next red is coming. Announced as a CI warning only on a
    // red, where it is the first thing to read before blaming the screen.
    const latency = backendLatencyReport();
    if (latency) {
      testInfo.annotations.push({ type: "prod-latency", description: latency });
    }

    if (testInfo.status !== testInfo.expectedStatus && testInfo.status !== "skipped") {
      if (latency) {
        announceUncovered(
          "Prod was SLOW while this journey failed",
          `${testInfo.title}: ${latency}. Read this before reading the failure as a product defect.`,
        );
      }
      for (const [name, page] of pages) {
        if (page.isClosed()) continue;
        const file = testInfo.outputPath(`failure-${name}.png`);
        await page.screenshot({ path: file }).catch(() => {});
        await testInfo.attach(`failure: ${name}`, { path: file, contentType: "image/png" }).catch(() => {});
        const aria = await page.locator("body").ariaSnapshot({ timeout: 5_000 }).catch(() => "");
        await testInfo.attach(`failure aria: ${name}`, { body: `${page.url()}\n${aria}`, contentType: "text/plain" }).catch(() => {});
      }
    }
    for (const c of cleanups.reverse()) {
      try {
        await c.fn();
      } catch (err) {
        // Not silent: announced as a CI warning. A cleanup failure must not mask the journey's own result.
        announceUncovered("Journey cleanup failed", `${testInfo.title}: ${c.label}: ${String(err).slice(0, 300)}`);
      }
    }

    // A report() fired means the user hit a real error, even if the screen recovered.
    if (testInfo.status === "passed") {
      const unexpected = clientReports.filter((r) => !allowed.some((re) => re.test(r)));
      expect(unexpected, `the app reported errors during the journey:\n${unexpected.join("\n")}`).toEqual([]);
      const reader = await errorLogReader(request);
      if (!reader) {
        announceUncovered("error_logs not checked", "no service-role .env and no PLAYWRIGHT_ADMIN_EMAIL/_PASSWORD; only client-side report() POSTs were watched.");
      } else if (sessionCache.size) {
        const ids = [...sessionCache.values()].map((s) => s.user.id).join(",");
        const r = await request.get(
          `${SUPABASE_URL}/rest/v1/error_logs?select=created_at,severity,message,url,user_id&created_at=gte.${encodeURIComponent(startedAt)}&user_id=in.(${ids})`,
          { headers: { apikey: reader.apikey, Authorization: `Bearer ${reader.token}` } },
        );
        expect(r.ok(), `reading error_logs failed: ${r.status()} ${await r.text()}`).toBe(true);
        const rows = ((await r.json()) as Array<{ message: string }>).filter((row) => !allowed.some((re) => re.test(row.message)));
        expect(rows, `error_logs rows written by the test accounts during this journey`).toEqual([]);
      }
    }
  },
});

export { expect };
