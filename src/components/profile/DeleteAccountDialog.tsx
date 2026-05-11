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
              <AlertDialogTitle>Delete your Helpr account?</AlertDialogTitle>
              <AlertDialogDescription>
                This action is permanent. You will lose your job history, earnings records, and verified credentials. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="my-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Any pending or in-transit Stripe payouts will be forfeited. Cash out your available balance from the Earnings tab first.</span>
            </div>
            <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <AlertDialogCancel className="mt-0 sm:flex-1">Keep Account</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); setDeleteStep(2); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-1"
              >
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Final Confirmation
              </AlertDialogTitle>
              <AlertDialogDescription>
                Type <strong className="text-foreground">DELETE MY ACCOUNT</strong> below to confirm. There is no undo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
              className="my-2 h-11 text-center font-mono tracking-wide"
              disabled={deletingAccount}
            />
            <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <AlertDialogCancel
                disabled={deletingAccount}
                onClick={(e) => { e.preventDefault(); setDeleteStep(1); setDeleteConfirmText(""); }}
                className="mt-0 sm:flex-1"
              >
                Back
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteConfirmText !== "DELETE MY ACCOUNT" || deletingAccount}
                onClick={onDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-1"
              >
                {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Delete Forever
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteAccountDialog;
