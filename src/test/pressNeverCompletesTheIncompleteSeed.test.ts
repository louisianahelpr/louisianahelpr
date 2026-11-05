/*
 * CLASS GUARD: the prod press sweep never presses a write as the `incomplete`
 * seed account.
 *
 * Press run 41817058240 (leg 1, shard 2, [/complete-profile incomplete]) pressed
 * that account's own "Enter App" at 2026-11-04 10:57:04Z: a submit, so gated,
 * but the gate passed it (the account's own record on a self route). That
 * completed the account (profiles.accepted_terms_at = 10:57:04.434Z, read-only
 * SQL), and tr_preserve_first_consent keeps the first consent forever, so every
 * Complete Profile journey (keyboard-focus, trailing-icon-fields) failed its
 * precheck in e2e-journeys 41934715217 until the account was re-created.
 *
 * Asserts the BEHAVIOUR of mutationGate for the incomplete persona on every
 * kind of write the sweep gates, on the most-owned shape (own route, owned).
 *
 * @mutate scripts/audit/pressProdSafety.mjs |   if (persona === "incomplete") return SKIP_INCOMPLETE_SEED; |
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const mutationGate = safety.mutationGate as (a: Record<string, unknown>) => Promise<string | null>;
const SKIP = safety.SKIP_INCOMPLETE_SEED as string;

const gate = (label: string, persona: string, meta: Record<string, unknown> = {}) =>
  mutationGate({
    label,
    meta: { rowText: "", ...meta },
    chainOwned: true,
    persona,
    routeUrl: "/complete-profile",
    urlOwned: { owned: true, shared: false },
    owners: { names: [] },
    stripeMode: async () => ({ mode: "test", detail: "test" }),
    note: () => {},
  });

const WRITES: Array<[string, Record<string, unknown>]> = [
  ["Enter App", { type: "submit" }],
  ["Save changes", { type: "submit" }],
  ["Upload photo", { commit: "confirm" }],
  ["Accept", {}],
];

describe("press-every-control never writes as the incomplete seed account", () => {
  it.each(WRITES)("refuses %s as the incomplete persona", async (label, meta) => {
    expect(await gate(label, "incomplete", meta)).toBe(SKIP);
  });

  it("still presses the same submit as an ordinary test persona (the rule is the persona, not the words)", async () => {
    expect(await gate("Enter App", "customer", { type: "submit" })).toBeNull();
  });

  it("covers every gated write the case list names", () => {
    expect(WRITES.length).toBeGreaterThan(3);
  });
});
