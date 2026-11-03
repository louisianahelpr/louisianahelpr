/**
 * Q2018 (instant feel, skeleton part): /search?q= showed nothing under the
 * search box until the first answer arrived (loading-states measurement
 * 2026-10-07: customer and helper /search "no loading placeholder at any
 * settled stage"). While the read is in flight it now shows one result group
 * in the SAME row classes the real rows use, then the real rows replace it.
 *
 * @mutate src/pages/search/SearchPage.tsx |             <GroupSkeleton /> |             {null}
 * @mutate src/pages/search/SearchPage.tsx |           <div key={i} className={ROW_CLASS} data-testid="search-loading-row"> |           <div key={i} className="flex items-center gap-3 p-3" data-testid="search-loading-row">
 *
 * The head row is 28px with or without "See all" (the button's 44px floor made
 * it 44px only past PER_SECTION results, so no placeholder could match both):
 * the bone's head row and the real one share the class, and the button keeps
 * its 44px target with -my-2. Mocked harness, 375/1440 light+dark, 3 and 4
 * results: Save, group and Shops row move 0px.
 *
 * @mutate src/pages/search/SearchPage.tsx | const GROUP_HEAD_CLASS = "flex min-h-7 items-center justify-between px-1"; | const GROUP_HEAD_CLASS = "flex items-baseline justify-between px-1";
 * @mutate src/pages/search/SearchPage.tsx | className="-my-2 font-sans font-semibold text-ds-13 min-h-[44px]" | className="font-sans font-semibold text-ds-13 min-h-[44px]"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const gate = vi.hoisted(() => ({ release: null as null | (() => void), promise: null as null | Promise<void> }));

vi.mock("@/hooks/useFeature", () => ({
  useFeatureStatus: (key: string) => ({ on: key === "declutter", settled: true }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: async () => new Set<string>() }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const rows = [1, 2, 3, 4].map((n) => ({ id: `i${n}`, title: `Lamp ${n}`, description: null, category: "home", current_price_cents: 500, price_cents: 500, area_label: "Mid-City" }));
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "not", "in", "or", "order", "limit", "eq"]) b[m] = () => b;
    const data = table === "declutter_items" ? rows : [];
    b.then = (res: (v: unknown) => unknown) =>
      (gate.promise ?? Promise.resolve()).then(() => ({ data, error: null, count: data.length })).then(res);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: async () => ({ data: [], error: null }) } };
});

import SearchPage from "./SearchPage";

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  gate.promise = new Promise<void>((r) => { gate.release = r; });
});

describe("Q2018: /search shows a skeleton in the real row shape while it loads", () => {
  it("draws one group of 3 placeholder rows while the read is pending, then the real rows replace it", async () => {
    const { container } = mount("/search?q=lamp");
    const bones = await screen.findAllByTestId("search-loading-row");
    expect(bones.length).toBeGreaterThan(2);
    expect(bones).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("Searching");

    await act(async () => { gate.release?.(); });
    // Wait for the real rows (the data), then assert the bones are gone.
    await waitFor(() => expect(container.querySelectorAll('section[aria-label="Declutter"] a').length).toBeGreaterThan(2));
    expect(screen.queryByTestId("search-loading")).toBeNull();

    // Same box as what replaces it: every real row's classes (minus the press tint) equal the bone's.
    const realRows = Array.from(container.querySelectorAll('section[aria-label="Declutter"] a'));
    const boneClass = bones[0].className.trim().split(/\s+/).sort().join(" ");
    for (const a of realRows) {
      const cls = a.className.trim().split(/\s+/).filter((c) => c !== "ctl-tint").sort().join(" ");
      expect(cls).toBe(boneClass);
    }
  });

  it("the bone's thumb is the same 44px square the real row leads with", async () => {
    mount("/search?q=lamp");
    const [bone] = await screen.findAllByTestId("search-loading-row");
    const thumb = bone.querySelector("[data-skeleton]") as HTMLElement;
    expect(thumb.className).toContain("w-11");
    expect(thumb.className).toContain("h-11");
    expect(thumb.className).toContain("rounded-xl");
  });

  it("the head row is the same fixed 28px row in the bone and the real group, with See all keeping its 44px target", async () => {
    const { container } = mount("/search?q=lamp");
    const bone = await screen.findByTestId("search-loading");
    const boneHead = bone.firstElementChild as HTMLElement;
    await act(async () => { gate.release?.(); });
    const seeAll = await screen.findByRole("button", { name: "See all 4" });
    const realHead = container.querySelector('section[aria-label="Declutter"]')!.firstElementChild as HTMLElement;
    const core = (el: HTMLElement) => el.className.split(/\s+/).filter((c) => /^(flex|min-h-|items-|justify-|px-)/.test(c)).sort().join(" ");
    expect(core(realHead)).toContain("min-h-7");
    expect(core(boneHead)).toBe(core(realHead));
    expect(seeAll.className).toContain("-my-2");
    expect(seeAll.className).toContain("min-h-[44px]");
  });
});
