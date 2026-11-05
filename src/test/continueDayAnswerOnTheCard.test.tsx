/**
 * Owner 11-05: "accepting the new day should be on the job card instead, not hidden in the home page." The owner got
 * "Your Helpr needs another day: Yusef asked to finish 'Mow and Weed Eat' on Fri 11/6 at 3:15 PM" and the Posted card
 * had no way to accept it: Confirm / Decline new day lived only on the job page (useContinueDayActions).
 *
 * Class: a proposed continue day that waits on the viewer always has an answer control ON that viewer's card, on both
 * sides (the poster's Posted card for a Helpr's ask, the Helpr's Working card for a poster's ask), collapsed (the face's
 * one button + Decline under it) and open (the block), from ONE rule shared with the job page (continueDayAnswer).
 *
 * @mutate src/lib/continueDayWords.ts | const waitsOnMe = side === "poster" ? row.proposer !== "poster" : row.proposer === "poster"; | const waitsOnMe = side === "poster";
 * @mutate src/pages/posts/PostedJobCard.tsx | action={isExpanded ? null : continueDayAnswer.faceAction ?? faceAction} | action={isExpanded ? null : faceAction}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | action={isExpanded ? null : continueDayAnswer.faceAction ?? faceAction} | action={isExpanded ? null : faceAction}
 * @mutate src/pages/posts/PostedJobCard.tsx | {isExpanded && continueDayAnswer.block} | {null}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | {isExpanded && continueDayAnswer.block} | {null}
 * @mutate src/components/jobs/ContinueDayOnCard.tsx | under: { label: answer.decline, onClick: decline }, | under: undefined,
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ContinueDay } from "@/lib/continueDayWords";
import { blankComments } from "@/test/helpers/blankNonCode";

let row: ContinueDay | null = null;
vi.mock("@/hooks/useContinueDays", () => ({ useContinueDay: () => row }));
vi.mock("@/lib/continueDay", async (orig) => ({ ...(await orig<object>()), answerContinueDay: vi.fn(async () => {}) }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

const { useContinueDayOnCard } = await import("@/components/jobs/ContinueDayOnCard");
const { continueDayAnswer } = await import("@/lib/continueDayWords");

const ask = (proposer: "poster" | "helpr"): ContinueDay => ({
  id: "cd-1", job_id: "job-1", proposed_by: "u", new_date: "2026-11-06", new_start_time: "15:15:00",
  note: "Ran out of daylight", status: "proposed", helper_confirmed_at: null, proposer,
});
const JOB = { id: "job-1", status: "in_progress", is_group_job: false, has_active_dispute: false };
const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const card = (side: "poster" | "helpr", mine = true, job = JOB) =>
  renderHook(() => useContinueDayOnCard({ job, side, mine, otherFirst: "Yusef" }), { wrapper: wrap }).result.current;

describe("a new day that waits on me is answered on my card (owner 11-05)", () => {
  it("the poster's card: a Helpr's ask leads the face with Confirm new day, Decline under it, and says who asked", () => {
    row = ask("helpr");
    const c = card("poster");
    expect(c.faceAction?.label).toBe("Confirm new day");
    expect(c.faceAction?.tone).toBe("primary");
    expect(c.faceAction?.under?.label).toBe("Decline new day");
    expect(c.faceAction?.note).toContain("Yusef asked to finish on Fri 11/6 at 3:15 PM.");
    expect(c.faceAction?.note).toContain("Ran out of daylight");
    expect(c.block).not.toBeNull();
  });

  it("the Helpr's card: a poster's ask leads the face with Accept new day", () => {
    row = ask("poster");
    const c = card("helpr");
    expect(c.faceAction?.label).toBe("Accept new day");
    expect(c.faceAction?.under?.label).toBe("Decline new day");
  });

  it("my own ask, a set day, someone else's card, a crew job or a dispute: nothing to answer", () => {
    row = ask("helpr");
    expect(card("helpr").faceAction).toBeNull();
    expect(card("poster", false).faceAction).toBeNull();
    expect(card("poster", true, { ...JOB, is_group_job: true }).faceAction).toBeNull();
    expect(card("poster", true, { ...JOB, has_active_dispute: true }).faceAction).toBeNull();
    row = { ...ask("helpr"), status: "set" };
    expect(card("poster").faceAction).toBeNull();
  });

  it("one rule with the job page: every side x proposer pair, inventory of 4", () => {
    const pairs = (["poster", "helpr"] as const).flatMap((side) => (["poster", "helpr"] as const).map((p) => ({ side, p, a: continueDayAnswer(ask(p), side) })));
    expect(pairs.length).toBeGreaterThan(3);
    expect(pairs.filter((x) => x.a).map((x) => `${x.side}<-${x.p}`).sort()).toEqual(["helpr<-poster", "poster<-helpr"]);
    const hook = blankComments(readFileSync("src/pages/jobs/jobPage/useContinueDayActions.tsx", "utf8"));
    expect(hook).toMatch(/continueDayAnswer\(row, side\)/);
    expect(hook).not.toMatch(/row\??\.status === "proposed" && row\.proposer/);
  });

  it("both cards put the answer on the face and in the open card", () => {
    for (const f of ["src/pages/posts/PostedJobCard.tsx", "src/pages/jobs/AppliedJobCard.tsx"]) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).toMatch(/useContinueDayOnCard\(/);
      expect(src, f).toMatch(/action=\{isExpanded \? null : continueDayAnswer\.faceAction \?\? faceAction\}/);
      expect(src, f).toMatch(/\{isExpanded && continueDayAnswer\.block\}/);
    }
  });
});
