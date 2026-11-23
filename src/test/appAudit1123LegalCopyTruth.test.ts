/**
 * Whole-app audit 2026-11-23, legal and help copy (LT-2, LT-6, LT-7, LT-8, S-T1, S-T2, S-T3, S-H2, JP-02, DB2): each
 * line below said something the code does not do. The class: binding legal copy and money promises that contradict
 * the app. Each check names the code it was transcribed from, so the words move only with the behaviour.
 *
 * - LT-2: no rule bans automatically (CommunitySection's header: the ladders never ban; an admin decides) and nothing
 *   releases money on a timer (auto-resolve-disputes hands an expired dispute to support, held; owner 10-23, Q2362).
 *   A no-show has its own ladder (NO_SHOW_LADDER_SENTENCE), so it is not in the straight-to-admin list.
 * - LT-6: an accepted offer gives 24 hours to pay (BUY-1, owner 10-31), so no "48-hour checkout".
 * - LT-7: Stripe Identity keeps the ID images; the id-documents bucket was dropped (20260923165718).
 * - LT-8: the gift guides carry Amazon Associates links; the Associates policies ask for a cookie disclosure.
 * - S-T1: each item drops by its own drop_pct (DROP_PCT_CHOICES), never a fixed 5%.
 * - S-T2: porch follows Declutter settings and a live listing's ways can be edited (declutter_edit_listing).
 * - S-T3: trades are live, so the Terms and Help say what they are.
 * - S-H2: a new free item is porch pickup only (useSellFlowState savedWays); Help and Terms say so.
 * - JP-02: a guest is told the members' promise (card held at post, charged at the hire), not "charged when you post".
 * - DB2: the seller-delivery "Do you have it?" says the seller is paid after the 24-hour refund window, like porch/door.
 *
 * @mutate src/pages/info/legal/CommunitySection.tsx | <li>False or frivolous disputes go straight to an admin, who can ban the account</li> | <li>False or frivolous disputes = immediate ban</li>
 * @mutate src/pages/info/legal/CommunitySection.tsx | <li>Miss the 72h deadline → Helpr support decides; the payment stays held until then</li> | <li>Ignore the 72h deadline → payment releases, no exceptions</li>
 * @mutate src/pages/info/legal/CommunitySection.tsx | title="Straight to an admin (skip the ladder)" | title="Immediate ban offenses (skip the ladder)"
 * @mutate src/pages/info/legal/CommunitySection.tsx |             <li><strong className="text-foreground">Fraud.</strong> |             <li><strong className="text-foreground">No-show.</strong> Accepting a job and not showing up.</li><li><strong className="text-foreground">Fraud.</strong>
 * @mutate src/pages/info/legal/TermsSection.tsx | Missed the 24-hour checkout on an accepted offer: | Missed the 48-hour checkout:
 * @mutate src/pages/info/legal/PrivacySection.tsx | <p>We do not hold ID documents: Stripe Identity keeps them, and we keep only the result of the check.</p> | <p>ID documents are stored in private, encrypted storage buckets accessible only to authorized verification personnel.</p>
 * @mutate src/pages/info/legal/PrivacySection.tsx |         title="Affiliate links" |         title="Partner links"
 * @mutate src/pages/info/legal/TermsSection.tsx | drops by the step its seller picked (5%, 10%, 15% or 20%) | drops 5%
 * @mutate src/pages/info/legal/TermsSection.tsx | You can change the ways on a live listing from Manage, then Edit. | It can&apos;t be changed after the item is listed.
 * @mutate src/pages/info/legal/TermsSection.tsx | <p><strong className="text-foreground">Trades.</strong> | <p><strong className="text-foreground">Swaps.</strong>
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts |         q: "Can I trade on Declutter?", |         q: "Can I swap on Declutter?",
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | they pick it up from your porch. Nothing | they pick it up from your porch or at your door. Nothing
 * @mutate src/pages/info/legal/TermsSection.tsx | Some older listings may also be picked up at the seller&apos;s door. | Older listings and free items may also be picked up at the seller&apos;s door.
 * @mutate src/pages/post-job/usePostJobForm.ts |   const cardHoldOn = cardHoldSwitch \|\| isGuest; |   const cardHoldOn = cardHoldSwitch;
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | words: "After you tap I got it, you still have 24 hours to ask the seller for a refund if something is wrong. Then the sale is final and the seller is paid." | words: "Tapping I got it finishes the sale and the seller is paid. You can still ask for a refund within 24 hours if something is wrong."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { DROP_PCT_CHOICES } from "@/lib/declutter/priceDrop";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";

const code = (p: string) => blankComments(readFileSync(p, "utf8"));
const community = code("src/pages/info/legal/CommunitySection.tsx");
const terms = code("src/pages/info/legal/TermsSection.tsx");
const privacy = code("src/pages/info/legal/PrivacySection.tsx");
const legal = [community, terms, privacy].join("\n");
const help = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => ({ q: i.q, a: i.a })));
const helpText = help.map((x) => `${x.q} ${x.a}`).join("\n");

describe("whole-app audit 11-23: legal and help copy say what the code does", () => {
  it("inventory: the three policies and Help are read", () => {
    expect(legal.length).toBeGreaterThan(50_000);
    expect(help.length).toBeGreaterThan(20);
  });

  it("LT-2: no automatic ban, no timer release, and a no-show is not an instant-ban offense", () => {
    expect(legal).not.toMatch(/immediate(ly)? ban|ban(ned)? immediately|instant(ly)? (permanent )?ban/i);
    expect(legal).not.toMatch(/payment releases|releases? (the )?payment automatically|released automatically/i);
    const adminList = community.slice(community.indexOf('title="Straight to an admin (skip the ladder)"'));
    expect(community.indexOf('title="Straight to an admin (skip the ladder)"')).toBeGreaterThan(0);
    const firstList = adminList.slice(0, adminList.indexOf("</ul>"));
    expect(firstList).toContain("Fraud.");
    expect(firstList).not.toMatch(/No-show/);
    expect(firstList).toContain("A ban is never automatic.");
  });

  it("LT-6: checkout after an accepted offer is 24 hours, never 48", () => {
    expect(terms).not.toMatch(/48-hour checkout/);
    expect(terms.match(/24-hour checkout on an accepted offer/g)?.length).toBe(2);
  });

  it("LT-7: no ID documents are kept by us; Stripe Identity keeps them", () => {
    expect(privacy).not.toMatch(/ID documents (are stored|stay encrypted)|storage buckets/i);
    expect(privacy).toContain("Stripe Identity checks your government-issued ID");
  });

  it("LT-8: an affiliate-link row discloses third-party (Amazon) cookies", () => {
    const at = privacy.indexOf('title="Affiliate links"');
    expect(at).toBeGreaterThan(privacy.indexOf('anchorId="cookies-tracking"'));
    expect(privacy.slice(at, at + 900)).toMatch(/including Amazon,[\s\S]*place or recognize[\s\S]*cookies/);
  });

  it("S-T1: the evening drop is the seller's step, from DROP_PCT_CHOICES", () => {
    expect(terms).not.toMatch(/drops 5%/);
    const steps = DROP_PCT_CHOICES.map((p) => `${p}%`);
    expect(steps.length).toBeGreaterThan(1);
    expect(terms).toContain(`drops by the step its seller picked (${steps.slice(0, -1).join(", ")} or ${steps.at(-1)})`);
  });

  it("S-T2: porch follows settings and can be changed on a live listing", () => {
    expect(terms).not.toMatch(/can&apos;t be changed after the item is listed/);
    expect(terms).toContain("You can change the ways on a live listing from Manage, then Edit.");
  });

  it("S-T3: trades are written down in the Terms and in Help", () => {
    expect(terms).toContain('<strong className="text-foreground">Trades.</strong>');
    const trade = help.find((x) => x.q === "Can I trade on Declutter?");
    expect(trade?.a).toMatch(/no money changes hands/);
  });

  it("S-H2: a free item is porch pickup, and Help points to Give away free", () => {
    const give = help.find((x) => x.q === "Can I give things away on Declutter?");
    expect(give?.a).toContain('"Give away free"');
    expect(give?.a).not.toMatch(/at your door|tick the box/);
    expect(terms).not.toMatch(/free items may also be picked up at the seller&apos;s door|choose porch pickup or pickup at the seller/i);
    expect(helpText).not.toMatch(/tick the box to give it away/);
  });

  it("JP-02: a guest gets the card-hold promise, not 'charged when you post'", () => {
    const form = code("src/pages/post-job/usePostJobForm.ts");
    expect(form).toMatch(/const cardHoldOn = cardHoldSwitch \|\| isGuest;/);
    expect(form).toMatch(/const isGuest = !authLoading && !user;/);
  });

  it("DB2: both 'Do you have it?' sheets pay the seller after the 24-hour refund window", () => {
    const sd = code("src/components/declutter/SellerDeliveryOrder.tsx");
    const porch = code("src/components/declutter/DeclutterHandoverSheets.tsx");
    expect(sd).not.toMatch(/finishes the sale and the seller is paid/);
    expect(sd).toContain("you still have 24 hours to ask the seller for a refund if something is wrong. Then the sale is final and the seller is paid.");
    expect(porch).toContain("you still have 24 hours to ask {who} for a refund if something is wrong. Then the sale is final and {who} is paid.");
  });
});
