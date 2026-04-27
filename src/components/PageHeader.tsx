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
   * Optional slot for trailing actions on the right side of the sticky
   * top bar (e.g. a notifications bell). Kept minimal so the bar stays
   * stable across screens.
   */
  rightSlot?: React.ReactNode;
  /**
   * Optional supporting copy rendered directly under the large title.
   * Keep it short — one or two sentences max.
   */
  subtitle?: React.ReactNode;
  /**
   * Hide the back button (e.g. for top-level tab screens that already
   * have a bottom nav).
   */
  hideBack?: boolean;
}

/**
 * Standardized iOS-HIG sub-page header.
 *
 * Behavior (simplified per user request):
 *   • Top bar: thin sticky chrome with ONLY the back chevron (left) and
 *     optional right slot. Never shows the page title.
 *   • Body: a Large Title sits below the bar with generous gutters,
 *     matching the iOS Settings / Messages aesthetic.
 *
 * Safe areas and 20px horizontal gutters are applied here so every
 * sub-page is consistent without per-screen work.
 */
const PageHeader = ({ title, onBack, rightSlot, subtitle, hideBack = false }: PageHeaderProps) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  return (
    <>
      <header
        className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-2 px-5">
          {hideBack ? (
            <span className="h-11 w-11 shrink-0" aria-hidden />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Go back"
              className="h-11 w-11 shrink-0 rounded-xl"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}

          {rightSlot ? (
            <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>
          ) : (
            <span className="h-11 w-11 shrink-0" aria-hidden />
          )}
        </div>
      </header>

      {/* iOS-style Large Title in the page body — uniform 20px gutter. */}
      <div className="mx-auto max-w-5xl px-5 pt-5 pb-3">
        <h1 className="font-display text-[30px] sm:text-[34px] font-bold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <div className="mt-3 text-[15px] leading-relaxed text-muted-foreground max-w-prose">
            {subtitle}
          </div>
        ) : null}
      </div>
    </>
  );
};

export default PageHeader;
