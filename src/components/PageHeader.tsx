import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title: string;
  /**
   * Optional override for the back button. When provided (e.g. wizard
   * `previousStep`), it's called instead of `navigate(-1)` so users don't
   * lose form state mid-flow.
   */
  onBack?: () => void;
  /**
   * Optional slot for trailing actions on the right side of the header
   * (e.g. a notifications bell). Kept minimal so the bar stays stable.
   */
  rightSlot?: React.ReactNode;
}

/**
 * Standardized sub-page header used across every screen that is NOT a
 * bottom-nav tab root. Layout is locked: fixed height, identical padding,
 * identical background — back arrow on the far left, title immediately
 * to its right (left-aligned, never centered). No progress bars.
 */
const PageHeader = ({ title, onBack, rightSlot }: PageHeaderProps) => {
  const navigate = useNavigate();
  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  return (
    <header
      className="sticky top-0 z-40 h-14 border-b border-border bg-background/80 backdrop-blur-md"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="container mx-auto flex h-14 items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label="Go back"
            className="h-11 w-11 shrink-0 rounded-xl -ml-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="truncate text-lg font-display font-semibold text-foreground">
            {title}
          </h1>
        </div>
        {rightSlot ? <div className="flex items-center gap-1 shrink-0">{rightSlot}</div> : null}
      </div>
    </header>
  );
};

export default PageHeader;
