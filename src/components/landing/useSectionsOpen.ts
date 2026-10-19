import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpc } from "@/lib/missingRpc";
import { report } from "@/lib/errorLogger";

/**
 * Which section switches are open to EVERYONE (owner, 2026-10-19: the landing
 * says "coming soon" only on sections not yet open to everyone). Asked once,
 * when `start` turns true (the sections block is in view, never at first
 * paint), so the Supabase chunk never joins the landing's first paint (see
 * HeroSection's deferred auth check for the same reason).
 *
 * FAILS CLOSED: until the answer is in, and on any failure, a section reads
 * "coming soon", never open (lead review, 2026-10-19). Guard:
 * src/test/landingFrontDoor.test.tsx (the pure decision below).
 *
 * Never persisted (`meta.persist: false`): a 24h disk copy could show a section
 * open before, or after, its switch says so. A missing RPC (PGRST202) is a
 * quiet empty answer; any other failure is reported here AT MOST ONCE per page
 * session (`meta.reportsItself` keeps the global QueryCache reporter off it),
 * so one bad deploy cannot log an error for every signed-out visit.
 */

/** The pure decision: is this section shown as "coming soon"? `open` is null while the answer is pending. */
export function sectionIsComingSoon(feature: string | null, open: ReadonlySet<string> | null): boolean {
  if (feature === null) return false; // Jobs has no switch: always open
  return open === null || !open.has(feature);
}

const SECTIONS_OPEN_QUERY_KEY = ["features-open-to-everyone"] as const;

let reported = false;
/** One report per page session, whatever the failure count. Exported for the guard. */
export function reportSectionsOpenFailureOnce(error: unknown): boolean {
  if (reported) return false;
  reported = true;
  report(error, { severity: "warning", tags: { source: "landing.features_open_to_everyone" } });
  return true;
}

async function fetchSectionsOpen(): Promise<string[]> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const res = await supabase.rpc("features_open_to_everyone");
    if (isMissingRpc(res.error)) return [];
    const data = unwrap(res);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    reportSectionsOpenFailureOnce(error);
    throw error; // the hook settles EMPTY: every switched section "coming soon"
  }
}

/** `open` is null until settled; a failed read settles EMPTY (every switched section "coming soon"). */
export function useSectionsOpen(start: boolean): { open: ReadonlySet<string> | null; settled: boolean } {
  const q = useQuery({
    queryKey: SECTIONS_OPEN_QUERY_KEY,
    queryFn: fetchSectionsOpen,
    enabled: start,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { persist: false, reportsItself: true },
  });
  if (q.isSuccess) return { open: new Set(q.data), settled: true };
  if (q.isError) return { open: new Set(), settled: true };
  return { open: null, settled: false };
}
