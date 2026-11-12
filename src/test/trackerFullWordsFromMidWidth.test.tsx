/**
 * THE TRACKER SAYS ITS STEPS' FULL NAMES FROM A 368px TRACKER (audit 2026-10-29 A2-L15).
 *
 * The bug: the 8-step tracker showed its full names ("Confirmed", "On the way", "Arrived") only from a 640px-wide
 * tracker. /payment-success's card (382px at 1440) and the job page's side panel (~420px at 1440) never reach 640,
 * so at 1440 they said "Conf." / "Way" / "Arr." while the Posted list beside them said the names
 * (p2b-pw-after-pay-1440.png, p2b-ownjob-open-p1-1440.png).
 *
 * The fix: from a 368px tracker each step shows its full name; a name too wide for its column breaks onto a second
 * line at its space or at a soft hyphen (U+00AD, invisible unless the word breaks there): "On the" / "way",
 * "Con-" / "firmed". Below 368px (a 375 phone's 277px tracker) the short words stay (F17).
 *
 * jsdom lays nothing out, so the widths are the measured ones below: Montserrat (public/fonts/
 * montserrat-normal-latin.woff2) at the tracker's 11px, in Chromium, weight 400 and 600 (the current step is bold),
 * 2026-10-29. The narrowest column in a 368px tracker is (368 - 7 gaps x 4px) / 8.5 fr = 40px (the current step's
 * column is 1.5fr and holds a 12px hand + 2px gap; a problem step's is 2fr).
 *
 * SIX STEPS, FULL WORDS AT EVERY WIDTH (owner pick 11-08, design audit A JP3): the short words are gone; six columns
 * give each full name room at any tracker width, which the arithmetic below proves for a 300px tracker (the
 * narrowest before the words step down) and a 260px one at 0.91em (trackerWordsFitNarrow.test.ts).
 * @mutate src/index.css | .job-step-wide { display: none; } | .job-step-wide { display: none; }\n.job-step-full { display: none; }
 * @mutate src/components/tracker/JobProgress.tsx | const DRAWN_STEPS = JOB_PROGRESS_STEPS.map((full, i) => ({ full, i })).slice(JOB_TRACKER_FIRST); | const DRAWN_STEPS = JOB_PROGRESS_STEPS.map((full, i) => ({ full, i }));
 * @mutate src/components/tracker/JobProgress.tsx | <span className="job-step-full min-w-0 text-center"> | <span className="job-step-full truncate">
 * @mutate src/components/tracker/jobProgressSteps.ts | "Con\u00ADfirmed", | "Confirmed",
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import { JobProgress } from "@/components/tracker/JobProgress";
import { JOB_PROGRESS_DRAWN, JOB_PROGRESS_STEPS } from "@/components/tracker/jobProgressState";

const ROOT = resolve(__dirname, "../..");
const css = blankCssComments(readFileSync(resolve(ROOT, "src/index.css"), "utf8"));
const tracker = blankComments(readFileSync(resolve(ROOT, "src/components/tracker/JobProgress.tsx"), "utf8"));

const SHY = "\u00AD";
/** Measured px at 11px, [regular, bold]. A piece not in this table fails the test: measure it first. */
const MEASURED: Record<string, [number, number]> = {
  "Post-": [28.6, 29.4], ed: [14.1, 14.4], "Of-": [17.1, 17.5], fered: [28.7, 29.7], Hired: [30.3, 31.0],
  "Con-": [26.1, 26.5], firmed: [36.8, 37.8], "On the": [38.1, 38.9], way: [21.7, 22.8], "Ar-": [16.4, 17.0],
  rived: [27.2, 28.3], "Work-": [33.4, 34.6], ing: [18.0, 18.4], Done: [30.1, 30.6],
  // Whole names, so a lost soft hyphen is caught by width, not by spelling.
  Posted: [38.4, 39.5], Offered: [41.7, 43.1], Confirmed: [58.7, 60.1], Arrived: [39.4, 41.1], Working: [47.4, 49.0],
};

