/**
 * "Sell it for me" (owner order 2026-10-19 ~21Z): a seller who doesn't want
 * to photograph and list things themselves picks who helps:
 *   A. Hire a Helpr: Post a Job opens pre-filled in the "Declutter Help"
 *      category. It is an ordinary paid Helpr job (every Jobs rule and fee).
 *      The Helpr helps in person and never gets the seller's login: they
 *      write the listings in the app on the seller's account, and the seller
 *      approves each one before it goes on sale (LEAD-LIST-FOR-SELLER).
 *   B. Ask a local business: shops in the "Declutter and estate sale
 *      services" category (consignment, estate sales, cleanouts). Shown only
 *      while the 'shops' switch is on for the viewer.
 * Pure words and links only, so the Declutter screens and Post a Job can both
 * import it without pulling either one's code.
 */
import type { JobCategory } from "@/lib/jobCategories";

/** The Post a Job query param that asks for the pre-filled job. */
export const SELL_FOR_ME_PARAM = "sellForMe";

/** Post a Job, pre-filled for a Declutter Help job. */
export function sellForMePostJobPath(): string {
  return `/post-job?${SELL_FOR_ME_PARAM}=1`;
}

/** The job category option A posts in (migration 20261019210635). */
const SELL_FOR_ME_JOB_CATEGORY: JobCategory = "declutter_help";

/** A job posted through option A (any Declutter Help job). */
export function isSellForMeJob(category: string | null | undefined): boolean {
  return category === SELL_FOR_ME_JOB_CATEGORY;
}

/**
 * POST-H3 (posting audit 10-30 #3): the finished job leads to what it was for. The seller's own listings
 * (Declutter, Selling): what sold, and for what didn't, the item's own Lower price, Give it away free and
 * haul-away, which already live there.
 */
export const SELL_FOR_ME_LISTINGS_PATH = "/declutter?tab=selling";

/**
 * LEAD-LIST-FOR-SELLER (lead, 10-31 ~10:30 PM): the Helpr's line while the work is on. The job is done once the Helpr
 * has SENT the listings for the seller's approval (server: completion_requires_listings_sent, 20261101034159). Replaces
 * b51's "once the seller's listings are live" note (849ff74536, unlanded).
 */
export const SELL_FOR_ME_DONE_NOTE = "Mark it done once you've sent the listings to the seller for approval.";

/** The Shops category option B lists (migration 20261019210636). */
export const SELL_FOR_ME_SHOP_CATEGORY = "declutter_estate_sales";

/**
 * The suggested title, in the owner's words (2026-10-30, the sell chooser's "Have a Helpr list it for me").
 * public.jobs caps a title at 32 characters (Q782), so
 * the longer "Photograph and list my items for sale" would not fit.
 */
const SELL_FOR_ME_TITLE = "Help me list my things to sell";

/**
 * What the Helpr does, said in the job itself (audit 10-30 #15). LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM): the
 * Helpr writes the listings in the app on the seller's account (never the seller's login); the seller approves each.
 */
export const SELL_FOR_ME_NO_ACCOUNT_LINE =
  "You take the photos and write the listings in the app, on my account; I approve each one before it goes on sale.";

/**
 * POST-H3 photo hand-off: a Helpr who shoots on their own phone sends the photos in the job's chat (it takes
 * photos: MessageBubble / ChatView attachments); the seller saves them and picks them when posting. No new path.
 */
export const SELL_FOR_ME_PHOTO_LINE = "Photos you take on your phone: send them to me in our job chat.";

/**
 * The description template the poster fills in (under the 1000-character cap). POST-H15 (posting audit 10-30 #15):
 * its three blanks were empty line ends, so Continue went on with all three blank and a Helpr got "How many items:
 * about " and nothing after it. Each blank is a [placeholder] now: Post a Job's details step refuses one left as it
 * is (detailsBlocker's "Replace the [placeholders] to continue") and the field says why.
 */
