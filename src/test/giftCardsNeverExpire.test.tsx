/**
 * MON-1123-01 (backend money audit 2026-11-23, High): paid gift cards expired 90 days after purchase
 * (gift_cards.expires_at DEFAULT now() + 90 days), redeem/claim then refused them, nothing refunded the money, and
 * the Terms said nothing about gift cards. La. R.S. 51:1423(B)(1)/(C) and 12 CFR 1005.20(e): no gift card may expire
 * in under 5 years, and one with no date is good until used. Fix: 20261123090716_gift_cards_never_expire.sql.
 *
 * Inventory from source, every migration replayed in order:
 *   1. the LAST statement that sets or drops gift_cards.expires_at's default drops it;
 *   2. trg_gift_cards_never_expire is live (not dropped later) on gift_cards, and its function's effective body
 *      sets NEW.expires_at := NULL;
 *   3. every live function that refuses a gift card on expires_at reads NULL as valid ("expires_at IS NOT NULL AND
 *      ... < now()"), so no refusal can fire on a never-expiring card (floor: the three redeem functions);
 *   4. the buyer, the recipient and the reader are told: the buy screen, the card ("Never expires"), the email,
 *      and the Terms' Gift cards row.
 * Behaviour on a real database: src/test/pglite/giftCardsNeverExpire.pglite.mjs (red on the old schema with
 * NEW_MIGRATION=skip: 10 of 12 checks fail).
 *
 * @mutate supabase/migrations/20261123090716_gift_cards_never_expire.sql | ALTER TABLE public.gift_cards ALTER COLUMN expires_at DROP DEFAULT; | ALTER TABLE public.gift_cards ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days');
 * @mutate supabase/migrations/20261123090716_gift_cards_never_expire.sql |   NEW.expires_at := NULL; |   NEW.expires_at := now() + interval '90 days';
 * @mutate supabase/migrations/20261123090716_gift_cards_never_expire.sql | CREATE TRIGGER trg_gift_cards_never_expire | CREATE TRIGGER trg_gift_cards_never_expire_off
 * @mutate src/pages/profile/giftCards/CreditCard.tsx |   const showExpiry = isFunded && credit.status !== "redeemed"; |   const showExpiry = expiresAt !== null && isFunded && credit.status !== "redeemed";
 * @mutate src/pages/profile/giftCards/CreditCard.tsx |   const showExpiry = isFunded && credit.status !== "redeemed"; |   const showExpiry = credit.status !== "redeemed";
 * @mutate src/pages/profile/GiftCard.tsx |  per gift card. Never expires.{" "} |  per gift card.{" "}
 * @mutate supabase/functions/_shared/email-templates/gift-card.tsx | : "Your credit never expires."} | : null}
 * @mutate src/pages/info/legal/termsGiftCards.tsx | Gift cards never expire.</strong> | Gift cards last 90 days.</strong>
 * @mutate src/pages/info/legal/TermsSection.tsx |         body={GIFT_CARDS_TERMS_BODY} |         body={null}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { triggerInventory, triggersOn } from "./helpers/migrationTriggers";
import { CreditCard } from "@/pages/profile/giftCards/CreditCard";
import type { GiftCardRow } from "@/pages/profile/giftCards/types";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase/migrations");
const files = migrationFiles(MIG);
const sqlOf = (f: string) => readFileSync(join(MIG, f), "utf8");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("gift cards never expire (MON-1123-01)", () => {
  it("the last change to gift_cards.expires_at's default drops it", () => {
    const changes: { file: string; drop: boolean }[] = [];
    const RE = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?gift_cards"?\s+ALTER\s+COLUMN\s+"?expires_at"?\s+(SET\s+DEFAULT|DROP\s+DEFAULT)/gi;
    // The table's first CREATE (2026-06, under its retired name) predates the rename migration 20260913051340, so it can
    // never be the last change: only a gift_cards CREATE is read (the retired name would trip giftCardNaming).
    const CREATE_DEFAULT = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?gift_cards"?\s*\([\s\S]*?expires_at\s+timestamptz[^,\n]*DEFAULT/gi;
    for (const f of files) {
      const code = blankSqlComments(sqlOf(f));
      changes.push(...[...code.matchAll(CREATE_DEFAULT)].map(() => ({ file: f, drop: false })));
      for (const m of code.matchAll(RE)) changes.push({ file: f, drop: /^DROP/i.test(m[1]) });
    }
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1], JSON.stringify(changes)).toEqual({ file: "20261123090716_gift_cards_never_expire.sql", drop: true });
  });

  it("trg_gift_cards_never_expire is live and its function clears expires_at", () => {
    const inv = triggerInventory(files.map((name) => ({ name, sql: sqlOf(name) })));
    const trg = triggersOn(inv, "gift_cards").find((t) => t.name === "trg_gift_cards_never_expire");
    expect(trg, "trigger missing or dropped").toBeTruthy();
    expect(trg!.timing).toBe("BEFORE");
    expect(trg!.events).toMatch(/INSERT/);
    expect(trg!.events).toMatch(/UPDATE/);
    const fn = effectiveDefs(MIG).get(trg!.fn);
    expect(fn, `function ${trg!.fn} not live`).toBeTruthy();
    expect(blankSqlComments(fn!.stmt)).toMatch(/NEW\.expires_at\s*:=\s*NULL\s*;/i);
  });

  it("every live refusal on a gift card's expires_at treats NULL as valid", () => {
    const defs = effectiveDefs(MIG);
    const refusing: string[] = [];
    const bad: string[] = [];
    for (const [name, d] of defs) {
      const code = blankSqlComments(d.stmt);
      if (!/gift_cards/i.test(code)) continue;
      // A comparison of a gift record's expires_at with now() that would refuse it.
      for (const m of code.matchAll(/(\w+)\.expires_at\s*<\s*now\(\)/gi)) {
        refusing.push(name);
        const before = code.slice(Math.max(0, m.index! - 80), m.index!);
        if (!new RegExp(`${m[1]}\\.expires_at\\s+is\\s+not\\s+null\\s+and\\s*$`, "i").test(before)) bad.push(`${name} (${d.file})`);
      }
    }
    expect(new Set(refusing).size).toBeGreaterThanOrEqual(3);
    expect(bad).toEqual([]);
  });

  it("the card says Never expires when the row has no date", () => {
    const row: GiftCardRow = {
      id: "gc-1", donor_id: "donor-1", recipient_id: "me", recipient_email: "me@example.com", amount: 25, status: "sent",
      payment_status: "paid", message: null, category: null, parish: null, claim_token: null, job_id: null,
      expires_at: null, created_at: "2026-11-23T00:00:00Z", redeemed_at: null, donor: { full_name: "Ann Smith" },
    };
    const { unmount } = render(<CreditCard credit={row} currentUserId="me" onRedeem={() => {}} />);
    expect(screen.getByText("Never expires")).toBeTruthy();
    unmount();
    // A card whose purchase was refunded is not "never expires": it is cancelled.
    render(<CreditCard credit={{ ...row, payment_status: "refunded" }} currentUserId="me" onRedeem={() => {}} />);
    expect(screen.queryByText("Never expires")).toBeNull();
  });

  it("the buy screen, the email and the Terms say it", () => {
    expect(blankComments(read("src/pages/profile/GiftCard.tsx"))).toMatch(/per gift card\. Never expires\./);
    expect(blankComments(read("supabase/functions/_shared/email-templates/gift-card.tsx"))).toMatch(/: "Your credit never expires\."/);
    // The row stays in TermsSection (PolicySection's search reads its title); its words are in termsGiftCards.tsx.
    expect(blankComments(read("src/pages/info/legal/TermsSection.tsx"))).toMatch(/title="Gift cards"\s+body=\{GIFT_CARDS_TERMS_BODY\}/);
    const terms = blankComments(read("src/pages/info/legal/termsGiftCards.tsx"));
    expect(terms).toMatch(/Gift cards never expire\.<\/strong>/);
    // Only what the code does: chargeRefunded revokes / gives back on a FULL refund only.
    expect(terms).toMatch(/cancelled or refunded in full, the gift card part comes back/);
    expect(terms).toMatch(/refunded in full or disputed, any credit left/);
  });
});
