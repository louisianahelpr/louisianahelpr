/**
 * AL-011(b): how a departed (anonymised) person is named on two surfaces.
 * A gift card from a deleted donor split the FALLBACK and read "from A"; admin
 * referrals fell through a null name and null email to an 8-character raw
 * UUID shown as a person's name.
 *
 * @mutate src/pages/profile/giftCards/CreditCard.tsx |     : `a ${FORMER_MEMBER_LABEL.toLowerCase()}`; |     : "A neighbor".split(" ")[0];
 * @mutate src/components/admin/AdminReferrals.tsx |           nameMap[p.user_id] = p.full_name \|\| p.email \|\| (p.anonymized_at ? ADMIN_DELETED_ACCOUNT_LABEL : "No name on file"); |           nameMap[p.user_id] = p.full_name \|\| p.email \|\| p.user_id.slice(0, 8);
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CreditCard } from "./CreditCard";
import type { GiftCardRow } from "./types";

const gift = (over: Partial<GiftCardRow> = {}): GiftCardRow => ({
  id: "gc-1", donor_id: null as unknown as string, recipient_id: "me", recipient_email: "me@example.com",
  amount: 50, status: "sent", payment_status: "paid", message: null, category: null, parish: null,
  claim_token: "tok", job_id: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  created_at: new Date().toISOString(), redeemed_at: null, ...over,
});

describe("a departed person is named, not mangled (AL-011)", () => {
  it("gift card from a deleted donor reads 'from a former member' (Q369)", () => {
    render(<CreditCard credit={gift()} currentUserId="me" onRedeem={vi.fn()} onClaim={vi.fn()} />);
    expect(screen.getByText(/from a former member/)).toBeTruthy();
    expect(screen.queryByText(/from A\b/)).toBeNull();
  });

  it("admin referrals never shows a raw id as a profile's name", () => {
    const src = readFileSync(resolve(__dirname, "../../../components/admin/AdminReferrals.tsx"), "utf8");
    const assign = src.match(/nameMap\[p\.user_id\] = [^;]+;/)?.[0];
    expect(assign).toBeTruthy();
    expect(assign).not.toMatch(/slice\(/);
  });
});
