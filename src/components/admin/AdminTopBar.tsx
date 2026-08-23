import { LogOut, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import AdminBadgeToggle from "@/components/admin/AdminBadgeToggle";

/**
 * The admin console's top bar — the SAME bar as the rest of the signed-in app.
 *
 * Its comment used to claim it "matches user-facing DashboardHeader", and it
 * did not: `glass border-b` against the app bar's `glass-nav` + explicit blur,
 * `container mx-auto px-4` against `w-full px-5 lg:px-8 xl:px-12`, the full
 * wordmark against the emblem alone, and a 40px sign-out button beside a 44px
 * bell. Every one of those is now DesktopTopNav's value, verbatim, so crossing
 * into /admin does not change the chrome under you (owner: "admin keeps the
 * same top nav").
 *
 * What stays admin-only is what admin actually needs and the app bar has no
 * equivalent for: an explicit "Back to App" exit, the ADMIN badge that toggles
 * the console sidebar, and sign-out. The app bar's hamburger has the same job
 * as the badge — toggle the navigation beside you — so the badge sits where
 * the hamburger sits, on the right, next to the panel it opens.
 *
 * `sticky`, not `fixed`: the console lays out as a sidebar + scrolling main,
 * and a fixed bar would sit over the sidebar rather than beside it.
 */
const AdminTopBar = ({ onLogout }: { onLogout: () => void }) => (
  <header
    className="sticky top-0 z-40 glass-nav"
    style={{
      paddingTop: "var(--safe-area-top, 0px)",
      // Blur only, no saturate() — copied from DesktopTopNav, where saturate
      // on a backdrop filter amplified the colour of whatever scrolled beneath
      // and read as a cast shifting under the bar.
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
    }}
  >
    <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Explicit, always-visible exit back to the normal app. The logo
            already linked to /dashboard but wasn't discoverable, so admins
            felt stranded in the console (no way to home / post / messages /
            profile short of logging out). This returns without signing out. */}
        <Button asChild variant="ghost" className="h-11 gap-1.5 btn-press shrink-0 -ml-2">
          <Link to="/dashboard" aria-label="Back to the app">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to App</span>
          </Link>
        </Button>
        <HelprMark to="/dashboard" size="sm" emblemOnly />
      </div>
      {/* `[&_button]:h-11 [&_button]:w-11` — verbatim from DesktopTopNav. The
          bell renders at the Button component's `size="icon"` default (h-14)
          while its neighbours are h-11, so without this the hover and focus
          outlines opened to different rectangles side by side. */}
      <div className="flex items-center gap-1.5 -mr-1 [&_button]:h-11 [&_button]:w-11">
        <AdminBadgeToggle />
        <NotificationPanel />
        <Button
          variant="ghost"
          size="icon"
          onClick={onLogout}
          className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-ds-md"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </div>
  </header>
);

export default AdminTopBar;
