import { supabase } from "@/integrations/supabase/client";

/**
 * Typed escape hatch for RPCs that aren't in the generated function union
 * yet (the PGRST202 migration-lag pattern — see CLAUDE.md). Keeps each call
 * site's args and row shape type-checked through the generics rather than
 * scattering `supabase.rpc as any` casts. The single `as unknown as` cast
 * is the one explicit boundary where we acknowledge the generated types
 * lag the deployed schema.
 */
export function callUntypedRpc<TArgs extends Record<string, unknown>, TRow = unknown>(
  fn: string,
  args: TArgs,
): Promise<{ data: TRow | null; error: { code?: string } | null }> {
  return (supabase.rpc as unknown as (
    fn: string,
    args: TArgs,
  ) => Promise<{ data: TRow | null; error: { code?: string } | null }>)(fn, args);
}

/** Bid/stake columns on `applications` added by a later migration not yet
    regenerated into the Supabase types (PGRST202 pattern). Optional because
    they're absent on a production DB where the migration hasn't run. */
export type ApplicantBidFields = {
  proposed_price?: number | null;
  negotiation_status?: string | null;
  counter_price?: number | null;
  stake_amount?: number | null;
};
