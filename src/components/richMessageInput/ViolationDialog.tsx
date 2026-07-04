import { ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";

interface ViolationDialogProps {
  pendingViolation: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const ViolationDialog = ({
  pendingViolation, onOpenChange, onConfirm,
}: ViolationDialogProps) => {
  return (
    <AlertDialog open={!!pendingViolation} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHero
          eyebrow={<><ShieldAlert className="w-3 h-3" /> Safety</>}
          eyebrowClassName="inline-flex items-center gap-1.5"
          title="This violates platform rules"
          subtitle={
            <>
              <span className="block">
                We detected <strong className="not-italic text-foreground">{pendingViolation?.toLowerCase()}</strong> in your message.
              </span>
              <span className="block pt-2">
                Payments and conversations outside Helpr aren't protected by our dispute policy or escrow.
                Sending anyway will hide the message from the recipient and add a fraud flag to your account.
                Two flags within 24 hours triggers an automatic 7-day suspension.
              </span>
            </>
          }
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Edit message</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Send anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
