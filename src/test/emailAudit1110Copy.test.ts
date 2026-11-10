/**
 * Whole-app audit 11-10 (Worker 6, email gallery): the email copy fixes, one block per finding, read from the
 * template and sender source (comments blanked). Facts come from the code, never invented (brief: "implement
 * from what the code actually does and note it").
 *
 * F497: the gift-card email never said when the credit expires. gift_cards.expires_at defaults to now() + 90 days
 * (migration 20260612310000, no later ALTER); claim raises 'This gift has expired' past it. The webhook now reads
 * the minted row's expires_at and the email says "Credit expires Feb 8, 2027." in Louisiana time. No minimum
 * spend exists in the claim or redeem paths (the only floors are the DONOR's $10 and Stripe's $0.50 card
 * shortfall), so the email states none.
 * @mutate supabase/functions/_shared/email-templates/gift-card.tsx |         Credit expires {expiresOn}.\n |         Your credit expires {expiresOn}.\n
 * @mutate supabase/functions/_shared/giftCardEmail.ts |       note: note || null,\n      expiresOn,\n |       note: note || null,\n
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |               claimToken,\n              expiresAt,\n |               claimToken,\n
 * @mutate supabase/functions/_shared/centralDateTime.ts | { month: "short", day: "numeric", year: "numeric", timeZone: MEMBER_TIMEZONE } | { month: "short", day: "numeric", timeZone: MEMBER_TIMEZONE }
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { centralDateLabel } from "../../supabase/functions/_shared/centralDateTime";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("email copy, whole-app audit 11-10", () => {
  it("F497: the gift email tells the recipient the day the credit expires, from the minted row", () => {
    // 03:00Z on Feb 8 is still Feb 7 in Louisiana; the year is printed because the expiry is 90 days out.
    expect(centralDateLabel(new Date("2027-02-08T03:00:00Z"))).toBe("Feb 7, 2027");
    expect(centralDateLabel(new Date("2027-02-08T12:00:00Z"))).toBe("Feb 8, 2027");

    const webhook = read("supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts");
    // Both mint branches (complete the pending row / insert) return expires_at, and the email call carries it.
    expect(webhook.match(/\.select\("id, expires_at"\)/g)).toHaveLength(2);
    expect(webhook).toMatch(/const expiresAt = \(minted\[0\] as \{ expires_at\?: string \| null \}\)\.expires_at \?\? null;/);
    expect(webhook).toMatch(/await sendGiftCardEmail\(supabase, \{[\s\S]*?claimToken,\s*expiresAt,\s*\}\)/);

    const sender = read("supabase/functions/_shared/giftCardEmail.ts");
    expect(sender).toContain("expiresAt?: string | null;");
    expect(sender).toContain("const expiresOn = Number.isFinite(expiresMs) ? centralDateLabel(new Date(expiresMs)) : null;");
    expect(sender).toMatch(/React\.createElement\(GiftCardEmail, \{[\s\S]*?expiresOn,\s*\}\)/);

    const tpl = read("supabase/functions/_shared/email-templates/gift-card.tsx");
    expect(tpl).toContain("expiresOn?: string | null");
    expect(tpl).toMatch(/\{expiresOn \? \([\s\S]*?Credit expires \{expiresOn\}\.[\s\S]*?\) : null\}/);
  });
});
