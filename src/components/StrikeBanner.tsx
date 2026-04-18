import { useEffect, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Strike 2 banner: "One more violation will result in a temporary suspension."
 * Strike 3+ (suspended) banner: shows lockout countdown.
 * Hidden on auth/landing routes.
 */
export default function StrikeBanner() {
  const [status, setStatus] = useState<{
    ban_status: string | null;
    auto_suspended_until: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("ban_status, auto_suspended_until")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data) setStatus(data as any);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  if (!status) return null;

  const path = typeof window !== "undefined" ? window.location.pathname : "";
  if (["/", "/login", "/signup"].includes(path) || path.startsWith("/forgot") || path.startsWith("/reset")) return null;

  // Strike 3 — suspended
  if (status.ban_status === "temp_banned" && status.auto_suspended_until) {
    const until = new Date(status.auto_suspended_until);
    if (until > new Date()) {
      return (
        <div className="sticky top-0 z-40 w-full bg-destructive text-destructive-foreground border-b border-destructive/40">
          <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-2 text-sm">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="flex-1">
              <strong>Account suspended</strong> until {until.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. You cannot post or accept jobs.
            </span>
            <Link to="/profile?tab=warnings" className="underline text-xs whitespace-nowrap">Details</Link>
          </div>
        </div>
      );
    }
  }

  // Strike 2 — final warning
  if (status.ban_status === "final_warning") {
    return (
      <div className="sticky top-0 z-40 w-full bg-accent text-accent-foreground border-b border-accent/60">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            <strong>Final warning:</strong> One more violation will result in a 7-day suspension.
          </span>
          <Link to="/profile?tab=warnings" className="underline text-xs whitespace-nowrap">Review</Link>
        </div>
      </div>
    );
  }

  return null;
}
