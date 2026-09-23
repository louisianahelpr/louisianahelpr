/**
 * THE HOURLY CORE-LOOP CANARY (docs/OPEN.md Q61).
 *
 * The full journeys run nightly, so a broken core loop could sit unseen for
 * 20+ hours. This is the smallest real walk of that loop, run every hour by
 * .github/workflows/core-loop-canary.yml against this commit's LOCAL build
 * (never the deployed site: src/test/noTestTrafficOnVercel.test.ts) and the
 * REAL backend, as the two shared test accounts:
 *
 *   sign in (poster + helper) -> browse -> open a job -> apply -> message
 *     -> checkout start (Stripe TEST mode, never paid) -> clean up
 *
 * Every step is a named `step(...)` below; src/test/coreLoopCanary.test.ts
 * holds the loop's step list and fails in both directions if the two disagree.
 *
 * NOTHING HERE IS HAND-ROLLED BESIDE THE EXISTING HARNESS. Sessions,
 * contexts and REST helpers are e2e/prod-audit/harness.ts (itself
 * e2e/journeys/fixtures.ts); the apply target is the prod-audit FUNDED OPEN
 * JOB FIXTURE (`ensureFundedOpenJob`, Q100): an is_seed job of poster-e2e,
 * paid on Stripe TEST, that helper-e2e has not applied to. The browse / open /
 * apply locators are the ones e2e/journeys/02-marketplace.spec.ts drives.
 *
 * WHAT A RUN LEAVES BEHIND: NOTHING NEW. Clean-up is in `finally`, so it runs
 * on a red run too, and it is VERIFIED — the run re-reads every table it
 * wrote and fails if a row survived:
 *   applications   the helper's pitch (carries MARKER) — deleted as the helper
 *                  ("Helpers can delete their own pending applications").
 *   messages       the poster's message (carries MARKER) — deleted as the
 *                  poster ("Users can delete their own sent messages").
 *   notifications  what those two writes fan out to either account, on the
 *                  canary's jobs since the run started — marked read, then
 *                  deleted as their owner ("Users can delete own read
 *                  notifications"), twice, 5 s apart, for a trigger that lands late.
 * The CHECKOUT leg creates no row per run. It re-mints the Checkout Session
 * on ONE persistent, unpaid, is_seed canary job (CHECKOUT_FIXTURE_TITLE), and
 * create-payment's re-mint EXPIRES the previous session first — so at most one
 * open test-mode session exists at any moment, and only this runner ever had
 * its URL. That job is replaced (deleted when the policy allows, else
 * cancelled through poster_cancel_job, the product's own Cancel) only when
 * its date runs short, i.e. roughly every CHECKOUT_FIXTURE_DAYS - MIN_RUNWAY days.
 * A run killed mid-way leaves marked rows; the NEXT run's pre-sweep removes
 * them before it starts.
 *
 * LOAD (docs/OPEN.md Q104). Every request to the Supabase project — browser,
 * Playwright API and Node fetch — is counted by kind and written to the run
 * summary, and a run above REQUEST_BUDGET fails: an hourly canary that quietly
 * grows into a load test is the Q104 problem, 24 times a day.
 */
// Shown able to fail against a mutation someone chose: point the helper's apply
// at an RPC that does not exist and the "apply" step goes red on the refused
// write. Scored by the weekly vacuity run (vacuity.yml holds the shared-account
// secrets this spec needs; no local machine does).
// @mutate src/pages/dashboard/useApplyFlow.ts | supabase.rpc("apply_to_job", { | supabase.rpc("apply_to_job_canary_mutant" as "apply_to_job", {
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "../prodTest";
import { appendFileSync } from "node:fs";
import {
  SUPABASE_URL,
  ensureFundedOpenJob,
  rest,
  getSession,
  newUserContext,
  restAs,
  retireFundedJob,
  selectAs,
  type Session,
} from "../prod-audit/harness";
import { centralDatePlus } from "../prod-audit/fundedOpenJob";
import { FUNDED_FIXTURE_TITLE } from "../prod-audit/fundedOpenJobPlan";

