/**
 * A banned user can delete their account from inside the app.
 *
 * AL-004. Apple requires in-app account deletion (App Store Review Guideline
 * 5.1.1(v)) and App Review may exercise the path. A banned user could not:
 * `ProtectedRoute` runs its ban gate BEFORE the `allowUnapproved` branch, so
 * /profile — the only screen carrying the delete control — redirected them
 * straight back to /account-banned, and /data-rights redirects into the same
 * gate. That screen offered Support, Rules and Sign Out and nothing else, so
 * their only route to deletion was emailing a human.
 *
 * The API half pointed the other way: `delete-own-account` never read
 * `ban_status`, so it worked fine for exactly the user the UI blocked.
 *
 * This pins the two things that fix has to keep true:
 *   1. /account-banned offers deletion, and completing it calls the same
 *      edge function with the same confirmation phrase Profile sends.
 *   2. The dialog TELLS a banned user the ban survives. The retention
 *      (20260903014600) is invisible from the UI, and a suspended user
 *      pressing "Delete Forever" believing it clears their suspension is the
 *      exact trust defect RetentionSummary was written to prevent.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.fn();
const signOut = vi.fn().mockResolvedValue(undefined);
const currentUser = {
  user: { id: "u1", email: "banned@example.com" },
  profile: { ban_status: "temp_banned", auto_suspended_until: null as string | null },
  isLoading: false,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // AuthShell renders the marketing Navbar, which mounts useAuthReady.
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: () => signOut() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => currentUser }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AccountBanned from "@/pages/AccountBanned";

beforeAll(() => {
  // jsdom lacks a few pointer APIs Radix dialogs touch.
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { success: true }, error: null });
  signOut.mockClear();
  currentUser.profile = { ban_status: "temp_banned", auto_suspended_until: null };
});

const renderScreen = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/account-banned"]}>
        <AccountBanned />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("/account-banned — in-app account deletion", () => {
  it("offers deletion, and it is not the promoted action", async () => {
    renderScreen();

    const del = await screen.findByRole("button", { name: /delete account/i });
    expect(del).toBeInTheDocument();

    // The appeal is the route back in, so it keeps the filled treatment and
    // Delete stays subordinate. A ban screen whose loudest control is
    // "delete everything" pushes people past the one thing that helps them.
    const appeal = screen.getByRole("link", { name: /contact support/i });
    expect(appeal).toBeInTheDocument();
  });

  it("tells the user the ban survives the deletion — a suspension, by name", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));

    // Under "Kept, without your name", beside the payment records and the
    // reviews they wrote.
    expect(
      await screen.findByText(/this suspension .* applies again if you sign up with this email/i),
    ).toBeInTheDocument();
  });

  it("says 'ban', not 'suspension', when the ban is permanent", async () => {
    currentUser.profile = { ban_status: "permanently_banned", auto_suspended_until: null };
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));

    expect(
      await screen.findByText(/this ban .* applies again if you sign up with this email/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/before it ends/i)).not.toBeInTheDocument();
  });

  it("completes: two steps, the confirmation phrase, then the edge function and a sign-out", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^continue$/i }));

    const input = await screen.findByLabelText(/type delete to confirm account deletion/i);
    const confirm = screen.getByRole("button", { name: /delete forever/i });

    // Guarded until the phrase matches exactly — the same gate Profile has.
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "delete" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: "DELETE" } });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    // The server contract is unchanged: the dialog's short phrase maps to the
    // long one the edge function has always validated. If these ever drift,
    // deletion returns 400 "Invalid confirmation" for every user.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete-own-account", {
        body: { confirmation: "DELETE MY ACCOUNT" },
      }),
    );
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("does not sign the user out when the server refuses", async () => {
    // The real 409: active job or escrow still in flight. The account still
    // exists, so dropping the session would strand them at /login with no
    // explanation for why nothing happened.
    invoke.mockResolvedValue({ data: null, error: new Error("non-2xx") });

    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^continue$/i }));
    fireEvent.change(await screen.findByLabelText(/type delete to confirm/i), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete forever/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());

    // THE property that matters: the account still exists, so the session must
    // survive. Signing them out on a refusal would drop a banned user at
    // /login with no explanation for why nothing happened — and /account-banned
    // is the only screen that would have told them.
    expect(signOut).not.toHaveBeenCalled();

    // The refusal reaches the user. Step 2 is `role="alertdialog"`, so the
    // shared Close wrapper dismisses it on commit (43 confirms rely on that),
    // which means the toast is the ONLY carrier for "you still have escrow
    // in flight" — hence `functionErrorMessage` rather than the SDK's
    // "non-2xx".
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    // And the flow is re-openable rather than wedged.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /delete account/i })).toBeEnabled(),
    );
  });
});
