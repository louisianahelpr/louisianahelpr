import { useEffect, useRef, useState } from "react";
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
 * Behavior (Apple HIG "Large Title" pattern):
 *   • At rest: a large display H1 sits in the page body below a thin
 *     44pt sticky nav bar (back chevron + optional right slot only).
 *   • On scroll: as the body title scrolls under the bar, it fades out
 *     and the same title text fades into the nav bar — exactly how
 *     iOS Settings, Mail, and Messages behave.
 *
 * Safe areas, 20px gutters, and frosted-glass background tokens are all
 * applied here so every sub-page is identical without per-screen work.
 */
const PageHeader = ({ title, onBack, rightSlot, subtitle, hideBack = false }: PageHeaderProps) => {
  const navigate = useNavigate();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  // Use IntersectionObserver on a 1px sentinel placed at the bottom edge
  // of the large title. When the sentinel scrolls out of view, we know
  // the body title is no longer visible — that's our cue to promote the
  // title into the nav bar. Cheaper and smoother than a scroll listener.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { threshold: 0, rootMargin: "0px 0px 0px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <header
        className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex h-11 max-w-5xl items-center justify-between gap-2 px-5">
          {hideBack ? (
            <span className="h-11 w-11 shrink-0" aria-hidden />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Go back"
              className="h-11 w-11 shrink-0 rounded-xl -ml-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}

          {/* Promoted title — fades in once the body large-title scrolls out */}
          <h2
            aria-hidden={!collapsed}
            className={`absolute left-1/2 -translate-x-1/2 font-display text-[17px] font-semibold tracking-tight text-foreground transition-opacity duration-200 ${
              collapsed ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
            <span className="block max-w-[60vw] truncate">{title}</span>
          </h2>

          {rightSlot ? (
            <div className="flex items-center gap-1 shrink-0 -mr-2">{rightSlot}</div>
          ) : (
            <span className="h-11 w-11 shrink-0" aria-hidden />
          )}
        </div>
      </header>

      {/* iOS-style Large Title in the page body — uniform 20px gutter,
          fades as it scrolls under the nav bar. */}
      <div className="mx-auto max-w-5xl px-5 pt-6 pb-4">
        <h1
          className={`font-display text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground transition-opacity duration-200 ${
            collapsed ? "opacity-0" : "opacity-100"
          }`}
        >
          {title}
        </h1>
        {subtitle ? (
          <div className="mt-3 text-[15px] leading-relaxed text-muted-foreground max-w-prose">
            {subtitle}
          </div>
        ) : null}
        {/* Sentinel marks the bottom of the large title block */}
        <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      </div>
    </>
  );
};

export default PageHeader;
