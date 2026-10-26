import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { signOutOtherDevices } from "@/lib/authSignOut";
import { confirmConsequential } from "@/lib/toastPolicy";
import { parseUserAgent } from "@/components/profile/securitySessions";

export interface AuthSessionRow {
  session_id: string;
  user_agent: string | null;
  signed_in_at: string;
  last_active_at: string;
  is_current: boolean;
}

export const AUTH_SESSIONS_KEY = ["security", "auth-sessions"] as const;

/** "now" / "12m ago" / "3h ago" / "2d ago" / "Oct 2": when a device was last active. Pure; tested. */
export function lastActiveLabel(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.floor(mins / (60 * 24))}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * BOARD 175's "SIGNED IN ON" (behind 'account_security'): one row per REAL signed-in device, from
 * auth.sessions through my_auth_sessions() (20261026021601), this device first and marked; every
 * other row has its own Sign out (revoke_my_session: that device can no longer refresh), and
 * "Sign out everywhere else" signs out all of them but this one (signOut scope "others").
 */
export function SignedInDevicesCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: AUTH_SESSIONS_KEY,
    staleTime: 30_000,
    queryFn: async () => (unwrap(await supabase.rpc("my_auth_sessions")) ?? []) as AuthSessionRow[],
  });
  const rows = [...(sessions.data ?? [])].sort((a, b) => Number(b.is_current) - Number(a.is_current));
  const others = rows.filter((r) => !r.is_current);

  const signOutOne = async (id: string) => {
    setBusy(id);
    const res = await supabase.rpc("revoke_my_session", { p_session_id: id });
    setBusy(null);
    if (res.error) toast.error("Couldn't sign out that device. Try again.");
    else confirmConsequential("Signed out of that device.");
    void qc.invalidateQueries({ queryKey: AUTH_SESSIONS_KEY });
  };
  const signOutOthers = async () => {
    setBusy("others");
    const ok = await signOutOtherDevices();
    setBusy(null);
    if (!ok) toast.error("Couldn't sign out your other devices. Try again.");
    else confirmConsequential("Signed out everywhere else.");
    void qc.invalidateQueries({ queryKey: AUTH_SESSIONS_KEY });
  };

  return (
    <section data-signed-in-devices="" aria-labelledby="signed-in-on" className="space-y-2">
      <h2 id="signed-in-on" className="px-1 text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">Signed in on</h2>
      <div className="liquid-glass overflow-hidden">
        {sessions.isLoading ? (
          <div className="p-4 space-y-2"><Skeleton className="h-10 rounded-ds-md" /><Skeleton className="h-10 rounded-ds-md" /></div>
        ) : sessions.isError ? (
          <p className="px-4 py-3 text-ds-13 text-muted-foreground">Couldn't load your devices. Try again later.</p>
        ) : (
          rows.map((r, i) => {
            const { label, icon } = parseUserAgent(r.user_agent);
            const Icon = icon === "phone" ? Smartphone : icon === "tablet" ? Tablet : Monitor;
            return (
              <div key={r.session_id} data-device-row={r.is_current ? "current" : "other"} className={`flex items-center gap-3 px-4 py-3 ${i === rows.length - 1 ? "" : "border-b border-border/70"}`}>
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-ds-15 font-semibold truncate">{label}{r.is_current ? " · this device" : ""}</span>
                  <span className="block text-ds-13 text-muted-foreground">{r.is_current ? "Now" : `Last active ${lastActiveLabel(r.last_active_at)}`}</span>
                </span>
                {!r.is_current && (
                  <Button variant="ghost" size="sm" className="shrink-0 font-semibold" disabled={busy !== null} onClick={() => void signOutOne(r.session_id)}>
                    {busy === r.session_id ? "Signing out…" : "Sign out"}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
      {others.length > 0 && (
        <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => void signOutOthers()}>
          {busy === "others" ? "Signing out…" : "Sign out everywhere else"}
        </Button>
      )}
    </section>
  );
}
