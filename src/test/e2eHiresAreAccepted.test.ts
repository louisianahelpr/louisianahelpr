// @mutate e2e/prod-lifecycle.spec.ts | const accepted = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_job_offer`, { | const accepted = await request.post(`${SUPABASE_URL}/rest/v1/rpc/accept_job_offer_off`, {
// @mutate scripts/e2e/settleForward.mjs | const r = await post(base, "/rest/v1/rpc/accept_job_offer", headers(anon, helperToken), { p_job_id: jobId }); | const r = { ok: true, status: 200, body: '"state":"accepted"' };
// @mutate scripts/e2e/seedStateFixtures.mjs |     const ok = await rpc("complete_job_accept", { p_job_id: id }); |     const ok = await rpc("complete_job_accept_off", { p_job_id: id });
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
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
 * Inventory: every e2e/ and scripts/e2e/ source that calls accept_application
 * in code (comments blanked), by URL (rpc/accept_application) OR by name
 * through an rpc() helper ("accept_application": prod-audit's fundedOpenJob.ts
 * and seedStateFixtures.mjs hire that way, and the URL-only inventory never
 * saw them; carried from hiresAreAcceptedByTheHelpr on wip/lander-rest-1017).
 * Each must reach the Helpr's accept: accept_job_offer itself, settleJobForward
 * (which accepts first, scripts/e2e/settleForward.mjs step 0, proven by
 * behaviour in settleForwardAcceptsTheOffer.test.ts), fundedOpenJob's
 * helperConfirmsOffer, or the server's complete_job_accept (it stamps
 * helper_confirmed_at, 20261004001807).
 */
const root = join(__dirname, "..", "..");
const SETTLE = "scripts/e2e/settleForward.mjs";
const read = (f: string) => blankComments(readFileSync(join(root, f), "utf8"));

const sources = (dir: string) =>
  (readdirSync(join(root, dir), { recursive: true }) as string[])
    .map((f) => `${dir}/${f}`)
    .filter((f) => /\.(ts|mjs|js)$/.test(f) && !f.includes("node_modules"));
const HIRE = /rpc\/accept_application\b|["']accept_application["']/;
const ACCEPT = /rpc\/accept_job_offer\b|["']accept_job_offer["']|\bsettleJobForward\(|\bhelperConfirmsOffer\(|["']complete_job_accept["']/;
const hiring = [...sources("e2e"), ...sources("scripts/e2e")]
  .filter((f) => !/\.d\.mts$/.test(f) && HIRE.test(read(f)));

describe("a journey that hires also accepts (Q1816)", () => {
  it("inventory: journeys hire through accept_application", () => {
    expect(hiring.length).toBeGreaterThan(4); // 5 on 2026-10-18
    expect(hiring).toEqual(expect.arrayContaining(["e2e/prod-lifecycle.spec.ts", "e2e/prod-audit/fundedOpenJob.ts", "scripts/e2e/seedStateFixtures.mjs"]));
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
      return !ACCEPT.test(src);
    });
    expect(missing).toEqual([]);
  });
});
