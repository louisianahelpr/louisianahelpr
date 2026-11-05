/**
 * M14 (audit 1105, Shops): an LLC or corporation could not be paid, because
 * stripe-connect created every Express account with
 * `business_type: "individual"`. Payout setup now lets a member say "this is a
 * registered business (LLC or corporation)" and name it; the NEW account is
 * then created as `business_type: "company"` with `company.name`, and Stripe's
 * onboarding collects the EIN and the representative.
 *
 * Only a new account reads this. An account already on file keeps its type:
 * nothing here deletes or converts one.
 *
 * Guard: src/test/edge/stripeConnectCompanyAccount.test.ts.
 */

export type ConnectBusiness =
  | { type: "individual" }
  | { type: "company"; name: string };

const COMPANY_NAME_MIN = 2;
const COMPANY_NAME_MAX = 120;

const BUSINESS_TYPE_UNKNOWN = "Pick an individual or a registered business.";
const COMPANY_NAME_INVALID = "Enter your business's legal name (2 to 120 characters).";

/**
 * Reads the business choice from an onboard/reset body. A missing or
 * "individual" choice is an individual account (old app builds send nothing).
 * "company" needs a legal name of 2 to 120 characters; anything else is
 * `{ invalid }` with the sentence to show, so no account is ever created as a
 * company with no name, or as an individual when the member asked for a
 * company.
 */
export function connectBusinessFrom(
  body: { business_type?: unknown; company_name?: unknown } | null | undefined,
): ConnectBusiness | { invalid: string } {
  const raw = body?.business_type;
  if (raw === undefined || raw === null || raw === "individual") return { type: "individual" };
  if (raw !== "company") return { invalid: BUSINESS_TYPE_UNKNOWN };
  const name = typeof body?.company_name === "string" ? body.company_name.trim().replace(/\s+/g, " ") : "";
  if (name.length < COMPANY_NAME_MIN || name.length > COMPANY_NAME_MAX) {
    return { invalid: COMPANY_NAME_INVALID };
  }
  return { type: "company", name };
}
