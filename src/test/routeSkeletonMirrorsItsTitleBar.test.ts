/*
 * CLASS GUARD: a route skeleton must mirror the screen it stands in for.
 *
 * `DashboardRouteSkeleton` exists solely to hold one promise: the frame
 * painted before the /home chunk lands is the shape of the screen that
 * replaces it. Its render tests passed throughout, because a component test
 * asserts a component against ITSELF. The defect lives in the GAP between two
 * files, which is exactly where nothing was looking.
 *
 * History: measured on prod 2026-09-22 (1440, throttled, signed in), the
 * skeleton's title card (emblem + three bones) rearranged into the feed's bar
 * (search + filter, no emblem). Fixed then by mirroring DashboardTitleBar.
 * 2026-10-19 (Q2214): /home became the Home DASHBOARD (SectionScreen +
 * AppTopBar + greeting, three stat boxes, 2x2 section tiles, Coming up), and
 * the skeleton still drew the retired feed's bar, so this guard now reads the
 * skeleton against HomeDashboard, SectionScreen and AppTopBar. (Re-pointed:
 * DashboardTitleBar no longer stands on /home; the desktop
 * dashboard-title-emblem/-bell classes went with it.)
 *
 * It reads ALL the files and diffs the traits that decide the shape; it is
 * deliberately not a snapshot.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(root, p), "utf8"));

const SKELETON = "src/components/DashboardRouteSkeleton.tsx";
const skeleton = read(SKELETON);
const bar = read("src/components/sections/AppTopBar.tsx");
const frame = read("src/components/sections/SectionScreen.tsx");
const home = read("src/pages/home/HomeDashboard.tsx");

/** The first call of a JSX element, whitespace-collapsed. */
const call = (src: string, tag: string) => {
  const i = src.indexOf(`<${tag}`);
  expect(i, `expected a <${tag}> in the file`).toBeGreaterThan(-1);
  return src.slice(i, src.indexOf(">", i) + 1).replace(/\s+/g, " ");
};
const classOf = (el: string) => el.match(/className="([^"]*)"/)?.[1] ?? "";

describe("DashboardRouteSkeleton mirrors the Home dashboard (Q2214)", () => {
  it("is not vacuous: every file was read", () => {
    for (const s of [skeleton, bar, frame, home]) expect(s.length).toBeGreaterThan(500);
    expect(home).toMatch(/<SectionScreen>/);
  });

  it("wears SectionScreen's frame: the same AppShell props and column classes", () => {
    expect(call(skeleton, "AppShell")).toBe(call(frame, "AppShell"));
    expect(skeleton).toContain('className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden"');
    expect(frame).toContain('className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden"');
    expect(frame).toContain('<div className="flex min-h-full flex-col gap-4 pt-1 pb-6">');
    expect(skeleton).toContain('<div className="flex min-h-full flex-col gap-4 pt-1 pb-6">');
  });

  it("draws Home's top bar: the same box, the same emblem size, bell + avatar and no '+'", () => {
    expect(classOf(call(skeleton, "div className=\"app-top-bar"))).toBe(classOf(call(bar, "header")));
    const size = (s: string) => call(s, "HelprMark").match(/size="(\w+)"/)?.[1];
    expect(size(bar)).toBeTruthy();
    expect(size(skeleton)).toBe(size(bar));
    expect(call(skeleton, "HelprMark")).toContain("emblemOnly");
    // The right cluster: the bar's gap classes, and on Home exactly two controls (bell h-11, avatar h-10 in the
    // skeleton; the bar's avatar is the shared iconCompact Button since B61, 11-01, its box 44x44 before and after).
    expect(bar).toContain('className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0"');
    const cluster = skeleton.slice(skeleton.indexOf('className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0"'));
    expect(cluster.length).toBeGreaterThan(100);
    const boxes = cluster.slice(0, cluster.indexOf("</div>")).match(/<span className="h-1[01] w-1[01]/g) ?? [];
    expect(boxes).toEqual(['<span className="h-11 w-11', '<span className="h-10 w-10']);
    expect(bar).toMatch(/NotificationPanel triggerClassName="h-11 w-11/);
    expect(bar).toMatch(/variant="ghost"\s+size="iconCompact"\s+aria-label=\{tr\("nav\.profile"\)\}/);
  });

  it("then Home's body: greeting, the Next up card, Coming up, the 2x2 section tiles (board 7)", () => {
    // Home: the Next up card (2026-10-20, it replaced the three stat boxes); the skeleton draws the same card.
    expect(home).toContain('<section data-testid="next-up" aria-label="Next up" className="liquid-glass p-card flex flex-col gap-1.5">');
    expect(skeleton).toContain('<div className="liquid-glass p-card flex flex-col gap-1.5" data-skeleton="next-up">');
    expect(skeleton).toMatch(/data-skeleton="next-up">[\s\S]*?<Skeleton className="h-11 w-36 mt-2 rounded-full" \/>/);
    // 2x2 tiles, same grid.
    expect(home).toContain('<div className="grid grid-cols-2 gap-3">');
    expect(skeleton).toContain('<div className="grid grid-cols-2 gap-3" data-skeleton="tiles">');
    expect(skeleton).toMatch(/\[0, 1, 2, 3\]\.map\(\(i\) => \(\s*<div key=\{i\} className="liquid-glass p-card/);
    // Board 7: Coming up sits ABOVE the sections in both.
    expect(home.lastIndexOf('title="Coming up"')).toBeGreaterThan(0);
    expect(home.lastIndexOf('title="Coming up"')).toBeLessThan(home.indexOf('aria-label="Your sections"'));
    expect(skeleton.indexOf('data-skeleton="coming-up"')).toBeGreaterThan(0);
    expect(skeleton.indexOf('data-skeleton="coming-up"')).toBeLessThan(skeleton.indexOf('data-skeleton="tiles"'));
    // Same column gap as Home's stack.
    expect(home).toContain('className="flex flex-col gap-section"');
    expect(skeleton).toContain('<div className="flex flex-col gap-section">');
  });

  it("never draws the retired feed bar (search, filters)", () => {
    expect(skeleton).not.toMatch(/dashboard-title-emblem|dashboard-title-bell|TITLE_BAR_PADDING|DashboardSkeleton/);
  });
});

// Proof this is able to fail: each restores a real way the two drift.
// @mutate src/components/DashboardRouteSkeleton.tsx | <HelprMark to={null} size="sm" emblemOnly className="shrink-0" /> | <HelprMark to={null} size="md" emblemOnly className="shrink-0" />
// @mutate src/components/DashboardRouteSkeleton.tsx | data-skeleton="next-up"> | data-skeleton="stats">
// @mutate src/components/DashboardRouteSkeleton.tsx |                 <Skeleton className="h-11 w-36 mt-2 rounded-full" /> |
// @mutate src/components/DashboardRouteSkeleton.tsx |               <span className="h-10 w-10 flex items-center justify-center"> |               <span className="h-11 w-11 flex items-center justify-center">
// @mutate src/components/DashboardRouteSkeleton.tsx |     <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top"> |     <AppShell scrollable={false} className="bg-premium-page pt-safe-top">
