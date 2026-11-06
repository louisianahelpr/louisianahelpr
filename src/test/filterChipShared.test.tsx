/**
 * Q2709 "nothing hand-made" (Jobs packet, Builder 2, 2026-11-06; lead: convert ONLY what stays look-identical).
 * The Jobs filter sheet's chips (Sort, Category, Distance, When), Running late's minutes and Change the job's day
 * strip were hand-made <button>s built from class strings exported by JobFilters.tsx. They are the shared FilterChip
 * now. Look-identical by construction: the rendered class SET of every chip form equals the hand-made one (CSS does
 * not read class order), written out here as the literal strings the hand-made chips wore at ready/b2-q2709-home
 * b6a1772d01, and the attributes are the same (type=button; aria-pressed only where it was).
 *
 * @mutate src/components/ui/FilterChip.tsx | export const FILTER_CHIP_OFF = "bg-card text-foreground border-border hover:bg-[hsl(var(--bark)/0.06)]"; | export const FILTER_CHIP_OFF = "bg-card text-foreground border-border";
 * @mutate src/components/ui/FilterChip.tsx |   tall: FILTER_CHIP.replace("min-h-10", "min-h-11"), |   tall: FILTER_CHIP,
 * @mutate src/components/ui/FilterChip.tsx |     aria-pressed={pressed} |     aria-pressed={pressed ?? false}
 * @mutate src/components/ui/FilterChip.tsx |     className={`${SIZES[size]} ${pressed ? FILTER_CHIP_ON : FILTER_CHIP_OFF} ${className}`.trim()} |     className={`${SIZES[size]} ${pressed ? FILTER_CHIP_ON : FILTER_CHIP_OFF}`}
 * @mutate src/components/schedule/ChangeJobSheet.tsx | <FilterChip key={d} size="tall" | <FilterChip key={d}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { FilterChip } from "@/components/ui/FilterChip";

const set = (cls: string) => [...new Set(cls.split(/\s+/).filter(Boolean))].sort();
const BASE = "inline-flex items-center gap-1.5 px-4 rounded-full text-ds-13 font-semibold whitespace-nowrap transition-colors duration-200 btn-press border min-h-10";
const ON = "btn-grad-primary !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] border-transparent";
const OFF = "bg-card text-foreground border-border hover:bg-[hsl(var(--bark)/0.06)]";
const chip = (el: ReactElement) => render(el).container.querySelector("button")!;

describe("the Jobs chips are the shared FilterChip, class for class the hand-made look", () => {
  it("default chip, on and off: the hand-made chipBase + chipActive / chipIdle set", () => {
    const on = chip(<FilterChip pressed>x</FilterChip>);
    const off = chip(<FilterChip pressed={false}>x</FilterChip>);
    expect(set(on.className)).toEqual(set(`${BASE} ${ON}`));
    expect(set(off.className)).toEqual(set(`${BASE} ${OFF}`));
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(on.getAttribute("type")).toBe("button");
  });

  it("Distance chips (tight): px-3 in place of px-4, nothing else", () => {
    expect(set(chip(<FilterChip size="tight" pressed={false}>5 mi</FilterChip>).className)).toEqual(set(`${BASE.replace("px-4", "px-3")} ${OFF}`));
  });

  it("Change the job's day strip (tall + shrink-0): min-h-11 in place of min-h-10", () => {
    const b = chip(<FilterChip size="tall" pressed className="shrink-0">Mon</FilterChip>);
    expect(set(b.className)).toEqual(set(`${BASE.replace("min-h-10", "min-h-11")} shrink-0 ${ON}`));
  });

  it("an action chip (no pressed) has no aria-pressed and the idle look, as 'Need a new time' had", () => {
    const b = chip(<FilterChip>Need a new time</FilterChip>);
    expect(b.hasAttribute("aria-pressed")).toBe(false);
    expect(set(b.className)).toEqual(set(`${BASE} ${OFF}`));
  });

  it("the callers keep no hand-made chip and use the right size", () => {
    const jf = readFileSync("src/components/dashboard/JobFilters.tsx", "utf8");
    const rl = readFileSync("src/components/job-card/RunningLateSheet.tsx", "utf8");
    const cj = readFileSync("src/components/schedule/ChangeJobSheet.tsx", "utf8");
    for (const s of [jf, rl]) expect(s).not.toMatch(/<button\b/);
    expect(cj).not.toMatch(/<button[^>]*aria-pressed/);
    expect(jf.match(/<FilterChip\b/g)?.length).toBe(7);
    expect(jf.match(/size="tight"/g)?.length).toBe(2);
    expect(rl.match(/<FilterChip\b/g)?.length).toBe(2);
    expect(cj).toMatch(/<FilterChip key=\{d\} size="tall" pressed=\{date === d\} className="shrink-0"/);
  });
});
