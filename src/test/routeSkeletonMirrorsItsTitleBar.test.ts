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
    expect(home).toMatch(/<SectionScreen search=\{<SectionSearchBar noun=\{t\("home\.searchNoun"\)\} home="\/search" \/>\} fab=\{<SectionCreateFab \/>\}>/);
  });

  it("wears SectionScreen's frame: the same AppShell props and column classes", () => {
    expect(call(skeleton, "AppShell")).toBe(call(frame, "AppShell"));
    expect(skeleton).toContain('className="container mx-auto px-4 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden"');
    // The frame's gutter: 16px beside a bar that holds a search; Dashboard's bar holds one since 11-08 (design audit A D1).
    expect(frame).toContain('className={`container mx-auto ${barSearch ? "px-4" : "px-5"} lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden`}');
    // Dashboard's floating "+ Create" (owner 11-08) adds room under the last row (pb-20); the skeleton does not scroll.
    expect(frame).toContain('<div className={`flex min-h-full flex-col gap-4 pt-1 ${fab ? "pb-20" : "pb-6"}`}>');
    expect(skeleton).toContain('<div className="flex min-h-full flex-col gap-4 pt-1 pb-6">');
  });

  it("draws Dashboard's top bar: the same box, the logo (no title), the bell and the avatar, then the search row (F148)", () => {
    expect(classOf(call(skeleton, "div className=\"app-top-bar"))).toBe(classOf(call(bar, "header")));
    // One pattern (owner UI audit F148, 11-09): the bar is the page's title (on Dashboard, which has none, the h-8
    // emblem), the bell and the avatar; the search is its own 44px row under the bar, 8px above the page.
    expect(bar).toContain('<HelprMark size="sm" emblemOnly to="/home" />');
    expect(skeleton).toMatch(/app-top-bar[^>]*>\s*<Skeleton className="h-8 w-8 rounded-ds-md" \/>/);
    expect(home).toContain("<SectionScreen search={<SectionSearchBar");
    expect(bar).toContain('{search && <div data-testid="app-top-bar-search" className="pb-2 min-w-0">{search}</div>}');
    expect(skeleton).toMatch(/<div className="pb-2 min-w-0">\s*<Skeleton className="h-11 w-full rounded-full" \/>\s*<\/div>/);
    // The right cluster: the bar's gap and two 44px controls, the bell and the avatar ("+ Create" floats over the page).
    expect(bar).toContain('<div className="flex items-center shrink-0 gap-1">');
    const cluster = skeleton.slice(skeleton.indexOf('className="flex items-center gap-1 shrink-0"'));
    expect(cluster.length).toBeGreaterThan(100);
    const right = cluster.slice(0, cluster.indexOf("</div>"));
    const boxes = right.match(/<span className="h-1[01] w-1[01]|<Skeleton className="h-11 w-11 shrink-0 rounded-full" \/>/g) ?? [];
    expect(boxes).toEqual(['<span className="h-11 w-11', '<span className="h-11 w-11']);
    expect(bar).toMatch(/NotificationPanel triggerClassName="h-11 w-11/);
    expect(bar.match(/size="iconCompact"/g)?.length, "the avatar: 44px iconCompact").toBe(1);
    // A screen with no "My …" menu (Dashboard) names the avatar after the profile, as before.
    // The initials the bare photo shows stay in its name either way (axe label-content-name-mismatch, WCAG 2.5.3).
    expect(bar).toMatch(/variant="ghost"\s+size="iconCompact"\s+(?:\/\/[^\n]*\s+)?aria-label=\{avatarButtonLabel\(mine \? /);
    expect(bar).toContain(' : tr("nav.profile"), profile?.full_name)}');
  });

  it("then Home's body: greeting, the Next up card, Coming up, the section chips (board 7; design audit A D4)", () => {
    // Home: the Next up card (2026-10-20, it replaced the three stat boxes); the skeleton draws the same card.
    // The card measures and holds its own height while to-dos load (ref + a reserved minHeight style), so match
    // the tag's shell classes, not the whole tag.
    expect(home).toMatch(/<section (?:ref=\{nextUpRef\} )?data-testid="next-up" aria-label=\{t\(NEEDS_YOU_KEY\)\} className="liquid-glass p-card flex flex-col gap-1\.5"[ >]/);
    expect(skeleton).toContain('<div className="liquid-glass p-card flex flex-col gap-1.5" data-skeleton-part="next-up">');
    expect(skeleton).toMatch(/data-skeleton-part="next-up">[\s\S]*?<Skeleton className="h-11 w-36 mt-2 rounded-full" \/>/);
    // The section chips (owner 11-08): the same wrapping row, 44px pills (Button size sm is h-11).
    expect(home).toContain('<div data-section-chips="" className="flex flex-wrap gap-2">');
    expect(skeleton).toContain('<div className="flex flex-wrap gap-2" data-skeleton-part="tiles">');
    expect(skeleton).toMatch(/<Skeleton key=\{i\} className="h-11 w-32 rounded-full" \/>/);
    // Board 7: Coming up sits ABOVE the sections in both.
    expect(home.lastIndexOf('title={t("home.comingUp")}')).toBeGreaterThan(0);
    expect(home.lastIndexOf('title={t("home.comingUp")}')).toBeLessThan(home.indexOf('aria-label={t("home.yourSections")}'));
    expect(skeleton.indexOf('data-skeleton-part="coming-up"')).toBeGreaterThan(0);
    expect(skeleton.indexOf('data-skeleton-part="coming-up"')).toBeLessThan(skeleton.indexOf('data-skeleton-part="tiles"'));
    // Same column gap as Home's stack.
    expect(home).toContain('className="flex flex-col gap-section"');
    expect(skeleton).toContain('<div className="flex flex-col gap-section">');
  });

  it("never draws the retired feed bar (search, filters)", () => {
    expect(skeleton).not.toMatch(/dashboard-title-emblem|dashboard-title-bell|TITLE_BAR_PADDING|DashboardSkeleton/);
  });
});

// Proof this is able to fail: each restores a real way the two drift.
// @mutate src/components/DashboardRouteSkeleton.tsx | <Skeleton className="h-8 w-8 rounded-ds-md" /> | <Skeleton className="h-11 min-w-0 flex-1 rounded-full" />
// @mutate src/components/DashboardRouteSkeleton.tsx | data-skeleton-part="next-up"> | data-skeleton-part="stats">
// @mutate src/components/DashboardRouteSkeleton.tsx |                 <Skeleton className="h-11 w-36 mt-2 rounded-full" /> |
// @mutate src/components/DashboardRouteSkeleton.tsx |               <span className="h-11 w-11 flex items-center justify-center">\n                <Skeleton className="h-6 w-6 rounded-full" />\n              </span>\n |
// @mutate src/components/DashboardRouteSkeleton.tsx |             <div className="flex items-center gap-1 shrink-0"> |             <div className="flex items-center gap-0.5 shrink-0">
// @mutate src/components/sections/SectionScreen.tsx | ${barSearch ? "px-4" : "px-5"} | ${barSearch !== undefined ? "px-4" : "px-5"}
// @mutate src/components/DashboardRouteSkeleton.tsx |                 <Skeleton className="w-9 h-9 rounded-full" />\n              </span> |                 <Skeleton className="w-9 h-9 rounded-full" />\n              </span>\n              <span className="h-10 w-10" />
// @mutate src/components/DashboardRouteSkeleton.tsx |     <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top"> |     <AppShell scrollable={false} className="bg-premium-page pt-safe-top">
