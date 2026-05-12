import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackButtonProps {
  to?: string;
  className?: string;
}

/**
 * In-content back button placed to the left of a page's H1.
 * Per project convention, back buttons live in the main content area,
 * never in the sticky top navbar.
 */
const BackButton = ({ to, className }: BackButtonProps) => {
  const navigate = useNavigate();
  const handleClick = () => {
    if (to) navigate(to);
    else if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      aria-label="Go back"
      className={`h-10 w-10 shrink-0 rounded-ds-md -ml-2 ${className ?? ""}`}
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  );
};

export default BackButton;
