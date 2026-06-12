import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ShieldCheck } from "lucide-react";

interface JitVerifySheetProps {
  open: boolean;
  onVerify: () => void;
  onLater: () => void;
}

/**
 * JitVerifySheet — the "quick check before your first job" bottom sheet.
 *
 * Shown exactly once: when a helper taps Apply for the very first time
 * (has_applied_before = false && id_verification_status = 'unverified').
 *
 * This is a SOFT NUDGE — "I'll do this later" still proceeds with the
 * application. Verification is never a hard block.
 */
export function JitVerifySheet({ open, onVerify, onLater }: JitVerifySheetProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onLater(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[20px] pb-safe"
        style={{
          background:
            "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.06) 0%, transparent 55%), " +
            "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.12) 0%, transparent 60%), " +
            "hsl(var(--parchment))",
        }}
      >
        <SheetHeader className="text-left pb-4">
          <span
            className="font-serif italic uppercase"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Quick check before your first job
          </span>
          <SheetTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{ fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            Verify your identity
          </SheetTitle>
          <SheetDescription asChild>
            <p className="font-serif italic mt-1" style={{ fontSize: "0.88rem", color: "hsl(var(--olivewood) / 0.85)", lineHeight: "1.5" }}>
              Posters feel more confident hiring a verified neighbor. It takes about 60 seconds.
            </p>
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col items-center gap-5 pt-2 pb-2">
          {/* Shield icon */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: "hsl(var(--bark) / 0.10)",
              border: "0.5px solid hsl(var(--bark) / 0.22)",
            }}
          >
            <ShieldCheck className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={2} />
          </div>

          <div className="w-full space-y-2.5">
            <button
              type="button"
              onClick={onVerify}
              className="w-full rounded-ds-md py-3.5 font-sans font-semibold text-[0.95rem] transition-all active:scale-[0.98]"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                letterSpacing: "0.01em",
                boxShadow:
                  "0 1px 2px hsl(var(--bark) / 0.18), " +
                  "0 8px 20px -6px hsl(var(--bark) / 0.34)",
              }}
            >
              Verify my identity
            </button>
            <button
              type="button"
              onClick={onLater}
              className="w-full py-2.5 font-serif italic text-[0.88rem] transition-opacity active:opacity-60"
              style={{ color: "hsl(var(--olivewood) / 0.72)" }}
            >
              I'll do this later →
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
