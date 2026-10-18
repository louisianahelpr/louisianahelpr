import type { APIRequestContext, Browser, Page } from "@playwright/test";
import {
  test,
  expect,
  assertHealthy,
  getSession,
  optionalSession,
  newUserContext,
  rest,
  sessionsAvailable,
  skipUncovered,
  ANON,
  E2E_TITLE_MARKER,
  SUPABASE_URL,
  type Session,
} from "./fixtures";
import { fitJobTitle } from "../../scripts/lib/jobTextBounds.mjs";
import { fund, retireFundedJob, type Row } from "../prod-audit/fundedOpenJob";
import { settleJobForward } from "../../scripts/e2e/settleForward.mjs";
import { slotAhead } from "./postJobForm";
import { withChromium } from "./stripeInChromium";
import { ageJobPastEarlyAccess } from "../ageJobPastEarlyAccess";
import { moveSeedJobStart } from "../moveSeedJobStart";
import { filteredOut, rotationFor, scenarioTitle, type Rotation } from "./scenarios";
import { createThrowaway, deleteThrowaway, serviceKey, type Throwaway } from "./throwaway";
import { srFetch } from "../serviceRoleFetch";
import { cardByTitle, findChip } from "./cardChips";
import { refundToPayerCents } from "../../src/lib/refundAmount";
import { stripeProcessingCostCents } from "../../src/lib/stripeFees";

/**
 * Journeys 9-11: the admin and safety outcomes nothing else drove on the real
 * backend (docs/OPEN.md Q226, Q253).
 *
 *   J9  refunded  — a funded is_seed job; the ADMIN opens it in /admin, issues a
 *                   partial then a full Quick Refund (admin_refund_general)
 *                   through the real dialog; the Stripe TEST refunds, the
 *                   payment_refunds ledger, the job state, the poster's
 *                   notifications and the admin audit rows are asserted.
 *   J10 banned    — a THROWAWAY account (never a shared one) is permanently
 *                   banned by the admin through Suspend / Ban; it lands on
 *                   /account-banned and its writes are refused with
 *                   account_restricted. The Q281 layers (session revoked,
 *                   ungated tables) are asserted once Q281 is on main, and
 *                   reported uncovered until then.
 *   J11 no-show   — poster-e2e hires a THROWAWAY Helpr on a funded job that
 *                   starts minutes later; the Helpr says On My Way and never
 *                   arrives; the poster presses No-Show on the real card. The
 *                   strike lands on the throwaway, never on helper-e2e.
 *
 * Every job carries E2E_TITLE_MARKER and no parish (the Helpr fan-out returns
 * on its first line), so prod-lifecycle-sweeper unwinds a run that dies. Every
 * throwaway is deleted in cleanup and its tables re-read to prove it.
 *
 * Stripe stays in TEST mode: `fund` refuses anything but a cs_test_ session.
 */
// Shown able to fail: send the admin refund to an action that does not exist and J9 goes red on the refused call.
// @mutate src/components/admin/AdminJobs.tsx | action: "admin_refund_general",\n          jobId: detailJob.id, | action: "admin_refund_general_mutant",\n          jobId: detailJob.id,

/** Never the `drops`/`slow` rows: they abort or delay the first write, and these journeys measure money and bans, not the network. */
const rotation: Rotation = { ...rotationFor(4), network: "fast" };
const RUN = Date.now().toString(36).slice(-6);

function title(journey: string, outcome: "refunded" | "no-show" | "smooth", persona: "admin" | "poster-only", state: "approved" | "banned") {
  return scenarioTitle({ journey, persona, state, rotation, jobType: "set-price", outcome });
}

type JobRow = { id: string; status: string; payment_status: string | null; helper_id: string | null; parish: string | null; is_seed: boolean };

