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
import { fund, type Row } from "../prod-audit/fundedOpenJob";
import { slotAhead } from "./postJobForm";
import { filteredOut, rotationFor, scenarioTitle, type Rotation } from "./scenarios";
import { createThrowaway, deleteThrowaway, serviceKey, sr, type Throwaway } from "./throwaway";

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
// @mutate src/components/admin/AdminJobs.tsx | action: "admin_refund_general", | action: "admin_refund_general_mutant",

/** Never the `drops`/`slow` rows: they abort or delay the first write, and these journeys measure money and bans, not the network. */
const rotation: Rotation = { ...rotationFor(4), network: "fast" };
const RUN = Date.now().toString(36).slice(-6);

function title(journey: string, persona: "admin" | "poster-only", state: "approved" | "banned", outcome: "refunded" | "no-show" | "smooth") {
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
      location: "Baton Rouge, LA",
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

/** Fund on Stripe TEST (4242). A live-mode session is reported uncovered, never paid. */
async function fundJob(api: APIRequestContext, browser: Browser, poster: Session, jobId: string, log: string[]) {
  try {
    await fund(api, browser, poster, { id: jobId } as Row, log);
  } catch (e) {
    if (/not a cs_test_ session/.test(String(e))) skipUncovered("Journey funding SKIPPED", `Stripe is not in test mode: ${String(e).slice(0, 160)}`);
    throw e;
  }
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
async function q281Landed(): Promise<boolean> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = "supabase/migrations";
  return readdirSync(dir).some((f) => f.endsWith(".sql") && /banned_until/.test(readFileSync(`${dir}/${f}`, "utf8")));
}

test.describe.serial("admin and safety journeys", () => {
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);

  const j9 = title("admin-refund", "admin", "approved", "refunded");
  test(j9, async ({ browser, request, journey }) => {
    test.skip(filteredOut(j9), "SCENARIO pins another scenario");
    test.setTimeout(8 * 60_000);
    const poster = await getSession(request, "poster");
    const admin = await optionalSession(request, "admin");
    if (!admin) skipUncovered("Admin refund journey not run", "no admin session here (PLAYWRIGHT_ADMIN_EMAIL/_PASSWORD or a local .env)");
    const JOB_TITLE = `${E2E_TITLE_MARKER} refund ${RUN}`;
    const log: string[] = [];
    let jobId = "";

    await test.step("a funded is_seed job exists (Stripe TEST, 4242)", async () => {
      jobId = (await postJob(request, poster, JOB_TITLE)).id;
      journey.cleanup("poster refund notifications", async () => {
        const n = await clearNotifications(request, poster, `link=eq.${encodeURIComponent(`/my-posts?job=${jobId}`)}`);
        test.info().annotations.push({ type: "cleanup", description: `${n} poster notifications deleted` });
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
      expect(rows[1]).toMatchObject({ is_partial: false, source: "admin_refund_general" });
      expect(rows[1].stripe_refund_id).toMatch(/^re_/);
      // The remainder of a capture of at least the $25 budget.
      expect(rows[1].amount_cents, "the full refund returned less than the budget minus the partial").toBeGreaterThanOrEqual(2000);
      await journey.milestone(page, "admin-after-full-refund");
    });

    await test.step("the poster is told twice, with a link to the job", async () => {
      const r = await request.get(
        `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${poster.user.id}&link=eq.${encodeURIComponent(`/my-posts?job=${jobId}`)}&select=title,type&order=created_at.asc`,
        { headers: rest(poster) },
      );
      const titles = ((await r.json()) as { title: string }[]).map((n) => n.title);
      expect(titles.slice(0, 2)).toEqual(["Partial refund issued", "Refund issued"]);
      // The stripe-webhook charge.refunded handler ALSO writes "Refund processed"
      // for the same full refund (measured on the first run, 2026-09-23): one
      // refund, two notifications. Filed as Q300; when it is fixed this list
      // is exactly the two above and the line below is deleted.
      expect(titles.slice(2).every((t) => t === "Refund processed"), `unexpected refund notifications: ${titles.join(", ")}`).toBe(true);
      if (titles.length > 2) test.info().annotations.push({ type: "known-defect", description: `Q300: ${titles.length} refund notifications for 2 refunds: ${titles.join(", ")}` });
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
      await pp.goto(`/my-posts?job=${jobId}`);
      await expect(pp.getByText(JOB_TITLE).first(), "the refunded job is missing from My Posts").toBeVisible({ timeout: 60_000 });
      await assertHealthy(pp, "my posts after refund");
      await journey.milestone(pp, "poster-refunded-job");
    });
    test.info().annotations.push({ type: "fixture", description: log.join("; ") });
  });

  const j10 = title("ban-enforcement", "admin", "banned", "smooth");
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
      const lines = await deleteThrowaway(request, key!, victim.userId);
      test.info().annotations.push({ type: "cleanup", description: lines.join("; ") });
    });

    await test.step("a throwaway account exists and can write", async () => {
      victim = await createThrowaway(request, key!, `Ban ${RUN}`);
      const r = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id`, {
        headers: rest(victim.session, { Prefer: "return=representation" }),
        data: {
          customer_id: victim.userId, title: `${E2E_TITLE_MARKER} ban ctl ${RUN}`, description: "Ban journey positive control.",
          category: "cleaning", budget: 25, location: "Baton Rouge, LA", date_needed: slotAhead(3 * 24 * 60).isoDay,
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
      await vp.goto("/dashboard");
      await expect(vp).toHaveURL(/\/dashboard/, { timeout: 30_000 });
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
      const r = await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${v.userId}&select=ban_status`, { headers: sr(key!) });
      expect(((await r.json()) as { ban_status: string }[])[0]?.ban_status).toBe("permanently_banned");
      await assertHealthy(ap, "admin after ban");
    });

    await test.step("the banned account lands on /account-banned", async () => {
      await vp.goto("/dashboard");
      await expect(vp, "a banned account was let into /dashboard").toHaveURL(/\/account-banned/, { timeout: 30_000 });
      await vp.goto("/post-job");
      await expect(vp, "a banned account was let into /post-job").toHaveURL(/\/account-banned/, { timeout: 30_000 });
      await assertHealthy(vp, "account-banned");
      await journey.milestone(vp, "account-banned");
    });

    await test.step("its gated writes are refused with account_restricted", async () => {
      const job = await request.post(`${SUPABASE_URL}/rest/v1/jobs?select=id`, {
        headers: rest(v.session, { Prefer: "return=representation" }),
        data: {
          customer_id: v.userId, title: `${E2E_TITLE_MARKER} ban post ${RUN}`, description: "Must be refused.",
          category: "cleaning", budget: 25, location: "Baton Rouge, LA", date_needed: slotAhead(3 * 24 * 60).isoDay,
          status: "open", payment_status: "unpaid", pricing_mode: "set_price", parish: null, is_seed: true,
        },
      });
      const jobBody = await job.text();
      expect(job.status(), `a banned account posted a job: ${jobBody}`).toBe(403);
      expect(jobBody).toContain("account_restricted");
      const [own] = (await (await request.get(`${SUPABASE_URL}/rest/v1/jobs?customer_id=eq.${v.userId}&select=id`, { headers: sr(key!) })).json()) as { id: string }[];
      const msg = await request.post(`${SUPABASE_URL}/rest/v1/messages?select=id`, {
        headers: rest(v.session, { Prefer: "return=representation" }),
        data: { job_id: own.id, sender_id: v.userId, receiver_id: poster.user.id, content: `ban journey ${RUN}` },
      });
      const msgBody = await msg.text();
      expect(msg.status(), `a banned account sent a message: ${msgBody}`).toBe(403);
      expect(msgBody).toContain("account_restricted");
    });

    await test.step("Q281 layers: the session is revoked and ungated tables refuse too", async () => {
      if (!(await q281Landed())) {
        test.info().annotations.push({
          type: "uncovered",
          description: "Q281 is not on main yet (no migration sets auth.users.banned_until): the banned session's refresh grant and saved_searches write are not asserted. They are asserted automatically once it lands.",
        });
        return;
      }
      const refresh = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        headers: { apikey: ANON, "Content-Type": "application/json" },
        data: { refresh_token: v.session.refresh_token },
      });
      expect(refresh.ok(), "a banned account refreshed its session").toBe(false);
      const saved = await request.post(`${SUPABASE_URL}/rest/v1/saved_searches?select=id`, {
        headers: rest(v.session, { Prefer: "return=representation" }),
        data: { user_id: v.userId, name: `ban journey ${RUN}` },
      });
      expect(saved.ok(), `a banned account saved a search: ${await saved.text()}`).toBe(false);
    });
  });

  const j11 = title("no-show", "poster-only", "approved", "no-show");
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
    const JOB_TITLE = `${E2E_TITLE_MARKER} noshow ${RUN}`;
    const log: string[] = [];
    let helpr: Throwaway | null = null;
    let jobId = "";
    // LIFO: the throwaway goes last, after the job is unwound.
    journey.cleanup("delete the throwaway Helpr", async () => {
      if (!helpr) return;
      const lines = await deleteThrowaway(request, key!, helpr.userId);
      test.info().annotations.push({ type: "cleanup", description: lines.join("; ") });
    });
    journey.cleanup("unwind the job and its notifications", async () => {
      if (!jobId) return;
      const job = await readJob(request, poster, jobId);
      if (job.payment_status === "escrow" && !job.helper_id && job.status === "open") {
        const r = await request.post(`${SUPABASE_URL}/functions/v1/create-payment`, { headers: rest(poster), data: { action: "cancel_escrow", jobId } });
        if (!r.ok()) throw new Error(`cancel_escrow ${jobId}: ${r.status()} ${await r.text()}`);
      }
      // Every notification the journey fanned out on this job, any recipient
      // (the client alerts every admin), by service role: none is a real event.
      const del = await request.delete(`${SUPABASE_URL}/rest/v1/notifications?job_id=eq.${jobId}&select=id`, { headers: sr(key!, { Prefer: "return=representation" }) });
      if (!del.ok()) throw new Error(`deleting job notifications: ${del.status()} ${await del.text()}`);
      const n = ((await del.json()) as unknown[]).length;
      const after = await readJob(request, poster, jobId);
      test.info().annotations.push({ type: "cleanup", description: `job ${after.status}/${after.payment_status}; ${n} notifications deleted` });
    });

    const slot = slotAhead(4);
    await test.step("poster-e2e funds a job starting in 4 minutes; a throwaway Helpr is hired and heads out", async () => {
      helpr = await createThrowaway(request, key!, `NoShow ${RUN}`);
      jobId = (await postJob(request, poster, JOB_TITLE, slot)).id;
      await fundJob(request, browser, poster, jobId, log);
      // Harness concession (02-marketplace's): age past the 20-min early-access window.
      const aged = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&select=id`, {
        headers: rest(poster, { Prefer: "return=representation" }),
        data: { created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
      });
      expect(await aged.json(), "ageing the job matched zero rows").toHaveLength(1);
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
      const confirmed = await request.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}&status=eq.accepted&helper_confirmed_at=is.null&select=id`, {
        headers: rest(h, { Prefer: "return=representation" }),
        data: { helper_confirmed_at: new Date().toISOString(), response_deadline: null },
      });
      expect(await confirmed.json(), `the Helpr's confirm matched no row (${confirmed.status()})`).toHaveLength(1);
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
      if (Date.now() < slot.at.getTime() - 20_000) {
        await expect(pp.getByRole("button", { name: /^No-Show/ }), "No-Show offered before the scheduled start").toHaveCount(0);
      }
      await journey.milestone(pp, "before-start");
    });

    await test.step("after the start, the poster reports the no-show", async () => {
      const wait = slot.at.getTime() + 15_000 - Date.now();
      if (wait > 0) await pp.waitForTimeout(wait);
      await openCard(pp, jobId, JOB_TITLE);
      const chip = pp.getByRole("button", { name: /^No-Show/ }).first();
      await expect(chip, "No-Show is not offered after the start with no arrival").toBeVisible({ timeout: 30_000 });
      await chip.click();
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
      const prof = (await (await request.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${h.userId}&select=ban_status`, { headers: sr(key!) })).json()) as { ban_status: string }[];
      expect(prof[0].ban_status, "a first no-show is the warning rung").toBe("final_warning");
      const told = (await (await request.get(`${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${h.userId}&select=title`, { headers: rest(h.session) })).json()) as { title: string }[];
      expect(told.map((n) => n.title), "the Helpr was not told").toContain("⚠️ No-show warning");
      const helperE2e = await getSession(request, "helper");
      const shared = (await (await request.get(`${SUPABASE_URL}/rest/v1/user_violations?user_id=eq.${helperE2e.user.id}&job_id=eq.${jobId}&select=id`, { headers: rest(helperE2e) })).json()) as unknown[];
      expect(shared, "the strike must never land on helper-e2e").toHaveLength(0);
    });

    await test.step("the reopened job is back on the poster's desk", async () => {
      await openCard(pp, jobId, JOB_TITLE);
      await expect(pp.getByRole("button", { name: /^No-Show/ })).toHaveCount(0);
      await assertHealthy(pp, "reopened job");
      await journey.milestone(pp, "reopened");
    });
    test.info().annotations.push({ type: "fixture", description: log.join("; ") });
  });
});

/** My Posts deep link to one job card. */
async function openCard(page: Page, jobId: string, jobTitle: string) {
  await page.goto(`/my-posts?job=${jobId}`);
  await expect(page.getByText(jobTitle).first(), `${jobTitle} is missing from My Posts`).toBeVisible({ timeout: 60_000 });
}
