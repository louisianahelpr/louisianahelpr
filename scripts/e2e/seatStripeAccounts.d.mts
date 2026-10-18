export const RESET_FIELDS: Readonly<{
  stripe_account_id: null;
  stripe_payouts_enabled: false;
  stripe_charges_enabled: false;
  stripe_identity_verified: false;
}>;
export const SANCTIONED_TEST_CONNECT_ACCOUNTS: Readonly<Record<string, string>>;
export const SEAT_COLUMNS: string;
export type SeatRow = {
  user_id: string;
  email?: string | null;
  is_seed?: boolean | null;
  stripe_account_id?: string | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_identity_verified?: boolean | null;
  idv_status?: string | null;
};
export function seatPayoutReady(row: SeatRow): boolean;
export function stripeSeatViolations(rows: Array<SeatRow | null | undefined>): string[];
