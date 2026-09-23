import type { APIRequestContext, Browser, BrowserContext, CDPSession, Locator, Page, Route } from "@playwright/test";
import {
  test,
  expect,
  assertHealthy,
  getSession,
  newUserContext,
  rest,
  sessionsAvailable,
  skipUncovered,
  E2E_TITLE_MARKER,
  SUPABASE_URL,
  type Session,
} from "../journeys/fixtures";
import { fillBudget, fillJobDetails, fillLogistics, slotAhead, ZONE } from "../journeys/postJobForm";
import { ensureFundedOpenJob } from "../prod-audit/fundedOpenJob";
import { HANG_MS, NETWORK_3G, PROGRESS_GRACE_MS, stepTitle } from "./steps";

/**
 * Q68 — SLOW AND PATCHY NETWORKS (rural Louisiana).
 *
 * The core journey steps (steps.ts), each run twice against this commit's
 * local build and the REAL backend with the shared E2E accounts:
 *
 *   · 3g    Chrome's DevTools "3G" throttle on the page (CDP). Every wait
 *           longer than PROGRESS_GRACE_MS must show progress by then, and
 *           nothing may sit silent for HANG_MS.
 *   · drop  the connection drops mid-action, two ways:
 *             offline  the device is offline when the user presses: the app
 *                      must SAY it is offline, and nothing is written;
 *             lost     the request reaches the server and is processed, and
 *                      the RESPONSE is lost on the wire. The user sees an
 *                      error, presses again, and the server must hold the
 *                      write EXACTLY ONCE (the idempotency check).
 *
 * Chromium only (CDP throttling); nightly in .github/workflows/slow-network.yml,
 * 1 worker. Rows carry E2E_TITLE_MARKER and are swept by
 * scripts/e2e/prod-lifecycle-sweeper.mjs before and after the run.
 * Guard: src/test/slowNetworkCoversEverySteps.test.ts.
 */

const RUN = Date.now().toString(36).slice(-6);

// ─── network control ──────────────────────────────────────────────────────────

async function throttle3g(ctx: BrowserContext, page: Page): Promise<CDPSession> {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { ...NETWORK_3G });
  test.info().annotations.push({ type: "network", description: `3G: ${JSON.stringify(NETWORK_3G)}` });
  return cdp;
}

/**
 * The next request matching `match` reaches the server (route.fetch), and
 * its RESPONSE is then dropped as a disconnect: the server did the write, the
 * client never hears. Once only; later requests pass through.
 */
async function loseNextResponse(page: Page, urlGlob: string, method = "POST") {
  let done = false;
  const fired = { at: 0, status: 0 };
  await page.route(urlGlob, async (route: Route) => {
    if (done || route.request().method() !== method) return route.continue().catch(() => {});
    done = true;
    const resp = await route.fetch().catch(() => null);
    fired.at = Date.now();
    fired.status = resp?.status() ?? 0;
    test.info().annotations.push({
      type: "network-drop",
      description: `response LOST after the server answered ${fired.status}: ${route.request().url().slice(0, 140)}`,
    });
    await route.abort("internetdisconnected");
  });
  return fired;
}

// ─── progress ─────────────────────────────────────────────────────────────────

/** What on screen says "working on it", or null. Runs in the page. */
function progressOnScreen(): string | null {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const indicator = [
    ...document.querySelectorAll(
      '[aria-busy="true"], [role="progressbar"], .animate-spin, .animate-pulse, [data-loading="true"], [data-skeleton], .skeleton',
    ),
  ].find(vis);
  if (indicator) return `indicator:${indicator.getAttribute("role") || indicator.className.toString().slice(0, 40)}`;
  const busy = [...document.querySelectorAll("button")].find(
    (b) => vis(b) && (b.disabled || b.getAttribute("aria-disabled") === "true") && /…|\.\.\./.test(b.textContent || ""),
  );
  if (busy) return `busy-button:${(busy.textContent || "").trim().slice(0, 40)}`;
  const text = document.body?.innerText || "";
  const m = /\b(Loading|Sending|Posting|Processing|Applying|Logging In|Uploading|Starting checkout|Taking you to secure checkout)[^\n]{0,24}(…|\.\.\.)/i.exec(text);
  return m ? `busy-text:${m[0].slice(0, 40)}` : null;
}

