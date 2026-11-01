/**
 * Owner 11-01 (phone screenshot of the job page's Done stage): the side-by-side buttons wrapped to two lines
 * ("Message / Yusef", "Approve and / release"). In a pair each button wears its SHORT label on ONE line; a button
 * alone keeps the full words. The cap (PAIR_LABEL_MAX, 12) is the width of half the 320 row at 14px (measured 2026-11-01) (pairLabel.ts),
 * checked by eye in the 320 and 375 shots (~/.lh-shots/b107/after).
 * Inventory: every label literal the page's rows draw (posterPageActions, JobPage, helperFaceAction, the release).
 *
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |       {pair ? pairLabel(a.label) : a.label} |       {a.label}
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx | const PAIR_BTN = `min-w-0 w-full rounded-full leading-tight ${PAIR_TEXT}`; | const PAIR_BTN = BTN;
 * @mutate src/components/ui/pairLabel.ts |   [/^Approve and release$/, "Approve"], |
 * @mutate src/components/job-card/jobStepMenu.tsx |         {pair ? pairLabel(p.label) : p.label} |         {p.label}
 */
import { describe, expect, it, vi } from "vitest";
import { MessageCircle } from "lucide-react";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { JobPageActionRow } from "@/pages/jobs/jobPage/JobPageActionRow";
import { MenuAction } from "@/components/job-card/jobStepMenu";
import { JobActionChip } from "@/components/job-card/JobActionRow";
import { MessageCircle } from "lucide-react";
import { pairLabel, PAIR_LABEL_MAX } from "@/components/ui/pairLabel";
import { RELEASE_ACTION } from "@/lib/releaseCopy";
import { blankComments } from "@/test/helpers/blankNonCode";

const go = vi.fn();

describe("a side-by-side pair reads on one line", () => {
  it("Done stage: [Message | Approve], one line each, the full words kept as the name", () => {
    render(<JobPageActionRow tag="poster" lead={{ key: "step", label: RELEASE_ACTION, go }} leadIsStep extras={[{ key: "message", label: "Message Yusef", go }]} />);
    const row = document.querySelector("[data-job-row='poster']")!;
    const btns = [...row.querySelectorAll("button")];
    expect(btns.map((b) => b.textContent)).toEqual(["Message", "Approve"]);
    for (const b of btns) expect(b.className.split(/\s+/)).toContain("whitespace-nowrap");
    expect(screen.getByRole("button", { name: RELEASE_ACTION })).toBe(btns[1]);
    expect(screen.getByRole("button", { name: "Message Yusef" })).toBe(btns[0]);
  });

  it("a button alone keeps its full words", () => {
    render(<JobPageActionRow tag="poster" lead={{ key: "step", label: "Post this job again", go }} leadIsStep extras={[]} />);
    expect(document.querySelector("[data-job-row='poster'] button")!.textContent).toBe("Post this job again");
  });

  it("the card's own action in the pair is short too; in the More options list it keeps the full words", () => {
    const chip = <JobActionChip icon={MessageCircle} tone="message" label="Message Yusef" onClick={go} />;
    const { unmount } = render(<MenuAction chip={chip} pair />);
    expect(screen.getByRole("button").textContent).toBe("Message");
    expect(screen.getByRole("button").className).toMatch(/whitespace-nowrap/);
    unmount();
    render(<MenuAction chip={chip} />);
    expect(screen.getByRole("button").textContent).toBe("Message Yusef");
  });

  it("every label the job page's rows draw fits the pair cap", () => {
    const files = ["src/pages/jobs/jobPage/posterPageActions.tsx", "src/pages/jobs/jobPage/JobPage.tsx", "src/pages/jobs/appliedJobCard/helperFaceAction.ts"];
    const labels = new Set<string>([RELEASE_ACTION, "Message Yusef", "Message your Helpr", "Review 2 applicants", "Review 1 applicant", "More options"]);
    for (const f of files) {
      for (const m of blankComments(readFileSync(f, "utf8")).matchAll(/label: "([^"]+)"/g)) labels.add(m[1]);
    }
    expect(labels.size).toBeGreaterThan(15);
    const tooLong = [...labels].filter((l) => pairLabel(l).length > PAIR_LABEL_MAX).map((l) => `${l} -> ${pairLabel(l)}`);
    expect(tooLong).toEqual([]);
  });
});
