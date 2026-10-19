/**
 * HOMES lease: OUR Louisiana residential lease template, the only lease Homes offers (owner D4,
 * 2026-10-18; docs/specs/lease-template-draft.md APPROVED AS WRITTEN 2026-10-18 ~20:05Z).
 *
 * The landlord fills the blanks (`LEASE_FIELDS`); `renderLease` turns the blanks into the lease's exact
 * words. Both sides render the same words from the stored blanks, so the landlord's app sends the sha256
 * of the text it showed and the tenant's app must send the same hash to sign (rentals_lease_sign,
 * lease_changed otherwise).
 *
 * A VERSION'S WORDS NEVER CHANGE once shipped: a signed lease is re-rendered from its version for its PDF
 * forever. To change the wording, add a new version (and keep this one). Pinned by
 * src/test/rentalsLeaseTemplate.test.ts (the sha256 of a fixed fill of each version).
 *
 * Left out of the lease on purpose (they are drafting notes, not lease terms): each section's
 * "Legal basis" note, the "How to use it" line, and the application-fee notice (no application fees at
 * launch, owner D3/D5). Plain ASCII only: the PDF's built-in fonts are Latin-1.
 */

export const LEASE_TEMPLATE_VERSION = "la-2026-10-14";

type LeaseFieldValue = string | boolean;
export type LeaseFields = Record<string, LeaseFieldValue>;

export type LeaseStepId = "parties" | "term" | "money" | "living" | "rules" | "legal" | "disclosures";

export const LEASE_STEPS: { id: LeaseStepId; title: string; hint: string }[] = [
  { id: "parties", title: "Who and where", hint: "The names on the lease and the home." },
  { id: "term", title: "Dates", hint: "When it starts and ends." },
  { id: "money", title: "Rent and deposit", hint: "What is due, when, and late fees." },
  { id: "living", title: "Living there", hint: "Utilities, who lives there, appliances, pets." },
  { id: "rules", title: "Rules and repairs", hint: "House rules, upkeep, entry and keys." },
  { id: "legal", title: "Notices and options", hint: "How notices are sent and the optional clauses." },
  { id: "disclosures", title: "Disclosures", hint: "Lead paint, foreclosure and flood." },
];

export interface LeaseField {
  key: string;
  label: string;
  kind: "text" | "long" | "date" | "money" | "number" | "choice" | "yes";
  step: LeaseStepId;
  options?: { value: string; label: string }[];
  /** Shown under the input. */
  hint?: string;
  /** A default the form starts with (never a guess about the home: only the template's own suggestions). */
  initial?: LeaseFieldValue;
  /** Only asked when this returns true. */
  showIf?: (f: LeaseFields) => boolean;
  /** Optional blanks may stay empty; everything shown is required otherwise. */
  optional?: boolean;
}

const yes = (f: LeaseFields, k: string) => f[k] === true;
const is = (f: LeaseFields, k: string, v: string) => f[k] === v;

/** The clauses the template has both sides INITIAL, when chosen, in the lease's own order. The server's
 *  rentals_lease_initial_keys lists the same keys (src/test/rentalsLeaseRequired.test.ts compares them sorted). */
export const LEASE_INITIALED: { key: string; label: string }[] = [
  { key: "as_is", label: "Section 8: the listed appliances are \"as is\"." },
  { key: "notice_waiver", label: "Section 19: the tenant waives the five-day notice to vacate." },
  { key: "assume_condition", label: "Section 24: the tenant takes responsibility for the condition of the home." },
  { key: "built_before_1978", label: "Addendum 1: the lead information listed and the EPA pamphlet were given." },
];

/** The keys this lease's signers must initial (the server compares them as a set). */
export function leaseInitialKeys(f: LeaseFields): string[] {
  return LEASE_INITIALED.filter((c) => f[c.key] === true).map((c) => c.key);
}

