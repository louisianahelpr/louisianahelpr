/**
 * Audit 2026-10-29 A2-L12: a done step's button read "What , done. Go back to this step" (the label
 * span and a separate sr-only span joined with a stray space). Its name is now built whole.
 *
 * @mutate src/components/postjob/PostJobStepRail.tsx | aria-label={t("postJob.railDone", { label })} | data-x=""
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostJobStepRail } from "./PostJobStepRail";
import { POST_JOB_SCREENS } from "./postJobScreens";

describe("a done post-job step names itself cleanly (A2-L12)", () => {
  it("reads <step>, done. Go back to this step", () => {
    const [first, second] = POST_JOB_SCREENS;
    render(<PostJobStepRail screen={second.key} onPick={() => {}} />);
    // Browsers join the old label span and sr-only span with a space ("What , done"); the name is now one string.
    const button = screen.getByRole("button", { name: new RegExp(`^${first.rail}`) });
    expect(button.getAttribute("aria-label")).toBe(`${first.rail}, done. Go back to this step`);
  });
});
