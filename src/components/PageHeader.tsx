import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Italic Garamond uppercase small-caps eyebrow line above the title. */
  eyebrow?: string;
  /** Italic Garamond meta line below the title — accepts strings or
      JSX (e.g., counts with Sienna-tinted dividers). Use this for the
      editorial brand pattern. The legacy `subtitle` prop still works. */
  meta?: ReactNode;
  onBack?: () => void;
  rightSlot?: ReactNode;
  /** Legacy subtitle slot — falls back to a long-form muted description.
      Prefer `meta` for editorial-style page headers. */
  subtitle?: ReactNode;
  hideBack?: boolean;
}

const PageHeader = ({ title, eyebrow, meta, onBack, rightSlot, subtitle, hideBack = false }: PageHeaderProps) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  // When no rightSlot is provided, skip the empty 48px sticky bar and let
  // the title block absorb the safe-area-top padding instead. Pages like
  // PostJob were paying ~100px of dead space at the top of the viewport
  // for a header bar that had nothing in it.
  return (
    <>
      {rightSlot && (
        <header
          className="sticky top-0 z-50 border-b border-white/20 bg-white/60 dark:bg-white/5 backdrop-blur-[12px] backdrop-saturate-150 shadow-[0_4px_20px_-8px_hsl(0_0%_0%/0.08)]"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)", WebkitBackdropFilter: "blur(12px) saturate(1.5)" }}
        >
          <div className="mx-auto flex h-12 max-w-5xl lg:max-w-6xl 2xl:max-w-7xl items-center justify-end gap-2 px-5 lg:px-8 xl:px-12">
            <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>
          </div>
        </header>
      )}

      <div
        className="mx-auto max-w-5xl lg:max-w-6xl 2xl:max-w-7xl px-5 lg:px-8 xl:px-12 pt-3 pb-2"
        style={!rightSlot ? { paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" } : undefined}
      >
        <div className="flex items-start gap-2 mb-1">
          {!hideBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Go back"
              className="h-10 w-10 shrink-0 rounded-ds-md -ml-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="flex flex-col leading-none min-w-0 flex-1">
            {eyebrow && (
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{
                  color: "hsl(var(--burnt-sienna) / 0.78)",
                  letterSpacing: "0.18em",
                }}
              >
                {eyebrow}
              </span>
            )}
            <h1
              className="font-display italic font-bold leading-tight mt-1 truncate"
              style={{
                fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              {title}
            </h1>
            {meta && (
              <span
                className="font-serif italic mt-0.5 text-[0.78rem]"
                style={{ color: "hsl(var(--olivewood) / 0.7)" }}
              >
                {meta}
              </span>
            )}
          </div>
        </div>
        {subtitle ? (
          <div className="mt-1 text-[14px] leading-relaxed text-muted-foreground max-w-prose">
            {subtitle}
          </div>
        ) : null}
      </div>
    </>
  );
};

export default PageHeader;
