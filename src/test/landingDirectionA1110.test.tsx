/**
 * Direction A, "Porch and Parish" (owner 11-10, from the landing design audit ~/.lh-shots/landing-design-1110): the
 * unchanged hero, then real local photos, "Near you this week" (jobs and Declutter items, town and price), "Neighbors
 * say", How it works as numbered steps in one row, one deep-olive safety band with three badges, then join. The story
 * order itself is held by src/test/indexMountsHowItWorks.test.tsx (D014); the unboxed steps by howAJobWorksFits (D007).
 *
 * D001: "Near you this week" follows the hero's one Jobs | Declutter switch (which kind leads).
 * D003 (High): never an empty card: no open job means all Declutter items; nothing at all means no section.
 * D004 (High): real photos: a finished job (the owner's own photo) and a live porch-pickup listing, under the hero.
 * D011: real reviews (a dated record from prod), stars and words and place; NO names or faces until members consent.
 * D009/D010: the band is deep olive in BOTH themes, with three badges.
 *
 * @mutate src/components/landing/NearYouSection.tsx |   const cards = mixNearCards(jobs.kind === "ok" ? jobs.jobs : [], items.kind === "ok" ? items.items : [], mode); |   const cards = mixNearCards(jobs.kind === "ok" ? jobs.jobs : [], items.kind === "ok" ? items.items : [], "jobs");
 * @mutate src/components/landing/nearYouCards.ts |   const [first, second] = mode === "declutter" ? [i, j] : [j, i]; |   const [first, second] = [j, i];
 * @mutate src/components/landing/NearYouSection.tsx |   if (!pending && !bothFailed && cards.length === 0) return <span ref={ref} id="declutter" data-testid="landing-near-you-none" hidden />; |
 * @mutate src/components/landing/NearYouSection.tsx |         ) : pending ? ( |         ) : false ? (
 * @mutate src/components/landing/LandingPhotoBand.tsx |   const withPhoto = items.filter((i) => i.photo).reverse(); |   const withPhoto = items.filter((i) => i.photo);
 * @mutate src/components/landing/LandingPhotoBand.tsx | export const FINISHED_JOB_PHOTO = "/landing/new-iberia-yard.jpg"; | export const FINISHED_JOB_PHOTO = "";
 * @mutate src/components/landing/NeighborsSay.tsx |               <p className="text-ds-14" style={{ color: "var(--lp-body)" }}>\n                {r.who}. {r.job}, {r.place}.\n              </p> |
 * @mutate src/index.css | --lp-band: #2E2F22;\n  --lp-band-tile: #3A3C2B;\n  --lp-band-ink: #F1EEE7;\n  --lp-band-body: #D6D2C8;\n  --lp-band-money: #E2A585;\n  /* The band | --lp-band: #2B2A26;\n  --lp-band-tile: #3A3C2B;\n  --lp-band-ink: #F1EEE7;\n  --lp-band-body: #D6D2C8;\n  --lp-band-money: #E2A585;\n  /* The band
 * @mutate src/components/landing/SectionsShowcase.tsx |   { icon: Headset, title: "A real person answers" },\n |   { icon: Headset, title: "A real person answers" },\n  { icon: Headset, title: "No cash changes hands" },\n
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const data = vi.hoisted(() => ({
  jobs: { kind: "loading" } as { kind: "loading" } | { kind: "failed" } | { kind: "ok"; jobs: unknown[] },
  items: { kind: "waiting" } as { kind: "waiting" } | { kind: "failed" } | { kind: "ok"; items: unknown[] },
  open: null as ReadonlySet<string> | null,
}));
vi.mock("@/components/landing/LiveJobsSection", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/LiveJobsSection")>();
  return { ...real, useLiveJobs: () => data.jobs };
});
vi.mock("@/components/landing/FreshDeclutterSection", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/FreshDeclutterSection")>();
  return { ...real, useFreshItems: () => data.items };
});
vi.mock("@/components/landing/useSectionsOpen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/landing/useSectionsOpen")>();
  return { ...real, useSectionsOpen: () => ({ open: data.open, settled: data.open !== null, failed: false }) };
});
vi.mock("@/lib/routePrefetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/routePrefetch")>();
  return { ...real, whenPageSettled: () => () => {} };
});
vi.mock("@/lib/socialAuth", () => ({ SOCIAL_SIGN_IN_ENABLED: false, signInWithProvider: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true, ready: true }) }));

import { NearYouSection, onTheWayLine } from "@/components/landing/NearYouSection";
import { mixNearCards, NEAR_YOU_LIMIT } from "@/components/landing/nearYouCards";
import { LandingPhotoBand, FINISHED_JOB_PHOTO, porchTileItem } from "@/components/landing/LandingPhotoBand";
import { NeighborsSay, NEIGHBOR_REVIEWS } from "@/components/landing/NeighborsSay";
import { TrustAndJoin } from "@/components/landing/SectionsShowcase";
import { resetLandingModeForTests, setLandingMode } from "@/components/landing/landingMode";
import type { FreshItem } from "@/components/landing/FreshDeclutterSection";
import type { LiveJob } from "@/components/landing/LiveJobsSection";

const job = (n: number): LiveJob => ({
  id: `j${n}`, title: `Job ${n}`, budget: 50, date_needed: null, parish: "Iberia", category: "yard_work",
  pricing_mode: "fixed", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null,
});
const item = (n: number, porch = false): FreshItem => ({
  id: `i${n}`, title: `Thing ${n}`, category: "kitchen", condition_stars: 4, porch_ok: porch, price_cents: 2000,
  current_price_cents: 2000, area_label: "New Iberia", photo: `https://cdn.invalid/${n}.webp`, photoFull: null,
});

afterEach(() => {
  cleanup();
  resetLandingModeForTests();
  window.localStorage.clear();
  data.jobs = { kind: "loading" };
  data.items = { kind: "waiting" };
  data.open = null;
});

const near = () => render(<MemoryRouter><NearYouSection /></MemoryRouter>);
const kinds = () => [...screen.getByTestId("landing-near-you-list").querySelectorAll("li")].map((li) => (li.querySelector("[data-job-card]") ? "J" : "I")).join("");

describe("Near you this week (Direction A)", () => {
  it("mixes jobs and items; the hero's switch decides which leads (D001)", async () => {
    expect(mixNearCards([job(1), job(2)], [item(1), item(2), item(3)], "jobs").map((c) => c.kind[0]).join("")).toBe("jijii");
    expect(mixNearCards([job(1), job(2)], [item(1), item(2), item(3)], "declutter").map((c) => c.kind[0]).join("")).toBe("ijiji");
    expect(mixNearCards([], Array.from({ length: 12 }, (_, n) => item(n)), "jobs")).toHaveLength(NEAR_YOU_LIMIT);
    data.jobs = { kind: "ok", jobs: [job(1), job(2)] };
    data.items = { kind: "ok", items: [item(1), item(2), item(3)] };
    near();
    await screen.findByTestId("landing-near-you-list");
    expect(kinds()).toBe("JIJII");
    act(() => setLandingMode("declutter"));
    expect(kinds()).toBe("IJIJI");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Near you this week");
    // Town and price on every card; the item's list price first.
    for (const li of screen.getByTestId("landing-near-you-list").querySelectorAll("li")) {
      expect(li.querySelector("[data-card-town]")?.textContent?.trim()).toBeTruthy();
      expect(li.querySelector("[data-card-base-price]")?.textContent).toMatch(/^\$\d/);
    }
  });

  it("D003: no open job means all Declutter items, and nothing at all means no section, never an empty card", async () => {
    data.jobs = { kind: "ok", jobs: [] };
    data.items = { kind: "ok", items: [item(1), item(2)] };
    near();
    await screen.findByTestId("landing-near-you-list");
    expect(kinds()).toBe("II");
    cleanup();
    data.items = { kind: "ok", items: [] };
    near();
    expect(screen.queryByTestId("landing-near-you")).toBeNull();
    expect(screen.getByTestId("landing-near-you-none")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/No open jobs right now/);
  });

  it("while either read is out, a placeholder grid holds the place; both failing says so", () => {
    data.jobs = { kind: "ok", jobs: [job(1)] };
    near();
    expect(screen.getByTestId("landing-near-you-skeleton").querySelectorAll("li").length).toBeGreaterThan(3);
    cleanup();
    data.jobs = { kind: "failed" };
    data.items = { kind: "failed" };
    near();
    expect(screen.getByTestId("landing-near-you-failed")).toBeTruthy();
  });

  it("names the sections still on the way in one line (owner's tweak 3), and where Helpr is busy (D016)", () => {
    data.jobs = { kind: "ok", jobs: [job(1)] };
    data.items = { kind: "ok", items: [] };
    near();
    expect(screen.getByTestId("landing-sections-later").textContent).toBe("Shops and Homes are on the way.");
    expect(screen.getByTestId("landing-service-area").textContent).toBe("Serving New Iberia, Lafayette, Abbeville and nearby.");
    cleanup();
    data.open = new Set(["declutter", "shops"]);
    near();
    expect(screen.getByTestId("landing-sections-later").textContent).toBe("Homes is on the way.");
    cleanup();
    data.open = new Set(["declutter", "shops", "rentals"]);
    near();
    expect(screen.queryByTestId("landing-sections-later")).toBeNull();
    expect(onTheWayLine(["Shops", "Homes"])).toBe("Shops and Homes are on the way.");
  });

  it("D012: one link per destination, in the landing's verbs", async () => {
    data.jobs = { kind: "ok", jobs: [job(1)] };
    data.items = { kind: "ok", items: [item(1)] };
    near();
    const links = within(screen.getByTestId("landing-near-you-links")).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["Browse jobs", "/browse"], ["Shop Declutter", "/declutter"]]);
  });
});

describe("the photo band (D004)", () => {
  it("a real finished job, a live porch-pickup listing that is not the grid's first card, and no member's face", () => {
    data.items = { kind: "ok", items: [item(1), item(2, true), item(3, true)] };
    const { container } = render(<MemoryRouter><LandingPhotoBand /></MemoryRouter>);
    const tiles = [...container.querySelectorAll("[data-tile]")];
    expect(tiles.map((t) => t.getAttribute("data-tile"))).toEqual(["finished-job", "porch-item", "neighbors"]);
    expect(tiles[0].querySelector("img")?.getAttribute("src")).toBe(FINISHED_JOB_PHOTO);
    expect(FINISHED_JOB_PHOTO).toMatch(/^\/landing\/.+\.jpg$/);
    // Tile 2: porch pickup, from the END of the list (item 3), never the grid's first card (item 1).
    expect(tiles[1].querySelector("img")?.getAttribute("src")).toBe("https://cdn.invalid/3.webp");
    expect(tiles[1].textContent).toMatch(/Porch pickup/);
    expect(porchTileItem([item(1)])?.id).toBe("i1");
    expect(porchTileItem([])).toBeNull();
    // Tile 3: words, not a face, until members consent.
    expect(tiles[2].querySelector("img")).toBeNull();
  });
});

describe("Neighbors say (D011)", () => {
  it("real reviews: stars, the reviewer's words, the job and parish; no names and no faces", () => {
    const { container } = render(<NeighborsSay />);
    const reviews = [...container.querySelectorAll("[data-review]")];
    expect(reviews.length).toBe(NEIGHBOR_REVIEWS.length);
    expect(reviews.length).toBeGreaterThan(1);
    expect(container.querySelector("img")).toBeNull();
    for (const [i, r] of NEIGHBOR_REVIEWS.entries()) {
      expect(reviews[i].textContent).toContain(r.words);
      expect(reviews[i].textContent).toContain(r.place);
      expect(reviews[i].textContent).toContain(r.job);
      expect(r.place).toMatch(/ Parish$/);
      expect(r.reviewed <= "2026-11-10").toBe(true); // a dated record, read before it was written here
    }
  });
});

describe("the safety band (D009, D010)", () => {
  it("deep olive in light and dark, three badges", () => {
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
    const light = css.match(/\n\.landing-page \{([^}]*)\}/)?.[1] ?? "";
    const dark = css.match(/\[data-theme="dark"\] \.landing-page \{([^}]*)\}/)?.[1] ?? "";
    expect(light.match(/--lp-band:\s*(#[0-9A-Fa-f]{6})/)?.[1]).toBe("#2E2F22");
    expect(dark.match(/--lp-band:\s*(#[0-9A-Fa-f]{6})/)?.[1]).toBe("#2E2F22");
    render(<MemoryRouter><TrustAndJoin /></MemoryRouter>);
    expect(within(screen.getByTestId("landing-trust-badges")).getAllByRole("listitem")).toHaveLength(3);
  });
});
