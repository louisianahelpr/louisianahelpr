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
 * @mutate src/components/job-card/JobActionRow.tsx | className="w-max min-w-[9rem] | className="w-full min-w-[9rem]
 * @mutate src/components/job-card/JobActionRow.tsx | <div className="grid grid-cols-1 gap-1.5">{children}</div> | <div className="grid grid-cols-3 gap-1.5">{children}</div>
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
        chip("cancel", "Cancel Job", CalendarX2),
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

describe("Q1569 — More is a fitted list, most important first, SOS last", () => {
  it("the panel is as wide as its contents, capped to the screen, never row-wide", async () => {
    const panel = await openMore();
    const cls = panel.className.split(/\s+/);
    expect(cls, `panel classes: ${panel.className}`).toContain("w-max");
    expect(cls.some((c) => c.startsWith("max-w-")), "the fitted panel has no screen cap").toBe(true);
    for (const bad of ["w-full", "w-screen", "w-[var(--radix-popover-trigger-width)]"]) {
      expect(cls, `panel is row-wide (${bad})`).not.toContain(bad);
    }
  });

  it("one column, in importance order, SOS at the bottom", async () => {
    const panel = await openMore();
    const grid = panel.querySelector<HTMLElement>(".grid");
    expect(grid, "the panel lost its list container").not.toBeNull();
    expect(grid!.className.split(/\s+/)).toContain("grid-cols-1");
    const labels = [...grid!.querySelectorAll<HTMLElement>("button, a[href]")].map(
      (b) => (b.getAttribute("aria-label") || b.textContent || "").trim(),
    );
    expect(labels.length, `panel actions: [${labels.join(" | ")}]`).toBeGreaterThan(5);
    expect(labels).toEqual([
      "Message",
      "Directions",
      "Ask for a new date or time",
      "Report a Problem",
      "Cancel Job",
      "SOS",
    ]);
  });
});
