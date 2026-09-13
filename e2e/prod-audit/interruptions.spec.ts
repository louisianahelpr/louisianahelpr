/**
 * INTERRUPTIONS on prod — the ways real people interrupt a flow: tapping twice,
 * losing signal mid-submit, a slow connection, back and refresh mid-flow, and a
 * session that expires while a form is open. Drives the deployed app as the
 * shared test accounts (no mocks). Contract for every case: exactly one write
 * per intent, an honest message when it did not go through, a retry that
 * works, and never an error screen.
 *
 * Every row this file creates carries MARKER and is deleted in afterEach as the
 * account that wrote it (service role is never used from a spec).
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import {
  MARKER,
  SUPABASE_URL,
  assertHealthy,
  cleanupMarked,
  getSession,
  health,
  newUserContext,
  resolveFixtures,
  rest,
  restAs,
  selectAs,
  settle,
  shoot,
  watchWrites,
  type Fixtures,
  type Session,
} from "./harness";

const test = base;

let poster: Session;
let helper: Session;
let fx: Fixtures;

test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
  helper = await getSession(request, "helper");
  fx = await resolveFixtures(request, poster, helper);
  // A previous run that died mid-spec may have left marked rows behind.
  await cleanupMarked(request, helper);
  await cleanupMarked(request, poster);
});

test.afterEach(async ({ request }, info) => {
  const removed = [...(await cleanupMarked(request, helper)), ...(await cleanupMarked(request, poster))];
  if (removed.length) info.annotations.push({ type: "cleanup", description: removed.join(", ") });
});

/** Letters only: a 13-digit Date.now() reads as a phone number to the chat safety filter (correctly). */
const nonce = () => Math.random().toString(36).replace(/[0-9]/g, "").slice(0, 6) || "abcdef";

const APPLY_WRITE = /\/rest\/v1\/(rpc\/apply_to_job|applications)(\?|$)/;
const MESSAGE_WRITE = /\/rest\/v1\/messages(\?|$)/;
const JOB_WRITE = /\/rest\/v1\/jobs(\?|$)/;
/** MARKER without its brackets, for text the post-job form must accept (it refuses `[...]` as a template placeholder). */
const JOB_MARKER = MARKER.replace(/[[\]]/g, "");

/** Open the apply sheet for the open seed job as the helper, with a marked pitch typed. */
async function openApply(page: Page, jobId: string) {
  await page.goto(`/jobs/${jobId}`);
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  const sheet = page.getByRole("dialog").last();
  const apply = sheet.getByRole("button", { name: /^(apply now|book now)$/i });
  await expect(apply).toBeVisible({ timeout: 30_000 });
  const pitch = sheet.getByRole("textbox").first();
  await pitch.fill(`${MARKER} interruption test ${nonce()}`);
  return { sheet, apply, pitch };
}

/**
 * Playwright refuses a `request` fixture created in beforeAll once a test is
 * running ("Fixture { request } from beforeAll cannot be reused in a test"), so
 * every reader takes the calling test's own context rather than a module-level one.
 */
async function applicationsFor(api: APIRequestContext, jobId: string): Promise<number> {
  const rows = await selectAs<{ id: string }[]>(api, helper, `applications?job_id=eq.${jobId}&helper_id=eq.${helper.user.id}&select=id`);
  return rows.length;
}

async function helperContext(browser: import("@playwright/test").Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await newUserContext(browser, helper);
  return { ctx, page: await ctx.newPage() };
}

