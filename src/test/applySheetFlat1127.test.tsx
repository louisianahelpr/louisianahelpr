/**
 * Polish audit 11-27 #45 (MEDIUM, with #3's Apply line and #22's rust prices): the Apply sheet had a card repeating
 * the job's title and details (the page is right behind it), the pay in rust inside a pink tinted box, and a 44px
 * "Apply now" against 56px main buttons elsewhere. Now: no summary card, the price in ink at 24px on white with one
 * 13px grey "Paid 3 days after the job is approved." line, and a 56px button (the save-message row was already 44px).
 *
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx |     <div data-apply-money=""> |     <div data-apply-money="" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx |         style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }} |         style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "-0.02em" }}
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx |           className="flex-1 min-w-0 h-14 px-4 group disabled:opacity-60" |           className="flex-1 min-w-0 h-11 sm:h-12 px-4 group disabled:opacity-60"
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: { onboarding_fee_paid: true } }) }));
vi.mock("@/hooks/useOnboardingFee", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOnboardingFee")>()),
  useOnboardingFeeCents: () => 0,
}));

import { ApplyEarningsBreakdown } from "@/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown";

const job = { id: "j", title: "Deep clean", budget: 100, is_group_job: false, helpers_needed: 1, urgent_fee: 0 } as unknown as EnrichedJob;

describe("the Apply sheet is flat: no job card, ink price on white, a 56px button (polish 11-27 #45)", () => {
  it("the money: no tinted box, ink 24px figure, one grey 'Paid ...' line", () => {
    const { container } = render(<ApplyEarningsBreakdown confirmApplyJob={job} platformFee={10} />);
    const box = container.querySelector("[data-apply-money]") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.getAttribute("style") ?? "").not.toMatch(/background/);
    const figure = box.querySelector("p") as HTMLElement;
    expect(figure.textContent).toMatch(/^\$\d+$/);
    expect(figure.className).toContain("text-ds-24");
    expect(figure.getAttribute("style") ?? "").toContain("--ink-deep");
    expect(figure.getAttribute("style") ?? "").not.toContain("burnt-sienna");
    expect(container.querySelector("[data-apply-paid-when]")?.textContent).toBe("Paid 3 days after the job is approved.");
  });

  it("no job summary card on the sheet; the main button is 56px", () => {
    const dialog = blankComments(readFileSync("src/components/dashboard/ApplyConfirmDialog.tsx", "utf8"));
    expect(dialog.length).toBeGreaterThan(500);
    expect(dialog).not.toMatch(/ApplyJobSummary|apply-job-summary/);
    const body = blankComments(readFileSync("src/components/dashboard/applyConfirmDialog/ApplyBody.tsx", "utf8"));
    expect(body).toContain('className="flex-1 min-w-0 h-14 px-4 group disabled:opacity-60"');
  });
});
