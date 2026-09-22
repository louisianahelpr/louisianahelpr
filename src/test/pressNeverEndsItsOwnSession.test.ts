/*
 * CLASS GUARD: a SHARDED sweep must never press a control that ends its session.
 *
 * Run 35761400822 reported 274 failed presses across four shards. They were one
 * auth failure, and the sweep caused it itself.
 *
 * Proven from GoTrue's own auth_logs, not inferred: four shards each minted a
 * session per persona at 17:33; between 17:34 and 17:36 the sweep pressed a
 * sign-out on poster-e2e (twice) and helper-e2e, from the shard runners, with
 * this workflow's own 127.0.0.1:4173 referer. The scope was GLOBAL — proven by
 * arithmetic because GoTrue does not log `?scope=`:
 *
 *   admin            0 logouts pressed -> kept 4 of 4
 *   seed-incomplete  1 logout (local)  -> kept 3 of 4
 *   poster-e2e       2 logouts         -> kept 0 of 4
 *   helper-e2e       1 logout          -> kept 0 of 4
 *
 * Only scope:"global" deletes every row for a user in one call. So ONE shard
 * revoked the OTHER THREE shards' sessions, and all four kept pressing with
 * JWTs whose session row was gone: 183 `session_not_found` on GET /user, and
 * every screen after that measured signed-out and scored as a product defect.
 *
 * WHY BEING TEST-OWNED IS WHAT MADE IT DANGEROUS. `mutationGate` refuses a
 * mutating control on a record the run does not own. A test account's own
 * "Sign Out" is maximally owned, so every ownership check passed and the press
 * went ahead. The danger here is not destruction, it is SHARED SESSION STATE
 * across shards — a dimension ownership cannot see.
 *
 * `e2e/prod-audit/harness.ts` has exported NEVER_PRESS with these exact words
 * since before this run, for messy-input. This sweep never consumed it. The
 * omission, not the regex, was the bug — so this guard asserts the BEHAVIOUR
 * (the gate refuses) rather than that some particular regex exists.
 */

import { describe, it, expect } from "vitest";
import { mutationGate, SESSION_END_RX, SKIP_SESSION_END } from "../../scripts/audit/pressProdSafety.mjs";

/** The most-owned, most-pressable shape: a test account on its own profile. */
const gate = (label: string) =>
  mutationGate({
    label,
    meta: { rowText: "" },
    chainOwned: true,
    persona: "customer",
    routeUrl: "/profile",
    urlOwned: { owned: true, shared: false },
    owners: [],
    stripeMode: async () => ({ mode: "test", detail: "test" }),
    note: () => {},
  });

describe("press never ends the session it is driving", () => {
  it.each([
    ["Sign Out", "the plain control, scope local — still kills the pressing shard"],
    ["Log Out", "same control, the other spelling"],
    ["Sign Out Everywhere", "SecurityTab.tsx:192, the ONLY global sign-out in the app"],
    ["Switch Account", "ends the current session to start another"],
  ])("refuses %s (%s)", async (label) => {
    await expect(gate(label)).resolves.toBe(SKIP_SESSION_END);
  });

  it("still presses ordinary owned controls (the guard is not a blanket refusal)", async () => {
    // If this ever starts skipping, the sweep has stopped measuring the app —
    // which is the failure the session guard exists to PREVENT, arriving by
    // another door.
    await expect(gate("Save")).resolves.toBeNull();
    await expect(gate("Post a new job")).resolves.toBeNull();
  });

  it("account destruction keeps its OWN reason, not this one", async () => {
    // Two different hazards: one destroys the account, one revokes sessions the
    // other shards share. Collapsing them would lose why each is refused.
    await expect(gate("Delete My Account")).resolves.toBe("would destroy or lock the shared test account");
  });

  it("the pattern is not vacuous (an empty regex would pass everything above)", () => {
    expect(SESSION_END_RX.test("Sign Out")).toBe(true);
    expect(SESSION_END_RX.test("Save changes")).toBe(false);
  });
});

// Proof this is able to fail: drop the session-end refusal from the gate and a
// test account's own Sign Out becomes pressable again — exactly the state that
// revoked four shards' sessions on 2026-09-22.
// @mutate scripts/audit/pressProdSafety.mjs | if (SESSION_END_RX.test(label)) return SKIP_SESSION_END; | if (false) return SKIP_SESSION_END;
