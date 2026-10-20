/**
 * Board 81, "What next" after the Helpr marks the job done: the shared WhatNextSheet, opened
 * by the tracker's Done (JobTracking -> announceTransition). The poster's confirm is the
 * step waited on; the auto-complete hours come from escrowTiming (the cron's real cutoff);
 * no amount or payout date is invented. Every other step keeps its toast.
 *
 * @mutate src/components/JobTracking.tsx |       if (message) announceTransition(newStatus, message, { jobId, at: now }); |       if (message) toast.success(message);
 * @mutate src/components/whatNext/HelperDoneWhatNext.tsx |   if (status === "done" && openSheet) openSheet(moment); |   if (false) openSheet?.(moment);
 * @mutate src/components/job-card/ActivityOfferDialogs.tsx |       <HelperDoneWhatNextHost /> |
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { announceTransition, HelperDoneWhatNextHost } from "@/components/whatNext/HelperDoneWhatNext";
import { AUTO_COMPLETE_HOURS } from "../../supabase/functions/_shared/escrowTiming";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const code = (f: string) => readFileSync(resolve(__dirname, "../..", f), "utf8");

describe("board 81: what next after marking done", () => {
  it("Done opens the sheet: confirm is Now, auto-complete hours are the real rule, no amount", () => {
    render(<MemoryRouter><HelperDoneWhatNextHost /></MemoryRouter>);
    act(() => announceTransition("done", "Payout requested.", { jobId: "j1", at: "2026-10-20T21:12:00Z" }));
    const sheet = screen.getByTestId("what-next-sheet");
    expect(screen.getByRole("heading", { name: "Nice work" })).toBeTruthy();
    const steps = within(sheet).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "now", "later", "later"]);
    expect(steps[1].textContent).toContain(`after ${AUTO_COMPLETE_HOURS} hours`);
    expect(sheet.textContent).not.toMatch(/\$/);
    expect(sheet.textContent).not.toMatch(/\b(he|she|his|her)\b/i);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Find your next job" })).toBeTruthy();
  });

  it("every other step keeps its toast", () => {
    announceTransition("on_the_way", "They know you're on the way.", { jobId: "j1", at: "2026-10-20T21:12:00Z" });
    expect(toast.success).toHaveBeenCalledWith("They know you're on the way.");
  });

  it("the tracker and the Activity page are wired to it", () => {
    expect(code("src/components/JobTracking.tsx")).toMatch(/if \(message\) announceTransition\(newStatus, message, \{ jobId, at: now \}\);/);
    expect(code("src/components/job-card/ActivityOfferDialogs.tsx")).toMatch(/<HelperDoneWhatNextHost \/>/);
  });
});
