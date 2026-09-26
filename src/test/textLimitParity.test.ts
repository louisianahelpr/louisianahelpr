/**
 * CLASS GUARD (Q54, front/back parity): every text-length and text-shape rule
 * the CLIENT enforces that the SERVER also enforces says the same number on
 * both sides.
 *
 * WHY. A client limit tighter than the server's is a user refused for no
 * reason; a client limit looser than the server's is a user who types, taps
 * Send, and gets a raw CHECK violation or a 400 the form never warned about.
 * Both halves of every pair below were hand-kept "in lockstep" by a comment
 * ("mirrors Support.tsx", "matches MAX_NOTE_LENGTH in the donate UI") and
 * nothing read either number back. The inventory is in
 * docs/audit/parity-matrix-2026-09-26.md (family "Text lengths").
 *
 * HOW. Each row reads its client number out of the client source (comments
 * blanked) and its server number out of the NEWEST migration event for that
 * constraint/function, or out of the edge function, via
 * ./helpers/parityReaders. Nothing is typed twice in this file.
 *
 * @mutate src/lib/messageLimits.ts | export const MESSAGE_MAX_LENGTH = 4000; | export const MESSAGE_MAX_LENGTH = 5000;
 * @mutate supabase/migrations/20260831014020_add_message_content_length_check.sql | CHECK (content IS NULL OR char_length(content) <= 4000); | CHECK (content IS NULL OR char_length(content) <= 2000);
 * @mutate src/components/profile/CredentialsTab.tsx | const MAX_BUSINESS_NAME = 80; | const MAX_BUSINESS_NAME = 120;
 * @mutate supabase/functions/contact-support/index.ts | const MESSAGE_MAX = 5000 | const MESSAGE_MAX = 2000
 * @mutate src/pages/info/Support.tsx | const NAME_MIN = 2; | const NAME_MIN = 1;
 * @mutate src/lib/supportSubject.ts | const SUBJECT_MAX = 120; | const SUBJECT_MAX = 200;
 * @mutate supabase/functions/contact-support/index.ts | const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ | const EMAIL_RE = /^[^\s@]+@[^\s@]+$/
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | const MAX_MESSAGE_LEN = 140; | const MAX_MESSAGE_LEN = 100;
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | body.occasion.slice(0, 48) | body.occasion.slice(0, 8)
 * @mutate src/pages/profile/giftCards/RecipientPicker.tsx | const MIN_QUERY_LEN = 2; | const MIN_QUERY_LEN = 1;
 * @mutate supabase/migrations/20260924220318_rename_tab_addresses.sql | OR length(_reason_trimmed) < 15 | OR length(_reason_trimmed) < 25
 * @mutate src/components/disputeReasons.ts | export const DISPUTE_DETAILS_MIN = 10; | export const DISPUTE_DETAILS_MIN = 3;
 */
import { describe, it, expect } from "vitest";
import {
  checkMaxLength,
  newestFunction,
  numericConst,
  readCode,
  regexConst,
} from "./helpers/parityReaders";
import { GIFT_OCCASIONS } from "@/pages/profile/giftCards/giftCardDesigns";
import { composeDisputeReason, disputeReasonsFor, DISPUTE_DETAILS_MIN } from "@/components/disputeReasons";

type Pair = { id: string; client: () => number | string; server: () => number | string };

const SUPPORT_UI = "src/pages/info/Support.tsx";
const SUPPORT_FN = "supabase/functions/contact-support/index.ts";
const GIFT_FN = "supabase/functions/create-gift-card-checkout/index.ts";

