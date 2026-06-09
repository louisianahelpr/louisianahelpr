/**
 * useFeatureFlag — read the live feature flag map from platform_settings.
 *
 * The flags table is small (single row) and rarely changes, so a
 * single fetch + light caching is enough — we don't bother with
 * Supabase realtime here. Each consumer pays one round-trip on its
 * first paint; subsequent components use the in-module cache.
 *
 * Off (`false`) is the assumed default for unknown flags + while the
 * fetch is in flight, so every call site stays a safe no-op until the
 * row has actually loaded. The hook returns `null` for "loading" so
 * surfaces that need a different placeholder UI can branch on it.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

let cache: Record<string, boolean> | null = null;
let inflight: Promise<Record<string, boolean>> | null = null;

const fetchFlags = async (): Promise<Record<string, boolean>> => {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await (supabase.from as any)("platform_settings")
        .select("feature_flags")
        .limit(1)
        .maybeSingle();
      if (error || !data) return {};
      const flags = (data.feature_flags ?? {}) as Record<string, boolean>;
      cache = flags;
      return flags;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

/** Reset the cache — useful in tests + after a settings update. */
export const resetFeatureFlagCache = () => {
  cache = null;
  inflight = null;
};

/**
 * Returns the current boolean value for a flag, or null while loading.
 * Unknown flags resolve to false (safe default).
 */
export const useFeatureFlag = (id: string): boolean | null => {
  const [value, setValue] = useState<boolean | null>(() => (cache ? !!cache[id] : null));

  useEffect(() => {
    let cancelled = false;
    void fetchFlags().then((flags) => {
      if (!cancelled) setValue(!!flags[id]);
    });
    return () => { cancelled = true; };
  }, [id]);

  return value;
};
