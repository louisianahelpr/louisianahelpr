import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { EnrichedJob } from "@/components/dashboard/types";

type DismissJobDialogProps = {
  confirmDismissJobId: string | null;
  confirmDismissJob: EnrichedJob | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

// "Not interested?" confirmation for hiding a job from the feed. Extracted
// verbatim from Dashboard — same copy, tokens, and classNames.
export function DismissJobDialog({ confirmDismissJobId, confirmDismissJob, onOpenChange, onConfirm }: DismissJobDialogProps) {
  return (
    <AlertDialog open={!!confirmDismissJobId} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg rounded-ds-sm p-4 sm:p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-ds-15 sm:text-ds-17">Not interested?</AlertDialogTitle>
          <AlertDialogDescription className="text-ds-13">
            {confirmDismissJob
              ? <>Remove <span className="font-semibold text-foreground">"{confirmDismissJob.title}"</span> from your feed? You won't see it again.</>
              : "Remove this job from your feed?"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row justify-end gap-2 sm:gap-2">
          <AlertDialogCancel className="mt-0 h-9 px-3 text-ds-13">Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="h-9 px-3 text-ds-13 bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