/** Every row this spec writes carries it; the pre-sweep finds a killed run's rows by it. Not any sweeper's marker. */
export const MARKER = "[E2E-CANARY]";
/** The ONE persistent unpaid job the checkout leg re-mints a session on. */
export const CHECKOUT_FIXTURE_TITLE = `${MARKER} checkout fixture, never paid`;
const CHECKOUT_FIXTURE_DAYS = 60;
const MIN_RUNWAY_DAYS = 7;

/**
 * Supabase requests one run may make, all kinds together. An ESTIMATE until
 * the first live run (the lead sets it from the measured count plus headroom;
 * the count is printed on every run): two SPA page loads (helper browse,
 * poster messages) at ~40-80 calls each, ~15 harness REST calls, one
 * create-payment call.
 */
export const REQUEST_BUDGET = 300;

type LoopStep = "sign in" | "browse" | "open job" | "apply" | "message" | "checkout start" | "clean up";
const step = <T>(name: LoopStep, body: () => Promise<T>): Promise<T> => test.step(name, body);

/** Letters only: a digit run reads as a phone number to the chat safety filter. */
const nonce = () => Math.random().toString(36).replace(/[0-9]/g, "").slice(0, 6) || "canary";

// ── request accounting ──────────────────────────────────────────────────────
const tally = new Map<string, number>();
function count(url: string) {
  if (!url.startsWith(SUPABASE_URL)) return;
  const m = /^\/(rest|auth|functions|storage|realtime)\/v1\//.exec(url.slice(SUPABASE_URL.length));
  const kind = m ? m[1] : "other";
  tally.set(kind, (tally.get(kind) ?? 0) + 1);
}
const totalRequests = () => [...tally.values()].reduce((a, b) => a + b, 0);

