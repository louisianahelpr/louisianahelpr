/**
 * Owner, 2026-10-21: a "Declutter is coming soon" toast showed on You › Money
 * with no tap there. The toast is said only by a tap on a switched-off section
 * (sayComingSoon: the rail, the Explore switcher, the Create sheet, the Home and
 * You tiles), and sonner keeps a toast across routes, so a tap on one screen
 * showed it on the next. Now any navigation dismisses it: ScrollToTop, mounted
 * once app-wide, calls dismissComingSoonToasts on every location change.
 *
 * @mutate src/components/mobileNav/useSectionTabs.ts |   for (const id of shownComingSoon) toast.dismiss(id); |   for (const id of shownComingSoon) void id;
 * @mutate src/components/ScrollToTop.tsx |   useEffect(() => { dismissComingSoonToasts(); }, [key]); |   useEffect(() => {}, [key]);
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ shown: [] as string[], dismissed: [] as string[] }));
vi.mock("sonner", () => ({
  toast: Object.assign((_m: string, o: { id: string }) => calls.shown.push(o.id), { dismiss: (id: string) => calls.dismissed.push(id) }),
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

import { dismissComingSoonToasts, sayComingSoon } from "@/components/mobileNav/useSectionTabs";

describe("a coming-soon toast stays on the screen that was tapped", () => {
  it("is dismissed by the next navigation, once", () => {
    sayComingSoon("Declutter");
    expect(calls.shown).toEqual(["coming-soon-Declutter"]);
    dismissComingSoonToasts();
    expect(calls.dismissed).toEqual(["coming-soon-Declutter"]);
    dismissComingSoonToasts();
    expect(calls.dismissed).toEqual(["coming-soon-Declutter"]);
  });

  it("ScrollToTop dismisses them on every location change", () => {
    expect(readFileSync("src/components/ScrollToTop.tsx", "utf8")).toContain("useEffect(() => { dismissComingSoonToasts(); }, [key]);");
  });
});
