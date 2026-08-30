import { describe, it, expect } from "vitest";
import {
  getProfileCompletion,
  PROFILE_COMPLETION_ANCHORS,
} from "./profileCompletion";

// Three optional items, ~33% each: phone, skills, work photos. ZIP and
// government ID were removed (owner, 2026-08-29) — ZIP is required at
// Signup now, and government ID is superseded by Stripe Identity.

describe("getProfileCompletion", () => {
  it("reads 0% for an account that filled in none of the optional fields", () => {
    const c = getProfileCompletion({});
    expect(c.pct).toBe(0);
    expect(c.done).toBe(0);
    expect(c.total).toBe(3);
    expect(c.items.every((i) => !i.done)).toBe(true);
  });

  it("reads 100% only when all three optional fields are filled in", () => {
    const c = getProfileCompletion({
      phone: "(504) 555-0142",
      skills: "Cleaning, yard work",
      portfolioCount: 3,
    });
    expect(c.pct).toBe(100);
    expect(c.done).toBe(3);
    expect(c.next).toBeNull();
  });

  it("moves roughly a third per item, so the bar can actually show progress", () => {
    expect(getProfileCompletion({ phone: "5045550142" }).pct).toBe(33);
    expect(
      getProfileCompletion({ phone: "5045550142", skills: "Moving" }).pct,
    ).toBe(67);
  });

  it("counts a phone only when it holds 10 real digits", () => {
    expect(getProfileCompletion({ phone: "504555" }).pct).toBe(0);
    expect(getProfileCompletion({ phone: "504-555-0142" }).pct).toBe(33);
  });

  // The skills column is a comma-separated string, so a value made only of
  // separators and spaces lists nothing and must not tick the row.
  it("counts skills only when at least one comma-separated entry has text", () => {
    expect(getProfileCompletion({ skills: "" }).pct).toBe(0);
    expect(getProfileCompletion({ skills: " , , " }).pct).toBe(0);
    expect(getProfileCompletion({ skills: "Cleaning" }).pct).toBe(33);
  });

  it("counts work photos from one photo up", () => {
    expect(getProfileCompletion({ portfolioCount: 0 }).pct).toBe(0);
    expect(getProfileCompletion({ portfolioCount: 1 }).pct).toBe(33);
  });

  it("points `next` at the first incomplete item", () => {
    const c = getProfileCompletion({ phone: "5045550142" });
    expect(c.next?.label).toBe("Skills & services");
  });

  // Reachability is the load-bearing rule: a checklist row the user cannot
  // act on is worse than no row at all. Every item must name a control that
  // ProfileEditForm actually renders an id for.
  it("gives every item an anchor drawn from the shared anchor map", () => {
    const known = Object.values(PROFILE_COMPLETION_ANCHORS) as string[];
    const items = getProfileCompletion({}).items;
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.anchorId).toBeTruthy();
      expect(known).toContain(item.anchorId);
      expect(item.hint.length).toBeGreaterThan(0);
    }
    // No two rows may point at the same control.
    expect(new Set(items.map((i) => i.anchorId)).size).toBe(3);
  });

  // Guard the rebuild's core decision: nothing earned may be counted. You
  // cannot "complete your profile" by waiting for a stranger to hire you.
  it("counts no earned history — labels name only things the user can do now", () => {
    const labels = getProfileCompletion({}).items.map((i) => i.label.toLowerCase());
    for (const banned of ["job", "review", "rating", "hire"]) {
      expect(labels.some((l) => l.includes(banned))).toBe(false);
    }
  });
});
