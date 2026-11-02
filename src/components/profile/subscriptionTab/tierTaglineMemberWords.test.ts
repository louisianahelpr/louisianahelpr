/**
 * MEMBERSHIP TAGLINES ARE WORDS FOR A PAYING MEMBER, NOT AN INTERNAL TEST PLAN (Q2650).
 *
 * Account audit 1102d row 9 (~/.lh-shots/audit-1102d-findings.md, h-subscription-375.png): the Basic
 * tier ($5/mo) read "For testing the marketplace." beside its name. Every tier's `forWhom` is checked
 * from the live config (tierConfig), so a new tier with testing/beta/internal words fails too.
 */
// @mutate src/components/profile/subscriptionTab/tierConfig.tsx | forWhom: "For trying the extras.", | forWhom: "For testing the marketplace.",
import { describe, it, expect } from "vitest";
import { tierConfig } from "./tierConfig";

const NOT_MEMBER_WORDS = /\b(test|testing|tester|beta|internal|demo|qa|staging|sandbox)\b/i;

describe("membership taglines (Q2650)", () => {
  it("reads every tier from the config (inventory floor)", () => {
    expect(tierConfig.length).toBeGreaterThan(3);
  });
  it.each(tierConfig.map((t) => [t.id, t.forWhom] as const))("%s: tagline has no testing or internal words", (_id, forWhom) => {
    expect(forWhom).not.toMatch(NOT_MEMBER_WORDS);
    expect(forWhom.trim().length).toBeGreaterThan(0);
  });
});