/**
 * Start an action and wait for its outcome, sampling the screen every 150ms.
 * A wait longer than PROGRESS_GRACE_MS must have shown progress by then; no
 * wait may exceed HANG_MS. Every wait is annotated with its numbers.
 */
async function waitShowsProgress(page: Page, label: string, start: () => Promise<unknown>, done: () => Promise<boolean>) {
  const t0 = Date.now();
  const kicked = start().catch((e: unknown) => e);
  let firstProgress: { ms: number; what: string } | null = null;
  let doneMs = -1;
  while (Date.now() - t0 < HANG_MS) {
    if (await done().catch(() => false)) {
      doneMs = Date.now() - t0;
      break;
    }
    if (!firstProgress) {
      const what = await page.evaluate(progressOnScreen).catch(() => null);
      if (what) firstProgress = { ms: Date.now() - t0, what };
    }
    await page.waitForTimeout(150);
  }
  await kicked;
  const line = `${label}: done=${doneMs < 0 ? `NO (>${HANG_MS}ms)` : `${doneMs}ms`} progress=${firstProgress ? `${firstProgress.ms}ms ${firstProgress.what}` : "never"}`;
  test.info().annotations.push({ type: "wait", description: line });
  expect(doneMs, `${label}: hung silently — no outcome within ${HANG_MS}ms on 3G (${line})`).toBeGreaterThanOrEqual(0);
  if (doneMs > PROGRESS_GRACE_MS) {
    expect(
      firstProgress && firstProgress.ms <= PROGRESS_GRACE_MS + 300,
      `${label}: waited ${doneMs}ms on 3G with no progress shown in the first ${PROGRESS_GRACE_MS}ms (${line})`,
    ).toBe(true);
  }
}

const visible = (l: Locator) => () => l.first().isVisible();
const OFFLINE_COPY = /offline|no connection|connection trouble|check your (signal|connection)|network/i;

async function expectOfflineSaid(page: Page, where: string) {
  await expect(page.getByText(OFFLINE_COPY).first(), `${where}: the app never said it was offline`).toBeVisible({ timeout: 15_000 });
}

async function count(api: APIRequestContext, s: Session, pathAndQuery: string): Promise<number> {
  const r = await api.get(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: rest(s) });
  expect(r.ok(), `count ${pathAndQuery}: ${r.status()} ${await r.text()}`).toBe(true);
  return ((await r.json()) as unknown[]).length;
}