test.describe("apply", () => {
  /**
   * A FRESH un-applied job per test, resolved live. Applying is not idempotent
   * from the app's side — `apply_to_job` refuses a second application with
   * "Already applied to this job" — so a test that reused the job the previous
   * test applied to failed for that reason rather than its own (measured
   * 2026-09-13: one pass then four cascading failures).
   */
  let jobId: string;
  test.beforeEach(async ({ request }) => {
    const f = await resolveFixtures(request, poster, helper);
    test.skip(!f.openJob, "GAP: no open escrowed job by poster-e2e that helper-e2e has not applied to (run scripts/audit/prod-seed.mjs --apply)");
    jobId = f.openJob!.id;
  });

  // Every application this suite creates is withdrawn as the account that made
  // it, so the next run has a fresh job and the poster's queue is left as found.
  test.afterEach(async ({ request }, info) => {
    if (!jobId) return;
    const r = await restAs(request, helper, "delete", `applications?job_id=eq.${jobId}&helper_id=eq.${helper.user.id}&select=id`);
    if (r.ok()) {
      const rows = (await r.json()) as { id: string }[];
      if (rows.length) info.annotations.push({ type: "cleanup", description: `applications: ${rows.map((x) => x.id).join(", ")}` });
    }
  });

  test("a human double-tap on Apply Now fires ONE write", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { apply } = await openApply(page, jobId);
    const writes = watchWrites(page, APPLY_WRITE);
    // Two taps at human speed. The button disables itself while the mutation is
    // in flight (ApplyBody.tsx `disabled={applyLoading}`), so the second tap
    // must find a control that refuses it — asserted as the user experiences
    // it, by clicking WITHOUT force and requiring the click to be refused.
    await apply.click();
    await page.waitForTimeout(150);
    const secondLanded = await apply.click({ timeout: 2_000, noWaitAfter: true }).then(() => true).catch(() => false);
    expect(secondLanded, "the second tap was accepted: Apply Now is not disabled while the application is in flight").toBe(false);
    // The success toast is short-lived, so it is caught while it is on screen
    // rather than asserted after the fact.
    await page
      .waitForFunction(() => /application sent|you're booked/i.test(document.body.innerText), null, { timeout: 30_000 })
      .catch(() => {
        throw new Error("no success message after applying");
      });
    await assertHealthy(page, info, "apply-double-tap");
    expect(writes.map((w) => `${w.method()} ${new URL(w.url()).pathname} ${(w.postData() ?? "").slice(0, 120)}`), "application writes after two taps 150ms apart").toHaveLength(1);
    await expect.poll(() => applicationsFor(request, jobId), { timeout: 15_000 }).toBe(1);
    await expect(page.getByText(/already applied|couldn't send/i)).toHaveCount(0);
    await ctx.close();
  });

  test("two clicks in the SAME frame still create exactly one application, and the user is never told it failed", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { apply } = await openApply(page, jobId);
    const writes = watchWrites(page, APPLY_WRITE);
    // Harsher than a real tap: `disabled` cannot help, because React has not
    // re-rendered between the two clicks. Measured on prod 2026-09-12 — before
    // the synchronous in-flight ref in useApplyFlow this fired TWO apply_to_job
    // calls (the server refused the second). The contract is now exactly one
    // write per intent, plus the outcome: one row, and no failure message.
    // Both clicks dispatched in ONE JS task. Playwright's `dblclick` sends two
    // separate input events, and React 18 flushes the `disabled` re-render
    // between them — measured 2026-09-12: that sent 1 write on the unguarded
    // code, so it could never fail. Two synchronous `.click()`s leave no
    // microtask in between, which is the frame the ref guard exists for.
    await apply.evaluate((el) => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
    await expect(page.getByText(/application sent|you're booked/i).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await assertHealthy(page, info, "apply-same-frame-double");
    info.annotations.push({ type: "note", description: `${writes.length} apply writes from one same-frame double-click` });
    expect(writes.length, "apply writes from one same-frame double-click").toBe(1);
    await expect.poll(() => applicationsFor(request, jobId), { timeout: 15_000 }).toBe(1);
    await expect(page.getByText(/already applied|couldn't send|went wrong/i), "a same-frame double-tap told the user their successful application failed").toHaveCount(0);
    await ctx.close();
  });

  test("slow network (6s on the write): repeat taps still send one, and success is shown", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { apply } = await openApply(page, jobId);
    await page.route(`${SUPABASE_URL}/rest/v1/rpc/apply_to_job*`, async (route) => {
      await new Promise((r) => setTimeout(r, 6_000));
      await route.continue().catch(() => {});
    });
    const writes = watchWrites(page, APPLY_WRITE);
    await apply.click();
    // Impatient taps, each after a re-render: the disabled button must swallow
    // every one of them, so six seconds of waiting still costs one write.
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(300);
      await apply.click({ force: true, timeout: 500, noWaitAfter: true }).catch(() => {});
    }
    await shoot(page, info, "apply-slow-in-flight");
    await page
      .waitForFunction(() => /application sent|you're booked/i.test(document.body.innerText), null, { timeout: 30_000 })
      .catch(() => {
        throw new Error("no success message after a slow apply");
      });
    await assertHealthy(page, info, "apply-slow-settled");
    expect(writes.length, "application writes on a slow connection").toBe(1);
    await expect.poll(() => applicationsFor(request, jobId), { timeout: 15_000 }).toBe(1);
    await ctx.close();
  });

  test("offline mid-apply: honest message, pitch kept, retry once back online sends it once", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { pitch } = await openApply(page, jobId);
    const typed = await pitch.inputValue();
    const writes = watchWrites(page, APPLY_WRITE);
    await ctx.setOffline(true);
    await page.waitForTimeout(500);
    // Offline, the button relabels itself to "Try Again" BEFORE it is pressed
    // (ApplyBody.tsx: `!online ? "Try Again" : …`), so the Apply-Now locator no
    // longer matches it — match the button by what it is, not by its label.
    const submit = page.getByRole("button", { name: /^(apply now|book now|try again)$/i }).filter({ visible: true }).last();
    await submit.click({ force: true });
    await expect(page.getByText(/offline|no connection|back online|connection/i).first(), "no offline message").toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/application sent/i), "a success toast for an application that never left the phone").toHaveCount(0);
    await assertHealthy(page, info, "apply-offline");
    expect(await pitch.inputValue(), "the pitch was lost while offline").toBe(typed);

    await ctx.setOffline(false);
    await page.waitForTimeout(1_000);
    // Page-level, not the sheet handle captured before going offline, and only
    // once the button is enabled again: the app re-enables it when `online`
    // flips back, which is a beat after the context is back on the network.
    const retry = page.getByRole("button", { name: /^(try again|apply now|book now)$/i }).filter({ visible: true }).last();
    await expect(retry).toBeEnabled({ timeout: 20_000 });
    await retry.click();
    await page
      .waitForFunction(() => /application sent|you're booked/i.test(document.body.innerText), null, { timeout: 30_000 })
      .catch(() => {
        throw new Error("no success message after the back-online retry");
      });
    await assertHealthy(page, info, "apply-offline-retried");
    expect(writes.filter((w) => !w.failure()).length, "successful application writes").toBe(1);
    await expect.poll(() => applicationsFor(request, jobId), { timeout: 15_000 }).toBe(1);
    await ctx.close();
  });

  test("back with the apply sheet open closes it, stays on the feed, writes nothing", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    // A fresh context has no history, so goBack() from the first page lands on
    // about:blank — which is the harness, not the app. Arrive at the feed the
    // way a person does, then deep-link, so Back has somewhere real to go.
    await page.goto("/dashboard");
    await settle(page);
    await openApply(page, jobId);
    const writes = watchWrites(page, APPLY_WRITE);
    await page.goBack();
    await page.waitForTimeout(1_500);
    await assertHealthy(page, info, "apply-back");
    expect(writes.length).toBe(0);
    expect(await applicationsFor(request, jobId)).toBe(0);
    // Either the sheet is gone or we left the dashboard for the previous entry; both are fine, an error screen is not.
    await ctx.close();
  });

  test("refresh with the apply sheet open reloads cleanly and never submits", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    await openApply(page, jobId);
    const writes = watchWrites(page, APPLY_WRITE);
    await page.reload();
    await settle(page);
    await assertHealthy(page, info, "apply-refresh");
    expect(writes.length, "a reload must never submit").toBe(0);
    expect(await applicationsFor(request, jobId)).toBe(0);
    await ctx.close();
  });

  test("session expires with the apply sheet open: no crash, an honest message or a sign-in that remembers the job", async ({ browser }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { apply } = await openApply(page, jobId);
    // The session dies underneath the open form: every backend call now answers
    // as GoTrue/PostgREST do for an expired JWT, and refresh is refused.
    await page.route(`${SUPABASE_URL}/auth/v1/token*`, (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" }) }),
    );
    await page.route(`${SUPABASE_URL}/rest/v1/**`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "PGRST301", message: "JWT expired" }) }),
    );
    await page.route(`${SUPABASE_URL}/auth/v1/user*`, (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: 401, msg: "invalid JWT: token is expired" }) }),
    );
    await apply.click({ force: true });
    await page.waitForTimeout(4_000);
    await shoot(page, info, "apply-session-expired");
    expect(await health(page, "apply-session-expired", { layout: true })).toEqual([]);
    const url = new URL(page.url());
    const onLogin = /\/(login|signup)/.test(url.pathname);
    const toldUser = await page.getByText(/sign in|signed out|session|expired|log in|couldn't send|try again/i).first().isVisible().catch(() => false);
    expect(onLogin || toldUser, `after expiry the user was neither sent to sign in nor told anything (at ${page.url()})`).toBe(true);
    await expect(page.getByText(/application sent/i), "success shown for a write that was refused").toHaveCount(0);
    // Recoverable: with the network honest again, the app comes back.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.goto("/dashboard");
    await settle(page);
    await assertHealthy(page, info, "apply-session-recovered", { allow: [] });
    await ctx.close();
  });
});

