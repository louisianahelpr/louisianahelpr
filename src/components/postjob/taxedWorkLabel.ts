import { TAXABLE_CATEGORIES } from "@/lib/salesTax";

/** The poster's Q2083 answer as the work it names (jobs.tax_kind; item_repair reads "Fixing an item"). */
const TAXED_KIND_WORK: Record<string, string> = {
  fabric_cleaning: "Cleaning carpet, rugs or furniture",
  clothes_cleaning: "Washing or cleaning clothes",
  clothing_alterations: "Altering clothes",
};

/**
 * What the checkout's tax note says is taxed: a taxed category names itself
 * ("Auto Repair is taxable labor"); otherwise the poster's tax_kind answer does.
 * `subject` opens the ZIP-pending note: "This category" or "This job".
 *
 * Moved from CheckoutStep: the note was hardcoded to "Assembly" until
 * 2026-09-04, though TAXABLE_CATEGORIES covered more than assembly, so a
 * Handyman checkout told the poster "Assembly is taxable labor", a category
 * their job wasn't (caught live posting a Handyman job). It names the job's
 * own category, or since Q2083 the poster's own answer.
 */
export function taxedWork(category: string, categoryLabel: string, taxKind: string | null) {
  const byCategory = TAXABLE_CATEGORIES.has(category);
  return {
    subject: byCategory ? "This category" : "This job",
    work: byCategory ? categoryLabel : TAXED_KIND_WORK[taxKind ?? ""] ?? "Fixing an item",
  };
}
