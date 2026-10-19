/**
 * Homes rent paid IN THE APP by bank, with autopay (owner D2/D7/D9; 20261019103751). DRAFT: Stripe TEST
 * mode only until the owner and LREC say yes; the server refuses everything else (rent-bank-checkout).
 * Nothing here marks rent paid: only the bank's confirmation (the webhook) does.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { RentalsCopyError } from "./copy";

export type FeePayer = "tenant" | "landlord";
export interface BankState {
  bank_pay: boolean;
  fee_payer: FeePayer;
  /** Landlord only: whether their payouts are on (bank pay needs them). */
  payouts_ready: boolean | null;
  autopay: { enabled: boolean; bank_label?: string | null };
  in_flight: { status: "open" | "processing"; rent_cents: number; charge_cents: number; started_at: string } | null;
}

export async function fetchBankState(tenancyId: string): Promise<BankState> {
  const { data, error } = await supabase.rpc("rentals_bank_state", { p_tenancy_id: tenancyId });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_bank_state", error), error);
  const s = (data ?? {}) as unknown as Partial<BankState>;
  return {
    bank_pay: s.bank_pay ?? false,
    fee_payer: s.fee_payer === "landlord" ? "landlord" : "tenant",
    payouts_ready: s.payouts_ready ?? null,
    autopay: s.autopay ?? { enabled: false },
    in_flight: s.in_flight ?? null,
  };
}

export async function setBankPay(tenancyId: string, enabled: boolean, feePayer: FeePayer): Promise<void> {
  const { error } = await supabase.rpc("rentals_set_bank_pay", { p_tenancy_id: tenancyId, p_enabled: enabled, p_fee_payer: feePayer });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_set_bank_pay", error), error);
}

export async function setAutopay(tenancyId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("rentals_set_autopay", { p_tenancy_id: tenancyId, p_enabled: enabled });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_set_autopay", error), error);
}

/**
 * The bank cost: Stripe's ACH price, 0.8% of the charge rounded up, at most $5 (the server's
 * rentals_bank_fee_cents, same integer math). Paid by the tenant, the charge is rent + fee, so the fee is
 * grossed up: ceil(rent / 124). Paid by the landlord: ceil(rent / 125).
 */
export function bankFeeCents(cents: number, feePayer: FeePayer): number {
  if (cents <= 0) return 0;
  return Math.min(Math.ceil(cents / (feePayer === "tenant" ? 124 : 125)), 500);
}

async function invokeBank(fn: "rent-bank-checkout" | "rent-bank-autopay", body: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const parsed: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.clone().json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: the generic words are shown.
          console.warn("[rent-bank] error body was not JSON", parseErr);
          return null;
        })
      : null;
    throw new Error(typeof parsed?.error === "string" && parsed.error ? parsed.error : "bank_unavailable");
  }
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("bank_unavailable");
  return url;
}

/** Opens Stripe's page to save the bank autopay debits (nothing is charged); autopay is then turned on here. */
export async function saveAutopayBank(tenancyId: string): Promise<void> {
  await openExternalUrl(await invokeBank("rent-bank-autopay", { action: "save", tenancy_id: tenancyId }));
}

/** Opens Stripe's bank page for the amount; the server freezes the amounts and refuses anything not allowed. */
export async function payRentByBank(tenancyId: string, amountCents: number): Promise<void> {
  await openExternalUrl(await invokeBank("rent-bank-checkout", { action: "pay", tenancy_id: tenancyId, amount_cents: amountCents }));
}
