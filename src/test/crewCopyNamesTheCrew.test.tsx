/**
 * A CREW JOB'S WORDS NAME THE CREW (audit 2026-10-28 A2-B7, A2-C35; A2-B10 copy, lead trace 2026-10-29).
 *
 * A crew job (is_group_job) has no one `helper_id`: it is null, and the members live in group_job_helpers. Every
 * line that named "the Helpr" from helper_id went wrong on a crew:
 *   - B7: the poster's approve sheet read "Former member says it's done" (the deleted-account label for a null
 *     helper_id). Now "Your crew says it's done", and the rest of the sheet says "your crew".
 *   - C35: the Approve & Pay button's name said "release payment to your Helpr"; the approval notices said "Your
 *     Helpr is paid ..."; the Review button's name named only the next member. Now each names the crew.
 *   - B10: "How crew jobs work" said "Each Helpr is paid on their own when you confirm", but one Approve & Pay pays
 *     every roster member their share (process-scheduled-payouts reads group_job_helpers.share_cents, no
 *     per-member confirm). Now "When you approve, every Helpr on the crew is paid their share."
 * One-Helpr jobs keep their words.
 *
 * @mutate src/pages/posts/CompletionChoiceSheet.tsx |   const who = groupJob ? "Your crew" : helperName; |   const who = helperName;
 * @mutate src/pages/posts/CompletionChoiceSheet.tsx |   const whoMid = groupJob ? "your crew" : helperName; |   const whoMid = helperName;
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx | release the money to ${crew ? "your crew" : "your Helpr"} | release the money to ${"your Helpr"}
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx | helperName={crew ? "Your crew" : job.helper_id | helperName={job.helper_id
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |   const reviewAria = crew && nextCrewMember |   const reviewAria = false && nextCrewMember
 * @mutate src/components/GroupJobHelpers.tsx | When you approve, every Helpr on the crew is paid their share. | Each Helpr is paid on their own when you confirm.
 * @mutate supabase/functions/create-payment/index.ts | `Thanks for approving "${job.title}". ${isCrew ? "Every Helpr on your crew is" : "Your Helpr is"} paid | `Thanks for approving "${job.title}". Your Helpr is paid
 * @mutate supabase/functions/auto-release-payment/index.ts | You approved it, so ${job.is_group_job === true ? "every Helpr on your crew is" : "your Helpr is"} paid | You approved it, so your Helpr is paid
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));
vi.mock("@/lib/notifications", () => ({ notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));

const { CompletionChoiceSheet } = await import("@/pages/posts/CompletionChoiceSheet");

const code = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

function sheet(groupJob: boolean, helperName: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CompletionChoiceSheet open jobId="j" jobTitle="Move a couch" helperId={groupJob ? null : "h"} helperName={helperName} userId="u"
          groupJob={groupJob} jobPrice={null} onClose={() => {}} onConfirm={() => {}} onRevisionSubmitted={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a crew job's words name the crew", () => {
  it("B7: the approve sheet on a crew says 'Your crew says it's done', never the deleted-account label", () => {
    sheet(true, "Former member");
    expect(screen.getByText("Your crew says it's done")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Former member/);
  });

  it("a one-Helpr job keeps the Helpr's name", () => {
    sheet(false, "Andre");
    expect(screen.getByText("Andre says it's done")).toBeInTheDocument();
  });

  it("C35: Approve & Pay's name, the sheet's name and the Review button's name follow the crew", () => {
    const step = code("src/pages/posts/postedJobCard/steps/InProgressStep.tsx");
    expect(step).toMatch(/const crew = !!job\.is_group_job;/);
    expect(step).toContain('release the money to ${crew ? "your crew" : "your Helpr"}');
    expect(step).toMatch(/helperName=\{crew \? "Your crew" : job\.helper_id/);
    const done = code("src/pages/posts/postedJobCard/steps/CompletedStep.tsx");
    expect(done).toMatch(/const reviewAria = crew && nextCrewMember\s*\?\s*`Review — review your crew/);
    expect(done).toContain("ariaLabel={reviewAria}");
  });

  it("C35: the poster's approval notices say every Helpr on the crew is paid (create-payment, auto-release-payment)", () => {
    const pay = code("supabase/functions/create-payment/index.ts");
    const auto = code("supabase/functions/auto-release-payment/index.ts");
    // Inventory floor: two poster notices in create-payment, two in auto-release-payment.
    const crewLines = [...pay.matchAll(/isCrew \? "Every Helpr on your crew is" : "Your Helpr is"/g), ...auto.matchAll(/job\.is_group_job === true \? "(?:E|e)very Helpr on your crew is" : "(?:Y|y)our Helpr is"/g)];
    expect(crewLines.length).toBeGreaterThan(3);
    // No poster notice says "Your Helpr is paid" unconditionally any more.
    expect(pay + auto).not.toMatch(/[.!] (?:Y|y)our Helpr is paid \$\{payDay\}/);
    expect(auto).not.toMatch(/so your Helpr is paid \$\{payDay\}/);
  });

  it("B10: 'How crew jobs work' says one approval pays the whole crew", () => {
    const crew = code("src/components/GroupJobHelpers.tsx");
    expect(crew).toContain("When you approve, every Helpr on the crew is paid their share.");
    expect(crew).not.toContain("paid on their own when you confirm");
  });
});
