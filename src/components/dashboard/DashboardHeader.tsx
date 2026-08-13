import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Shield, Menu } from "lucide-react";
import NotificationPanel from "@/components/NotificationPanel";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import HelprMark from "@/components/HelprMark";
import DashboardInProgressBadge from "@/components/dashboard/DashboardInProgressBadge";
import type { UpcomingJob } from "@/components/dashboard/DashboardStatusBanners";

interface DashboardHeaderProps {
  title?: string;
  /**
   * Element used for `title`. Defaults to `span` because most consumers
   * (Dashboard, Profile, PostJob) already render their own `<h1>` in the body —
   * promoting this unconditionally would give those pages TWO h1s. Screens
   * whose ONLY page title is this header (Activity, Messages — both measured at
   * zero h1) pass `titleAs="h1"` so they get exactly one.
   */
  titleAs?: "span" | "h1";
  /**
   * Optional second line under `title`, for state that belongs to the page
   * rather than to a card inside it — e.g. Activity's current status filter
   * and its count ("All · 4").
   *
   * This exists because the page title and the panel's own heading were
   * stacking: the top bar said "My Jobs" and the card immediately beneath it
   * said "All", two headings with no stated relationship. Folding the filter
   * into the header makes it one statement, and keeps the active filter
   * permanently visible — which matters because the filter silently hiding
   * everything is a bug this app has actually shipped.
   */
  subtitle?: React.ReactNode;
  onMenuClick?: () => void;
  /** Nearest accepted / in-progress job — shows the live status pill. */
  inProgressJob?: UpcomingJob | null;
  /** Navigate to the in-progress job. */
  onViewInProgress?: () => void;
}

const DashboardHeader = ({ title, titleAs = "span", subtitle, onMenuClick, inProgressJob, onViewInProgress }: DashboardHeaderProps) => {
  const TitleTag = titleAs;
  const navigate = useNavigate();
  const { isAdmin } = useCurrentUser();

  // Sign-out intentionally lives on the Profile screen (ProfileLanding's
  // account-actions footer), not here. A one-tap logout sitting next to the
  // bell invited mis-taps and read as un-native; the header now holds only
  // navigation/notification chrome.

  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
        <div className="flex items-center gap-2 min-w-0">
          {title ? (
            /* `leading-none` on both lines + a small gap, so the two-line
               variant still fits the 56px bar without changing its height. */
            <div className="flex flex-col justify-center min-w-0 gap-0.5">
              <TitleTag className="font-display font-bold text-foreground text-ds-15 truncate m-0 leading-none">{title}</TitleTag>
              {subtitle && (
                <span
                  className="font-serif italic text-ds-11 truncate leading-none"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {subtitle}
                </span>
              )}
            </div>
          ) : (
            <HelprMark to="/dashboard" size="sm" emblemOnly />
          )}
        </div>
        <div className="flex items-center gap-1.5 -mr-1">
          {inProgressJob && onViewInProgress && (
            <DashboardInProgressBadge job={inProgressJob} onView={onViewInProgress} />
          )}
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="btn-press rounded-ds-md h-10 w-10" aria-label="Admin panel" style={{ color: "hsl(var(--olivewood))" }}>
              <Shield className="w-4 h-4" />
            </Button>
          )}
          <NotificationPanel />
          {onMenuClick && (
            <Button variant="ghost" size="icon" onClick={onMenuClick} className="lg:hidden hover:bg-muted btn-press rounded-ds-md h-10 w-10" aria-label="Open menu">
              <Menu className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
