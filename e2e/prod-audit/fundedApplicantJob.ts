/**
 * THE FUNDED APPLICANT FIXTURE (Q100, the original ask).
 *
 * Four poster-side forms open only from a FUNDED open job of poster-e2e that
 * has a PENDING applicant: EditJobDialog and CancellationDialog (OpenStep's
 * "Edit job" / "Cancel job" chips), ApplicantsPanel (the card's "Applicants"
 * button) and DeclineApplicantSheet (the panel's "Decline <name>"). My Posts
 * hides an unfunded open job entirely (activityFilters.ts `jobIsUnfundedDraft`),
 * so no unpaid row can stand in, and fundedOpenJob.ts's fixture is by
 * definition one helper-e2e has NOT applied to (its plan retires any it has).
 * This is the second, separate fixture, under its own title prefix so neither
 * plan ever touches the other's row.
 *
 * Every layer is the app's own, as each account's own JWT:
 *   1. poster-e2e jobs INSERT (is_seed), create-payment escrow, hosted Stripe
 *      TEST Checkout (4242, cs_test_ only), stripe-webhook sets escrow — all
 *      via fundedOpenJob.ts's `createFixtureRow` + `fund`.
 *   2. The 20-minute early-access embargo is cleared by ageing `created_at` as
 *      the poster, exactly as prod-lifecycle.spec.ts does (a harness concession
 *      to a real product rule, asserted rather than assumed).
 *   3. helper-e2e applies through `apply_to_job`, the RPC the Apply button calls.
 *   4. Teardown: create-payment cancel_escrow (refund + cancelled/cancelled),
 *      proven by reading the row back (`retireFundedJob`).
 *
 * LIFETIME: one run. `ensureFundedApplicantJob` first retires any leftover
 * applicant fixture (a run that died before its afterAll), then mints a fresh
 * one; the spec's afterAll retires it. No escrow is held between runs.
 * Any failure THROWS — never a skip.
 */
import type { APIRequestContext, Browser } from "@playwright/test";
import { SUPABASE_URL, type Session } from "../journeys/fixtures";
import { createFixtureRow, fund, headers, retireFundedJob } from "./fundedOpenJob";

/** Title prefix of the applicant fixture. Not FUNDED_FIXTURE_TITLE, and no sweeper marker. */
export const APPLICANT_FIXTURE_TITLE = "Prod audit applicant fixture";

export interface ApplicantFixture {
  job: { id: string; title: string };
  applicationId: string;
  log: string[];
}

async function json<T>(r: { ok(): boolean; status(): number; text(): Promise<string> }, what: string): Promise<T> {
  const body = await r.text();
  if (!r.ok()) throw new Error(`applicant fixture: ${what} → HTTP ${r.status()} ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : null) as T;
}

/**
 * Retire every open applicant fixture of poster-e2e: helper-e2e withdraws its
 * application first (cancel_escrow leaves applications `pending` on the
 * cancelled job — measured 2026-09-23 on the first run's fixture), then funded
 * ones go through cancel_escrow.
 */
export async function retireApplicantFixtures(api: APIRequestContext, poster: Session, helper: Session): Promise<string[]> {
  const rows = await json<Array<{ id: string; payment_status: string | null }>>(
    await api.get(
      `${SUPABASE_URL}/rest/v1/jobs?select=id,payment_status&customer_id=eq.${poster.user.id}&is_seed=is.true&status=eq.open` +
        `&title=like.${encodeURIComponent(`${APPLICANT_FIXTURE_TITLE}*`)}`,
      { headers: headers(poster) },
    ),
    "list applicant fixtures",
  );
  const out: string[] = [];
  for (const r of rows) {
    const gone = await json<unknown[]>(
      await api.delete(`${SUPABASE_URL}/rest/v1/applications?job_id=eq.${r.id}&helper_id=eq.${helper.user.id}&select=id`, {
        headers: headers(helper, { Prefer: "return=representation" }),
      }),
      `withdraw helper-e2e's application on ${r.id}`,
    );
    if (gone.length) out.push(`withdrew ${gone.length} application(s) on ${r.id}`);
    if (r.payment_status === "escrow" || r.payment_status === "cancelling") out.push(await retireFundedJob(api, poster, r.id));
    else {
      // Never paid: nothing to refund; cancel it as its poster so it cannot linger as a draft.
      const c = await json<unknown[]>(
        await api.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${r.id}&select=id`, {
          headers: headers(poster, { Prefer: "return=representation" }),
          data: { status: "cancelled" },
        }),
        `cancel unpaid applicant fixture ${r.id}`,
      );
      if (c.length !== 1) throw new Error(`applicant fixture: cancelling unpaid ${r.id} matched ${c.length} rows`);
      out.push(`cancelled unpaid ${r.id}`);
    }
  }
  return out;
}

export async function ensureFundedApplicantJob(
  api: APIRequestContext,
  browser: Browser,
  poster: Session,
  helper: Session,
): Promise<ApplicantFixture> {
  const log = await retireApplicantFixtures(api, poster, helper);
  const row = await createFixtureRow(api, poster, `${APPLICANT_FIXTURE_TITLE}: patch a fence gate`);
  log.push(`created ${row.id}`);
  const funded = await fund(api, browser, poster, row, log);

  const aged = await json<unknown[]>(
    await api.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${funded.id}&select=id`, {
      headers: headers(poster, { Prefer: "return=representation" }),
      data: { created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
    }),
    "age the fixture past early access",
  );
  if (aged.length !== 1) throw new Error(`applicant fixture: ageing ${funded.id} matched ${aged.length} rows — poster could not set created_at`);

  await json<unknown>(
    await api.post(`${SUPABASE_URL}/rest/v1/rpc/apply_to_job`, {
      headers: headers(helper),
      data: { p_job_id: funded.id, p_message: "Prod audit applicant fixture: I can do this Saturday." },
    }),
    "apply_to_job as helper-e2e",
  );
  // The RPC's answer is a claim; the pending row is the fact.
  const apps = await json<Array<{ id: string; status: string }>>(
    await api.get(`${SUPABASE_URL}/rest/v1/applications?job_id=eq.${funded.id}&helper_id=eq.${helper.user.id}&select=id,status`, {
      headers: headers(poster),
    }),
    "read the application as poster-e2e",
  );
  if (apps.length !== 1 || apps[0].status !== "pending") {
    throw new Error(`applicant fixture: expected one pending application on ${funded.id}, poster sees ${JSON.stringify(apps)}`);
  }
  log.push(`helper-e2e applied (${apps[0].id}, pending)`);
  return { job: { id: funded.id, title: funded.title }, applicationId: apps[0].id, log };
}