/** Pairs whose two numbers are meant to be EQUAL (drift in either direction fails). */
const EQUAL_PAIRS: Pair[] = [
  {
    id: "messages.content max (MESSAGE_MAX_LENGTH vs messages_content_length_check)",
    client: () => numericConst("src/lib/messageLimits.ts", "MESSAGE_MAX_LENGTH"),
    server: () => checkMaxLength("messages_content_length_check", "content").max,
  },
  {
    id: "profiles.business_name max (CredentialsTab vs profiles_business_name_len)",
    client: () => numericConst("src/components/profile/CredentialsTab.tsx", "MAX_BUSINESS_NAME"),
    server: () => checkMaxLength("profiles_business_name_len", "business_name").max,
  },
  ...(["NAME_MIN", "NAME_MAX", "EMAIL_MAX", "SUBJECT_MAX", "MESSAGE_MIN", "MESSAGE_MAX"] as const).map((k) => ({
    id: `support form ${k} (Support.tsx vs contact-support)`,
    client: () => numericConst(SUPPORT_UI, k),
    server: () => numericConst(SUPPORT_FN, k),
  })),
  {
    id: "support subject max (supportSubject.ts vs contact-support)",
    client: () => numericConst("src/lib/supportSubject.ts", "SUBJECT_MAX"),
    server: () => numericConst(SUPPORT_FN, "SUBJECT_MAX"),
  },
  {
    id: "support email shape (Support.tsx EMAIL_RE vs contact-support EMAIL_RE)",
    client: () => regexConst(SUPPORT_UI, "EMAIL_RE"),
    server: () => regexConst(SUPPORT_FN, "EMAIL_RE"),
  },
  {
    id: "gift note max (MAX_NOTE_LENGTH vs create-gift-card-checkout MAX_MESSAGE_LEN)",
    client: () => numericConst("src/pages/profile/giftCards/constants.ts", "MAX_NOTE_LENGTH"),
    server: () => numericConst(GIFT_FN, "MAX_MESSAGE_LEN"),
  },
  {
    id: "gift recipient email shape (GiftCard.tsx EMAIL_RE vs create-gift-card-checkout EMAIL_RE)",
    client: () => regexConst("src/pages/profile/GiftCard.tsx", "EMAIL_RE"),
    server: () => regexConst(GIFT_FN, "EMAIL_RE"),
  },
  {
    id: "profile search floor (RecipientPicker MIN_QUERY_LEN vs search_profiles_by_name)",
    client: () => numericConst("src/pages/profile/giftCards/RecipientPicker.tsx", "MIN_QUERY_LEN"),
    server: () => {
      const { body, file } = newestFunction("search_profiles_by_name");
      const m = /length\s*\(\s*trim\s*\(\s*coalesce\s*\(\s*query\s*,\s*''\s*\)\s*\)\s*\)\s*<\s*(\d+)/i.exec(body);
      if (!m) throw new Error(`${file}: search_profiles_by_name has no query-length floor`);
      return Number(m[1]);
    },
  },
];

/** Every gift occasion/design id the client can send, and the two server caps on it. */
function giftIdCaps() {
  const code = readCode(GIFT_FN);
  const slice = (field: string) => {
    const m = new RegExp(`body\\.${field}\\.slice\\(0,\\s*(\\d+)\\)`).exec(code);
    if (!m) throw new Error(`${GIFT_FN}: ${field} is no longer length-capped`);
    return Number(m[1]);
  };
  return {
    occasion: Math.min(slice("occasion"), checkMaxLength("\u0070if_credits_occasion_len", "occasion").max),
    design: Math.min(slice("design_id"), checkMaxLength("\u0070if_credits_design_len", "design_id").max),
  };
}

describe("text limits agree between client and server (Q54)", () => {
  it("inventory floor: the pair list and every reader still resolve", () => {
    // 13 equal pairs + gift ids + dispute floor. A reader that throws fails here
    // by name, not as a vacuous pass.
    expect(EQUAL_PAIRS.length).toBeGreaterThan(12);
    for (const p of EQUAL_PAIRS) {
      expect(p.client(), p.id).toBeTruthy();
      expect(p.server(), p.id).toBeTruthy();
    }
    expect(GIFT_OCCASIONS.length).toBeGreaterThan(3);
  });

  it.each(EQUAL_PAIRS.map((p) => [p.id, p] as const))("%s", (_id, p) => {
    expect(p.client(), `${p.id}: client and server disagree`).toBe(p.server());
  });

  it("every gift occasion and design id fits the server's caps (edge slice AND the gift-card credits table CHECK)", () => {
    const caps = giftIdCaps();
    const over: string[] = [];
    for (const o of GIFT_OCCASIONS) {
      if (o.id.length > caps.occasion) over.push(`occasion ${o.id} (${o.id.length} > ${caps.occasion})`);
      for (const d of o.designs) if (d.id.length > caps.design) over.push(`design ${d.id} (${d.id.length} > ${caps.design})`);
    }
    expect(over, "the checkout would silently truncate these ids, and the claim page could not find the design").toEqual([]);
  });

  it("a dispute written at the client's minimum detail length clears the server's minimum (open_dispute_as)", () => {
    const { body, file } = newestFunction("open_dispute_as");
    const m = /length\s*\(\s*_reason_trimmed\s*\)\s*<\s*(\d+)/i.exec(body);
    expect(m, `${file}: open_dispute_as lost its reason-length floor`).not.toBeNull();
    const serverMin = Number(m![1]);
    const tooShort: string[] = [];
    let checked = 0;
    for (const side of ["poster", "helper"] as const) {
      for (const r of disputeReasonsFor(side)) {
        checked++;
        const composed = composeDisputeReason(side, r.value, "x".repeat(DISPUTE_DETAILS_MIN));
        if (composed.trim().length < serverMin) tooShort.push(`${side}/${r.value}: "${composed}" (${composed.length} < ${serverMin})`);
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(
      tooShort,
      "the Submit button enables at DISPUTE_DETAILS_MIN but the server refuses the composed reason with dispute_needs_description",
    ).toEqual([]);
  });
});
