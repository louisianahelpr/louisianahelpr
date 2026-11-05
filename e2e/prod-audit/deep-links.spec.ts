/**
 * DEEP LINKS on prod — the URLs a real person taps from a push, a text or an
 * email: /jobs/:id, /messages?jobId=, /user/:id, /profile?tab=…, signed in
 * and signed out, including a job that is gone. The short shapes /j/:id,
 * /messages/:id and /u/:id were deleted with Q194 (2026-09-23): nothing we
 * ship mints them, and every link now names the current page directly. Each must land on a real
 * screen (or the sign-in that returns them there), never an error screen or a
 * 404. Drives the deployed app as the shared test accounts (no mocks).
 */
// Shown able to fail on the contract it exists for: a link must land on the
// person it names. Move the /user/:userId route and "/user/:id opens the other
// person's profile" stops seeing the poster's page — it waits out
// `waitForURL(/user/<posterId>/)` on the 404 and fails.
// @mutate src/App.tsx | <Route path="/user/:userId" | <Route path="/users/:userId"
import { test as base, expect } from "../prodTest";
import {
  assertHealthy,
  ensureFundedOpenJob,
  skipWhenUnfundedLive,
  unlessLivePay,
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
/** Q865: why setup did not fund the open job (Stripe live), or null. Only the tests that open it skip. */
let livePay: string | null = null;

test.beforeAll(async ({ request, browser }, info) => {
  // Q100: a real Stripe TEST checkout when no valid funded fixture exists.
  // Its failure THROWS here, failing the file rather than skipping it.
  test.setTimeout(30 * 60_000); // a fresh fixture waits out the 20-minute early-access window
  poster = await getSession(request, "poster");
  helper = await getSession(request, "helper");
  const funded = await unlessLivePay(() => ensureFundedOpenJob(request, browser, poster, helper));
  livePay = funded.livePay;
  info.annotations.push({ type: "funded-fixture", description: funded.value?.log.join("; ") ?? `not funded: ${livePay}` });
  fx = await resolveFixtures(request, poster, helper);
});

test.describe("signed out", () => {
  // A shared job link is NOT a login wall since dc5c71d5bf (owner 10-30: "show jobs to guests"; /jobs/:id is
  // <ProtectedRoute allowGuest>): a guest stays on /jobs/:id and sees the job's preview, or, for a job that is gone or
  // no longer browsable, "This job isn't available." with a way to open Jobs. The old "-> sign in" rows for
  // /jobs/{open} and /jobs/{gone} read the 09-02 rule and kept this file red before any mutation (vacuity 41940585801
  // leg 3: INCONCLUSIVE), so its /user/:userId @mutate proved nothing.
  for (const which of ["open", "gone"] as const) {
    test(`/jobs/{${which}} → a guest stays on the job link and sees the job or that it is gone, never a login wall`, async ({ browser }, info) => {
      const job = which === "open" ? fx.openJob : null;
      const id = job?.id ?? fx.goneJobId;
      const ctx = await newUserContext(browser, null);
      const page = await ctx.newPage();
      await page.goto(`/jobs/${id}`);
      await settle(page);
      expect(new URL(page.url()).pathname, `a guest on /jobs/{${which}} was moved off the link`).toBe(`/jobs/${id}`);
      // The open fixture is shown only while it is browsable (open_jobs_browse); either face is a real screen.
      const face = job
        ? page.getByText(job.title).first().or(page.getByText("This job isn't available.").first())
        : page.getByText("This job isn't available.").first();
      await expect(face, `guest /jobs/{${which}}: no job and no not-available screen`).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel(/^password$/i), "a guest job link met a login form").toHaveCount(0);
      await assertHealthy(page, info, `signed-out /jobs/{${which}}`);
      await ctx.close();
    });
  }

  for (const [from, intended] of [
    ["/messages?jobId={open}", "/messages?jobId={open}"],
    ["/user/{poster}", "/user/{poster}"],
    ["/profile?tab=earnings", "/profile?tab=earnings"],
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

  test("an unknown path renders the designed 404, not a crash", async ({ browser }, info) => {
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
  // J2 (2026-10-20): /jobs/:id is the job's own page for a signed-in member; its Apply opens the quick-apply sheet.
  test("/jobs/:id from a notification opens the job page, and Apply opens that job's sheet", async ({ browser }, info) => {
    skipWhenUnfundedLive(fx.openJob, livePay, "this test opens the funded open job");
    test.skip(!fx.openJob, "GAP: no open escrowed job by poster-e2e without an application from helper-e2e (terminal 1 is seeding)");
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/jobs/${fx.openJob!.id}`);
    await expect(page.getByRole("button", { name: "Apply", exact: true }), "the job page has no Apply").toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe(`/jobs/${fx.openJob!.id}`);
    await assertHealthy(page, info, "job-page");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForURL(/\/home/, { timeout: 30_000 });
    await expect(page.getByRole("dialog").getByText(fx.openJob!.title).first(), "the job sheet did not open").toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "job-open");
    await ctx.close();
  });

  test("/jobs/:id?ref=share share link opens the job page", async ({ browser }, info) => {
    skipWhenUnfundedLive(fx.openJob, livePay, "this test opens the funded open job");
    test.skip(!fx.openJob, "GAP: no open escrowed job to open");
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/jobs/${fx.openJob!.id}?ref=share`);
    await expect(page.getByRole("heading", { name: fx.openJob!.title }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
    await assertHealthy(page, info, "share-open");
    await ctx.close();
  });

  test("/jobs/:id for a job that is gone says so in plain words", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/jobs/${fx.goneJobId}`);
    // The honest outcome is a toast/inline note, never silence and never a crash.
    await expect(page.getByText(/no longer|isn't available|not available|gone|removed|couldn't find|not found|filled|closed/i).first(), "no message for a gone job").toBeVisible({ timeout: 20_000 });
    await assertHealthy(page, info, "gone-job");
    expect(new URL(page.url()).searchParams.get("quickApply"), "?quickApply was not cleared").toBeNull();
    await ctx.close();
  });

  test("/jobs/:id of your OWN post opens the poster's job page, which opens it in Posted", async ({ browser }, info) => {
    skipWhenUnfundedLive(fx.openJob, livePay, "this test opens the funded open job");
    test.skip(!fx.openJob, "GAP: poster-e2e has no open job");
    const ctx = await newUserContext(browser, poster);
    const page = await ctx.newPage();
    await page.goto(`/jobs/${fx.openJob!.id}`);
    await expect(page.getByText("Your budget").first(), "not the poster's job page").toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^(Review \d+ applicants?|Manage job)$/ }).first().click();
    await page.waitForURL(/\/posts/, { timeout: 30_000 });
    await expect(page.getByText(fx.openJob!.title).first()).toBeVisible({ timeout: 30_000 });
    await assertHealthy(page, info, "own-post");
    await ctx.close();
  });

  test("/messages?jobId= (a notification's jobId-only link) opens that thread when it is the only one for the job", async ({ browser }, info) => {
    test.skip(!fx.threadJob, "GAP: no message thread between the two accounts");
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/messages?jobId=${fx.threadJob!.id}`);
    await page.waitForURL(/\/messages\?jobId=/, { timeout: 30_000 });
    await settle(page);
    await assertHealthy(page, info, "messages-thread");
    // The link lands IN that thread: its composer, or, when the job's messaging has closed (completed 24 h+ ago,
    // or cancelled), the read-only notice that replaces it (ChatComposer threadClosed). The fixture is the newest job
    // the two accounts talked on, and those are finished chain jobs: read-only 2026-11-05 06:15Z the poster's three
    // newest thread jobs were all completed, the newest 2026-11-04 00:20Z (26 h before vacuity 41940585801 ran it),
    // so the old composer-only check could never pass. The inbox list has neither, so this still fails off-thread.
    await expect(
      page.getByRole("textbox", { name: /type a message/i }).or(page.getByTestId("thread-closed-notice")).first(),
      "the jobId link did not open that thread (no composer and no closed-thread notice)",
    ).toBeVisible({ timeout: 30_000 });
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

  test("/messages?jobId=<gone job id> leaves the inbox usable", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/messages?jobId=${fx.goneJobId}`);
    await settle(page);
    await assertHealthy(page, info, "messages-gone");
    await expect(page.getByRole("heading", { name: /messages/i }).first()).toBeVisible();
    await ctx.close();
  });

  test("/user/:id opens the other person's profile", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/user/${poster.user.id}`);
    await page.waitForURL(new RegExp(`/user/${poster.user.id}`), { timeout: 30_000 });
    await settle(page);
    await assertHealthy(page, info, "user-profile");
    await ctx.close();
  });

  test("/user/<unknown id> is a designed empty state, not a crash", async ({ browser }, info) => {
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/user/${fx.goneJobId}`);
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
