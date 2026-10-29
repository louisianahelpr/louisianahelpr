/**
 * A3-C17 (app audit 2026-10-29): the gift card preview and the gift
 * notification named the sender "E2E P." but the recipient's list said "from
 * a neighbor". The list read the donor's name from `profiles`, whose SELECT
 * policies let a member read only their own row, so the name was always empty
 * for a member; and when it did arrive it was cut to the first word. The list
 * now names the sender "First L." through get_safe_profiles + formatName, the
 * same way the preview (formatName) and the notification (memberDisplayName)
 * do.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const DONOR = "donor-1";
const calls = vi.hoisted(() => ({ rpc: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        or: () => chain,
        in: () => Promise.resolve({ data: [], error: null }), // profiles RLS: not your row, nothing back
        order: () =>
          Promise.resolve({
            data: table === "gift_cards" ? [{ id: "gc-1", donor_id: DONOR, recipient_id: "me", amount: 25 }] : [],
            error: null,
          }),
      };
      return chain;
    },
    rpc: (fn: string, args: { user_ids: string[] }) => {
      calls.rpc.push([fn, args]);
      return Promise.resolve({
        data: fn === "get_safe_profiles" ? args.user_ids.filter((id) => id === DONOR).map((id) => ({ user_id: id, full_name: "Erin P." })) : null,
        error: null,
      });
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { fetchReceivedGiftCards } from "./giftCardQueries";
import { CreditCard } from "./CreditCard";
import { formatName } from "@/lib/utils";
import type { GiftCardRow } from "./types";

describe("the gift card sender is named the same way everywhere", () => {
  it("the recipient's list reads the donor's display name through get_safe_profiles", async () => {
    const rows = await fetchReceivedGiftCards("me", "me@example.com");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].donor?.full_name).toBe("Erin P.");
    expect(calls.rpc).toContainEqual(["get_safe_profiles", { user_ids: [DONOR] }]);
  });

  it("the list line says 'from First L.', exactly what the preview prints for the same name", () => {
    const full = "Erin Poster";
    render(
      <CreditCard
        credit={{
          id: "gc-1", donor_id: DONOR, recipient_id: "me", recipient_email: "me@example.com", amount: 25,
          status: "sent", payment_status: "paid", message: null, category: null, parish: null, claim_token: "t",
          job_id: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString(),
          redeemed_at: null, donor: { full_name: full },
        } as GiftCardRow}
        currentUserId="me"
        onRedeem={vi.fn()}
        onClaim={vi.fn()}
      />,
    );
    // GiftCard.tsx's preview: senderName={formatName(profile.full_name)}
    expect(screen.getByText(`from ${formatName(full)}`)).toBeTruthy();
    expect(formatName(full)).toBe("Erin P.");
  });
});

// @mutate src/pages/profile/giftCards/CreditCard.tsx |     ? formatName(credit.donor?.full_name, "a neighbor") |     ? credit.donor?.full_name?.trim().split(" ")[0] \|\| "a neighbor"
// @mutate src/pages/profile/giftCards/giftCardQueries.ts | await supabase.rpc("get_safe_profiles", { user_ids: donorIds }) | await supabase.rpc("get_safe_profiles", { user_ids: [] })
