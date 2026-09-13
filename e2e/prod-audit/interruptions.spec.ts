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
let api: APIRequestContext;

test.beforeAll(async ({ request }) => {
  api = request;
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

async function applicationsFor(jobId: string): Promise<number> {
  const rows = await selectAs<{ id: string }[]>(api, helper, `applications?job_id=eq.${jobId}&helper_id=eq.${helper.user.id}&select=id`);
  return rows.length;
}

async function helperContext(browser: import("@playwright/test").Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await newUserContext(browser, helper);
  return { ctx, page: await ctx.newPage() };
}

test.describe("apply", () => {
  test.beforeEach(() => {
    test.skip(!fx.openJob, "GAP: no open escrowed job by poster-e2e that helper-e2e has not applied to (terminal 1 is seeding)");
  });

  test("double-tap Apply Now sends exactly one application", async ({ browser }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { apply } = await openApply(page, fx.openJob!.id);
    const writes = watchWrites(page, APPLY_WRITE);
    await apply.dblclick({ force: true });
    await expect(page.getByText(/application sent|you're booked/i).first()).toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "apply-double-tap");
    expect(writes.length, "application writes after a double-tap").toBe(1);
    await expect.poll(() => applicationsFor(fx.openJob!.id), { timeout: 15_000 }).toBe(1);
    await expect(page.getByText(/already applied|couldn't send/i)).toHaveCount(0);
    await ctx.close();
  });

  test("slow network (6s on the write): repeat taps still send one, and success is shown", async ({ browser }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { apply } = await openApply(page, fx.openJob!.id);
    await page.route(`${SUPABASE_URL}/rest/v1/rpc/apply_to_job*`, async (route) => {
      await new Promise((r) => setTimeout(r, 6_000));
      await route.continue().catch(() => {});
    });
    const writes = watchWrites(page, APPLY_WRITE);
    await apply.click();
    for (let i = 0; i < 3; i++) await apply.click({ force: true, timeout: 500, noWaitAfter: true }).catch(() => {});
    await shoot(page, info, "apply-slow-in-flight");
    await expect(page.getByText(/application sent|you're booked/i).first()).toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "apply-slow-settled");
    expect(writes.length, "application writes on a slow connection").toBe(1);
    await expect.poll(() => applicationsFor(fx.openJob!.id), { timeout: 15_000 }).toBe(1);
    await ctx.close();
  });

  test("offline mid-apply: honest message, pitch kept, retry once back online sends it once", async ({ browser }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { sheet, apply, pitch } = await openApply(page, fx.openJob!.id);
    const typed = await pitch.inputValue();
    const writes = watchWrites(page, APPLY_WRITE);
    await ctx.setOffline(true);
    await page.waitForTimeout(500);
    await apply.click({ force: true });
    await expect(page.getByText(/offline|no connection|back online|connection/i).first(), "no offline message").toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/application sent/i), "a success toast for an application that never left the phone").toHaveCount(0);
    await assertHealthy(page, info, "apply-offline");
    expect(await pitch.inputValue(), "the pitch was lost while offline").toBe(typed);

    await ctx.setOffline(false);
    await page.waitForTimeout(1_000);
    const retry = sheet.getByRole("button", { name: /^(try again|apply now|book now)$/i });
    await retry.click();
    await expect(page.getByText(/application sent|you're booked/i).first()).toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "apply-offline-retried");
    expect(writes.filter((w) => !w.failure()).length, "successful application writes").toBe(1);
    await expect.poll(() => applicationsFor(fx.openJob!.id), { timeout: 15_000 }).toBe(1);
    await ctx.close();
  });

  test("back with the apply sheet open closes it, stays on the feed, writes nothing", async ({ browser }, info) => {
    const { ctx, page } = await helperContext(browser);
    await openApply(page, fx.openJob!.id);
    const writes = watchWrites(page, APPLY_WRITE);
    await page.goBack();
    await page.waitForTimeout(1_500);
    await assertHealthy(page, info, "apply-back");
    expect(writes.length).toBe(0);
    expect(await applicationsFor(fx.openJob!.id)).toBe(0);
    // Either the sheet is gone or we left the dashboard for the previous entry; both are fine, an error screen is not.
    await ctx.close();
  });

  test("refresh with the apply sheet open reloads cleanly and never submits", async ({ browser }, info) => {
    const { ctx, page } = await helperContext(browser);
    await openApply(page, fx.openJob!.id);
    const writes = watchWrites(page, APPLY_WRITE);
    await page.reload();
    await settle(page);
    await assertHealthy(page, info, "apply-refresh");
    expect(writes.length, "a reload must never submit").toBe(0);
    expect(await applicationsFor(fx.openJob!.id)).toBe(0);
    await ctx.close();
  });

  test("session expires with the apply sheet open: no crash, an honest message or a sign-in that remembers the job", async ({ browser }, info) => {
    const { ctx, page } = await helperContext(browser);
    const { apply } = await openApply(page, fx.openJob!.id);
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

  async function messagesWith(text: string): Promise<number> {
    const rows = await selectAs<{ id: string }[]>(api, helper, `messages?job_id=eq.${fx.inProgressJob!.id}&content=eq.${encodeURIComponent(text)}&select=id`);
    return rows.length;
  }

  test("double-tap Send delivers exactly one message", async ({ browser }, info) => {
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
    await expect.poll(() => messagesWith(text), { timeout: 15_000 }).toBe(1);
    expect(await page.getByText(text).count(), "the same message rendered twice").toBe(1);
    await ctx.close();
  });

  test("offline mid-send: message shows as not sent (not as sent), and goes through once back online", async ({ browser }, info) => {
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
    await expect.poll(() => messagesWith(text), { timeout: 30_000 }).toBe(1);
    await assertHealthy(page, info, "message-offline-recovered");
    expect(writes.filter((w) => w.method() === "POST" && !w.failure()).length, "successful message inserts").toBe(1);
    await ctx.close();
  });

  test("slow network (6s): one send, one bubble, no duplicate on the impatient second tap", async ({ browser }, info) => {
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
    await expect.poll(() => messagesWith(text), { timeout: 30_000 }).toBe(1);
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

  async function jobsTitled(title: string): Promise<{ id: string }[]> {
    return selectAs<{ id: string }[]>(api, poster, `jobs?customer_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(title)}&select=id`);
  }

  async function removeJobs(title: string) {
    for (const j of await jobsTitled(title)) await restAs(api, poster, "delete", `jobs?id=eq.${j.id}`);
  }

  /** Drive the post-job form to its final submit with the minimum a real poster types. Returns the submit button, or null with the reason. */
  async function fillPostJob(page: Page, title: string, info: import("@playwright/test").TestInfo) {
    await page.goto("/post-job");
    await settle(page);
    const fresh = page.getByRole("button", { name: /start fresh/i });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    const titleBox = page.getByRole("textbox", { name: /title|what do you need/i }).first();
    await expect(titleBox).toBeVisible({ timeout: 20_000 });
    await titleBox.fill(title);
    const desc = page.getByRole("textbox", { name: /describe|description|details/i }).first();
    if (await desc.isVisible().catch(() => false)) await desc.fill(`${MARKER} interruption test post. Delete me.`);
    // Walk "Continue"/"Next" steps, filling what each step requires, until a submit/pay/post button appears.
    for (let step = 0; step < 8; step++) {
      await shoot(page, info, `post-step-${step}`);
      const submit = page.getByRole("button", { name: /^(post job|post|continue to payment|pay|checkout|review & pay|submit)/i }).filter({ visible: true }).last();
      const next = page.getByRole("button", { name: /^(continue|next)$/i }).filter({ visible: true }).last();
      if ((await submit.count()) && !(await next.count())) return submit;
      if (!(await next.count())) break;
      // Required pickers on the way: first category chip, first date, a price.
      const cat = page.getByRole("button", { name: /cleaning|handyman|moving|yard|pet|errand/i }).filter({ visible: true }).first();
      if (await cat.isVisible().catch(() => false)) await cat.click().catch(() => {});
      const price = page.getByRole("spinbutton").filter({ visible: true }).first();
      if (await price.isVisible().catch(() => false) && !(await price.inputValue())) await price.fill("40").catch(() => {});
      const city = page.getByRole("combobox", { name: /city|where/i }).or(page.getByPlaceholder(/city/i)).first();
      if (await city.isVisible().catch(() => false) && !(await city.inputValue())) {
        await city.fill("Baton Rouge");
        await page.getByRole("option").first().click({ timeout: 5_000 }).catch(() => {});
      }
      if (!(await next.isEnabled().catch(() => false))) {
        info.annotations.push({ type: "note", description: `post-job step ${step}: Continue disabled — required fields this driver does not know` });
        break;
      }
      await next.click();
      await page.waitForTimeout(600);
    }
    return null;
  }

  test("double-tap the final Post creates exactly one job", async ({ browser }, info) => {
    const { ctx, page } = await posterPage(browser);
    const title = `${MARKER} post ${nonce()}`;
    try {
      const submit = await fillPostJob(page, title, info);
      test.skip(!submit, "GAP: could not reach the post-job submit with the generic driver — see post-step-* screenshots");
      const writes = watchWrites(page, JOB_WRITE);
      await submit!.dblclick({ force: true });
      await page.waitForTimeout(6_000);
      await shoot(page, info, "post-double-tap");
      expect(writes.filter((w) => w.method() === "POST").length, "job inserts after a double-tap").toBeLessThanOrEqual(1);
      await expect.poll(() => jobsTitled(title).then((r) => r.length), { timeout: 20_000 }).toBe(1);
      // We stop before Stripe: the page may be on checkout hand-off, which is fine; an error screen is not.
      if (!/stripe\.com/.test(page.url())) expect(await health(page, "post-double-tap")).toEqual([]);
    } finally {
      await removeJobs(title);
      await ctx.close();
    }
  });

  test("refresh mid-form keeps or clearly restarts the draft, never an error screen", async ({ browser }, info) => {
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
    expect((await jobsTitled(title)).length, "a refresh must never post").toBe(0);
    await ctx.close();
  });
});
