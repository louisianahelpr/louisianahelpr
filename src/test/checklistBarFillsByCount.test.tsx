/**
 * Coordinator 11-15 (new-member Home, ~/.lh-shots/newmember-1115/home-390.png): "Get started · 2 of 4" lit bar segments 3
 * and 4, because the two steps done (photo, alerts) are listed last and each segment followed its own step. The bar is a
 * count: ChecklistProgress fills it left to right by how many steps are done, whatever their order. The rows below it
 * say which step is done.
 *
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | data-filled={i < doneCount ? "" : undefined} | data-filled={s.done ? "" : undefined}
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | rounded-full ${i < doneCount ? "bg-primary" : "bg-border"}` | rounded-full ${s.done ? "bg-primary" : "bg-border"}`
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { ChecklistProgress } from "@/pages/home/homeDashboard/FirstJobHome";

afterEach(cleanup);

const step = (key: string, done: boolean) => ({ key, label: key, done, go: vi.fn() });

describe("a checklist's bar fills left to right by the count", () => {
  it.each([
    { name: "done steps listed last (the guide's photo and alerts)", done: [false, false, true, true], want: [true, true, false, false] },
    { name: "done steps listed first", done: [true, true, false, false], want: [true, true, false, false] },
    { name: "one done step in the middle", done: [false, true, false], want: [true, false, false] },
    { name: "nothing done", done: [false, false, false, false], want: [false, false, false, false] },
  ])("$name", ({ done, want }) => {
    render(<ChecklistProgress title="Get started" steps={done.map((d, i) => step(`s${i}`, d))} rows={<ul />} />);
    const bar = screen.getByRole("progressbar");
    const segs = [...bar.querySelectorAll("[data-segment]")];
    expect(segs.length).toBeGreaterThan(2);
    expect(segs.map((s) => s.hasAttribute("data-filled"))).toEqual(want);
    // The colour follows the fill, not the step (what the screenshot showed).
    expect(segs.map((s) => s.className.includes("bg-primary"))).toEqual(want);
    expect(bar.getAttribute("aria-valuenow")).toBe(String(want.filter(Boolean).length));
  });
});
