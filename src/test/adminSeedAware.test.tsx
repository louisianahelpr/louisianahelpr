/**
 * Q233: seed rows in the admin console are badged, and totals leave them out.
 *
 * Subscriptions, Payouts, Disputes, Tiers and Users listed `is_seed` rows
 * exactly like real ones and counted them in their totals; "Payments
 * Collected" summed escrow jobs no card was ever charged for. Three checks:
 *
 *  1. BEHAVIOUR: AdminSubscriptions with one real and one demo subscriber
 *     shows the Demo badge on the demo row only and counts 1, not 2.
 *  2. MONEY: splitPaymentsCollected counts card-captured jobs only and keeps
 *     the PaymentIntent-less ones as their own figure.
 *  3. CLASS, from source: each of the five views renders <DemoBadge> behind
 *     isSeedRow() and imports the ONE helper (src/components/admin/seedAware);
 *     no admin file hand-rolls its own `is_seed === true` test.
 *
 * @mutate src/components/admin/AdminSubscriptions.tsx | const realProfiles = realRows(allProfiles); | const realProfiles = allProfiles;
 * @mutate src/components/admin/adminusers/AdminUserRow.tsx | {isSeedRow(p) && <DemoBadge />} |
 * @mutate src/components/admin/paymentsCollected.ts | captured.filter((j) => !!j.stripe_payment_intent_id) | captured.filter(() => true)
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { splitPaymentsCollected } from "@/components/admin/paymentsCollected";

const subs = vi.hoisted(() => ({
  active: [
    { user_id: "u-real", full_name: "Real Subscriber", email: "real@example.com", subscription_tier: "pro", subscription_expires_at: "2099-01-01T00:00:00Z", is_seed: false },
    { user_id: "u-demo", full_name: "Demo Subscriber", email: "demo@example.com", subscription_tier: "pro", subscription_expires_at: "2099-01-01T00:00:00Z", is_seed: true },
  ],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        // active list: .not().order(); expired list: .is().not()
        not: () => ({ order: async () => ({ data: subs.active, error: null }) }),
        is: () => ({ not: async () => ({ data: [], error: null }) }),
      }),
    }),
  },
}));

import AdminSubscriptions from "@/components/admin/AdminSubscriptions";

describe("Q233 behaviour: AdminSubscriptions", () => {
  it("badges the demo row only and counts real subscribers only, saying so", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AdminSubscriptions />
      </QueryClientProvider>,
    );
    const demoName = await screen.findByText("Demo Subscriber");
    const realName = screen.getByText("Real Subscriber");
    expect(within(demoName).getByTestId("demo-badge")).toBeInTheDocument();
    expect(within(realName).queryByTestId("demo-badge")).toBeNull();

    const tile = screen.getByText(/^Active Subs \(excl\. demo\)$/).closest("div")!.parentElement!;
    expect(within(tile).getByText("1")).toBeInTheDocument();
    expect(screen.getByTestId("demo-excluded-note").textContent).toMatch(/1 demo subscriber .* left out of these totals/);
  });
});

describe("Q233 money: Payments Collected is card-captured only", () => {
  it("splits PaymentIntent-less escrow jobs out instead of summing them", () => {
    const r = splitPaymentsCollected([
      { payment_status: "escrow", stripe_payment_intent_id: "pi_1", budget: 100, customer_fee_amount: 5 },
      { payment_status: "released", stripe_payment_intent_id: "pi_2", budget: 50, customer_fee_amount: 0 },
      { payment_status: "escrow", stripe_payment_intent_id: null, budget: 80, customer_fee_amount: 4 },
      { payment_status: "refunded", stripe_payment_intent_id: "pi_3", budget: 999, customer_fee_amount: 0 },
    ]);
    expect(r.cardJobs).toHaveLength(2);
    expect(r.cardGross).toBe(155);
    expect(r.noIntentJobs).toHaveLength(1);
    expect(r.noIntentGross).toBe(84);
  });
});

// ── class, from source ─────────────────────────────────────────────────────
const REPO = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(join(REPO, f), "utf8"));

// The five views Q233 named, each with the files that render its rows.
const VIEWS: Record<string, string[]> = {
  Subscriptions: ["src/components/admin/AdminSubscriptions.tsx"],
  Payouts: ["src/components/admin/adminPayoutBatches/BatchRow.tsx", "src/components/admin/adminPayoutBatches/LedgerList.tsx"],
  Disputes: ["src/components/admin/adminDisputes/DisputeCard.tsx"],
  Tiers: ["src/components/admin/AdminHelperTiers.tsx"],
  Users: ["src/components/admin/adminusers/AdminUserRow.tsx"],
};

describe("Q233 class: every named view badges seed rows with the shared helper", () => {
  for (const [view, files] of Object.entries(VIEWS)) {
    it(`${view}: every row file renders <DemoBadge> behind isSeedRow() from seedAware`, () => {
      for (const f of files) {
        const src = read(f);
        expect(src, `${f} must import the shared helper`).toMatch(/from "@\/components\/admin\/seedAware"/);
        expect(src, `${f} must render the badge behind isSeedRow()`).toMatch(/isSeedRow\([^)]*\)\s*&&\s*<DemoBadge/);
      }
    });
  }

  it("no admin source hand-rolls a seed test outside seedAware (floor on the inventory)", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src/components/admin"], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(40);
    const handRolled = files.filter((f) => f !== "src/components/admin/seedAware.tsx" && /\.is_seed\s*(===|!==|==|!=)|\?\.is_seed\b|!\s*\w+\.is_seed\b/.test(read(f)));
    expect(handRolled).toEqual([]);
  });
});
