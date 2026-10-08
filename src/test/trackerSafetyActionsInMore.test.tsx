/**
 * REPORT A PROBLEM, DISPUTE AND SOS LIVE UNDER THE TRACKER'S ONE `More` MENU,
 * ON BOTH SIDES OF THE JOB (owner, 2026-10-01: "Report a problem" and "SOS"
 * must move under one "More" overflow menu, everywhere the tracker appears).
 *
 * The menu is the row's existing `More` control (`JobStepOverflowChip`, a
 * Radix Popover) — not a second menu. `JobStepCard` pins every chip whose React
 * key is in MORE_ONLY_CHIP_KEYS inside it at every width. So the class this
 * guards is "a safety action rendered with a key the shell does not pin", and
 * the inventory is every render of one, read from source:
 *
 *   - `<SosShareButton …>`              (both cards' SOS)
 *   - `<DisputeLink …>`                 (the old inline dispute link)
 *   - `<JobActionChip … label="Report a Problem" | "Dispute" …>`
 *
 * Each must carry a `key="…"` that is in MORE_ONLY_CHIP_KEYS; one without a
 * key, or with any other key, lands on the row and fails here.
 *
 * The runtime half renders the shell with Report, SOS and Message: neither
 * safety action is a row control, both are in the `More` panel, and pressing
 * SOS there still opens the "Share Your Location" sheet — which lives with
 * the caller, because the panel unmounts its contents when it closes.
 *
 * @mutate src/components/job-card/JobStepCard.tsx | export const MORE_ONLY_CHIP_KEYS: readonly string[] = ["report", "dispute", "sos"]; | export const MORE_ONLY_CHIP_KEYS: readonly string[] = ["report", "dispute"];
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx | <SosShareButton key="sos" | <SosShareButton key="sos-share"
 * @mutate src/pages/jobs/appliedJobCard/ActiveJobSection.tsx | <SosShareButton key="sos" | <SosShareButton
 * @mutate src/components/job-card/JobStepCard.tsx | const chips = allChips.filter((c) => !isMoreOnly(c)); | const chips = allChips;
 */
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { JobStepCard, MORE_ONLY_CHIP_KEYS } from "@/components/job-card/JobStepCard";
import { JobActionChip } from "@/components/job-card/JobActionRow";
import { SosShareButton, SosShareSheet } from "@/components/SosShareButton";
import { blankComments } from "@/test/helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

type Site = { file: string; line: number; tag: string; key: string | null };

/** Every render of a tracker safety action in app source, comments blanked. */
function inventory(): Site[] {
  const sites: Site[] = [];
  for (const abs of walk(SRC)) {
    const code = blankComments(readFileSync(abs, "utf8"));
    for (const m of code.matchAll(/<(SosShareButton|DisputeLink|JobActionChip)\b/g)) {
      const start = m.index!;
      // The tag's own attributes run to its self-close (or, for a non
      // self-closing element, its first `>` that is not an arrow).
      const selfClose = code.indexOf("/>", start);
      const tagSrc = code.slice(start, selfClose === -1 ? undefined : selfClose);
      const tag = m[1];
      if (tag === "JobActionChip" && !/\blabel="(Report a Problem|Dispute)"/.test(tagSrc)) continue;
      sites.push({
        file: relative(ROOT, abs),
        line: code.slice(0, start).split("\n").length,
        tag: tag === "JobActionChip" ? `JobActionChip ${/\blabel="([^"]+)"/.exec(tagSrc)![1]}` : tag,
        key: /\bkey="([^"]+)"/.exec(tagSrc)?.[1] ?? null,
      });
    }
  }
  return sites;
}

describe("every tracker safety action is keyed into the shell's `More` menu", () => {
  const sites = inventory();

  it("the inventory is not empty (both cards' SOS, Report a Problem, Dispute)", () => {
    expect(sites.length).toBeGreaterThan(3);
    const tags = sites.map((s) => s.tag);
    expect(tags.filter((t) => t === "SosShareButton").length).toBeGreaterThan(1);
    expect(tags).toContain("JobActionChip Report a Problem");
    expect(tags).toContain("JobActionChip Dispute");
  });

  it("MORE_ONLY_CHIP_KEYS pins report, dispute and sos", () => {
    for (const k of ["report", "dispute", "sos"]) expect(MORE_ONLY_CHIP_KEYS).toContain(k);
  });

  it("no render site carries a key the shell would leave on the row", () => {
    const offRow = sites.filter((s) => s.key === null || !MORE_ONLY_CHIP_KEYS.includes(s.key));
    expect(offRow.map((s) => `${s.file}:${s.line} <${s.tag} key=${s.key ?? "(none)"}>`)).toEqual([]);
  });
});

/** The caller's shape: the chip asks, the caller owns the sheet. */
function Harness({ side }: { side: "helper" | "poster" }) {
  const [sosOpen, setSosOpen] = useState(false);
  const safetyKey = side === "helper" ? "report" : "dispute";
  const safetyLabel = side === "helper" ? "Report a Problem" : "Dispute";
  return (
    <JobStepCard
      side={side}
      step="working"
      soloChipKey="message"
      actions={[
        <JobActionChip key={safetyKey} icon={AlertTriangle} label={safetyLabel} ariaLabel={safetyLabel} tone="danger" onClick={vi.fn()} />,
        <SosShareButton key="sos" onOpen={() => setSosOpen(true)} />,
        <JobActionChip key="message" icon={MessageSquare} label="Message" ariaLabel="Message" tone="message" onClick={vi.fn()} />,
      ]}
      dialogs={<SosShareSheet jobId="job-1" open={sosOpen} onOpenChange={setSosOpen} />}
    />
  );
}

describe("the shell: safety actions sit only inside More, and SOS still opens its sheet", () => {
  for (const [side, label] of [
    ["helper", "Report a Problem"],
    ["poster", "Dispute"],
  ] as const) {
    it(`${side} side: ${label} and SOS are not on the row; More (44px, named "More") holds both; SOS opens the sheet`, () => {
      const { container } = render(<Harness side={side} />);
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.queryByRole("button", { name: /^SOS/ })).toBeNull();
      const more = container.querySelector("[data-job-step-overflow]") as HTMLElement | null;
      expect(more).not.toBeNull();
      expect(more!.getAttribute("aria-label")).toMatch(/^More\b/);
      expect(more!.className).toMatch(/\bmin-h-11\b|\bh-11\b|min-h-\[44px\]|h-\[44px\]/);

      // Tap 1: More.
      fireEvent.click(more!);
      const panel = screen.getByRole("dialog", { name: "More actions for this job" });
      expect(within(panel).getByRole("button", { name: label })).toBeTruthy();
      // Order: the pinned safety action leads, SOS follows it.
      const names = within(panel).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
      // Most important first, SOS LAST (owner, 2026-10-08); Message lives here too.
      expect(names.some((n) => /^Message/.test(n ?? ""))).toBe(true);
      expect(names.indexOf(label)).toBeLessThan(names.findIndex((n) => /^SOS/.test(n ?? "")));
      expect(names.findIndex((n) => /^SOS/.test(n ?? ""))).toBe(names.length - 1);

      // Tap 2: SOS. The panel closes (and unmounts) and the sheet still opens.
      fireEvent.click(within(panel).getByRole("button", { name: /^SOS/ }));
      expect(screen.getByText("Share Your Location")).toBeTruthy();
    });
  }
});
