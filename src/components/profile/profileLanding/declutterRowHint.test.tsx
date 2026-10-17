/**
 * A RETURNING TESTER'S SKELETON HAS THE DECLUTTER ROW WHERE THE PAGE WILL
 * (Q1894).
 *
 * Measured on a local build against prod data (poster-e2e, 375, the switch
 * answer held 800 ms): with no hint the skeleton's Work eyebrow sat at y=325
 * and the loaded one at y=430, 90px of it the Declutter row; with the hint the
 * skeleton draws an inert 78px row-shaped box at the row's place and the Work
 * eyebrow sits at y=415 (the 15px left is the harness aborting stripe-connect,
 * whose error banner is taller than the setup bone).
 * ~/.lh-shots/reds-1017/prof/{fix-skel-cold,fix-skel-hint}.log
 *
 * The hint is layout only: the live row still waits for the server's answer.
 */
// @mutate src/components/profile/ProfilePageSkeleton.tsx | {declutterRow && <DeclutterEntryRowShape />} | {false && <DeclutterEntryRowShape />}
// @mutate src/components/profile/ProfilePageSkeleton.tsx | const [declutterRow] = useState(declutterRowHint); | const declutterRow = declutterRowHint();
// @mutate src/components/profile/profileLanding/DeclutterEntryRow.tsx |     if (settled) rememberDeclutterRow(on); |     if (settled) rememberDeclutterRow(true);
// @mutate src/components/profile/profileLanding/DeclutterEntryRow.tsx |     if (settled) rememberDeclutterRow(on); |     rememberDeclutterRow(on);
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const sw = vi.hoisted(() => ({ on: false, settled: false }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => sw.on,
  useFeatureStatus: () => ({ on: sw.on, settled: sw.settled }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ isAdmin: false }) }));

import { ProfilePageSkeleton } from "../ProfilePageSkeleton";
import { DeclutterEntryRow } from "./DeclutterEntryRow";
import { declutterRowHint } from "./declutterRowHint";

const KEY = "helpr_declutter_row";

beforeEach(() => {
  localStorage.clear();
  sw.on = false;
  sw.settled = false;
});

const skeleton = () => render(<MemoryRouter><ProfilePageSkeleton /></MemoryRouter>);

describe("the landing skeleton's Declutter row (Q1894)", () => {
  it("draws the row's shape only when this device last saw the row", () => {
    const a = skeleton();
    expect(screen.queryByTestId("declutter-row-shape")).toBeNull();
    a.unmount();
    localStorage.setItem(KEY, "1");
    skeleton();
    const shape = screen.getByTestId("declutter-row-shape");
    expect(shape.getAttribute("aria-hidden")).toBe("true");
    expect(shape.querySelector("a,button,[tabindex]"), "the skeleton's row can be tapped").toBeNull();
    // Same contents as the live row, so the same height.
    expect(shape.textContent).toContain("Declutter");
  });

  it("decides once, at mount: a hint written while the skeleton is up does not move it", () => {
    const { rerender } = skeleton();
    localStorage.setItem(KEY, "1");
    rerender(<MemoryRouter><ProfilePageSkeleton /></MemoryRouter>);
    expect(screen.queryByTestId("declutter-row-shape")).toBeNull();
  });

  it("the live row remembers each ANSWER, and nothing before it", () => {
    // The last visit's answer survives the wait for this one: useFeature
    // reads false while pending, and that is not an answer.
    localStorage.setItem(KEY, "1");
    const { rerender } = render(<MemoryRouter><DeclutterEntryRow /></MemoryRouter>);
    expect(localStorage.getItem(KEY), "the pending read was remembered as 'off'").toBe("1");
    sw.on = true;
    sw.settled = true;
    act(() => rerender(<MemoryRouter><DeclutterEntryRow /></MemoryRouter>));
    expect(screen.getByRole("link", { name: /Declutter/ }).getAttribute("href")).toBe("/declutter");
    expect(declutterRowHint()).toBe(true);
    sw.on = false;
    act(() => rerender(<MemoryRouter><DeclutterEntryRow /></MemoryRouter>));
    expect(declutterRowHint()).toBe(false);
    expect(screen.queryByRole("link", { name: /Declutter/ })).toBeNull();
  });
});