/** The idempotency assertion: after a lost response and a retry, the server holds the write once. */
async function expectExactlyOnce(api: APIRequestContext, s: Session, pathAndQuery: string, what: string) {
  await expect
    .poll(() => count(api, s, pathAndQuery), { timeout: 30_000, message: `${what}: never written at all` })
    .toBeGreaterThan(0);
  const n = await count(api, s, pathAndQuery);
  test.info().annotations.push({ type: "idempotency", description: `${what}: ${n} row(s) after lost response + retry` });
  expect(n, `${what}: a retry after a lost response wrote it ${n} times`).toBe(1);
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const avail = sessionsAvailable();
test.skip(!avail.ok, avail.why);

// NOT serial: every step stands alone, so one red step (a finding) never hides the next.

async function posterPage(browser: Browser, request: APIRequestContext) {
  const poster = await getSession(request, "poster");
  const ctx = await newUserContext(browser, poster);
  const page = await ctx.newPage();
  return { poster, ctx, page };
}

function jobTitle(tag: string) {
  // Title max is 32 characters: marker (19) + " N" + tag + run id.
  return `${E2E_TITLE_MARKER} N${tag}${RUN}`.slice(0, 32);
}

function removeJobsTitled(api: APIRequestContext, poster: Session, title: string) {
  return async () => {
    const r = await api.delete(
      `${SUPABASE_URL}/rest/v1/jobs?customer_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(title)}&payment_status=eq.unpaid&select=id`,
      { headers: rest(poster, { Prefer: "return=representation" }) },
    );
    if (!r.ok()) throw new Error(`delete ${title}: ${r.status()} ${await r.text()}`);
  };
}

/** Post a Job form up to the checkout step, on whatever network the page has. */
async function fillToCheckout(page: Page, title: string, allowReport: (m: RegExp, why: string) => void) {
  await page.goto("/post-job");
  await page.getByRole("button", { name: /Start Fresh/ }).click();
  await expect(page.getByRole("heading", { name: "Job Details", level: 1 })).toBeVisible({ timeout: 60_000 });
  await fillJobDetails(page, title);
  // Three days out: no day-of ladder here, and never "today" at any hour.
  await fillLogistics(page, slotAhead(3 * 24 * 60), allowReport);
  const review = await fillBudget(page);
  await review.click();
  await expect(page.getByText(/Payment breakdown/i)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("checkbox", { name: /reviewed all details/i }).click();
  return page.getByRole("button", { name: /Continue to Payment|Post Job/i });
}

// ─── sign-in ──────────────────────────────────────────────────────────────────

function posterCreds() {
  const email = process.env.PLAYWRIGHT_POSTER_EMAIL;
  const password = process.env.PLAYWRIGHT_POSTER_PASSWORD;
  if (!email || !password) {
    skipUncovered("Slow-network sign-in not run", "PLAYWRIGHT_POSTER_EMAIL/_PASSWORD are not set: the password form cannot be driven with a minted session.");
  }
  return { email: email!, password: password! };
}

test(stepTitle("sign-in", "3g"), async ({ browser, journey }) => {
  const creds = posterCreds();
  const ctx = await newUserContext(browser, null);
  const page = journey.track("guest", await ctx.newPage());
  await throttle3g(ctx, page);
  await waitShowsProgress(page, "cold load /login", () => page.goto("/login", { waitUntil: "commit" }), visible(page.locator("#email")));
  await page.locator("#email").fill(creds.email);
  await page.locator("#password").fill(creds.password);
  await waitShowsProgress(page, "Log In", () => page.locator('button[type="submit"]').click(), async () => /\/(dashboard|complete-profile)/.test(page.url()));
  await assertHealthy(page, "signed in on 3G", { settleMs: 60_000 });
  await journey.milestone(page, "signin-3g");
  await ctx.close();
});

test(stepTitle("sign-in", "drop"), async ({ browser, journey }) => {
  const creds = posterCreds();
  const ctx = await newUserContext(browser, null);
  const page = journey.track("guest", await ctx.newPage());
  await page.goto("/login");
  await page.locator("#email").fill(creds.email);
  await page.locator("#password").fill(creds.password);

  await test.step("offline when pressing Log In: says so", async () => {
    await ctx.setOffline(true);
    await page.locator('button[type="submit"]').click();
    await expectOfflineSaid(page, "Log In while offline");
    await ctx.setOffline(false);
  });
  await test.step("response lost after the server signed in: a retry still lands signed in", async () => {
    journey.allowReport(/sign.?in|auth|fetch|network|load failed/i, "deliberate: the sign-in response is dropped on the wire");
    await loseNextResponse(page, `${SUPABASE_URL}/auth/v1/token**`);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(OFFLINE_COPY).first(), "a lost sign-in response left no message").toBeVisible({ timeout: 30_000 });
    await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 30_000 });
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(dashboard|complete-profile)/, { timeout: 60_000 });
    await assertHealthy(page, "signed in after a lost response");
  });
  await ctx.close();
});

// ─── browse ───────────────────────────────────────────────────────────────────

test(stepTitle("browse", "3g"), async ({ browser, journey }) => {
  const ctx = await newUserContext(browser, null);
  const page = journey.track("guest", await ctx.newPage());
  await throttle3g(ctx, page);
  const heading = page.getByRole("heading", { name: "Browse Jobs", level: 1 });
  await waitShowsProgress(page, "cold load /browse", () => page.goto("/browse", { waitUntil: "commit" }), visible(heading));
  await waitShowsProgress(page, "job cards", async () => {}, visible(page.getByRole("heading", { level: 2 })));
  await assertHealthy(page, "browse on 3G", { settleMs: 60_000 });
  await journey.milestone(page, "browse-3g");
  await ctx.close();
});

test(stepTitle("browse", "drop"), async ({ browser, journey }) => {
  const ctx = await newUserContext(browser, null);
  const page = journey.track("guest", await ctx.newPage());
  await page.goto("/browse");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 45_000 });
  await ctx.setOffline(true);
  await expectOfflineSaid(page, "Browse after the connection dropped");
  await journey.milestone(page, "browse-offline");
  await ctx.setOffline(false);
  await expect(page.getByText(OFFLINE_COPY).first(), "the offline notice stayed after the connection came back").toBeHidden({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 2 }).first(), "Browse did not recover once back online").toBeVisible({ timeout: 45_000 });
  await assertHealthy(page, "browse recovered");
  await ctx.close();
});

