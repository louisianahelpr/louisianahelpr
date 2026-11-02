// @mutate supabase/functions/_shared/cardHold.ts | if (opts.hireOf && hold.state !== "capturing" && | if (false && opts.hireOf && hold.state !== "capturing" &&
// @mutate supabase/functions/_shared/cardHold.ts | (fresh.status !== "accepted" \|\| fresh.helper_id !== opts.hireOf)) { | (fresh.status !== "accepted")) {
// @mutate supabase/functions/create-payment/index.ts | directOpen ? { offerTo: user.id } : offerOpen ? { hireOf: user.id } : {}); | directOpen ? { offerTo: user.id } : {});
// @mutate supabase/functions/card-hold-sweep/index.ts | captureCardHold(deps, job.id, direct ? {} : { hireOf: helperId }) | captureCardHold(deps, job.id)
// @mutate supabase/migrations/20261102103429_poster_withdraws_an_offer.sql | IF FOUND AND (v_hold.state = 'capturing' | IF FOUND AND (false
// @mutate supabase/migrations/20261102103429_poster_withdraws_an_offer.sql | REVOKE ALL ON FUNCTION public.rpc_poster_withdraw_offer(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.rpc_poster_withdraw_offer(uuid) FROM PUBLIC;
// @mutate src/pages/jobs/jobPage/useWithdrawOffer.tsx | return job.status === "open" && job.direct_offer_status === "pending"; | return false;
// @mutate src/pages/jobs/jobPage/useWithdrawOffer.tsx | if (job.status === "accepted") return !!job.helper_id && !job.helper_confirmed_at; | if (job.status === "accepted") return !!job.helper_id;
// @mutate src/pages/jobs/jobPage/posterPageActions.tsx | withdrawOffer.action, | null,
// @mutate src/pages/jobs/jobPage/JobPage.tsx | const offerOut = isPoster && offerIsOut(job); | const offerOut = isPoster && open && job.direct_offer_status === "pending";
// @mutate src/pages/jobs/jobPage/JobPage.tsx | job.status === "accepted" ? job.response_deadline ?? null : | false ? job.response_deadline ?? null :
// @mutate src/pages/jobs/jobPage/useJobPage.ts | direct_offer_expires_at, response_deadline, has_active_dispute | direct_offer_expires_at, has_active_dispute
// @mutate src/components/job-card/jobStatusLine.ts | app.closed_reason === "offer_withdrawn") return "offer_withdrawn"; | app.closed_reason === "offer_withdrawn") return "not_selected";
/**
 * Q2604 (Jobs audit 1102b row 18, 11-01 JA-49): the poster's Withdraw offer.
 *
 * The SQL (who may withdraw, the hold lock, the money left in place, the words) is proven in PGlite:
 * src/test/pglite/posterWithdrawsAnOffer.pglite.mjs. This file pins the parts PGlite cannot see:
 *
 *   1. THE CAPTURE SIDE of the race (supabase/functions/_shared/cardHold.ts captureCardHold, opts.hireOf), run
 *      against an in-memory jobs + job_card_holds pair: a withdraw that commits between the capture's claim and its
 *      re-read of the job gets the claim back and Stripe is never called. Without hireOf (the code before) the same
 *      order charges the poster's card for nobody.
 *   2. Both capture call sites for a Hire's offer pass hireOf (create-payment capture_hold, card-hold-sweep's
 *      pending-accept completion).
 *   3. The newest rpc_poster_withdraw_offer locks the hold and refuses a capture in flight, and anon cannot run it.
 *   4. The page: the button shows exactly while an offer is out (offerIsOut), sits in the poster's row, and the
 *      withdrawn Helpr's card says the offer was withdrawn, never "You weren't picked".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { offerIsOut } from "@/pages/jobs/jobPage/useWithdrawOffer";
import { deriveHelperWait, HELPER_WAIT } from "@/components/job-card/jobStatusLine";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import type { AppliedApp } from "@/components/job-card/activityConstants";

// cardHold.ts imports Deno-only modules: a non-literal import keeps the app typecheck from following it.
const CARD_HOLD = "../../supabase/functions/_shared/cardHold.ts";
type CaptureFn = (deps: { db: never; stripe: never; mode: "test" | "live" }, jobId: string, opts?: { resume?: boolean; offerTo?: string; hireOf?: string }) => Promise<unknown>;
const { captureCardHold } = (await import(/* @vite-ignore */ CARD_HOLD)) as { captureCardHold: CaptureFn };

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const JOB = "00000000-0000-0000-0000-000000000201";
const HELPR = "00000000-0000-0000-0000-000000000011";
const POSTER = "00000000-0000-0000-0000-000000000001";
type Row = Record<string, unknown>;

