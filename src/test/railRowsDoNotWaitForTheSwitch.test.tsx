/**
 * Q1838: the desktop rail's rows must not wait for the 'declutter' switch. On 2026-10-15 the rail listed
 * Home/Posts/Jobs/Messages/Profile while the switch was loading and inserted Declutter above Profile once it
 * answered, so the list grew by a row under the reader. Since the 10-18 option 1A design every section is ALWAYS
 * listed on the website (greyed while its switch is off or still loading, useFeature answers false then), and the
 * rail keeps a section unless `listed` is false (only in the iPhone app). So the switch answering changes a row's
 * look, never how many rows there are. This pins both halves: the rows the shared hook lists while the switch is
 * loading are the rows it lists once it answers, and the rail filters on `listed` alone.
 *
 * @mutate src/lib/hideUnopenedInApp.ts |   if (!tab \|\| !hideUnopenedInApp()) return true; |   if (!tab) return true;
 * @mutate src/components/DesktopSidebarNav.tsx | ?.listed !== false); | ?.on === true);
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const flags: Record<string, boolean> = {};
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => !!flags[k] }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useOpenToEveryoneAnswer: () => null }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));

import { useSectionTabs } from "@/components/mobileNav/useSectionTabs";

const rows = () => renderHook(() => useSectionTabs()).result.current;

describe("the rail's rows do not wait for the 'declutter' switch (Q1838)", () => {
  it("lists the same rows while the switch loads (false) as once it answers on", () => {
    for (const k of Object.keys(flags)) delete flags[k];
    const loading = rows();
    flags.declutter = true;
    const answered = rows();
    expect(loading.length).toBeGreaterThan(2);
    expect(loading.map((r) => r.path)).toEqual(answered.map((r) => r.path));
    expect(loading.find((r) => r.feature === "declutter")).toMatchObject({ on: false, listed: true });
    expect(answered.find((r) => r.feature === "declutter")).toMatchObject({ on: true, listed: true });
    expect(loading.every((r) => r.listed)).toBe(true);
  });

  it("the rail drops a section only when it is not listed, never because its switch is off", () => {
    const rail = blankComments(readFileSync(join(__dirname, "../components/DesktopSidebarNav.tsx"), "utf8"));
    expect(rail).toContain("const visibleSections = shownSections.filter((sec) => sectionTabs.find((x) => x.path === sec.path)?.listed !== false);");
  });
});
