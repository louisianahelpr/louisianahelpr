/**
 * C11 (flow audit 11-23, BLOCKS USERS) and the owner's answer (2026-11-24, ~1:35 AM): "Remove what brings you here
 * entirely."
 *
 * Home froze when the re-agree-to-Terms dialog and the full-screen "What brings you here?" first run opened together.
 * The dialog is a modal Radix Dialog (Radix sets `pointer-events: none` on <body>); the first run was a plain fixed
 * layer at z-[70] that painted over it, inherited `pointer-events: none` and covered "I agree", so every tap fell
 * through to the hidden dialog's backdrop. Prod read 11-24: 4 real accounts (terms_version_accepted = '', no tour
 * stamp) froze on their next log-in.
 *
 * Now: the first run is gone, and so is new-member Home's inline welcome card of the same title (owner ~1:50 AM,
 * "remove both"), so a new account just lands on Home, and the only thing left that draws a full-screen
 * layer on Home by itself, Help's "Take the tour again" replay (src/components/tour/TourReplayHost.tsx), never opens
 * by itself and waits while a Radix modal holds the body. Rendered the way /home has them: the real
 * TermsReconsentMount (App.tsx) beside the real TourReplayHost (HomeDashboard.tsx).
 *
 * @mutate src/components/tour/ShortTour.tsx |   if (paused) return null; |
 * @mutate src/components/tour/TourReplayHost.tsx |       <ShortTour key={replays} paused={modalOpen} | <ShortTour key={replays} paused={false}
 * @mutate src/components/tour/TourReplayHost.tsx |   return [...document.querySelectorAll('[data-state="open"][role]')].some((el) => /^(alert)?dialog$/.test(el.getAttribute("role") ?? "")); |   return true;
 * @mutate src/components/tour/TourReplayHost.tsx |   const [open, setOpen] = useState(false); |   const [open, setOpen] = useState(true);
 * @mutate src/lib/i18n/enNewMember.ts |   "home.gs.title": "Get started", |   "firstRun.title": "What brings you here?",\n  "home.gs.title": "Get started",
 * @mutate src/pages/home/homeDashboard/NewMemberHome.tsx |       {guide}\n |       <h2>What brings you here?</h2>\n      {guide}\n
 * @mutate scripts/lib/analyticsFreshness.mjs |   post_job_guest_signup: |   first_run_intent: "x",\n  post_job_guest_signup:
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useSyncExternalStore } from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

// ---- the signed-in member: re-consent required (accepted '' like the 4 prod accounts read on 2026-11-24) ----
const member = { accepted: "", version: 0, watchers: new Set<() => void>() };
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => {
    useSyncExternalStore(
      (fn) => { member.watchers.add(fn); return () => member.watchers.delete(fn); },
      () => member.version,
    );
    return {
      user: { id: "u-c11", email_confirmed_at: "2026-09-01T00:00:00Z" },
      profile: { ban_status: "active", terms_version_accepted: member.accepted },
      isLoading: false,
      refresh: async () => {
        member.version += 1;
        for (const w of member.watchers) w();
      },
    };
  },
}));
const updates: Record<string, unknown>[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const build = () => {
    const b: Record<string, unknown> = {};
    let pending: Record<string, unknown> | null = null;
    for (const m of ["select", "eq"]) b[m] = () => b;
    b.update = (row: Record<string, unknown>) => { pending = row; return b; };
    b.maybeSingle = async () => ({ data: { terms_version_accepted: member.accepted }, error: null });
    b.insert = async () => ({ error: null });
    b.then = (res: (v: unknown) => void) => {
      if (pending) {
        updates.push(pending);
        member.accepted = String(pending.terms_version_accepted);
      }
      res({ data: pending ? [{ user_id: "u-c11" }] : [], error: null });
    };
    return b;
  };
  return { supabase: { from: () => build() } };
});
vi.mock("@/components/mobileNav/useSectionTabs", () => ({ useSectionTabs: () => [{ path: "/jobs", on: true }, { path: "/declutter", on: true }] }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { TermsReconsentMount } from "@/components/TermsReconsentMount";
import { TourReplayHost } from "@/components/tour/TourReplayHost";
import { LATEST_TERMS_VERSION } from "@/lib/consent";

const ROOT = resolve(__dirname, "../..");
const TITLE = /Please take a moment to re-agree/;
/** Any full-screen layer Home could draw by itself: the old picker or tour, or the tour today. */
const OVERLAY = '[data-first-run], [data-tour="coach"]';

/** What a tap on `el` meets: the nearest explicit pointer-events on it or an ancestor (Radix writes body's inline). */
function effectivePointerEvents(el: Element | null): string {
  for (let n = el as HTMLElement | null; n; n = n.parentElement) {
    const pe = n.style?.pointerEvents || getComputedStyle(n).pointerEvents;
    if (pe === "auto") return "auto";
    if (pe) return pe;
  }
  return "auto";
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 700)); });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
function renderHome(entry = "/home") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<><TermsReconsentMount /><TourReplayHost userId="u-c11" /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  member.accepted = "";
  updates.length = 0;
});
afterEach(() => {
  cleanup();
  document.body.removeAttribute("style");
});

