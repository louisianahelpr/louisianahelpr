/**
 * DEEP LINKS on prod — the URLs a real person taps from a push, a text or an
 * email: /jobs/:id, /j/:id, /messages/:id, /u/:id, /profile?tab=…, signed in
 * and signed out, including a job that is gone. Each must land on a real
 * screen (or the sign-in that returns them there), never an error screen or a
 * 404. Drives the deployed app as the shared test accounts (no mocks).
 */
import { test as base, expect } from "@playwright/test";
import {
  assertHealthy,
  getSession,
  newUserContext,
  resolveFixtures,
  settle,
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
});

test.describe("signed out", () => {
  for (const [from, intended] of [
    ["/jobs/{open}", "/jobs/{open}"],
    ["/j/{open}", "/jobs/{open}"],
    ["/messages/{open}", "/messages?jobId={open}"],
    ["/u/{poster}", "/user/{poster}"],
    ["/profile?tab=earnings", "/profile?tab=earnings"],
    ["/jobs/{gone}", "/jobs/{gone}"],
  ] as const) {
    test(`${from} → sign in, remembering where they were headed`, async ({ browser }, info) => {
      const sub = (s: string) => s.replace("{open}", fx.openJob?.id ?? fx.goneJobId).replace("{gone}", fx.goneJobId).replace("{poster}", poster.user.id);
      const ctx = await newUserContext(browser, null);
      const page = await ctx.newPage();
      await page.goto(sub(from));
      await page.waitForURL(/\/(login|signup)\?redirect=/, { timeout: 30_000 });
      const redirect = new URL(page.url()).searchParams.get("redirect");
      expect(redirect, `redirect param after ${from}`).toBe(sub(intended));
      await settle(page);
      await assertHealthy(page, info, `signed-out ${from}`);
      await ctx.close();
    });
  }

  test("/j/<not-a-shape> renders the designed 404, not a crash", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, null);
    const page = await ctx.newPage();
    await page.goto("/messages/a/b/c");
    await settle(page);
    await assertHealthy(page, info, "signed-out bad shape", { allow: ["404 on a real route"] });
    await expect(page.getByRole("link", { name: /home|browse|back/i }).first()).toBeVisible();
    await ctx.close();
  });
});

test.describe("signed in (helper)", () => {
  test("/jobs/:id from a notification opens that job's sheet", async ({ browser }, info) => {
    test.skip(!fx.openJob, "GAP: no open escrowed job by poster-e2e without an application from helper-e2e (terminal 1 is seeding)");
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/jobs/${fx.openJob!.id}`);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole("dialog").getByText(fx.openJob!.title).first(), "the job sheet did not open").toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "job-open");
    await ctx.close();
  });

  test("/j/:id share link opens that job's sheet", async ({ browser }, info) => {
    test.skip(!fx.openJob, "GAP: no open escrowed job to open");
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/j/${fx.openJob!.id}`);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByRole("dialog").getByText(fx.openJob!.title).first()).toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "share-open");
    await ctx.close();
  });

  test("/jobs/:id for a job that is gone says so in plain words, and the feed stays usable", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/jobs/${fx.goneJobId}`);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    // The honest outcome is a toast/inline note, never silence and never a crash.
    await expect(page.getByText(/no longer|isn't available|not available|gone|removed|couldn't find|not found|filled|closed/i).first(), "no message for a gone job").toBeVisible({ timeout: 20_000 });
    await assertHealthy(page, info, "gone-job");
    expect(new URL(page.url()).searchParams.get("quickApply"), "?quickApply was not cleared").toBeNull();
    await ctx.close();
  });

  test("/jobs/:id of your OWN post goes to My Posts, highlighted", async ({ browser }, info) => {
    test.skip(!fx.openJob, "GAP: poster-e2e has no open job");
    const ctx = await newUserContext(browser, poster);
    const page = await ctx.newPage();
    await page.goto(`/jobs/${fx.openJob!.id}`);
    await page.waitForURL(/\/my-posts/, { timeout: 30_000 });
    await expect(page.getByText(fx.openJob!.title).first()).toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "own-post");
    await ctx.close();
  });

  test("/messages/:id (a notification's jobId-only link) opens that thread when it is the only one for the job", async ({ browser }, info) => {
    test.skip(!fx.threadJob, "GAP: no message thread between the two accounts");
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/messages/${fx.threadJob!.id}`);
    await page.waitForURL(/\/messages\?jobId=/, { timeout: 30_000 });
    await settle(page);
    await assertHealthy(page, info, "messages-thread");
    await expect(page.getByRole("textbox", { name: /type a message/i }), "the thread composer did not open").toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });

  test("/messages?jobId=&userId= with no thread yet opens a fresh thread with that person", async ({ browser }, info) => {
    test.skip(!fx.inProgressJob, "GAP: no in-progress job between the two accounts");
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/messages?jobId=${fx.inProgressJob!.id}&userId=${poster.user.id}`);
    await settle(page);
    await assertHealthy(page, info, "messages-placeholder");
    await expect(page.getByRole("textbox", { name: /type a message/i }), "no composer for a new thread").toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });

  test("/messages/<gone job id> leaves the inbox usable", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/messages/${fx.goneJobId}`);
    await settle(page);
    await assertHealthy(page, info, "messages-gone");
    await expect(page.getByRole("heading", { name: /messages/i }).first()).toBeVisible();
    await ctx.close();
  });

  test("/u/:id opens the other person's profile", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/u/${poster.user.id}`);
    await page.waitForURL(new RegExp(`/user/${poster.user.id}`), { timeout: 30_000 });
    await settle(page);
    await assertHealthy(page, info, "user-profile");
    await ctx.close();
  });

  test("/u/<unknown id> is a designed empty state, not a crash", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/u/${fx.goneJobId}`);
    await settle(page);
    await assertHealthy(page, info, "user-gone", { allow: ["404 on a real route"] });
    await ctx.close();
  });

  for (const tab of ["earnings", "notifications", "security", "gift_card", "legal", "not-a-real-tab"]) {
    test(`/profile?tab=${tab} lands on Profile`, async ({ browser }, info) => {
      const ctx = await newUserContext(browser, helper);
      const page = await ctx.newPage();
      await page.goto(`/profile?tab=${tab}`);
      await expect(page).toHaveURL(/\/profile/);
      await settle(page);
      await assertHealthy(page, info, `profile-${tab}`);
      await ctx.close();
    });
  }
});
