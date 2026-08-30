import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";

interface ViolationDialogProps {
  pendingViolation: string | null;
  onOpenChange: (open: boolean) => void;
}

export const ViolationDialog = ({
  pendingViolation, onOpenChange,
}: ViolationDialogProps) => {
  return (
    <AlertDialog open={!!pendingViolation} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHero
          title="This Violates Platform Rules"
        />
        {/* Single CTA on purpose. A "Send Anyway" action here was a trap:
            the downstream scan re-blocked the message every time and logged
            a violation per tap, so two taps reached the permanent-ban
            branch. Editing is the only path forward — the server trigger
            remains the true gate. */}
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>
            Edit Message
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
