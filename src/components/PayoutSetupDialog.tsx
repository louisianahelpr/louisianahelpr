import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import { Wallet } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Hard-gate popup that appears when a helpr tries to apply for a job before
 * setting up Stripe Connect payouts. Routes them to Profile → Payment Settings.
 *
 * Companion to PayoutSetupBanner (soft nudge on dashboard).
 */
export default function PayoutSetupDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5 text-primary" />
          </div>
        </div>
        <AlertDialogHero
          title="Set up payouts to apply"
          subtitle="Before you can apply to your first job, you'll need to connect a payout account so we can send you your earnings. It takes about 2 minutes — just once. After that, you're set for every future job and can edit your details anytime in your profile."
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Maybe later</AlertDialogCancel>
          <AlertDialogAction onClick={() => navigate("/profile?tab=payment")}>
            Set up payouts
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
