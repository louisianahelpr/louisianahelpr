import { describe, it, expect } from "vitest";
import {
  getProfileCompletion,
  PROFILE_COMPLETION_ANCHORS,
} from "./profileCompletion";

// The whole point of the rebuild: the meter must be able to READ something
// other than 100%. The old definition counted only fields that Signup or
// CompleteProfile already enforce, so every real account scored 100/100 and
// the checklist was an empty array. These tests pin the new contract —
// five optional items, 20% each, every incomplete one carrying a live anchor.

describe("getProfileCompletion", () => {
  it("reads 0% for an account that filled in none of the optional fields", () => {
    const c = getProfileCompletion({});
    expect(c.pct).toBe(0);
    expect(c.done).toBe(0);
    expect(c.total).toBe(5);
    expect(c.items.every((i) => !i.done)).toBe(true);
  });

  it("reads 100% only when all five optional fields are filled in", () => {
    const c = getProfileCompletion({
      phone: "(504) 555-0142",
      zipCode: "70115",
      skills: "Cleaning, yard work",
      idDocumentUrl: "https://example.test/id.jpg",
      portfolioCount: 3,
    });
    expect(c.pct).toBe(100);
    expect(c.done).toBe(5);
    expect(c.next).toBeNull();
  });

  it("moves 20 points per item, so the bar can actually show progress", () => {
    expect(getProfileCompletion({ phone: "5045550142" }).pct).toBe(20);
    expect(getProfileCompletion({ phone: "5045550142", zipCode: "70115" }).pct).toBe(40);
    expect(
      getProfileCompletion({
        phone: "5045550142",
        zipCode: "70115",
        skills: "Moving",
      }).pct,
    ).toBe(60);
    expect(
      getProfileCompletion({
        phone: "5045550142",
        zipCode: "70115",
        skills: "Moving",
        idDocumentUrl: "u",
      }).pct,
    ).toBe(80);
  });

  it("counts a phone only when it holds 10 real digits", () => {
    expect(getProfileCompletion({ phone: "504555" }).pct).toBe(0);
    expect(getProfileCompletion({ phone: "504-555-0142" }).pct).toBe(20);
  });

  // The skills column is a comma-separated string, so a value made only of
  // separators and spaces lists nothing and must not tick the row.
  it("counts skills only when at least one comma-separated entry has text", () => {
    expect(getProfileCompletion({ skills: "" }).pct).toBe(0);
    expect(getProfileCompletion({ skills: " , , " }).pct).toBe(0);
    expect(getProfileCompletion({ skills: "Cleaning" }).pct).toBe(20);
  });

  it("ignores a whitespace-only ZIP", () => {
    expect(getProfileCompletion({ zipCode: "   " }).pct).toBe(0);
  });

  it("counts work photos from one photo up", () => {
    expect(getProfileCompletion({ portfolioCount: 0 }).pct).toBe(0);
    expect(getProfileCompletion({ portfolioCount: 1 }).pct).toBe(20);
  });

  it("points `next` at the first incomplete item", () => {
    const c = getProfileCompletion({ phone: "5045550142" });
    expect(c.next?.label).toBe("ZIP code");
  });

  // Reachability is the load-bearing rule: a checklist row the user cannot
  // act on is worse than no row at all. Every item must name a control that
  // ProfileEditForm actually renders an id for.
  it("gives every item an anchor drawn from the shared anchor map", () => {
    const known = Object.values(PROFILE_COMPLETION_ANCHORS) as string[];
    const items = getProfileCompletion({}).items;
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.anchorId).toBeTruthy();
      expect(known).toContain(item.anchorId);
      expect(item.hint.length).toBeGreaterThan(0);
    }
    // No two rows may point at the same control.
    expect(new Set(items.map((i) => i.anchorId)).size).toBe(5);
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
