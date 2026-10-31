/**
 * "Sell it for me" (owner order 2026-10-19 ~21Z): a seller who doesn't want
 * to photograph and list things themselves picks who helps:
 *   A. Hire a Helpr: Post a Job opens pre-filled in the "Declutter Help"
 *      category. It is an ordinary paid Helpr job (every Jobs rule and fee).
 *      The Helpr helps in person and never gets the seller's account: the
 *      seller posts the listings from their own account.
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

/** The Shops category option B lists (migration 20261019210636). */
export const SELL_FOR_ME_SHOP_CATEGORY = "declutter_estate_sales";

/**
 * The suggested title, in the owner's words (2026-10-30, the sell chooser's "Have a Helpr list it for me").
 * public.jobs caps a title at 32 characters (Q782), so
 * the longer "Photograph and list my items for sale" would not fit.
 */
const SELL_FOR_ME_TITLE = "Help me list my things to sell";

/** The no-account-access promise, said in the job itself (owner 2026-10-19), to the Helpr who reads it (audit 10-30 #15). */
export const SELL_FOR_ME_NO_ACCOUNT_LINE =
  "You help take the photos and write the listings; I post them from my account.";

/** The description template the poster fills in (under the 1000-character cap). */
const SELL_FOR_ME_DESCRIPTION = [
  "I'd like help selling things I no longer need on Declutter.",
  "",
  "How many items: about ",
  "Rough size (small things, furniture or a mix): ",
  "Also handle pickups with buyers (yes or no): ",
  "",
  SELL_FOR_ME_NO_ACCOUNT_LINE,
].join("\n");

export interface SellForMePrefill {
  category: JobCategory;
  title: string;
  description: string;
}

/** What Post a Job fills in for `?sellForMe=1`. The poster sets the price. */
export function buildSellForMePrefill(): SellForMePrefill {
  return { category: SELL_FOR_ME_JOB_CATEGORY, title: SELL_FOR_ME_TITLE, description: SELL_FOR_ME_DESCRIPTION };
}
