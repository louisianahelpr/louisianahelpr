/*
 * GUARD (Q169, owner 2026-09-23): pages must not "jump" while they load —
 * "the public browse-jobs page loads, jumps, more cards appear, it loads
 * again, and more jobs load; they don't all load together."
 *
 * Measured on a production build against prod (scripts/audit/measure-page-
 * settle.mjs, 375, Fast 3G + 4x CPU): three separate causes, each fixed at a
 * shared layer and each pinned here.
 *
 *   1. JobCard (the one card every job feed renders) faded in on its own
 *      index x 70ms delay, so a list that arrived in ONE commit still reached
 *      the eye card by card. The class of defect is any list item animating
 *      in on an index-derived delay, so that is what is scanned for, app-wide.
 *   2. /browse painted its list, then re-sorted it ~400ms later when poster
 *      tiers arrived. useArrivalGate holds a page's skeleton until the primary
 *      query is in AND the secondary ones have settled (bounded by a cap).
 *   3. DashboardGuest must render its skeleton off that gate, not off the
 *      list query's own isLoading.
 *
 * The runtime half of this guard is e2e/happy-path/page-settle.spec.ts (CLS
 * and content waves per route, on the preview build).
 */
// @mutate src/components/dashboard/JobCard.tsx | : "group relative h-full rounded-2xl | : "motion-safe:animate-fade-in group relative h-full rounded-2xl
// @mutate src/hooks/useArrivalGate.ts | const ready = latched \|\| (primaryReady && (secondaryReady \|\| capped)); | const ready = latched \|\| primaryReady;
// @mutate src/pages/DashboardGuest.tsx | {!feedReady ? ( | {isLoading ? (
// @mutate src/pages/postjob/EntryChoice.tsx | unpaidDrafts !== null && recentPosted !== null && form.openJobCount !== null | true
// @mutate src/components/NotificationPreferences.tsx |   if (!loaded) return <ProfileTabBodyReserve />;\n |
// @mutate src/components/profile/EarningsTab.tsx | view === "earnings" && !earningsReady && | view === "earnings" && loading &&
// @mutate src/components/profile/ReviewsTab.tsx | {!loading && reviewCount > 0 && avgRating != null && ( | {reviewCount > 0 && avgRating != null && (
// @mutate src/pages/Dashboard.tsx |         titleCard={isWebDesktop ? undefined : <DashboardTitleBar | titleCard={<DashboardTitleBar
// @mutate src/components/ui/skeletons/JobCardSkeleton.tsx | invisible font-sans leading-none tabular-nums text-ds-17 | invisible h-9 w-16
// @mutate src/pages/DashboardGuest.tsx | const FEED_GRID_CLASS = GUEST_FEED_GRID_CLASS; | const FEED_GRID_CLASS = "grid grid-cols-1 gap-3";
// @mutate src/components/profile/SecurityTab.tsx | useArrivalGate(!sessionsLoading, !factorLoading) | useArrivalGate(true, true)
// @mutate src/components/SaveHelperButton.tsx | variant === "icon" ? "h-10 w-10 shrink-0 " : "" | ""
// @mutate src/components/GuestBrowseSkeleton.tsx | 0.25rem) + var(--public-nav-h))" }} /> | 1.5rem) + 3rem)" }} />
// @mutate src/components/dashboard/VirtualizedJobList.tsx | initialRect: { width: 0, height: typeof window === "undefined" ? 800 : window.innerHeight }, |
// @mutate src/lib/simpleMode.ts | let profileSeniorMode = cachedProfileFlag(); | let profileSeniorMode = false;
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { useArrivalGate, ARRIVAL_CAP_MS } from "@/hooks/useArrivalGate";

const SRC = resolve(__dirname, "..");
const read = (rel: string) => blankComments(readFileSync(join(SRC, rel), "utf8"));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * An animation or transition delay computed from a list index: the staggered
 * entry that makes a list arrive one item at a time.
 */
const INDEX_DELAY = [
  /(animationDelay|transitionDelay)\s*:[^,}\n]*\b(i|idx|index)\b\s*\*/,
  /\bdelay\s*:\s*\(?\s*(i|idx|index)\b[^,}\n]*\*/,
  /\$\{[^}\n]*\b(i|idx|index)\s*\*[^}\n]*\}m?s\b/,
];

