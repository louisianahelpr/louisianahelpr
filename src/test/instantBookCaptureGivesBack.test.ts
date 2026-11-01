// @mutate supabase/functions/_shared/cardHold.ts | if (opts.offerTo && hold.state !== "capturing" && | if (false && opts.offerTo && hold.state !== "capturing" &&
// @mutate supabase/functions/_shared/cardHold.ts | (fresh.offered_to_helper_id !== opts.offerTo \|\| fresh.direct_offer_status !== "pending")) { | (fresh.direct_offer_status !== "pending")) {
// @mutate supabase/functions/card-hold-sweep/index.ts | ? captureCardHold(depsFor(hold), id, { offerTo: helper }) | ? captureCardHold(depsFor(hold), id)
// @mutate supabase/functions/create-payment/index.ts | jobId, directOpen ? { offerTo: user.id } : {}); | jobId, {});
/**
 * CMP-4 money review FAIL (lead 2026-11-01): the sweep's 2-hour capture and
 * the Helpr's decline must never both win. This is the capture side
 * (supabase/functions/_shared/cardHold.ts captureCardHold, opts.offerTo), run
 * against an in-memory jobs + job_card_holds pair:
 *
 *   order "decline first": the decline commits between the capture's claim
 *   and its re-read of the job. With offerTo the claim goes back to
 *   'authorized' and Stripe is never called. Without offerTo (the code before
 *   this fix) Stripe captures: the defect the review found.
 *
 *   order "claim first": the decline is refused by the database
 *   (rpc_instant_book_decline sees 'capturing'; PGlite
 *   src/test/pglite/instantBookDeclineRace.pglite.mjs R1), so the capture
 *   goes through for the still-pending offer.
 *
 * Plus the two call sites pass offerTo (source read): card-hold-sweep's
 * instant pass and create-payment's capture_hold for a direct offer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

// cardHold.ts imports Deno-only modules (slack-alerts, an esm.sh Stripe type), so the app
// typecheck must not follow it: a non-literal import is loaded by vitest at run time only.
const CARD_HOLD = "../../supabase/functions/_shared/cardHold.ts";
type CaptureFn = (deps: { db: never; stripe: never; mode: "test" | "live" }, jobId: string, opts?: { resume?: boolean; offerTo?: string }) => Promise<unknown>;
const { captureCardHold } = (await import(/* @vite-ignore */ CARD_HOLD)) as { captureCardHold: CaptureFn };

const JOB = "00000000-0000-0000-0000-000000000101";
const HELPR = "00000000-0000-0000-0000-000000000011";
const POSTER = "00000000-0000-0000-0000-000000000001";

type Row = Record<string, unknown>;

/** A tiny PostgREST-shaped store: select/update with eq/is/in filters. */
function store(onClaim: (tables: Record<string, Row[]>) => void) {
  const tables: Record<string, Row[]> = {
    jobs: [{
      id: JOB, customer_id: POSTER, title: "Mow the yard", status: "open", payment_status: "held", helper_id: null,
      category: "yard_work", is_seed: true, stripe_payment_intent_id: null, offered_to_helper_id: HELPR, direct_offer_status: "pending",
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

/** The Helpr's decline, committed in the moment between the claim and the job re-read. */
const declineAtClaim = (tables: Record<string, Row[]>) => {
  Object.assign(tables.jobs[0], { offered_to_helper_id: null, direct_offer_status: null });
};

describe("instant book: a decline that lands after the capture's claim (CMP-4 race fix)", () => {
  it("decline first: with offerTo the claim goes back to 'authorized' and Stripe is never called", async () => {
    const { db, tables } = store(declineAtClaim);
    // The store really holds the job and its hold (a store read empty would pass every filter).
    expect(tables.jobs.length).toBeGreaterThan(0);
    expect(tables.job_card_holds.length).toBeGreaterThan(0);
    const { stripe, calls } = stripeSpy();
    const r = await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB, { offerTo: HELPR });
    expect(r).toEqual({ ok: false, reason: "not_held" });
    expect(calls.capture).toBe(0);
    expect(tables.job_card_holds[0]).toMatchObject({ state: "authorized", capturing_from: null, capture_amount_cents: null });
    expect(tables.jobs[0].payment_status).toBe("held");
  });

  it("the defect, shown: without offerTo the same order charges the card for nobody", async () => {
    const { db } = store(declineAtClaim);
    const { stripe, calls } = stripeSpy();
    await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB).catch(() => undefined);
    expect(calls.capture).toBe(1);
  });

  it("claim first (the offer still pending to this Helpr): the capture goes through once", async () => {
    const { db } = store(() => undefined);
    const { stripe, calls } = stripeSpy();
    await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB, { offerTo: HELPR }).catch(() => undefined);
    expect(calls.capture).toBe(1);
  });

  it("an offer re-pointed to another Helpr also gives the claim back", async () => {
    const { db } = store((t) => Object.assign(t.jobs[0], { offered_to_helper_id: "00000000-0000-0000-0000-000000000012" }));
    const { stripe, calls } = stripeSpy();
    const r = await captureCardHold({ db: db as never, stripe: stripe as never, mode: "test" }, JOB, { offerTo: HELPR });
    expect(r).toEqual({ ok: false, reason: "not_held" });
    expect(calls.capture).toBe(0);
  });

  it("both callers pass offerTo: the sweep's instant pass and create-payment's capture_hold for a direct offer", () => {
    const sweep = blankComments(readFileSync("supabase/functions/card-hold-sweep/index.ts", "utf8"));
    const pay = blankComments(readFileSync("supabase/functions/create-payment/index.ts", "utf8"));
    const offerToSites = (sweep.match(/offerTo: helper\b/g) ?? []).length + (pay.match(/offerTo: user\.id/g) ?? []).length;
    expect(sweep).toContain("captureCardHold(depsFor(hold), id, { offerTo: helper })");
    expect(pay).toContain("jobId, directOpen ? { offerTo: user.id } : {});");
    expect(offerToSites).toBeGreaterThan(1);
  });
});