/**
 * The lines a drawn name takes in its column. A name with spaces ("On the way") breaks before its last word (the
 * browser fills a line greedily and "On the" fits); a single word breaks at its soft hyphens ("Con-" / "firmed").
 */
function pieces(drawn: string): string[] {
  const words = drawn.split(" ");
  if (words.length > 1) return [words.slice(0, -1).join(" "), words[words.length - 1]];
  const parts = drawn.split(SHY);
  return parts.map((p, i) => (i < parts.length - 1 ? `${p}-` : p));
}

describe("the tracker says its full names from a 368px tracker (A2-L15)", () => {
  it("no short words at any width: the full name is never hidden, and there is no short span", () => {
    expect(css).not.toMatch(/\.job-step-full[^{]*\{[^}]*display: none/);
    expect(css).not.toContain(".job-step-short");
    expect(tracker).not.toContain("job-step-short");
    expect(tracker).not.toContain("JOB_PROGRESS_SHORT");
  });

  it("the full name may wrap (never an ellipsis) and is the drawn name with its soft hyphens", () => {
    const span = tracker.match(/<span className="(job-step-full[^"]*)">\{([^}]*)\}<\/span>/);
    expect(span, "the full-name span").not.toBeNull();
    expect(span![1].split(/\s+/)).not.toContain("truncate");
    expect(span![2]).toContain("stepDrawn(i)");
    // The drawn name comes from enJobSteps (F260q); its English is JOB_PROGRESS_DRAWN word for word (jobStepsInSpanish).
    expect(tracker).toContain("const stepDrawn = (i: number): string => t(`js.d.${i}` as MsgKey);");
    expect(JOB_PROGRESS_DRAWN.map((d) => d.replace(new RegExp(SHY, "g"), ""))).toEqual([...JOB_PROGRESS_STEPS]);
  });

  it("every piece of every drawn name fits the narrowest column of a 300px tracker, and of a 260px one at 0.91em, bold too", () => {
    // Six columns (Hired … Done); the current step's is 1.5fr and holds a 12px hand + 2px gap. A 300px tracker has
    // 2px gaps (under 320px); under 300px the words are 0.91em (trackerWordsFitNarrow).
    const fits = (w: number, scale: number) => {
      const col = (w - 5 * 2) / 6.5;
      return { col: col / scale, curCol: (col * 1.5 - 14) / scale };
    };
    const narrow = [fits(300, 1), fits(260, 0.91)];
    const col = Math.min(...narrow.map((f) => f.col));
    const curCol = Math.min(...narrow.map((f) => f.curCol));
    let n = 0;
    expect(JOB_PROGRESS_DRAWN.length).toBeGreaterThan(5);
    for (const drawn of JOB_PROGRESS_DRAWN.slice(2)) {
      for (const p of pieces(drawn)) {
        const m = MEASURED[p];
        expect(m, `measure "${p}" (from "${drawn}") before drawing it`).toBeDefined();
        expect(m[0], `"${p}" regular in a ${col.toFixed(1)}px column`).toBeLessThanOrEqual(col);
        expect(m[1], `"${p}" bold in the current step's ${curCol.toFixed(1)}px`).toBeLessThanOrEqual(curCol);
        n++;
      }
    }
    expect(n).toBeGreaterThan(8);
  });

  it("renders the full names (soft hyphens only) and keeps the screen-reader sentence's names", () => {
    const { container } = render(<JobProgress progress={{ stage: 3, waitingOnYou: true, tone: "progress", word: "Confirmed", next: "Tap to confirm", held: false }} />);
    const full = [...container.querySelectorAll(".job-step-full")].map((e) => e.textContent ?? "");
    expect(full.map((t) => t.replace(new RegExp(SHY, "g"), ""))).toEqual(JOB_PROGRESS_STEPS.slice(2));
    expect(full.join("")).not.toMatch(/Conf\.|Arr\./);
    expect(container.querySelector("[data-job-steps]")?.getAttribute("aria-label")).toContain("Confirmed");
    expect(container.querySelector("[data-job-steps]")?.getAttribute("aria-label")).not.toContain(SHY);
  });
});
