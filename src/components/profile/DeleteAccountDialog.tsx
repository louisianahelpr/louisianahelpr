import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2 } from "lucide-react";

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
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) { setDeleteConfirmText(""); setDeleteStep(1); }
      }}
    >
      <AlertDialogContent className="max-w-md">
        {deleteStep === 1 ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle
                className="font-display italic font-bold text-center"
                style={{
                  fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.65rem)",
                  color: "hsl(var(--ink-deep))",
                  letterSpacing: "-0.025em",
                }}
              >
                Delete your Helpr account?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-center font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                Permanent. Job history, earnings records, and verified credentials will be gone for good.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div
              className="my-2 rounded-ds-md p-3 text-ds-11 flex items-start gap-2"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.08)",
                border: "1px solid hsl(var(--burnt-sienna) / 0.25)",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Any pending or in-transit Stripe payouts will be forfeited. Cash out your available balance from the Earnings tab first.</span>
            </div>
            <AlertDialogFooter className="flex-col-reverse sm:flex-col-reverse gap-2 sm:space-x-0">
              <AlertDialogCancel className="mt-0 rounded-ds-md border-border/60">
                Keep account
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); setDeleteStep(2); }}
                className="rounded-ds-md"
                style={{
                  // Brand-warm "destructive" — burnt sienna instead of
                  // shadcn's generic mauve. Still reads as a stop-and-think
                  // color (warm warning) but lives in the brand palette.
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
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle
                className="font-display italic font-bold flex items-center justify-center gap-2"
                style={{
                  fontSize: "clamp(1.3rem, 2vw + 0.3rem, 1.5rem)",
                  color: "hsl(var(--burnt-sienna))",
                  letterSpacing: "-0.02em",
                }}
              >
                <AlertTriangle className="w-5 h-5" /> Final confirmation
              </AlertDialogTitle>
              <AlertDialogDescription className="text-center font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
                Type <strong className="not-italic font-sans" style={{ color: "hsl(var(--ink-deep))" }}>DELETE MY ACCOUNT</strong> below to confirm. There is no undo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
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
                disabled={deleteConfirmText !== "DELETE MY ACCOUNT" || deletingAccount}
                onClick={onDelete}
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
                Delete forever
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteAccountDialog;
