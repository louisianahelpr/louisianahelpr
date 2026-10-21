// Audit #30 (2026-10-21): /declutter/move numbered its sections 1, 2, 4, 6 whenever "Check each item" and "List"
// were hidden. The numbers now count only the sections on screen.
// @mutate src/components/declutter/DeclutterMoveView.tsx |   const shown = ["when", "rooms", showCheck && "check", "items", showList && "list", "day"].filter(Boolean); |   const shown = ["when", "rooms", "check", "items", "list", "day"];
import { describe, it, expect } from "vitest";
import { moveStepNumber } from "./DeclutterMoveView";

describe("moving-out step numbers never skip", () => {
  it("first visit (nothing to check or list): 1 2 3 4", () => {
    const n = moveStepNumber(false, false);
    expect(["when", "rooms", "items", "day"].map(n)).toEqual([1, 2, 3, 4]);
  });
  it("every section shown: 1 to 6", () => {
    const n = moveStepNumber(true, true);
    expect(["when", "rooms", "check", "items", "list", "day"].map(n)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("items to check, nothing ready yet: 1 to 5", () => {
    const n = moveStepNumber(true, false);
    expect(["when", "rooms", "check", "items", "day"].map(n)).toEqual([1, 2, 3, 4, 5]);
  });
});
