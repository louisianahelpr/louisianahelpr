import { describe, it, expect } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

/**
 * The prod safety rules press-every-control runs under (owner, 2026-09-12:
 * destructive presses only on test-owned records; admin only against seed
 * targets; payments only on a Stripe TEST key). Each rule is exercised on both
 * sides so a regression that widens the gate is red here before it is red in
 * prod.
 */
type Gate = (o: Record<string, unknown>) => Promise<string | null>;
const gate = safety.mutationGate as Gate;

const owners = { ids: new Set(["11111111-1111-4111-8111-111111111111"]), names: ["Perry Poster", "[PRESS DO NOT ACCEPT]"] };
const testStripe = async () => ({ mode: "test", detail: "cs_test_x" });
const liveStripe = async () => ({ mode: "live", detail: "cs_live_x" });
const unknownStripe = async () => ({ mode: "unknown", detail: "no url" });
const notOwned = { id: null, owned: false, why: "no record id in the URL" };
const base = { meta: { rowText: "" }, chainOwned: false, persona: "customer", routeUrl: "/browse", urlOwned: notOwned, owners, stripeMode: testStripe };

describe("press-every-control mutation gate (prod)", () => {
  it("never presses anything that would destroy the shared test account", async () => {
    expect(await gate({ ...base, label: "Delete account", routeUrl: "/profile?tab=settings" })).toBe(safety.SKIP_DESTROY);
    expect(await gate({ ...base, label: "Deactivate", routeUrl: "/profile" })).toBe(safety.SKIP_DESTROY);
    // …but an ordinary self-scoped save on the same route is allowed.
    expect(await gate({ ...base, label: "Save changes", routeUrl: "/profile?tab=settings" })).toBeNull();
  });

  it("presses payment controls only while Stripe is in TEST mode; unknown counts as live", async () => {
    const pay = { ...base, label: "Pay now", urlOwned: { id: "j", owned: true, why: "job owned by test account" } };
    expect(await gate(pay)).toBeNull();
    expect(await gate({ ...pay, stripeMode: liveStripe })).toBe(safety.SKIP_STRIPE);
    expect(await gate({ ...pay, stripeMode: unknownStripe })).toBe(safety.SKIP_STRIPE);
  });

  it("presses a mutating control on a URL record only when that record is test-owned", async () => {
    expect(await gate({ ...base, label: "Cancel job", routeUrl: "/jobs/x", urlOwned: { id: "x", owned: true, why: "job owned by test account" } })).toBeNull();
    expect(await gate({ ...base, label: "Cancel job", routeUrl: "/jobs/x", urlOwned: { id: "x", owned: false, why: "job belongs to a real user" } })).toBe(safety.SKIP_NOT_OWNED_URL);
  });

  it("presses a row action only when the row names a test-owned entity", async () => {
    expect(await gate({ ...base, label: "Apply", meta: { rowText: "Mow the lawn · Perry Poster · $40" } })).toBeNull();
    expect(await gate({ ...base, label: "Apply", meta: { rowText: "Mow the lawn · Jane Realuser · $40" } })).toBe(safety.SKIP_NOT_OWNED_ROW);
    // A confirm button inside a dialog inherits ownership from the row that opened it.
    expect(await gate({ ...base, label: "Confirm", meta: { rowText: "Are you sure?" }, chainOwned: true })).toBeNull();
  });

  it("never mutates the shared SEED fixtures, even though they are test-owned", async () => {
    expect(await gate({ ...base, label: "Cancel", routeUrl: "/my-posts", meta: { rowText: "SEED Mow and edge a corner lot · Perry Poster" } })).toBe(safety.SKIP_SHARED_SEED);
    expect(await gate({ ...base, label: "Cancel job", routeUrl: "/jobs/x", urlOwned: { id: "x", owned: false, shared: true, why: "shared SEED fixture" } })).toBe(safety.SKIP_SHARED_SEED);
    expect(safety.isSharedSeed("SEED Feed and walk two dogs")).toBe(true);
    expect(safety.isSharedSeed("Reseed the lawn")).toBe(false);
  });

  it("allows self-scoped mutations for a signed-in test account, never for admin", async () => {
    expect(await gate({ ...base, label: "Submit", routeUrl: "/support" })).toBeNull();
    expect(await gate({ ...base, label: "Save", routeUrl: "/admin?view=settings", persona: "admin" })).toBe(safety.SKIP_ADMIN);
    expect(await gate({ ...base, label: "Ban", routeUrl: "/admin?view=people", persona: "admin", meta: { rowText: "Perry Poster · pending" } })).toBeNull();
    expect(await gate({ ...base, label: "Ban", routeUrl: "/admin?view=people", persona: "admin", meta: { rowText: "Jane Realuser · pending" } })).toBe(safety.SKIP_ADMIN);
  });

  it("every skip reason the gate can return is a DOCUMENTED skip (counts toward coverage, never silently)", () => {
    const documented = harness.DOCUMENTED_SKIPS as Set<string>;
    for (const k of ["SKIP_DESTROY", "SKIP_STRIPE", "SKIP_ADMIN", "SKIP_SHARED_SEED", "SKIP_NOT_OWNED_URL", "SKIP_NOT_OWNED_ROW"]) {
      expect(documented.has(safety[k] as string), k).toBe(true);
    }
  });

  it("the harness has no mock path left", () => {
    const src = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../scripts/audit/press-every-control.mjs"), "utf8") as string;
    for (const token of ["installSupabaseMocks", "rolldown", "MODE=mock", "seedAuthedSession", "FAKE_CUSTOMER"]) expect(src.includes(token), token).toBe(false);
  });
});
