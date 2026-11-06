/**
 * Q2709 "nothing hand-made" (Profile packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * Saved Helprs' Filter and Sort pills (the two popover triggers) and Schedule's Upcoming filter (compact) were hand-made <button>s with one class set and one
 * inline fill; they are the shared PopoverPillTrigger now. Look-identical by construction: the rendered class SET
 * equals the hand-made literal (CSS does not read class order), the off fill/edge/ink are the same inline style, the
 * on state is the glossy primary with no inline fill, and type stays "button". Radix's PopoverTrigger asChild still
 * owns it (ref + aria-expanded reach the button).
 *
 * @mutate src/components/ui/PopoverPillTrigger.tsx | rounded-ds-md h-11 px-3 | rounded-ds-md h-10 px-3
 * @mutate src/components/ui/PopoverPillTrigger.tsx |         style={on ? style : { ...OFF_STYLE, ...style }} |         style={{ ...OFF_STYLE, ...style }}
 * @mutate src/components/ui/PopoverPillTrigger.tsx |         ref={ref}\n |         \n
 * @mutate src/components/profile/SavedHelpersTab.tsx |                     on={!!categoryFilter} |                     on={false}
 * @mutate src/components/ui/PopoverPillTrigger.tsx | rounded-full h-8 px-3 | rounded-full h-9 px-3
 * @mutate src/components/profile/ScheduleTab.tsx |                     <PopoverPillTrigger compact aria-label | <PopoverPillTrigger aria-label
 */
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PopoverPillTrigger } from "@/components/ui/PopoverPillTrigger";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const HAND_MADE =
  "shrink-0 inline-flex items-center gap-1.5 rounded-ds-md h-11 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all";
const OFF = { background: "hsl(var(--ivory-sand) / 0.65)", border: "1px solid hsl(var(--olivewood) / 0.18)", color: "hsl(var(--olivewood))" };

describe("Saved Helprs' Filter and Sort pills are the shared PopoverPillTrigger, class for class", () => {
  it("off: the hand-made class set and the sand fill, olive edge and ink", () => {
    const b = render(<PopoverPillTrigger aria-label="Sort">x</PopoverPillTrigger>).container.querySelector("button")!;
    expect(set(b.className)).toEqual(set(HAND_MADE));
    expect(b.getAttribute("type")).toBe("button");
    const probe = document.createElement("div");
    Object.assign(probe.style, OFF);
    expect(b.getAttribute("style")).toBe(probe.getAttribute("style"));
  });

  it("on: the glossy primary with its ink inline, and no inline fill over it", () => {
    const b = render(<PopoverPillTrigger on aria-label="Filter">x</PopoverPillTrigger>).container.querySelector("button")!;
    expect(set(b.className)).toEqual(set(`${HAND_MADE} btn-grad-primary text-[hsl(var(--parchment))]`));
    expect(b.getAttribute("style")).toBeNull();
  });

  it("compact (Schedule's Upcoming filter): the hand-made 32 px round set, same fill", () => {
    const b = render(<PopoverPillTrigger compact aria-label="Filter">x</PopoverPillTrigger>).container.querySelector("button")!;
    expect(set(b.className)).toEqual(set(HAND_MADE.replace("rounded-ds-md h-11", "rounded-full h-8")));
    expect(b.getAttribute("style")).toContain("ivory-sand");
    const s = readFileSync("src/components/profile/ScheduleTab.tsx", "utf8");
    expect(s).not.toContain("rounded-full h-8 px-3 text-ds-11 font-sans font-semibold");
    expect((s.match(/<PopoverPillTrigger compact\b/g) ?? []).length).toBeGreaterThan(0);
  });

  it("a Radix PopoverTrigger asChild still opens its popover from it", async () => {
    render(
      <Popover>
        <PopoverTrigger asChild><PopoverPillTrigger aria-label="Sort: Name">Name</PopoverPillTrigger></PopoverTrigger>
        <PopoverContent aria-label="Sort by">options</PopoverContent>
      </Popover>,
    );
    const b = screen.getByRole("button", { name: "Sort: Name" });
    // The ref reaches the button (Radix anchors the popover and returns focus with it).
    const ref = createRef<HTMLButtonElement>();
    const own = render(<PopoverPillTrigger ref={ref} aria-label="Own">x</PopoverPillTrigger>).container.querySelector("button");
    expect(ref.current).toBe(own);
    expect(b.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("options")).toBeTruthy();
  });

  it("Saved Helprs uses it for both pills and keeps no hand-made copy", () => {
    const s = readFileSync("src/components/profile/SavedHelpersTab.tsx", "utf8");
    expect(s).not.toContain("rounded-ds-md h-11 px-3 text-ds-11 font-sans font-semibold");
    const uses = s.match(/<PopoverPillTrigger\b/g) ?? [];
    // Inventory floor: Filter and Sort (measured 2026-11-06).
    expect(uses.length).toBeGreaterThan(1);
    expect(s).toContain("on={!!categoryFilter}");
  });
});
