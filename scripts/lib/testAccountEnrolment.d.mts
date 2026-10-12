export const SHARED_TEST_ACCOUNTS: string[];
export function isSharedTestAccount(email: unknown): boolean;
export function findUnenrolled<T extends { user_id?: string | null }>(
  profiles: readonly T[] | null | undefined,
  enrolledRows: readonly { user_id?: string | null }[] | null | undefined,
): T[];
export function ensureTestAccountsEnrolled(o: {
  supabaseUrl: string;
  serviceKey: string;
  userIds: string[];
  note: string;
  fetchImpl?: typeof fetch;
}): Promise<{ checked: number; added: string[] }>;
