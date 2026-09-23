/**
 * The admin console's ONE seed-aware helper (Q233).
 *
 * Seed rows (`is_seed = true`: demo data and e2e journey records on the one
 * prod database) used to sit in Subscriptions, Payouts, Disputes, Tiers and
 * Users looking exactly like real ones, and fed their totals. The rule now:
 *
 *   - a seed row is still SHOWN (an admin may need to find or clean one up),
 *     but always wears <DemoBadge />;
 *   - every total / count tile is computed from non-seed rows only, and its
 *     label says so (DEMO_EXCLUDED_SUFFIX).
 *
 * Only `profiles` and `jobs` carry `is_seed`. Views whose rows come from an
 * RPC or another table resolve the flag through the owning profile or job
 * with fetchSeedUserIds / fetchSeedJobIds (keyed `.in()` reads, bounded by
 * the rows on screen).
 */
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

export interface MaybeSeed {
  is_seed?: boolean | null;
}

export const isSeedRow = (row: MaybeSeed | null | undefined): boolean => row?.is_seed === true;

/** Rows that count toward a total. */
export const realRows = <T extends MaybeSeed>(rows: readonly T[]): T[] => rows.filter((r) => !isSeedRow(r));

/** Appended to every total that excludes seed rows, so the label says what it counts. */
export const DEMO_EXCLUDED_SUFFIX = "(excl. demo)";

/** The user_ids among `userIds` whose profile is a seed profile. */
export async function fetchSeedUserIds(userIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const rows = unwrap(await supabase.from("profiles").select("user_id").in("user_id", ids).eq("is_seed", true));
  return new Set((rows ?? []).map((r) => r.user_id));
}

/** The job ids among `jobIds` that are seed jobs. */
export async function fetchSeedJobIds(jobIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(jobIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const rows = unwrap(await supabase.from("jobs").select("id").in("id", ids).eq("is_seed", true));
  return new Set((rows ?? []).map((r) => r.id));
}

/** The marker every seed row carries in an admin list. */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      data-testid="demo-badge"
      title="Seed / test data (is_seed). Shown here, left out of every total."
      className={`text-ds-10 border-dashed text-muted-foreground ${className}`}
    >
      Demo
    </Badge>
  );
}

/** One line under a stats row: how many demo rows the list shows but the totals skip. */
export function DemoExcludedNote({ count, noun = "row", plural = `${noun}s` }: { count: number; noun?: string; plural?: string }) {
  if (count === 0) return null;
  return (
    <p className="text-ds-11 text-muted-foreground" data-testid="demo-excluded-note">
      {count} demo {count === 1 ? noun : plural} listed below {count === 1 ? "is" : "are"} left out of these totals.
    </p>
  );
}
