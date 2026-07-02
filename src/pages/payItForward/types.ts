// ─── Local types (until schema is regenerated from live DB) ──────────────────
export type PifCredit = {
  id: string;
  donor_id: string;
  recipient_id: string | null;
  amount: number;
  status: string;
  message: string | null;
  category: string | null;
  parish: string | null;
  job_id: string | null;
  expires_at: string | null;
  created_at: string;
  redeemed_at: string | null;
  donor?: { full_name: string | null } | null;
};
