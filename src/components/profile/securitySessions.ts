import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { useFeedPhase } from "@/hooks/useFeedPhase";

/**
 * Security tab's recent sign-ins: the device-label parser and the session
 * read, out of SecurityTab.tsx (Q571 paid for its offline state by moving
 * these here; componentSizeRatchet).
 */
interface LoginHistoryRow {
  id: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

interface SessionGroup {
  fingerprint: string;
  label: string;
  icon: "phone" | "tablet" | "desktop";
  lastSeenAt: string;
  count: number;
  ipAddress: string | null;
}

// Coarse device fingerprint from a User-Agent string. Two sessions on
// the same physical device produce identical labels (e.g. "iPhone ·
// Safari") so we group instead of listing N near-duplicate rows.
export function parseUserAgent(ua: string | null): { label: string; icon: SessionGroup["icon"] } {
  if (!ua) return { label: "Unknown device", icon: "desktop" };
  const lower = ua.toLowerCase();
  let device = "Desktop";
  let icon: SessionGroup["icon"] = "desktop";
  if (lower.includes("iphone")) { device = "iPhone"; icon = "phone"; }
  else if (lower.includes("ipad")) { device = "iPad"; icon = "tablet"; }
  else if (lower.includes("android")) {
    device = lower.includes("mobile") ? "Android phone" : "Android tablet";
    icon = device.includes("tablet") ? "tablet" : "phone";
  } else if (lower.includes("macintosh") || lower.includes("mac os")) device = "Mac";
  else if (lower.includes("windows")) device = "Windows PC";
  else if (lower.includes("linux")) device = "Linux PC";

  // Browser hint — keeps two devices that share a chassis distinguishable.
  //
  // ORDER MATTERS, and it used to be wrong. The native shell is a WKWebView,
  // whose UA is Safari's with our own token appended — so it satisfies BOTH
  // the Safari test and this one. With the app test last, Safari always won
  // and a user's own phone was listed as a browser in their session list,
  // which is actively misleading on a screen people read to spot intrusions.
  // The app test now runs FIRST, so the more specific match wins.
  //
  // The token comes from `appendUserAgent: 'HelprApp'` in capacitor.config.ts.
  // Before that existed this branch was unreachable no matter where it sat.
  let browser = "";
  if (lower.includes("helprapp") || lower.includes("capacitor")) browser = "Helpr app";
  else if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/") && !lower.includes("chromium")) browser = "Chrome";
  else if (lower.includes("firefox")) browser = "Firefox";
  else if (lower.includes("safari") && !lower.includes("chrome")) browser = "Safari";

  const label = browser ? `${device} · ${browser}` : device;
  return { label, icon };
}

/** The grouped login_history read, plus whether it failed or is offline with nothing. */
export function useSecuritySessions() {
  // Set when the login_history fetch itself fails, so the empty state can
  // tell "genuinely no sessions" apart from "we couldn't load them" —
  // previously both rendered the identical "No recent sessions" copy.
  const [sessionsFetchFailed, setSessionsFetchFailed] = useState(false);

  // Recent sessions, grouped by device fingerprint. login_history is
  // append-only (one row per SIGNED_IN), so we collapse to the most
  // recent N device fingerprints rather than show every login.
  const { data: sessionGroups = [], isLoading: sessionsLoading, status: sessionsStatus, fetchStatus: sessionsFetchStatus } = useQuery<SessionGroup[]>({
    queryKey: ["security", "sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("login_history")
        .select("id, created_at, ip_address, user_agent")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        // Non-blocking: a failed fetch shows an empty list (handled
        // below), not a red error state — sessions are informational
        // and a transient read failure shouldn't shout. Still report it
        // so a real outage is visible to us, and flag it locally so the
        // empty state can say so instead of implying "no sessions ever".
        report(error, { tags: { source: "SecurityTab.sessions" } });
        setSessionsFetchFailed(true);
        return [];
      }
      setSessionsFetchFailed(false);
      const rows = (data as LoginHistoryRow[]) ?? [];
      const groups = new Map<string, SessionGroup>();
      rows.forEach((r) => {
        const { label, icon } = parseUserAgent(r.user_agent);
        const fingerprint = `${label}|${r.ip_address ?? ""}`;
        const existing = groups.get(fingerprint);
        if (existing) {
          existing.count += 1;
          // First row in (most recent first) already set lastSeenAt.
        } else {
          groups.set(fingerprint, {
            fingerprint,
            label,
            icon,
            lastSeenAt: r.created_at,
            count: 1,
            ipAddress: r.ip_address,
          });
        }
      });
      // Most recent first, cap at 5 — anything older is informational
      // noise (sessions roll on every login).
      return Array.from(groups.values())
        .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
        .slice(0, 5);
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
  // Q571: a sessions read paused offline has isLoading false and no rows, so
  // the list said "No recent sessions on record yet." to someone offline.
  const sessionsOffline = useFeedPhase({ status: sessionsStatus, fetchStatus: sessionsFetchStatus }) === "offline-empty";
  return { sessionGroups, sessionsLoading, sessionsFetchFailed, sessionsOffline };
}
