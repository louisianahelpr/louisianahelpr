/**
 * Owner decision 2026-10-21: when a poster cancels, applicants who were NOT hired or offered get no
 * cancellation notification (no bell, push or email); their card reads "This job is no longer available".
 * The offered/hired Helpr is still told. Behaviour: src/test/pglite/unhiredApplicantsNotToldOfCancel.pglite.mjs
 * (hired/offered -> notified, unhired -> not; 3x). This pins the newest definition and the card label.
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |     IF NEW.closed_reason = 'job_cancelled' AND NEW.helper_id IS DISTINCT FROM job_helper\n | IF false AND NEW.closed_reason = 'job_cancelled' AND NEW.helper_id IS DISTINCT FROM job_helper\n
 * @mutate src/pages/jobs/appliedJobCard/appliedJobCardHelpers.ts | return "This job is no longer available"; | return "Job cancelled";
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { closedCardLabel } from "@/pages/jobs/appliedJobCard/appliedJobCardHelpers";

describe("unhired applicants are not told a job was cancelled (owner 2026-10-21)", () => {
  const def = effectiveDefs(join(process.cwd(), "supabase", "migrations")).get("notify_on_application")!;
  const body = blankSqlComments(def.stmt);

  it("the newest notify_on_application returns before any notice for an unhired applicant on a cancelled job", () => {
    const skip = body.search(/IF NEW\.closed_reason = 'job_cancelled' AND NEW\.helper_id IS DISTINCT FROM job_helper\s+AND NOT COALESCE\(NEW\.helper_id = job_offered AND job_offer_status = 'pending', false\) THEN\s+RETURN NEW;/);
    expect(skip).toBeGreaterThan(-1);
    // ...and before the cancellation notice is written.
    expect(skip).toBeLessThan(body.indexOf("was cancelled, so your application is closed"));
    // job_helper is the job's offered/hired Helpr, read beside the title.
    expect(body).toMatch(/SELECT title, customer_id, helper_id, offered_to_helper_id, direct_offer_status INTO job_title, job_owner, job_helper, job_offered, job_offer_status FROM public\.jobs/);
  });

  it("their card says the job is no longer available", () => {
    expect(closedCardLabel({ closed_reason: "job_cancelled", status: "rejected" })).toBe("This job is no longer available");
  });
});