// ─── post ─────────────────────────────────────────────────────────────────────

test(stepTitle("post", "3g"), async ({ browser, request, journey }) => {
  test.setTimeout(15 * 60_000);
  const { poster, ctx, page } = await posterPage(browser, request);
  journey.track("poster", page);
  const title = jobTitle("p");
  journey.cleanup("remove the 3G post", removeJobsTitled(request, poster, title));
  await throttle3g(ctx, page);
  const submit = await fillToCheckout(page, title, journey.allowReport);
  const q = `jobs?customer_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(title)}&select=id`;
  // Done = the job row exists; the payment hand-off after it is pay-start's.
  await waitShowsProgress(page, "Continue to Payment (job insert)", () => submit.click(), async () => (await count(request, poster, q)) > 0);
  await journey.milestone(page, "post-3g-submitted");
  await ctx.close();
});

test(stepTitle("post", "drop"), async ({ browser, request, journey }) => {
  test.setTimeout(10 * 60_000);
  const { poster, ctx, page } = await posterPage(browser, request);
  journey.track("poster", page);
  const title = jobTitle("q");
  journey.cleanup("remove the dropped posts", removeJobsTitled(request, poster, title));
  const q = `jobs?customer_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(title)}&select=id`;
  const submit = await fillToCheckout(page, title, journey.allowReport);

  await test.step("offline when pressing: says so, writes nothing", async () => {
    await ctx.setOffline(true);
    await submit.click();
    await expectOfflineSaid(page, "Post while offline");
    await ctx.setOffline(false);
    expect(await count(request, poster, q), "a job was written while the device was offline").toBe(0);
  });
  await test.step("insert response lost, user presses again: exactly one job", async () => {
    journey.allowReport(/job|post|fetch|network|failed/i, "deliberate: the job insert response is dropped on the wire");
    await loseNextResponse(page, `${SUPABASE_URL}/rest/v1/jobs**`);
    await submit.click();
    await expect(submit, "the post button never came back after a lost response (hang)").toBeEnabled({ timeout: 60_000 });
    await submit.click();
    await expectExactlyOnce(request, poster, q, "jobs row");
  });
  await ctx.close();
});

// ─── apply ────────────────────────────────────────────────────────────────────

async function helperOnFixture(browser: Browser, request: APIRequestContext) {
  const poster = await getSession(request, "poster");
  const helper = await getSession(request, "helper");
  const { job, log } = await ensureFundedOpenJob(request, browser, poster, helper);
  test.info().annotations.push({ type: "fixture", description: log.join(" · ") });
  return { poster, helper, job };
}

async function openApplyDialog(page: Page, jobTitleText: string) {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Search jobs" }).first().click();
  await page.getByRole("combobox", { name: "Search jobs" }).fill(jobTitleText);
  const esc = jobTitleText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`View .*${esc}`) }).first().click();
  const dialog = page.getByRole("dialog").first();
  const apply = dialog.getByRole("button", { name: /^(Apply Now|Try Again)$/ });
  await expect(apply).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("textbox").first().fill(`Slow network ${RUN}: I can do this one.`);
  return apply;
}

function withdrawApplication(api: APIRequestContext, helper: Session, jobId: string) {
  return async () => {
    const r = await api.delete(`${SUPABASE_URL}/rest/v1/applications?job_id=eq.${jobId}&helper_id=eq.${helper.user.id}&select=id`, {
      headers: rest(helper, { Prefer: "return=representation" }),
    });
    if (!r.ok()) throw new Error(`withdraw: ${r.status()} ${await r.text()} (ensureFundedOpenJob retires an applied fixture next run)`);
  };
}

