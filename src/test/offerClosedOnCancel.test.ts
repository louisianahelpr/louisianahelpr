/**
 * Q2011: when a cancel closes a direct offer, the offered Helpr is told; a
 * reopened job never carries a 'withdrawn' offer; answering a withdrawn offer
 * says the job is closed.
 *
 * WHAT WAS BROKEN (read live 2026-11-03): the Q1891 cancel trigger moved a
 * pending offer to 'withdrawn' and nobody told the offered Helpr (the job
 * notice only goes to OLD.helper_id, NULL on an open job). A cancelled job
 * moved back to open kept 'withdrawn', which half the open-job readers hide
 * and half show. respond_to_direct_offer answered offer_not_pending ("isn't
 * yours to respond to any more") on a cancelled job's offer.
 *
 * This guard reads the NEWEST definitions (any dollar-quote tag, comments
 * blanked) of the notice trigger, the reopen trigger and the answer RPC.
 * Behaviour, red then green: src/test/pglite/offerClosedOnCancel.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 6 FAILED).
 */
// @mutate supabase/migrations/20261103075222_offer_closed_on_cancel.sql |       'Offer closed', |       'Offer gone',
// @mutate supabase/migrations/20261103075222_offer_closed_on_cancel.sql |      WHERE public.job_payment_is_listed(OLD.payment_status) |      WHERE true
// @mutate supabase/migrations/20261103075222_offer_closed_on_cancel.sql |   AFTER UPDATE OF status ON public.jobs | AFTER UPDATE OF title ON public.jobs
// @mutate supabase/migrations/20261103075222_offer_closed_on_cancel.sql |   ELSIF NEW.status::text = 'open' AND NEW.direct_offer_status = 'withdrawn' THEN | ELSIF false THEN
// @mutate supabase/migrations/20261103075222_offer_closed_on_cancel.sql |   IF v_offer_status = 'withdrawn' AND v_job_status IS DISTINCT FROM 'open' THEN | IF false THEN
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { triggerInventory, bodyOf } from "./helpers/migrationTriggers";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const files = migrationFiles(MIG_DIR).map((f) => ({ name: f, sql: readFileSync(join(MIG_DIR, f), "utf8") }));
const defs = effectiveDefs(MIG_DIR);
const flat = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
const body = (name: string) => flat(bodyOf(defs.get(name)?.stmt ?? ""));

describe("Q2011: the offered Helpr hears that a cancel closed the offer", () => {
  const code = body("jobs_cancel_tells_offered_helpr");
  const trg = triggerInventory(files).get("jobs.zzz_jobs_cancel_tells_offered_helpr");

  it("the inventory is read", () => {
    expect(defs.size).toBeGreaterThan(100);
  });

  it("an 'Offer closed' notice goes to the offered Helpr on a pending -> withdrawn cancel", () => {
    expect(code, "jobs_cancel_tells_offered_helpr is gone").not.toBe("");
    expect(code).toMatch(/new\.status::text = 'cancelled'/);
    expect(code).toMatch(/old\.direct_offer_status = 'pending'/);
    expect(code).toMatch(/new\.direct_offer_status = 'withdrawn'/);
    expect(code).toMatch(/insert into public\.notifications \(user_id, title, message, type, link, job_id\) select new\.offered_to_helper_id, 'offer closed',/);
  });

  it("only about an offer the Helpr was shown (a listed job, not an instant booking), and only once", () => {
    // notify_helper_on_direct_offer announces an offer only on a listed job.
    expect(code).toMatch(/where public\.job_payment_is_listed\(old\.payment_status\) and not exists/);
    expect(code).toMatch(/old\.instant_decline_until is null/);
    expect(code).toMatch(/not exists \( select 1 from public\.notifications n where n\.user_id = new\.offered_to_helper_id and n\.job_id = new\.id and n\.title = 'offer closed'/);
  });

  it("is attached AFTER UPDATE OF status on jobs", () => {
    expect(trg, "the trigger is not attached (or a later migration drops it)").toBeTruthy();
    expect(trg!.timing).toBe("AFTER");
    expect(trg!.events).toMatch(/^UPDATE OF STATUS\b/);
    expect(trg!.fn).toBe("jobs_cancel_tells_offered_helpr");
  });

  it("the cancel trigger still writes 'withdrawn' (the state the notice keys on)", () => {
    expect(body("jobs_cancel_retires_direct_offer")).toMatch(/new\.direct_offer_status := 'withdrawn';/);
  });
});

describe("Q2011: a reopened job never keeps a withdrawn offer", () => {
  it("jobs_reopen_retires_direct_offer maps 'withdrawn' to 'expired' on open", () => {
    expect(body("jobs_reopen_retires_direct_offer")).toMatch(
      /elsif new\.status::text = 'open' and new\.direct_offer_status = 'withdrawn' then new\.direct_offer_status := 'expired';/,
    );
  });
});

describe("Q2011: answering a withdrawn offer says the job is closed", () => {
  it("respond_to_direct_offer raises job_not_open for a withdrawn offer before offer_not_pending", () => {
    const code = body("respond_to_direct_offer");
    const withdrawn = code.search(/if v_offer_status = 'withdrawn' and v_job_status is distinct from 'open' then raise exception 'job_not_open';/);
    const notPending = code.indexOf("raise exception 'offer_not_pending'");
    expect(withdrawn, "the withdrawn branch is gone").toBeGreaterThan(-1);
    expect(notPending).toBeGreaterThan(withdrawn);
    // Authorization still comes first.
    expect(code.indexOf("raise exception 'not_your_offer'")).toBeLessThan(withdrawn);
  });

  it("the PGlite proof is in the tree", () => {
    expect(existsSync(join(ROOT, "src/test/pglite/offerClosedOnCancel.pglite.mjs"))).toBe(true);
  });
});
