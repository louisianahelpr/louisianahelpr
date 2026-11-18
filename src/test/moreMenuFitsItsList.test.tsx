/**
 * Q1569 — THE MORE MENU IS A LIST AS WIDE AS ITS CONTENTS, MOST IMPORTANT
 * FIRST, SOS LAST (owner, 2026-10-08: the box spanned the whole row around one
 * SOS chip; "organize the stuff in the more button from most important first";
 * "SOS at bottom").
 *
 * Renders the shared JobStepCard with its chips handed over in a scrambled
 * order, opens More and reads the panel:
 *  - it is sized to its contents (`w-max`), never row-wide (`w-full`, or a
 *    width tied to the anchor/trigger), and capped to the screen;
 *  - it lays the actions out in ONE column;
 *  - the actions come out in importance order with SOS last.
 * The class half is what jsdom can see; the rendered width is looked at on prod.
 *
 * Area 03 M11 (design audit 11-18): More is now the job page's bottom sheet ("More options", one outlined full-width
 * row per action), so the panel is a bottom sheet with the rows in one column; the order rule is unchanged.
 * @mutate src/components/job-card/JobActionRow.tsx | <SheetContent side="bottom" aria-label="More actions for this job" | <SheetContent side="right" aria-label="More actions for this job"
 * @mutate src/components/job-card/JobActionRow.tsx | <div data-job-step-overflow-list="" className="flex flex-col gap-2 pb-2" onClick | <div data-job-step-overflow-list="" className="grid grid-cols-3 gap-2 pb-2" onClick
 * @mutate src/components/job-card/JobStepCard.tsx | "report", "dispute", "cancel", "exit", "sos", | "sos", "report", "dispute", "cancel", "exit",
 * @mutate src/components/job-card/JobStepCard.tsx | "message", "directions", "photo", | "directions", "message", "photo",
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { AlertTriangle, CalendarClock, CalendarX2, MessageSquare, Navigation, Siren } from "lucide-react";
import { JobStepCard } from "@/components/job-card/JobStepCard";
import { JobActionChip } from "@/components/job-card/JobActionRow";

const chip = (key: string, label: string, Icon: typeof MessageSquare) => (
  <JobActionChip key={key} icon={Icon} label={label} ariaLabel={label} tone="neutral" onClick={vi.fn()} />
);

async function openMore() {
  const { container } = render(
    <JobStepCard
      side="helper"
      step="working"
      // Deliberately out of order: the shell, not the step, decides the order.
      actions={[
        chip("sos", "SOS", Siren),
        chip("cancel", "Cancel job", CalendarX2),
        chip("report", "Report a Problem", AlertTriangle),
        chip("reschedule", "Ask for a new date or time", CalendarClock),
        chip("directions", "Directions", Navigation),
        chip("message", "Message", MessageSquare),
      ]}
    />,
  );
  const more = container.querySelector<HTMLElement>("[data-job-step-overflow]");
  expect(more, "no More control").not.toBeNull();
  await act(async () => { fireEvent.click(more!); });
  const panel = document.querySelector<HTMLElement>("[data-job-step-overflow-panel]");
  expect(panel, "More did not open").not.toBeNull();
  return panel!;
}

describe("Q1569 — More is one list, most important first, SOS last", () => {
  it("the panel is the bottom sheet the job page's More options uses, its rows full width", async () => {
    const panel = await openMore();
    expect(panel.getAttribute("data-side") ?? panel.className, `panel: ${panel.className}`).toMatch(/bottom/);
    expect(panel.textContent).toContain("More options");
    const rows = [...panel.querySelectorAll<HTMLElement>("[data-menu-action]")];
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(r.className.split(/\s+/), r.textContent ?? "").toContain("w-full");
  });

  it("one column, in importance order, SOS at the bottom", async () => {
    const panel = await openMore();
    const grid = panel.querySelector<HTMLElement>("[data-menu-action]")?.parentElement ?? null;
    expect(grid, "the panel lost its list container").not.toBeNull();
    expect(grid!.className.split(/\s+/)).toContain("flex-col");
    const labels = [...grid!.querySelectorAll<HTMLElement>("button, a[href]")].map(
      (b) => (b.getAttribute("aria-label") || b.textContent || "").trim(),
    );
    expect(labels.length, `panel actions: [${labels.join(" | ")}]`).toBeGreaterThan(5);
    expect(labels).toEqual([
      "Message",
      "Directions",
      "Ask for a new date or time",
      "Report a Problem",
      "Cancel job",
      "SOS",
    ]);
  });
});
