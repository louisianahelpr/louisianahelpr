import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig";

import type { ReadableJobRow } from "@/lib/jobColumns";
import { todayLocalISO } from "@/lib/dateUtils";

/**
 * VN-41 (owner 2026-09-15, "Side by side"): the Schedule tab showed a ~280px
 * calendar floating in a full-width card, with Upcoming jobs stacked under it,
 * and every job card spent a whole extra row on "Add to calendar".
 *
 * Two things are pinned here, both in the terms a regression would break them:
 *
 *  1. THE TWO-COLUMN GRID. jsdom has no layout, so a class-name assertion alone
 *     would pass on a class Tailwind never generates (this app has shipped
 *     variants that compiled to nothing — see CLAUDE.md "gloss"). So the
 *     layout class the component actually renders is fed through the REAL
 *     tailwind.config.ts, and the emitted CSS must contain a two-track
 *     `grid-template-columns` inside `@media (min-width: 1024px)` — and a
 *     single track outside it.
 *
 *  2. THE SINGLE-ROW CARD. "Add to calendar" must live in the same row as the
 *     card's date/time meta, the card must have no row after the chips, and
 *     the calendar action must not be nested inside the navigation button
 *     (a button inside a button is invalid markup).
 *
 * No Supabase behaviour is exercised or described: `userId` is empty, so the
 * tab's one query (blocked dates) is disabled and never runs. The client
 * module is stubbed only so it can be imported without VITE_* env.
 */

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ profile: null }),
}));

const { ScheduleTab, SCHEDULE_LAYOUT_CLASS } = await import("./ScheduleTab");

function isoInDays(n: number): string {
  const [y, m, d] = todayLocalISO().split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function job(over: Partial<ReadableJobRow>): ReadableJobRow {
  return {
    id: "job-1",
    title: "Mow the front lawn",
    status: "open",
    category: "lawn_care",
    budget: 80,
    location: "123 Main St, Baton Rouge, LA 70801",
    date_needed: isoInDays(3),
    start_time: "14:00",
    ...over,
  } as unknown as ReadableJobRow;
}

function renderTab(postedJobs: ReadableJobRow[], assignedJobs: ReadableJobRow[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScheduleTab
          postedJobs={postedJobs}
          assignedJobs={assignedJobs}
          loading={false}
          userId=""
          onBack={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Compile a class string through the project's real Tailwind config. */
async function compile(classes: string): Promise<string> {
  const config = loadConfig(resolve(__dirname, "../../../tailwind.config.ts"));
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }],
    }),
    // Only `@tailwind utilities` is processed, so base/preflight never emits.
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css.replace(/\s+/g, " ");
}

describe("Schedule tab — calendar and list side by side at 1024px+", () => {
  it("renders the calendar and the list as the two cells of one layout grid", () => {
    renderTab([job({})]);
    const layout = screen.getByTestId("schedule-layout");
    expect(layout.className).toBe(SCHEDULE_LAYOUT_CLASS);
    const cells = Array.from(layout.children);
    expect(cells).toHaveLength(2);
    // Calendar LEFT (first track), list RIGHT (second track).
    expect(cells[0]).toBe(screen.getByTestId("schedule-calendar"));
    expect(within(cells[0] as HTMLElement).getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    expect(cells[1]).toBe(screen.getByTestId("schedule-list"));
    expect(within(cells[1] as HTMLElement).getByRole("heading", { name: "Upcoming jobs" })).toBeInTheDocument();
  });

  it("keeps the list in the right column when a day is selected and when empty", () => {
    renderTab([]);
    const layout = screen.getByTestId("schedule-layout");
    expect(layout.children).toHaveLength(2);
    expect(within(screen.getByTestId("schedule-list")).getByText("Calendar's clear.")).toBeInTheDocument();

    // Selecting a day swaps the list's content, not the layout.
    const calendar = screen.getByTestId("schedule-calendar");
    const dayOne = within(calendar).getAllByRole("button").find((b) => b.textContent?.trim() === "1")!;
    fireEvent.click(dayOne);
    expect(layout.children).toHaveLength(2);
    expect(within(screen.getByTestId("schedule-list")).getByText("Nothing scheduled for this day.")).toBeInTheDocument();
    // Tapping it again returns to Upcoming jobs, still in the right column.
    fireEvent.click(dayOne);
    expect(within(screen.getByTestId("schedule-list")).getByRole("heading", { name: "Upcoming jobs" })).toBeInTheDocument();
  });

  it("the layout class compiles to a two-column grid at min-width 1024px and one column below", async () => {
    const css = await compile(SCHEDULE_LAYOUT_CLASS);
    // Below 1024: one track.
    expect(css).toMatch(/\.grid-cols-1 \{ grid-template-columns: repeat\(1, minmax\(0, 1fr\)\) \}/);
    // At 1024+: the calendar track (~5/12, 320–480px) and the list track.
    const media = css.match(/@media \(min-width: 1024px\) \{(.*)\}/)?.[1] ?? "";
    expect(media, "no min-width:1024px block was generated").not.toBe("");
    expect(media).toMatch(
      /grid-template-columns: clamp\(320px, ?42%, ?480px\) minmax\(0, ?1fr\) \}/,
    );
    expect(media).toMatch(/gap: 1\.5rem/);
    // Both columns align at the top.
    expect(css).toMatch(/\.items-start \{ align-items: flex-start \}/);
  });

  it("the calendar's 280px cap lifts and its cells go square at 1024px", async () => {
    renderTab([job({})]);
    const calendar = screen.getByTestId("schedule-calendar");
    const capped = calendar.querySelector(".max-w-\\[280px\\]") as HTMLElement;
    expect(capped).not.toBeNull();
    const dayCell = within(calendar).getAllByRole("button").find((b) => b.textContent?.trim() === "15")!;
    const css = await compile(`${capped.className} ${dayCell.className}`);
    const media = css.match(/@media \(min-width: 1024px\) \{(.*)\}/)?.[1] ?? "";
    expect(media).toMatch(/max-width: none/);
    expect(media).toMatch(/aspect-ratio: 1 \/ 1/);
    expect(media).toMatch(/height: auto/);
  });
});

