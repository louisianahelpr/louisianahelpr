import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHero } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2 } from "lucide-react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { hapticError } from "@/lib/haptics";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deleteStep: 1 | 2;
  setDeleteStep: (step: 1 | 2) => void;
  deleteConfirmText: string;
  setDeleteConfirmText: (value: string) => void;
  deletingAccount: boolean;
  onDelete: () => void;
}

// Step 2 asks users to type a confirmation phrase. Short enough that
// thumb-typing on iPhone isn't punishment, long enough that nobody
// hits Delete forever by accident.
const CONFIRM_PHRASE = "DELETE";

export function DeleteAccountDialog({
  open,
  onOpenChange,
  deleteStep,
  setDeleteStep,
  deleteConfirmText,
  setDeleteConfirmText,
  deletingAccount,
  onDelete,
}: DeleteAccountDialogProps) {
  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (!o) { setDeleteConfirmText(""); setDeleteStep(1); }
  };

  if (deleteStep === 1) {
    return (
      <BrandConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Delete Your Helpr Account?"
        description="Permanent. Job history, earnings records, and verified credentials will be gone for good."
        callout={{
          icon: AlertTriangle,
          text: "Any pending or in-transit Stripe payouts will be forfeited. Cash out your available balance from the Earnings tab first.",
        }}
        primaryLabel="Continue"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={(e) => { e.preventDefault(); setDeleteStep(2); }}
        secondaryLabel="Keep Account"
      />
    );
  }

  // Step 2 keeps its own shell because it needs an inline input and
  // the title includes a sienna AlertTriangle icon — slightly outside
  // the BrandConfirmDialog contract.
  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHero
          title={<><AlertTriangle className="w-5 h-5" /> Final confirmation</>}
        />
        {/* The field used to carry the only instruction — a placeholder that
            vanishes the moment you start typing, with nothing above it saying
            why. `aria-label` covered screen readers; sighted users got a bare
            box under a title. This is the visible instruction that stays put. */}
        <AlertDialogDescription>
          Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> below to confirm.
        </AlertDialogDescription>
        <Input
          autoFocus
          aria-label={`Type ${CONFIRM_PHRASE} to confirm account deletion`}
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          className="my-2 h-11 text-center font-mono tracking-wide rounded-ds-md"
          disabled={deletingAccount}
        />
        <AlertDialogFooter className="flex-col-reverse sm:flex-col-reverse gap-2 sm:space-x-0">
          <AlertDialogCancel
            disabled={deletingAccount}
            onClick={(e) => { e.preventDefault(); setDeleteStep(1); setDeleteConfirmText(""); }}
            className="mt-0 rounded-ds-md border-border/60"
          >
            Back
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={deleteConfirmText !== CONFIRM_PHRASE || deletingAccount}
            onClick={() => { void hapticError(); onDelete(); }}
            className="rounded-ds-md"
            style={{
              background: "hsl(var(--burnt-sienna))",
              color: "hsl(var(--parchment))",
              border: "1px solid hsl(19 75% 28%)",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              boxShadow:
                "inset 0 1px 0 0 rgba(255, 255, 255, 0.12), " +
                "0 1px 2px hsl(19 75% 18% / 0.18), " +
                "0 6px 14px -4px hsl(var(--burnt-sienna) / 0.4)",
            }}
          >
            {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Delete Forever
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteAccountDialog;
