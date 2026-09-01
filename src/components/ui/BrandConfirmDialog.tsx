// Shared confirmation dialog with Helpr's editorial brand styling
// (italic Bodoni serif title, italic Garamond description, optional
// sienna warning callout, on-brand primary button). Lifts the shell
// that DeleteAccountDialog and the Profile logout dialog had grown in
// parallel so future confirmation dialogs get on-brand styling for
// free.
//
// Use `primaryTone="bark"` for reversible actions (log out, cancel
// edits) — it renders the shared glossy primary CTA. Use
// `primaryTone="sienna"` only for genuinely IRREVERSIBLE actions
// (delete, forfeit, permanent ban); it renders the shared destructive
// red, the same treatment `<Button variant="destructive">` gives the
// "Confirm No-Show" button. Reserving it keeps it meaningful. The tone
// names are kept (rather than renamed across 26 call sites) but they
// now select a shared Button variant, not a bespoke style object — see
// `primaryToneVariant` below.

import { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
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

type BrandPrimaryTone = "bark" | "sienna";
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

/**
 * Tone -> the SHARED Button variant. Not a per-dialog style object.
 *
 * This used to be two hand-written `React.CSSProperties` blocks that painted a
 * FLAT `background: hsl(var(--bark))` for the reversible tone and a FLAT
 * `background: hsl(var(--burnt-sienna))` for the destructive one. Two things
 * were wrong with that, both of them standing project rules:
 *
 *  1. GLOSSY, NEVER FLAT. The primary CTA everywhere else in the app is
 *     `.btn-grad-primary` — the radial bark gradient. This dialog is behind
 *     every confirm in the product ("Log Out?", "Delete account", "Decline
 *     this job", 20+ call sites), so the single most-seen primary button in
 *     Helpr was the one flat one. `variant="default"` restores the gradient,
 *     the shared hover (brighten + 1px lift + bark glow) and the shared press.
 *  2. ONE DESTRUCTIVE TREATMENT. `sienna` painted irreversible actions in the
 *     brand ACCENT colour — the same burnt sienna used for eyebrows, callout
 *     borders and emphasis — while ten other dialogs painted theirs in
 *     `--destructive` red via `<Button variant="destructive">`. Two colours
 *     for one meaning, and the accent one is the colour the UI also uses for
 *     things that are merely *notable*. Destructive is now `--destructive`,
 *     app-wide, matching the "Report No-Show" pattern.
 *
 * If the owner wants the sienna destructive back, it is this one map — not 20
 * call sites.
 */
const primaryToneVariant: Record<BrandPrimaryTone, "default" | "destructive"> = {
  bark: "default",
  sienna: "destructive",
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
      <AlertDialogContent>
        {/* NO per-dialog alignment. This confirm centred its title while the
            other ~147 popups in the app left-align theirs through the same
            Hero — and because BrandConfirmDialog is behind every confirm in
            the product ("Log Out?", "Decline This Job?", "Delete account"),
            it was the difference the owner kept running into. One shell means
            one shell: the Hero owns the layout and no caller can override it.
            (Owner, more than once: "these pop ups need to share the same
            shell ... none of them have the same layout.") */}
        <AlertDialogHero title={title} />

        {/* Description lives in the BODY, not the Hero. The 2026-07-25 "one
            main title" decision stopped AlertDialogHero rendering a subtitle,
            and this dialog kept passing `description` into nothing — ~25 call
            sites' consequence copy ("This moves real money and can't be undone
            here", "Permanent. Job history … gone for good") was silently
            dropped. That same decision says copy a sighted user must read
            belongs in the dialog body, so that is where it is rendered.
            Falsy/empty descriptions render nothing. */}
        {description ? (
          <AlertDialogDescription
            className="font-serif italic text-ds-12 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {description}
          </AlertDialogDescription>
        ) : null}

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
          {/* No per-dialog className. `rounded-ds-md` and `mt-0` are already
              what AlertDialogCancel applies, and `border-border/60` was
              styling a border the ghost treatment no longer draws. */}
          <AlertDialogCancel
            onClick={onSecondary ? (e) => { e.preventDefault(); onSecondary(); } : undefined}
          >
            {secondaryLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={primaryToneVariant[primaryTone]}
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
          >
            {primaryLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default BrandConfirmDialog;
