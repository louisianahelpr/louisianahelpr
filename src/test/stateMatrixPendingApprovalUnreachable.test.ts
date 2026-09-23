import { describe, it, expect } from "vitest";
import { enumerateStates } from "../../e2e/happy-path/state-matrix/stateMatrix";

/**
 * GUARD (Q251): `pending_approval` is a retired job status — nothing writes
 * it any more (see the comment in stateMatrix.ts's posterCells()) and prod
 * holds zero jobs in it. The manifest used to emit its poster-card cells as
 * `reachable: "auto"`, claiming the sweep could drive a state that cannot
 * occur. Every cell for this status must be `unreachable`, with a reason.
 */
describe("state matrix: pending_approval cells are unreachable", () => {
  it("emits every pending_approval poster-card cell as unreachable, with a reason", () => {
    const cells = enumerateStates().filter((c) => c.status === "pending_approval");
    expect(cells.length, "no pending_approval cells found at all — did the substate get deleted?").toBeGreaterThan(0);
    const wrong = cells.filter((c) => c.reachable !== "unreachable" || !c.reason);
    expect(
      wrong.map((c) => `${c.id}: reachable=${c.reachable} reason=${c.reason ?? "(none)"}`),
      "pending_approval cells must be reachable:'unreachable' with a reason — it is a retired status",
    ).toEqual([]);
  });
});

// @mutate e2e/happy-path/state-matrix/stateMatrix.ts | reachable: isRetiredPendingApproval ? "unreachable" : "auto", | reachable: "auto",
