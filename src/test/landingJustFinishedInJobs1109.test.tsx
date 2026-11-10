/**
 * Owner 11-09, signed-out home under the hero:
 *   - 10:31 PM (screenshot at 375): the "Just finished / 2 yards in New Iberia / You pick who helps · Paid when it's
 *     done" block took up space on its own above "Open jobs near you". It is no longer a block: the finished job is the
 *     FIRST CARD of the Jobs grid (loading and with jobs alike), and the two facts are the section's one line under its
 *     heading.
 *   - 10:35 PM: browsing Jobs and browsing Declutter look the same: both modes draw ONE frame (LandingBrowseShell): the
 *     same section padding, serif H2, line, see-all link and measure; Declutter's placeholder (L002) is that
 *     frame with its grid, so the real grid replaces it without moving the page.
 *   - D003 (landing design audit 11-10, High): with no open job the first section under the hero was an empty card
 *     ("No open jobs right now..."). It now shows real Declutter listings under "New on Declutter near you"; never an
 *     empty card. (This replaced L009's empty card and its Post a job link.)
 *
 * @mutate src/components/landing/LiveJobsSection.tsx |         <li className={LIVE_JOBS_ROW_H_MIN} data-landing-proof-card="">\n          <LandingProof />\n        </li>\n |
 * @mutate src/components/landing/LiveJobsSection.tsx |       line={line} |       line=""
 * @mutate src/components/landing/LiveJobsSection.tsx |   if (state.kind === "ok" && state.jobs.length === 0) return <FreshDeclutterSection shell={NO_JOBS_DECLUTTER_SHELL} />; |
 * @mutate src/components/landing/FreshDeclutterSection.tsx |         {state.kind === "waiting" && <FreshDeclutterSkeleton shell={shell} />}\n |
 * @mutate src/components/landing/FreshDeclutterStrip.tsx |     <LandingBrowseShell testId="landing-fresh-declutter" titleId="landing-fresh-declutter-title" {...shell}> |     <LandingBrowseShell testId="landing-fresh-declutter" titleId="landing-fresh-declutter-title" {...shell} line="">
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }));
const rows = vi.hoisted(() => ({ data: [] as unknown[], hold: false }));
vi.mock("@/lib/jobColumns", () => ({
  readJobsAheadOfDb: () => (rows.hold ? new Promise(() => {}) : Promise.resolve({ data: rows.data, error: null })),
}));

import { LiveJobsSection, forgetRecentLiveJobs } from "@/components/landing/LiveJobsSection";
import { FreshDeclutterSkeleton } from "@/components/landing/FreshDeclutterSection";
import FreshDeclutterStrip from "@/components/landing/FreshDeclutterStrip";
import { proofLine } from "@/components/landing/LandingProof";
import { DECLUTTER_SHELL, JOBS_SHELL, NO_JOBS_DECLUTTER_SHELL } from "@/components/landing/LandingBrowseShell";

class SeeAll {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

const job = (n: number) => ({
  id: `j${n}`, title: `Job ${n}`, budget: 50, date_needed: null, parish: "Iberia", category: null,
  pricing_mode: "fixed", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null,
});
const item = (n: number) => ({
  id: `i${n}`, title: `Thing ${n}`, category: "kitchen", condition_stars: 4, porch_ok: false, price_cents: 2000,
  current_price_cents: 2000, area_label: "Delcambre", photo: null, photoFull: null,
});

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeeAll);
  forgetRecentLiveJobs();
  rows.hold = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The finished-job card: inside the grid's FIRST item, and after the section's heading. */
function expectProofIsFirstCard() {
  const proof = screen.getByTestId("landing-proof");
  const h2 = screen.getByRole("heading", { level: 2, name: "Open jobs near you" });
  const grid = proof.closest("ul")!;
  expect(grid).toBeTruthy();
  expect(grid.firstElementChild?.contains(proof)).toBe(true);
  expect(h2.compareDocumentPosition(proof) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByTestId("landing-proof")).toHaveLength(1);
  expect(screen.getByText(proofLine(false))).toBeTruthy();
}

