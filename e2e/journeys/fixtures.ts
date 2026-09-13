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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectStuckOrBlank, findErrorScreen } from "../errorScreens";
import { deviceProfile, type Rotation } from "./scenarios";

/**
 * Shared plumbing for the USER JOURNEY suite (e2e/journeys/*).
 *
 * The journeys drive the DEPLOYED app (PLAYWRIGHT_BASE_URL, default prod web)
 * against the REAL backend with the two shared E2E accounts: the same pair,
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

export type Role = "poster" | "helper";
export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  token_type?: string;
  user: { id: string; email?: string };
};

const REPO_ROOT = process.cwd();

function envCreds(role: Role) {
  const email = role === "poster" ? process.env.PLAYWRIGHT_POSTER_EMAIL : process.env.PLAYWRIGHT_HELPER_EMAIL;
  const password = role === "poster" ? process.env.PLAYWRIGHT_POSTER_PASSWORD : process.env.PLAYWRIGHT_HELPER_PASSWORD;
  return email && password ? { email, password } : null;
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
  const cached = sessionCache.get(role);
  if (!fresh && cached && (cached.expires_at ?? 0) * 1000 > Date.now() + 10 * 60_000) return cached;
  const creds = envCreds(role);
  let session: Session;
  if (creds) {
    const r = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON, "Content-Type": "application/json" },
      data: creds,
    });
    expect(r.ok(), `sign-in failed for the ${role}: ${r.status()} ${await r.text()}`).toBe(true);
    session = (await r.json()) as Session;
  } else {
    const out = execFileSync(
      "node",
      [join(REPO_ROOT, "scripts/test-signin-link.mjs"), `${role}-e2e`, "--session", "--json"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    session = (JSON.parse(out) as { session: Session }).session;
  }
  expect(session.access_token, `no access token for the ${role}`).toBeTruthy();
  sessionCache.set(role, session);
  return session;
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
  await expect(cardNumber.or(methodRadio)).toBeVisible({ timeout: 60_000 });
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
  await page.getByTestId("hosted-payment-submit-button").click();
  await page.waitForURL((url) => !url.host.endsWith("checkout.stripe.com"), { timeout: 120_000 });
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
};

export const test = base.extend<{ journey: Journey }>({
  journey: async ({ request }, provide, testInfo: TestInfo) => {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    const pages = new Map<string, Page>();
    const clientReports: string[] = [];
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
        const file = join(dir, `${String(++n).padStart(2, "0")}-${name.replace(/[^a-z0-9-]+/gi, "_")}.png`);
        await page.screenshot({ path: file }).catch(() => {});
        await testInfo.attach(`milestone: ${name}`, { path: file, contentType: "image/png" }).catch(() => {});
      },
      cleanup: (label, fn) => {
        cleanups.push({ label, fn });
      },
    });

    if (testInfo.status !== testInfo.expectedStatus && testInfo.status !== "skipped") {
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
      expect(clientReports, `the app reported errors during the journey:\n${clientReports.join("\n")}`).toEqual([]);
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
        const rows = await r.json();
        expect(rows, `error_logs rows written by the test accounts during this journey`).toEqual([]);
      }
    }
  },
});

export { expect };