/** The Playwright API context, with every call counted. The harness helpers take it unchanged. */
function counted(api: APIRequestContext): APIRequestContext {
  return new Proxy(api, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      if (["get", "post", "patch", "put", "delete", "head", "fetch"].includes(String(prop))) {
        return (url: unknown, ...args: unknown[]) => {
          count(String(url));
          return (v as (...a: unknown[]) => unknown).call(target, url, ...args);
        };
      }
      return (v as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

function watch(ctx: BrowserContext) {
  ctx.on("request", (r) => count(r.url()));
}

// ── the checkout fixture ───────────────────────────────────────────────────
type CheckoutRow = { id: string; status: string; payment_status: string | null; stripe_session_id: string | null; date_needed: string };

/** One open, unpaid, is_seed canary job with runway left: reuse it, else create it. Retire any other. */
async function ensureCheckoutJob(api: APIRequestContext, poster: Session, log: string[]): Promise<string> {
  const rows = await selectAs<CheckoutRow[]>(
    api,
    poster,
    `jobs?customer_id=eq.${poster.user.id}&title=eq.${encodeURIComponent(CHECKOUT_FIXTURE_TITLE)}&status=eq.open` +
      `&select=id,status,payment_status,stripe_session_id,date_needed&order=created_at.desc`,
  );
  const runwayOk = (r: CheckoutRow) => r.date_needed >= centralDatePlus(MIN_RUNWAY_DAYS);
  const remintable = (r: CheckoutRow) => ["unpaid", "abandoned", "failed"].includes(r.payment_status ?? "unpaid");
  const keep = rows.find((r) => remintable(r) && runwayOk(r)) ?? null;
  for (const r of rows.filter((x) => x !== keep)) log.push(await retireCheckoutJob(api, poster, r));
  if (keep) return keep.id;
  const created = await restAs(api, poster, "post", "jobs?select=id,parish,is_seed", {
    customer_id: poster.user.id,
    title: CHECKOUT_FIXTURE_TITLE,
    description:
      "Automated hourly canary row. Its checkout is opened every hour and never paid. " +
      "If you are reading this in the app, something is wrong with the test harness.",
    category: "cleaning",
    budget: 25,
    location: "Baton Rouge, LA",
    date_needed: centralDatePlus(CHECKOUT_FIXTURE_DAYS),
    status: "open",
    payment_status: "unpaid",
    pricing_mode: "set_price",
    // No parish: notify_helpers_on_job_post returns on its first line.
    parish: null,
    is_seed: true,
  });
  expect(created.ok(), `creating the canary checkout job: ${created.status()} ${await created.text()}`).toBe(true);
  const [job] = (await created.json()) as { id: string; parish: string | null; is_seed: boolean }[];
  expect(job?.parish, "the canary checkout job must carry no parish, or the helper fan-out fires").toBeNull();
  expect(job?.is_seed, "the canary checkout job must be is_seed (derived from the @mailinator poster)").toBe(true);
  log.push(`created checkout fixture ${job.id}`);
  return job.id;
}

/** Delete when the policy allows it (unpaid + no session, or abandoned); else the product's own cancel; a paid one refunds. */
async function retireCheckoutJob(api: APIRequestContext, poster: Session, r: CheckoutRow): Promise<string> {
  const ps = r.payment_status ?? "unpaid";
  if (ps === "escrow" || ps === "cancelling") return retireFundedJob(api, poster, r.id);
  if ((ps === "unpaid" && !r.stripe_session_id) || ps === "abandoned") {
    const del = await restAs(api, poster, "delete", `jobs?id=eq.${r.id}&select=id`);
    const gone = del.ok() ? ((await del.json()) as unknown[]).length : 0;
    expect(gone, `deleting retired checkout fixture ${r.id}: ${del.status()}`).toBe(1);
    return `deleted checkout fixture ${r.id}`;
  }
  const cancel = await restAs(api, poster, "post", "rpc/poster_cancel_job", { p_job_id: r.id, p_reason: "E2E canary fixture rotation" });
  expect(cancel.ok(), `cancelling retired checkout fixture ${r.id}: ${cancel.status()} ${await cancel.text()}`).toBe(true);
  return `cancelled checkout fixture ${r.id} (${ps}, session minted)`;
}

// ── clean-up ───────────────────────────────────────────────────────────────
/** Remove this spec's marked rows, as the account that owns each. Used before the run (a killed run's leftovers) and after. */
async function removeMarked(api: APIRequestContext, poster: Session, helper: Session): Promise<string[]> {
  const like = encodeURIComponent(`*${MARKER}*`);
  const removed: string[] = [];
  for (const [who, table, col] of [[helper, "applications", "message"], [poster, "messages", "content"]] as const) {
    const r = await restAs(api, who, "delete", `${table}?${col}=like.${like}&select=id`);
    expect(r.ok(), `deleting marked ${table}: ${r.status()} ${await r.text()}`).toBe(true);
    removed.push(...((await r.json()) as { id: string }[]).map((x) => `${table}/${x.id}`));
  }
  return removed;
}

/** Notifications the run fanned out on the canary's jobs, for both accounts: read, then delete (the policy needs read = true). */
async function removeNotifications(api: APIRequestContext, sessions: Session[], jobIds: string[], since: string): Promise<number> {
  const filter = `job_id=in.(${jobIds.join(",")})&created_at=gte.${encodeURIComponent(since)}`;
  let n = 0;
  for (const s of sessions) {
    const mark = await restAs(api, s, "patch", `notifications?user_id=eq.${s.user.id}&${filter}&select=id`, { read: true });
    expect(mark.ok(), `marking canary notifications read: ${mark.status()} ${await mark.text()}`).toBe(true);
    const del = await restAs(api, s, "delete", `notifications?user_id=eq.${s.user.id}&${filter}&select=id`);
    expect(del.ok(), `deleting canary notifications: ${del.status()} ${await del.text()}`).toBe(true);
    n += ((await del.json()) as unknown[]).length;
  }
  return n;
}

function summary(line: string) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  try {
    appendFileSync(f, `${line}\n`);
  } catch {
    /* the annotation below still carries it */
  }
}

test.describe("core-loop canary", () => {
  test("sign in, browse, open a job, apply, message, start checkout, clean up", async ({ browser, request }, info) => {
    // The normal run is ~2 min. 30 only for the rare run that must MINT the
    // funded fixture (a real TEST checkout, then the 20-minute early-access
    // wait) — roughly once in three weeks; the log says so when it happens.
    test.setTimeout(30 * 60_000);
    const t0 = Date.now();
    const runStart = new Date(t0 - 5_000).toISOString();
    const api = counted(request);
    const nodeFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      count(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return nodeFetch(input, init);
    }) as typeof fetch;

    const log: string[] = [];
    const contexts: BrowserContext[] = [];
    // A box, not four `let`s: TypeScript narrows a `let` assigned inside a
    // step callback back to its initial null.
    const run: { poster?: Session; helper?: Session; fixture?: { id: string; title: string }; checkoutJobId?: string } = {};
    const pitch = `${MARKER} canary apply ${nonce()}`;
    const note = `${MARKER} canary message ${nonce()}`;

    try {
      await step("sign in", async () => {
        run.poster = await getSession(api, "poster");
        run.helper = await getSession(api, "helper");
        expect(run.poster.user.id, "poster and helper resolved to the same account").not.toBe(run.helper.user.id);
      });
      const p = run.poster!;
      const h = run.helper!;
      const stale = await removeMarked(api, p, h);
      if (stale.length) log.push(`pre-sweep removed ${stale.join(", ")}`);

      const funded = await ensureFundedOpenJob(api, browser, p, h);
      run.fixture = funded.job;
      log.push(...funded.log);
      const job = funded.job;

      const hctx = await newUserContext(browser, h);
      contexts.push(hctx);
      watch(hctx);
      const hp: Page = await hctx.newPage();

      await step("browse", async () => {
        await hp.goto("/dashboard");
        await hp.getByRole("button", { name: "Search jobs" }).first().click();
        await hp.getByRole("combobox", { name: "Search jobs" }).fill(FUNDED_FIXTURE_TITLE);
        await expect(
          hp.getByRole("button", { name: new RegExp(`View .*${FUNDED_FIXTURE_TITLE}`) }).first(),
          `the helper cannot find the funded fixture ${job.id} in Browse`,
        ).toBeVisible({ timeout: 60_000 });
      });

      const sheet = hp.getByRole("dialog").first();
      await step("open job", async () => {
        await hp.getByRole("button", { name: new RegExp(`View .*${FUNDED_FIXTURE_TITLE}`) }).first().click();
        await expect(sheet.getByRole("button", { name: /^(apply now|book now)$/i }), "the job sheet opened with no Apply control").toBeVisible({
          timeout: 30_000,
        });
      });

      await step("apply", async () => {
        await sheet.getByRole("textbox").first().fill(pitch);
        const wrote = hp.waitForResponse(
          (r) => r.request().method() === "POST" && /\/rest\/v1\/(rpc\/apply_to_job|applications)(\?|$)/.test(r.url()),
          { timeout: 30_000 },
        );
        await sheet.getByRole("button", { name: /^(apply now|book now)$/i }).click();
        const res = await wrote;
        expect(res.ok(), `the apply write was refused: ${res.status()} ${await res.text().catch(() => "")}`).toBe(true);
        await expect(hp.getByText(/applied|application sent|you're in/i).first(), "no visible confirmation after applying").toBeVisible({
          timeout: 30_000,
        });
        const rows = await selectAs<{ id: string }[]>(api, h, `applications?job_id=eq.${job.id}&helper_id=eq.${h.user.id}&select=id`);
        expect(rows, "the application did not land as exactly one row").toHaveLength(1);
      });

      await step("message", async () => {
        const pctx = await newUserContext(browser, p);
        contexts.push(pctx);
        watch(pctx);
        const pp = await pctx.newPage();
        // The poster messages the applicant: the one direction the messages
        // INSERT policy allows before a hire (can_send_message_to_in_job).
        await pp.goto(`/messages?jobId=${job.id}&userId=${h.user.id}`);
        const box = pp.getByRole("textbox", { name: /type a message/i });
        await expect(box, "the poster's thread with the applicant never opened").toBeVisible({ timeout: 30_000 });
        await box.fill(note);
        await pp.getByRole("button", { name: /^send message$/i }).click();
        await expect
          .poll(
            async () =>
              (await selectAs<{ id: string }[]>(api, p, `messages?job_id=eq.${job.id}&content=eq.${encodeURIComponent(note)}&select=id`)).length,
            { message: "the message never landed as exactly one row", timeout: 20_000 },
          )
          .toBe(1);
        await pctx.close();
      });

      await step("checkout start", async () => {
        const checkoutJobId = await ensureCheckoutJob(api, p, log);
        run.checkoutJobId = checkoutJobId;
        const res = await api.post(`${SUPABASE_URL}/functions/v1/create-payment`, {
          headers: rest(p),
          data: { action: "escrow", jobId: checkoutJobId },
          timeout: 60_000,
        });
        expect(res.ok(), `create-payment escrow refused: ${res.status()} ${await res.text()}`).toBe(true);
        const { url } = (await res.json()) as { url?: string };
        expect(url, "create-payment returned no checkout url").toBeTruthy();
        // Sandbox until launch (CLAUDE.md). A live session is never opened, let alone paid.
        expect(url!, "create-payment returned a NON-test Checkout Session — Stripe is not in sandbox").toMatch(/\/cs_test_[A-Za-z0-9]+/);
        // The hosted page renders a way to pay. Nothing is typed, nothing is submitted.
        const sp = await browser.newPage();
        try {
          await sp.goto(url!, { waitUntil: "domcontentloaded" });
          await expect(
            sp.locator("#cardNumber").or(sp.getByRole("radio").first()),
            "Stripe's hosted checkout page rendered no payment method",
          ).toBeVisible({ timeout: 60_000 });
        } finally {
          await sp.close();
        }
      });
    } finally {
      try {
        await step("clean up", async () => {
          for (const c of contexts) await c.close().catch(() => {});
          if (!run.poster || !run.helper) return; // never signed in: nothing was written
          const p = run.poster;
          const h = run.helper;
          const removed = await removeMarked(api, p, h);
          const jobIds = [run.fixture?.id, run.checkoutJobId].filter((x): x is string => !!x);
          let notes = 0;
          if (jobIds.length) {
            notes += await removeNotifications(api, [p, h], jobIds, runStart);
            await new Promise((r) => setTimeout(r, 5_000));
            notes += await removeNotifications(api, [p, h], jobIds, runStart);
          }
          log.push(`clean-up removed ${removed.length ? removed.join(", ") : "no marked rows"} and ${notes} notification(s)`);
          // VERIFIED, not assumed: re-read what the run wrote.
          const left: string[] = [];
          const like = encodeURIComponent(`*${MARKER}*`);
          const apps = await selectAs<{ id: string }[]>(api, h, `applications?helper_id=eq.${h.user.id}&message=like.${like}&select=id`);
          const msgs = await selectAs<{ id: string }[]>(api, p, `messages?sender_id=eq.${p.user.id}&content=like.${like}&select=id`);
          if (apps.length) left.push(`${apps.length} application(s)`);
          if (msgs.length) left.push(`${msgs.length} message(s)`);
          if (jobIds.length) {
            for (const s of [p, h]) {
              const n = await selectAs<{ id: string }[]>(
                api,
                s,
                `notifications?user_id=eq.${s.user.id}&job_id=in.(${jobIds.join(",")})&created_at=gte.${encodeURIComponent(runStart)}&select=id`,
              );
              if (n.length) left.push(`${n.length} notification(s) for ${s === p ? "poster" : "helper"}`);
            }
          }
          expect(left, `the canary left rows on prod: ${left.join(", ")}`).toEqual([]);
        });
      } finally {
        // Reported even when the clean-up itself went red.
        globalThis.fetch = nodeFetch;
        const secs = Math.round((Date.now() - t0) / 1000);
        const kinds = [...tally.entries()].map(([k, v]) => `${k} ${v}`).join(", ");
        const line = `Core-loop canary: ${totalRequests()} Supabase requests (${kinds || "none"}) in ${secs}s; budget ${REQUEST_BUDGET}.`;
        info.annotations.push({ type: "requests", description: line });
        if (log.length) info.annotations.push({ type: "canary", description: log.join("; ") });
        console.log(line);
        summary(`- ${line}`);
        if (log.length) summary(`- ${log.join("; ")}`);
      }
    }
    expect(totalRequests(), `the canary made ${totalRequests()} Supabase requests, over its ${REQUEST_BUDGET} budget (Q104)`).toBeLessThanOrEqual(
      REQUEST_BUDGET,
    );
  });
});
