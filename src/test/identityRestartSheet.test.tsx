/**
 * Owner report 2026-10-21: on /post-job the ID sheet said "Your ID check is
 * with our team… within 24 hours" and never offered a way to verify. A check
 * "with our team" (idv_status manual_review) now always offers a FRESH Stripe
 * check; once it has waited over 48 h with no admin decision the fresh check
 * LEADS (the primary action), and under 48 h "with our team" leads and the
 * fresh check is second. When the server refuses the restart (Stripe still on
 * it, a person must finish it, or a fourth attempt), the sheet stops offering
 * it; an admin's rejection shows the "couldn't verify" state.
 *
 * The SERVER decides whether a restart may start (stripe-idv-start +
 * claim_idv_attempt: src/test/edge/stripe-idv-start.test.ts and
 * src/test/pglite/idvRestartAfterManualReview.pglite.mjs). This file proves
 * the sheet never leaves a member in manual_review without the button.
 *
 * @mutate src/components/identity/IdentityCheckSheet.tsx |   const canRestart = view === "with_team" && !restartOff; |   const canRestart = false;
 * @mutate src/lib/identityCheck.ts |   return Number.isFinite(t) && now - t > IDENTITY_REVIEW_STALE_MS; |   return false;
 * @mutate src/components/identity/IdentityCheckSheet.tsx |           setRestartOff(true);\n | \n
 * @mutate src/components/identity/IdentityPromptCard.tsx |     cta: "See options", |     cta: null,
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 60 * 60 * 1000;
const state = {
  profile: { idv_status: "manual_review" as string | null, updated_at: new Date().toISOString() as string | null },
  since: null as string | null,
  invoke: vi.fn(),
  opened: [] as string[],
};

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: state.since ? { changed_at: state.since } : null, error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      functions: { invoke: (...a: unknown[]) => state.invoke(...a) },
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    },
  };
});
// A stable refresh and user, as the real hook's are (useCallback / state).
const stable = { user: { id: "u1" }, refresh: async () => {} };
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: stable.user, profile: state.profile, refresh: stable.refresh }),
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn(async (url: string) => { state.opened.push(url); }) }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));

import { IdentityCheckHost } from "@/components/identity/IdentityCheckSheet";
import { IdentityPromptCard } from "@/components/identity/IdentityPromptCard";
import { closeIdentityCheck, identityReviewIsStale, openIdentityCheck, IDENTITY_REVIEW_STALE_MS } from "@/lib/identityCheck";

/** The commit (SheetPrimaryAction, variant "primary") wears the solid olive; the secondary is a tint. */
const isPrimary = (el: HTMLElement) => el.className.split(/\s+/).includes("btn-grad-primary");

async function openSheet() {
  render(
    <MemoryRouter initialEntries={["/post-job"]}>
      <IdentityCheckHost />
    </MemoryRouter>,
  );
  await act(async () => { openIdentityCheck("post"); });
  // Let the review-since read settle.
  await act(async () => { await Promise.resolve(); });
}

/** A functions.invoke error whose body the sheet reads (functionErrorBody reads context Response). */
function fnError(status: number, body: Record<string, unknown>) {
  const err = new Error("Edge Function returned a non-2xx status code") as Error & { context: Response };
  err.context = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  return { data: null, error: err };
}

describe("the stale rule", () => {
  it("is over 48 hours since the current manual review began, and nothing else", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(IDENTITY_REVIEW_STALE_MS).toBe(48 * HOUR);
    expect(identityReviewIsStale(new Date(now - 49 * HOUR).toISOString(), now)).toBe(true);
    expect(identityReviewIsStale(new Date(now - 47 * HOUR).toISOString(), now)).toBe(false);
    expect(identityReviewIsStale(null, now)).toBe(false);
    expect(identityReviewIsStale("not a date", now)).toBe(false);
  });
});

describe("the ID sheet in manual review always offers a fresh Stripe check (owner report 2026-10-21)", () => {
  beforeEach(() => {
    closeIdentityCheck();
    state.profile = { idv_status: "manual_review", updated_at: new Date().toISOString() };
    state.since = null;
    state.opened = [];
    state.invoke = vi.fn(async () => ({ data: { url: "https://verify.stripe.com/fresh" }, error: null }));
  });

  it("under 48 h: 'with our team' leads, Got it is primary, the fresh check is second", async () => {
    state.since = new Date(Date.now() - 2 * HOUR).toISOString();
    await openSheet();
    const sheet = screen.getByTestId("identity-check-sheet");
    expect(sheet.getAttribute("data-view")).toBe("with_team");
    expect(screen.getByText("Your ID check is with our team")).toBeTruthy();
    const restart = screen.getByTestId("identity-check-restart");
    expect(restart.textContent).toMatch(/Try again with Stripe/);
    expect(isPrimary(restart)).toBe(false);
    const got = screen.getByTestId("identity-check-primary");
    expect(got.textContent).toBe("Got it");
    expect(isPrimary(got)).toBe(true);
  });

  it("over 48 h with no decision: the fresh check LEADS (primary), Not now is second", async () => {
    state.since = new Date(Date.now() - 49 * HOUR).toISOString();
    await openSheet();
    expect(screen.getByText("Try your ID check again")).toBeTruthy();
    const restart = screen.getByTestId("identity-check-restart");
    expect(isPrimary(restart)).toBe(true);
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
    expect(screen.queryByText("Got it")).toBeNull();
  });

  it("no history row: the profile's updated_at dates it (the caveat: it can only look newer)", async () => {
    state.since = null;
    state.profile = { idv_status: "manual_review", updated_at: new Date(Date.now() - 72 * HOUR).toISOString() };
    await openSheet();
    expect(isPrimary(screen.getByTestId("identity-check-restart"))).toBe(true);
  });

  it("pressing it starts the check with stripe-idv-start and goes to Stripe", async () => {
    await openSheet();
    await act(async () => { fireEvent.click(screen.getByTestId("identity-check-restart")); });
    expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(state.invoke.mock.calls[0][0]).toBe("stripe-idv-start");
    expect(state.opened).toEqual(["https://verify.stripe.com/fresh"]);
  });

  it("the server refuses the restart: the sheet stops offering it and says a person will finish it", async () => {
    state.invoke = vi.fn(async () => fnError(429, { error: "with our team", inManualReview: true }));
    await openSheet();
    await act(async () => { fireEvent.click(screen.getByTestId("identity-check-restart")); });
    expect(screen.queryByTestId("identity-check-restart")).toBeNull();
    expect(screen.getByText(/A person on our team needs to finish this one/)).toBeTruthy();
    expect(state.opened).toEqual([]);
  });

  it("an admin's rejection stands: the sheet shows 'couldn't verify', never a fresh check", async () => {
    state.invoke = vi.fn(async () => fnError(403, { error: "rejected", rejected: true }));
    await openSheet();
    await act(async () => { fireEvent.click(screen.getByTestId("identity-check-restart")); });
    expect(screen.getByTestId("identity-check-sheet").getAttribute("data-view")).toBe("failed");
    expect(screen.queryByTestId("identity-check-restart")).toBeNull();
  });

  it("a failed (rejected) profile never shows the restart", async () => {
    state.profile = { idv_status: "failed", updated_at: null };
    await openSheet();
    expect(screen.queryByTestId("identity-check-restart")).toBeNull();
  });

  it("the prompt card in manual review is not a dead end: it opens the sheet", () => {
    render(<IdentityPromptCard idvStatus="manual_review" />);
    expect(screen.getByRole("button", { name: "See options" })).toBeTruthy();
  });
});
