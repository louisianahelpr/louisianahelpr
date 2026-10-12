interface PinnedAccount {
  email: string;
  userId: string;
  label: string;
}
interface UnpinnedAccount {
  email: string;
  userId: null;
  label: string;
}
/** The shared test accounts; their pinned auth ids live here and nowhere else (Q1650). */
export const ACCOUNTS: Record<"poster" | "helper" | "poster-e2e" | "helper-e2e", PinnedAccount> &
  Record<"incomplete-e2e" | "admin-e2e", UnpinnedAccount>;
