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
}

/**
 * Standardized sub-page header used across every screen that is NOT a
 * bottom-nav tab root.
 *
 * iOS Large Title pattern (HIG):
 *   • Sticky top bar: fixed 44pt height, blurred background, back chevron
 *     on the left, optional trailing actions on the right. NO title text —
 *     the bar looks identical on every screen so transitions feel seamless.
 *   • Large title: rendered in the page body, below the sticky bar, as
 *     a big H1 (the iOS-native treatment).
 *
 * Background + blur tokens match the Home/Browse screens exactly so users
 * never see a color jump when navigating between pages.
 */
const PageHeader = ({ title, onBack, rightSlot, subtitle }: PageHeaderProps) => {
  const navigate = useNavigate();
  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  return (
    <>
      {/* Sticky top bar — back chevron only, no title. Identical 44pt height
          on every sub-page so navigation transitions are seamless. Honors
          the device top safe-area (notch / Dynamic Island). */}
      <header
        className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex h-11 max-w-5xl items-center justify-between gap-2 px-5">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label="Go back"
            className="h-11 w-11 shrink-0 rounded-xl -ml-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {rightSlot ? (
            <div className="flex items-center gap-1 shrink-0 -mr-2">{rightSlot}</div>
          ) : null}
        </div>
      </header>

      {/* iOS-style Large Title in the page body — uniform 20px (px-5) gutter
          across every sub-page. */}
      <div className="mx-auto max-w-5xl px-5 pt-6 pb-4">
        <h1 className="font-display text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground">
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
