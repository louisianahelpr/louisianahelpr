import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { hasInAppHistory } from "@/lib/inAppHistory";

interface BackButtonProps {
  to?: string;
  className?: string;
  /** Override the default navigation. When provided, `to` is ignored
   *  and history-back fallback is skipped. */
  onClick?: () => void;
}

/**
 * In-content back button placed to the left of a page's H1.
 *
 * Per project convention, back buttons live in the main content area,
 * never in the sticky top navbar.
 *
 * Deliberately a BARE arrow — no filled circle, border, or shadow. The
 * previous frosted-glass pill gave a plain navigation control more visual
 * weight than the page title sitting next to it, reading as a primary action
 * (iOS uses a bare chevron for the same reason). The 40px box is kept for the
 * tap target even though nothing is painted around the icon, and hover paints
 * a faint wash so the hit area is still discoverable on pointer devices.
 */
const BackButton = ({ to, className, onClick }: BackButtonProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  // REAL history wins over a hardcoded `to`.
  //
  // This used to read `else if (to) navigate(to)` FIRST, so any page passing
  // to="/" sent you to the marketing home no matter where you actually came
  // from — tap into Membership from the dashboard, tap back, land on the
  // public landing page. `to` is now what it should always have been: the
  // fallback for when there is no in-app history to return to, i.e. someone
  // deep-linked or opened the route cold.
  //
  // The test is NOT window.history.length: that counts the whole TAB — pages
  // visited before the app was ever opened — so it is true even on a cold
  // deep-link, where navigate(-1) walks the user out of the app entirely.
  //
  // It is also no longer location.key. `key` is "default" only on react-router's
  // very first entry, but a REPLACE navigation mints a fresh key WITHOUT adding
  // a history entry — so key stopped being a proxy for "there is somewhere to go
  // back to" the moment anything redirected on mount. That is the /login bug:
  // a guest who cold-opens /dashboard is bounced by ProtectedRoute's
  // `<Navigate to="/login?redirect=…" replace />`, which leaves key random and
  // the entry count at one. Back then ran navigate(-1) and left the app —
  // observed landing on about:blank in Chrome; in a freshly-opened tab there is
  // no prior entry at all, so history.back() is inert and the arrow simply does
  // nothing. Both read to the user as "the back button is broken".
  //
  // react-router's own history stamps an `idx` (0-based position within ITS
  // history) into window.history.state, and a replace deliberately keeps the
  // index put. `idx > 0` is therefore the exact question we mean: is there an
  // in-app entry behind this one? When that state is absent (MemoryRouter, SSR,
  // any non-browser history) fall back to the old key heuristic.

  const handleClick = () => {
    if (onClick) onClick();
    else if (hasInAppHistory(location.key)) navigate(-1);
    else navigate(to ?? "/");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Go back"
      className={`w-10 h-10 -ml-2 rounded-full flex items-center justify-center transition-colors active:scale-[0.94] hover:bg-[hsl(var(--olivewood)/0.08)] shrink-0 ${className ?? ""}`}
      style={{ color: "hsl(var(--olivewood))" }}
    >
      <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
    </button>
  );
};

export default BackButton;
