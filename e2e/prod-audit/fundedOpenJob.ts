/**
 * THE FUNDED OPEN JOB FIXTURE — the prod-driving half (Q100). The decision is
 * `planFundedOpenJob` in ./fundedOpenJobPlan.ts; read its header first.
 *
 * Every layer is the one a real poster goes through, as poster-e2e's own JWT:
 *   1. client write  — POST /rest/v1/jobs under the "Customers can create jobs"
 *      RLS policy (the same INSERT PostJob's useJobSubmit makes), is_seed=true.
 *   2. edge function — create-payment { action: "escrow" } mints the Stripe
 *      Checkout Session and stamps jobs.stripe_session_id.
 *   3. Stripe        — the hosted Checkout page, paid with 4242 4242 4242 4242
 *      (refused unless the session is cs_test_: Stripe stays in sandbox).
 *   4. webhook       — stripe-webhook checkout.session.completed flips
 *      payment_status to 'escrow' and stores the PaymentIntent. This file
 *      never writes payment_status; it only waits to read it.
 *   5. release       — create-payment { action: "cancel_escrow" } refunds the
 *      PaymentIntent (minus the non-refundable service fee) and cancels the job.
 *
 * FAILURE IS A FAILURE. A refused checkout, a Stripe page that never renders,
 * a webhook that never lands, or a cancel_escrow that does not leave the job
 * cancelled/cancelled all THROW — from a beforeAll, that fails the file's
 * tests. Nothing here calls test.skip: "no fixture" is exactly the unjustified
 * skip Q100 exists to end.
 */
import type { APIRequestContext, Browser } from "@playwright/test";
import { ANON, SUPABASE_URL, type Session } from "../journeys/fixtures";
import {
  FUNDED_FIXTURE_TITLE,
  NEW_FIXTURE_DAYS,
  planFundedOpenJob,
  type FixtureRow,
} from "./fundedOpenJobPlan";

const headers = (s: Session, extra: Record<string, string> = {}) => ({
  apikey: ANON,
  Authorization: `Bearer ${s.access_token}`,
  "Content-Type": "application/json",
  ...extra,
});

/** Louisiana's civil date `days` from now — the zone auto-expire-jobs judges `date_needed` in. */
export function centralDatePlus(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() + days * 86_400_000));
}

async function readJson<T>(r: { ok(): boolean; status(): number; text(): Promise<string> }, what: string): Promise<T> {
  const body = await r.text();
  if (!r.ok()) throw new Error(`funded fixture: ${what} → HTTP ${r.status()} ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function invoke(api: APIRequestContext, s: Session, fn: string, body: unknown) {
  const r = await api.post(`${SUPABASE_URL}/functions/v1/${fn}`, { headers: headers(s), data: body, timeout: 60_000 });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* non-JSON error page: reported with the raw text below */ }
  return { status: r.status(), json, text };
}

const COLS = "id,title,status,payment_status,helper_id,date_needed,created_at,stripe_payment_intent_id";
type Row = FixtureRow & { stripe_payment_intent_id: string | null };

async function readRow(api: APIRequestContext, poster: Session, id: string): Promise<Row> {
  const rows = await readJson<Row[]>(
    await api.get(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${id}&select=${COLS}`, { headers: headers(poster) }),
    `read job ${id}`,
  );
  if (rows.length !== 1) throw new Error(`funded fixture: job ${id} is not readable by poster-e2e (${rows.length} rows)`);
  return rows[0];
}

/** Release one funded fixture through the app's own cancel path, and prove it landed. */
export async function retireFundedJob(api: APIRequestContext, poster: Session, jobId: string): Promise<string> {
  const res = await invoke(api, poster, "create-payment", { action: "cancel_escrow", jobId });
  if (res.status !== 200 || res.json.success !== true) {
    throw new Error(`funded fixture: cancel_escrow on ${jobId} → HTTP ${res.status} ${res.text.slice(0, 300)} — the escrow is still held`);
  }
  // A 200 is a claim; the row is the fact (CLAUDE.md "A null error is not a write").
  const after = await readRow(api, poster, jobId);
  if (after.status !== "cancelled" || after.payment_status !== "cancelled") {
    throw new Error(`funded fixture: cancel_escrow on ${jobId} answered success but the job is ${after.status}/${after.payment_status}`);
  }
  return `retired ${jobId} (cancel_escrow → refunded, cancelled/cancelled)`;
}

