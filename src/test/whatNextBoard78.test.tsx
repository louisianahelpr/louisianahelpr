/**
 * Board 78, "What next" after the poster sends the offer: the shared WhatNextSheet. True to how
 * hiring works today: the Helpr still has to accept, so "Offer sent", the owner's held sentence
 * (Q997), the Helpr named (never a pronoun), no address promised and no amount printed.
 *
 * @mutate src/components/job-card/PaymentHeldDialog.tsx |   if (side === "poster") return <PosterWhatNext who={who ?? null} onClose={onClose} />; |
 * @mutate src/components/job-card/PaymentHeldDialog.tsx | {who?.cardHeld ? `Your card is charged when ${name ?? "your Helpr"} accepts. Then Louisiana Helpr holds the payment until the job is done.` : PAYMENT_HELD_SENTENCE} | {PAYMENT_HELD_SENTENCE}
 * @mutate src/components/job-card/activityActions/useOfferHandlers.ts |     setPaymentHeldWho({ name: deadlineDialogApp.profiles?.full_name ?? null, dateNeeded: selectedJob.date_needed ?? null, cardHeld: selectedJob.payment_status === "held" }); |
 * @mutate src/components/job-card/ActivityOfferDialogs.tsx | who={actions.paymentHeldWho} |
 * @mutate src/components/job-card/PaymentHeldDialog.tsx |   if (side === "helpr") return <HelprWhatNext who={who ?? null} onClose={onClose} />; |
 * @mutate src/components/whatNext/WhatNextSheet.tsx | ? <DialogAcknowledgeAction>{primary.label}</DialogAcknowledgeAction> | ? <SheetPrimaryAction onClick={() => {}}>{primary.label}</SheetPrimaryAction>
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { PaymentHeldDialog, PAYMENT_HELD_SENTENCE } from "@/components/job-card/PaymentHeldDialog";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
const code = (f: string) => readFileSync(resolve(__dirname, "../..", f), "utf8");

describe("board 78: what next after sending the offer", () => {
  // JOBS3-45: a held card has paid nothing yet; "The payment is held" was untrue beside "Andre accepts · Now".
  it("a card only held says when the charge comes, never that the payment is held", () => {
    render(<PaymentHeldDialog side="poster" who={{ name: "Andre Thibodeaux", dateNeeded: "2026-10-31", cardHeld: true }} onClose={() => {}} />);
    const text = screen.getByTestId("what-next-sheet").textContent ?? "";
    expect(text).toContain("Your card is charged when Andre accepts. Then Louisiana Helpr holds the payment until the job is done.");
    expect(text).not.toContain(PAYMENT_HELD_SENTENCE);
  });

  it("names the Helpr, waits on the accept, dates the job and says the money is held", () => {
    render(<PaymentHeldDialog side="poster" who={{ name: "Andre Thibodeaux", dateNeeded: "2026-10-31" }} onClose={() => {}} />);
    const sheet = screen.getByTestId("what-next-sheet");
    expect(screen.getByRole("heading", { name: "Offer sent" })).toBeTruthy();
    expect(sheet.textContent).toContain(PAYMENT_HELD_SENTENCE);
    const steps = within(sheet).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "now", "later", "later"]);
    expect(steps[1].textContent).toContain("Andre accepts");
    expect(steps[2].textContent).toContain("Sat, Oct 31");
    expect(steps[3].textContent).toContain("Then Andre is paid");
    const text = sheet.textContent ?? "";
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/\b(he|she|his|her|they|them)\b/i);
    expect(text).not.toMatch(/address/i);
  });

  it("without a name or date it still reads, and the Helpr side keeps its own pop-up", () => {
    const { rerender } = render(<PaymentHeldDialog side="poster" who={null} onClose={() => {}} />);
    expect(screen.getByText("Your Helpr accepts")).toBeTruthy();
    expect(screen.getByText("The job day")).toBeTruthy();
    rerender(<PaymentHeldDialog side={null} onClose={() => {}} />);
    expect(screen.queryByTestId("what-next-sheet")).toBeNull();
  });

  it("the sent offer carries the Helpr's name and the job's date to the sheet", () => {
    expect(code("src/components/job-card/activityActions/useOfferHandlers.ts")).toMatch(/setPaymentHeldWho\(\{ name: deadlineDialogApp\.profiles\?\.full_name \?\? null, dateNeeded: selectedJob\.date_needed \?\? null, cardHeld: selectedJob\.payment_status === "held" \}\)/);
    expect(code("src/components/job-card/ActivityOfferDialogs.tsx")).toMatch(/who=\{actions\.paymentHeldWho\}/);
  });
});

describe("board 60: the Helpr's 'You're hired' after accepting", () => {
  it("names the poster, keeps the held sentence, and walks the tracker's real order", () => {
    render(<PaymentHeldDialog side="helpr" who={{ name: "Travis Boudreaux", dateNeeded: "2026-10-24", jobId: "j1" }} onClose={() => {}} />);
    const sheet = screen.getByTestId("what-next-sheet");
    expect(screen.getByRole("heading", { name: "You're hired" })).toBeTruthy();
    expect(sheet.textContent).toContain("Travis picked you.");
    expect(sheet.textContent).toContain(PAYMENT_HELD_SENTENCE);
    const steps = within(sheet).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "now", "later", "later"]);
    expect(steps[1].textContent).toContain("Confirm the day before Sat, Oct 24");
    expect(sheet.textContent).not.toMatch(/\$|\b(he|she|his|her|they)\b/i);
    // "Got it" only closes: the close-only primitive the press audit can press as a read.
    expect(screen.getByRole("button", { name: "Got it" }).hasAttribute("data-popup-dismiss")).toBe(true);
  });

  it("the accept hands the job id, and Activity fills in the poster and date", () => {
    expect((code("src/components/job-card/activityActions/useOfferHandlers.ts").match(/setPaymentHeldWho\(\{ name: null, dateNeeded: null, jobId: app\.job_id \}\);/g) ?? []).length).toBe(2);
    expect(code("src/components/job-card/useActivityActions.ts")).toMatch(/name: a\?\.posterName \?\? null, dateNeeded: a\?\.job\?\.date_needed \?\? null/);
  });
});