/**
 * Staggers that are NOT data arriving: exact, and two-way (each entry must
 * still match, or it is stale and must be removed).
 *   - HowItWorksSection: the landing page's three marketing steps, revealed on
 *     scroll. Static copy, never loaded data.
 *   - PayoutCelebration: confetti particles after a payout.
 */
const ALLOWED = ["components/landing/HowItWorksSection.tsx", "components/wallet/PayoutCelebration.tsx"];

describe("lists arrive in one wave (Q169)", () => {
  it("no component staggers items in on an index-derived delay", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(400);
    const hits = files
      .filter((f) => INDEX_DELAY.some((re) => re.test(blankComments(readFileSync(f, "utf8")))))
      .map((f) => relative(SRC, f))
      .sort();
    expect(hits).toEqual([...ALLOWED].sort());
  });

  it("JobCard has no entry animation of its own", () => {
    const card = read("components/dashboard/JobCard.tsx");
    expect(card).toMatch(/group relative h-full rounded-2xl/);
    expect(card).not.toMatch(/animate-fade-in|animate-in\b|animationDelay/);
  });

  it("the guest browse feed renders its skeleton off the arrival gate", () => {
    const page = read("pages/DashboardGuest.tsx");
    expect(page).toMatch(/const feedReady = useArrivalGate\(!isLoading, enrichmentSettled\)/);
    expect(page).toMatch(/\{!feedReady \? \(/);
    expect(page).not.toMatch(/\{isLoading \? \(/);
  });
});

describe("each measured page waits in ONE placeholder and lands once (Q169)", () => {
  it("post-job's entry column holds until its three data rows settle", () => {
    const src = read("pages/postjob/EntryChoice.tsx");
    expect(src).toMatch(/unpaidDrafts !== null && recentPosted !== null && form\.openJobCount !== null/);
    expect(src).toMatch(/if \(!entryReady\) return <EntryChoiceSkeleton \/>;/);
  });

  it("profile tabs wait in the tab's own chunk placeholder, not a second skeleton", () => {
    for (const f of [
      "components/NotificationPreferences.tsx",
      "components/ReferralSection.tsx",
      "components/profile/SavedHelpersTab.tsx",
      "components/profile/ScheduleTab.tsx",
    ]) {
      expect(read(f), f).toMatch(/<ProfileTabBodyReserve \/>/);
    }
    expect(read("components/NotificationPreferences.tsx")).toMatch(/if \(!loaded\) return <ProfileTabBodyReserve \/>;/);
  });

  it("the security tab waits for its sessions AND two-step reads, then lands once", () => {
    const src = read("components/profile/SecurityTab.tsx");
    expect(src).toMatch(/const securityReady = useArrivalGate\(!sessionsLoading, !factorLoading\);/);
    expect(src).toMatch(/\{!securityReady \? \(\s*<ProfileTabBodyReserve \/>/);
  });

  it("the virtualized feed renders rows on its FIRST pass (no empty panel between skeleton and cards)", () => {
    expect(read("components/dashboard/VirtualizedJobList.tsx")).toMatch(/initialRect: \{ width: 0, height: typeof window === "undefined" \? 800 : window\.innerHeight \}/);
  });

  it("the save-Helpr icon button is the same box while its status loads", () => {
    expect(read("components/SaveHelperButton.tsx")).toMatch(/variant === "icon" \? "h-10 w-10 shrink-0 " : ""/);
  });

  it("the earnings page and the reviews hero wait for everything above the fold", () => {
    expect(read("components/profile/EarningsTab.tsx")).toMatch(/view === "earnings" && !earningsReady && <EarningsPageSkeleton/);
    expect(read("components/profile/ReviewsTab.tsx")).toMatch(/\{!loading && reviewCount > 0 && avgRating != null && \(/);
  });

  it("the desktop dashboard loads in the loaded page's frame (no title card at desktop)", () => {
    const src = read("pages/Dashboard.tsx");
    expect(src.match(/titleCard=\{isWebDesktop \? undefined : /g)?.length).toBe(1);
    expect(src).toMatch(/data-testid="dashboard-desktop-loading"/);
  });

  it("the job card skeleton reserves the price chip's own box, not a fixed 36px bone", () => {
    const src = read("components/ui/skeletons/JobCardSkeleton.tsx");
    expect(src).toMatch(/invisible font-sans leading-none tabular-nums text-ds-17/);
    expect(src).not.toMatch(/h-9 w-16 shrink-0/);
  });

  it("/browse's chunk skeleton lays its bones on the page's own grid, under the page's own header", () => {
    const skel = read("components/GuestBrowseSkeleton.tsx");
    expect(skel).toMatch(/<PageHeader title="Browse Jobs"/);
    expect(skel).toMatch(/\$\{GUEST_FEED_GRID_CLASS\} \$\{GUEST_FEED_RESERVE_CLASS\}/);
    expect(read("pages/DashboardGuest.tsx")).toMatch(/const FEED_GRID_CLASS = GUEST_FEED_GRID_CLASS;/);
  });

  it("/browse's chunk skeleton restates the public shell's geometry VERBATIM (nav spacer, nav box, body gutter)", () => {
    // Q176 changed the spacer the same day this skeleton was written, and the
    // title moved 12px under the bones. These strings are compared, not
    // remembered, so the next change to the shell fails here.
    const skel = read("components/GuestBrowseSkeleton.tsx");
    const spacer = /style=\{\{ height: "(calc\([^"]+\))" \}\}/.exec(read("components/marketing/PublicLayout.tsx"))?.[1];
    expect(spacer).toBeTruthy();
    expect(skel).toContain(`height: "${spacer}"`);
    const navBox = /h-\[var\(--[a-z-]+\)\]/.exec(read("components/Navbar.tsx"))?.[0];
    expect(navBox).toBeTruthy();
    expect(skel).toContain(navBox!);
    const gutter = /className=\{`(px-5 [^$`]+) \$\{bottomPaddingClassName\}`\}/.exec(read("components/marketing/PublicHeaderPage.tsx"))?.[1];
    expect(gutter).toBeTruthy();
    expect(skel).toContain(`className="${gutter} pb-16"`);
  });
});

describe("Senior Mode from the ACCOUNT is on at first paint (Q169)", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("senior-mode");
    vi.resetModules();
  });

  it("a signed-in device that last saw the flag paints large from the start", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    localStorage.setItem("helpr_profile_senior_mode", "1");
    vi.resetModules();
    const m = await import("@/lib/simpleMode");
    m.initSimpleMode();
    expect(document.documentElement.classList.contains("senior-mode")).toBe(true);
    // Profile not loaded yet: the cached flag must survive the sync.
    m.syncSeniorMode({ profileSenior: null, osLargeText: false });
    expect(document.documentElement.classList.contains("senior-mode")).toBe(true);
    // The live profile corrects it.
    m.syncSeniorMode({ profileSenior: false, osLargeText: false });
    expect(document.documentElement.classList.contains("senior-mode")).toBe(false);
  });

  it("a signed-out visitor never inherits the cached flag", async () => {
    localStorage.setItem("helpr_profile_senior_mode", "1");
    vi.resetModules();
    const m = await import("@/lib/simpleMode");
    m.initSimpleMode();
    expect(document.documentElement.classList.contains("senior-mode")).toBe(false);
  });
});

describe("useArrivalGate", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for the primary data", () => {
    const { result } = renderHook(() => useArrivalGate(false, true));
    expect(result.current).toBe(false);
  });

  it("holds while the secondary data is pending, then opens at the cap", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useArrivalGate(true, false));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(ARRIVAL_CAP_MS - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it("opens at once when both are in", () => {
    const { result } = renderHook(() => useArrivalGate(true, true));
    expect(result.current).toBe(true);
  });

  it("latches: a later refetch never brings the skeleton back", () => {
    const { result, rerender } = renderHook(({ p, s }) => useArrivalGate(p, s), { initialProps: { p: true, s: true } });
    expect(result.current).toBe(true);
    rerender({ p: false, s: false });
    expect(result.current).toBe(true);
  });

  it("the cap is short enough that a hung call cannot strand the page", () => {
    expect(ARRIVAL_CAP_MS).toBeGreaterThan(0);
    expect(ARRIVAL_CAP_MS).toBeLessThanOrEqual(2000);
  });
});