/** A tiny PostgREST-shaped store holding a Hire's offer on a held card (instantBookCaptureGivesBack.test.ts's). */
function store(onClaim: (tables: Record<string, Row[]>) => void) {
  const tables: Record<string, Row[]> = {
    jobs: [{
      id: JOB, customer_id: POSTER, title: "Rake the yard", status: "accepted", payment_status: "held", helper_id: HELPR,
      category: "yard_work", is_seed: true, stripe_payment_intent_id: null, offered_to_helper_id: null, direct_offer_status: null,
    }],
    job_card_holds: [{
      job_id: JOB, stripe_mode: "test", payment_intent_id: "pi_1", state: "authorized", amount_cents: 6000, onboarding_fee_cents: 0,
      onboarding_fee_claimed_at: null, capturing_from: null, capture_amount_cents: null, attempts: 0, notified_state: "authorized",
    }],
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      const hit = rows();
      if (patch) {
        for (const r of hit) Object.assign(r, patch);
        if (table === "job_card_holds" && patch.state === "capturing") onClaim(tables);
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { db: { from, rpc: async () => ({ data: null, error: null }) }, tables };
}
function stripeSpy() {
  const calls = { capture: 0 };
  const stripe = {
    paymentIntents: {
      capture: async (id: string) => { calls.capture++; return { id, status: "succeeded", amount_received: 6000 }; },
      retrieve: async (id: string) => ({ id, status: "requires_capture" }),
    },
  };
  return { stripe, calls };
}
/** The poster's withdraw (rpc_poster_withdraw_offer), committed between the claim and the job re-read. */
const withdrawAtClaim = (tables: Record<string, Row[]>) => {
  Object.assign(tables.jobs[0], { status: "open", helper_id: null });
};

describe("Q2604 capture side: a withdraw that lands after the capture's claim", () => {
  it("withdraw first: with hireOf the claim goes back to 'authorized' and Stripe is never called", async () => {
    const { db, tables } = store(withdrawAtClaim);
    expect(tables.jobs.length).toBeGreaterThan(0);
    expect(tables.job_card_holds.length).toBeGreaterThan(0);
    const { stripe, calls } = stripeSpy();
    const r = await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB, { hireOf: HELPR });
    expect(r).toEqual({ ok: false, reason: "not_held" });
    expect(calls.capture).toBe(0);
    expect(tables.job_card_holds[0]).toMatchObject({ state: "authorized", capturing_from: null, capture_amount_cents: null });
    expect(tables.jobs[0].payment_status).toBe("held");
  });

  it("the defect, shown: without hireOf the same order charges the card for nobody", async () => {
    const { db } = store(withdrawAtClaim);
    const { stripe, calls } = stripeSpy();
    await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB).catch(() => undefined);
    expect(calls.capture).toBe(1);
  });

  it("the offer still this Helpr's: the capture goes through once", async () => {
    const { db } = store(() => undefined);
    const { stripe, calls } = stripeSpy();
    await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB, { hireOf: HELPR }).catch(() => undefined);
    expect(calls.capture).toBe(1);
  });

  it("the offer moved to someone else meanwhile: given back too", async () => {
    const { db, tables } = store((t) => Object.assign(t.jobs[0], { helper_id: "00000000-0000-0000-0000-000000000099" }));
    const { stripe, calls } = stripeSpy();
    await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB, { hireOf: HELPR });
    expect(calls.capture).toBe(0);
    expect(tables.job_card_holds[0].state).toBe("authorized");
  });
});

describe("Q2604 both capture call sites for a Hire's offer pass hireOf", () => {
  it("create-payment capture_hold", () => {
    const src = blankComments(read("supabase/functions/create-payment/index.ts"));
    expect(src).toContain("directOpen ? { offerTo: user.id } : offerOpen ? { hireOf: user.id } : {});");
  });
  it("card-hold-sweep's pending-accept completion", () => {
    const src = blankComments(read("supabase/functions/card-hold-sweep/index.ts"));
    expect(src).toContain("captureCardHold(deps, job.id, direct ? {} : { hireOf: helperId })");
  });
});

