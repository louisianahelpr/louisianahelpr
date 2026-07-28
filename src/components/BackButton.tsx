import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

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
  const handleClick = () => {
    if (onClick) onClick();
    else if (to) navigate(to);
    else if (window.history.length > 1) navigate(-1);
    else navigate("/");
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
