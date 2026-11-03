/**
 * Q2013: three Profile tab placeholders draw their page's shape, as the prod skeleton-shape check
 * (e2e/prod-audit/skeleton-shape.spec.ts) measures it: the first box at least 40px tall and half the column wide,
 * where a test id containing "fallback" counts as a placeholder box.
 *
 * Measured 2026-11-02 in the mocked harness (vite dev, the Profile page module held, the spec's own FRAME_BOXES and
 * compareFrames; 0 requests reached Supabase): before, legal 375 "block y 68->124", legal 1440 "block w 1144->373",
 * wrapped 1440 "block x 272->634; block w 1144->420", schedule 1440 "block w 1144->480" (the KNOWN_SHAPES entries);
 * after, all four empty. A browser run is what proves the pixels; this file holds the structure that produced them.
 */
// @mutate src/components/profile/ProfileTabFallback.tsx | if (tab === "legal") return <LegalReserve />; |
// @mutate src/components/profile/ProfileTabFallback.tsx | if (tab === "schedule") return <ScheduleReserve />; |
// @mutate src/components/profile/ProfileTabFallback.tsx | wrapped: [{ h: 333, maxW: 420 }], | wrapped: [{ h: 333 }],
// @mutate src/components/profile/ProfileTabFallback.tsx |     <div ref={ref} style={{ minHeight: reserve }} aria-hidden data-legal-reserve=""> |     <div ref={ref} style={{ minHeight: reserve }} aria-hidden data-legal-reserve="" data-testid="profile-tab-fallback">
// @mutate src/components/profile/ScheduleTab.tsx | <ProfileTabBodyReserve tab="schedule" /> | <ProfileTabBodyReserve />
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
import { ProfileTabFallback } from "@/components/profile/ProfileTabFallback";
import { SCHEDULE_LAYOUT_CLASS } from "@/components/profile/scheduleLayout";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(cleanup);

const fallback = (tab: "legal" | "schedule" | "wrapped") =>
  render(
    <MemoryRouter>
      <ProfileTabFallback tab={tab} />
    </MemoryRouter>,
  ).container;

const PH = '[data-testid*="fallback" i]';

describe("Q2013: Profile tab placeholders are their page's shape", () => {
  it("legal: a three-slot pill row (only the first filled) above the document bone, which alone carries the test id", () => {
    const c = fallback("legal");
    const ids = c.querySelectorAll(PH);
    expect(ids).toHaveLength(1);
    const doc = ids[0] as HTMLElement;
    const wrapper = doc.parentElement!;
    // One wrapper (the loaded Tabs root is one row), holding the screenful.
    expect(wrapper.style.minHeight).not.toBe("");
    const row = wrapper.children[0] as HTMLElement;
    expect(row, "the pill row comes before the document").not.toBe(doc);
    expect(row.className).toContain("gap-1 sm:gap-2 px-1");
    expect(row.children).toHaveLength(3);
    const filled = [...row.children].filter((s) => /\bh-11\b/.test(s.className) && /rounded-full/.test(s.className) && s.hasAttribute("data-skeleton"));
    expect(filled, "exactly one filled pill: the selected Terms").toHaveLength(1);
    expect(row.children[0]).toBe(filled[0]);
    expect(doc.className).toContain("mt-3");
  });

  it("legal: the pill row uses LegalTab's own row and trigger sizing", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/profile/LegalTab.tsx"), "utf8"));
    expect(src).toContain("gap-1 sm:gap-2 rounded-2xl px-1 py-0");
    expect(src).toMatch(/relative h-11 inline-flex flex-1 min-w-0/);
    expect(src).toMatch(/<TabsContent key=\{key\} value=\{key\} className="mt-3">/);
  });

  it("schedule: the placeholder is the page's own grid, and the calendar bone (first cell) carries the test id", () => {
    const c = fallback("schedule");
    const ids = c.querySelectorAll(PH);
    expect(ids).toHaveLength(1);
    const cal = ids[0] as HTMLElement;
    expect(cal.parentElement!.className).toBe(SCHEDULE_LAYOUT_CLASS);
    expect(cal.parentElement!.children[0]).toBe(cal);
    expect(cal.parentElement!.children).toHaveLength(2);
  });

  it("schedule: ScheduleTab lays out with the same class and waits for data in the same placeholder", async () => {
    const tab = await import("@/components/profile/ScheduleTab");
    expect(tab.SCHEDULE_LAYOUT_CLASS).toBe(SCHEDULE_LAYOUT_CLASS);
    const src = blankComments(readFileSync(resolve(__dirname, "../components/profile/ScheduleTab.tsx"), "utf8"));
    expect(src).toContain('<ProfileTabBodyReserve tab="schedule" />');
  });

  it("wrapped: the card bone is centred at the real card's 420px", () => {
    const c = fallback("wrapped");
    const bone = c.querySelector<HTMLElement>(PH)!;
    expect(bone.style.maxWidth).toBe("420px");
    expect(bone.className).toContain("mx-auto");
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/profile/HelprWrapped.tsx"), "utf8"));
    expect(src).toContain("w-full max-w-[420px] rounded-[20px]");
  });
});
