import { FileCheck2, FileText, X } from "lucide-react";

interface ThresholdBannerProps {
  ytdYear: number;
  onOpenExport: () => void;
  onDismiss: () => void;
}

// 1099-K banner — appears once YTD payouts cross the federal
// $600 threshold. Quiet, dismissible per-user-per-year so it
// doesn't nag after the helper has seen it. Tapping the CTA
// opens the existing PDF tax-export dialog (no new flow).
export function ThresholdBanner({ ytdYear, onOpenExport, onDismiss }: ThresholdBannerProps) {
  return (
    <div
      className="rounded-2xl p-4 flex items-start gap-3"
      style={{
        background:
          "radial-gradient(70% 90% at 0% 0%, hsl(var(--gold-warm) / 0.16) 0%, transparent 60%), " +
          "hsla(0, 0%, 100%, 0.6)",
        border: "0.5px solid hsl(var(--gold-warm) / 0.34)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
          "0 1px 2px hsl(var(--olivewood) / 0.05), " +
          "0 8px 18px -6px hsl(var(--olivewood) / 0.10)",
      }}
    >
      <span
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
        style={{
          background: "hsl(var(--gold-warm) / 0.18)",
          color: "hsl(var(--gold-warm))",
        }}
      >
        <FileCheck2 className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <h3
          className="font-display italic font-bold leading-tight"
          style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          You've crossed the $600 mark for {ytdYear}.
        </h3>
        <p
          className="font-serif italic mt-1 leading-snug"
          style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}
        >
          You may receive a 1099-K from Stripe. Download a payout statement now so you're not scrambling in April.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex items-center gap-1.5 rounded-ds-sm px-3 py-1.5 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
            style={{
              background: "hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              border: "1px solid hsl(var(--bark))",
            }}
          >
            <FileText className="w-3.5 h-3.5" />
            Download tax statement
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 -mr-1 -mt-1 w-10 h-10 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:bg-secondary/40 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
