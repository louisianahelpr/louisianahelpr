export const RESET_FIELDS: Readonly<{
  stripe_account_id: null;
  stripe_payouts_enabled: false;
  stripe_charges_enabled: false;
  stripe_identity_verified: false;
}>;
export function stripeSeatViolations(
  rows: Array<{ user_id: string; email?: string | null; stripe_account_id?: string | null } | null | undefined>,
): string[];
