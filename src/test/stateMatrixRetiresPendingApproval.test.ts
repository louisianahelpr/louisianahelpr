import { describe, it, expect } from "vitest";
import { enumerateStates } from "../../e2e/happy-path/state-matrix/stateMatrix";

/**
 * Q251 (2026-09-23): the poster-card enumerator emitted every `pending_approval`
 * cell as `reachable: "auto"` with real shots, so the sweep drove and
 * screenshotted a job status nothing can create any more (the only writer, a
 * business spend-approval threshold, was removed in 20260828011811 /
 * 20260831232522 — see stateMatrix.ts's RETIRED_STATUSES comment). Driving a
 * status the app cannot reach wastes a slot in the sweep and dresses up a gap
 * as coverage.
 *
 * This does not re-derive the retirement (that is the migration history); it
 * holds the MANIFEST to it: every pending_approval cell must be marked
 * unreachable, carry a reason, and produce zero shots (shots, not
 * `reachable`, is what state-sweep.spec.ts's drive loop filters on).
 */
describe("state matrix marks pending_approval cells unreachable", () => {
  const cells = enumerateStates();
  const pendingApprovalCells = cells.filter((c) => c.status === "pending_approval");

  it("still enumerates at least one pending_approval cell (job_status is a real DB enum member)", () => {
    expect(pendingApprovalCells.length).toBeGreaterThan(0);
  });

  it("every pending_approval cell is unreachable, with a reason, and drives no shots", () => {
    for (const c of pendingApprovalCells) {
      expect(c.reachable, c.id).toBe("unreachable");
      expect(c.reason, c.id).toBeTruthy();
      expect(c.shots.length, c.id).toBe(0);
    }
  });

  it("no other status is marked unreachable by the same rule (the retirement is specific to pending_approval)", () => {
    const otherRetired = cells.filter((c) => c.status && c.status !== "pending_approval" && c.reachable === "unreachable");
    expect(otherRetired.map((c) => c.id)).toEqual([]);
  });
});

// @mutate e2e/happy-path/state-matrix/stateMatrix.ts | reachable: retiredReason ? "unreachable" : "auto", | reachable: "auto",
