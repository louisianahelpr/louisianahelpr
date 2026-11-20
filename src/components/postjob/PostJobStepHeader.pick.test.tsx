import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PostJobStepHeader } from "./PostJobStepHeader";

/**
 * Owner 2026-10-25: the post-job stepper's passed steps go back when tapped, on
 * the phone too (the desktop rail already did). Only steps already passed and
 * allowed by canPick are buttons; the current step and steps ahead are not.
 *
 * @mutate src/components/postjob/PostJobStepHeader.tsx | return i + 1 < rawStep && key && onPick && (canPick?.(key) ?? true) ? ( | return i + 1 < rawStep && key && onPick ? (
 */
describe("the phone step bar reopens a passed step", () => {
  it("passed, pickable steps are buttons that call onPick with their screen", () => {
    const onPick = vi.fn();
    render(<PostJobStepHeader screen="price" question="What will you pay?" helper="h" onPick={onPick} canPick={(s) => s !== "groups"} />);
    const picks = screen.getAllByRole("button", { name: /go back to step/i });
    const keys = picks.map((b) => b.getAttribute("data-step-pick"));
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("groups"); // refused by canPick
    expect(keys).toContain("where"); // owner 11-20: step 2, When

    fireEvent.click(picks[keys.indexOf("where")]);
    expect(onPick).toHaveBeenCalledWith("where");
  });

  it("control: without onPick the bar has no buttons", () => {
    render(<PostJobStepHeader screen="price" question="q" helper="h" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});
