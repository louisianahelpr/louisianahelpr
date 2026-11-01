// @mutate supabase/functions/_shared/instantBookSweep.ts | if (ended === true) return "ended_unhireable"; | if (false) return "ended_unhireable";
// @mutate supabase/functions/_shared/instantBookSweep.ts | if (first !== true) return "none"; | if (false) return "none";
// @mutate supabase/functions/_shared/instantBookSweep.ts | const captured = await deps.capture(jobId, helperId); | const captured = await deps.capture(jobId, "");
// @mutate supabase/functions/_shared/instantBookSweep.ts | if (doneErr \|\| captured.paidAtPost) { | if (doneErr) {
// @mutate supabase/functions/_shared/instantBookSweep.ts | if (Date.parse(row.instant_decline_until) > deps.now) return "none"; | if (Date.parse(row.instant_decline_until) > deps.now + 7_200_000) return "none";
// @mutate supabase/functions/_shared/instantBookSweep.ts | if (!isLiveBooking(row)) return "none"; | if (!row) return "none";
// @mutate supabase/functions/_shared/instantBookSweep.ts | if (captured.reason === "poster_must_pay") return endForPayment(deps, jobId); | if (captured.reason === "poster_must_pay") return "none";
// @mutate supabase/functions/_shared/instantBookSweep.ts | if (row.payment_status === "failed") return endForPayment(deps, jobId); | if (row.payment_status === "nope") return endForPayment(deps, jobId);
// @mutate supabase/functions/_shared/instantBookSweep.ts | if (!doneErr && done != null) return "hired"; | return "hired";
/**
 * CMP-4 (lead 2026-11-01, design A): the 2-hour capture of an instant booking
 * (supabase/functions/_shared/instantBookSweep.ts, run by card-hold-sweep).
 * The card stays HELD through the window; after it, the hold is captured with
 * the Helpr's own captureCardHold (injected here) and the hire completes.
 *
 * Proven: nothing happens inside the window; after it exactly one capture and
 * one hire; a second run (double run) charges nothing more; a refused card
 * ends the booking (instant_book_payment_failed) and never hires; an early
 * confirm whose capture failed ends the booking with no capture; a Stripe
 * timeout retries; a capture whose hire is refused is paged, never silent.
 */
import { describe, expect, it } from "vitest";
import {
  settleInstantBooking,
  type InstantBookingRow,
  type InstantCaptureResult,
} from "../../supabase/functions/_shared/instantBookSweep";

const JOB = "00000000-0000-0000-0000-000000000101";
const HELPR = "00000000-0000-0000-0000-000000000011";
const NOW = Date.parse("2026-11-03T15:00:00Z");

