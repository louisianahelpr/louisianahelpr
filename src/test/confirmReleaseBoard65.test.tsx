// Board 65 (poster: confirm and release): "<Helpr> says it's done", the job, a money
// note with the job price only (never the Helpr's take-home), "Confirm and release $X"
// that runs the existing release, and "Something's not right" opening the fix request.
// @mutate src/pages/posts/CompletionChoiceSheet.tsx |                   {jobPrice ? `Confirm and release $${formatPriceExact(jobPrice)}` : "Confirm and release"} |                   {"Confirm and release"}
// @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx |             jobPrice={!job.is_group_job && !(job.urgent_fee && job.urgent_fee > 0) ? job.budget : null} |             jobPrice={job.budget}
// @mutate src/pages/posts/CompletionChoiceSheet.tsx |           event.preventDefault();\n          (event.currentTarget as HTMLElement \| null)?.focus({ preventScroll: true }); |           void event;
// @mutate src/pages/posts/CompletionChoiceSheet.tsx | <strong className="tabular-nums" style={{ color: "hsl(var(--sienna-ink))" }}> | <strong className="tabular-nums">
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null }));
vi.mock("@/lib/notifications", () => ({ notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));

const { CompletionChoiceSheet } = await import("@/pages/posts/CompletionChoiceSheet");

function show(jobPrice: number | null, onConfirm = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CompletionChoiceSheet open jobId="j" jobTitle="Pressure wash driveway" helperId="h" helperName="Andre" userId="u"
          jobPrice={jobPrice} onClose={() => {}} onConfirm={onConfirm} onRevisionSubmitted={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onConfirm;
}

describe("board 65: confirm and release", () => {
  it("names the Helpr and the job price, and the primary releases", () => {
    const onConfirm = show(90);
    expect(screen.getByText("Andre says it's done")).toBeInTheDocument();
    expect(screen.getByText("Pressure wash driveway")).toBeInTheDocument();
    expect(screen.getByText(/job price is/).textContent).toMatch(/\$90 job price is released to Andre/);
    expect(screen.queryByText(/take home|takes home/i)).toBeNull();
    // lh-money-escrow review (2026-10-21) #3: no Helpr pay, fee or rule anywhere on the poster's release sheet.
    expect(document.body.textContent).not.toMatch(/receives|take.?home|payout|after fees|\d+%|\$0\.70/i);
    // #2: one consistent story: released on confirm; held only through "Something's not right".
    expect(screen.getByText(/job price is/).textContent).toMatch(/tap "Something's not right" and the money stays held\.$/);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and release $90" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("names no number when the release is not simply the job price, and 'Something's not right' asks what to fix", () => {
    show(null);
    expect(screen.getByRole("button", { name: "Confirm and release" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Something's not right" }));
    expect(screen.getByText("What needs to be fixed?")).toBeInTheDocument();
  });

  it("the card passes a price only for a one-Helpr job with no urgent bonus", () => {
    const src = blankComments(readFileSync("src/pages/posts/postedJobCard/steps/InProgressStep.tsx", "utf8"));
    expect(src).toMatch(/jobPrice=\{!job\.is_group_job && !\(job\.urgent_fee && job\.urgent_fee > 0\) \? job\.budget : null\}/);
  });

  // Lead MUST (2026-10-21): a stray Enter or Space at open must not release money.
  it("opens with focus on the sheet, never on the release button", async () => {
    show(90);
    const release = screen.getByRole("button", { name: "Confirm and release $90" });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).not.toBe(release);
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  });

  it("the note is ink with only the amount in rust (rust = money only)", () => {
    show(90);
    const note = screen.getByText(/job price is/);
    expect(note.className).toContain("text-foreground");
    expect(note.querySelector("strong")?.getAttribute("style")).toMatch(/sienna-ink/);
  });
});
