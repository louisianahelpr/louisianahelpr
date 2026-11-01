import { useLayoutEffect, useRef } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBannerContribution, useSetBannerContribution } from "@/lib/offlineBannerLayout";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { formatTimestamp } from "@/lib/format";

export default function StrikeBanner() {
  // The ban state comes from the signed-in profile row (profiles select=*),
  // which useCurrentUser reads from the server on every load and every 30 s
  // of focus, and NEVER restores from the device (meta.persist false: a
  // pre-ban copy must not paper over a ban). This banner sent its own
  // profiles?select=ban_status,auto_suspended_until read until 2026-11-01:
  // the same row, one more request on every signed-in page (Q104 budget,
  // release gate e2e-real-backend 41330878323).
  const { profile } = useCurrentUser();
  const status = profile
    ? { ban_status: profile.ban_status ?? null, auto_suspended_until: profile.auto_suspended_until ?? null }
    : null;

  // Reserve space for this banner the way OfflineBanner does, or every
  // fixed-shell page header (title card, back arrow, filter row) renders
  // UNDER it and cannot be reached — seen on /jobs, /messages and every
  // /profile tab at 393 with a final warning active. Fixed, not sticky:
  // sticky lives in normal flow inside #root, which the document-scroll
  // padding rule would then double-count. It sits directly below the offline
  // banner when both are up.
  const offlineOffset = useBannerContribution("offline");
  const setContribution = useSetBannerContribution("strike");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pathNow = typeof window !== "undefined" ? window.location.pathname : "";
  const onAuthPage = ["/", "/login", "/signup"].includes(pathNow) || pathNow.startsWith("/forgot-password") || pathNow.startsWith("/reset-password");
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
  if (["/", "/login", "/signup"].includes(path) || path.startsWith("/forgot-password") || path.startsWith("/reset-password")) return null;

  if (status.ban_status === "temp_banned" && status.auto_suspended_until) {
    const until = new Date(status.auto_suspended_until);
    if (until > new Date()) {
      return (
        <div ref={contentRef} data-rail-inset className="strike-banner fixed left-0 right-0 z-[59] w-full bg-destructive text-destructive-foreground border-b border-destructive/40" style={{ top: `calc(var(--safe-area-top, 0px) + ${offlineOffset}px)` }}>
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
      <div ref={contentRef} data-rail-inset className="strike-banner fixed left-0 right-0 z-[59] w-full bg-accent text-accent-foreground border-b border-accent/60" style={{ top: `calc(var(--safe-area-top, 0px) + ${offlineOffset}px)` }}>
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
