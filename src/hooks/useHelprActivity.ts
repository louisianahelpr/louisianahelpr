import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Two-sided liquidity signal — gives a poster an honest confidence cue
// that the other side of the marketplace is alive before they pay.
//
// The number comes from get_parish_activity, an already-deployed
// SECURITY DEFINER RPC whose `helper_count` is the count of helprs who
// have *worked at least one job in that parish* and are approved + not
// banned. That is a real, conservative figure — not a vanity metric —
// so the copy is worded to match exactly what was queried ("helprs
// who've worked in <Parish>"), never "active near you this week".
//
// Honesty over coverage: if there's no parish, no matching row, or the
// count is too thin to be meaningful, the hook returns null and the UI
// shows nothing rather than inventing a number.

// Below this we'd rather show nothing than a number that reads as
// "the marketplace is empty here". A single-digit parish is better
// served by silence than a discouraging "2 helprs".
const MIN_MEANINGFUL_COUNT = 3;

export interface HelprActivity {
  /** Helprs who have worked at least one job in this parish. */
  count: number;
  /** The parish the count is scoped to — drives the copy. */
  parish: string;
}

/**
 * Resolves a parish-scoped count of experienced helprs for the
 * posting/checkout confidence line.
 *
 * @param parish The poster's parish (derived from zip). Null disables.
 */
export function useHelprActivity(parish: string | null): {
  activity: HelprActivity | null;
  loading: boolean;
} {
  const [activity, setActivity] = useState<HelprActivity | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!parish) {
      setActivity(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // p_limit is generous — the RPC ranks parishes by activity, so
        // a quiet parish can sit well down the list; 64 covers every
        // Louisiana parish so the poster's own is never truncated out.
        const { data, error } = await supabase.rpc("get_parish_activity", {
          p_limit: 64,
        });
        if (cancelled) return;

        if (error || !Array.isArray(data)) {
          // RPC missing or errored — degrade silently to no signal.
          setActivity(null);
          return;
        }

        const row = data.find(
          (r) => (r.parish ?? "").toLowerCase() === parish.toLowerCase(),
        );
        const count = row?.helper_count ?? 0;

        if (!row || count < MIN_MEANINGFUL_COUNT) {
          setActivity(null);
          return;
        }

        setActivity({ count, parish: row.parish });
      } catch {
        if (!cancelled) setActivity(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parish]);

  return { activity, loading };
}
