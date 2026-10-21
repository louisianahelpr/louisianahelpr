import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
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

/** Exported so FeatureSwitchesCard re-reads it after an admin changes a switch. */
export const SECTIONS_OPEN_QUERY_KEY = ["features-open-to-everyone"] as const;

let reported = false;
/** One report per page session, whatever the failure count. Exported for the guard. */
export function reportSectionsOpenFailureOnce(error: unknown): boolean {
  if (reported) return false;
  reported = true;
  report(error, { severity: "warning", tags: { source: "landing.features_open_to_everyone" } });
  return true;
}

/** null = the RPC is not deployed yet: no answer (the landing reads it as empty, the Preview mark as unknown). */
async function fetchSectionsOpen(): Promise<string[] | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const res = await supabase.rpc("features_open_to_everyone");
    if (isMissingRpcNamed(res.error, "features_open_to_everyone")) return null;
    const data = unwrap(res);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    reportSectionsOpenFailureOnce(error);
    throw error; // the hook settles EMPTY: every switched section "coming soon"
  }
}

function useSectionsOpenQuery(start: boolean) {
  return useQuery({
    queryKey: SECTIONS_OPEN_QUERY_KEY,
    queryFn: fetchSectionsOpen,
    enabled: start,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { persist: false, reportsItself: true },
  });
}

/** `open` is null until settled; a failed read settles EMPTY (every switched section "coming soon"). */
export function useSectionsOpen(start: boolean): { open: ReadonlySet<string> | null; settled: boolean } {
  const q = useSectionsOpenQuery(start);
  if (q.isSuccess) return { open: new Set(q.data ?? []), settled: true };
  if (q.isError) return { open: new Set(), settled: true };
  return { open: null, settled: false };
}

/**
 * The same answer for the signed-in app's "Preview" mark (useSectionTabs): the
 * switches open to everyone, but ONLY from a successful answer of the deployed
 * RPC. null while loading, after any failure (a failed refetch too: isSuccess
 * turns false), and while the RPC is not deployed. Unlike useSectionsOpen it
 * never settles a failure as EMPTY: an empty set would mark every live section
 * a preview, for members too.
 */
export function useOpenToEveryoneAnswer(start: boolean): ReadonlySet<string> | null {
  const q = useSectionsOpenQuery(start);
  return q.isSuccess && q.data !== null ? new Set(q.data) : null;
}
