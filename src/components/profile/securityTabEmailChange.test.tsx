/**
 * AUD31-70 (Account leftovers, Low). Change email accepted the address already on the account and toasted "Check
 * <same address> to confirm your new address."; after a real change only that toast said so, and once it went the row
 * kept the old address with nothing saying a change was waiting; the button read "Confirm Change" (Title Case).
 * Now: the same address (any case) is refused under the field ("That's already your email.") and nothing is sent;
 * the row says "Waiting for you to confirm <new address>." from the moment of the send, and on a later visit from
 * Supabase's own `new_email` on the auth user (the tab's one auth read, no second round trip); "Confirm change".
 *
 * @mutate src/components/profile/SecurityTab.tsx |     if (email && trimmed.toLowerCase() === email.trim().toLowerCase()) { |     if (email && trimmed === "never-the-same") {
 * @mutate src/components/profile/SecurityTab.tsx |     setSentTo(trimmed);\n |
 * @mutate src/components/profile/EmailChangeWaiting.tsx |     select: (u) => u.new_email ?? null, |     select: () => null,
 * @mutate src/components/profile/SecurityTab.tsx | {submitting ? "Sending…" : "Confirm change"} | {submitting ? "Sending…" : "Confirm Change"}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SecurityTab } from "./SecurityTab";

const USER: Record<string, unknown> & { factors: { id: string; factor_type: string; status: string; friendly_name: string }[]; identities: unknown[] } = {
  id: "user-1",
  email: "helper@example.com",
  factors: [{ id: "f-1", factor_type: "totp", status: "verified", friendly_name: "Phone" }],
  identities: [{ id: "i-1", identity_id: "i-1", provider: "email", user_id: "user-1" }],
};

/** One entry per auth/v1/user round trip the tab started. */
let userReads = 0;
const getUser = vi.fn(async () => {
  userReads++;
  await new Promise((r) => setTimeout(r, 5));
  return { data: { user: USER }, error: null };
});
const updateUser = vi.fn(async (_attrs: { email: string }, _opts?: unknown) => ({ error: null }));

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: [{ id: "s-1", created_at: new Date().toISOString(), ip_address: "10.0.0.1", user_agent: "Mozilla/5.0 (iPhone)" }],
            error: null,
          }),
        }),
      }),
    }),
    auth: {
      // As auth-js 2.117.2: both wrappers are a network getUser() each.
      getUser: () => getUser(),
      getUserIdentities: async () => {
        const { data, error } = await getUser();
        return error ? { data: null, error } : { data: { identities: data.user.identities }, error: null };
      },
      updateUser: (attrs: { email: string }, opts?: unknown) => updateUser(attrs, opts),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      unlinkIdentity: vi.fn(async () => ({ error: null })),
      mfa: {
        listFactors: async () => {
          const { data, error } = await getUser();
          if (error) return { data: null, error };
          const totp = data.user.factors.filter((f) => f.status === "verified");
          return { data: { all: data.user.factors, totp, phone: [], webauthn: [] }, error: null };
        },
        enroll: vi.fn(async () => ({ data: null, error: null })),
        unenroll: vi.fn(async () => ({ error: null })),
        challengeAndVerify: vi.fn(async () => ({ error: null })),
      },
    },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));

vi.mock("@/lib/biometricGate", () => ({ requireBiometric: vi.fn(async () => true) }));
vi.mock("@/lib/appLock", () => ({
  isAppLockSupported: () => true,
  isAppLockEnabled: () => false,
  setAppLockEnabled: vi.fn(),
  getAppLockGraceMs: () => 60_000,
  setAppLockGraceMs: vi.fn(),
  APP_LOCK_GRACE_OPTIONS: [{ ms: 0, label: "Immediately" }],
}));
vi.mock("@/lib/authSignOut", () => ({ signOutWithPushCleanup: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/authRedirects", () => ({
  getPublicResetPasswordUrl: () => "https://louisianahelpr.com/reset",
  getPublicSiteUrl: () => "https://louisianahelpr.com",
}));
vi.mock("@/lib/toastPolicy", () => ({ confirmConsequential: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticHeavy: vi.fn(),
  hapticSuccess: vi.fn(), hapticWarning: vi.fn(), hapticError: vi.fn(),
}));


beforeEach(() => {
  userReads = 0;
  getUser.mockClear();
  updateUser.mockClear();
  delete USER.new_email;
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <SecurityTab email="helper@example.com" onBack={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function typeAndConfirm(address: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Change email address" }));
  fireEvent.change(await screen.findByLabelText("New email address"), { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
}

describe("change email: the same address is refused, a waiting change is said on the row (AUD31-70)", () => {
  it("refuses the address already on the account (any case), under the field, and sends nothing", async () => {
    renderTab();
    await typeAndConfirm("  Helper@Example.com ");
    expect(await screen.findByText("That's already your email.")).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("after a send the row says the change is waiting for the new address", async () => {
    renderTab();
    await screen.findByRole("heading", { name: "Email address" });
    expect(document.querySelector("[data-email-waiting]")).toBeNull();
    await typeAndConfirm("new@example.com");
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Waiting for you to confirm new@example.com.")).toBeTruthy();
    expect(screen.getByText("helper@example.com")).toBeTruthy();
  });

  it("a change still waiting from before (Supabase's new_email) is said on the row, from the tab's one auth read", async () => {
    USER.new_email = "later@example.com";
    renderTab();
    expect(await screen.findByText("Waiting for you to confirm later@example.com.")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(userReads).toBe(1);
  });
});