describe("owner 11-09: the finished job is a card in the Jobs section, not a block above it", () => {
  it("while loading", () => {
    rows.hold = true;
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    expectProofIsFirstCard();
    expect(screen.getAllByTestId("landing-live-jobs-skeleton").length).toBeGreaterThan(0);
  });

  it("with jobs", async () => {
    rows.data = [job(1), job(2), job(3)];
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    await screen.findByTestId("landing-live-jobs-list");
    expectProofIsFirstCard();
  });

  it("D003: with no open job, real Declutter listings take the section, never an empty card", async () => {
    rows.data = [];
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    await screen.findByTestId("landing-fresh-declutter-spot");
    expect(screen.getByText(NO_JOBS_DECLUTTER_SHELL.title)).toBeTruthy();
    expect(screen.queryByTestId("landing-live-jobs")).toBeNull();
    expect(screen.queryByText(/No open jobs right now/)).toBeNull();
    // With jobs, the Jobs section draws as before (inventory floor: the swap is only for the empty answer).
    cleanup();
    forgetRecentLiveJobs();
    rows.data = [job(1)];
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    expect((await screen.findByTestId("landing-live-jobs-list")).querySelectorAll("[data-live-job]").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("landing-fresh-declutter-spot")).toBeNull();
  });
});

describe("owner 11-09: browsing Jobs and browsing Declutter look the same", () => {
  /** The frame's shape: section classes, the H2 classes, the line, and the see-all links. */
  function frame(section: HTMLElement) {
    const h2 = section.querySelector("h2, span.font-display")!;
    return {
      section: section.className,
      heading: h2.className,
      line: !!section.querySelector("[data-landing-browse-line]")?.textContent?.trim(),
      seeAll: within(section).queryAllByRole("link").filter((a) => /Browse jobs|Shop Declutter/.test(a.textContent ?? "")).length,
    };
  }

  it("the Jobs section and the Declutter grid draw the same frame", async () => {
    rows.data = [job(1)];
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    await screen.findByTestId("landing-live-jobs-list");
    const jobs = frame(screen.getByTestId("landing-live-jobs"));
    cleanup();
    render(<MemoryRouter><FreshDeclutterStrip items={[item(1), item(2)]} /></MemoryRouter>);
    const declutter = frame(screen.getByTestId("landing-fresh-declutter"));
    expect(jobs.section.length).toBeGreaterThan(10);
    expect(declutter).toEqual(jobs);
    expect(declutter.line).toBe(true);
    expect(declutter.seeAll).toBe(2);
    expect(screen.getByRole("heading", { level: 2, name: DECLUTTER_SHELL.title })).toBeTruthy();
    expect(JOBS_SHELL.title).toBe("Open jobs near you");
  });

  it("L002: the Declutter placeholder is that frame with a full grid, hidden from assistive tech", () => {
    render(<MemoryRouter><FreshDeclutterSkeleton /></MemoryRouter>);
    const sk = screen.getByTestId("landing-fresh-declutter-skeleton");
    expect(sk.getAttribute("aria-hidden")).toBe("true");
    expect(sk.querySelectorAll("ul > li").length).toBe(8);
    expect(sk.querySelector("h2")).toBeNull();
    cleanup();
    render(<MemoryRouter><FreshDeclutterStrip items={Array.from({ length: 8 }, (_, i) => item(i + 1))} /></MemoryRouter>);
    const real = screen.getByTestId("landing-fresh-declutter");
    render(<MemoryRouter><FreshDeclutterSkeleton /></MemoryRouter>);
    const sk2 = screen.getByTestId("landing-fresh-declutter-skeleton");
    // Same section box and the same grid classes, so the real grid takes the placeholder's place.
    expect(sk2.className).toBe(real.className);
    expect(sk2.querySelector("ul")!.className).toBe(real.querySelector("ul")!.className);
  });
});
