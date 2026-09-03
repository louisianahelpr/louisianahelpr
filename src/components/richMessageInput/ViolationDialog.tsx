import {
  Dialog,
  DialogPrimaryAction,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";

interface ViolationDialogProps {
  pendingViolation: string | null;
  onOpenChange: (open: boolean) => void;
}

export const ViolationDialog = ({
  pendingViolation, onOpenChange,
}: ViolationDialogProps) => {
  return (
    <Dialog open={!!pendingViolation} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog">
        <DialogHero
          title="This Violates Platform Rules"
        />
        {/* Single CTA on purpose. A "Send Anyway" action here was a trap:
            the downstream scan re-blocked the message every time and logged
            a violation per tap, so two taps reached the permanent-ban
            branch. Editing is the only path forward — the server trigger
            remains the true gate. */}
        <DialogFooter>
          <DialogPrimaryAction onClick={() => onOpenChange(false)}>
            Edit Message
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
