import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import { useSidebar } from "@/components/ui/sidebar";

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
const AdminTopBar = () => {
  // The hamburger toggles the SAME shadcn sidebar this page already provides,
  // so open/close state has one owner rather than a second copy living here.
  const { toggleSidebar, state } = useSidebar();

  return (
    <header
      // FIXED and FULL-BLEED, spanning the whole viewport above the rail —
      // the same arrangement as the signed-in app's DesktopTopNav (owner:
      // "admin does the opposite and it needs to match").
      //
      // It was `sticky` INSIDE the content column, so the rail ran to y=0
      // beside it and the header stopped at the rail's edge: the exact inverse
      // of the app, where the header spans everything and the panel starts
      // below it. z-50 clears the rail's z-10.
      className="fixed top-0 left-0 right-0 z-50 glass-nav"
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
        {/* EMBLEM LEFT, BELL + HAMBURGER RIGHT — the same shape as the signed-in
            app's DesktopTopNav, because admin is the same product (owner,
            after this bar was got wrong repeatedly).

            What used to be here and is now gone: an "← Back to App" button, an
            ADMIN badge toggle, and a sign-out button. Back to App and Sign Out
            both already exist as rows at the BOTTOM OF THE SIDEBAR, so the bar
            was a second copy of two controls that already had a home, next to a
            badge that only restated the page you were already on. */}
        <HelprMark to="/dashboard" size="sm" emblemOnly />
        {/* `[&_button]:h-11 [&_button]:w-11` — verbatim from DesktopTopNav. The
            bell renders at the Button component's `size="icon"` default (h-14)
            while its neighbours are h-11, so without this the hover and focus
            outlines opened to different rectangles side by side. */}
        <div className="flex items-center gap-1.5 -mr-1 [&_button]:h-11 [&_button]:w-11">
          <NotificationPanel />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-expanded={state === "expanded"}
            aria-label={state === "expanded" ? "Close the admin menu" : "Open the admin menu"}
            className="btn-press rounded-ds-md"
          >
            <Menu className="w-5 h-5" strokeWidth={2.25} />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default AdminTopBar;
