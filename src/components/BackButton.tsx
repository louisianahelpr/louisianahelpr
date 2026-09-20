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
 * The back button's BOX — a 44px tap target and the -8px optical overhang that
 * pulls the bare arrow out to the content edge. Rendered width is therefore
 * 44 - 8 = 36px, and with `PageHeader`'s `gap-3` that is what puts every page
 * title on the app's title line: gutter + 36 + 12, i.e. x=72 at 1440 and x=68
 * at 375 (measured 2026-09-20).
 *
 * IT SAYS 44 BECAUSE IT IS 44. This read `w-10 h-10` (40px) until 2026-09-20
 * and rendered at 44x44 the whole time: the `:where(button …)` floor at the
 * top of src/index.css sets `min-height: 44px; min-width: 44px`, and a `w-10`
 * utility sets WIDTH, which does not beat a min-width. The declaration was
 * 4px smaller than the button. That cost nothing while only the button used
 * it — and exactly 4px the moment something else reserved the same box from
 * the same classes: the Profile landing's title came out at x=68 against the
 * tabs' x=72 on the first build of this change, because a `<span>` gets no
 * tap-target floor. Trust the declaration, never the comment beside it — so
 * the declaration now matches the pixels, and nothing depends on an invisible
 * global to agree with it. The rendered size is unchanged either way.
 *
 * Exported because `PageHeader` RESERVES this same box on a page that has no
 * back button — the Profile landing, a nav root — so its title lands on the
 * same line as the 25 Profile tabs' titles do. Two copies of the string would
 * drift the day one changed; one constant cannot.
 */
export const BACK_BUTTON_BOX_CLASS = "w-11 h-11 -ml-2";

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
 *
 * That wash is a DISC, and the shape is `.ctl-exit` rather than a local
 * `rounded-full` on purpose: it is the same shape every other way out of a
 * surface wears, declared once in src/index.css. See the note there.
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
      className={`${BACK_BUTTON_BOX_CLASS} ctl-exit flex items-center justify-center ctl-tint active:scale-[0.97] shrink-0 ${className ?? ""}`}
      style={{ color: "hsl(var(--olivewood))" }}
    >
      <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
    </button>
  );
};

export default BackButton;
