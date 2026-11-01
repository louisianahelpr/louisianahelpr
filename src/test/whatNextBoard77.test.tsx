/**
 * Board 77, "What next" after applying: the shared WhatNextSheet, built from real data.
 * The person who posted this job is named (never he/she), the step being waited on says "Now", no amount is
 * printed (the take-home stays on the apply sheet's breakdown), and a withheld note is told.
 *
 * @mutate src/components/dashboard/ApplicationSentDialog.tsx |         { key: "pick", label: `${who} picks a Helpr`, detail: "We'll let you know if you're picked", state: "now" }, |         { key: "pick", label: `${who} picks a Helpr`, detail: "We'll let you know if you're picked", state: "later" },
 * @mutate src/components/dashboard/ApplicationSentDialog.tsx |   const who = name ?? "The person who posted this job"; |   const who = "They";
 * @mutate src/components/whatNext/WhatNextSheet.tsx |         floor={!webDesktop} |         floor={false}
 * @mutate src/components/dashboard/helprTakeHome.tsx |   const net = computeNet(job.budget, tierPct, job.urgent_fee ?? 0, helpers, job.status === "disputed" ? 0 : firstPayoutFee, job).netEarnings; |   const net = job.budget;
 * @mutate src/components/whatNext/WhatNextSheet.tsx |           event.preventDefault(); |
 * @mutate src/components/whatNext/WhatNextSheet.tsx | className={`bg-premium-page focus:outline-none | className={`focus:outline-none
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, loading: false }) }));

const sent = { jobId: "j1", title: "Fence repair", noteWithheld: false, posterName: "Travis Boudreaux", dateNeeded: "2037-10-31" };

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
    // Opaque page surface, like the filter sheet: the glass default let the cards' controls
    // behind it show through as ghost squares (lead review of b77, 2026-10-20).
    expect(sheet.className.split(/\s+/)).toContain("bg-premium-page");
  });

  it("never prints an amount or a pronoun, and drops what it does not know", () => {
    render(<ApplicationSentDialog sent={{ jobId: "j2", title: null, noteWithheld: false }} onClose={() => {}} onView={() => {}} />);
    const text = screen.getByTestId("what-next-sheet").textContent ?? "";
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/\b(he|she|his|her)\b/i);
    expect(text).toContain("The person who posted this job picks a Helpr");
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

  it("prints the job price and the job page's take-home as one labelled pair, in rust (#62)", () => {
    // A flat-model job stamped 10% + 70c (new jobs, owner 2026-10-25): $85 - $9.20 = $75.80, floored like the receipt.
    const job = { id: "j1", title: "Fence repair", budget: 85, helper_fee_flat_cents: 70, helper_fee_percent: 10, category: "x", description: "", date_needed: "2037-10-31", location: "", customer_id: "p", status: "open", created_at: "" };
    render(<ApplicationSentDialog sent={{ ...sent, job: job as never }} platformFee={10} onClose={() => {}} onView={() => {}} />);
    const steps = within(screen.getByTestId("what-next-sheet")).getAllByRole("listitem");
    expect(steps[3].textContent).toContain("Your pay $75, paid once it's confirmed done");
    expect(steps[3].textContent).not.toMatch(/Job price/);
    const money = steps[3].querySelector("span.tabular-nums");
    expect(money?.className).toContain("--accent-ink");
  });

  it("opens with focus on the sheet, not on a button", () => {
    render(<ApplicationSentDialog sent={sent} onClose={() => {}} onView={() => {}} />);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("what-next-sheet");
  });
});
