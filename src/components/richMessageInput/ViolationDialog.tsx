import { ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive" />
            This violates platform rules
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 pt-2">
            <span className="block">
              We detected <strong className="text-foreground">{pendingViolation?.toLowerCase()}</strong> in your message.
            </span>
            <span className="block text-ds-11">
              Payments and conversations outside Helpr aren't protected by our dispute policy or escrow.
              Sending anyway will hide the message from the recipient and add a fraud flag to your account.
              Two flags within 24 hours triggers an automatic 7-day suspension.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
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