/** A jobs row and the two RPCs, as the sweep sees them (service role). */
function world(row: Partial<InstantBookingRow>, captureAnswers: InstantCaptureResult[]) {
  const job: InstantBookingRow = {
    status: "open", payment_status: "held", helper_id: null, offered_to_helper_id: HELPR,
    direct_offer_status: "pending", instant_decline_until: new Date(NOW - 60_000).toISOString(), ...row,
  };
  const calls = { capture: 0, complete: 0, failed: 0, pages: 0, ended: 0, notHired: 0, captureFor: [] as string[], defects: [] as string[] };
  /** instant_book_end_if_unhireable's answer: can the Helpr be hired now (block, ban, ID, payout setup)? */
  const hireable = { now: true };
  const notHiredMarked = new Set<string>();
  let charged = 0;
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...job }, error: null }) }) }) }),
    rpc: async (name: string) => {
      if (name === "complete_direct_offer_accept") {
        calls.complete++;
        // complete_direct_offer_accept refuses a held card and a booking that moved on.
        if (job.payment_status !== "escrow" || job.direct_offer_status !== "pending") return { data: null, error: null };
        Object.assign(job, { status: "accepted", helper_id: HELPR, direct_offer_status: "accepted", instant_decline_until: null });
        return { data: { action: "accepted" }, error: null };
      }
      if (name === "instant_book_end_if_unhireable") {
        // Only before a capture (a hold still only held), as the SQL rule.
        if (hireable.now || job.payment_status !== "held" || job.direct_offer_status !== "pending") return { data: false, error: null };
        calls.ended++;
        Object.assign(job, { offered_to_helper_id: null, direct_offer_status: null, instant_decline_until: null });
        return { data: true, error: null };
      }
      if (name === "instant_book_captured_not_hired") {
        // True once per job (the declines row is the once-marker).
        if (notHiredMarked.has(JOB)) return { data: false, error: null };
        notHiredMarked.add(JOB);
        calls.notHired++;
        Object.assign(job, { offered_to_helper_id: null, direct_offer_status: null, instant_decline_until: null });
        return { data: true, error: null };
      }
      if (name === "instant_book_payment_failed") {
        calls.failed++;
        if (job.direct_offer_status !== "pending") return { data: false, error: null };
        Object.assign(job, { offered_to_helper_id: null, direct_offer_status: null, instant_decline_until: null });
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const capture = async (_jobId: string, helperId: string): Promise<InstantCaptureResult> => {
    calls.capture++;
    calls.captureFor.push(helperId);
    // captureCardHold: a job already in escrow is "already" (no second charge).
    if (job.payment_status === "escrow") return { ok: true, already: true };
    const a = captureAnswers.shift() ?? { ok: false, reason: "not_held" };
    if (a.ok) { job.payment_status = "escrow"; charged++; }
    if (!a.ok && a.reason === "poster_must_pay") job.payment_status = "failed";
    return a;
  };
  const deps = {
    db, capture, now: NOW,
    record: (d: string) => { calls.defects.push(d); },
    page: async () => { calls.pages++; },
  };
  return { job, calls, deps, hireable, charged: () => charged };
}

describe("instant book: the 2-hour capture (CMP-4)", () => {
  it("does nothing while the decline window is open: the card stays held", async () => {
    const w = world({ instant_decline_until: new Date(NOW + 30 * 60_000).toISOString() }, [{ ok: true, already: false }]);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("none");
    expect(w.calls.capture).toBe(0);
    expect(w.job.payment_status).toBe("held");
  });

  it("captures once after the window and completes the hire; a double run charges nothing more", async () => {
    const w = world({}, [{ ok: true, already: false }, { ok: true, already: false }]);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("hired");
    expect(await settleInstantBooking(w.deps, JOB)).toBe("none");
    expect(w.charged()).toBe(1);
    expect(w.calls.capture).toBe(1);
    expect(w.calls.complete).toBe(1);
    expect(w.job).toMatchObject({ status: "accepted", helper_id: HELPR, payment_status: "escrow" });
  });

  it("an early confirm already captured and hired: the sweep leaves it alone", async () => {
    const w = world({ status: "accepted", helper_id: HELPR, direct_offer_status: "accepted", payment_status: "escrow", instant_decline_until: null }, []);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("none");
    expect(w.calls.capture + w.calls.complete).toBe(0);
  });

  it("captured earlier, hire not yet complete (paid at post or a capture that outran its accept): hires with no new charge", async () => {
    const w = world({ payment_status: "escrow" }, []);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("hired");
    expect(w.charged()).toBe(0);
  });

  it("a refused card ends the booking, never hires, and a second run does nothing", async () => {
    const w = world({}, [{ ok: false, reason: "poster_must_pay" }]);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("payment_failed");
    expect(await settleInstantBooking(w.deps, JOB)).toBe("none");
    expect(w.calls.failed).toBe(1);
    expect(w.calls.complete).toBe(0);
    expect(w.charged()).toBe(0);
    expect(w.job).toMatchObject({ status: "open", helper_id: null, offered_to_helper_id: null, payment_status: "failed" });
  });

  it("an early confirm whose capture was refused ends the booking at once, with no capture", async () => {
    const w = world({ payment_status: "failed", instant_decline_until: new Date(NOW + 60 * 60_000).toISOString() }, []);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("payment_failed");
    expect(w.calls.capture).toBe(0);
  });

  it("Stripe did not answer: nothing is hired and the next run retries", async () => {
    const w = world({}, [{ ok: false, reason: "retry", detail: "timeout" }, { ok: true, already: false }]);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("retry");
    expect(w.calls.complete).toBe(0);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("hired");
    expect(w.charged()).toBe(1);
  });

  it("the capture is for the booked Helpr's offer (captureCardHold offerTo)", async () => {
    const w = world({}, [{ ok: true, already: false }]);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("hired");
    expect(w.calls.captureFor).toEqual([HELPR]);
  });

  it("a Helpr who can't be hired now (block, ban, ID, payout setup): the booking ends before any capture", async () => {
    const w = world({}, [{ ok: true, already: false }]);
    w.hireable.now = false;
    expect(await settleInstantBooking(w.deps, JOB)).toBe("ended_unhireable");
    expect(w.calls.capture).toBe(0);
    expect(w.charged()).toBe(0);
    expect(w.calls.ended).toBe(1);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("none");
  });

  it("captured, then the hire is refused in the moment between: the booking ends, the poster is told, ops is paged ONCE", async () => {
    const w = world({}, [{ ok: true, already: false }]);
    const realRpc = w.deps.db.rpc;
    // The Helpr's account changed between the checks and the hire.
    w.deps.db.rpc = (async (name: string) => (name === "complete_direct_offer_accept"
      ? (w.calls.complete++, { data: null, error: null })
      : realRpc(name))) as typeof w.deps.db.rpc;
    expect(await settleInstantBooking(w.deps, JOB)).toBe("captured_not_hired");
    expect(await settleInstantBooking(w.deps, JOB)).toBe("none");
    expect(w.calls.notHired).toBe(1);
    expect(w.calls.pages).toBe(1);
    expect(w.charged()).toBe(1);
    expect(w.job).toMatchObject({ offered_to_helper_id: null, direct_offer_status: null });
  });

  it("captured, hire refused, and the job already marked (a run that crashed after marking): no second page", async () => {
    const w = world({}, [{ ok: true, already: false }]);
    const realRpc = w.deps.db.rpc;
    w.deps.db.rpc = (async (name: string) => (name === "complete_direct_offer_accept"
      ? { data: null, error: null }
      : name === "instant_book_captured_not_hired" ? { data: false, error: null } : realRpc(name))) as typeof w.deps.db.rpc;
    expect(await settleInstantBooking(w.deps, JOB)).toBe("none");
    expect(w.calls.pages).toBe(0);
  });

  it("a hire that errored (not a refusal) retries with no page and no second charge", async () => {
    const w = world({}, [{ ok: true, already: false }]);
    const realRpc = w.deps.db.rpc;
    let fails = 1;
    w.deps.db.rpc = (async (name: string) => (name === "complete_direct_offer_accept" && fails-- > 0
      ? (w.calls.complete++, { data: null, error: { message: "canceling statement due to statement timeout" } })
      : realRpc(name))) as typeof w.deps.db.rpc;
    expect(await settleInstantBooking(w.deps, JOB)).toBe("retry");
    expect(w.calls.pages + w.calls.notHired).toBe(0);
    expect(await settleInstantBooking(w.deps, JOB)).toBe("hired");
    expect(w.charged()).toBe(1);
  });

  it("paid at post (no hold) and the hire refused: never \"being returned\", no page; retried", async () => {
    const w = world({ payment_status: "escrow" }, []);
    w.deps.capture = async () => ({ ok: true, already: true, paidAtPost: true });
    w.deps.db.rpc = (async (name: string) => (name === "complete_direct_offer_accept"
      ? { data: null, error: null }
      : { data: false, error: null })) as typeof w.deps.db.rpc;
    expect(await settleInstantBooking(w.deps, JOB)).toBe("retry");
    expect(w.calls.pages + w.calls.notHired).toBe(0);
  });
});