async function readJob(api: APIRequestContext, s: Session, id: string): Promise<JobRow> {
  const r = await api.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${id}&select=id,status,payment_status,helper_id,parish,is_seed`, { headers: rest(s) });
  expect(r.ok(), `reading job ${id}: ${r.status()}`).toBe(true);
  const rows = (await r.json()) as JobRow[];
  expect(rows, `job ${id} not readable`).toHaveLength(1);
  return rows[0];
}

/** Insert a poster-e2e job the way the canary does (parish null, is_seed), optionally starting at a set Central time. */
async function postJob(api: APIRequestContext, poster: Session, jobTitle: string, start?: { isoDay: string; hh24: string }): Promise<JobRow> {
  const r = await api.post(`${SUPABASE_URL}/rest/v1/jobs?select=id,status,payment_status,helper_id,parish,is_seed`, {
    headers: rest(poster, { Prefer: "return=representation" }),
    data: {
      customer_id: poster.user.id,
      title: jobTitle,
      description: "Automated journey job. If you are reading this in the app, something is wrong with the test harness.",
      category: "cleaning",
      budget: 25,
      location: "4412 Highland Rd, Baton Rouge, LA 70808",
      date_needed: start?.isoDay ?? slotAhead(3 * 24 * 60).isoDay,
      ...(start ? { start_time: `${start.hh24}:00` } : {}),
      status: "open",
      payment_status: "unpaid",
      pricing_mode: "set_price",
      parish: null,
      is_seed: true,
    },
  });
  expect(r.ok(), `posting ${jobTitle}: ${r.status()} ${await r.text()}`).toBe(true);
  const [job] = (await r.json()) as JobRow[];
  expect(job.parish, "parish must stay null or the Helpr fan-out fires").toBeNull();
  expect(job.is_seed, "the job must be is_seed").toBe(true);
  return job;
}

/**
 * Fund on Stripe TEST (4242). A live-mode session is never paid: `fund()`
 * skips it itself through `skipLivePay` (the owner's 2026-09-27 decision),
 * before `payCheckout`'s cs_test_ refusal could fire — so the old catch that
 * turned that refusal into `skipUncovered` here was unreachable.
 */
async function fundJob(api: APIRequestContext, browser: Browser, poster: Session, jobId: string, log: string[]) {
  // Paid in Chromium in every engine: Stripe's hosted page errors in
  // Playwright's WebKit (withChromium, ./stripeInChromium.ts).
  await withChromium(browser, (chrome) => fund(api, chrome, poster, { id: jobId } as Row, log));
}

/** Mark read, then delete, the notifications a journey produced for `s` on `jobId`. */
async function clearNotifications(api: APIRequestContext, s: Session, jobFilter: string): Promise<number> {
  const q = `notifications?user_id=eq.${s.user.id}&${jobFilter}&select=id`;
  await api.patch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: rest(s), data: { read: true } });
  const del = await api.delete(`${SUPABASE_URL}/rest/v1/${q}`, { headers: rest(s, { Prefer: "return=representation" }) });
  expect(del.ok(), `deleting notifications: ${del.status()} ${await del.text()}`).toBe(true);
  return ((await del.json()) as unknown[]).length;
}

/** Q281 landed = the ban writers set auth.users.banned_until. Read from THIS checkout's migrations, the same tree CI deploys. */
test.describe.serial("admin and safety journeys", () => {
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);

  const j9 = title("admin-refund", "refunded", "admin", "approved");
  test(j9, async ({ browser, request, journey }) => {
    test.skip(filteredOut(j9), "SCENARIO pins another scenario");
    test.setTimeout(8 * 60_000);
    const poster = await getSession(request, "poster");
    const admin = await optionalSession(request, "admin");
    if (!admin) skipUncovered("Admin refund journey not run", "no admin session here (PLAYWRIGHT_ADMIN_EMAIL/_PASSWORD or a local .env)");
    const JOB_TITLE = fitJobTitle(`${E2E_TITLE_MARKER} rf ${RUN}`);
    const log: string[] = [];
    let jobId = "";

    await test.step("a funded is_seed job exists (Stripe TEST, 4242)", async () => {
      jobId = (await postJob(request, poster, JOB_TITLE)).id;
      journey.cleanup("poster refund notifications", async () => {
        const n = await clearNotifications(request, poster, `link=eq.${encodeURIComponent(`/posts?job=${jobId}`)}`);
        test.info().annotations.push({ type: "cleanup", description: `${n} poster notifications deleted` });
      });
      // LIFO: runs before the notification sweep. A run that dies after funding
      // but before the full refund leaves open/escrow; return that money.
      journey.cleanup("return a still-held escrow", async () => {
        const j = await readJob(request, poster, jobId);
        if (j.status === "open" && j.payment_status === "escrow" && !j.helper_id) {
          test.info().annotations.push({ type: "cleanup", description: await retireFundedJob(request, poster, jobId) });
        }
      });
      await fundJob(request, browser, poster, jobId, log);
      expect((await readJob(request, poster, jobId)).payment_status).toBe("escrow");
    });

    const ctx = await newUserContext(browser, admin, { desktop: true });
    const page = journey.track("admin", await ctx.newPage());
    journey.cleanup("admin context", () => ctx.close());

    const refund = async (amount: string | null, reason: string) => {
      await page.goto(`/admin?view=jobs&job=${jobId}`);
      const detail = page.getByRole("dialog").filter({ hasText: JOB_TITLE }).first();
      await expect(detail, "the job detail never opened from ?job=").toBeVisible({ timeout: 60_000 });
      await detail.getByRole("button", { name: "Refund Poster" }).click();
      const dlg = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Issue Refund" }) }).first();
      await expect(dlg).toBeVisible({ timeout: 20_000 });
      if (amount) await dlg.getByLabel("Refund amount").fill(amount);
      await dlg.getByLabel("Refund reason (optional)").fill(reason);
      await journey.milestone(page, amount ? "refund-dialog-partial" : "refund-dialog-full");
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/functions/v1/create-payment") && r.request().method() === "POST", { timeout: 90_000 }),
        dlg.getByRole("button", { name: "Issue Refund" }).click(),
      ]);
      expect(resp.status(), `admin_refund_general answered ${resp.status()} ${await resp.text().catch(() => "")}`).toBe(200);
      await expect(dlg, "the refund dialog stayed open after a 200").toBeHidden({ timeout: 20_000 });
      await assertHealthy(page, "after refund");
    };

    type RefundRow = { stripe_refund_id: string; amount_cents: number; is_partial: boolean; source: string; reason: string | null };
    const refunds = async () => {
      const r = await request.get(
        `${SUPABASE_URL}/rest/v1/payment_refunds?job_id=eq.${jobId}&select=stripe_refund_id,amount_cents,is_partial,source,reason&order=created_at.asc`,
        { headers: rest(poster) },
      );
      expect(r.ok()).toBe(true);
      return (await r.json()) as RefundRow[];
    };

    await test.step("admin issues a $5 partial refund: job stays funded", async () => {
      await refund("5", `E2E partial ${RUN}`);
      await expect.poll(async () => (await refunds()).length, { timeout: 30_000, message: "no payment_refunds row for the partial" }).toBe(1);
      const [p] = await refunds();
      expect(p).toMatchObject({ amount_cents: 500, is_partial: true, source: "admin_refund_general", reason: `E2E partial ${RUN}` });
      expect(p.stripe_refund_id, "not a Stripe refund id").toMatch(/^re_/);
      const job = await readJob(request, poster, jobId);
      expect([job.status, job.payment_status], "a partial refund must leave the job running").toEqual(["open", "escrow"]);
    });

    await test.step("admin issues the full refund: job cancelled + refunded", async () => {
      await refund(null, `E2E full ${RUN}`);
      await expect
        .poll(async () => { const j = await readJob(request, poster, jobId); return `${j.status}/${j.payment_status}`; }, { timeout: 30_000 })
        .toBe("cancelled/refunded");
      const rows = await refunds();
      expect(rows, "two Stripe refunds on the ledger").toHaveLength(2);
      // Every refund keeps the card processing fee since a173ae28e (owner,
      // 2026-10-14, Q1735: "we should never absorb any fee"), so the full
      // refund leaves the fee on the charge and the ledger calls it what Stripe
      // sees, a partial, worded as the full refund it is (nightly-red #2436,
      // e2e-journeys 38749234414 / 38882683467 read the old is_partial false).
      expect(rows[1]).toMatchObject({ is_partial: true, source: "admin_refund_general" });
      expect(rows[1].reason ?? "", "the full refund's ledger row does not say the card fee was kept").toMatch(/full refund less the card processing fee/);
      expect(rows[1].stripe_refund_id).toMatch(/^re_/);
      // Exactly what the refund rule leaves: the capture less the card fee kept
      // (Stripe's 2.9% + 30c on it, a173ae28e: "we should never absorb any fee")
      // less the $5 already returned. A journey job carries no card surcharge
      // (customer_fee_amount 0, platform_fee_percent 0 since 2026-10-11), so
      // the capture is the $25 budget: measured in e2e-journeys 39004547274,
      // PaymentIntent amount 2500, refunds 500 + 1897 (nightly-red #2436; the
      // old ">= 2000" predates the kept fee).
      const fees = await request.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&select=budget,customer_fee_amount,urgent_fee`, { headers: rest(poster) });
      const [priced] = (await fees.json()) as Array<{ budget: number; customer_fee_amount: number | null; urgent_fee: number | null }>;
      expect([Number(priced.customer_fee_amount ?? 0), Number(priced.urgent_fee ?? 0)], "the expected amount assumes a capture of the budget alone").toEqual([0, 0]);
      const captured = Math.round(Number(priced.budget) * 100);
      const expected = refundToPayerCents({ capturedCents: captured, actualFeeCents: stripeProcessingCostCents(captured), alreadyRefundedCents: 500 }).refundCents;
      expect(rows[1].amount_cents, "the full refund is the capture less the kept card fee less the partial").toBe(expected);
      await journey.milestone(page, "admin-after-full-refund");
    });

    await test.step("the poster is told once per refund, with a link to the job", async () => {
      // Q1714: ONE notice per refund (in the app and by email), claimed on the
      // refund's id, so the charge.refunded webhook no longer adds a second
      // "Refund processed" for the same refund (that was Q300).
      const r = await request.get(
        `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${poster.user.id}&link=like.${encodeURIComponent(`/posts?job=${jobId}&refund=*`)}&select=title,message,type&order=created_at.asc`,
        { headers: rest(poster) },
      );
      const notes = (await r.json()) as { title: string; message: string; type: string }[];
      expect(notes, `refund notices: ${notes.map((n) => n.title).join(", ")}`).toHaveLength(2);
      for (const n of notes) {
        expect(n.title).toMatch(/^Refund issued: \$/);
        expect(n.type).toBe("payment");
        expect(n.message).toMatch(/refund reference re_/);
        expect(n.message).toMatch(/5-10 business days/);
      }
      const others = await request.get(
        `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${poster.user.id}&job_id=eq.${jobId}&title=in.(%22Refund%20processed%22,%22Partial%20refund%20issued%22,%22Refund%20issued%22)&select=title`,
        { headers: rest(poster) },
      );
      expect((await others.json()) as unknown[], "no second, old-style refund notice").toHaveLength(0);
    });

    await test.step("both moves are on the admin audit log", async () => {
      const r = await request.get(
        `${SUPABASE_URL}/rest/v1/admin_audit_log?target_id=eq.${jobId}&select=action,admin_id&order=created_at.asc`,
        { headers: rest(admin!) },
      );
      const rows = (await r.json()) as { action: string; admin_id: string }[];
      expect(rows.map((x) => x.action)).toEqual(["job_admin_refund_partial", "job_admin_refund"]);
      expect(rows.every((x) => x.admin_id === admin!.user.id)).toBe(true);
    });

    await test.step("the poster's card shows it cancelled", async () => {
      const pctx = await newUserContext(browser, poster, { rotation });
      journey.cleanup("poster context", () => pctx.close());
      const pp = journey.track("poster", await pctx.newPage());
      await pp.goto(`/posts?job=${jobId}`);
      await expect(pp.getByText(JOB_TITLE).first(), "the refunded job is missing from My Posts").toBeVisible({ timeout: 60_000 });
      await assertHealthy(pp, "my posts after refund");
      await journey.milestone(pp, "poster-refunded-job");
    });
    test.info().annotations.push({ type: "fixture", description: log.join("; ") });
  });

  const j10 = title("ban-enforcement", "smooth", "admin", "banned");
  test(j10, async ({ browser, request, journey }) => {
    test.skip(filteredOut(j10), "SCENARIO pins another scenario");
    test.setTimeout(6 * 60_000);
    const key = serviceKey();
    if (!key) {
      const why = "SUPABASE_SERVICE_ROLE_KEY is not available (env or .env): the ban journey cannot create its throwaway account.";
      if (process.env.CI) throw new Error(why);
      skipUncovered("Ban journey not run", why);
    }
    const admin = await optionalSession(request, "admin");
    if (!admin) skipUncovered("Ban journey not run", "no admin session here");
    const poster = await getSession(request, "poster");
    let victim: Throwaway | null = null;
    journey.cleanup("delete the throwaway", async () => {
      if (!victim) return;
      const lines = await deleteThrowaway(key!, victim.userId);
      test.info().annotations.push({ type: "cleanup", description: lines.join("; ") });
    });

    await test.step("a throwaway account exists and can write", async () => {
      victim = await createThrowaway(request, key!, `Ban ${RUN}`);
      const r = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id`, {
        headers: rest(victim.session, { Prefer: "return=representation" }),
        data: {
          customer_id: victim.userId, title: fitJobTitle(`${E2E_TITLE_MARKER} ctl ${RUN}`), description: "Ban journey positive control.",
          category: "cleaning", budget: 25, location: "4412 Highland Rd, Baton Rouge, LA 70808", date_needed: slotAhead(3 * 24 * 60).isoDay,
          status: "open", payment_status: "unpaid", pricing_mode: "set_price", parish: null, is_seed: true,
        },
      });
      expect(r.status(), `positive control: an unbanned throwaway could not post a job: ${await r.text()}`).toBe(201);
    });
    const v = victim!;
    const vctx = await newUserContext(browser, v.session, { rotation });
    journey.cleanup("throwaway context", () => vctx.close());
    const vp = journey.track("throwaway", await vctx.newPage());

    await test.step("before the ban it is inside the app", async () => {
      await vp.goto("/home");
      await expect(vp).toHaveURL(/\/home/, { timeout: 30_000 });
      await assertHealthy(vp, "throwaway dashboard");
      await journey.milestone(vp, "throwaway-before-ban");
    });

    await test.step("the admin bans it permanently through Suspend / Ban", async () => {
      const actx = await newUserContext(browser, admin, { desktop: true });
      journey.cleanup("admin context", () => actx.close());
      const ap = journey.track("admin", await actx.newPage());
      await ap.goto(`/admin?view=people&user=${v.userId}`);
      // The dialog shows a formatted name ("SEED e."), so it is found by its title.
      const detail = ap.getByRole("dialog", { name: "User Profile" }).first();
      await expect(detail, "the user's detail never opened from ?user=").toBeVisible({ timeout: 60_000 });
      await detail.getByRole("button", { name: /Suspend \/ Ban/ }).click();
      const ban = ap.getByRole("dialog").filter({ has: ap.getByRole("radiogroup", { name: "Action type" }) }).first();
      await expect(ban).toBeVisible({ timeout: 20_000 });
      await ban.getByRole("radio", { name: /Perm Ban/ }).click();
      await ban.getByLabel("Reason note").fill(`E2E ban journey ${RUN}`);
      await journey.milestone(ap, "ban-dialog");
      await ban.getByRole("button", { name: "Permanently Ban" }).click();
      await expect(ban).toBeHidden({ timeout: 30_000 });
      const r = await srFetch(key!, "GET", `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${v.userId}&select=ban_status`);
      expect(((await r.json()) as { ban_status: string }[])[0]?.ban_status).toBe("permanently_banned");
      await assertHealthy(ap, "admin after ban");
    });

    await test.step("the banned account lands on /account-banned", async () => {
      await vp.goto("/home");
      await expect(vp, "a banned account was let into /home").toHaveURL(/\/account-banned/, { timeout: 30_000 });
      await vp.goto("/post-job");
      await expect(vp, "a banned account was let into /post-job").toHaveURL(/\/account-banned/, { timeout: 30_000 });
      await assertHealthy(vp, "account-banned");
      await journey.milestone(vp, "account-banned");
    });

    await test.step("its gated writes are refused with account_restricted", async () => {
      const job = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id`, {
        headers: rest(v.session, { Prefer: "return=representation" }),
        data: {
          customer_id: v.userId, title: fitJobTitle(`${E2E_TITLE_MARKER} bp ${RUN}`), description: "Must be refused.",
          category: "cleaning", budget: 25, location: "4412 Highland Rd, Baton Rouge, LA 70808", date_needed: slotAhead(3 * 24 * 60).isoDay,
          status: "open", payment_status: "unpaid", pricing_mode: "set_price", parish: null, is_seed: true,
        },
      });
      const jobBody = await job.text();
      expect(job.status(), `a banned account posted a job: ${jobBody}`).toBe(403);
      expect(jobBody).toContain("account_restricted");
      const [own] = (await (await srFetch(key!, "GET", `${SUPABASE_URL}/rest/v1/jobs?customer_id=eq.${v.userId}&select=id`)).json()) as { id: string }[];
      const msg = await request.post(`${SUPABASE_URL}/rest/v1/messages?select=id`, {
        headers: rest(v.session, { Prefer: "return=representation" }),
        data: { job_id: own.id, sender_id: v.userId, receiver_id: poster.user.id, content: `ban journey ${RUN}` },
      });
      const msgBody = await msg.text();
      expect(msg.status(), `a banned account sent a message: ${msgBody}`).toBe(403);
      expect(msgBody).toContain("account_restricted");
    });

    await test.step("Q281 layers: the session survives, and every table refuses its writes", async () => {
      // Owner decision (Q281/Q294, 2026-09-23): a banned account KEEPS sign-in,
      // so it can reach Account Suspended (delete + support); the DB gates
      // refuse everything else. Nothing sets auth.users.banned_until (live
      // check 2026-09-30: no public function mentions it). This step used to
      // assert the refresh was REFUSED, gated on a grep of the migrations for
      // "banned_until" — which matched the comment in
      // 20260923185224_ban_enforcement_everywhere.sql explaining why it is
      // never set, so run 36561180641 asserted the opposite of the decision.
      const refresh = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        headers: { apikey: ANON, "Content-Type": "application/json" },
        data: { refresh_token: v.session.refresh_token },
      });
      expect(refresh.ok(), `a banned account lost sign-in, against the owner's Q281 decision: ${await refresh.text()}`).toBe(true);
      const saved = await request.post(`${SUPABASE_URL}/rest/v1/saved_searches?select=id`, {
        headers: rest(v.session, { Prefer: "return=representation" }),
        data: { user_id: v.userId, name: `ban journey ${RUN}` },
      });
      expect(saved.ok(), `a banned account saved a search: ${await saved.text()}`).toBe(false);
    });
  });

  const j11 = title("no-show", "no-show", "poster-only", "approved");
  test(j11, async ({ browser, request, journey }) => {
    test.skip(filteredOut(j11), "SCENARIO pins another scenario");
    test.setTimeout(10 * 60_000);
    const key = serviceKey();
    if (!key) {
      const why = "SUPABASE_SERVICE_ROLE_KEY is not available (env or .env): the no-show journey cannot create its throwaway Helpr.";
      if (process.env.CI) throw new Error(why);
      skipUncovered("No-show journey not run", why);
    }
    const poster = await getSession(request, "poster");
    const JOB_TITLE = fitJobTitle(`${E2E_TITLE_MARKER} ns ${RUN}`);
    const log: string[] = [];
    let helpr: Throwaway | null = null;
    let jobId = "";
    // LIFO: the throwaway goes last, after the job is unwound.
    journey.cleanup("delete the throwaway Helpr", async () => {
      if (!helpr) return;
      const lines = await deleteThrowaway(key!, helpr.userId);
      test.info().annotations.push({ type: "cleanup", description: lines.join("; ") });
    });
    journey.cleanup("unwind the job and its notifications", async () => {
      if (!jobId) return;
      const job = await readJob(request, poster, jobId);
      if (job.payment_status === "escrow" && !job.helper_id && job.status === "open") {
        const r = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, { headers: rest(poster), data: { action: "cancel_escrow", jobId } });
        if (!r.ok()) throw new Error(`cancel_escrow ${jobId}: ${r.status()} ${await r.text()}`);
      } else if (job.payment_status === "escrow" && helpr && job.helper_id === helpr.userId) {
        // Died between the hire and the no-show: the job is still hired by the
        // throwaway. cancel_escrow refuses a hired job and poster_cancel_job
        // strikes poster-e2e, so it is settled FORWARD (the 04-money-outcomes
        // disposition) before the throwaway is deleted.
        const out = await settleJobForward({
          base: SUPABASE_URL, anon: ANON, posterToken: poster.access_token, helperToken: helpr.session.access_token,
          posterId: poster.user.id, helperId: helpr.userId, jobId,
        });
        test.info().annotations.push({ type: "cleanup", description: `settle forward: ${out.reason} (${out.status}/${out.paymentStatus})` });
      }
      // Every notification the journey fanned out on this job, any recipient
      // (the client alerts every admin), by service role: none is a real event.
      const del = await srFetch(key!, "DELETE", `${SUPABASE_URL}/rest/v1/notifications?job_id=eq.${jobId}&select=id`, { extra: { Prefer: "return=representation" } });
      if (!del.ok()) throw new Error(`deleting job notifications: ${del.status()} ${await del.text()}`);
      const n = ((await del.json()) as unknown[]).length;
      const after = await readJob(request, poster, jobId);
      test.info().annotations.push({ type: "cleanup", description: `job ${after.status}/${after.payment_status}; ${n} notifications deleted` });
    });

    // 20+ minutes out: accept_application refuses a hire within 15 minutes of
    // the start (job_starts_too_soon, e2e-journeys 39071660168). Once hired,
    // the harness moves the start to ~90 s ahead (moveSeedJobStart).
    const slot = slotAhead(20);
    let startAt = slot.at;
    await test.step("poster-e2e funds a job starting in 20 minutes; a throwaway Helpr is hired, the start moves up, and the Helpr heads out", async () => {
      helpr = await createThrowaway(request, key!, `NoShow ${RUN}`);
      jobId = (await postJob(request, poster, JOB_TITLE, slot)).id;
      await fundJob(request, browser, poster, jobId, log);
      // Harness concession (02-marketplace's): age past the 20-min early-access
      // window, as the service role since created_at is server-owned (Q1189, #2436).
      await ageJobPastEarlyAccess(SUPABASE_URL, jobId, "the no-show job");
      const h = helpr.session;
      const applied = await request.post(`${SUPABASE_URL}/rest/v1/rpc/apply_to_job`, {
        headers: rest(h),
        data: { p_job_id: jobId, p_message: `No-show journey ${RUN}: I can do this.` },
      });
      expect(applied.ok(), `apply_to_job: ${applied.status()} ${await applied.text()}`).toBe(true);
      const apps = (await (await request.get(`${SUPABASE_URL}/rest/v1/applications?job_id=eq.${jobId}&helper_id=eq.${helpr.userId}&select=id`, { headers: rest(h) })).json()) as { id: string }[];
      expect(apps).toHaveLength(1);
      const accepted = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_application`, {
        headers: rest(poster),
        data: { p_application_id: apps[0].id, p_deadline: new Date(Date.now() + 60 * 60_000).toISOString() },
      });
      expect(accepted.ok(), `accept_application: ${accepted.status()} ${await accepted.text()}`).toBe(true);
      // The app's Accept (Q1180): accept_job_offer completes a ready Helpr's
      // accept at once (a seed throwaway is ready by helper_accept_missing's
      // carve-out) and tells the poster, by name, in the same transaction.
      const acceptedOffer = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_job_offer`, { headers: rest(h), data: { p_job_id: jobId } });
      expect(acceptedOffer.ok(), `accept_job_offer: ${acceptedOffer.status()} ${await acceptedOffer.text()}`).toBe(true);
      expect(await acceptedOffer.json(), "the Helpr's accept did not complete").toEqual({ state: "accepted" });
      const told = (await (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${poster.user.id}&job_id=eq.${jobId}&select=title`, { headers: rest(poster) })).json()) as { title: string }[];
      expect(told.map((n) => n.title), "the poster was not told the offer was accepted").toContainEqual(expect.stringMatching(/ accepted your offer$/));
      // Harness concession (moveSeedJobStart, is_seed only): the hire is
      // done, so the start moves to ~90 s ahead instead of waiting 20 min.
      startAt = await moveSeedJobStart(SUPABASE_URL, jobId, 90_000, "the no-show job");
      const otw = await request.post(`${SUPABASE_URL}/rest/v1/rpc/helper_mark_on_the_way`, { headers: rest(h), data: { p_job_id: jobId } });
      expect(otw.ok(), `helper_mark_on_the_way: ${otw.status()} ${await otw.text()}`).toBe(true);
      const job = await readJob(request, poster, jobId);
      expect([job.status, job.payment_status, job.helper_id]).toEqual(["in_progress", "escrow", helpr.userId]);
    });

    const pctx = await newUserContext(browser, poster, { rotation });
    journey.cleanup("poster context", () => pctx.close());
    const pp = journey.track("poster", await pctx.newPage());

    await test.step("before the start, No-Show is not offered", async () => {
      await openCard(pp, jobId, JOB_TITLE);
      if (Date.now() < startAt.getTime() - 20_000) {
        // On the row OR in More: a count on the card alone would pass with the
        // chip parked in the overflow (journeyChipsReachOverflow.test.ts).
        expect(await findChip(pp, cardByTitle(pp, JOB_TITLE), /^No-Show/, 3_000), "No-Show offered before the scheduled start").toBeNull();
      }
      await journey.milestone(pp, "before-start");
    });

    await test.step("after the start, the poster reports the no-show", async () => {
      const wait = startAt.getTime() + 15_000 - Date.now();
      if (wait > 0) await pp.waitForTimeout(wait);
      await openCard(pp, jobId, JOB_TITLE);
      const chip = await findChip(pp, cardByTitle(pp, JOB_TITLE), /^No-Show/, 30_000);
      expect(chip, "No-Show is not offered after the start with no arrival, on the row or in More").not.toBeNull();
      await chip!.click();
      const dlg = pp.getByRole("dialog").filter({ hasText: "Report No-Show" }).first();
      await expect(dlg).toBeVisible();
      await journey.milestone(pp, "no-show-dialog");
      const [resp] = await Promise.all([
        pp.waitForResponse((r) => r.url().includes("/rpc/report_helper_no_show"), { timeout: 30_000 }),
        dlg.getByRole("button", { name: "Confirm No-Show" }).click(),
      ]);
      expect(resp.status(), `report_helper_no_show answered ${resp.status()} ${await resp.text().catch(() => "")}`).toBe(200);
      await expect(pp.getByText(/No-show reported/).first(), "no confirmation toast").toBeVisible({ timeout: 20_000 });
      await assertHealthy(pp, "after no-show");
      await journey.milestone(pp, "no-show-reported");
    });

    await test.step("the job reopens, the strike lands on the Helpr, both are told", async () => {
      const job = await readJob(request, poster, jobId);
      expect([job.status, job.helper_id, job.payment_status], "the job must reopen with its escrow").toEqual(["open", null, "escrow"]);
      const h = helpr!;
      const viol = (await (await request.get(`${SUPABASE_URL}/rest/v1/user_violations?user_id=eq.${h.userId}&select=violation_type,job_id,reported_by,action_taken`, { headers: rest(h.session) })).json()) as Record<string, string>[];
      expect(viol).toEqual([{ violation_type: "no_show", job_id: jobId, reported_by: poster.user.id, action_taken: "warning" }]);
      const prof = (await (await srFetch(key!, "GET", `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${h.userId}&select=ban_status`)).json()) as { ban_status: string }[];
      expect(prof[0].ban_status, "a first no-show is the warning rung").toBe("final_warning");
      const told = (await (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${h.userId}&select=title`, { headers: rest(h.session) })).json()) as { title: string }[];
      expect(told.map((n) => n.title), "the Helpr was not told").toContain("⚠️ No-show warning");
      const helperE2e = await getSession(request, "helper");
      const shared = (await (await request.get(`${SUPABASE_URL}/rest/v1/user_violations?user_id=eq.${helperE2e.user.id}&job_id=eq.${jobId}&select=id`, { headers: rest(helperE2e) })).json()) as unknown[];
      expect(shared, "the strike must never land on helper-e2e").toHaveLength(0);
    });

    await test.step("the reopened job is back on the poster's desk", async () => {
      await openCard(pp, jobId, JOB_TITLE);
      expect(await findChip(pp, cardByTitle(pp, JOB_TITLE), /^No-Show/, 3_000), "the reopened job still offers No-Show").toBeNull();
      await assertHealthy(pp, "reopened job");
      await journey.milestone(pp, "reopened");
    });
    test.info().annotations.push({ type: "fixture", description: log.join("; ") });
  });
});

/** My Posts deep link to one job card. */
async function openCard(page: Page, jobId: string, jobTitle: string) {
  await page.goto(`/posts?job=${jobId}`);
  await expect(page.getByText(jobTitle).first(), `${jobTitle} is missing from My Posts`).toBeVisible({ timeout: 60_000 });
  // OPEN it, and prove it opened (02-marketplace's card()). Every card renders
  // COLLAPSED and a collapsed card has no step chips, so No-Show could never be
  // found on it: e2e-journeys 39073227265 failed "No-Show is not offered" on a
  // shut card, and the before-start "not offered" check passed vacuously.
  const card = cardByTitle(page, jobTitle);
  const progress = card.getByRole("group", { name: /Job progress/ });
  if (!(await progress.isVisible().catch(() => false))) await card.getByRole("heading", { name: jobTitle, level: 2 }).click();
  await expect(progress, `${jobTitle}'s card did not open when its heading was clicked`).toBeVisible({ timeout: 30_000 });
}
