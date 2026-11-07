// @mutate src/components/profile/ProfileTabFallback.tsx | availability: [{ h: 86 }, { h: 102 }, { h: 636 }], | availability: [{ h: 85 }, { h: 768 }],
// @mutate src/components/profile/ProfileTabFallback.tsx | subscription: MEMBERSHIPS_HIDDEN_IN_THIS_APP ? [{ h: 19 }] : | subscription: false ? [{ h: 19 }] :
// @mutate src/components/profile/ProfileTabFallback.tsx | auto_tip: [{ h: 241 }], | auto_tip: [{ h: 288 }],
// @mutate src/components/profile/ProfileTabFallback.tsx | export const NOTIFICATION_ROWS = 39; | export const NOTIFICATION_ROWS = 17;
// @mutate src/components/profile/ProfileTabFallback.tsx | export const SMS_CARD_RESERVE_PX = 355; | export const SMS_CARD_RESERVE_PX = 155;
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ProfileTabBodyReserve, TAB_SHAPES, NOTIFICATION_ROWS, NOTIFICATION_ROW_PX, SMS_CARD_RESERVE_PX } from "@/components/profile/ProfileTabFallback";
import { MEMBERSHIPS_HIDDEN_IN_THIS_APP } from "@/hooks/useMembershipsOn";

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.

/**
 * Q2773: profile tab placeholders against the loading-states refresh of 2026-11-07 00:57Z (run 42302309191, main
 * 2bd5c0a86, 375, poster-e2e and helper-e2e; its breaches are the named `allow` debt in
 * docs/audit/loading-states/baseline.json until the next refresh measures the fix and prunes them). The measurer's
 * own rules (scripts/audit/measure-loading-states.mjs describe()): rows = the body's visible children (header plus
 * one per block), rowH = their median, media = round 28px+ circles; ROW_BUDGET 8px.
 *
 *   availability   loaded 68 | 86 | 102 | 636 (rows 4, rowH 102); it drew 85 | 768 (rows 3).
 *   subscription   memberships are hidden: the "not available" line, 19px (rows 2); it drew the 4-block plans.
 *   auto_tip       one block of 241px (rowRect.h 309.2); it drew 288.
 *   notifications  Text alerts card 355px with one icon, then the switches card with 39 icons (rows 3, media 40); it
 *                  drew one 17-row card (rows 2, media 17).
 * Re-checked on a local dev server against prod reads (structure: rows, icons, which state arrives) in
 * ~/.lh-shots/b5-q2773; heights are CI's (Linux fonts wrap one line less than this Mac's).
 */
const ROW_BUDGET = 8;
const HEADER = 68;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const shapeRows = (tab: keyof typeof TAB_SHAPES) => [HEADER, ...TAB_SHAPES[tab]!.map((b) => b.h as number)];
/** Round bones the measurer counts as media (`rounded-full`, 28px+ square: h-9 w-9 here). */
const circles = (root: HTMLElement) => root.querySelectorAll(".rounded-full.h-9.w-9").length;

afterEach(cleanup);

describe("Q2773 refresh 11-07: profile tab placeholders match what replaces them", () => {
  it("availability: four rows, median 102px", () => {
    const rows = shapeRows("availability");
    expect(rows.length).toBe(4);
    expect(Math.abs(median(rows) - 102)).toBeLessThanOrEqual(ROW_BUDGET);
    expect(rows).toEqual([HEADER, 86, 102, 636]);
  });

  it("subscription: while memberships are hidden, the one 19px 'not available' line", () => {
    expect(MEMBERSHIPS_HIDDEN_IN_THIS_APP).toBe(true);
    expect(shapeRows("subscription")).toEqual([HEADER, 19]);
    expect(Math.abs(median(shapeRows("subscription")) - 68)).toBeLessThanOrEqual(ROW_BUDGET);
  });

  it("auto_tip: one block within the budget of 241px", () => {
    const rows = shapeRows("auto_tip");
    expect(rows.length).toBe(2);
    expect(Math.abs(median(rows) - 241)).toBeLessThanOrEqual(ROW_BUDGET);
  });

  it("notifications: the Text alerts card's box, then the switches card, 40 icons in all", () => {
    const { container } = render(<ProfileTabBodyReserve tab="notifications" />);
    const blocks = [...container.children] as HTMLElement[];
    expect(blocks.length).toBe(2); // + the header = 3 rows, as loaded
    expect(blocks[0].style.height).toBe(`${SMS_CARD_RESERVE_PX}px`);
    expect(Math.abs(median([HEADER, SMS_CARD_RESERVE_PX, NOTIFICATION_ROWS * NOTIFICATION_ROW_PX]) - 355)).toBeLessThanOrEqual(ROW_BUDGET);
    expect(circles(blocks[0])).toBe(1);
    expect(circles(blocks[1])).toBe(NOTIFICATION_ROWS);
    expect(Math.abs(circles(container) - 40)).toBeLessThanOrEqual(1);
  });
});
