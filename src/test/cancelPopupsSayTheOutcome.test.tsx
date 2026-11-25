/**
 * Deep audit 11-22 #35: cancel pop-ups. (a) The poster cancelling an open job whose card is only held confirmed
 * without the money outcome: "Your card was only held, never charged" sat inside the closed "Full cancellation policy".
 * (b) The Helpr's cancel packed four strike rungs and a guilt line ("going quiet costs the person who posted it their
 * whole day") into one red callout, and the required reason box was not marked required.
 *
 * Fix: (a) a plain line above the buttons, "Nothing is charged. Your card was only held, and the hold is let go within
 * about 10 minutes." (card-hold-sweep's own window, the policy's words). (b) Every Helpr cancel / leave confirm
 * (ActiveJobSection, ConfirmedSection, CrewMemberSection) leads with the one fact; the ladder is behind a closed
 * "How strikes work" (StrikeLadderDetails); the reason label says "(required)" and the box is aria-required.
 *
 * CLASS GUARD: no BrandConfirmDialog callout in src/ carries the strike ladder, and RELIABILITY_LADDER_SENTENCE is read
 * only by StrikeLadderDetails (exact both ways).
 *
 * @mutate src/components/CancellationDialog.tsx |           {cardHeld && !hasHelper && !nobodyLeft && ( |           {false && (
 * @mutate src/pages/jobs/appliedJobCard/helperCancelCopy.ts |   return "Cancelling a job you committed to counts as a reliability strike."; |   return `Cancelling a job you committed to counts as a reliability strike — ${"a second is a final warning"}.`;
 * @mutate src/pages/jobs/appliedJobCard/ActiveJobSection.tsx |             What happened? (required) The person |             What happened? The person
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    })),
  },
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { CancellationDialog } from "@/components/CancellationDialog";
import { StrikeLadderDetails } from "@/components/StrikeLadderDetails";
import { helperCancelCallout } from "@/pages/jobs/appliedJobCard/helperCancelCopy";

const LADDER_WORDS = /final warning|suspends your account|7-day|7 days/i;

describe("deep audit 11-22 #35 (a): the poster sees the money outcome before confirming", () => {
  it("an open job with a held card: 'Nothing is charged…' outside the closed policy", () => {
    render(<CancellationDialog jobId="j1" jobTitle="Fix the fence" jobDate="2037-01-01" jobStartTime={null} jobBudget={100}
      hasHelper={false} wasFunded={false} cardHeld open onClose={vi.fn()} onCancelled={vi.fn()} />);
    const line = document.querySelector("[data-cancel-card-held]");
    expect(line?.textContent).toBe("Nothing is charged. Your card was only held, and the hold is let go within about 10 minutes.");
    expect(line?.closest("details")).toBeNull();
  });

  it("a hired job (or an unheld card) does not say it", () => {
    render(<CancellationDialog jobId="j1" jobTitle="Fix the fence" jobDate="2037-01-01" jobStartTime={null} jobBudget={100}
      hasHelper wasFunded helperName="Marie" open onClose={vi.fn()} onCancelled={vi.fn()} />);
    expect(document.querySelector("[data-cancel-card-held]")).toBeNull();
  });
});

describe("deep audit 11-22 #35 (b): the Helpr's cancel leads with one line", () => {
  it("the callout is the one fact, no ladder, no guilt line", () => {
    const text = helperCancelCallout(null, null);
    expect(text).toBe("Cancelling a job you committed to counts as a reliability strike.");
    expect(text).not.toMatch(LADDER_WORDS);
  });

  it("the ladder is behind a closed 'How strikes work'", () => {
    render(<StrikeLadderDetails />);
    const d = document.querySelector("details[data-strike-ladder]") as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(screen.getByText("How strikes work")).toBeInTheDocument();
    expect(d.textContent).toMatch(/final warning/);
  });

  it("ActiveJobSection: no guilt line, ladder behind the link, reason marked required", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/jobs/appliedJobCard/ActiveJobSection.tsx"), "utf8"));
    expect(src).not.toMatch(/going quiet/);
    expect(src).toContain("<StrikeLadderDetails />");
    expect(src).toContain("What happened? (required)");
    expect(src).toContain('aria-required="true"');
  });
});

/** Each `callout={…}` attribute's text, by brace depth, from a comment-blanked source. */
export function callouts(code: string): string[] {
  const out: string[] = [];
  let at = code.indexOf("callout={");
  while (at >= 0) {
    let depth = 0;
    let i = at + "callout=".length;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) break;
    }
    out.push(code.slice(at, i + 1));
    at = code.indexOf("callout={", i);
  }
  return out;
}

describe("CLASS: a confirm callout never carries the strike ladder", () => {
  const root = process.cwd();
  const files = walkSource([join(root, "src")]).filter((f) => !/\.test\.tsx?$|\/src\/test\//.test(f));
  const sources = files.map((f) => ({ f: relative(root, f), code: blankComments(readFileSync(f, "utf8")) }));

  it("the parser reads a callout's text", () => {
    expect(callouts("<X callout={{ icon: I, text: `a — ${RELIABILITY_LADDER_SENTENCE}.` }} />")[0]).toContain("RELIABILITY_LADDER_SENTENCE");
  });

  it("no callout holds the ladder sentence or its words", () => {
    let n = 0;
    const bad: string[] = [];
    for (const { f, code } of sources) {
      for (const c of callouts(code)) {
        n++;
        if (/RELIABILITY_LADDER_SENTENCE/.test(c) || LADDER_WORDS.test(c)) bad.push(f);
      }
    }
    expect(n).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  it("RELIABILITY_LADDER_SENTENCE is read only by StrikeLadderDetails", () => {
    const readers = sources
      .filter(({ f, code }) => !f.endsWith("src/lib/reliabilityLadder.ts") && /\bRELIABILITY_LADDER_SENTENCE\b/.test(code))
      .map(({ f }) => f);
    expect(readers).toEqual(["src/components/StrikeLadderDetails.tsx"]);
  });
});
