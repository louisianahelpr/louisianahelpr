import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
  subtitle?: React.ReactNode;
  hideBack?: boolean;
}

const PageHeader = ({ title, onBack, rightSlot, subtitle, hideBack = false }: PageHeaderProps) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  return (
    <>
      <header
        className="sticky top-0 z-50 border-b border-white/20 bg-white/60 dark:bg-white/5 backdrop-blur-[12px] backdrop-saturate-150 shadow-[0_4px_20px_-8px_hsl(0_0%_0%/0.08)]"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", WebkitBackdropFilter: "blur(12px) saturate(1.5)" }}
      >
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-end gap-2 px-5">
          {rightSlot ? (
            <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-2">
          {!hideBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Go back"
              className="h-10 w-10 shrink-0 rounded-xl -ml-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
        </div>
        {subtitle ? (
          <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground max-w-prose">
            {subtitle}
          </div>
        ) : null}
      </div>
    </>
  );
};

export default PageHeader;
