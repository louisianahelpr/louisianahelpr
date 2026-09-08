import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBannerContribution, useSetBannerContribution } from "@/lib/offlineBannerLayout";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatTimestamp } from "@/lib/format";
import { report } from "@/lib/errorLogger";

export default function StrikeBanner() {
  const [status, setStatus] = useState<{
    ban_status: string | null;
    auto_suspended_until: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (userId: string) => {
      if (cancelled) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("ban_status, auto_suspended_until")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("[StrikeBanner] failed to load ban status:", error);
        report(error, { severity: "warning", tags: { source: "StrikeBanner.load" } });
        return;
      }
      if (data) setStatus(data);
    };
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user.id) void load(session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id) void load(session.user.id);
      else setStatus(null);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  // Reserve space for this banner the way OfflineBanner does, or every
  // fixed-shell page header (title card, back arrow, filter row) renders
  // UNDER it and cannot be reached — seen on /my-jobs, /messages and every
  // /profile tab at 393 with a final warning active. Fixed, not sticky:
  // sticky lives in normal flow inside #root, which the document-scroll
  // padding rule would then double-count. It sits directly below the offline
  // banner when both are up.
  const offlineOffset = useBannerContribution("offline");
  const setContribution = useSetBannerContribution("strike");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pathNow = typeof window !== "undefined" ? window.location.pathname : "";
  const onAuthPage = ["/", "/login", "/signup"].includes(pathNow) || pathNow.startsWith("/forgot") || pathNow.startsWith("/reset");
  const visible = !!status && !onAuthPage && (
    (status.ban_status === "temp_banned" && !!status.auto_suspended_until && new Date(status.auto_suspended_until) > new Date()) ||
    status.ban_status === "final_warning"
  );
  useLayoutEffect(() => {
    if (!visible) { setContribution(0); return; }
    const el = contentRef.current;
    if (!el) return;
    const publish = () => setContribution(el.getBoundingClientRect().height);
    publish();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); setContribution(0); };
  }, [visible, setContribution]);

  if (!status) return null;

  const path = typeof window !== "undefined" ? window.location.pathname : "";
  if (["/", "/login", "/signup"].includes(path) || path.startsWith("/forgot") || path.startsWith("/reset")) return null;

  if (status.ban_status === "temp_banned" && status.auto_suspended_until) {
    const until = new Date(status.auto_suspended_until);
    if (until > new Date()) {
      return (
        <div ref={contentRef} className="fixed left-0 right-0 z-[59] w-full bg-destructive text-destructive-foreground border-b border-destructive/40" style={{ top: `calc(var(--safe-area-top, 0px) + ${offlineOffset}px)` }}>
          <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-2 text-ds-13">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="flex-1">
              <strong>Account suspended</strong> until {formatTimestamp(until)}. You cannot post or accept jobs.
            </span>
            <Link to="/profile?tab=warnings" className="underline text-ds-11 whitespace-nowrap">Details</Link>
          </div>
        </div>
      );
    }
  }

  if (status.ban_status === "final_warning") {
    return (
      <div ref={contentRef} className="fixed left-0 right-0 z-[59] w-full bg-accent text-accent-foreground border-b border-accent/60" style={{ top: `calc(var(--safe-area-top, 0px) + ${offlineOffset}px)` }}>
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-2 text-ds-13">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            <strong>Final warning:</strong> One more violation will result in a 7-day suspension.
          </span>
          <Link to="/profile?tab=warnings" className="underline text-ds-11 whitespace-nowrap">Review</Link>
        </div>
      </div>
    );
  }

  return null;
}
