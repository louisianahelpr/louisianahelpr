/**
 * Owner 11-05: "accepting the new day should be on the job card instead, not hidden in the home page." The owner got
 * "Your Helpr needs another day: Yusef asked to finish 'Mow and Weed Eat' on Fri 11/6 at 3:15 PM" and the Posted card
 * had no way to accept it: Confirm / Decline new day lived only on the job page (useContinueDayActions).
 * Lead 11-05: while a proposal waits on the viewer, Confirm / Accept new day TAKES the card's one primary and Message
 * steps down to a chip, on both cards, collapsed and open.
 *
 * Class: a proposed continue day that waits on the viewer always has its answer as the ONE primary on that viewer's
 * card, on both sides (the poster's Posted card for a Helpr's ask, the Helpr's Working card for a poster's ask),
 * collapsed (the face's button + a Message chip + Decline under it) and open (the step row's primary slot, every other
 * primary standing down), from ONE rule shared with the job page (continueDayAnswer).
 *
 * @mutate src/lib/continueDayWords.ts | const waitsOnMe = side === "poster" ? row.proposer !== "poster" : row.proposer === "poster"; | const waitsOnMe = side === "poster";
 * @mutate src/pages/posts/PostedJobCard.tsx | action={isExpanded ? null : continueDayAnswer.faceAction ?? faceAction} | action={isExpanded ? null : faceAction}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | action={isExpanded ? null : continueDayAnswer.faceAction ?? faceAction} | action={isExpanded ? null : faceAction}
 * @mutate src/pages/posts/PostedJobCard.tsx | <JobCardLeadContext.Provider value={continueDayAnswer.lead}> | <JobCardLeadContext.Provider value={null}>
 * @mutate src/pages/jobs/AppliedJobCard.tsx | <JobCardLeadContext.Provider value={continueDayAnswer.lead}> | <JobCardLeadContext.Provider value={null}>
 * @mutate src/components/jobs/ContinueDayOnCard.tsx | under: { label: answer.decline, onClick: decline }, | under: undefined,
 * @mutate src/components/jobs/ContinueDayOnCard.tsx | chip: { label: first ? `Message ${first}` : "Message", onClick: message }, | chip: undefined,
 * @mutate src/components/job-card/jobStepRow.tsx | const standsDown = !!ctx?.leadActive && !lead; | const standsDown = false;
 * @mutate src/components/job-card/JobStepCard.tsx | <JobStepRowSlot slot="primary" lead>{cardLead.primary}</JobStepRowSlot> | {null}
 * @mutate src/components/job-card/MineJobFace.tsx | {action.chip.label} | {null}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckCircle2, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import type { ContinueDay } from "@/lib/continueDayWords";
import { blankComments } from "@/test/helpers/blankNonCode";

let row: ContinueDay | null = null;
vi.mock("@/hooks/useContinueDays", () => ({ useContinueDay: () => row }));
vi.mock("@/lib/continueDay", async (orig) => ({ ...(await orig<object>()), answerContinueDay: vi.fn(async () => {}) }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

const { useContinueDayOnCard } = await import("@/components/jobs/ContinueDayOnCard");
const { continueDayAnswer } = await import("@/lib/continueDayWords");
const { JobStepCard } = await import("@/components/job-card/JobStepCard");
const { JobStepPrimaryButton } = await import("@/components/job-card/JobActionRow");
const { JobStepRowSlot } = await import("@/components/job-card/jobStepRow");
const { JobCardLeadContext } = await import("@/components/job-card/jobCardLead");
const { MineJobFace } = await import("@/components/job-card/MineJobFace");

const ask = (proposer: "poster" | "helpr"): ContinueDay => ({
  id: "cd-1", job_id: "job-1", proposed_by: "u", new_date: "2026-11-06", new_start_time: "15:15:00",
  note: "Ran out of daylight", status: "proposed", helper_confirmed_at: null, proposer,
});
const JOB = { id: "job-1", status: "in_progress", is_group_job: false, has_active_dispute: false };
const wrap = ({ children }: { children: ReactNode }) => (
  <MemoryRouter><QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider></MemoryRouter>
);
const card = (side: "poster" | "helpr", mine = true, job = JOB) =>
  renderHook(() => useContinueDayOnCard({ job, side, mine, otherFirst: "Yusef", otherId: "u-2" }), { wrapper: wrap }).result.current;

describe("a new day that waits on me is the one primary on my card (owner 11-05, lead 11-05)", () => {
  it("the poster's card: a Helpr's ask leads the face with Confirm new day, Message as a chip, Decline under it", () => {
    row = ask("helpr");
    const c = card("poster");
    expect(c.faceAction?.label).toBe("Confirm new day");
    expect(c.faceAction?.tone).toBe("primary");
    expect(c.faceAction?.under?.label).toBe("Decline new day");
    expect(c.faceAction?.chip?.label).toBe("Message Yusef");
    expect(c.faceAction?.note).toContain("Yusef asked to finish on Fri 11/6 at 3:15 PM.");
    expect(c.faceAction?.note).toContain("Ran out of daylight");
    expect(c.lead).not.toBeNull();
  });

  it("the Helpr's card: a poster's ask leads the face with Accept new day", () => {
    row = ask("poster");
    const c = card("helpr");
    expect(c.faceAction?.label).toBe("Accept new day");
    expect(c.faceAction?.under?.label).toBe("Decline new day");
    expect(c.faceAction?.chip?.label).toBe("Message Yusef");
  });

  it("my own ask, a set day, someone else's card, a crew job or a dispute: nothing to answer", () => {
    row = ask("helpr");
    expect(card("helpr").faceAction).toBeNull();
    expect(card("poster", false).faceAction).toBeNull();
    expect(card("poster", true, { ...JOB, is_group_job: true }).faceAction).toBeNull();
    expect(card("poster", true, { ...JOB, has_active_dispute: true }).faceAction).toBeNull();
    row = { ...ask("helpr"), status: "set" };
    expect(card("poster").faceAction).toBeNull();
    expect(card("poster").lead).toBeNull();
  });

  it("one rule with the job page: every side x proposer pair, inventory of 4", () => {
    const pairs = (["poster", "helpr"] as const).flatMap((side) => (["poster", "helpr"] as const).map((p) => ({ side, p, a: continueDayAnswer(ask(p), side) })));
    expect(pairs.length).toBeGreaterThan(3);
    expect(pairs.filter((x) => x.a).map((x) => `${x.side}<-${x.p}`).sort()).toEqual(["helpr<-poster", "poster<-helpr"]);
    const hook = blankComments(readFileSync("src/pages/jobs/jobPage/useContinueDayActions.tsx", "utf8"));
    expect(hook).toMatch(/continueDayAnswer\(row, side\)/);
    expect(hook).not.toMatch(/row\??\.status === "proposed" && row\.proposer/);
  });

  it("collapsed: the face draws ONE primary (the answer) with Message as an outline chip beside it", () => {
    row = ask("helpr");
    const action = card("poster").faceAction;
    const { container } = render(
      <MemoryRouter>
        <MineJobFace jobId="job-1" title="Mow and Weed Eat" category={null} photo={null} when="Thu" status={null} money="$40" action={action} />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('[data-mine-face-action="primary"]')).toHaveLength(1);
    expect(container.querySelector("[data-mine-face-chip]")?.textContent).toBe("Message Yusef");
    expect(container.querySelector("[data-mine-face-under-action]")?.textContent).toBe("Decline new day");
  });

  it("open: the answer takes the step row's primary slot, the step's own primary and every other claim stand down", () => {
    row = ask("helpr");
    const lead = card("poster").lead;
    const step = (
      <JobStepCard
        side="poster"
        step="in_progress"
        primary={<JobStepPrimaryButton icon={MessageSquare} label="Message Yusef" onClick={() => {}} />}
        primaryChipKey="message"
        notice={<JobStepRowSlot slot="primary"><JobStepPrimaryButton icon={CheckCircle2} label="Mark it done" onClick={() => {}} /></JobStepRowSlot>}
        actions={[]}
      />
    );
    render(<MemoryRouter><JobCardLeadContext.Provider value={lead}>{step}</JobCardLeadContext.Provider></MemoryRouter>);
    const rowEl = document.querySelector("[data-job-step-row]")!;
    expect(rowEl.textContent).toContain("Confirm");
    expect(rowEl.textContent).not.toContain("Message Yusef");
    expect(rowEl.textContent).not.toContain("Mark it done");
    const note = document.querySelector("[data-job-step-note]")!;
    expect(note.textContent).toContain("Yusef asked to finish on Fri 11/6 at 3:15 PM.");
    expect(screen.getByRole("button", { name: "Decline new day" })).toBeTruthy();
  });

  it("without a lead the step row is untouched (the slot's other claims still draw)", () => {
    render(
      <MemoryRouter>
        <JobStepCard side="poster" step="in_progress" notice={<JobStepRowSlot slot="primary"><JobStepPrimaryButton icon={CheckCircle2} label="Mark it done" onClick={() => {}} /></JobStepRowSlot>} actions={[]} />
      </MemoryRouter>,
    );
    expect(document.querySelector("[data-job-step-row]")!.textContent).toContain("Mark it done");
  });

  it("both cards put the answer on the face and hand it to the open step row", () => {
    for (const f of ["src/pages/posts/PostedJobCard.tsx", "src/pages/jobs/AppliedJobCard.tsx"]) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).toMatch(/useContinueDayOnCard\(/);
      expect(src, f).toMatch(/action=\{isExpanded \? null : continueDayAnswer\.faceAction \?\? faceAction\}/);
      expect(src, f).toMatch(/<JobCardLeadContext\.Provider value=\{continueDayAnswer\.lead\}>/);
    }
  });
});
