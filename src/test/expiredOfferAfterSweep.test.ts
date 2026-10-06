/**
 * Q1207 — after the hourly sweep an expired offer still reads "The offer
 * expired", never "You weren't picked".
 *
 * WHAT WAS BROKEN (read in source, 2026-10-04): expire_unanswered_offers set
 * the Helpr's application to 'rejected' with no closed_reason and reopened the
 * job (helper_id, response_deadline cleared). With the clock gone and only a
 * bare rejection left, deriveHelperWait returned "not_selected" — "You weren't
 * picked" — for an offer nobody passed on.
 *
 * Both halves are held here:
 *   - the EFFECTIVE (newest) sweep stamps closed_reason = 'offer_expired' on
 *     that close, and the newest applications_closed_reason_check admits it
 *     (otherwise every expiry raises and is only logged);
 *   - the status line reads the stamp, on the post-sweep row shape.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { deriveHelperWait, helperStatusLine } from "@/components/job-card/jobStatusLine";
import type { AppliedApp } from "@/components/job-card/activityConstants";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const squash = (s: string) => blankSqlComments(s).replace(/\s+/g, " ").toLowerCase();

const HELPER = "11111111-2222-3333-4444-555555555555";

/** The rows exactly as the sweep leaves them: the job reopened to everyone. */
function afterSweep(closed_reason: string | null): AppliedApp {
  return {
    id: "app-1", job_id: "job-1", helper_id: HELPER, status: "rejected", closed_reason,
    created_at: "2026-10-01T12:00:00Z",
    job: { id: "job-1", customer_id: "poster-1", title: "Fixture", status: "open", helper_id: null,
      response_deadline: null, helper_confirmed_at: null, date_needed: "2099-01-01", payment_status: "escrow" },
  } as unknown as AppliedApp;
}

describe("Q1207: the sweep's expiry close keeps saying the offer expired", () => {
  const defs = effectiveDefs(MIG_DIR);
  const sweep = squash(defs.get("expire_unanswered_offers")?.stmt ?? "");

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(sweep).toContain("apply_job_denial_consequence");
  });

  it("the newest sweep stamps closed_reason = 'offer_expired' on the application it closes", () => {
    const m = sweep.match(/update public\.applications set ([^;]*) where id = v_app_id;/);
    expect(m, "no applications close in the sweep").toBeTruthy();
    expect(m?.[1]).toContain("status = 'rejected'");
    expect(m?.[1]).toContain("closed_reason = 'offer_expired'");
  });

  it("the newest closed_reason CHECK admits offer_expired", () => {
    let latest = "";
    for (const f of migrationFiles(MIG_DIR)) {
      const sql = squash(readFileSync(join(MIG_DIR, f), "utf8"));
      const m = sql.match(/add constraint applications_closed_reason_check check \(([^;]*)\);/g);
      if (m) latest = m[m.length - 1];
    }
    expect(latest).toContain("'offer_expired'");
    // The earlier reasons still pass.
    expect(latest).toContain("'job_cancelled'");
    expect(latest).toContain("'party_blocked'");
  });

  it("the Helpr's line reads 'The offer expired' on the post-sweep rows", () => {
    const a = afterSweep("offer_expired");
    expect(deriveHelperWait(a)).toBe("offer_expired");
    expect(helperStatusLine(a).detail).toBe("The offer expired");
    expect(helperStatusLine(a).detail).not.toBe("You weren't picked");
  });

  it("a plain rejection still reads 'You weren't picked' (control)", () => {
    expect(deriveHelperWait(afterSweep(null))).toBe("not_selected");
  });
});

// @mutate src/components/job-card/jobStatusLine.ts |   if (app.status === "rejected" && app.closed_reason === "offer_expired") return "offer_expired"; |   if (false) return "offer_expired";
// @mutate supabase/migrations/20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql |            SET status = 'rejected', closed_reason = 'offer_expired'\n         WHERE id = v_app_id; |            SET status = 'rejected'\n         WHERE id = v_app_id;
// @mutate supabase/migrations/20261004184021_expired_offer_says_it_expired.sql |   CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked', 'offer_expired')); |   CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked'));