async function createFixtureRow(api: APIRequestContext, poster: Session): Promise<Row> {
  const rows = await readJson<Row[]>(
    await api.post(`${SUPABASE_URL}/rest/v1/jobs?select=${COLS}`, {
      headers: headers(poster, { Prefer: "return=representation" }),
      data: {
        customer_id: poster.user.id,
        is_seed: true,
        title: `${FUNDED_FIXTURE_TITLE}: hang two shelves`,
        description: "Two floating shelves in a living room, studs already marked, anchors and level on site. Prod-audit fixture, never hired.",
        category: "handyman",
        location: "4412 Highland Rd, Baton Rouge, LA 70808",
        parish: "East Baton Rouge",
        latitude: 30.4028,
        longitude: -91.1714,
        date_needed: centralDatePlus(NEW_FIXTURE_DAYS),
        budget: 25,
        status: "open",
        payment_status: "unpaid",
        pricing_mode: "set_price",
      },
    }),
    "insert fixture job as poster-e2e",
  );
  if (rows.length !== 1) throw new Error(`funded fixture: jobs INSERT returned ${rows.length} rows — nothing was created`);
  return rows[0];
}

/** Pay a Checkout Session on Stripe's hosted page. Throws; never skips. */
async function payCheckout(browser: Browser, url: string): Promise<void> {
  if (!/\/cs_test_[A-Za-z0-9]+/.test(url)) throw new Error(`funded fixture: refusing to pay ${url.slice(0, 80)} — not a cs_test_ session`);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const card = page.locator("#cardNumber");
    const radio = page.getByRole("radio").first();
    await card.or(radio).first().waitFor({ state: "visible", timeout: 60_000 });
    if (!(await card.isVisible().catch(() => false))) await radio.click({ force: true });
    await card.waitFor({ state: "visible", timeout: 30_000 });
    await card.fill("4242 4242 4242 4242");
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
    for (const [id, v] of [["#billingName", "Prod Audit"], ["#billingAddressLine1", "100 Audit Way"], ["#billingLocality", "Baton Rouge"], ["#billingPostalCode", "70801"]] as const) {
      const f = page.locator(id);
      if ((await f.count()) && (await f.isVisible().catch(() => false))) {
        await f.fill(v).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
    const link = page.locator("#enableStripePass");
    if ((await link.count()) && (await link.isChecked().catch(() => false))) await link.uncheck({ force: true }).catch(() => {});
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.getByRole("heading", { name: /^Pay / }).first().click().catch(() => {});
      await page.getByTestId("hosted-payment-submit-button").click();
      const left = await page
        .waitForURL((u) => !u.host.endsWith("checkout.stripe.com"), { timeout: 40_000 })
        .then(() => true)
        .catch(() => false);
      if (left) return;
    }
    throw new Error("funded fixture: Stripe Checkout never submitted after 3 Pay taps");
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function fund(api: APIRequestContext, browser: Browser, poster: Session, row: Row, log: string[]): Promise<Row> {
  const esc = await invoke(api, poster, "create-payment", { action: "escrow", jobId: row.id });
  const url = typeof esc.json.url === "string" ? esc.json.url : "";
  if (esc.status !== 200 || !url) {
    throw new Error(`funded fixture: create-payment escrow on ${row.id} refused → HTTP ${esc.status} ${esc.text.slice(0, 300)}`);
  }
  await payCheckout(browser, url);
  log.push(`paid checkout for ${row.id}`);
  // The webhook, not the redirect, is the authority.
  for (let t = 0; t < 45; t++) {
    const now = await readRow(api, poster, row.id);
    if (now.payment_status === "escrow" && now.stripe_payment_intent_id) return now;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  const last = await readRow(api, poster, row.id);
  throw new Error(`funded fixture: checkout for ${row.id} was paid but stripe-webhook never marked it escrow within 90s (now ${last.payment_status})`);
}

/**
 * EARLY ACCESS. `open_jobs_browse` admits a job to a free-tier viewer only
 * once `created_at <= early_access_cutoff()` — now() minus 20 minutes for the
 * free tier (the paid-tier perk, src/lib/earlyAccess.ts). helper-e2e is free
 * tier, so a fixture minted this run is invisible to it for 20 minutes:
 * measured 2026-09-23 on the first local run, the job was open + escrow with
 * a PaymentIntent and still absent from the helper's feed, and both helper
 * deep links failed on it. That is the product rule, not a defect, so the
 * fixture WAITS it out (once per ~3 weeks, when it is re-minted) instead of
 * handing the specs a job the helper cannot see. A reused job that is still
 * not visible after the window is a real failure and throws.
 */
async function waitVisibleToHelper(api: APIRequestContext, helper: Session, jobId: string, createdAt: string, log: string[]): Promise<void> {
  const deadline = Date.parse(createdAt) + 22 * 60_000;
  for (;;) {
    const rows = await readJson<{ id: string }[]>(
      await api.get(`${SUPABASE_URL}/rest/v1/open_jobs_browse?id=eq.${jobId}&select=id`, { headers: headers(helper) }),
      "read open_jobs_browse as helper-e2e",
    );
    if (rows.length === 1) return;
    if (Date.now() > deadline) {
      throw new Error(`funded fixture: ${jobId} (created ${createdAt}) is still not in open_jobs_browse for helper-e2e after the 20-minute early-access window`);
    }
    log.push(`waiting for early access on ${jobId}`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

/**
 * Make sure exactly one funded, un-applied open fixture job of poster-e2e
 * exists, reusing a valid one. Returns it plus a log for the report annotation.
 */
export async function ensureFundedOpenJob(
  api: APIRequestContext,
  browser: Browser,
  poster: Session,
  helper: Session,
): Promise<{ job: { id: string; title: string }; log: string[] }> {
  const log: string[] = [];
  const rows = await readJson<Row[]>(
    await api.get(
      `${SUPABASE_URL}/rest/v1/jobs?select=${COLS}&customer_id=eq.${poster.user.id}&is_seed=is.true&status=eq.open` +
        `&title=like.${encodeURIComponent(`${FUNDED_FIXTURE_TITLE}*`)}&order=created_at.desc&limit=50`,
      { headers: headers(poster) },
    ),
    "list fixture jobs",
  );
  const apps = await readJson<{ job_id: string }[]>(
    await api.get(`${SUPABASE_URL}/rest/v1/applications?helper_id=eq.${helper.user.id}&select=job_id`, { headers: headers(helper) }),
    "list helper-e2e applications",
  );
  const plan = planFundedOpenJob(rows, { today: centralDatePlus(0), appliedJobIds: new Set(apps.map((a) => a.job_id)) });
  for (const { row, why } of plan.retire) log.push(`${await retireFundedJob(api, poster, row.id)} — ${why}`);
  if (plan.reuse) {
    log.push(`reused ${plan.reuse.id}`);
    await waitVisibleToHelper(api, helper, plan.reuse.id, plan.reuse.created_at, log);
    return { job: { id: plan.reuse.id, title: plan.reuse.title }, log };
  }
  const target = plan.pay === "new" || !plan.pay ? await createFixtureRow(api, poster) : (plan.pay as Row);
  log.push(plan.pay === "new" ? `created ${target.id}` : `re-paying unpaid fixture ${target.id}`);
  const funded = await fund(api, browser, poster, target, log);
  await waitVisibleToHelper(api, helper, funded.id, funded.created_at, log);
  return { job: { id: funded.id, title: funded.title }, log };
}
