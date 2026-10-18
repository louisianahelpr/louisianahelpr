/**
 * ONE LIST OF SECTIONS, AND A SWITCHED-OFF SECTION NEVER LEAKS (owner,
 * 2026-10-18: bottom bar = Home + Jobs & Posts + Declutter + Shops + Homes,
 * icons only with screen-reader labels (U1), no '+' in the bar, the desktop
 * rail and the Home hub carry the same set, sections out of Profile; a section
 * whose feature switch is off for the viewer is hidden).
 *
 * The class: a nav surface that keeps its own copy of the sections (the rail
 * had one, with Rentals missing, measured 2026-10-17) drifts from the others
 * and from the switches. Every surface here must read sectionNav.ts's
 * useVisibleSections(); none may name a section route or read a section
 * switch itself.
 */
// @mutate src/components/mobileNav/sectionNav.ts | s.featureKey === null \|\| on[s.featureKey] === true | true
// @mutate src/components/MobileNav.tsx | {sections.map((item) => ( | {SECTION_NAV.map((item) => (
// @mutate src/components/DesktopSidebarNav.tsx | const navItems = useVisibleSections(); | const navItems = [...useVisibleSections(), { key: "x", path: "/shops", icon: ShieldAlert, label: "Shops", featureKey: null, stack: [], post: null }];
// @mutate src/components/MobileNav.tsx | ariaLabel={locked ? `${label} — locked until your account is approved` : label} | ariaLabel={undefined}
// @mutate src/pages/hub/HomeHubPage.tsx | const sections = useVisibleSections(); | const sections = [...SECTION_NAV];
// @mutate src/components/mobileNav/sectionNav.ts | if (section === "declutter" \|\| section === "shops" \|\| section === "homes") return []; |
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));

import { SECTION_NAV, visibleSections, inboxForSection, sectionForPath } from "@/components/mobileNav/sectionNav";

const src = (rel: string) => blankComments(readFileSync(resolve(__dirname, "..", rel), "utf8"));

// Every surface that lists the sections. A new one joins this list.
const SURFACES = ["components/MobileNav.tsx", "components/DesktopSidebarNav.tsx", "pages/hub/HomeHubPage.tsx"];

describe("the sections come from ONE list (sectionNav.ts)", () => {
  it("the list is Home, Jobs & Posts, Declutter, Shops, Homes, each with a screen-reader label", () => {
    expect(SECTION_NAV.map((s) => s.label)).toEqual(["Home", "Jobs & Posts", "Declutter", "Shops", "Homes"]);
    for (const s of SECTION_NAV) expect(s.label.trim().length, `${s.key} has no label`).toBeGreaterThan(2);
    // Every section but Home has a labeled '+' action for its header.
    expect(SECTION_NAV.filter((s) => s.key !== "home").every((s) => !!s.post?.label)).toBe(true);
  });

  it("a section whose switch is off is never offered", () => {
    const off = { declutter: false, shops: false, rentals: false };
    expect(visibleSections(off).map((s) => s.key)).toEqual(["home", "jobs"]);
    for (const k of ["declutter", "shops", "rentals"] as const) {
      const keys = visibleSections({ ...off, [k]: true }).map((s) => s.featureKey);
      expect(keys.filter((f) => f !== null)).toEqual([k]);
    }
    expect(visibleSections({ declutter: true, shops: true, rentals: true })).toHaveLength(5);
  });

  it("every nav surface reads useVisibleSections() and keeps no copy of its own", () => {
    expect(SURFACES.length).toBeGreaterThan(2);
    for (const f of SURFACES) {
      const code = src(f);
      expect(code, `${f} must read useVisibleSections()`).toMatch(/\buseVisibleSections\(\)/);
      // No section route literal and no section switch read of its own.
      for (const route of ['"/declutter"', '"/shops"', '"/rentals"']) {
        expect(code.includes(route), `${f} names ${route} itself`).toBe(false);
      }
      expect(code, `${f} reads a section switch itself`).not.toMatch(/useFeature(?:Status)?\(\s*"(declutter|shops|rentals)"\s*\)/);
      // It lists the sections it was given, never the whole unfiltered list.
      expect(code, `${f} maps SECTION_NAV directly`).not.toMatch(/SECTION_NAV\s*\.\s*map\(/);
      expect(code, `${f} spreads SECTION_NAV`).not.toMatch(/\.\.\.\s*SECTION_NAV\b/);
    }
  });

  it("the bar is icons only with a label on every tab, and has no '+'", () => {
    const nav = src("components/MobileNav.tsx");
    expect(nav).toMatch(/\{sections\.map\(\(item\) =>/);
    expect(nav).toMatch(/ariaLabel=\{locked \? `\$\{label\}[^`]*` : label\}/);
    expect(nav, "the bar's icon is decorative; the tab carries the name").toMatch(/<Icon\s+aria-hidden/);
    expect(nav, "no Post FAB / '+' in the bottom bar").not.toMatch(/\bPlus\b/);
    const rail = src("components/DesktopSidebarNav.tsx");
    expect(rail).toMatch(/const navItems = useVisibleSections\(\);/);
  });

  it("Profile carries no section rows (sections live in the bar, rail and Home hub)", () => {
    const landing = src("components/profile/ProfileLanding.tsx");
    for (const route of ["/declutter", "/shops", "/rentals"]) expect(landing.includes(route)).toBe(false);
    expect(landing).not.toMatch(/EntryRow/);
  });

  it("a section's inbox never mixes in another section's threads", () => {
    const jobThreads = [{ jobId: "j1" }, { jobId: "j2" }];
    // Every thread today is about a job: Jobs & Posts (and the plain inbox) keep them all.
    expect(inboxForSection("jobs", jobThreads)).toHaveLength(2);
    expect(inboxForSection(null, jobThreads)).toHaveLength(2);
    for (const s of ["declutter", "shops", "homes"]) expect(inboxForSection(s, jobThreads)).toEqual([]);
    expect(src("pages/messages/Messages.tsx")).toMatch(/conversations=\{inboxForSection\(inboxSection, conversations\)\}/);
  });

  it("sub-routes light their own section", () => {
    expect(sectionForPath("/posts")?.key).toBe("jobs");
    expect(sectionForPath("/jobs/abc")?.key).toBe("jobs");
    expect(sectionForPath("/declutter/item/1")?.key).toBe("declutter");
    expect(sectionForPath("/rentals/requests/1")?.key).toBe("homes");
    expect(sectionForPath("/profile")).toBeNull();
  });
});
