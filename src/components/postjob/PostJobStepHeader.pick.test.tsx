import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PostJobStepHeader } from "./PostJobStepHeader";

/**
 * Owner 2026-10-25: the post-job stepper's passed steps go back when tapped, on
 * the phone too (the desktop rail already did). Only steps already passed and
 * allowed by canPick are buttons; the current step and steps ahead are not.
 *
 * @mutate src/components/postjob/PostJobStepHeader.tsx | return i + 1 < step && key && onPick && (canPick?.(key) ?? true) ? ( | return i + 1 < step && key && onPick ? (
 */
describe("the phone step bar reopens a passed step", () => {
  it("passed, pickable steps are buttons that call onPick with their screen", () => {
    const onPick = vi.fn();
    render(<PostJobStepHeader screen="price" question="What will you pay?" helper="h" onPick={onPick} canPick={(s) => s !== "kind"} />);
    const picks = screen.getAllByRole("button", { name: /go back to step/i });
    const keys = picks.map((b) => b.getAttribute("data-step-pick"));
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("where");
    expect(keys).toContain("details");
    expect(keys).not.toContain("kind");
    fireEvent.click(picks[keys.indexOf("details")]);
    expect(onPick).toHaveBeenCalledWith("details");
  });

  it("control: without onPick the bar has no buttons", () => {
    render(<PostJobStepHeader screen="price" question="q" helper="h" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});
