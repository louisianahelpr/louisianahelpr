/**
 * Train y LANDER FIX (CI happy-path axe, PR #4922): a Working card's face link showed "$140" + "after fees" while its
 * aria-label said only "Open <title>, $140, <when>", so axe 4.14 label-content-name-mismatch (WCAG 2.5.3, Q1816) went
 * serious on /jobs. The link's name now holds the note's words, and a space keeps "$140" and "after fees" apart.
 * A poster's card (no note) keeps its old name.
 *
 * @mutate src/components/job-card/MineJobFace.tsx | money && moneyNote ? `${money} ${AFTER_FEES_WORDS}` : money | money
 * @mutate src/components/job-card/MineJobFace.tsx |                   {moneyNote && " "}\n |
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/tracker/JobProgress", () => ({ JobProgress: () => null }));

import { MineJobFace } from "@/components/job-card/MineJobFace";
import { AfterFeesNote } from "@/components/job/AfterFeesNote";

// axe 4.14's rule: visible text joined with no spaces, split into words, must sit contiguously in the name's words.
const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);

function face(moneyNote: React.ReactNode) {
  const { container, unmount } = render(
    <MemoryRouter>
      <MineJobFace jobId="j1" title="Feed and walk two dogs" category="pets" photo={null} when="Mon, Nov 30"
        status={null} money="$140" moneyNote={moneyNote} action={null} />
    </MemoryRouter>,
  );
  const link = container.querySelector("[data-mine-face-open]") as HTMLAnchorElement;
  const out = { seen: words(link.textContent ?? ""), name: words(link.getAttribute("aria-label") ?? "") };
  unmount();
  return out;
}

describe("a Helpr's Working card names the 'after fees' note it shows (WCAG 2.5.3)", () => {
  it("with the note: every shown word is in the link's name, in order", () => {
    const { seen, name } = face(<AfterFeesNote />);
    expect(seen.length).toBeGreaterThan(6);
    expect(seen).toContain("after");
    expect(name.join(" ")).toContain(seen.join(" "));
  });
  it("a poster's card (no note) keeps 'Open <title>, $X, <when>'", () => {
    const { seen, name } = face(null);
    expect(seen).not.toContain("after");
    expect(name.join(" ")).toBe("open feed and walk two dogs 140 mon nov 30");
    expect(name.join(" ")).toContain(seen.join(" "));
  });
});
