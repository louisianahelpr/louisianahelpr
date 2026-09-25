/**
 * THE PRE-RUN SWEEP LEAVES THE MONEY LOOP ITS create-payment WINDOW
 * (nightly-red #1742, e2e-real-backend).
 *
 * Run 35987836495, job "Full money loop": the sweep step asked cancel_escrow
 * about nine stranded rows, every one `status=in_progress payment=escrow` with
 * a Helpr, and create-payment answered 409 useCancelJob nine times
 * (function_edge_logs 12:08:48-12:08:57Z). The loop then signed in as the same
 * poster: escrow at 12:09:05 was the 10th call of the minute (200), and the
 * release at 12:09:27 the 11th: `release failed: 429 {"error":"Too many
 * requests. Please try again later."}`. Its retry died at escrow on the same
 * 429. create-payment allows 10 calls per 60 s per JWT subject and counts a
 * refusal like a success.
 *
 * Two rules, for every create-payment caller that runs before the loop:
 *  1. a row whose own columns decide the answer (hired, started or disputed:
 *     create-payment refuses it) is not asked;
 *  2. the sweep ends only once its last create-payment call has aged out of
 *     the window, so the next step starts with all 10.
 *
 * @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | const known = cancelEscrowAnswerFromColumns(job); | const known = null;
 * @mutate scripts/e2e/sweepSummary.mjs |   if (job.status !== "open" \|\| job.helper_id) return "settle-forward"; |
 * @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | const windowWait = createPaymentWindowWaitMs(lastCreatePaymentAt); | const windowWait = 0;
 * @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | lastCreatePaymentAt = Date.now(); // before the call | void 0; // before the call
 * @mutate scripts/e2e/sweepSummary.mjs | export const CREATE_PAYMENT_WINDOW_MS = 60_000; | export const CREATE_PAYMENT_WINDOW_MS = 30_000;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs helper shared with the sweeper script
import * as sweep from "../../scripts/e2e/sweepSummary.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

const createPayment = read("supabase/functions/create-payment/index.ts");
const sweeper = read("scripts/e2e/prod-lifecycle-sweeper.mjs");
const spec = read("e2e/prod-lifecycle.spec.ts");

type Job = { id: string; status: string; helper_id: string | null };
const answer = (j: Job) => sweep.cancelEscrowAnswerFromColumns(j) as "disputed" | "settle-forward" | null;

/** The nine rows the 35987836495 sweep asked about: hired, in progress, in escrow. */
const RUN_35987836495: Job[] = [
  "7ea7b67d-4fc0-4684-9681-e027c3b6205b",
  "70bd43b2-e130-4224-bc31-d88ee8a24e50",
  "407612dd-3e94-4db1-ab17-4bc06b57af95",
  "58080caf-913e-4975-bd95-1e39c27cf6c8",
  "e7f41d94-4298-4a3f-b42b-ce999ab8afd4",
  "06623a9b-18d5-4e0c-9e04-5252bb18c8a9",
  "d21a09ef-6b27-4606-8c2f-6e49c98318e8",
  "d7ca9482-181b-4f8b-bf71-3080e8876a80",
  "548d6d81-5b95-468d-b716-214430b8ec0a",
].map((id) => ({ id, status: "in_progress", helper_id: "437de07d-1bd7-46c8-a451-6b46aa3bcad5" }));

describe("the pre-run sweep leaves the money loop its create-payment window", () => {
  it("the sweep's window and limit are create-payment's own", () => {
    const rl = /checkRateLimit\(req,\s*\{\s*windowMs:\s*([\d_]+),\s*maxRequests:\s*(\d+),\s*keyPrefix:\s*"create-payment"/.exec(createPayment);
    expect(rl, "create-payment's checkRateLimit call was not found — this guard has rotted").not.toBeNull();
    expect(sweep.CREATE_PAYMENT_WINDOW_MS).toBe(Number(rl![1].replace(/_/g, "")));
    expect(sweep.CREATE_PAYMENT_MAX_PER_WINDOW).toBe(Number(rl![2]));
  });

  it("create-payment still refuses exactly the rows the sweep no longer asks about", () => {
    expect(createPayment).toMatch(/if \(job\.status !== "open" \|\| job\.helper_id \|\| settlement\.blocked\) \{/);
    expect(createPayment).toMatch(/const disputed = job\.status === "disputed" \|\| settlement\.blocked;/);
    expect(answer({ id: "a", status: "in_progress", helper_id: "h" })).toBe("settle-forward");
    expect(answer({ id: "b", status: "accepted", helper_id: "h" })).toBe("settle-forward");
    expect(answer({ id: "c", status: "open", helper_id: "h" })).toBe("settle-forward");
    expect(answer({ id: "d", status: "completed", helper_id: null })).toBe("settle-forward");
    expect(answer({ id: "e", status: "disputed", helper_id: "h" })).toBe("disputed");
    // Only the server's settlement read can answer an open, unhired row.
    expect(answer({ id: "f", status: "open", helper_id: null })).toBeNull();
  });

  it("replaying run 35987836495, the sweep spends none of the window and the loop's calls fit in it", () => {
    const sweepCalls = RUN_35987836495.filter((j) => answer(j) === null).length;
    const loopCalls = (spec.match(/\/functions\/v1\/create-payment`/g) ?? []).length;
    expect(loopCalls, "the loop's create-payment calls were not found — this guard has rotted").toBeGreaterThanOrEqual(2);
    expect(sweepCalls).toBe(0);
    expect(sweepCalls + loopCalls).toBeLessThanOrEqual(sweep.CREATE_PAYMENT_MAX_PER_WINDOW);
  });

  it("the sweeper consults the columns before it calls, and records every call", () => {
    expect(sweeper).toMatch(/const known = cancelEscrowAnswerFromColumns\(job\);\s*let r = known \? null : await cancelEscrow\(job\.id\);/);
    expect(sweeper).toMatch(/async function cancelEscrow\(jobId\) \{\s*lastCreatePaymentAt = Date\.now\(\);/);
    expect(sweeper).toMatch(/const out = await settleJobForward\(\{[\s\S]*?\}\);\s*lastCreatePaymentAt = Date\.now\(\);/);
  });

  it("the sweep waits out its last call's window before it ends", () => {
    expect(sweeper).toMatch(/const windowWait = createPaymentWindowWaitMs\(lastCreatePaymentAt\);\s*if \(windowWait > 0\) \{[\s\S]*?setTimeout\(res, windowWait\)/);
    const t = 1_790_000_000_000;
    expect(sweep.createPaymentWindowWaitMs(null, t)).toBe(0);
    expect(sweep.createPaymentWindowWaitMs(t, t)).toBeGreaterThan(sweep.CREATE_PAYMENT_WINDOW_MS);
    expect(sweep.createPaymentWindowWaitMs(t - 30_000, t)).toBeGreaterThan(30_000);
    expect(sweep.createPaymentWindowWaitMs(t - 120_000, t)).toBe(0);
  });
});
