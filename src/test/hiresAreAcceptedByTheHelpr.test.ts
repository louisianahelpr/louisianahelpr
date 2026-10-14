/**
 * CLASS GUARD: a harness that HIRES (accept_application) also has the Helpr
 * ACCEPT the offer before it walks the job forward.
 *
 * A hire is an offer until the Helpr's Accept Job (accept_job_offer, Q1180).
 * Since 20261004001807 (Q1187) enforce_helper_award_gate refuses on-my-way,
 * arrival, Done and disputes on an unaccepted offer (`accept_required`). Two
 * harnesses skipped the tap and died on it the first night funding worked
 * again (2026-10-14): e2e-journeys 38527058685 (settleForward's
 * mark_helper_arrival) and e2e-real-backend 38527096325 (prod-lifecycle's
 * on-my-way PATCH).
 *
 * Inventory: every tracked file under e2e/ and scripts/e2e/ that calls the
 * accept_application RPC. Each must also reach the Helpr's accept: the RPC
 * itself, settleJobForward (which starts with it), helperConfirmsOffer, or the
 * server's complete_job_accept.
 *
 * @mutate e2e/prod-lifecycle.spec.ts | `${SUPABASE_URL}/rest/v1/rpc/accept_job_offer` | `${SUPABASE_URL}/rest/v1/rpc/accept_job_offer_DISABLED`
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const HIRE = /rpc\/accept_application\b|["']accept_application["']/;
const ACCEPT = /rpc\/accept_job_offer\b|["']accept_job_offer["']|\bsettleJobForward\s*\(|\bhelperConfirmsOffer\s*\(|["']complete_job_accept["']/;

const hirers = execFileSync("git", ["ls-files", "-z", "--", "e2e", "scripts/e2e"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\0")
  .filter((f) => /\.(ts|mjs)$/.test(f) && !/\.d\.mts$/.test(f))
  .map((f) => ({ f, code: blankComments(readFileSync(join(ROOT, f), "utf8")) }))
  .filter(({ code }) => HIRE.test(code));

describe("every harness that hires has the Helpr accept the offer", () => {
  it("finds the hiring harnesses (inventory floor)", () => {
    expect(hirers.length).toBeGreaterThan(3);
    expect(hirers.map((h) => h.f)).toEqual(expect.arrayContaining(["e2e/prod-lifecycle.spec.ts", "e2e/prod-audit/fundedOpenJob.ts"]));
  });

  it.each(hirers.map((h) => [h.f, h.code] as const))("%s reaches accept_job_offer", (_f, code) => {
    expect(code).toMatch(ACCEPT);
  });
});
