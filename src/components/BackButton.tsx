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
 * never in the sticky top navbar. Matches the frosted-glass affordance
 * used by ProfileTabHeader so the back action looks consistent across
 * Profile tabs, Legal, DataRights, and any other in-content header.
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
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-[0.94] hover:opacity-80 shrink-0 mt-0.5 ${className ?? ""}`}
      style={{
        background: "hsla(0, 0%, 100%, 0.65)",
        border: "1px solid hsl(var(--olivewood) / 0.18)",
        color: "hsl(var(--olivewood))",
        backdropFilter: "blur(10px) saturate(150%)",
        WebkitBackdropFilter: "blur(10px) saturate(150%)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 4px 10px -4px hsl(var(--olivewood) / 0.10)",
      }}
    >
      <ArrowLeft className="w-4 h-4" strokeWidth={2.25} />
    </button>
  );
};

export default BackButton;
