/**
 * Q2709 "nothing hand-made" (Profile packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * The popover option rows of Saved Helprs (category filter, sort) and the Schedule tab (upcoming filter) were
 * hand-made <button aria-pressed>s with one class set; they are the shared PopoverOptionButton now. Look-identical by
 * construction: the rendered class SET, on and off, equals the hand-made literal (CSS does not read class order),
 * aria-pressed follows `selected`, and type stays "button".
 *
 * @mutate src/components/ui/PopoverOptionButton.tsx | const OPTION_OFF = "text-foreground hover:bg-secondary/70"; | const OPTION_OFF = "text-foreground";
 * @mutate src/components/ui/PopoverOptionButton.tsx | aria-pressed={selected} {...props} | {...props}
 * @mutate src/components/ui/PopoverOptionButton.tsx | <button ref={ref} type="button" | <button ref={ref}
 * @mutate src/components/profile/ScheduleTab.tsx |                           selected={active} |                           selected={false}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { PopoverOptionButton } from "@/components/ui/PopoverOptionButton";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const BASE = "w-full text-left px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium transition-colors";
const ON = 'btn-grad-primary text-[hsl(var(--parchment))]';
const OFF = "text-foreground hover:bg-secondary/70";

describe("the Profile popover option rows are the shared PopoverOptionButton, class for class the hand-made look", () => {
  it("on and off: the hand-made class sets, aria-pressed follows selected, type=button", () => {
    const on = render(<PopoverOptionButton selected>All Helprs</PopoverOptionButton>).container.querySelector("button")!;
    const off = render(<PopoverOptionButton selected={false}>Newest</PopoverOptionButton>).container.querySelector("button")!;
    expect(set(on.className)).toEqual(set(`${BASE} ${ON}`));
    expect(set(off.className)).toEqual(set(`${BASE} ${OFF}`));
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(on.getAttribute("type")).toBe("button");
  });

  it("the callers keep no hand-made option row and pass their own selected state", () => {
    const saved = readFileSync("src/components/profile/SavedHelpersTab.tsx", "utf8");
    const sched = readFileSync("src/components/profile/ScheduleTab.tsx", "utf8");
    for (const s of [saved, sched]) expect(s).not.toContain("px-2.5 h-9 rounded-md text-ds-13 font-sans font-medium");
    expect(saved.match(/<PopoverOptionButton\b/g)?.length).toBe(3);
    for (const sel of ["selected={categoryFilter === null}", "selected={categoryFilter === value}", "selected={active}"]) expect(saved).toContain(sel);
    expect(sched).toContain("selected={active}");
  });
});
