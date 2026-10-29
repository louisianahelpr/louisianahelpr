/**
 * Audit 2026-10-29 A3-L4: the You row's Notifications caption ("What we tell you, and how") was cut
 * at 375, where the label keeps its full width (Q2306). The caption is now short enough to show whole.
 *
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |   notifications: "Alerts and email", |   notifications: "What we tell you, and how",
 */
import { describe, it, expect } from "vitest";
import { YOU_STATIC_CAPTIONS } from "./YouMenu";

describe("the You Notifications caption fits beside its label (A3-L4)", () => {
  it("is the short caption", () => {
    expect(YOU_STATIC_CAPTIONS.notifications).toBe("Alerts and email");
    expect((YOU_STATIC_CAPTIONS.notifications ?? "").length).toBeLessThanOrEqual(16);
  });
});
