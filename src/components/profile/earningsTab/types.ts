import type { Database } from "@/integrations/supabase/types";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];

export interface PayoutLedgerRow {
  id: string;
  job_id: string;
  amount_cents: number;
  platform_fee_cents: number;
  status: "pending" | "paid" | "failed" | "reversed";
  created_at: string;
  paid_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  stripe_transfer_id: string | null;
  jobs: { title?: string } | null;
}

export interface EarningsTabProps {
  earningsJobs: Job[];
  tips: { amount: number; job_id: string; created_at: string }[];
  loading: boolean;
  onBack: () => void;
  helperId: string;
  helperName: string;
}

export interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival_date: number;
  method: string;
  created: number;
  description: string | null;
}

export interface StripePayoutData {
  connected: boolean;
  payouts_enabled: boolean;
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
  instant_available?: { amount: number; currency: string }[];
  payouts: StripePayout[];
}