/**
 * POST-H15 (left part): the blanks (two since POST-H3 took out pickups), each answered in its own field on Post a Job's details step
 * (SellForMeBlanks), which writes the answer into its line of the description. The labels are the lines' own words.
 */
export const SELL_FOR_ME_BLANKS = [
  { key: "count", label: "How many items", placeholder: "[about how many]" },
  { key: "size", label: "Rough size", placeholder: "[small things, furniture or a mix]", choices: ["Small things", "Furniture", "A mix"] },
  // POST-H3 (owner 10-31 ~9:35 PM): no "Also handle pickups with buyers" line. The job is the listings; pickups
  // are the seller's own handovers (or a Helpr delivery booked per order), not part of this job.
] as const;
export type SellForMeBlank = (typeof SELL_FOR_ME_BLANKS)[number];

const blankLine = (b: SellForMeBlank) => new RegExp(`^${b.label}:[ \\t]*(.*)$`, "m");

/** The answer on the blank's line ("" while it is still the [placeholder]); null when the line is gone. */
export function sellForMeBlankValue(description: string, b: SellForMeBlank): string | null {
  const m = blankLine(b).exec(description);
  if (!m) return null;
  const v = m[1].trim();
  return v === b.placeholder ? "" : v;
}

/** The description with the blank's line answered; an empty answer puts the [placeholder] back. Unchanged if the line is gone. */
export function fillSellForMeBlank(description: string, b: SellForMeBlank, value: string): string {
  const v = value.replace(/[\r\n]+/g, " ").trim();
  return description.replace(blankLine(b), () => `${b.label}: ${v || b.placeholder}`);
}

const SELL_FOR_ME_DESCRIPTION = [
  "I'd like help selling things I no longer need on Declutter.",
  "",
  ...SELL_FOR_ME_BLANKS.map((b) => `${b.label}: ${b.placeholder}`),
  "",
  SELL_FOR_ME_PHOTO_LINE,
  SELL_FOR_ME_NO_ACCOUNT_LINE,
].join("\n");

/**
 * POST-H2 (owner 10-31 ~9:35 PM: "Have a Helpr list it shows a suggested price range based on item count, still
 * editable"). What to offer a Helpr to photograph and list about N items, by count: roughly 10 minutes an item at
 * $25-$35 an hour, rounded up, with a $40 floor for one short visit. THE ONE PLACE these numbers live; the price
 * step reads them through sellForMePriceRange and the poster can still type any price.
 */
export const SELL_FOR_ME_PRICE_BANDS: ReadonlyArray<{ upTo: number; low: number; high: number }> = [
  { upTo: 5, low: 40, high: 60 },
  { upTo: 15, low: 60, high: 120 },
  { upTo: 30, low: 120, high: 200 },
  { upTo: Infinity, low: 200, high: 300 },
];

/** The item count from the "How many items" answer ("12", "about 20", "10-15" reads the larger); null with no number. */
export function sellForMeItemCount(answer: string | null | undefined): number | null {
  const nums = (answer ?? "").match(/\d+/g)?.map(Number).filter((n) => n > 0) ?? [];
  return nums.length ? Math.max(...nums) : null;
}

/** The suggested range for about `count` items, and the one-tap pick inside it (the middle, to the nearest $5). */
export function sellForMePriceRange(count: number | null): { low: number; high: number; pick: number } | null {
  if (count == null || !(count > 0)) return null;
  const band = SELL_FOR_ME_PRICE_BANDS.find((b) => count <= b.upTo)!;
  return { low: band.low, high: band.high, pick: Math.round((band.low + band.high) / 10) * 5 };
}

export interface SellForMePrefill {
  category: JobCategory;
  title: string;
  description: string;
}

/** What Post a Job fills in for `?sellForMe=1`. The poster sets the price. */
export function buildSellForMePrefill(): SellForMePrefill {
  return { category: SELL_FOR_ME_JOB_CATEGORY, title: SELL_FOR_ME_TITLE, description: SELL_FOR_ME_DESCRIPTION };
}
