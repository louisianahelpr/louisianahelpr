/**
 * REPORT A PROBLEM / DISPUTE LIVE INSIDE `More`, ON BOTH JOB CARDS, AT EVERY
 * WIDTH (owner, 2026-09-27: "report a problem should be under more tab";
 * scope ruled "Both job cards").
 *
 * Two halves:
 *  1. The shell: `JobStepCard` renders a chip keyed in MORE_ONLY_CHIP_KEYS
 *     inside the `More` popover even when the row has room for it (the
 *     unmeasured test DOM is the "everything fits" case), and never as a row
 *     child.
 *  2. The inventory, derived from source: every Report a Problem / Dispute chip
 *     in either job card's step trees carries a key the shell pins into `More`.
 *     A new chip with a fresh key would land on the row; this fails it.
 *
 * @mutate src/components/job-card/JobStepCard.tsx | export const MORE_ONLY_CHIP_KEYS: readonly string[] = ["report", "dispute"]; | export const MORE_ONLY_CHIP_KEYS: readonly string[] = ["dispute"];
 * @mutate src/components/job-card/JobStepCard.tsx | export const MORE_ONLY_CHIP_KEYS: readonly string[] = ["report", "dispute"]; | export const MORE_ONLY_CHIP_KEYS: readonly string[] = ["report"];
 * @mutate src/components/job-card/JobStepCard.tsx | const moreChips = [...moreOnly, ...rowChips.overflow]; | const moreChips = [...rowChips.overflow];
 * @mutate src/components/job-card/JobStepCard.tsx | const chips = allChips.filter((c) => !isMoreOnly(c)); | const chips = allChips;
 * @mutate src/pages/jobs/appliedJobCard/ActiveJobSection.tsx | key="report" | key="report-problem"
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { JobStepCard, MORE_ONLY_CHIP_KEYS } from "@/components/job-card/JobStepCard";
import { JobActionChip } from "@/components/job-card/JobActionRow";

const ROOT = resolve(__dirname, "../..");

function card(side: "helper" | "poster", key: string, label: string) {
  return render(
    <JobStepCard
      side={side}
      step="working"
      actions={[
        <JobActionChip key={key} icon={AlertTriangle} label={label} ariaLabel={label} tone="danger" onClick={vi.fn()} />,
        <JobActionChip key="message" icon={MessageSquare} label="Message" ariaLabel="Message" onClick={vi.fn()} />,
      ]}
    />,
  );
}

describe("Report a Problem / Dispute are only reachable through More", () => {
  for (const [side, key, label] of [
    ["helper", "report", "Report a Problem"],
    ["poster", "dispute", "Dispute"],
  ] as const) {
    it(`${side} card: ${label} is not on the row, and is inside More`, () => {
      const { container } = card(side, key, label);
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.getByRole("button", { name: "Message" })).toBeTruthy();
      const more = container.querySelector("[data-job-step-overflow]") as HTMLElement | null;
      expect(more).not.toBeNull();
      expect(more!.getAttribute("aria-label")).toBe("More — 1 more action for this job");
      fireEvent.click(more!);
      const panel = screen.getByRole("dialog", { name: "More actions for this job" });
      expect(within(panel).getByRole("button", { name: label })).toBeTruthy();
    });
  }
});

describe("every Report a Problem / Dispute chip on either card is keyed into More", () => {
  const DIRS = ["src/pages/jobs/appliedJobCard", "src/pages/jobs/appliedJobCard/steps", "src/pages/posts/postedJobCard/steps"];
  const found: Array<{ file: string; key: string | null }> = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(resolve(ROOT, dir))) {
      if (!name.endsWith(".tsx") || name.includes(".test.")) continue;
      const src = readFileSync(resolve(ROOT, dir, name), "utf8");
      for (const m of src.matchAll(/<JobActionChip\b[^>]*?label="(Report a Problem|Dispute)"/gs)) {
        const key = /key="([^"]+)"/.exec(m[0])?.[1] ?? null;
        found.push({ file: `${dir}/${name}`, key });
      }
    }
  }

  it("finds both cards' chips (the inventory is not empty)", () => {
    expect(found.map((f) => f.file).sort()).toEqual([
      "src/pages/jobs/appliedJobCard/ActiveJobSection.tsx",
      "src/pages/posts/postedJobCard/steps/InProgressStep.tsx",
    ]);
  });

  it("each one's key is in MORE_ONLY_CHIP_KEYS", () => {
    for (const f of found) expect(MORE_ONLY_CHIP_KEYS, f.file).toContain(f.key);
  });
});
