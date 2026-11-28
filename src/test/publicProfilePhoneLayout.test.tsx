/**
 * Owner 11-14 (Depop/Vinted review item 10, ~/.lh-shots/depop-vinted-audit-1114/FINDINGS.md): the public profile
 * /u/<handle> on a phone (below lg = 900px; the desktop page is unchanged) is a compact header, tabs that pin to the
 * top, and a 3-across grid of square photos like Depop's profile.
 *
 * Measured at 390x844 on local dev against prod reads (/u/lexi-l, signed-in member view; ~/.lh-shots/profile-depop-1114,
 * before/after-metrics-390.json): before, the hero card was 549 CSS px tall (96px photo, bio in full, Hire me and Share
 * stacked) and the first listing started at y=686, 2 across at 152px; after, the header is 204px, the first listing
 * starts at y=393, 3 across at 115px, and the tab bar pins at y=44 (under the 44px compact title bar) when scrolled.
 *
 * jsdom applies no CSS, so these read the classes that do the work, the tab behaviour, and the index.css rule that
 * takes T2's !important card shadow off the plain phone surfaces.
 *
 * @mutate src/components/profile/publicProfile/PublicProfileTabs.tsx | return active && key !== active && tabs.some((t) => t.key === key) ? "max-lg:hidden" : ""; | return "";
 * @mutate src/components/profile/publicProfile/PublicProfileTabs.tsx | className={`sticky z-20 flex gap-5 | className={`z-20 flex gap-5
 * @mutate src/pages/u/PublicProfilePage.tsx | grid grid-cols-3 gap-0.5 lg:grid-cols-4 lg:gap-3 | grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-3
 * @mutate src/pages/u/PublicProfilePage.tsx | className="mx-auto h-24 w-24 max-lg:mx-0 max-lg:h-16 max-lg:w-16 max-lg:shrink-0" | className="mx-auto h-24 w-24"
 * @mutate src/components/profile/publicProfile/PublicProfileBio.tsx | {open ? "" : " max-lg:line-clamp-2"} | {""}
 * @mutate src/pages/u/PublicProfilePage.tsx | <div className="max-lg:mt-3 max-lg:flex max-lg:flex-wrap | <div className="max-lg:mt-3 max-lg:flex-wrap
 * @mutate src/index.css |   html:root [data-pp-plain] { |   html:root [data-pp-plain-off] {
 * @mutate src/pages/u/PublicProfilePage.tsx | titleActions={memberActions} phoneHidesTitle={!!q.data}> | titleActions={memberActions}>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const rpc = vi.fn();
const auth = vi.hoisted(() => ({ user: { id: "viewer" } as { id: string } | null, isReady: true }));
const shell = vi.hoisted(() => ({ phoneHidesTitle: undefined as boolean | undefined }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } }));
vi.mock("@/components/AppPage", () => ({
  default: ({ children, phoneHidesTitle }: { children: ReactNode; phoneHidesTitle?: boolean }) => { shell.phoneHidesTitle = phoneHidesTitle; return <main data-shell="app">{children}</main>; },
}));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({ PublicHeaderPage: ({ children }: { children: ReactNode }) => <main data-shell="public">{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: { handle: "someone-else" }, isLoading: false }) }));
vi.mock("@/components/profile/publicProfile/PublicProfileMemberActions", () => ({ PublicProfileMemberActions: () => null }));
vi.mock("@/components/profile/publicProfile/PublicJobPhotos", () => ({ PublicJobPhotos: () => null, MyJobPhotosPicker: () => null }));
vi.mock("@/components/profile/publicProfile/PublicProfileMovingSale", () => ({ PublicProfileMovingSale: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const { default: PublicProfilePage } = await import("@/pages/u/PublicProfilePage");

const ROOT = resolve(__dirname, "..", "..");
const PAGE = {
  handle: "eli-b", name: "Eli B.", photo_url: null, member_since: "2025-03-01T12:00:00Z", town: "Lafayette", bio: "I fix fences.\nAnd sell old tools.",
  skills: "Yard work", stats: { review_count: 1, avg_rating: 5, is_id_verified: true }, listing_count: 2, job_count: 1,
  listings: [
    { id: "i1", title: "Oak dresser", price_cents: 500, area_label: "Mid City", photo_id: "p1", live_at: "2026-10-30T00:00:00Z" },
    { id: "i2", title: "Free lamp", price_cents: 0, area_label: null, photo_id: null, live_at: "2026-10-29T00:00:00Z" },
  ],
  jobs: [{ id: "j1", title: "Mow my yard", category: "yard_work", town: "Lafayette", budget: 40, date_needed: jobLocalDateISO(6) }],
  helpr: { jobs_done: 3, categories: ["yard_work"], reviews: [{ rating: 5, feedback: "Great", created_at: "2026-10-01T00:00:00Z", reviewer_name: "Ann", job_category: "yard_work", response_text: null, response_at: null }] },
  wanted: [{ id: "w1", what: "Ladder", category: "tools", max_price_cents: 2000, created_at: "2026-10-01T00:00:00Z" }],
};
const show = () => {
  rpc.mockImplementation(async (name: string) => (name === "public_profile_by_handle" ? { data: PAGE, error: null } : { data: null, error: null }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/u/eli-b"]}><Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
};
const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);
/** The Pane (tab panel wrapper) around an element. */
const pane = (el: Element) => el.closest("[data-public-profile] > div") as HTMLElement;

