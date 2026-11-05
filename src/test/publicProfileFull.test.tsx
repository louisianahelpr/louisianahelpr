/**
 * Owner requests 11-05 on the shareable profile (/u/<handle>): "the link doesn't show all items listed", "not my full
 * profile", "a hire now button and any of the work they put pictures of", "a full profile showing everything".
 * Measured on prod 2026-11-05: lexi-l had 201 live items and the page showed 24 (public_profile_by_handle LIMIT 24).
 *
 * This file pins the page side (every listing reachable, "For sale · N", Show all, the public-safe profile fields,
 * Recent work, Hire me for everyone but you, no Hire flash on your own page) and the migration (every live listing,
 * listing_count, the fields, anon EXECUTE). The PGlite proof (P18-P20) runs the SQL:
 *   LH_PROFILE_THEN=20261103224601_review_tags_column.sql LH_PROFILE_WINDOW=20261104084501_apply_and_notices_read_date_window.sql \
 *   LH_PROFILE_FULL=20261105165059_public_profile_full.sql \
 *     npx tsx src/test/pglite/publicProfileByHandle.pglite.mjs --replay
 *
 * @mutate src/pages/u/PublicProfilePage.tsx | const listingsShown = allListings ? p.listings : p.listings.slice(0, LISTINGS_FIRST); | const listingsShown = p.listings.slice(0, LISTINGS_FIRST);
 * @mutate src/pages/u/PublicProfilePage.tsx | title={`For sale · ${listingTotal}`} | title="For sale"
 * @mutate src/pages/u/PublicProfilePage.tsx | {p.bio && <p | {false && <p
 * @mutate src/pages/u/PublicProfilePage.tsx | <HelperWorkPhotos urls={work} /> | {null}
 * @mutate src/pages/u/PublicProfilePage.tsx | {ctaReady && !isMe && <HireMeButton | {!isMe && <HireMeButton
 * @mutate src/pages/u/PublicProfilePage.tsx | ctaReady={!user \|\| !meLoading} | ctaReady={true}
 * @mutate supabase/migrations/20261105165059_public_profile_full.sql | GRANT UPDATE (show_in_search) ON public.profiles TO authenticated; | SELECT 1;
 * @mutate src/pages/u/PublicProfilePage.tsx | const PROFILE_WIDE = "min-[900px]:max-w-3xl"; | const PROFILE_WIDE = "";
 * @mutate supabase/migrations/20261105165059_public_profile_full.sql |      AND NOT public.profile_review_same_person(rt.reviewer_id, rt.reviewee_id); |      ;
 * @mutate src/pages/u/PublicProfilePage.tsx | grid grid-cols-2 gap-3 min-[900px]:grid-cols-4 | grid grid-cols-2 gap-3
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const rpc = vi.fn();
let signedIn: { id: string } | null = null;
let me: { handle: string } | null = null;
let meLoading = false;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/components/AppPage", () => ({ default: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main> }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: signedIn, ready: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: me, isLoading: meLoading }) }));
vi.mock("@/lib/nativeShare", () => ({ shareNative: vi.fn(async () => "shared") }));
vi.mock("@/lib/hireMe", () => ({ HIRE_PARAM: "hire", hireGuestHref: (h: string) => `/signup?hire=${h}`, hireGuestLoginHref: (h: string) => `/login?redirect=/u/${h}`, hireOfferPath: () => "/post-job", hireTargetByHandle: vi.fn() }));

const { default: PublicProfilePage, LISTINGS_FIRST } = await import("@/pages/u/PublicProfilePage");

const ROOT = resolve(__dirname, "..", "..");
const listing = (n: number) => ({ id: `i${n}`, title: `Item ${n}`, price_cents: 500, area_label: "Delcambre", photo_id: null, live_at: "2026-10-30T00:00:00Z" });
const PAGE = {
  handle: "lexi-l",
  name: "Lexi L.",
  photo_url: null,
  member_since: "2025-03-01T12:00:00Z",
  stats: { review_count: 0, avg_rating: null, is_id_verified: true },
  bio: "I fix fences and sell what I don't need.",
  town: "Delcambre",
  skills: "Yard work, Handyman",
  portfolio_urls: ["https://x.supabase.co/storage/v1/object/public/avatars/a/portfolio/1.jpg"],
  licensed: true,
  insured: false,
  business_name: "Lexi Fences",
  listing_count: 30,
  job_count: 0,
  listings: Array.from({ length: 30 }, (_, i) => listing(i + 1)),
  jobs: [],
  helpr: { jobs_done: 0, categories: [], reviews: [] },
  wanted: [],
};

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/u/lexi-l"]}>
        <Routes><Route path="/u/:handle" element={<PublicProfilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  rpc.mockReset();
  signedIn = null;
  me = null;
  meLoading = false;
});

describe("the shareable profile shows everything (owner requests 11-05)", () => {
  it("every item for sale is reachable: For sale · N, the first 24, then Show all", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    show();
    expect(await screen.findByRole("heading", { name: /For sale · 30/ })).toBeTruthy();
    expect(LISTINGS_FIRST).toBe(24);
    expect(screen.queryByText("Item 25")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 30" }));
    expect(screen.getByText("Item 30")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("the full profile: name as the page title, town, business, badges, bio, skills, Recent work, Hire me", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    show();
    expect(await screen.findByRole("heading", { level: 1, name: "Lexi L." })).toBeTruthy();
    expect(screen.getByTestId("pp-town").textContent).toBe("Delcambre");
    expect(screen.getByTestId("pp-business").textContent).toBe("Lexi Fences");
    expect(screen.getByTestId("pp-licensed")).toBeTruthy();
    expect(screen.queryByTestId("pp-insured")).toBeNull();
    expect(screen.getByTestId("pp-bio").textContent).toBe(PAGE.bio);
    expect([...screen.getByTestId("pp-skills").querySelectorAll("li")].map((l) => l.textContent)).toEqual(["Yard work", "Handyman"]);
    expect(screen.getByTestId("pp-work").querySelectorAll("img").length).toBe(1);
    expect(screen.getByTestId("pp-hire")).toBeTruthy();
  });

  it("your own page: no Hire me, never flashed while your profile loads; an empty Recent work asks for photos", async () => {
    signedIn = { id: "m1" };
    meLoading = true;
    rpc.mockResolvedValue({ data: { ...PAGE, portfolio_urls: [] }, error: null });
    const r = show();
    await screen.findByTestId("pp-bio");
    expect(screen.queryByTestId("pp-hire")).toBeNull();
    r.unmount();
    meLoading = false;
    me = { handle: "lexi-l" };
    show();
    await screen.findByTestId("pp-bio");
    expect(screen.queryByTestId("pp-hire")).toBeNull();
    expect(screen.getByRole("link", { name: "Add work photos" }).getAttribute("href")).toBe("/profile?tab=profile");
  });

  it("from 900px the column widens and the shop grid is 4 across (audit M5)", async () => {
    rpc.mockResolvedValue({ data: PAGE, error: null });
    const { container } = show();
    const grid = await screen.findByTestId("pp-listings-grid");
    expect(grid.className.split(" ")).toEqual(expect.arrayContaining(["grid-cols-2", "min-[900px]:grid-cols-4"]));
    const body = container.querySelector("[data-public-profile]") as HTMLElement;
    expect(body.className.split(" ")).toEqual(expect.arrayContaining(["max-w-md", "min-[900px]:max-w-3xl"]));
  });

  it("the migration returns every live listing, its count and the public-safe fields, and anon may call it", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const file = readdirSync(dir).filter((f) => /_public_profile_full\.sql$/.test(f)).sort().slice(-1)[0];
    expect(file).toBeTruthy();
    const sql = blankSqlComments(readFileSync(resolve(dir, file!), "utf8"));
    const listings = sql.slice(sql.indexOf("INTO v_listings"), sql.indexOf("INTO v_listing_count"));
    expect(listings).toMatch(/LIMIT 500/);
    expect(listings).not.toMatch(/LIMIT 24\b/);
    for (const key of ["'bio'", "'town'", "'skills'", "'portfolio_urls'", "'licensed'", "'insured'", "'business_name'", "'listing_count'"]) {
      expect(sql).toContain(key);
    }
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.public_profile_by_handle\(text\) TO anon, authenticated, service_role;/);
    // L7 (owner 11-05: search engines opt-in, default off), for Builder 3's link card.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS show_in_search boolean NOT NULL DEFAULT false;/);
    expect(sql).toMatch(/GRANT UPDATE \(show_in_search\) ON public\.profiles TO authenticated;/);
    expect(sql).toContain("'show_in_search', coalesce(v_p.show_in_search, false),");
    // L4 (owner 11-05): a review between one person's own accounts never shows and never counts; M2: the true total.
    const reviews = sql.slice(sql.indexOf("INTO v_reviews"), sql.indexOf("INTO v_review_total"));
    expect(reviews).toContain("AND NOT public.profile_review_same_person(rv.reviewer_id, rv.reviewee_id)");
    expect(reviews).toMatch(/LIMIT 100/);
    const total = sql.slice(sql.indexOf("INTO v_review_total"), sql.indexOf("INTO v_wanted"));
    expect(total).toContain("AND NOT public.profile_review_same_person(rt.reviewer_id, rt.reviewee_id);");
    expect(sql).toContain("'review_total', coalesce(v_review_total, 0)),");
    expect(sql).toMatch(/\|\| jsonb_build_object\('review_count', coalesce\(v_review_total, 0\), 'avg_rating', v_review_avg\)/);
    // The page reads the fields it renders.
    const page = blankComments(readFileSync(resolve(ROOT, "src/pages/u/PublicProfilePage.tsx"), "utf8"));
    for (const f of ["p.bio", "p.town", "p.skills", "p.portfolio_urls", "p.licensed", "p.business_name", "p.listing_count"]) expect(page).toContain(f);
  });
});
