// A 4-SECOND AUTO-HEAL THAT WORKS MUST NOT BE MARKED FAIL.
//
// press-every-control (#1582) failed /jobs/:id and /user/:id with "error
// boundary / error copy rendered on load". The card was real — ProtectedRoute's
// "We couldn't load your account." — but the harness classified the boot
// snapshot at t≈0, while ProtectedRoute's auto-heal does not fire its first
// retry until 4000ms. A stall that healed perfectly at 4s was still a hard FAIL:
// a false red by construction, unfixable by the app.
//
// Two halves have to hold together, so this guard pins both:
//   1. APP: the error card states machine-readably that it is retrying
//      (`data-auth-retrying="true"`), so a harness can tell "healing" from "dead".
//   2. HARNESS: it waits for that signal to clear before classifying — and
//      still FAILS a route whose card is up when the bound expires. Waiting
//      alone would be "lengthen a timeout", which hides a real stall too.
//
// @mutate src/components/ProtectedRoute.tsx | data-auth-retrying="true" aria-busy="true" | data-not-retrying="true"
// @mutate scripts/audit/pressLoadHealth.mjs | if (healing && !healed) { | if (false) {
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { SELF_HEAL_SEL, awaitSelfHeal, classifyBoot, summarizeTimings } from "../../scripts/audit/pressLoadHealth.mjs";

const useCurrentUserMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => useCurrentUserMock() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { ForcedLogoutBounce: "forced_logout_bounce" } }));

import ProtectedRoute from "@/components/ProtectedRoute";

const ERROR_RX = /couldn't load your account|something went wrong/i;

/** Minimal Playwright-page stand-in: the signal disappears after `clearAfter` polls. */
const fakePage = ({ present, clearAfter = 0 }: { present: boolean; clearAfter?: number }) => {
  let polls = 0;
  return {
    locator: () => ({ count: async () => (present ? 1 : 0) }),
    waitForFunction: async () => {
      // Emulates Playwright's polling: resolves when the node is gone, else rejects on timeout.
      for (let i = 0; i < 50; i++) if (++polls >= clearAfter && clearAfter > 0) return true;
      throw new Error("Timeout 25000ms exceeded");
    },
  };
};

describe("the press harness honours ProtectedRoute's auto-heal", () => {
  it("renders the retrying signal on the recoverable profile-error card", () => {
    useCurrentUserMock.mockReturnValue({
      user: { id: "u1", email_confirmed_at: "2026-08-01T00:00:00Z" },
      profile: null,
      isLoading: false,
      isError: true,
      refresh: vi.fn().mockResolvedValue(undefined),
    });
    const { container } = render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>,
    );
    // The card is up…
    expect(screen.getByText(/couldn't load your account/i)).toBeInTheDocument();
    // …and it says so: the exact selector pressLoadHealth.mjs queries.
    expect(container.querySelector(SELF_HEAL_SEL), `the error card must carry ${SELF_HEAL_SEL} or every harness reads a heal as a dead route`).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("a healed route is a PASS, not a fail", async () => {
    const heal = await awaitSelfHeal(fakePage({ present: true, clearAfter: 3 }), { timeout: 25_000 });
    expect(heal).toMatchObject({ healing: true, healed: true });
    // Snapshot taken AFTER the heal: the error copy is gone.
    const v = classifyBoot({ text: "Browse Jobs 8 jobs near you", errorRx: ERROR_RX, heal });
    expect(v.fail, "a route that recovered must not be failed").toBe(false);
    expect(v.note).toMatch(/resolved/);
  });

  it("a route still broken when the bound expires is a FAIL", async () => {
    const heal = await awaitSelfHeal(fakePage({ present: true, clearAfter: 0 }), { timeout: 25_000 });
    expect(heal).toMatchObject({ healing: true, healed: false });
    const v = classifyBoot({ text: "We couldn't load your account. Tap Try again.", errorRx: ERROR_RX, heal });
    expect(v.fail, "a card still up after the heal's bound is a real red").toBe(true);
    expect(v.why).toMatch(/did not recover/);
  });

  it("an error screen with no retrying signal fails immediately, with no wait", async () => {
    const heal = await awaitSelfHeal(fakePage({ present: false }));
    expect(heal).toEqual({ healing: false, healed: true, waitedMs: 0 });
    const v = classifyBoot({ text: "Something went wrong.", errorRx: ERROR_RX, heal });
    expect(v.fail).toBe(true);
    expect(v.why).toBe("error boundary / error copy rendered on load");
  });

  it("records per-request timings so the fan-out hypothesis is measurable", () => {
    const s = summarizeTimings([
      { ms: 100, url: "/rest/v1/profiles", method: "GET" },
      { ms: 2400, url: "/rest/v1/jobs", method: "GET" },
      { ms: 30, url: "/assets/app.js", method: "GET" },
      { ms: 50, url: "/rest/v1/reviews", method: "GET", failed: true },
    ]);
    expect(s.requests).toBe(4);
    expect(s.apiRequests, "Supabase calls must be counted apart from static assets").toBe(3);
    expect(s.maxMs).toBe(2400);
    expect(s.failed).toBe(1);
    expect(s.slowest[0]).toContain("2400ms GET /rest/v1/jobs");
  });
});