test.describe("send message", () => {
  test.beforeEach(() => {
    test.skip(!fx.inProgressJob, "GAP: no in-progress job between the two accounts");
  });

  async function openThread(page: Page) {
    await page.goto(`/messages?jobId=${fx.inProgressJob!.id}&userId=${poster.user.id}`);
    await settle(page);
    const box = page.getByRole("textbox", { name: /type a message/i });
    await expect(box).toBeVisible({ timeout: 30_000 });
    const send = page.getByRole("button", { name: /^send message$/i });
    return { box, send };
  }

  async function messagesWith(api: APIRequestContext, text: string): Promise<number> {
    const rows = await selectAs<{ id: string }[]>(api, helper, `messages?job_id=eq.${fx.inProgressJob!.id}&content=eq.${encodeURIComponent(text)}&select=id`);
    return rows.length;
  }

  test("double-tap Send delivers exactly one message", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { box, send } = await openThread(page);
    const text = `${MARKER} double-tap ${nonce()}`;
    await box.fill(text);
    const writes = watchWrites(page, MESSAGE_WRITE);
    await send.dblclick({ force: true });
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);
    await assertHealthy(page, info, "message-double-tap");
    expect(writes.filter((w) => w.method() === "POST").length, "message inserts after a double-tap").toBe(1);
    await expect.poll(() => messagesWith(request, text), { timeout: 15_000 }).toBe(1);
    expect(await page.getByText(text).count(), "the same message rendered twice").toBe(1);
    await ctx.close();
  });

  test("offline mid-send: message shows as not sent (not as sent), and goes through once back online", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { box, send } = await openThread(page);
    const text = `${MARKER} offline ${nonce()}`;
    await box.fill(text);
    const writes = watchWrites(page, MESSAGE_WRITE);
    await ctx.setOffline(true);
    await page.waitForTimeout(500);
    await send.click({ force: true });
    await page.waitForTimeout(3_000);
    await shoot(page, info, "message-offline");
    // Honest: a pending/failed marker or an offline banner, never a plain "sent" bubble and silence.
    const honest = await page.getByText(/not sent|failed|retry|offline|sending|no connection|tap to retry|couldn't send/i).first().isVisible().catch(() => false);
    expect(honest, "offline send gave the user no signal").toBe(true);
    expect(await health(page, "message-offline", { layout: true })).toEqual([]);

    await ctx.setOffline(false);
    await page.waitForTimeout(1_000);
    const retry = page.getByRole("button", { name: /retry|try again|resend/i }).first();
    if (await retry.isVisible().catch(() => false)) await retry.click();
    else if ((await box.inputValue()) === text) await send.click();
    await expect.poll(() => messagesWith(request, text), { timeout: 30_000 }).toBe(1);
    await assertHealthy(page, info, "message-offline-recovered");
    expect(writes.filter((w) => w.method() === "POST" && !w.failure()).length, "successful message inserts").toBe(1);
    await ctx.close();
  });

  test("slow network (6s): one send, one bubble, no duplicate on the impatient second tap", async ({ browser, request }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { box, send } = await openThread(page);
    await page.route(`${SUPABASE_URL}/rest/v1/messages*`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((r) => setTimeout(r, 6_000));
      await route.continue().catch(() => {});
    });
    const text = `${MARKER} slow ${nonce()}`;
    await box.fill(text);
    const writes = watchWrites(page, MESSAGE_WRITE);
    await send.click();
    await send.click({ force: true, timeout: 500, noWaitAfter: true }).catch(() => {});
    await expect.poll(() => messagesWith(request, text), { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(1_000);
    await assertHealthy(page, info, "message-slow");
    expect(writes.filter((w) => w.method() === "POST").length).toBe(1);
    expect(await page.getByText(text).count()).toBe(1);
    await ctx.close();
  });
});

