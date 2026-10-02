/**
 * EVERY no-applicants variant reads from the TOP of its card.
 *
 * Owner, 2026-10-01, at the Applicants page of a job needed tomorrow with
 * nobody applied: "This is kind of low." ApplicantsEmptyState stretches its
 * EmptyState card to the bottom of the screen, and EmptyState centred the
 * content in it (`justify-center`), so the icon sat under a ~half-screen
 * empty band (measured on prod: 142px from card top at 375, 173px at 1440,
 * against 56px of padding).
 *
 * The class of the defect is "a phase renders the card centred", so this
 * renders ALL FOUR phases (fresh / quiet / imminent / overdue — chosen by
 * created_at and date_needed exactly as applicantsEmptyPhase reads them) and
 * asserts each card is `justify-start`, never `justify-center`. Where the
 * icon actually lands is e2e/prod-audit/applicants-empty-position.spec.ts.
 *
 * Shown red on the original:
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsStates.tsx | align="top" | align="center"
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ApplicantsEmptyState } from "./ApplicantsStates";
import { todayYmd } from "@/lib/jobDate";
import { type Job } from "../../../../components/job-card/activityConstants";

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
// Days counted from the app's own "today" (America/Chicago), never the
// runner's: CI is UTC, so from 7pm CDT a UTC-calendar "tomorrow" is two days
// out and the imminent case silently became fresh.
const ymd = (offsetDays: number) => {
  const [y, m, d] = todayYmd().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
};

// Title fragments are how each phase is told apart in the render, so a case
// that silently fell into another phase fails here instead of passing twice.
const PHASES = [
  { phase: "fresh", created_at: iso(-2 * 3_600_000), date_needed: ymd(10) },
  { phase: "quiet", created_at: iso(-5 * DAY), date_needed: ymd(10) },
  { phase: "imminent", created_at: iso(-2 * 3_600_000), date_needed: ymd(1) },
  { phase: "overdue", created_at: iso(-5 * DAY), date_needed: ymd(-3) },
] as const;

function job(created_at: string, date_needed: string): Job {
  return {
    id: "00000000-0000-0000-0000-0000000000a1",
    title: "Feed and walk two dogs",
    status: "open",
    price: 160,
    category: "pet_care",
    created_at,
    date_needed,
  } as unknown as Job;
}

describe("Applicants empty state starts at the top of its card (owner, 2026-10-01)", () => {
  const titles = new Set<string>();

  for (const { phase, created_at, date_needed } of PHASES) {
    it(`${phase}: the card is justify-start, not centred`, () => {
      const { container } = render(
        <ApplicantsEmptyState
          selectedJob={job(created_at, date_needed)}
          onBoost={() => {}}
          onEdit={() => {}}
        />,
      );
      const card = container.querySelector<HTMLElement>(".liquid-glass");
      expect(card, `${phase}: no EmptyState card rendered`).not.toBeNull();
      const title = card!.querySelector("p.font-display")?.textContent ?? "";
      expect(title, `${phase}: rendered no title`).not.toBe("");
      titles.add(title);
      expect(card!.className, `${phase}: the content is centred down a tall card`).toContain(
        "justify-start",
      );
      expect(card!.className).not.toContain("justify-center");
    });
  }

  it("the four cases really are four different phases", () => {
    expect(titles.size).toBe(PHASES.length);
  });
});
