/**
 * Polish audit 1127 #17 and #18 (owner-requested phone polish audit, ~/.lh-shots/polish-audit-1127/FINDINGS.md):
 *   #17: the Black Friday / Cyber Monday deal cards were ~375px tall and the Black Friday page ~30,000px on a phone. One
 *        compact card (12px padding, a 120px photo, the offer 14px/1.35, the end date 12px), with nothing cut off,
 *        and every card of every section shows (owner rule: everything on the guide and deal pages is expanded, never
 *        collapsed or cut short; lead 11-27: no "Show all" cap).
 *   #18: the deal text repeated itself ("Black Friday" 83 times on the Black Friday page, the end date, the code and the
 *        brand twice, ELEMIS "through Cyber Monday" beside "Ends Dec 12"). A store sale's text is the offer only: the
 *        generator (scripts/gift-guide-deals.mjs dealTextProblem) refuses a row that names the day, a date, its own code
 *        or its brand, or runs past DEAL_TEXT_MAX characters, so new deals follow the rule too.
 * The rule is the generator's, so it covers every row of the shipped file (the shared deal card on Black Friday and Cyber
 * Monday); the Sam's Club and Small Business Saturday pages use their own cards.
 *
 * @mutate scripts/gift-guide-deals.mjs | if (DAY_NAME.test(text)) return | if (false) return
 * @mutate scripts/gift-guide-deals.mjs | if (DATE_WORDS.test(text)) return | if (false) return
 * @mutate scripts/gift-guide-deals.mjs | if (r.code && text.toLowerCase().includes(String(r.code).toLowerCase())) return | if (false) return
 * @mutate scripts/gift-guide-deals.mjs | if (text.replace(BRAND_NAMED_REWARDS, "").toLowerCase().includes(String(r.brand).toLowerCase())) return | if (false) return
 * @mutate scripts/gift-guide-deals.mjs | if (problem) throw new Error | if (false) throw new Error
 * @mutate src/content/giftGuideDeals.json | "deal":"Up to 50% off on Amazon" | "deal":"Up to 50% off Lancôme on Amazon"
 * @mutate src/content/giftGuideDeals.json | "deal":"30% off best sellers on Amazon" | "deal":"Black Friday through Cyber Monday on Amazon: 30% off ELEMIS best sellers"
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | line-height:1.35;color:var(--gg-ink);overflow-wrap:anywhere} | line-height:1.35;color:var(--gg-ink);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | justify-content:center;height:120px;flex:none; | justify-content:center;aspect-ratio:1/1;
 * @mutate src/lib/giftGuideOfferCopy.mjs | const t = raw.replace(DAY_PAREN, "").replace(DAY_LEAD, "") | const t = raw
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | className="gg-card-sale">{offerOnly(x.offer)}</GiftOut> | className="gg-card-sale">{x.offer}</GiftOut>
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DEALS from "@/content/giftGuideDeals.json";
import { DEALS_WORDS, dealDay, isSteal, type Deal } from "@/content/giftGuideDeals.mjs";
import { DEAL_TEXT_MAX, buildDeals, dealTextProblem, type SourceDeal } from "../../scripts/gift-guide-deals.mjs";
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { offerOnly } from "@/lib/giftGuideOfferCopy.mjs";

const deals = DEALS as Deal[];
const SOURCE = JSON.parse(readFileSync("scripts/gift-guide-deals-1121.json", "utf8")) as { deals: SourceDeal[] };
const src = (p: string) => readFileSync(p, "utf8");

afterEach(() => cleanup());

describe("polish audit 1127 #18: a store sale's text is the offer only", () => {
  it("every shipped store sale and every source row passes the rule", () => {
    const stores = deals.filter((d) => !isSteal(d));
    expect(stores.length).toBeGreaterThan(60);
    expect(stores.map((d) => [d.brand, d.event, dealTextProblem(d)]).filter((x) => x[2])).toEqual([]);
    const rows = SOURCE.deals.filter((r) => r.kind === undefined);
    expect(rows.length).toBeGreaterThan(60);
    expect(rows.map((r) => [r.brand, r.event, dealTextProblem(r)]).filter((x) => x[2])).toEqual([]);
    // No card on either page says the day: "Black Friday" was on the Black Friday page 83 times.
    expect(stores.filter((d) => /black friday|cyber/i.test(d.deal)).map((d) => d.brand)).toEqual([]);
  });

  it("the rule refuses the audit's own examples (the day, a date, the code, the brand, too long)", () => {
    expect(dealTextProblem({ brand: "ELEMIS", deal: "Black Friday through Cyber Monday on Amazon: 30% off ELEMIS best sellers" })).toMatch(/day/);
    expect(dealTextProblem({ brand: "Momentous", code: "BFCM", deal: "Up to 40% off sitewide, plus free gifts at $125 and $175, through Dec 1" })).toMatch(/date/);
    expect(dealTextProblem({ brand: "FREYRS Eyewear", deal: "Nov 27 to Dec 2: 25% off all sunglasses" })).toMatch(/date/);
    expect(dealTextProblem({ brand: "Aurate", code: "BF30", deal: "30% off everything with code BF30" })).toMatch(/code/);
    expect(dealTextProblem({ brand: "Lancôme", deal: "Up to 50% off Lancôme on Amazon" })).toMatch(/brand/);
    expect(dealTextProblem({ brand: "X", deal: "a".repeat(DEAL_TEXT_MAX + 1) })).toMatch(/longer/);
    // Kohl's Cash is the reward's name, not the brand repeated; a plain offer is clean.
    expect(dealTextProblem({ brand: "Kohl's", code: "TAKE20", deal: "Extra 20% off with the code, plus $15 Kohl's Cash per $50" })).toBe("");
    expect(dealTextProblem({ brand: "Lancôme", deal: "Up to 50% off on Amazon" })).toBe("");
  });

  it("a one-day deal carries its day in the date line, not the text (CAKES Body's Cyber Monday-only bra)", () => {
    expect(DEALS_WORDS.runs("2026-11-30", "2026-11-30")).toBe("Nov 30 only");
    expect(DEALS_WORDS.runs("2026-11-27", "2026-11-30")).toBe("Nov 27 – Nov 30");
    const cakes = deals.find((d) => d.event === "cyber-monday" && d.brand === "CAKES Body");
    expect(cakes).toMatchObject({ starts: "2026-11-30", ends: "2026-11-30" });
    expect(cakes!.deal).toContain("Cleavage bra 30% off");
  });

  it("the generator refuses a row that breaks it, so a new deal follows the rule", () => {
    const row = (deal: string): SourceDeal => ({ event: "black-friday", brand: "Acme", deal, href: "https://go.shopmy.us/p-1", commission: 1, source: "https://acme.com", checked: "2026-11-27", seen: "x" });
    expect(() => buildDeals([row("Black Friday Sale: 30% off")])).toThrow(/names the sale day/);
    expect(buildDeals([row("30% off sitewide")]).map((d) => d.deal)).toEqual(["30% off sitewide"]);
  });
});

describe("polish audit 1127 #17: compact deal cards and capped sections", () => {
  it("one compact card: 12px padding, a 120px photo, the offer 14px/1.35; no deal text is clamped or cut off", () => {
    const css = src("src/pages/info/giftGuides/GiftGuideDeals.tsx");
    expect(css).toContain("padding:12px;border:1px solid var(--gg-line);border-radius:14px");
    expect(css).toContain(".gg-deal-photo{display:flex;align-items:center;justify-content:center;height:120px;flex:none;");
    expect(css).toContain(".gg-deal-text{margin:0;font-size:14px;line-height:1.35;color:var(--gg-ink);overflow-wrap:anywhere}");
    // Owner rule (lead 11-27): never hide deal text, so no clamp and no ellipsis on the deal or code/sale cards.
    const cardRules = (css + src("src/pages/info/giftGuides/GiftGuideDealCards.tsx")).split("\n").filter((l) => /\.gg-(deal|card|store-card)/.test(l) && !/gg-banner/.test(l));
    expect(cardRules.length).toBeGreaterThan(10);
    expect(cardRules.filter((l) => /line-clamp|text-overflow:ellipsis/.test(l))).toEqual([]);
    expect(css).toContain(".gg-deal-brand{margin:2px 0 0;font-size:15px;font-weight:700;");
  });

  it("Black Friday: every section shows every card, open, with no cap or Show all button", async () => {
    const BF = dealDay("black-friday")!;
    const today = "2026-11-27";
    const { container } = render(<MemoryRouter><GiftGuideDeals day={BF} now={new Date(`${today}T18:00:00Z`)} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector("[data-gift-deal-list]")).not.toBeNull());
    const grid = container.querySelector('[data-gift-deal-sub="deals"] ul.gg-deal-grid')!;
    const stores = deals.filter((d) => d.event === "black-friday" && !isSteal(d)).length;
    expect(stores).toBeGreaterThan(12);
    expect(grid.querySelectorAll(":scope > li").length).toBeGreaterThan(12);
    expect(container.querySelector("[data-gift-show-all], [data-gift-capped]")).toBeNull();
    const css = src("src/pages/info/giftGuides/GiftGuideDealCards.tsx") + src("src/pages/info/giftGuides/GiftGuideDeals.tsx");
    expect(css).not.toMatch(/nth-child\(n\+\d+\)\{display:none\}/);
    expect(css).not.toContain("Show all");
  });
});

describe("polish audit 1127 #18: code and sale lines drop the day's name on their cards", () => {
  it("offerOnly takes off '(Black Friday)' and a leading 'Black Friday ...:' and keeps the rest; the cards use it", () => {
    expect(offerOnly("25% off everything (Black Friday)")).toBe("25% off everything");
    expect(offerOnly("25% off sitewide, no code needed (Black Friday + Cyber Monday)")).toBe("25% off sitewide, no code needed");
    expect(offerOnly("Early Black Friday sale: up to 50% off eligible styles")).toBe("Up to 50% off eligible styles");
    expect(offerOnly("Black Friday through Cyber Monday: paddles 40% off")).toBe("Paddles 40% off");
    // Mid-sentence words and a line that is only the day's name stay.
    expect(offerOnly("Save up to 50% on Black Friday early access")).toBe("Save up to 50% on Black Friday early access");
    expect(offerOnly("Black Friday Deals")).toBe("Black Friday Deals");
    const cards = src("src/pages/info/giftGuides/GiftGuideDealCards.tsx");
    expect(cards).toContain('<span className="gg-card-offer">{offerOnly(c.offer)}</span>');
    expect(cards).toContain('className="gg-card-sale">{offerOnly(x.offer)}</GiftOut>');
  });
});
