import { useLocation } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/NotificationPanel";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { useTopNavActionsSlot } from "@/components/topNavActions";
import { useSidePanel } from "@/components/sidePanelOpen";
import { Menu } from "lucide-react";

/**
 * The signed-in app bar for the DESKTOP WEBSITE — emblem left, notification
 * bell right, spanning the full viewport above the left sidebar rail.
 *
 * Rendered ONCE, globally, from App.tsx beside {@link DesktopSidebarNav}, and
 * gated on the identical three conditions that component uses:
 *
 *   isWebDesktop && isDesktopRailRoute(pathname) && !!user
 *
 * Rendering it globally rather than per-page is deliberate. It was previously
 * threaded through AppShell's `header` slot page by page, which meant every
 * screen had to opt in individually — so Home and Activity had a bar while
 * Profile, Messages and /user/:id did not, and any page added later would
 * start life without one. Worse, `/user/:id` is a document-scroll page that
 * never mounts AppShell at all, so it had no `header` slot to opt into. One
 * global render is the only version that stays true as pages are added.
 *
 * NATIVE AND PHONE WEB ARE UNTOUCHED. `useIsWebDesktop` is
 * `!isNativePlatform() && matchMedia('(min-width: 900px)')`, so the native
 * iOS/Android shell fails it even on a wide iPad, and phone-width browsers
 * fail it too — both keep the chrome they already had (MobileNav plus each
 * screen's own title card). This must never be gated with a bare Tailwind
 * `lg:` utility: `lg:` is pure CSS width and would fire inside a wide native
 * WebView, putting a web app bar in the native app.
 *
 * Renders no heading element. The emblem's accessible name comes from its
 * image `alt`, so the page below keeps exactly one `<h1>`.
 */
const DesktopTopNav = () => {
  const isWebDesktop = useIsWebDesktop();
  const location = useLocation();
  const { user } = useCurrentUser();
  // Whatever the current page pushed up — its status pill, search and filter
  // controls, "Select", and so on. Null on pages that contribute nothing.
  const pageActions = useTopNavActionsSlot();
  const { open, toggle } = useSidePanel();

  if (!isWebDesktop) return null;
  if (!isDesktopRailRoute(location.pathname)) return null;
  if (!user) return null;

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 glass-nav"
      style={{
        // Blur only, no saturate() — saturate on a backdrop filter amplifies
        // the colour of whatever scrolls beneath the bar, which read as a
        // green cast shifting under the nav on the marketing header.
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
        <HelprMark to="/dashboard" size="sm" emblemOnly />
        {/* `[&_button]:h-11 [&_button]:w-11` — the bell renders at the Button
            component's `size="icon"` default (h-14) while the hamburger below
            is h-11, so the two sat at different sizes and their hover and
            focus outlines opened to different rectangles side by side (owner).
            Normalised here, on the row, rather than by threading a size prop
            through NotificationPanel to its trigger. */}
        <div className="flex items-center gap-1.5 -mr-1 [&_button]:h-11 [&_button]:w-11">
          {pageActions}
          <NotificationPanel />
          {/* The hamburger OPENS AND CLOSES the side panel — it does not open a
              menu sheet. It sits on the RIGHT (owner) because that is the edge
              the panel itself is on, so the control and the thing it controls
              are together rather than at opposite ends of the bar. */}
          <button
            type="button"
            onClick={toggle}
            aria-label={open ? "Close navigation panel" : "Open navigation panel"}
            aria-expanded={open}
            className="h-11 w-11 rounded-ds-md inline-flex items-center justify-center btn-press transition-colors text-[hsl(var(--olivewood))] hover:bg-[hsl(var(--olivewood)/0.08)]"
          >
            <Menu className="w-5 h-5" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default DesktopTopNav;