describe("/home with Terms re-consent required (C11)", () => {
  it("shows only the Terms dialog, I agree takes the tap, and no first-run layer ever mounts", async () => {
    renderHome();
    const agree = await screen.findByRole("button", { name: "I agree" });
    expect(screen.getByText(TITLE)).toBeTruthy();
    // Past the old first run's 600 ms delay: nothing else drew over the dialog.
    await settle();
    expect(document.querySelector(OVERLAY)).toBeNull();
    expect(document.body.style.pointerEvents).toBe("none"); // Radix's modal lock, the reason a second layer froze
    expect(effectivePointerEvents(agree)).toBe("auto");
    expect(agree.closest('[aria-hidden="true"]')).toBeNull();

    const sheetGone = waitForElementToBeRemoved(() => screen.queryByText(TITLE)); // armed while the sheet is up
    fireEvent.click(agree);
    await sheetGone;
    expect(updates.length).toBe(1);
    expect(updates[0].terms_version_accepted).toBe(LATEST_TERMS_VERSION);
    // After I agree: a plain Home, still nothing full screen.
    await settle();
    expect(document.querySelector(OVERLAY)).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });

  it("a brand-new member who is current on the Terms just lands on Home: nothing opens by itself", async () => {
    member.accepted = LATEST_TERMS_VERSION;
    renderHome();
    await settle();
    expect(document.querySelector(OVERLAY)).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("Help's tour replay waits while the Terms dialog holds the body, then opens and takes taps", async () => {
    renderHome("/home?tour=1");
    const agree = await screen.findByRole("button", { name: "I agree" });
    await settle();
    expect(document.querySelector(OVERLAY), "tour drawn over an open Radix modal").toBeNull();
    const sheetGone = waitForElementToBeRemoved(() => screen.queryByText(TITLE));
    fireEvent.click(agree);
    await sheetGone;
    const tour = await waitFor(() => {
      const el = document.querySelector('[data-tour="coach"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const next = screen.getByRole("button", { name: "Next" });
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(effectivePointerEvents(tour)).toBe("auto");
    expect(effectivePointerEvents(next)).toBe("auto");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(document.querySelector('[data-tour="coach"]')).toBeNull(); // Skip closes it at once
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });
});

describe("Help's tour replay and a lock Radix left behind", () => {
  it("a body lock with no open dialog does not hold the tour back", async () => {
    member.accepted = LATEST_TERMS_VERSION;
    document.body.style.pointerEvents = "none"; // left by a dialog that closed during a route change
    renderHome("/home?tour=1");
    await waitFor(() => expect(document.querySelector('[data-tour="coach"]')).not.toBeNull());
  });
});

describe('"What brings you here?" is gone from the source (owner 2026-11-24)', () => {
  it("no first-run component, gate, picks writer, strings or analytics event is left", () => {
    expect(existsSync(resolve(ROOT, "src/components/firstRun"))).toBe(false);
    expect(existsSync(resolve(ROOT, "src/lib/onboardingTourCompletion.ts"))).toBe(false);
    const app = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/") && !/\.test\.tsx?$/.test(f));
    expect(app.length).toBeGreaterThan(500);
    const offenders = app.filter((f) => existsSync(resolve(ROOT, f)) && /\bFirstRun\w*|data-first-run|"firstRun\.|first_run_intent/.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(offenders).toEqual([]);
    // Owner 11-24 "remove both": the inline welcome card of the same title too. Not in any app file, comments included.
    expect(existsSync(resolve(ROOT, "src/pages/home/homeDashboard/WelcomeCard.tsx"))).toBe(false);
    const titled = app.filter((f) => existsSync(resolve(ROOT, f)) && /What brings you|"home\.wc\.|WelcomeCard/.test(readFileSync(resolve(ROOT, f), "utf8")));
    expect(titled).toEqual([]);
    expect(blankComments(readFileSync(resolve(ROOT, "scripts/lib/analyticsFreshness.mjs"), "utf8"))).not.toContain("first_run_intent");
    // Home mounts only Help's replay, and that host has no way to open by itself.
    const home = blankComments(readFileSync(resolve(ROOT, "src/pages/home/HomeDashboard.tsx"), "utf8"));
    expect(home).toContain("<TourReplayHost userId={user?.id} onActiveChange={setTourActive} />");
    const host = blankComments(readFileSync(resolve(ROOT, "src/components/tour/TourReplayHost.tsx"), "utf8"));
    expect(host).toContain('const replayAsked = params.get("tour") === "1";');
    expect(host.match(/setOpen\(true\)/g)?.length).toBe(1);
  });
});
