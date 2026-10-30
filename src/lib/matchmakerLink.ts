/**
 * Matchmaker links (owner-approved growth item, B59, 2026-10-29).
 *
 * The owner answers "anyone know a handyman?" posts on Facebook and Nextdoor
 * with a link that opens Post a job already filled in: category, a short
 * description, town/ZIP and a price. Whoever taps it lands at Details (after
 * signup if needed, through ProtectedRoute's redirect), checks it and posts.
 * Nothing is stored server-side: the link carries the fields, and every value
 * is re-checked on read (category from the real list, text trimmed and capped,
 * ZIP five digits, price a whole number of dollars in range), so a hand-edited
 * link can only ever pre-fill a normal, editable form.
 */
import { JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import { MAX_JOB_BUDGET_DOLLARS } from "@/lib/moneyLimits";

/** The flag param. Also the key Post a job reads to skip its entry screen and open Details. */
export const MATCHMAKER_PARAM = "mm";

const ORIGIN = "https://www.louisianahelpr.com";
const TITLE_MAX = 80;
const DESC_MAX = 500;
const TOWN_MAX = 60;

export interface MatchmakerFields {
  category: JobCategory;
  title: string;
  description: string;
  town: string;
  zip: string;
  /** Whole dollars; null = the poster sets it. */
  price: number | null;
}

function tidy(value: string | null | undefined, max: number): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return (value ?? "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function isCategory(value: string | null): value is JobCategory {
  return !!value && Object.prototype.hasOwnProperty.call(JOB_CATEGORY_LABELS, value);
}

function toPrice(value: string | number | null | undefined): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_JOB_BUDGET_DOLLARS) return null;
  return n;
}

/** The link for a set of fields (the admin builder). */
export function buildMatchmakerLink(f: MatchmakerFields): string {
  const q = new URLSearchParams();
  q.set(MATCHMAKER_PARAM, "1");
  q.set("cat", f.category);
  const title = tidy(f.title, TITLE_MAX);
  if (title) q.set("t", title);
  const desc = tidy(f.description, DESC_MAX);
  if (desc) q.set("d", desc);
  const town = tidy(f.town, TOWN_MAX);
  if (town) q.set("town", town);
  if (/^\d{5}$/.test(f.zip.trim())) q.set("zip", f.zip.trim());
  const price = toPrice(f.price);
  if (price !== null) q.set("price", String(price));
  return `${ORIGIN}/post-job?${q.toString()}`;
}

/** Read a matchmaker link's fields back, re-checking each one. null = not a matchmaker link, or no valid category. */
export function readMatchmakerLink(params: URLSearchParams): MatchmakerFields | null {
  if (params.get(MATCHMAKER_PARAM) !== "1") return null;
  const category = params.get("cat");
  if (!isCategory(category)) return null;
  const zip = (params.get("zip") ?? "").trim();
  return {
    category,
    title: tidy(params.get("t"), TITLE_MAX) || JOB_CATEGORY_LABELS[category],
    description: tidy(params.get("d"), DESC_MAX),
    town: tidy(params.get("town"), TOWN_MAX),
    zip: /^\d{5}$/.test(zip) ? zip : "",
    price: toPrice(params.get("price")),
  };
}

/** The one-line preview the admin sees, and the share text. */
export function matchmakerSummary(f: Pick<MatchmakerFields, "category" | "title" | "town" | "price">): string {
  const where = f.town ? ` in ${f.town}` : "";
  const price = f.price !== null ? ` · $${f.price}` : "";
  return `${tidy(f.title, TITLE_MAX) || JOB_CATEGORY_LABELS[f.category]}${where}${price}`;
}
