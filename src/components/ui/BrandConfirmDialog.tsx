// Shared confirmation dialog with Helpr's editorial brand styling
// (italic Bodoni serif title, italic Garamond description, optional
// sienna warning callout, on-brand primary button). Lifts the shell
// that DeleteAccountDialog and the Profile logout dialog had grown in
// parallel so future confirmation dialogs get on-brand styling for
// free.
//
// Use `primaryTone="bark"` for reversible actions (log out, cancel
// edits) and `primaryTone="sienna"` only for genuinely destructive
// actions (delete, forfeit). Reserving sienna keeps it meaningful.

import { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import {
  hapticMedium,
  hapticHeavy,
  hapticSuccess,
  hapticWarning,
  hapticError,
} from "@/lib/haptics";

export type BrandPrimaryTone = "bark" | "sienna";
export type BrandPrimaryHaptic =
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error"
  | "none";

interface BrandConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** Optional warning callout rendered between description and footer.
   *  Sienna palette — use sparingly so it stays meaningful. */
  callout?: { icon?: LucideIcon; text: ReactNode };
  /** Optional content slot between callout and footer (e.g. a
   *  confirmation input). Bypasses the callout if both are passed. */
  children?: ReactNode;
  primaryLabel: ReactNode;
  primaryTone?: BrandPrimaryTone;
  primaryDisabled?: boolean;
  /** Haptic fired on primary tap. No-op on web; "medium" by default. */
  primaryHaptic?: BrandPrimaryHaptic;
  /** Receives the click event so callers can preventDefault() to keep
   *  the dialog open (e.g. step 1 → step 2 transition in delete). */
  onPrimary: (e: React.MouseEvent<HTMLButtonElement>) => void;
  secondaryLabel: ReactNode;
  /** When provided, intercepts the secondary tap (e.g. step 2 → back).
   *  Otherwise AlertDialogCancel closes the dialog normally. */
  onSecondary?: () => void;
}

const primaryToneStyle: Record<BrandPrimaryTone, React.CSSProperties> = {
  bark: {
    background: "hsl(var(--bark))",
    color: "hsl(var(--parchment))",
    border: "1px solid hsl(var(--bark-border))",
    fontFamily: "Montserrat, system-ui, sans-serif",
    fontWeight: 600,
    boxShadow:
      "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
      "0 1px 2px hsl(70 20% 18% / 0.22), " +
      "0 6px 14px -4px hsl(var(--bark) / 0.4)",
  },
  sienna: {
    background: "hsl(var(--burnt-sienna))",
    color: "hsl(var(--parchment))",
    border: "1px solid hsl(19 75% 28%)",
    fontFamily: "Montserrat, system-ui, sans-serif",
    fontWeight: 600,
    boxShadow:
      "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
      "0 1px 2px hsl(19 75% 18% / 0.18), " +
      "0 6px 14px -4px hsl(var(--burnt-sienna) / 0.4)",
  },
};

const fireHaptic = (kind: BrandPrimaryHaptic) => {
  switch (kind) {
    case "medium": return hapticMedium();
    case "heavy": return hapticHeavy();
    case "success": return hapticSuccess();
    case "warning": return hapticWarning();
    case "error": return hapticError();
    case "none": return undefined;
  }
};

export function BrandConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  callout,
  children,
  primaryLabel,
  primaryTone = "bark",
  primaryDisabled = false,
  primaryHaptic = "medium",
  onPrimary,
  secondaryLabel,
  onSecondary,
}: BrandConfirmDialogProps) {
  const CalloutIcon = callout?.icon ?? AlertTriangle;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        {/* NO per-dialog alignment. This confirm centred its title while the
            other ~147 popups in the app left-align theirs through the same
            Hero — and because BrandConfirmDialog is behind every confirm in
            the product ("Log Out?", "Decline This Job?", "Delete account"),
            it was the difference the owner kept running into. One shell means
            one shell: the Hero owns the layout and no caller can override it.
            (Owner, more than once: "these pop ups need to share the same
            shell ... none of them have the same layout.") */}
        <AlertDialogHero title={title} />

        {callout && (
          <div
            className="my-2 rounded-ds-md p-3 text-ds-11 flex items-start gap-2"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.25)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            <CalloutIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{callout.text}</span>
          </div>
        )}

        {children}

        {/* AlertDialogFooter's OWN arrangement — inline and right-aligned from
            `sm` up, like every DialogFooter in the app. This overrode it to
            stay a full-width stack at every width, so a confirm box's buttons
            sat one above the other while the buttons in every other popup sat
            side by side. */}
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onSecondary ? (e) => { e.preventDefault(); onSecondary(); } : undefined}
            className="mt-0 rounded-ds-md border-border/60"
          >
            {secondaryLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={primaryDisabled}
            onClick={(e) => {
              if (primaryHaptic !== "none") {
                // Fire before any state change so the buzz lands while
                // the dialog is still on screen.
                void fireHaptic(primaryHaptic);
              }
              // Caller decides whether to keep the dialog open by
              // calling e.preventDefault() inside onPrimary.
              onPrimary(e);
            }}
            style={primaryToneStyle[primaryTone]}
            className="rounded-ds-md"
          >
            {primaryLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default BrandConfirmDialog;