test(stepTitle("apply", "3g"), async ({ browser, request, journey }) => {
  test.setTimeout(15 * 60_000);
  const { helper, job } = await helperOnFixture(browser, request);
  journey.cleanup("withdraw the 3G application", withdrawApplication(request, helper, job.id));
  const ctx = await newUserContext(browser, helper);
  const page = journey.track("helper", await ctx.newPage());
  await throttle3g(ctx, page);
  const apply = await openApplyDialog(page, job.title);
  const q = `applications?job_id=eq.${job.id}&helper_id=eq.${helper.user.id}&select=id`;
  await waitShowsProgress(page, "Apply Now", () => apply.click(), async () => (await count(request, helper, q)) > 0);
  await expect(page.getByText(/applied|application sent|you're in/i).first(), "no visible confirmation after applying on 3G").toBeVisible({ timeout: 60_000 });
  await journey.milestone(page, "apply-3g");
  await ctx.close();
});

test(stepTitle("apply", "drop"), async ({ browser, request, journey }) => {
  test.setTimeout(10 * 60_000);
  const { helper, job } = await helperOnFixture(browser, request);
  journey.cleanup("withdraw the dropped application", withdrawApplication(request, helper, job.id));
  const ctx = await newUserContext(browser, helper);
  const page = journey.track("helper", await ctx.newPage());
  const apply = await openApplyDialog(page, job.title);
  const q = `applications?job_id=eq.${job.id}&helper_id=eq.${helper.user.id}&select=id`;

  await test.step("offline when pressing: says so, writes nothing", async () => {
    await ctx.setOffline(true);
    await apply.click();
    await expectOfflineSaid(page, "Apply while offline");
    await ctx.setOffline(false);
    expect(await count(request, helper, q), "an application was written while offline").toBe(0);
  });
  await test.step("RPC response lost, user presses again: exactly one application", async () => {
    journey.allowReport(/appl|fetch|network|failed/i, "deliberate: the apply response is dropped on the wire");
    await loseNextResponse(page, `${SUPABASE_URL}/rest/v1/rpc/apply_to_job**`);
    await apply.click();
    await expect(apply, "the apply button never came back after a lost response (hang)").toBeEnabled({ timeout: 60_000 });
    await apply.click();
    await expectExactlyOnce(request, helper, q, "applications row");
    // Finding when present: the retry of a write that DID land is told it failed.
    if (await page.getByText(/already applied/i).first().isVisible().catch(() => false)) {
      test.info().annotations.push({ type: "finding", description: "retry after a lost apply response says 'already applied' — true, but the user was just told it failed" });
    }
  });
  await ctx.close();
});

// ─── message ──────────────────────────────────────────────────────────────────

/** Poster ↔ applicant thread on the funded fixture (is_party_to_job admits an applicant). */
async function posterThread(browser: Browser, request: APIRequestContext) {
  const { poster, helper, job } = await helperOnFixture(browser, request);
  const has = await count(request, helper, `applications?job_id=eq.${job.id}&helper_id=eq.${helper.user.id}&select=id`);
  if (!has) {
    // Harness set-up, not the step under test: the thread needs an applicant.
    const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/apply_to_job`, {
      headers: rest(helper),
      data: { p_job_id: job.id, p_message: `Slow network ${RUN}` },
    });
    if (!r.ok()) skipUncovered("Slow-network message thread", `could not make helper-e2e an applicant on ${job.id}: ${r.status()} ${await r.text()}`);
  }
  const ctx = await newUserContext(browser, poster, { timezoneId: ZONE });
  const page = await ctx.newPage();
  await page.goto(`/messages?jobId=${job.id}&userId=${helper.user.id}`);
  const box = page.getByRole("textbox", { name: "Type a message" });
  await expect(box, "the poster ↔ applicant thread did not open").toBeVisible({ timeout: 60_000 });
  return { poster, helper, job, ctx, page, box };
}

test(stepTitle("message", "3g"), async ({ browser, request, journey }) => {
  test.setTimeout(15 * 60_000);
  const t = await posterThread(browser, request);
  journey.cleanup("withdraw the thread's application", withdrawApplication(request, t.helper, t.job.id));
  journey.track("poster", t.page);
  await throttle3g(t.ctx, t.page);
  const text = `3G hello ${RUN}`;
  await t.box.fill(text);
  const q = `messages?job_id=eq.${t.job.id}&sender_id=eq.${t.poster.user.id}&content=eq.${encodeURIComponent(text)}&select=id`;
  await waitShowsProgress(t.page, "Send message", () => t.box.press("Enter"), async () => (await count(request, t.poster, q)) > 0);
  await expect(t.page.getByText(text).first()).toBeVisible();
  await journey.milestone(t.page, "message-3g");
  await t.ctx.close();
});

test(stepTitle("message", "drop"), async ({ browser, request, journey }) => {
  test.setTimeout(10 * 60_000);
  const t = await posterThread(browser, request);
  journey.cleanup("withdraw the thread's application", withdrawApplication(request, t.helper, t.job.id));
  journey.track("poster", t.page);
  const text = `Dropped hello ${RUN}`;
  const q = `messages?job_id=eq.${t.job.id}&sender_id=eq.${t.poster.user.id}&content=eq.${encodeURIComponent(text)}&select=id`;

  await test.step("offline when sending: says so, writes nothing", async () => {
    await t.ctx.setOffline(true);
    await t.box.fill(text);
    await t.box.press("Enter");
    await expectOfflineSaid(t.page, "Send while offline");
    await t.ctx.setOffline(false);
    expect(await count(request, t.poster, q), "a message was written while offline").toBe(0);
  });
  await test.step("insert response lost, user taps Retry: exactly one message", async () => {
    journey.allowReport(/message|fetch|network|failed/i, "deliberate: the message insert response is dropped on the wire");
    await loseNextResponse(t.page, `${SUPABASE_URL}/rest/v1/messages**`);
    if (!(await t.box.inputValue())) await t.box.fill(text);
    await t.box.press("Enter");
    const retry = t.page.getByRole("button", { name: /Retry sending|Tap to Retry/i }).first();
    await expect(retry, "a lost send left no retry affordance (silent)").toBeVisible({ timeout: 60_000 });
    await retry.click();
    await expectExactlyOnce(request, t.poster, q, "messages row");
  });
  await t.ctx.close();
});

// ─── pay start ────────────────────────────────────────────────────────────────

test(stepTitle("pay-start", "3g"), async ({ browser, request, journey }) => {
  test.setTimeout(15 * 60_000);
  const { poster, ctx, page } = await posterPage(browser, request);
  journey.track("poster", page);
  const title = jobTitle("s");
  journey.cleanup("remove the 3G pay-start job", removeJobsTitled(request, poster, title));
  const submit = await fillToCheckout(page, title, journey.allowReport);
  await throttle3g(ctx, page);
  // Stops at Stripe's door: pay START, nothing is charged.
  await waitShowsProgress(page, "Continue to Payment → Stripe Checkout", () => submit.click(), async () => page.url().includes("checkout.stripe.com"));
  await ctx.close();
});

test(stepTitle("pay-start", "drop"), async ({ browser, request, journey }) => {
  test.setTimeout(10 * 60_000);
  const { poster, ctx, page } = await posterPage(browser, request);
  journey.track("poster", page);
  const title = jobTitle("t");
  journey.cleanup("remove the dropped pay-start jobs", removeJobsTitled(request, poster, title));
  const submit = await fillToCheckout(page, title, journey.allowReport);
  const q = `jobs?customer_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(title)}&select=id`;

  await test.step("offline when pressing: says so, starts nothing", async () => {
    await ctx.setOffline(true);
    await submit.click();
    await expectOfflineSaid(page, "Pay while offline");
    await ctx.setOffline(false);
    expect(await count(request, poster, q), "a job was written while offline").toBe(0);
  });

  journey.allowReport(/payment|checkout|fetch|network|failed|orphan/i, "deliberate: the create-payment response is dropped on the wire");
  const firstInsert = page.waitForResponse((r) => r.url().startsWith(`${SUPABASE_URL}/rest/v1/jobs`) && r.request().method() === "POST", { timeout: 60_000 });
  await loseNextResponse(page, `${SUPABASE_URL}/functions/v1/create-payment**`);
  await submit.click();
  const firstJobId = ((await (await firstInsert).json().catch(() => ({}))) as { id?: string }).id;
  await expect(submit, "the pay button never came back after a lost create-payment response (hang)").toBeEnabled({ timeout: 60_000 });
  await Promise.all([page.waitForURL(/checkout\.stripe\.com/, { timeout: 120_000 }), submit.click()]);
  // Idempotency: the retry must pay for the SAME job, not post a second one
  // whose first Checkout Session stays live for a job the client deleted.
  await expectExactlyOnce(request, poster, q, "jobs row behind the Checkout Session");
  const rows = (await (await request.get(`${SUPABASE_URL}/rest/v1/${q}`, { headers: rest(poster) })).json()) as Array<{ id: string }>;
  expect(rows[0]?.id, "the retry paid for a NEW job, not the one the first press created").toBe(firstJobId);
  await ctx.close();
});