beforeEach(() => { rpc.mockReset(); auth.user = { id: "viewer" }; auth.isReady = true; shell.phoneHidesTitle = undefined; });

describe("/u/<handle> on a phone: compact header, pinned tabs, 3-across grid (owner 11-14)", () => {
  it("tabs name every section the page shows, in order, and pin to the top below lg only", async () => {
    show();
    const bar = await screen.findByTestId("pp-tabs");
    const tabs = within(bar).getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(3);
    expect(tabs.map((t) => t.getAttribute("data-pp-tab"))).toEqual(["sale", "jobs", "work", "wanted"]);
    expect(tabs[0].textContent).toBe("For sale2");
    expect(classes(bar)).toEqual(expect.arrayContaining(["sticky", "lg:hidden", "top-11", "-mx-3", "px-3"]));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("one tab's sections show at a time below lg; a tap switches; from lg every section shows (no lg: hiding)", async () => {
    show();
    await screen.findByTestId("pp-tabs");
    const grid = screen.getByTestId("pp-listings-grid");
    const jobs = screen.getByText("Mow my yard");
    const wanted = screen.getByText("Ladder");
    const reviews = document.getElementById("pp-helpr")!;
    expect(classes(pane(grid))).not.toContain("max-lg:hidden");
    for (const el of [jobs, wanted, reviews]) expect(classes(pane(el))).toContain("max-lg:hidden");
    act(() => { fireEvent.click(screen.getByRole("tab", { name: /Jobs/ })); });
    expect(classes(pane(jobs))).not.toContain("max-lg:hidden");
    expect(classes(pane(grid))).toContain("max-lg:hidden");
    expect(screen.getByRole("tab", { name: /Jobs/ }).getAttribute("aria-selected")).toBe("true");
    act(() => { fireEvent.click(screen.getByRole("tab", { name: /Work/ })); });
    expect(classes(pane(reviews))).not.toContain("max-lg:hidden");
    expect(classes(pane(screen.getByTestId("pp-skills-phone")))).not.toContain("max-lg:hidden");
    for (const el of [grid, jobs, wanted, reviews]) expect(classes(pane(el)).filter((c) => c.startsWith("lg:hidden") || c === "hidden")).toEqual([]);
  });

  it("the grid is 3 across with 2px gaps and square photos below lg, the price on the photo, the title for screen readers", async () => {
    show();
    const grid = await screen.findByTestId("pp-listings-grid");
    expect(classes(grid)).toEqual(expect.arrayContaining(["grid-cols-3", "gap-0.5", "lg:grid-cols-4", "lg:gap-3"]));
    const first = grid.querySelector("li")!;
    expect(classes(first.querySelector("img")?.parentElement)).toContain("aspect-square");
    const text = first.querySelector("[data-pp-tile-text]")!;
    expect(classes(text)).toEqual(expect.arrayContaining(["max-lg:absolute", "max-lg:bottom-0", "max-lg:bg-gradient-to-t"]));
    expect(classes(within(first as HTMLElement).getByText("Oak dresser"))).toContain("max-lg:sr-only");
    expect(classes(first.querySelector("[data-pp-list-price]"))).toContain("max-lg:text-white");
    // Owner 11-27: one price on the tile, fee included; no second line.
    expect(first.textContent).not.toMatch(/incl\. fee/);
  });

  it("the header is compact below lg: 64px photo beside the lines, plain (no card), bio clamped, actions in one row", async () => {
    show();
    await screen.findByTestId("pp-tabs");
    const card = document.querySelector("[data-pp-card]")!;
    expect(card.hasAttribute("data-pp-plain")).toBe(true);
    expect(classes(card)).toEqual(expect.arrayContaining(["max-lg:p-0", "max-lg:border-0", "max-lg:text-left", "p-5", "bg-card"]));
    const avatar = card.querySelector(".h-24")!;
    expect(classes(avatar)).toEqual(expect.arrayContaining(["max-lg:h-16", "max-lg:w-16"]));
    expect(classes(avatar.parentElement)).toEqual(expect.arrayContaining(["max-lg:flex", "max-lg:items-center"]));
    expect(screen.getByTestId("pp-name-phone").textContent).toBe("Eli B.");
    expect(shell.phoneHidesTitle).toBe(true);
    expect(classes(screen.getByTestId("pp-bio"))).toContain("max-lg:line-clamp-2");
    expect(classes(screen.getByTestId("pp-actions"))).toEqual(expect.arrayContaining(["max-lg:flex", "max-lg:flex-wrap"]));
    expect(classes(screen.getByTestId("pp-skills"))).toContain("max-lg:hidden");
    expect(screen.getByRole("button", { name: "Share Eli's profile" })).toBeTruthy();
  });

  it("T2's !important card shadow is taken off the plain phone surfaces, below lg only", () => {
    const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    const at = css.indexOf("html:root [data-pp-plain] {");
    expect(at).toBeGreaterThan(1000);
    const block = css.slice(css.lastIndexOf("@media", at), css.indexOf("}", at));
    expect(block).toContain("@media not all and (min-width: 900px)");
    expect(block).toContain("box-shadow: none !important;");
    expect(block).toContain("background-color: transparent !important;");
  });
});
