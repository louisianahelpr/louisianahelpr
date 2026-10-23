/**
 * NO SURFACE SAYS "PREVIEW" FOR AN UNOPENED SECTION (owner, 2026-10-23: the desktop rail says "Coming soon", not
 * "Preview", next to Declutter, Shops and Homes, "the same rule as the phone chips, testers included, one source").
 *
 * One rule decides the mark: sectionComingSoon (src/components/mobileNav/useSectionTabs.ts), a section not open to
 * the viewer OR open to them only as a tester. The phone chips (ExploreSwitcher) and the desktop rail
 * (DesktopSidebarNav) read it and say "Coming soon"; the Create sheet and Settings mark a tester-only section with
 * their own soon pill. The old PreviewPill is deleted, and nothing in src may bring back a "Preview" section mark.
 *  1. the rule, every case;
 *  2. the real rail: a tester-only section (switch on, not open to everyone) and a closed one both say "Coming soon"
 *     beside the name, no "Preview"; only the closed one is inert; a section open to everyone has no mark;
 *  3. the source: no PreviewPill anywhere, every listing reads the rule or the preview flag into a soon pill.
 *
 * @mutate src/components/DesktopSidebarNav.tsx | soonMark: t ? sectionComingSoon(t) : false, | soonMark: t ? !t.on : false,
 * @mutate src/components/sections/SoonPill.tsx | variant === "rail" ? "Coming soon" : "Soon" | variant === "rail" ? "Preview" : "Soon"
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const open = vi.hoisted(() => ({ toEveryone: new Set<string>(["shops"]) as ReadonlySet<string> | null }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => open.toEveryone }));
// Declutter and Shops are on for this viewer, Homes is off: Declutter is a tester-only preview, Shops is open to everyone.
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k !== "rentals" }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, isAdmin: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0 }) }));
vi.mock("@/components/admin/adminBadgeStore", () => ({ useAdminBadges: () => ({}) }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {} }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/create/CreateSheet", () => ({ CreateSheet: () => null }));

import DesktopSidebarNav from "@/components/DesktopSidebarNav";
import { sectionComingSoon } from "@/components/mobileNav/useSectionTabs";

const ROOT = resolve(__dirname, "../..");
afterEach(cleanup);

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("no surface says Preview for an unopened section (owner 2026-10-23)", () => {
  it("1. the one rule: closed or tester-only is Coming soon; open to everyone is not", () => {
    expect(sectionComingSoon({ on: false, preview: false })).toBe(true);
    expect(sectionComingSoon({ on: true, preview: true })).toBe(true);
    expect(sectionComingSoon({ on: true, preview: false })).toBe(false);
  });

  it("2. the desktop rail: Declutter (tester-only) and Homes (closed) say Coming soon, Shops (open) says nothing", () => {
    render(<MemoryRouter initialEntries={["/home"]}><DesktopSidebarNav /></MemoryRouter>);
    const row = (path: string) => document.querySelector(`[data-sidebar-item="${path}"]`)!;
    expect(row("/declutter").textContent).toMatch(/Coming soon/);
    expect(row("/rentals").textContent).toMatch(/Coming soon/);
    expect(row("/shops").textContent).not.toMatch(/Coming soon/);
    expect(document.body.textContent).not.toMatch(/\bPreview\b/);
    // A tester opens their preview; a closed section stays inert.
    expect(row("/declutter").getAttribute("aria-disabled")).toBeNull();
    expect(row("/rentals").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  });

  it("3. no PreviewPill and no Preview section mark anywhere in src", () => {
    const files = walk("src");
    expect(files.length).toBeGreaterThan(1500);
    const hits = files.filter((f) => /\bPreviewPill\b|data-preview-pill/.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));
    expect(hits).toEqual([]);
  });
});
