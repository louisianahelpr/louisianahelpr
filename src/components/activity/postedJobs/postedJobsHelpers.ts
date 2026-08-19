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

