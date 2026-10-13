/**
 * THE SECURITY TAB COSTS ONE AUTH `/user` ROUND TRIP (docs/OPEN.md Q1648).
 *
 * e2e-journeys 37996630522 (iphone-webkit slow-heavy, settings-signout): Active
 * sessions and Sign-in methods were still skeletons when the 15 s health check
 * gave up ("3 skeleton bones": Sign-in methods' three rows). The trace's network
 * log: auth/v1/user and login_history both start at 22:04:51.35, login_history
 * answers in 7931 ms, auth/v1/user in 8042 ms, and a SECOND auth/v1/user starts
 * at 22:04:59.40, 8 ms after the first answered, still pending at 22:05:06.77.
 *
 * Why it was serial, read in @supabase/auth-js 2.117.2 (the locked version):
 * `mfa.listFactors()` (`_listFactors`) and `getUserIdentities()` each await
 * their own `getUser()`, a network GET of auth/v1/user. auth-js does NOT queue
 * them (no `lock` option is set, so `getUser` skips `_acquireLock`); the
 * queueing was ours. The tab's first paint waits on the factor read
 * (useArrivalGate, Q169), and SignInMethodsCard mounts only after that gate, so
 * its identity read could start only once the first round trip had answered.
 *
 * Fix: both cards read one query (securityAuthUser.ts, SECURITY_AUTH_USER_KEY)
 * and derive the factor and identity lists from the one User, so the gate that
 * waits for it covers both cards.
 *
 * CLASS: render the REAL tab with every card it mounts, where each auth wrapper
 * behaves as auth-js does (listFactors and getUserIdentities call getUser), and
 * count the `/user` round trips the tab costs from mount to fully painted:
 * exactly one. A card added later that starts its own auth read after the gate
 * makes it two, and fails here.
 *
 * @mutate src/components/profile/SignInMethodsCard.tsx | queryKey: SECURITY_AUTH_USER_KEY, | queryKey: ["security", "identities"],
 * @mutate src/components/profile/TwoFactorCard.tsx | queryKey: SECURITY_AUTH_USER_KEY, | queryKey: ["security", "mfa-factor"],
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SecurityTab } from "./SecurityTab";

const USER = {
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
      updateUser: vi.fn(async () => ({ error: null })),
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
});

describe("the Security tab costs one auth /user round trip (Q1648)", () => {
  it("mount to fully painted: every card is drawn, nothing is loading, and /user was read once", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <SecurityTab email="helper@example.com" onBack={() => {}} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // The cards the tab mounts behind its gate, each with data from the one read.
    await screen.findByRole("heading", { name: "Sign-in methods" });
    await waitFor(() => expect(container.querySelectorAll(".animate-pulse, [data-skeleton]").length).toBe(0));
    // Inventory floor: the real tab, every card painted (not a placeholder).
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(expect.arrayContaining(["Email address", "Sign-in methods", "Active sessions"]));
    expect(headings.length).toBeGreaterThan(4);
    // Two-step reads the verified factor from the same User (an "On" state, not "Turn on").
    expect(screen.getByRole("button", { name: /turn off/i })).toBeTruthy();
    // Let anything a late-mounting card would start get going, then count.
    await new Promise((r) => setTimeout(r, 50));
    expect(userReads, "auth/v1/user round trips the tab started").toBe(1);
  });
});