export const LEASE_FIELDS: LeaseField[] = [
  // Who and where
  { key: "lease_date", label: "Date of this lease", kind: "date", step: "parties" },
  { key: "landlord_name", label: "Landlord's full legal name or business name", kind: "text", step: "parties" },
  { key: "tenant_names", label: "Tenant full name(s)", kind: "text", step: "parties", hint: "Every adult tenant, separated by commas." },
  { key: "home_address", label: "Home address (street, city, LA, ZIP)", kind: "text", step: "parties" },
  { key: "home_type", label: "Kind of home", kind: "choice", step: "parties", options: [
    { value: "house", label: "House" }, { value: "duplex unit", label: "Duplex unit" }, { value: "apartment", label: "Apartment" }] },
  { key: "bedrooms", label: "Bedrooms", kind: "number", step: "parties" },
  { key: "bathrooms", label: "Bathrooms", kind: "number", step: "parties" },
  { key: "home_includes", label: "Also included", kind: "text", step: "parties", hint: "Yard, driveway, storage, or \"nothing else\"." },
  // Dates
  { key: "term_kind", label: "Kind of lease", kind: "choice", step: "term", options: [
    { value: "fixed", label: "Fixed term" }, { value: "monthly", label: "Month to month" }] },
  { key: "start_date", label: "Start date", kind: "date", step: "term" },
  { key: "end_date", label: "End date", kind: "date", step: "term", showIf: (f) => is(f, "term_kind", "fixed") },
  { key: "monthly_notice_days", label: "Days of written notice to end a month-to-month lease", kind: "number", step: "term", initial: "30",
    hint: "Louisiana requires at least 10." },
  { key: "early_move_in", label: "Tenant may move in early", kind: "yes", step: "term", initial: false },
  { key: "early_move_in_date", label: "Early move-in date", kind: "date", step: "term", showIf: (f) => yes(f, "early_move_in") },
  { key: "early_move_in_rent", label: "Rent for those days", kind: "text", step: "term", showIf: (f) => yes(f, "early_move_in"), hint: "An amount, or \"none\"." },
  // Rent and deposit
  { key: "rent_amount", label: "Monthly rent", kind: "money", step: "money" },
  { key: "rent_due_day", label: "Rent is due on day", kind: "number", step: "money", initial: "1" },
  { key: "pay_methods", label: "How rent is paid", kind: "text", step: "money", hint: "For example Zelle, check, cash." },
  { key: "payee", label: "Paid to", kind: "text", step: "money", hint: "A name or account label. Never put bank numbers in the lease." },
  { key: "first_rent_amount", label: "First month's rent", kind: "money", step: "money" },
  { key: "first_rent_due", label: "First month's rent is due", kind: "text", step: "money", initial: "at signing", hint: "\"at signing\" or a date." },
  { key: "partial_month", label: "Rent for a partial first month", kind: "text", step: "money", initial: "prorated daily" },
  { key: "late_after_day", label: "Rent is late after the end of day", kind: "number", step: "money", initial: "5" },
  { key: "late_fee", label: "Late fee", kind: "money", step: "money" },
  { key: "daily_late", label: "Add a daily late fee after that", kind: "yes", step: "money", initial: false },
  { key: "daily_late_amount", label: "Daily late fee", kind: "money", step: "money", showIf: (f) => yes(f, "daily_late") },
  { key: "late_fee_cap", label: "Total late fees in any one month never exceed", kind: "text", step: "money",
    hint: "An amount or a percent of one month's rent." },
  { key: "returned_payment_fee", label: "Returned payment fee", kind: "text", step: "money",
    initial: "$25 or 5% of the payment, whichever is greater", hint: "For a check this is the legal maximum." },
  { key: "deposit_amount", label: "Security deposit", kind: "money", step: "money" },
  { key: "deposit_due", label: "Deposit is due", kind: "text", step: "money", initial: "at signing" },
  // Living there
  { key: "tenant_utilities", label: "Utilities the tenant pays and puts in their name", kind: "text", step: "living",
    hint: "Electric, gas, water, sewer, trash, internet..." },
  { key: "landlord_utilities", label: "Utilities the landlord pays", kind: "text", step: "living", initial: "none" },
  { key: "occupants", label: "Other people who will live there", kind: "text", step: "living", hint: "Names only, or \"none\"." },
  { key: "guest_days_row", label: "Most days in a row a guest may stay", kind: "number", step: "living", initial: "14" },
  { key: "guest_days_six_months", label: "Most guest days in any 6 months", kind: "number", step: "living" },
  { key: "emergency_contact", label: "Emergency contact (name, phone; not living there)", kind: "text", step: "living" },
  { key: "furnishings", label: "Furnished?", kind: "text", step: "living", initial: "unfurnished", hint: "\"unfurnished\" or \"furnished:\" and a list." },
  { key: "appliances", label: "Appliances the landlord provides", kind: "text", step: "living" },
  { key: "tenant_supplies", label: "The tenant supplies", kind: "text", step: "living", initial: "none" },
  { key: "as_is", label: "Some appliances are \"as is\" (initialed by both)", kind: "yes", step: "living", initial: false },
  { key: "as_is_items", label: "As-is items", kind: "text", step: "living", showIf: (f) => yes(f, "as_is"), hint: "For example washer, dryer, window AC unit." },
  { key: "checklist_days", label: "Days after move-in to complete the condition checklist", kind: "number", step: "living", initial: "5" },
  { key: "pets_allowed", label: "Pets allowed", kind: "yes", step: "living", initial: false },
  { key: "pet_list", label: "Approved pet(s): type, breed, name, about how heavy", kind: "text", step: "living", showIf: (f) => yes(f, "pets_allowed") },
  { key: "pet_max", label: "Most pets", kind: "number", step: "living", showIf: (f) => yes(f, "pets_allowed") },
  { key: "pet_weight_limit", label: "Weight limit", kind: "text", step: "living", showIf: (f) => yes(f, "pets_allowed"), initial: "none" },
  { key: "pet_fee", label: "Non-refundable pet fee", kind: "text", step: "living", showIf: (f) => yes(f, "pets_allowed"), initial: "none" },
  { key: "pet_deposit", label: "Refundable pet deposit", kind: "text", step: "living", showIf: (f) => yes(f, "pets_allowed"), initial: "none" },
  { key: "pet_rent", label: "Monthly pet rent", kind: "text", step: "living", showIf: (f) => yes(f, "pets_allowed"), initial: "none" },
  // Rules and repairs
  { key: "no_smoking_property", label: "No smoking anywhere on the property (not only inside)", kind: "yes", step: "rules", initial: false },
  { key: "picture_hooks_ok", label: "Small picture hooks are fine", kind: "yes", step: "rules", initial: true },
  { key: "extra_rules", label: "Additional house rules", kind: "long", step: "rules", initial: "None" },
  { key: "ac_landlord", label: "The landlord repairs the air conditioning", kind: "yes", step: "rules", initial: true },
  { key: "lawn", label: "Lawn care", kind: "text", step: "rules", initial: "Landlord provides lawn care",
    hint: "\"Tenant mows at least every __ days\" or \"Landlord provides lawn care\"." },
  { key: "filter_days", label: "Tenant replaces HVAC filters every (days)", kind: "number", step: "rules", initial: "30" },
  { key: "filters_supplied", label: "The landlord supplies the filters", kind: "yes", step: "rules", initial: false },
  { key: "pest_control", label: "Routine pest control", kind: "choice", step: "rules", options: [
    { value: "Tenant", label: "Tenant" }, { value: "Landlord", label: "Landlord" }] },
  { key: "detector_locations", label: "Smoke and CO detector locations", kind: "text", step: "rules" },
  { key: "entry_notice_hours", label: "Hours of notice before the landlord enters", kind: "number", step: "rules", initial: "24" },
  { key: "key_count", label: "Keys, fobs or codes given", kind: "number", step: "rules" },
  { key: "key_cost", label: "Replacement cost each", kind: "money", step: "rules" },
  // Notices and options
  { key: "landlord_contact", label: "Landlord's phone or email for everyday matters", kind: "text", step: "legal" },
  { key: "tenant_contact", label: "Tenant's phone or email for everyday matters", kind: "text", step: "legal" },
  { key: "landlord_address", label: "Landlord's address for formal paper notices", kind: "text", step: "legal" },
  { key: "sale_ends_lease", label: "A new owner may end the lease with notice if the home is sold", kind: "yes", step: "legal", initial: false },
  { key: "sale_notice_days", label: "Days of notice from a new owner", kind: "number", step: "legal", initial: "30", showIf: (f) => yes(f, "sale_ends_lease") },
  { key: "early_exit", label: "Offer a paid early exit", kind: "yes", step: "legal", initial: false },
  { key: "early_exit_days", label: "Days of written notice for the early exit", kind: "number", step: "legal", initial: "30", showIf: (f) => yes(f, "early_exit") },
  { key: "early_exit_fee", label: "Early-termination fee", kind: "money", step: "legal", showIf: (f) => yes(f, "early_exit") },
  { key: "insurance", label: "Renter's insurance", kind: "choice", step: "legal", options: [
    { value: "recommended", label: "Recommended" }, { value: "required", label: "Required" }] },
  { key: "insurance_liability", label: "Liability coverage of at least", kind: "money", step: "legal", showIf: (f) => is(f, "insurance", "required") },
  { key: "insurance_proof_due", label: "Proof of insurance due", kind: "date", step: "legal", showIf: (f) => is(f, "insurance", "required") },
  { key: "accelerate", label: "If the lease is kept in force after a default, the landlord may sue for all remaining rent at once", kind: "yes", step: "legal", initial: false },
  { key: "notice_waiver", label: "Tenant waives the five-day notice to vacate (initialed by both)", kind: "yes", step: "legal", initial: false },
  { key: "federal_mortgage", label: "The home has a federally backed mortgage or is in a federal housing program", kind: "yes", step: "legal", initial: false,
    hint: "Fannie Mae, Freddie Mac, FHA, VA or USDA. Then 30 days' notice to vacate always applies." },
  { key: "holdover_amount", label: "Holdover charge per day", kind: "text", step: "legal", hint: "An amount per day, or a percent of daily rent." },
  { key: "assume_condition", label: "Tenant takes responsibility for the condition of the home (initialed by both)", kind: "yes", step: "legal", initial: false },
  { key: "additional_terms", label: "Additional terms", kind: "long", step: "legal", initial: "None" },
  // Disclosures
  { key: "built_before_1978", label: "The home was built before 1978", kind: "yes", step: "disclosures", initial: false,
    hint: "Then the lead-based paint disclosure is added, and the tenant must get the EPA pamphlet before signing." },
  { key: "lead_known", label: "Lead-based paint", kind: "choice", step: "disclosures", showIf: (f) => yes(f, "built_before_1978"), options: [
    { value: "known", label: "Known lead-based paint or hazards are present" }, { value: "none", label: "No knowledge of lead-based paint or hazards" }] },
  { key: "lead_details", label: "Explain (basis, location, condition of painted surfaces)", kind: "long", step: "disclosures",
    showIf: (f) => yes(f, "built_before_1978") && is(f, "lead_known", "known") },
  { key: "lead_records", label: "Lead records and reports", kind: "choice", step: "disclosures", showIf: (f) => yes(f, "built_before_1978"), options: [
    { value: "provided", label: "All available records were given to the tenant" }, { value: "none", label: "No records or reports" }] },
  { key: "lead_records_list", label: "List the documents", kind: "long", step: "disclosures",
    showIf: (f) => yes(f, "built_before_1978") && is(f, "lead_records", "provided") },
  { key: "foreclosure", label: "Foreclosure", kind: "choice", step: "disclosures", options: [
    { value: "none", label: "Not subject to any pending foreclosure" }, { value: "pending", label: "Subject to a pending foreclosure" }] },
  { key: "foreclosure_details", label: "Court, case name and docket number", kind: "text", step: "disclosures", showIf: (f) => is(f, "foreclosure", "pending") },
  { key: "flood_disclosure", label: "Add the flood and water disclosure (optional)", kind: "yes", step: "disclosures", initial: true },
  { key: "flood_zone", label: "In a FEMA special flood hazard area?", kind: "choice", step: "disclosures", showIf: (f) => yes(f, "flood_disclosure"), options: [
    { value: "Yes", label: "Yes" }, { value: "No", label: "No" }, { value: "Unknown", label: "Unknown" }] },
  { key: "flood_source", label: "Source checked", kind: "text", step: "disclosures", showIf: (f) => yes(f, "flood_disclosure"), initial: "FEMA map" },
  { key: "flooded_before", label: "Has the home flooded or had significant water damage?", kind: "choice", step: "disclosures",
    showIf: (f) => yes(f, "flood_disclosure"), options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] },
  { key: "flooded_details", label: "Flood details", kind: "text", step: "disclosures", showIf: (f) => yes(f, "flood_disclosure") && is(f, "flooded_before", "Yes") },
  { key: "mold", label: "Is there current mold or moisture?", kind: "choice", step: "disclosures",
    showIf: (f) => yes(f, "flood_disclosure"), options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] },
  { key: "mold_details", label: "Mold details", kind: "text", step: "disclosures", showIf: (f) => yes(f, "flood_disclosure") && is(f, "mold", "Yes") },
];

