/**
 * Apply the shell layout classes on <html> BEFORE React's first paint.
 *
 * The bug this fixes: `useAppShellViewport` sets `web-desktop`, `app-shell`
 * and `desktop-rail` inside `useEffect`, which runs AFTER the first paint. On
 * a desktop browser that means every page painted once at full width and then
 * reflowed 248px narrower when `desktop-rail` landed and the `#root` inset
 * (or `.app-shell-frame { left: … }`) turned on. Owner, 2026-08-25: "pages
 * open wide then get smaller on web when the side panel is there" and the
 * landing page "loads weird and jumps". Same root cause, every route.
 *
 * This runs at module scope from main.tsx, so the classes are on the element
 * before React renders anything and the first paint is already the final
 * geometry. `useAppShellViewport` still owns the truth afterwards — it
 * re-applies on every navigation and once auth actually resolves, so anything
 * guessed here is corrected within a tick.
 *
 * The one guess is the signed-in check. `desktop-rail` requires a user, and
 * the real answer needs Supabase, which is exactly the chunk the landing page
 * must not block on. `hasPersistedAuthToken()` is the existing synchronous
 * probe for this: false is trustworthy (no token → definitely a guest → no
 * rail → no inset → correct), true is a maybe. So a guest never sees a dead
 * gutter, and a signed-in user gets the correct width immediately instead of
 * a visible reflow. The only imperfect case — a stale token whose session
 * turns out to be invalid — lands on today's behaviour (the effect removes the
 * class), which is strictly no worse than the jump everyone gets now.
 */
import { Capacitor } from "@capacitor/core";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { hasPersistedAuthToken } from "@/lib/persistedAuthToken";
import { isDocumentScrollRoute, WEB_DESKTOP_QUERY } from "@/hooks/useAppShellViewport";

export function applyPrePaintShellClasses() {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const html = document.documentElement;
  const pathname = window.location.pathname;

  // Mirrors useAppShellViewport's first effect.
  if (isDocumentScrollRoute(pathname)) html.classList.remove("app-shell");
  else html.classList.add("app-shell");

  // Native is NEVER web-desktop — same hard gate as the hook, checked first so
  // no code path can flip it on in the app shell.
  const isNative = Capacitor.isNativePlatform();
  const isWebDesktop =
    !isNative &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(WEB_DESKTOP_QUERY).matches;

  html.classList.toggle("web-desktop", isWebDesktop);

  // `!!user` in the hook; the synchronous probe stands in for it here.
  const maybeSignedIn = hasPersistedAuthToken();

  html.classList.toggle(
    "desktop-rail",
    isWebDesktop && isDesktopRailRoute(pathname) && maybeSignedIn,
  );

  // `no-bottom-nav` — the same pre-paint argument, one class over.
  //
  // MobileNav owns this class, and it sets it from an EFFECT inside its own
  // lazily-loaded chunk. Measured cold at 375/slow-3G on guest `/`, it landed
  // 2–3s after first paint — and it zeroes `--bottom-nav-h`, which feeds the
  // `pb-safe-nav` token on 22 pages, so a ~112px strip collapsed under the
  // content two seconds in. Anyone who had started scrolling saw the footer
  // jump.
  //
  // Only the `false` half of the probe is acted on, and only additively: no
  // token means definitely a guest, means definitely no dock, means the strip
  // is definitely dead — that is safe to collapse before paint. A `true` (or a
  // storage we cannot read) touches NOTHING, leaving the class exactly as the
  // document loaded it, because "maybe signed in" is not enough to decide and
  // guessing the reservation ON costs nothing but a dock-height gap that the
  // dock is about to fill.
  //
  // MobileNav still owns the truth: its effect runs `toggle(..., dockHidden)`
  // on mount and covers the cases this cannot see — a signed-in visitor on a
  // marketing page, `noNavPages`, and a stale token whose session is invalid.
  // This only moves the common guest answer earlier.
  if (!maybeSignedIn) html.classList.add("no-bottom-nav");
}
