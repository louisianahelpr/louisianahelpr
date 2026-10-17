import type { JobCategory } from "@/lib/jobCategories";

/**
 * Rentals S1 (docs/specs/landlord-hub-prep.md, maintenance requests): the
 * words and fixed choices the screens use. Pure, no I/O.
 *
 * EXACT: src/test/rentalsErrorCopy.test.ts reads every RAISE EXCEPTION code in
 * the rentals migrations and fails on one with no line here, and on a line
 * here no migration raises.
 */
export const RENTALS_ERROR_COPY: Record<string, string> = {
  feature_disabled: "Rentals isn't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so Rentals is not available right now.",
  under_18: "You must be 18 or older to use Rentals.",
  identity_not_verified: "Verify your ID first. Every landlord on Louisiana Helpr is ID-verified.",
  too_many_properties: "You've added the most properties one account can have.",
  property_not_found: "That property isn't available.",
  already_approved: "This property's ownership is already approved.",
  bad_proof_path: "That file didn't upload. Try adding it again.",
  not_authorized: "Only an admin can do that.",
  decision_required: "Choose approve or reject.",
  reason_required: "Pick a reason. Your tenant will see it.",
  not_pending_review: "This property isn't waiting for a review.",
  too_many_units: "This property has the most units it can have.",
  unit_exists: "This property already has a unit with that name.",
  bad_limit: "Enter an amount between $1 and $10,000, or turn auto-approve off.",
  unit_not_found: "That unit isn't available.",
  ownership_not_approved: "You can invite tenants once an admin has checked your ownership proof.",
  too_many_open_invites: "This unit has 10 open invites. Cancel one first.",
  invite_not_found: "This invite link has expired or was already used. Ask your landlord for a new one.",
  own_invite: "This is your own invite link. Send it to your tenant.",
  tenancy_not_found: "You're no longer listed as a tenant here.",
  bad_urgency: "Choose how urgent it is.",
  bad_category: "Choose what kind of problem it is.",
  bad_description: "Describe the problem in at least 10 characters.",
  too_long: "That's too long. Shorten it and try again.",
  contact_info_not_allowed: "Remove phone numbers, emails and links. Keep the conversation in the app.",
  too_many_photos: "A request can have up to 10 photos.",
  too_many_requests: "You've sent a lot of requests today. Try again tomorrow.",
  bad_photo_path: "A photo didn't upload. Try adding it again.",
  request_not_found: "This request can't be changed now.",
  answer_required: "Choose yes or no.",
  note_too_long: "Keep your note under 500 characters.",
};

/**
 * A Rentals RPC refusal already turned into words at its call site
 * (rpcErrorMessage, RPC_ERROR_COPY in src/lib/lifecycleErrors.ts). `cause` is
 * the original Supabase error; with no mapped words the message stays the raw
 * code, which rentalsErrorMessage maps below.
 */
export class RentalsCopyError extends Error {
  readonly worded: boolean;
  constructor(words: string | null, readonly cause: unknown) {
    super(words ?? (cause && typeof cause === "object" && "message" in cause ? String((cause as { message: unknown }).message) : "error"));
    this.name = "RentalsCopyError";
    this.worded = words != null;
  }
}

/** The server RAISEs the code as the error MESSAGE; show it in plain words. */
export function rentalsErrorMessage(err: unknown): string {
  if (err instanceof RentalsCopyError && err.worded) return err.message;
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  const code = msg.trim();
  return RENTALS_ERROR_COPY[code] ?? "Something went wrong. Please try again.";
}

/**
 * Maintenance categories. `jobCategory` is the job_category the drafted job
 * gets (a prefill: the landlord can change it on Post a Job). Plumbing,
 * electrical and HVAC draft into their trade categories (roadmap T1, landed
 * with trades), so Post a Job shows that trade's licence heads-up and offers
 * "Licensed pros only" (LICENSE_WARNINGS / CREDENTIAL_TIER_CATEGORIES, Q43).
 * Still Handyman, deliberately: "Roof or ceiling leak" (a ceiling leak is as
 * often plumbing as roofing) and "Appliances" (appliance_repair is sales-tax
 * EXEMPT pending the owner's Q1831 while handyman is taxed; drafting it into
 * appliance_repair would drop tax on a likely-taxable repair before she rules).
 */
export const MAINTENANCE_CATEGORIES: ReadonlyArray<{ value: string; label: string; jobCategory: JobCategory }> = [
  { value: "plumbing", label: "Plumbing (leaks, drains, toilets)", jobCategory: "plumbing" },
  { value: "electrical", label: "Electrical (outlets, lights, breakers)", jobCategory: "electrical" },
  { value: "hvac", label: "Heating or air conditioning", jobCategory: "hvac" },
  { value: "appliance", label: "Appliances", jobCategory: "handyman" },
  { value: "repairs", label: "Doors, windows, walls, other repairs", jobCategory: "handyman" },
  { value: "roof", label: "Roof or ceiling leak", jobCategory: "handyman" },
  { value: "pests", label: "Pests", jobCategory: "other" },
  { value: "yard", label: "Yard and outside", jobCategory: "yard_work" },
  { value: "cleaning", label: "Cleaning", jobCategory: "cleaning" },
  { value: "other", label: "Something else", jobCategory: "other" },
];

export function maintenanceCategory(value: string) {
  return MAINTENANCE_CATEGORIES.find((c) => c.value === value) ?? MAINTENANCE_CATEGORIES[MAINTENANCE_CATEGORIES.length - 1];
}

export type Urgency = "emergency" | "soon" | "whenever";

export const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: "Emergency (danger or damage right now)",
  soon: "Soon (in the next few days)",
  whenever: "Whenever (not urgent)",
};

/**
 * Q40 (owner): an emergency first tells the tenant to call 911 or their
 * utility, THEN alerts the landlord. The app never sends a Helpr on its own.
 */
export const EMERGENCY_STEPS: readonly string[] = [
  "If anyone is in danger, there's a fire, or you smell gas: leave and call 911 now.",
  "Gas smell: leave the home, then call your gas company's emergency line from outside.",
  "Sparks, burning smell or a power line down: call 911 and your power company.",
  "Flooding or a burst pipe: shut off the main water valve if you can do it safely.",
  "Sewage backing up: stop using water and call your landlord's emergency number if you have one.",
];

export type DeclineReason = "handle_myself" | "not_my_responsibility" | "already_scheduled" | "other";

/** Q46: the landlord must pick a reason the tenant sees. */
export const DECLINE_REASON_LABEL: Record<DeclineReason, string> = {
  handle_myself: "I'll handle it myself",
  not_my_responsibility: "Not my responsibility under the lease",
  already_scheduled: "Already scheduled",
  other: "Other (explain)",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  submitted: "Waiting for the landlord",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const OWNERSHIP_STATUS_LABEL: Record<string, string> = {
  needs_proof: "Add ownership proof",
  pending_review: "Proof waiting for review",
  // Owner decision 2026-10-17: never which admin; the landlord sees the company.
  approved: "Approved by Louisiana Helpr",
  rejected: "Proof not accepted",
};

/** The link a landlord shares with a tenant. Pure. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/rentals/invite/${token}`;
}

/** Dollars typed by a landlord -> cents, or null when blank/invalid. Pure. */
export function dollarsToCents(input: string): number | null {
  const t = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