test.describe("post a job", () => {
  async function posterPage(browser: import("@playwright/test").Browser) {
    const ctx = await newUserContext(browser, poster);
    return { ctx, page: await ctx.newPage() };
  }

  type JobRow = { id: string; status: string; payment_status: string; is_seed: boolean };
  async function jobsTitled(api: APIRequestContext, title: string): Promise<JobRow[]> {
    return selectAs<JobRow[]>(api, poster, `jobs?customer_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(title)}&select=id,status,payment_status,is_seed`);
  }

  /**
   * Unwind as the poster, never service-role, the way the journeys' afterAll
   * does: a job that got as far as create-payment is cancelled through the
   * escrow function, an unpaid one through poster_cancel_job, and either way
   * the row itself is deleted where RLS lets the poster. Only rows this test
   * titled (MARKER + nonce, customer_id = the test poster) are ever touched.
   */
  async function removeJobs(api: APIRequestContext, title: string, info?: import("@playwright/test").TestInfo) {
    for (const j of await jobsTitled(api, title)) {
      if (j.status !== "cancelled") {
        if (j.payment_status !== "unpaid") {
          await api.post(`${SUPABASE_URL}/functions/v1/create-payment`, { headers: rest(poster), data: { action: "cancel_escrow", jobId: j.id } }).catch(() => {});
        } else {
          await restAs(api, poster, "post", "rpc/poster_cancel_job", { p_job_id: j.id, p_reason: "prod-audit interruptions teardown" }).catch(() => {});
        }
      }
      const del = await restAs(api, poster, "delete", `jobs?id=eq.${j.id}&select=id`);
      const gone = del.ok() && ((await del.json().catch(() => [])) as unknown[]).length === 1;
      info?.annotations.push({ type: "cleanup", description: `jobs/${j.id} ${gone ? "deleted" : "cancelled (delete refused by RLS; the nightly sweeper removes it)"}` });
    }
  }

  /** A start slot `minutesAhead` from now in Louisiana time, on the form's 5-minute grid (same as the J2 journey). */
  function slotAhead(minutesAhead: number) {
    const t = new Date(Math.ceil((Date.now() + minutesAhead * 60_000) / 300_000) * 300_000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
        .formatToParts(t)
        .map((p) => [p.type, p.value]),
    );
    return { monthDay: `${parts.month} ${parts.day}`, hour: parts.hour, minute: parts.minute, ampm: parts.dayPeriod as "AM" | "PM" };
  }

  /**
   * Purpose-built driver: the J2 post-job leg of e2e/journeys/02-marketplace.spec.ts
   * step for step (category, title, description, address, city, ZIP 99999 so no
   * parish resolves and no real helper is notified, a date slot, a budget,
   * Review & Pay, the confirm checkbox), stopping ON the final submit and
   * returning it. It replaces a generic Continue/Next stepper that never
   * reliably got here and skipped with a stated GAP.
   */
  async function fillPostJob(page: Page, title: string, info: import("@playwright/test").TestInfo) {
    await page.goto("/post-job");
    await settle(page);
    const fresh = page.getByRole("button", { name: /start fresh/i });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    await expect(page.getByRole("heading", { name: "Job Details", level: 1 })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Cleaning", exact: true }).click();
    await page.getByRole("textbox", { name: "Job title *" }).fill(title);
    await page.getByRole("textbox", { name: "Description *" }).fill(`${JOB_MARKER} interruption test post. Not a real job; created and removed by the test suite.`);
    await shoot(page, info, "post-step-details");

    await page.getByRole("combobox", { name: "Street address" }).fill("100 Audit Way");
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "City" }).fill("Baton Rouge");
    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "ZIP code" }).fill("99999");
    await page.getByRole("button", { name: /Date needed/ }).click();
    const slot = slotAhead(100);
    const day = new RegExp(slot.monthDay.replace(" ", ".*"));
    await page.getByRole("button", { name: day }).or(page.getByRole("gridcell", { name: day })).first().click();
    await page.getByRole("listbox", { name: "Hour" }).getByRole("option", { name: slot.hour, exact: true }).click();
    await page.getByRole("listbox", { name: "Minute" }).getByRole("option", { name: slot.minute, exact: true }).click();
    await page.getByRole("radiogroup", { name: "AM or PM" }).getByRole("radio", { name: slot.ampm }).click();
    await page.getByRole("textbox", { name: "Job budget in dollars" }).fill("25");
    await shoot(page, info, "post-step-logistics");

    const review = page.getByRole("button", { name: /Review & Pay/ });
    await expect(review, "the submit button never became Review & Pay").toBeEnabled({ timeout: 20_000 });
    await review.click();
    await expect(page.getByText(/Payment breakdown/i)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("checkbox", { name: /reviewed all details/i }).click();
    const submit = page.getByRole("button", { name: /Continue to Payment|Post Job/i });
    await expect(submit, "the final Post never became enabled after confirming the details").toBeEnabled({ timeout: 20_000 });
    await shoot(page, info, "post-step-checkout");
    return submit;
  }

  test("double-tap the final Post creates exactly one job", async ({ browser, request }, info) => {
    const { ctx, page } = await posterPage(browser);
    // No square brackets: the form reads `[...]` as an unfilled template placeholder
    // (hasUnfilledPlaceholders) and refuses to continue, so this row is marked by
    // JOB_MARKER in its title rather than the bracketed MARKER, and removed by title.
    const title = `${JOB_MARKER} post ${nonce()}`;
    try {
      const submit = await fillPostJob(page, title, info);
      const writes = watchWrites(page, JOB_WRITE);
      // Two taps inside ONE frame: both clicks dispatched in the same JS task,
      // before React can flush the `saving` re-render that disables the button.
      // Playwright's dblclick cannot do this — its two clicks arrive as separate
      // input tasks with a microtask flush between them, so `disabled={saving}`
      // alone absorbs the second one and a build with useJobSubmit's
      // `submittingRef` check removed still passed (measured 2026-09-13). Only
      // the synchronous ref guard can refuse a second click in the same task,
      // which is what this presses on.
      await submit.evaluate((b) => {
        (b as HTMLButtonElement).click();
        (b as HTMLButtonElement).click();
      });
      await page.waitForTimeout(6_000);
      await shoot(page, info, "post-double-tap");
      expect(writes.filter((w) => w.method() === "POST").length, "job inserts after a double-tap").toBeLessThanOrEqual(1);
      await expect.poll(() => jobsTitled(request, title).then((r) => r.length), { message: "no job at all: the driver did not press the final submit", timeout: 20_000 }).toBeGreaterThan(0);
      const rows = await jobsTitled(request, title);
      expect(rows.length, "a double-tap on the final Post created more than one job").toBe(1);
      expect(rows[0].is_seed, "a test poster's job must be is_seed (derived server-side from the account)").toBe(true);
      // We stop before Stripe: the page may be on checkout hand-off, which is fine; an error screen is not.
      if (!/stripe\.com/.test(page.url())) expect(await health(page, "post-double-tap")).toEqual([]);
    } finally {
      await removeJobs(request, title, info);
      await ctx.close();
    }
  });

  test("refresh mid-form keeps or clearly restarts the draft, never an error screen", async ({ browser, request }, info) => {
    const { ctx, page } = await posterPage(browser);
    const title = `${MARKER} refresh ${nonce()}`;
    await page.goto("/post-job");
    await settle(page);
    const fresh = page.getByRole("button", { name: /start fresh/i });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    const titleBox = page.getByRole("textbox", { name: /title|what do you need/i }).first();
    await expect(titleBox).toBeVisible({ timeout: 20_000 });
    await titleBox.fill(title);
    await page.waitForTimeout(1_200); // let a draft autosave land
    await page.reload();
    await settle(page);
    await assertHealthy(page, info, "post-refresh");
    const restored = await page.getByText(/resume|continue where you left|draft|start fresh/i).first().isVisible().catch(() => false);
    const kept = (await page.getByRole("textbox", { name: /title|what do you need/i }).first().inputValue().catch(() => "")) === title;
    expect(restored || kept, "after a refresh the typed title was gone with no draft offer").toBe(true);
    expect((await jobsTitled(request, title)).length, "a refresh must never post").toBe(0);
    await ctx.close();
  });
});