describe("Q2604 the newest rpc_poster_withdraw_offer", () => {
  const defs = effectiveDefs(resolve(ROOT, "supabase/migrations"));
  const def = defs.get("rpc_poster_withdraw_offer");
  it("exists, and locks the hold after the job, refusing a capture in flight", () => {
    expect(def).toBeDefined();
    const body = blankSqlComments(def!.stmt);
    const jobLock = body.search(/FROM public\.jobs j\s+WHERE j\.id = p_job_id\s+FOR UPDATE/);
    const holdLock = body.search(/FROM public\.job_card_holds h\s+WHERE h\.job_id = p_job_id\s+FOR UPDATE/);
    expect(jobLock).toBeGreaterThan(0);
    expect(holdLock).toBeGreaterThan(jobLock);
    expect(body).toMatch(/IF FOUND AND \(v_hold\.state = 'capturing'/);
    expect(body).toContain("RAISE EXCEPTION 'offer_being_accepted'");
    // Nothing in it writes money.
    expect(body).not.toMatch(/payment_status\s*=\s*'/);
  });
  it("anon and PUBLIC lose Supabase's default EXECUTE (the file that defines it revokes it)", () => {
    const sql = blankSqlComments(read(`supabase/migrations/${def!.file}`));
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.rpc_poster_withdraw_offer\(uuid\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rpc_poster_withdraw_offer\(uuid\) TO authenticated;/);
  });
});

describe("Q2604 the page", () => {
  const base = { id: JOB, is_group_job: false, direct_offer_status: null as string | null };
  it("the button shows exactly while an offer is out", () => {
    const out = [
      { ...base, status: "accepted", helper_id: HELPR, helper_confirmed_at: null },
      { ...base, status: "open", helper_id: null, direct_offer_status: "pending" },
    ];
    const notOut = [
      { ...base, status: "accepted", helper_id: HELPR, helper_confirmed_at: "2026-11-02T10:00:00Z" },
      { ...base, status: "open", helper_id: null },
      { ...base, status: "open", helper_id: null, direct_offer_status: "expired" },
      { ...base, status: "accepted", helper_id: HELPR, helper_confirmed_at: null, is_group_job: true },
      { ...base, status: "in_progress", helper_id: HELPR, helper_confirmed_at: "2026-11-02T10:00:00Z" },
    ];
    expect(out.length + notOut.length).toBeGreaterThan(6);
    for (const j of out) expect(offerIsOut(j), JSON.stringify(j)).toBe(true);
    for (const j of notOut) expect(offerIsOut(j), JSON.stringify(j)).toBe(false);
  });
  it("it sits in the poster's row of actions, with its dialog mounted", () => {
    const src = blankComments(read("src/pages/jobs/jobPage/posterPageActions.tsx"));
    expect(src).toContain("useWithdrawOffer(enabled ? job : null, helperFirst, onChanged)");
    expect(src).toMatch(/withdrawOffer\.action,\s*\n\s*canCancel/);
    expect(src).toContain("{withdrawOffer.dialog}");
  });
  it("the poster's offer-out line names the deadline for a Hire's offer too (response_deadline, read on the page)", () => {
    const page = blankComments(read("src/pages/jobs/jobPage/JobPage.tsx"));
    expect(page).toContain("const offerOut = isPoster && offerIsOut(job);");
    expect(page).toContain('const offerUntil = job.status === "accepted" ? job.response_deadline ?? null : job.direct_offer_expires_at ?? null;');
    expect(page).toContain("offerOut={offerOut} offerUntil={offerUntil}");
    const cols = blankComments(read("src/pages/jobs/jobPage/useJobPage.ts")).match(/const PARTY_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "";
    expect(cols.split(",").map((c) => c.trim())).toContain("response_deadline");
    // And the line itself: "Waiting on Eli to accept your offer", by "until <time>".
    const until = new Date(Date.now() + 5 * 3600_000).toISOString();
    const step = jobNextStep({ stage: 1 } as never, { side: "poster", otherFirst: "Eli", offerOut: true, offerUntil: until });
    expect(step?.text).toBe("Waiting on Eli to accept your offer");
    expect(step?.by).toMatch(/^until /);
  });
  it("the withdrawn Helpr's card says the offer was withdrawn, never \"You weren't picked\"", () => {
    const app = { id: "a1", job_id: JOB, status: "rejected", closed_reason: "offer_withdrawn", job: { id: JOB, status: "open" } } as unknown as AppliedApp;
    const wait = deriveHelperWait(app);
    expect(wait).toBe("offer_withdrawn");
    expect(HELPER_WAIT[wait].detail).toBe("The offer was withdrawn");
  });
});
