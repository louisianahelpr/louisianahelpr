/**
 * Audit 2026-10-29 A2-L12: a done step's button read "What , done. Go back to this step" (the label
 * span and a separate sr-only span joined with a stray space). Its name is now built whole.
 * Owner 2026-11-20: the rail is the four steps (What you need, When, Budget, Post).
 *
 * @mutate src/components/postjob/PostJobStepRail.tsx | aria-label={t("postJob.railDone", { label })} | data-x=""
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostJobStepRail } from "./PostJobStepRail";

describe("a done post-job step names itself cleanly (A2-L12)", () => {
  it("reads <step>, done. Go back to this step", () => {
    render(<PostJobStepRail screen="where" onPick={() => {}} />);
    // Browsers join the old label span and sr-only span with a space ("What , done"); the name is now one string.
    const button = screen.getByRole("button", { name: /^What you need/ });
    expect(button.getAttribute("aria-label")).toBe("What you need, done. Go back to this step");
  });
});