const FIELD_BY_KEY = new Map(LEASE_FIELDS.map((f) => [f.key, f]));

/** The form's starting blanks: the template's own suggested values. */
export function initialLeaseFields(): LeaseFields {
  const out: LeaseFields = {};
  for (const f of LEASE_FIELDS) if (f.initial !== undefined) out[f.key] = f.initial;
  return out;
}

export function isFieldShown(field: LeaseField, f: LeaseFields): boolean {
  return field.showIf ? field.showIf(f) : true;
}

function filled(field: LeaseField, v: LeaseFieldValue | undefined): boolean {
  if (field.kind === "yes") return typeof v === "boolean";
  if (typeof v !== "string" || v.trim() === "") return false;
  if (field.kind === "money") return parseMoney(v) !== null;
  if (field.kind === "number") return /^\d{1,4}(\.\d)?$/.test(v.trim());
  if (field.kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
  if (field.kind === "choice") return !!field.options?.some((o) => o.value === v);
  return true;
}

/** Blanks still to fill (shown, required, empty or malformed), in form order. */
export function missingLeaseFields(f: LeaseFields): LeaseField[] {
  return LEASE_FIELDS.filter((field) => isFieldShown(field, f) && !field.optional && !filled(field, f[field.key]));
}

/**
 * Typed text as plain printable ASCII (lead review #4): the PDF's built-in fonts are Latin-1 and the server
 * refuses anything else, so what is hashed, stored, shown and printed is the same characters. Curly quotes
 * become straight, dashes a hyphen, accents drop (Jose), other symbols a "?"; line breaks stay (long blanks).
 */
export function normalizeLeaseText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000\t]/g, " ")
    .replace(/\r\n?/g, "\n")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

