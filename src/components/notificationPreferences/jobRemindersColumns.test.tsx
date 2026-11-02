/**
 * A3-104 (audit 11-01): each Job reminders switch sat at the far right, under the EMAIL column of the App | Email
 * table, so it read as "email only", though one switch turns the reminder off on every channel. The switch (and
 * "Always on") now sits centred in a cell as wide as both columns (CategoryRow's two 51 px slots plus its gap), and
 * the group's line says each switch covers app, email and text.
 *
 * @mutate src/components/notificationPreferences/JobRemindersGroup.tsx | flex justify-center w-[114px] min-[360px]:w-[126px]" data-reminder-switch-cell=""> | flex justify-end" data-reminder-switch-cell="">
 * @mutate src/components/notificationPreferences/JobRemindersGroup.tsx |  Each switch covers app, email and text. |
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const rows = [
    { kind: "starting_soon", label: "Starting soon", description: "An hour before a job starts.", always_on: false, pref_column: "remind_starting_soon", sort_order: 1 },
    { kind: "approve", label: "Approve the work", description: "When a job needs your OK.", always_on: true, pref_column: null, sort_order: 2 },
  ];
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.order = () => Promise.resolve({ data: rows, error: null });
  return { supabase: { from: () => q } };
});

import { JobRemindersGroup } from "./JobRemindersGroup";
import { defaultPrefs } from "./constants";

describe("Job reminders: one switch for every channel, centred across App and Email", () => {
  it("each reminder's switch or Always on sits in a cell as wide as both columns, centred", async () => {
    render(<JobRemindersGroup prefs={defaultPrefs} loaded savingKey={null} locked={false} columnsReady={() => true} onToggle={() => {}} />);
    await screen.findByText("Starting soon");
    const cells = [...document.querySelectorAll<HTMLElement>("[data-reminder-switch-cell]")];
    expect(cells.length).toBeGreaterThan(1);
    for (const c of cells) {
      expect(c.className).toContain("justify-center");
      // 51 + 12 + 51 below 360 px, 51 + 24 + 51 from 360 px: CategoryRow's App and Email slots with their gap.
      expect(c.className).toMatch(/(^| )w-\[114px\]( |$)/);
      expect(c.className).toMatch(/min-\[360px\]:w-\[126px\]/);
    }
    expect(screen.getByText(/Each switch covers app, email and text\./)).toBeInTheDocument();
  });
});
