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
          title="This Violates Platform Rules"
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