/** A typed signature: normalised and its spaces tidied (the server's rentals_lease_signature does the same). */
export function normalizeSignature(s: string): string {
  return normalizeLeaseText(s).replace(/\s+/g, " ").trim();
}

/** Only the shown blanks are kept (a hidden one never reaches the stored lease); text is normalised. */
export function cleanLeaseFields(f: LeaseFields): LeaseFields {
  const out: LeaseFields = {};
  for (const field of LEASE_FIELDS) {
    const v = f[field.key];
    if (!isFieldShown(field, f) || v === undefined) continue;
    out[field.key] = typeof v === "string" ? normalizeLeaseText(v).trim() : v;
  }
  return out;
}

function parseMoney(v: string): number | null {
  const s = v.replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function ordinal(n: string): string {
  const k = Number(n);
  if (!Number.isFinite(k)) return n;
  const s = k % 100 >= 11 && k % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[k % 10] ?? "th";
  return `${k}${s}`;
}

export interface LeaseSection {
  heading: string;
  paragraphs: string[];
}

/**
 * The lease's exact words for these blanks. A blank not filled reads "[not filled]" (the send button
 * stays off until none is left, missingLeaseFields).
 */
export function renderLease(input: LeaseFields): LeaseSection[] {
  const f = cleanLeaseFields(input);
  const raw = (k: string): string => {
    const v = f[k];
    return typeof v === "string" && v !== "" ? v : "[not filled]";
  };
  const v = (k: string): string => {
    const field = FIELD_BY_KEY.get(k);
    const s = raw(k);
    if (s === "[not filled]" || !field) return s;
    if (field.kind === "money") { const c = parseMoney(s); return c === null ? s : money(c); }
    if (field.kind === "date") return longDate(s);
    return s;
  };
  const on = (k: string) => f[k] === true;
  const sections: LeaseSection[] = [];
  const add = (heading: string, ...paragraphs: (string | false | null | undefined)[]) =>
    sections.push({ heading, paragraphs: paragraphs.filter((p): p is string => typeof p === "string" && p !== "") });

  add("RESIDENTIAL LEASE AGREEMENT (State of Louisiana)",
    `This lease is made on ${v("lease_date")} between ${v("landlord_name")} ("Landlord") and ${v("tenant_names")} ("Tenant"; if more than one, each of them). Landlord and Tenant agree as follows. This lease is governed by Louisiana law, including the Louisiana Civil Code articles on lease (arts. 2668-2729) and La. R.S. 9:3251-3261.2.`);

  add("1. The home",
    `Landlord leases to Tenant the home at ${v("home_address")} (the "Home"): a ${v("home_type")} with ${v("bedrooms")} bedrooms and ${v("bathrooms")} bathrooms, including ${v("home_includes")}. The Home is for use as a private residence only.`);

  add("2. Term",
    f.term_kind === "fixed"
      ? `Fixed term: begins ${v("start_date")} and ends ${v("end_date")}. The lease ends on the end date automatically; no notice is needed.`
      : `Month-to-month: begins ${v("start_date")} and continues month to month.`,
    on("early_move_in") && `Early move-in: Tenant may move in on ${v("early_move_in_date")}. Rent for those days is ${v("early_move_in_rent")}.`,
    `After a fixed term ends: if Tenant stays more than one week after the end date and neither party has objected in writing, the lease continues month to month on these same terms. Either party may end a month-to-month lease with written notice at least ${v("monthly_notice_days")} days before the end of a monthly period. To prevent the automatic month-to-month, either party may give written notice before the end date that the lease will not continue.`);

  add("3. Rent",
    `Rent is ${v("rent_amount")} per month, due in advance on the ${ordinal(raw("rent_due_day"))} day of each month. Pay by ${v("pay_methods")} to ${v("payee")}. The first month's rent of ${v("first_rent_amount")} is due ${v("first_rent_due")}. Rent for a partial first month is ${v("partial_month")}. See the Payment Schedule at the end.`);

  add("4. Late fee and returned payments",
    `Rent is late if not received in full by the end of the ${ordinal(raw("late_after_day"))} day of the month. A late fee of ${v("late_fee")} is then due.`
      + (on("daily_late") ? ` Starting the ${ordinal(String(Number(raw("late_after_day")) + 1))} day, an additional ${v("daily_late_amount")} per day is due until rent is paid.` : "")
      + ` The total late fees for any one month will never exceed ${v("late_fee_cap")}.`,
    `A payment returned unpaid (for example, a bounced check or reversed transfer) incurs a fee of ${v("returned_payment_fee")}, plus any late fee.`);

  add("5. Security deposit",
    `Tenant pays a refundable security deposit of ${v("deposit_amount")}, due ${v("deposit_due")}.`,
    "- Return: Landlord returns the deposit within one month after the lease ends and Tenant gives back possession and keys.",
    "- Deductions: Landlord may keep only what is reasonably needed to cover unpaid rent or other amounts Tenant owes under this lease, or damage beyond normal wear and tear. If Landlord keeps any part, Landlord sends an itemized written list of what was kept and why, within one month after the lease ends (Louisiana law allows up to 15 more days after that month).",
    "- Forwarding address: Tenant gives Landlord a forwarding address in writing at move-out.",
    "- Not last month's rent: Tenant may not use the deposit as rent unless Landlord agrees in writing.",
    "- Abandonment: if Tenant abandons the Home before the lease ends, or without giving the notice this lease requires, the one-month return rule does not apply. Landlord will still account for the deposit.",
    "- Sale of the Home: if the Home is sold, Landlord transfers the deposit to the new owner, who becomes responsible for returning it.");

  add("6. Utilities and services",
    `Tenant pays for and puts in Tenant's name, effective on move-in: ${v("tenant_utilities")}. Landlord pays for: ${v("landlord_utilities")}. Tenant keeps utilities on through move-out, including heat in freezing weather.`);

  add("7. Who lives here; guests",
    `Only Tenant and these occupants may live in the Home: ${v("occupants")}. A guest may stay no more than ${v("guest_days_row")} days in a row or ${v("guest_days_six_months")} days in any 6 months without Landlord's written OK, which Landlord will not unreasonably refuse.`,
    `Emergency contact (not living in the Home): ${v("emergency_contact")}.`);

  add("8. Furnishings and appliances",
    `The Home is ${v("furnishings")}. Landlord provides these appliances, which stay Landlord's property: ${v("appliances")}. Tenant supplies: ${v("tenant_supplies")}.`,
    on("as_is") && `"As-is" appliances (INITIALED by both parties): Landlord does not promise to repair or replace these specific items if they fail: ${v("as_is_items")}. This does NOT apply to any problem that seriously affects health or safety, or to any defect Landlord knew or should have known about. Landlord remains responsible for everything else in Section 12.`);

  add("9. Move-in condition and possession",
    `Within ${v("checklist_days")} days after move-in, Landlord and Tenant together complete and sign the Move-In/Move-Out Condition Checklist (Addendum 3), and each keeps a copy. It is used at move-out to decide deposit deductions.`,
    "If Landlord cannot deliver the Home on the start date, Tenant may cancel this lease in writing and get back all money paid, including any deposit, prepaid rent and application fee.");

  add("10. Pets and assistance animals",
    on("pets_allowed") ? "Pets allowed per the Pet & Assistance-Animal Addendum (Addendum 2)." : "No pets.",
    "An assistance animal (a service animal or emotional-support animal needed because of a disability) is not a pet. Pet rules, pet fees and pet limits do not apply to it. See Addendum 2.");

  add("11. House rules",
    `No smoking or vaping inside the Home${on("no_smoking_property") ? " or anywhere on the property" : ""}. No waterbeds. No swimming pools or trampolines. No dangerous amounts of gasoline, propane, kerosene, fireworks or similar (normal household and grill amounts are fine). No satellite dish mounted on the house (ground mount only). No stickers, nails or screws in walls without written OK${on("picture_hooks_ok") ? " (small picture hooks are fine)" : ""}. Do not flush wipes or pour grease down drains. No inoperable or unregistered vehicles or junk piles in the yard. Tenant follows noise and other local laws and creates no nuisance. Additional rules: ${v("extra_rules")}. New rules apply only if both parties sign them.`);

  add("12. Repairs and upkeep",
    `Landlord keeps the Home in a condition fit for living in and makes all repairs needed for that, except those Tenant causes. This includes the roof, structure, plumbing, electrical, heating, water heater, ${on("ac_landlord") ? "air conditioning, " : ""}and the appliances Landlord provides (subject to any initialed as-is list in Section 8).`,
    "Tenant:",
    "(a) keeps the Home clean and sanitary;",
    "(b) pays to repair damage caused by Tenant, occupants, guests or pets, beyond normal wear and tear;",
    "(c) clears drain or toilet clogs Tenant causes;",
    `(d) lawn: ${v("lawn")};`,
    `(e) replaces HVAC filters every ${v("filter_days")} days (Landlord supplies them: ${on("filters_supplied") ? "yes" : "no"});`,
    "(f) replaces light bulbs;",
    `(g) routine pest control is done by: ${v("pest_control")};`,
    "(h) takes trash out on collection days;",
    "(i) keeps the Home reasonably ventilated, and in freezing weather drips faucets and covers outdoor spigots;",
    "(j) reports in writing, without delay, any leak, water intrusion, mold, damage or needed repair, and is responsible for extra damage caused by not reporting.",
    "How repairs happen: Tenant asks Landlord first (Section 21) and does not hire someone without asking, except in an emergency that threatens health, safety or serious property damage when Landlord cannot be reached. Landlord will repair within a reasonable time after Tenant's request. This lease does not take away any repair right Louisiana law gives Tenant if Landlord fails to repair within a reasonable time after demand.",
    "Alterations: none without Landlord's written OK.");

  add("13. Smoke and carbon monoxide detectors",
    `Before move-in, Landlord installs at least one working ten-year sealed lithium-battery smoke detector and at least one working sealed long-life-battery carbon monoxide detector (a combination unit is fine). Locations: ${v("detector_locations")}. Tenant tests them monthly, never removes or disables them, and reports any failure to Landlord in writing right away. Landlord replaces any unit that fails.`);

  add("14. Landlord entry; locks",
    `Landlord may enter with at least ${v("entry_notice_hours")} hours' notice, at reasonable times, to inspect, repair, or show the Home to buyers, lenders or new tenants. Landlord may enter without notice in an emergency. Tenant does not add or change locks without Landlord's written OK, and gives Landlord a key or code to any approved new lock. Landlord gives Tenant ${v("key_count")} keys, fobs or codes. Replacements cost ${v("key_cost")} each. All keys are returned at move-out, or the replacement cost is deducted.`);

  add("15. Subletting and assignment",
    "Tenant may not sublet, assign, or rent out any part of the Home (including short-term rentals) without Landlord's prior written consent. Consent once is not consent again.");

  add("16. Sale of the Home",
    "If Landlord sells the Home, Landlord tells Tenant the new owner's or manager's contact information.",
    on("sale_ends_lease") && `The new owner may end this lease by written notice to Tenant at least ${v("sale_notice_days")} days in advance, and Tenant's deposit and any prepaid rent are then handled under Section 5.`);

  add("17. Ending the lease early",
    "Tenant's legal rights (always available, never with a fee):",
    "- Military: an active or reserve servicemember (or their spouse) may end the lease under the federal Servicemembers Civil Relief Act (50 U.S.C. 3955) or La. R.S. 9:3261 (for example, change-of-station or deployment orders, discharge, or government quarters). They give written notice with a copy of the orders. No early termination charge applies.",
    "- Sexual assault: a tenant who is a victim may end the lease under La. R.S. 9:3261.2 with the documentation that law requires.",
    "- Domestic abuse: where La. R.S. 9:3261.1 applies (buildings of 6 or more units, with exceptions), a victim may end the lease under that law. This lease never limits or penalizes anyone for calling police or emergency help.",
    on("early_exit")
      ? `Optional paid early exit: Tenant may end a fixed-term lease early by giving at least ${v("early_exit_days")} days' written notice and paying an early-termination fee of ${v("early_exit_fee")}, plus rent through the move-out date. This option never applies to the legal rights listed above.`
      : "There is no paid early exit in this lease. The legal rights above always apply.");

  add("18. Storms, fire and other damage",
    "If a fire, storm, hurricane, flood or other disaster not caused by Tenant:",
    "(a) destroys the Home or makes it unlivable, the lease ends and rent stops as of that date;",
    "(b) partly damages it, Landlord repairs within a reasonable time, and rent is reduced fairly for the part Tenant can't use, or either party may end the lease if the Home can't reasonably be lived in.",
    "Tenant follows evacuation orders and secures the Home and belongings before a storm when reasonably possible. Landlord's insurance does not cover Tenant's belongings. "
      + (f.insurance === "required"
        ? `Renter's insurance is required, with at least ${v("insurance_liability")} of liability coverage, proof due ${v("insurance_proof_due")}.`
        : "Renter's insurance is recommended."));

  add("19. Default and remedies",
    "Tenant is in default if Tenant (a) doesn't pay rent or other money due under this lease when due; (b) materially breaks this lease; (c) abandons the Home; (d) gave materially false information on the rental application; or (e) Tenant, an occupant or a guest commits criminal activity on or near the Home that threatens anyone's health or safety, or involves illegal drugs.",
    "If Tenant defaults, Landlord chooses ONE of these:",
    "1. End the lease and evict. Landlord recovers possession, plus rent and other amounts owed up to the date Landlord gets the Home back, and the cost of damage beyond normal wear. Landlord then gives up future rent. OR",
    `2. Keep the lease in force and sue for rent as it comes due${on("accelerate") ? " (or for all remaining rent at once)" : ""}. Tenant then keeps the right to live in the Home.`,
    on("notice_waiver") && "Waiver of notice to vacate (INITIALED by both parties): Tenant waives the five-day written notice to vacate in Code of Civil Procedure art. 4701. If Tenant's right to occupy ends for any reason, Landlord may immediately file for eviction in court.",
    on("federal_mortgage") && "Federally backed mortgage: the Home has a mortgage backed by Fannie Mae, Freddie Mac, FHA, VA or USDA, or is in a federal housing program. Landlord will give at least 30 days' written notice to vacate before requiring Tenant to leave, and any waiver of notice does not apply to that notice.");

  add("20. Abandonment and items left behind",
    "Landlord treats the Home as abandoned only when Landlord reasonably believes Tenant has left: for example, keys returned, belongings removed, or nobody living there, together with unpaid rent. Before taking possession without a court order, Landlord posts a written notice on the door (and sends one to Tenant's last known address) as Louisiana law requires. In a parish under a federal disaster declaration, Tenant's absence during the first 30 days after the declaration is never treated as abandonment. Items left after Tenant moves out or is lawfully evicted may be removed, stored, and disposed of after any notice the law requires. Reasonable costs may be deducted from the deposit.");

  add("21. Notices and electronic signatures",
    `- Everyday matters (repair requests, entry notices, reminders) may be sent by text or email: Landlord ${v("landlord_contact")}; Tenant ${v("tenant_contact")}.`,
    `- Formal notices (ending the lease, notice to vacate, default, acceleration, right to cure, eviction, foreclosure) are given on paper: hand-delivered, mailed, or attached to the door when the law allows. Landlord's address: ${v("landlord_address")}. Tenant's address: the Home (or the forwarding address after move-out). A copy may also be sent electronically.`,
    "- Notice to or from any one Tenant counts for all Tenants.",
    "- The parties agree to sign this lease and its addenda electronically. Each party may still ask for paper for any later document.");

  add("22. Foreclosure disclosure",
    "Tenant has the right to receive written notice of any foreclosure action against the Home.",
    f.foreclosure === "pending"
      ? `The Home is subject to a pending foreclosure action: ${v("foreclosure_details")}.`
      : "The Home is not currently subject to any pending foreclosure action.",
    "If Landlord is ever served with a notice of seizure in a foreclosure of the Home, Landlord will, within 7 calendar days, give every Tenant a signed written notice naming the court, case name and docket number, with this statement: \"This is not a notice to vacate the premises. This notice does not mean ownership of the building has changed. All lessees are still responsible for payment of rent and other obligations under the rental agreement. The lessor is still responsible for his obligations under the rental agreement. You will receive additional notice if there is a change in owner.\"");

  add("23. Holdover",
    `If Tenant stays after the lease has ended and Landlord has objected in writing, Tenant owes ${v("holdover_amount")} for each day until Tenant leaves. This does not give Tenant any right to stay.`);

  add("24. Liability",
    "Each party is responsible for harm caused by its own fault. Landlord is not responsible for loss of or damage to Tenant's belongings, or for injury, except as caused by Landlord's fault or by a defect Landlord is responsible for under Louisiana law. Tenant is responsible for, and will repay Landlord for, claims caused by Tenant, occupants, guests or pets. Nothing in this lease limits anyone's liability for causing physical injury, or for intentional or gross fault.",
    on("assume_condition") && "Tenant takes responsibility for the condition of the Home (INITIALED by both parties): Tenant assumes responsibility for the condition of the Home. Landlord is then not liable for injury caused by a defect in the Home to Tenant or anyone there through Tenant, unless Landlord knew or should have known of the defect, or was told about it and did not fix it within a reasonable time. This does not change Landlord's repair duties in Section 12.");

  add("25. Fair housing and accommodations",
    "Landlord follows federal and Louisiana fair-housing laws. Tenant may ask at any time for a reasonable accommodation (a change in a rule, policy or service) or a reasonable modification (a physical change to the Home) because of a disability. Landlord will not refuse a reasonable request. Modifications are at Tenant's expense, and Landlord may reasonably require that the inside of the Home be restored at move-out (normal wear excepted). Landlord does not retaliate against Tenant for asserting a legal right, asking for repairs, or contacting a government agency.");

  add("26. Attorney's fees",
    "If either party goes to court to enforce this lease, the winning party may recover reasonable attorney's fees and court costs.");

  add("27. General terms",
    "- Joint responsibility: each Tenant is fully responsible for the whole lease, including all rent.",
    "- No waiver: accepting late or partial rent does not waive any right, and a waiver counts only in writing signed by both parties.",
    "- Severability: if any part is invalid, the rest stays in effect.",
    "- Entire agreement: this lease and its addenda are the whole agreement. Changes count only in writing signed by both parties.",
    "- Good faith: the parties will try in good faith to resolve disputes before going to court.",
    "- Death: this lease does not end on the death of either party.",
    "- Governing law: Louisiana.");

  add("28. Additional terms", v("additional_terms"));

  // The payment schedule: what is due before move-in, from the blanks above.
  const due: [string, string, number | null][] = [
    [v("first_rent_due"), "First month's rent", parseMoney(raw("first_rent_amount"))],
    [v("deposit_due"), "Security deposit", parseMoney(raw("deposit_amount"))],
  ];
  if (on("pets_allowed")) {
    for (const [k, what] of [["pet_fee", "Pet fee"], ["pet_deposit", "Pet deposit"]] as const) {
      const c = parseMoney(raw(k));
      if (c !== null && c > 0) due.push(["at signing", what, c]);
    }
  }
  const total = due.reduce((a, [, , c]) => a + (c ?? 0), 0);
  add("Payment schedule",
    ...due.map(([when, what, c]) => `${what}: ${c === null ? "[not filled]" : money(c)}, due ${when}.`),
    `Total due before move-in: ${money(total)}.`);

  if (on("built_before_1978")) {
    add("ADDENDUM 1: Disclosure of Information on Lead-Based Paint and/or Lead-Based Paint Hazards",
      "Lead Warning Statement: Housing built before 1978 may contain lead-based paint. Lead from paint, paint chips, and dust can pose health hazards if not managed properly. Lead exposure is especially harmful to young children and pregnant women. Before renting pre-1978 housing, lessors must disclose the presence of known lead-based paint and/or lead-based paint hazards in the dwelling. Lessees must also receive a federally approved pamphlet on lead poisoning prevention.",
      "Lessor's Disclosure:",
      f.lead_known === "known"
        ? `(a) Known lead-based paint and/or lead-based paint hazards are present in the housing: ${v("lead_details")}`
        : "(a) Lessor has no knowledge of lead-based paint and/or lead-based paint hazards in the housing.",
      f.lead_records === "provided"
        ? `(b) Lessor has provided the lessee with all available records and reports pertaining to lead-based paint and/or lead-based paint hazards in the housing: ${v("lead_records_list")}`
        : "(b) Lessor has no reports or records pertaining to lead-based paint and/or lead-based paint hazards in the housing.",
      "Lessee's Acknowledgment (initialed by the Tenant by signing):",
      "(c) Lessee has received copies of all information listed above.",
      "(d) Lessee has received the pamphlet Protect Your Family From Lead in Your Home.",
      "Certification of Accuracy: The following parties have reviewed the information above and certify, to the best of their knowledge, that the information they have provided is true and accurate. (Signed with the signatures below.)");
  }

  add("ADDENDUM 2: Pet & Assistance-Animal Addendum",
    on("pets_allowed") && `Part A: Pets. Approved pet(s): ${v("pet_list")}. Maximum number: ${v("pet_max")}. Weight limit: ${v("pet_weight_limit")}. Non-refundable pet fee: ${v("pet_fee")}. Refundable pet deposit: ${v("pet_deposit")} (refundable pet deposits follow the Section 5 rules). Monthly pet rent: ${v("pet_rent")}.`,
    on("pets_allowed") && "Tenant: keeps vaccinations and any required licenses current; keeps pets leashed or controlled outside; cleans up waste daily indoors and out; prevents nuisance noise; and pays for all damage, cleaning and pest treatment the pet causes beyond normal wear. Landlord may revoke pet permission after written notice of a repeated, uncorrected violation. New pets need written OK.",
    "Part B: Assistance animals (service animals and emotional-support animals)",
    "- An assistance animal is not a pet. No pet fee, pet deposit, pet rent, breed or weight limit applies.",
    "- Tenant may request one at any time. If the disability or the need for the animal is not obvious, Landlord may ask for reliable information showing the need. Landlord will not ask for a diagnosis or medical records.",
    "- Tenant is still responsible for the animal's care and control, and for actual damage it causes beyond normal wear, like any other damage under the lease.",
    "- Landlord may deny a specific animal only as fair-housing law allows (for example, a direct threat to others' safety that cannot be reduced, or serious property damage).");

  add("ADDENDUM 3: Move-In / Move-Out Condition Checklist",
    `Complete at move-in (within ${v("checklist_days")} days) and again at move-out. Both parties sign each time, and each keeps a copy. Take dated photos or video of every room both times. Condition codes: N new, G good, F fair (worn), P poor/damaged, NA not present. Describe any damage in the notes.`,
    ...CHECKLIST_AREAS.map((a) => `- ${a}: move-in ____ notes ____ / move-out ____ notes ____ / charge? ____`),
    "Move-in: Landlord ________ Date ______  Tenant ________ Date ______",
    "Move-out: Landlord ________ Date ______  Tenant ________ Date ______",
    "Tenant forwarding address for the deposit: ________________");

  if (on("flood_disclosure")) {
    add("ADDENDUM 4: Flood & Water Disclosure",
      `- Is the Home in a FEMA special flood hazard area? ${v("flood_zone")} (source checked: ${v("flood_source")})`,
      `- To Landlord's knowledge, has the Home flooded or had significant water damage? ${f.flooded_before === "Yes" ? `Yes: ${v("flooded_details")}` : v("flooded_before")}`,
      `- To Landlord's knowledge, is there current mold or moisture? ${f.mold === "Yes" ? `Yes: ${v("mold_details")}` : v("mold")}`,
      "Landlord's insurance does not cover Tenant's belongings. Tenant is encouraged to buy renter's and flood coverage.");
  }
  return sections;
}

const CHECKLIST_AREAS = [
  "Entry / living room: door and locks, walls, ceiling, floor/carpet, windows and screens, blinds, lights and switches, outlets",
  "Kitchen: cabinets, counters, sink/faucet, disposal, refrigerator, stove/oven, dishwasher, microwave, floor, walls",
  "Bedroom 1: door, walls, ceiling, floor/carpet, closet, windows/screens/blinds, lights, outlets",
  "Bedroom 2 (same items)",
  "Bedroom __ (same items)",
  "Bathroom 1: toilet, sink/faucet, tub/shower, tile/caulk, mirror/cabinet, exhaust fan, floor",
  "Bathroom __ (same items)",
  "Laundry: hookups, washer/dryer (if provided), dryer vent",
  "Heating/AC: unit works, thermostat, filter changed (date)",
  "Water heater: works, no leaks",
  "Smoke detectors (sealed 10-year): locations, tested OK",
  "CO detector(s) (sealed): locations, tested OK",
  "Exterior: siding, gutters, porch/steps, doors, outdoor spigots",
  "Yard / driveway / fence",
  "Keys / fobs / codes: number given / returned",
  "Other: ________",
];

/** The lease's words as one text: what both signatures cover (its sha256 is stored and must match). */
export function leaseText(sections: LeaseSection[]): string {
  return sections.map((s) => [s.heading, ...s.paragraphs].join("\n")).join("\n\n");
}

/** Lower-case hex sha256 of the UTF-8 text. */
export async function leaseSha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every template version the app can still render (a signed lease keeps its version forever). */
export const LEASE_TEMPLATES: Record<string, (f: LeaseFields) => LeaseSection[]> = {
  [LEASE_TEMPLATE_VERSION]: renderLease,
};
