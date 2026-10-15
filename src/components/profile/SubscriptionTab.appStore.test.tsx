// @mutate src/components/profile/SubscriptionTab.tsx | if (profile?.subscription_source === "apple") { | if (false) {
// @mutate src/components/profile/SubscriptionTab.tsx | to="/legal?tab=terms" | to="/legal"
// @mutate src/components/profile/SubscriptionTab.tsx | to="/legal?tab=privacy" | to="/legal"
// @mutate src/lib/appleSubscriptions.ts | "https://apps.apple.com/account/subscriptions" | "https://www.louisianahelpr.com/profile"
// @mutate fastlane/metadata/en-US/description.txt | Terms of Use: https://www.louisianahelpr.com/terms | Terms: see the app
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@/integrations/supabase/types";
import { FunctionsClient } from "@supabase/functions-js";
import { SubscriptionTab } from "./SubscriptionTab";
import { APPLE_SUBSCRIPTIONS_URL } from "@/lib/appleSubscriptions";

/**
 * GUARDS (docs/OPEN.md Q1795, Q1797; lh-compliance-store review of the
 * submitted 1.0.4 build 7119, c16b0f0dc):
 *
 * Q1795 (3.1.2): the purchase surface of an app selling auto-renewing
 * subscriptions must link its Terms of Use and Privacy Policy, and the App
 * Store description must carry the Terms of Use (EULA) link.
 *
 * Q1797 (3.1.1): "Manage" for a membership bought through Apple must open
 * Apple's subscription management, never our Stripe billing portal (which has
 * no record of an Apple purchase). A Stripe membership keeps the portal.
 *
 * The Supabase client is the real one; only FunctionsClient.invoke is spied
 * (supabase.functions is a getter that builds a new FunctionsClient per read,
 * so the prototype is the one place to spy) so no request leaves (CLAUDE.md:
 * no mocked-Supabase specs).
 */
vi.mock("@/lib/iap", () => ({
  isIapAvailable: () => false,
  purchaseTier: vi.fn(),
  restorePurchases: vi.fn(),
  IapBlockedError: class IapBlockedError extends Error {},
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn() }));
const openApple = vi.fn();
vi.mock("@/lib/appleSubscriptions", async (orig) => ({
  ...(await orig<typeof import("@/lib/appleSubscriptions")>()),
  openAppleSubscriptions: () => openApple(),
}));

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

function member(source: "apple" | "stripe"): Profile {
  return {
    subscription_tier: "pro",
    subscription_billing_cycle: "monthly",
    subscription_expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    subscription_cancel_at_period_end: false,
    subscription_source: source,
  } as unknown as Profile;
}

function renderTab(profile: Profile | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/profile?tab=subscription"]}>
        <SubscriptionTab profile={profile} user={null} onBack={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let invoke: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openApple.mockReset();
  invoke = vi.spyOn(FunctionsClient.prototype, "invoke").mockResolvedValue({ data: null, error: null } as never);
});
afterEach(() => invoke.mockRestore());

describe("Membership screen links Terms of Use and Privacy Policy (Q1795)", () => {
  it("both links render on the purchase surface and point at the legal tabs", () => {
    renderTab(null);
    expect(screen.getByTestId("membership-terms-link").getAttribute("href")).toBe("/legal?tab=terms");
    expect(screen.getByTestId("membership-privacy-link").getAttribute("href")).toBe("/legal?tab=privacy");
    expect(screen.getByTestId("membership-terms-link").textContent).toBe("Terms of Use");
    expect(screen.getByTestId("membership-privacy-link").textContent).toBe("Privacy Policy");
  });

  it("the App Store description carries the Terms of Use and Privacy Policy URLs", () => {
    const desc = readFileSync(join(__dirname, "../../../fastlane/metadata/en-US/description.txt"), "utf8");
    expect(desc).toMatch(/Terms of Use: https:\/\/www\.louisianahelpr\.com\/terms/);
    expect(desc).toMatch(/Privacy Policy: https:\/\/www\.louisianahelpr\.com\/privacy/);
    expect(desc.length).toBeLessThan(4000); // App Store Connect's description limit
  });
});

describe("Manage opens the store that billed the membership (Q1797)", () => {
  it("Apple's subscriptions page is the documented one", () => {
    expect(APPLE_SUBSCRIPTIONS_URL).toBe("https://apps.apple.com/account/subscriptions");
  });

  it("an Apple subscriber's Manage opens Apple's subscriptions page, never the Stripe portal", async () => {
    renderTab(member("apple"));
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    await waitFor(() => expect(openApple).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls.map((c) => c[0])).not.toContain("pro-customer-portal");
  });

  it("a Stripe subscriber's Manage still opens the Stripe billing portal", async () => {
    renderTab(member("stripe"));
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    await waitFor(() => expect(invoke.mock.calls.map((c) => c[0])).toContain("pro-customer-portal"));
    expect(openApple).not.toHaveBeenCalled();
  });
});
