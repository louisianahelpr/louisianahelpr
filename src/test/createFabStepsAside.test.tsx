/**
 * THE CREATE ACTION IS NEVER ON SCREEN TWICE, AND EVERY "MY …" SHEET COUNTS ITS TO-DOS (owner via the lead, 11-08,
 * follow-ups to the Vinted header).
 *
 *  1. The floating create pill (SectionCreateFab) steps aside while the screen's empty state shows its own create
 *     button: Jobs' empty Browse ("+ Post a job"), an empty Posted ("Post a job"), Declutter's empty Browse ("+ Sell
 *     something", members only) and empty Selling ("Sell an item"), Shops' Shop tab with no shop ("Open a shop"), and
 *     Homes' empty Owning ("Add a property"). Each mounts HideSectionCreateFab beside its button (createFabHidden.tsx).
 *     Seen at 375 before the fix: ~/.lh-shots/b1-declutter-header/fin2-_jobs_tab_posted-375-dark.png and
 *     fin-_rentals_tab_own-320-light.png drew both.
 *  2. "My Jobs", "My Shops" and "My Homes" carry to-do counts and the photo's dot, as "My Declutter" does: Jobs' Posted
 *     and Working from Home's to-do list split by side (needsYouStore jobsPosted / jobsWorking, published by
 *     NeedsYouBridge), Shops' Shop from the same list's shop orders, Homes' Owning from its own "Needs you" requests.
 *
 * @mutate src/components/sections/SectionCreateFab.tsx |   if (desktop \|\| hidden \|\| typeof document === "undefined") return null; |   if (desktop \|\| typeof document === "undefined") return null;
 * @mutate src/components/sections/createFabHidden.tsx |     return () => {\n      hiders -= 1; |     return () => {\n      hiders -= 0;
 * @mutate src/components/sections/createFabHidden.tsx |     if (!active) return; |     void active;
 * @mutate src/components/job-card/ActivityEmptyState.tsx | <>{isPosted && <HideSectionCreateFab />}{ctaButton}</> | <>{ctaButton}</>
 * @mutate src/components/NeedsYouBridge.tsx | t.section === "jobs" && t.id.startsWith("p-") | t.section === "jobs"
 * @mutate src/components/rentals/homesTabs.ts | r.landlord_id === uid && r.status === "submitted" | r.landlord_id === uid
 * @mutate src/components/rentals/homesTabs.ts | count: t.value === "own" ? ownNeeds : undefined | count: undefined
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticLight: () => {} }));

import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { HideSectionCreateFab, useSectionCreateFabHidden } from "@/components/sections/createFabHidden";
import { myHomes } from "@/components/rentals/homesTabs";
import { mineToDoCount } from "@/components/sections/sectionMine";
import type { MaintenanceRequest } from "@/lib/rentals/api";

afterEach(cleanup);
const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

describe("1. the floating create pill steps aside while an empty state shows its own create", () => {
  it("drawn by default; gone while one empty state is mounted; back when it leaves", () => {
    const { rerender } = render(<MemoryRouter><SectionCreateFab section="jobs" text="Post a job" /></MemoryRouter>);
    expect(screen.getByTestId("section-create-fab")).toBeInTheDocument();
    rerender(<MemoryRouter><SectionCreateFab section="jobs" text="Post a job" /><HideSectionCreateFab /></MemoryRouter>);
    expect(screen.queryByTestId("section-create-fab")).toBeNull();
    rerender(<MemoryRouter><SectionCreateFab section="jobs" text="Post a job" /></MemoryRouter>);
    expect(screen.getByTestId("section-create-fab")).toBeInTheDocument();
  });

  it("a count, not a flag: two empty states, either leaving first, keep it hidden until both are gone; `active={false}` hides nothing", () => {
    const { result } = renderHook(() => useSectionCreateFabHidden());
    expect(result.current).toBe(false);
    const a = render(<HideSectionCreateFab />);
    const b = render(<HideSectionCreateFab />);
    expect(result.current).toBe(true);
    act(() => a.unmount());
    expect(result.current).toBe(true);
    act(() => b.unmount());
    expect(result.current).toBe(false);
    const off = render(<HideSectionCreateFab active={false} />);
    expect(result.current).toBe(false);
    off.unmount();
  });

  it("every empty state that offers the section's create mounts it (inventory)", () => {
    const sites: [string, RegExp][] = [
      ["src/components/dashboard/EmptyFeedActions.tsx", /<HideSectionCreateFab \/>\s*<EmptyStateActions\s+primary=\{\{ label: "Post a job"/],
      ["src/components/job-card/ActivityEmptyState.tsx", /\{isPosted && <HideSectionCreateFab \/>\}\{ctaButton\}/],
      ["src/components/declutter/DeclutterBrowseView.tsx", /<HideSectionCreateFab active=\{!guest\} \/>\s*<EmptyStateActions/],
      ["src/components/declutter/DeclutterHomeView.tsx", /action=\{<><HideSectionCreateFab \/><SectionActionPill[^\n]*sectionByKey\("declutter"\)\.add\.path/],
      ["src/components/shops/ShopDashboardView.tsx", /<HideSectionCreateFab \/>\s*<SectionActionPill[^\n]*>Open a shop<\/SectionActionPill>/],
      ["src/components/rentals/RentalsHomeView.tsx", /<HideSectionCreateFab \/>\s*<Button[^>]*onClick=\{\(\) => setAdding\(true\)\}>\s*Add a property/],
    ];
    expect(sites.length).toBeGreaterThan(5);
    for (const [f, rx] of sites) expect({ f, mounts: rx.test(code(f)) }).toEqual({ f, mounts: true });
    expect(code("src/components/sections/SectionCreateFab.tsx")).toContain("const hidden = useSectionCreateFabHidden();");
  });
});

describe("2. My Jobs, My Shops and My Homes count their to-dos, as My Declutter does", () => {
  it("Jobs: Posted and Working read Home's to-dos split by side; the bridge splits them by the to-do's id", () => {
    const bridge = code("src/components/NeedsYouBridge.tsx");
    expect(bridge).toContain('const jobsPosted = todos.filter((t) => t.section === "jobs" && t.id.startsWith("p-")).length;');
    expect(bridge).toContain("const jobsWorking = jobs - jobsPosted;");
    const todos = code("src/pages/home/homeDashboard/needsYouTodos.ts");
    expect(todos).toContain("id: `p-${j.id}`,");
    expect(todos).toContain("id: `a-${a.id}`,");
    const jobs = code("src/pages/jobs/JobsSection.tsx");
    expect(jobs).toContain("const todoFor = { posted: todo.jobsPosted, working: todo.jobsWorking } as const;");
    expect(jobs).toContain("to: `/jobs?tab=${t.value}`, count: todoFor[t.value] })),");
  });

  it("Shops: Shop carries my shop's orders waiting for an answer", () => {
    const shops = code("src/components/shops/ShopsHomeView.tsx");
    expect(shops).toContain("const shopToDo = useNeedsYouCounts(useAuthReady().user?.id).shops;");
    expect(shops).toContain('count: t.value === "shop" ? shopToDo : undefined');
    expect(shops).toContain("mine={desktop ? undefined : myShops(shopToDo)}");
  });

  it("Homes: Owning counts the requests waiting for me as the landlord, and the photo's dot follows", () => {
    const r = (id: string, landlord: string, status: string) => ({ id, landlord_id: landlord, tenant_id: "t", status }) as unknown as MaintenanceRequest;
    const menu = myHomes([r("1", "me", "submitted"), r("2", "me", "submitted"), r("3", "me", "approved"), r("4", "x", "submitted")], "me");
    expect(menu.title).toBe("My Homes");
    expect(menu.items.map((i) => [i.key, i.count])).toEqual([["rent", undefined], ["own", 2]]);
    expect(mineToDoCount(menu)).toBe(2);
    expect(mineToDoCount(myHomes(undefined, "me"))).toBe(0);
    expect(code("src/components/rentals/RentalsHomeView.tsx")).toContain("mine: myHomes(data.data?.requests, uid),");
  });
});
