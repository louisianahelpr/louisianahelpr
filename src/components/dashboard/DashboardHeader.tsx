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
  onMenuClick?: () => void;
  /** Nearest accepted / in-progress job — shows the live status pill. */
  inProgressJob?: UpcomingJob | null;
  /** Navigate to the in-progress job. */
  onViewInProgress?: () => void;
}

const DashboardHeader = ({ title, titleAs = "span", onMenuClick, inProgressJob, onViewInProgress }: DashboardHeaderProps) => {
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
            <TitleTag className="font-display font-bold text-foreground text-ds-15 truncate m-0">{title}</TitleTag>
          ) : (
            <HelprMark to="/dashboard" size="md" hideEmblem />
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
