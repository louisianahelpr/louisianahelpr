import { LogOut, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import AdminBadgeToggle from "@/components/admin/AdminBadgeToggle";

const AdminTopBar = ({ onLogout }: { onLogout: () => void }) => (
  /* Top bar — matches user-facing DashboardHeader */
  <header className="sticky top-0 z-40 glass border-b border-border/30" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
    <div className="container mx-auto flex items-center justify-between h-14 px-4">
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Explicit, always-visible exit back to the normal app. The logo
            already linked to /dashboard but wasn't discoverable, so admins
            felt stranded in the console (no way to home / post / messages /
            profile short of logging out). This returns without signing out. */}
        <Button asChild variant="ghost" size="sm" className="gap-1.5 btn-press shrink-0">
          <Link to="/dashboard" aria-label="Back to the app">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to app</span>
          </Link>
        </Button>
        <HelprMark to="/dashboard" size="sm" />
      </div>
      <div className="flex items-center gap-1">
        {/* Admin badge — click to open/close sidebar */}
        <AdminBadgeToggle />

        <NotificationPanel />
        <Button variant="ghost" size="icon" onClick={onLogout} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-ds-md h-10 w-10" aria-label="Log out">
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </div>
  </header>
);

export default AdminTopBar;
