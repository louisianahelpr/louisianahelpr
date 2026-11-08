import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { report } from "@/lib/errorLogger";
import { takeGuestSectionsOpen } from "@/lib/declutter/guestBootPrefetch";

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

/** Retries after the first failed read (H2, audit 11-08). Exported for the guard. */
export const SECTIONS_OPEN_RETRIES = 2;
/** Backoff before retry n (0-based): 600 ms, then 1200 ms. */
export function sectionsOpenRetryDelay(attempt: number): number {
  return 600 * 2 ** attempt;
}

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
    // Q2705: a guest's cold /declutter asked this from the entry (src/boot/guestDeclutterPrefetch.ts); taken once,
    // before the Supabase chunk is even imported.
    const fromBoot = await takeGuestSectionsOpen();
    if (fromBoot) return fromBoot;
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
    // H2 (Declutter buy audit 11-08): one dropped request (Facebook's in-app browser on a phone signal) sent a guest
    // on a public item link to the login wall. Two retries with backoff (0.6 s, then 1.2 s) before it settles failed.
    retry: SECTIONS_OPEN_RETRIES,
    retryDelay: sectionsOpenRetryDelay,
    meta: { persist: false, reportsItself: true },
  });
}

/**
 * `open` is null until settled; a failed read settles EMPTY (every switched section "coming soon"). `failed` says the
 * read failed (after its retries), so a caller that must FAIL OPEN can tell "not open" from "no answer": the Declutter
 * guest gate shows the public item rather than the login wall (H2, audit 11-08; the server still refuses a guest read
 * while Declutter is not open to everyone).
 */
export function useSectionsOpen(start: boolean): { open: ReadonlySet<string> | null; settled: boolean; failed: boolean } {
  const q = useSectionsOpenQuery(start);
  if (q.isSuccess) return { open: new Set(q.data ?? []), settled: true, failed: false };
  if (q.isError) return { open: new Set(), settled: true, failed: true };
  return { open: null, settled: false, failed: false };
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