describe("Schedule card — Add to calendar sits in the meta row, no extra row", () => {
  it("puts the calendar action in the same row as the date and time", () => {
    renderTab([job({ id: "a" }), job({ id: "b", title: "Walk the dog", status: "in_progress", category: "pet_care" })]);
    const addButtons = screen.getAllByRole("button", { name: "Add to calendar" });
    expect(addButtons).toHaveLength(2);
    for (const add of addButtons) {
      const row = add.closest('[data-testid="schedule-card-meta-row"]') as HTMLElement;
      expect(row, "Add to calendar is not inside the meta row").not.toBeNull();
      // The same row states the date and the time.
      expect(row.textContent).toMatch(/2:00 PM/);
      expect(add.parentElement).toBe(row);
      // Not nested in the navigation button.
      expect(add.parentElement!.closest("button")).toBeNull();

      const body = row.closest('[data-testid="schedule-card-body"]') as HTMLElement;
      // Rows: header, meta (with the action), chips. Nothing after the chips,
      // and nothing after the body — the old footer row is gone.
      expect(Array.from(body.children)).toHaveLength(3);
      expect(body.children[1]).toBe(row);
      expect(body.nextElementSibling).toBeNull();
    }
  });

  it("the whole card still navigates through one labelled button", async () => {
    renderTab([job({ id: "a" })]);
    const nav = screen.getByRole("button", { name: /Mow the front lawn — you posted this, open\. Tap to open this job in My Posts\./ });
    const body = screen.getByTestId("schedule-card-body");
    // The navigation button is the body's preceding sibling, stretched over it.
    expect(nav.nextElementSibling).toBe(body);
    const add = within(body).getByRole("button", { name: "Add to calendar" });
    // The money chip's tooltip must still be hoverable under the rows'
    // pointer-events-none.
    const chip = body.querySelector('[title="Your budget for this job"]') as HTMLElement;
    expect(chip).not.toBeNull();

    // EVERY ONE OF THESE IS A PROXY, AND HERE IS ITS EXACT WORTH.
    //
    // jsdom computes no layout and applies no stylesheet, so nothing in this
    // file can observe that the overlay actually covers the card or that a tap
    // on "Add to calendar" reaches the right handler. What CAN be measured,
    // and is measured below, is the pair a regression breaks one half of:
    //
    //   (i)  the element still carries the class — caught by `className`;
    //   (ii) that class still COMPILES to the declaration it names — caught by
    //        running it through the real tailwind.config.ts. This app has
    //        shipped classes Tailwind never generated (CLAUDE.md "gloss"), and
    //        a `pointer-events-auto` that emits nothing leaves the chip and the
    //        calendar action dead under the overlay with the markup unchanged.
    //
    // A human still has to look at 1024 to know it LOOKS right; see the note at
    // the head of this file.
    const css = await compile(`${nav.className} ${body.className} ${add.className} ${chip.className}`);
    const carries = (el: HTMLElement, cls: string, decl: string) => {
      expect(el.className, `element lost .${cls}`).toMatch(new RegExp(`(^| )${cls}( |$)`));
      expect(css, `.${cls} compiles to nothing — the markup is unchanged and the rule is gone`).toContain(decl);
    };
    carries(nav, "absolute", "position: absolute");
    carries(nav, "inset-0", "inset: 0px");
    carries(body, "pointer-events-none", "pointer-events: none");
    carries(add, "pointer-events-auto", "pointer-events: auto");
    carries(chip, "pointer-events-auto", "pointer-events: auto");
    // The press feedback moved from the button to the body via `peer-active`;
    // it must compile to a real sibling selector, not to nothing.
    expect(css).toMatch(/\.peer:active ~ \.peer-active\\:scale-\\\[0\\\.99\\\] \{/);
  });
});

// The two-track grid itself. jsdom cannot see the columns, so the measurement
// is the emitted CSS: swap the explicit tracks for a plain two-column grid and
// the compiled `grid-template-columns` no longer names the 320-480px calendar
// track, even though the rendered markup is identical.
// @mutate src/components/profile/ScheduleTab.tsx | min-[1024px]:grid-cols-[clamp(320px,42%,480px)_minmax(0,1fr)] | min-[1024px]:grid-cols-2
