/**
 * Board 77, "What next" after applying: the shared WhatNextSheet, built from real data.
 * The poster is named (never he/she), the step being waited on says "Now", no amount is
 * printed (the take-home stays on the apply sheet's breakdown), and a withheld note is told.
 *
 * @mutate src/components/dashboard/ApplicationSentDialog.tsx |         { key: "pick", label: `${who} picks a Helpr`, detail: "We'll let you know if you're picked", state: "now" }, |         { key: "pick", label: `${who} picks a Helpr`, detail: "We'll let you know if you're picked", state: "later" },
 * @mutate src/components/dashboard/ApplicationSentDialog.tsx |   const who = name ?? "The poster"; |   const who = "They";
 * @mutate src/components/whatNext/WhatNextSheet.tsx |         floor={!webDesktop} |         floor={false}
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

const sent = { jobId: "j1", title: "Fence repair", noteWithheld: false, posterName: "Travis Boudreaux", dateNeeded: "2026-10-31" };

describe("board 77: what next after applying", () => {
  it("names the poster, marks the wait as Now and dates the job", () => {
    render(<ApplicationSentDialog sent={sent} onClose={() => {}} onView={() => {}} />);
    const sheet = screen.getByTestId("what-next-sheet");
    expect(screen.getByRole("heading", { name: "Application sent" })).toBeTruthy();
    const steps = within(sheet).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "now", "later", "later"]);
    expect(steps[1].textContent).toContain("Travis picks a Helpr");
    expect(steps[1].textContent).toContain("Now");
    expect(steps[2].textContent).toContain("If Travis picks you");
    expect(steps[3].textContent).toContain("Do the job, Sat, Oct 31");
    // Floor sheet on phone (board 77 is a bottom sheet).
    expect(sheet.className.split(/\s+/)).toContain("sheet-floor");
  });

  it("never prints an amount or a pronoun, and drops what it does not know", () => {
    render(<ApplicationSentDialog sent={{ jobId: "j2", title: null, noteWithheld: false }} onClose={() => {}} onView={() => {}} />);
    const text = screen.getByTestId("what-next-sheet").textContent ?? "";
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/\b(he|she|his|her)\b/i);
    expect(text).toContain("The poster picks a Helpr");
    expect(text).toContain("Do the job");
    expect(text).not.toContain("Do the job,");
  });

  it("tells the Helpr when the server held the note back", () => {
    render(<ApplicationSentDialog sent={{ ...sent, noteWithheld: true }} onClose={() => {}} onView={() => {}} />);
    expect(screen.getByText(/Your note wasn't included/)).toBeTruthy();
  });

  it("Got it is the one filled action; See the job opens the job", () => {
    const onView = vi.fn();
    render(<ApplicationSentDialog sent={sent} onClose={() => {}} onView={onView} />);
    screen.getByRole("button", { name: "See the job" }).click();
    expect(onView).toHaveBeenCalledWith("j1");
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
  });
});
