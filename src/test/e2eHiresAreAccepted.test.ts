// @mutate e2e/prod-lifecycle.spec.ts | const accepted = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_job_offer`, { | const accepted = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_job_offer_off`, {
// @mutate scripts/e2e/settleForward.mjs | const r = await post(base, "/rest/v1/rpc/accept_job_offer", headers(anon, helperToken), { p_job_id: jobId }); | const r = { ok: true, status: 200, body: '"state":"accepted"' };
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/*
 * GUARD (docs/OPEN.md Q1816, e2e-real-backend nightly-red #2940): a journey
 * that hires through accept_application also makes the Helpr ACCEPT.
 *
 * Run 38527096325 (2026-10-14 08:10Z): prod-lifecycle hired with
 * accept_application, then PATCHed on-my-way and got 403 "accept_required".
 * accept_application only OFFERS the job; since 20261004001807 / 20261007051854
 * nothing starts on an offer the Helpr has not accepted, and the accept is
 * written only by accept_job_offer (the app's Accept Job button).
 *
 * Inventory: every e2e/ and scripts/e2e/ source that calls
 * rpc/accept_application in code (comments blanked). Each must call
 * rpc/accept_job_offer itself, or settle through settleJobForward, which
 * accepts the offer first (scripts/e2e/settleForward.mjs, step 0).
 */
const root = join(__dirname, "..", "..");
const SETTLE = "scripts/e2e/settleForward.mjs";
const read = (f: string) => blankComments(readFileSync(join(root, f), "utf8"));

const sources = (dir: string) =>
  (readdirSync(join(root, dir), { recursive: true }) as string[])
    .map((f) => `${dir}/${f}`)
    .filter((f) => /\.(ts|mjs|js)$/.test(f) && !f.includes("node_modules"));
const hiring = [...sources("e2e"), ...sources("scripts/e2e")]
  .filter((f) => /rpc\/accept_application/.test(read(f)));

describe("a journey that hires also accepts (Q1816)", () => {
  it("inventory: journeys hire through accept_application", () => {
    expect(hiring.length).toBeGreaterThan(2); // 3 on 2026-10-14
  });

  it("settleJobForward accepts an unaccepted offer before arrival", () => {
    const src = read(SETTLE);
    const accept = src.indexOf('"/rest/v1/rpc/accept_job_offer"');
    const arrival = src.indexOf('"/rest/v1/rpc/mark_helper_arrival"');
    expect(accept).toBeGreaterThan(0);
    expect(arrival).toBeGreaterThan(accept);
    expect(src).toMatch(/"helper_confirmed_at",/);
  });

  it("every hiring journey calls accept_job_offer or settles through settleJobForward", () => {
    const missing = hiring.filter((f) => {
      const src = read(f);
      return !/rpc\/accept_job_offer|"accept_job_offer"/.test(src) && !/settleJobForward\(/.test(src);
    });
    expect(missing).toEqual([]);
  });
});
