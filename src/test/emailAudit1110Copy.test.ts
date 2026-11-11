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
 * @mutate supabase/functions/_shared/giftCardEmail.ts |       note: note \|\| null,\n      expiresOn,\n |       note: note \|\| null,\n
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |               claimToken,\n              expiresAt,\n |               claimToken,\n
 * @mutate supabase/functions/_shared/centralDateTime.ts | { month: "short", day: "numeric", year: "numeric", timeZone: MEMBER_TIMEZONE } | { month: "short", day: "numeric", timeZone: MEMBER_TIMEZONE }
 *
 * F491: the Declutter intro (drip day 3) said buyers "pick it up from your porch"; declutter_orders.handover allows
 * pickup_home, porch, meetup, delivery, seller_delivery and ship (CHECK in migration 20261030000030), so it now says
 * "Buyers pick up, or you deliver. You choose." The gallery's marketing-blast sample (Desktop, not the repo) got the same words.
 * F492: drip day 1 ends "- Louisiana Helpr", the form days 14 and 30 already use; its button was already "Open Louisiana Helpr".
 * F493 (premise gone with F169): day 3 shares no bullet with day 1; F494 (gone with F168): day 7 has no "rebooked" /
 * "Helprs who"; F496: both day 1 and come-back 1 say "set your price" (the price step's rail label is "Price",
 * enPostJob.ts), neither says "budget". These three are guarded so the words do not drift back.
 * @mutate supabase/functions/_shared/email-templates/drip.tsx | Buyers pick up, or you deliver. You
      choose. | Buyers pick it up from your
      porch.
 * @mutate supabase/functions/_shared/email-templates/drip.tsx | Reach out any time at admin@louisianahelpr.com. - Louisiana Helpr | Reach out any time at admin@louisianahelpr.com.
 * @mutate supabase/functions/_shared/comeBackEmail.ts | "Describe the job and set your price. See who applied and chat before you hire." | "Describe the job and set your budget. See who applied and chat before you hire."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { centralDateLabel } from "../../supabase/functions/_shared/centralDateTime";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** One exported component's source: from its `export const` to the next export. */
function component(src: string, name: string): string {
  const at = src.indexOf(`export const ${name} = `);
  expect(at, name).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

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

  it("F491: the Declutter intro names both handovers the orders table allows, pickup and delivery", () => {
    const day3 = component(read("supabase/functions/_shared/email-templates/drip.tsx"), "WelcomeDripStep2Email");
    expect(day3).toMatch(/snap a photo and set a garage-sale price\. Buyers pick up, or you deliver\. You\s+choose\./);
    expect(day3).toMatch(/browse, pay in the app, then pick it up or have it brought to you\./);
    expect(day3).not.toMatch(/porch/);
    // The fact the wording rests on: delivery kinds are real handovers, not only pickup.
    // Read from the NEWEST migration that states the handover kinds, never a pinned file (guardsReadTheNewestMigration).
    const newest = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().reverse()
      .find((f) => read(join("supabase/migrations", f)).includes("CHECK (handover IN ("));
    expect(newest).toBeTruthy();
    expect(read(join("supabase/migrations", newest!))).toContain("CHECK (handover IN ('pickup_home', 'porch', 'delivery', 'seller_delivery', 'meetup', 'ship'))");
  });

  it("F492: the welcome email signs off with the name, in the form the later drips use", () => {
    const drip = read("supabase/functions/_shared/email-templates/drip.tsx");
    const day1 = component(drip, "WelcomeDripStep1Email");
    expect(day1).toContain('label="Open Louisiana Helpr"');
    expect(day1).toMatch(/Reach out any time at admin@louisianahelpr\.com\. - Louisiana Helpr\s*<\/Text>/);
    expect(day1).not.toContain("Dashboard");
    // The same sign-off form as the day-14 and day-30 emails (2026-11-10).
    expect(drip.match(/ - Louisiana Helpr\s*<\/Text>/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("F493, F494, F496: day 3 repeats nothing from day 1, day 7 uses no insider words, and both posting emails say 'set your price'", () => {
    const drip = read("supabase/functions/_shared/email-templates/drip.tsx");
    const day1 = component(drip, "WelcomeDripStep1Email");
    const day3 = component(drip, "WelcomeDripStep2Email");
    const day7 = component(drip, "WelcomeDripStep3Email");
    // F493: day 3 is the Declutter intro, with no list and none of day 1's three bullets.
    expect(day3).not.toMatch(/<li>/);
    for (const bullet of ["Need a hand?", "Want work?", "Got stuff to sell?"]) {
      expect(day1).toContain(bullet);
      expect(day3).not.toContain(bullet);
    }
    // F494: no "rebooked", no "Helprs who"; the reader may not know either word yet.
    expect(day7).not.toMatch(/rebook|Helprs who/);
    expect(day7).toMatch(/four things that make every job and sale go smoothly/);
    // F496: one word for the price field in both emails; the posting rail labels it "Price".
    const comeBack = read("supabase/functions/_shared/comeBackEmail.ts");
    expect(day1).toContain("<Bold>Need a hand?</Bold> Describe the job and set your price.");
    expect(comeBack).toContain('["Need a hand?", "Describe the job and set your price. See who applied and chat before you hire."]');
    expect(day1).not.toMatch(/budget/i);
    expect(comeBack).not.toMatch(/budget/i);
    expect(read("src/lib/i18n/enPostJob.ts")).toContain('"postJob.rail.price": "Price"');
  });
});
