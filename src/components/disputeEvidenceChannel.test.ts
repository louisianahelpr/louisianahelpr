/**
 * Who may add follow-up evidence to a dispute, and through which write.
 *
 * A dispute an admin re-opened with rpc_supersede_dispute_decision has no
 * opener (opener_id NULL). The dialog's only evidence write was the opener's
 * own UPDATE, so on that dispute NEITHER party could attach anything to the
 * decision being re-made (round-5 lh-money-escrow review, LOW-1). Both parties
 * now go through rpc_add_dispute_evidence there; a party-filed dispute keeps
 * its opener-only rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { disputeEvidenceChannel, REOPENED_REASON_PREFIX } from "./disputeEvidenceChannel";

const ME = "user-me";
const OTHER = "user-other";

describe("disputeEvidenceChannel", () => {
  const REOPENED = `${"Re-opened by an admin after the earlier decision could not be carried out:"} Helpr account deleted\n\nOriginal dispute: …`;

  it("an admin re-opened dispute (no opener, supersede's reason) is open to either party, via the RPC", () => {
    expect(disputeEvidenceChannel({ status: "open", opener_id: null, reason: REOPENED }, ME)).toBe("reopened");
    expect(disputeEvidenceChannel({ status: "open", opener_id: null, reason: REOPENED }, OTHER)).toBe("reopened");
  });

  it("no opener is NOT always an admin re-open: a deleted opener's dispute is 'unattributed', not re-opened (round-5 LOW-2)", () => {
    expect(disputeEvidenceChannel({ status: "open", opener_id: null, reason: "The work was never delivered" }, ME)).toBe("unattributed");
  });

  it("the client prefix is byte-identical to the one the migration writes and checks", () => {
    const migration = readFileSync("supabase/migrations/20260915034822_dispute_settlement_claim_and_race_locks.sql", "utf8");
    expect(REOPENED_REASON_PREFIX).toBe("Re-opened by an admin after the earlier decision could not be carried out:");
    expect(migration.split(`'${REOPENED_REASON_PREFIX}`).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("a party-filed dispute stays opener-only", () => {
    expect(disputeEvidenceChannel({ status: "open", opener_id: ME, reason: "x" }, ME)).toBe("opener");
    expect(disputeEvidenceChannel({ status: "open", opener_id: OTHER, reason: "x" }, ME)).toBe("blocked");
  });

  it("nothing is added once the dispute is not open, and the legacy path is unchanged", () => {
    for (const status of ["decided", "withdrawn", "superseded"]) {
      expect(disputeEvidenceChannel({ status, opener_id: null, reason: REOPENED }, ME)).toBe("closed");
    }
    expect(disputeEvidenceChannel(null, ME)).toBe("legacy");
  });

  it("DisputeTimelineDialog routes the re-opened channel through rpc_add_dispute_evidence", () => {
    const src = readFileSync("src/components/DisputeTimelineDialog.tsx", "utf8");
    expect(src).toContain("disputeEvidenceChannel(");
    expect(src).toContain('"rpc_add_dispute_evidence"');
    // Not deployed yet (PGRST202) is told plainly, not reported as a defect.
    expect(src).toContain('"PGRST202"');
  });
});
