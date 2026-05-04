import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react";
import { toast } from "sonner";

interface JobBoostDialogProps {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onBoosted: () => void;
}

export function JobBoostDialog({ jobId, open, onClose }: JobBoostDialogProps) {
  const [boosting, setBoosting] = useState(false);

  const handleBoost = async () => {
    setBoosting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-boost-payment", {
        body: { job_id: jobId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("No checkout URL returned");
      // Redirect to Stripe Checkout. The webhook will flip the boost flags
      // on the job once payment captures, so we don't update the DB here.
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to start boost checkout");
      setBoosting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-primary" /> Boost Your Job
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-center space-y-2">
            <p className="text-3xl font-bold text-foreground">$3</p>
            <p className="text-xs text-muted-foreground">Your job will appear at the top of the feed for <span className="font-semibold text-foreground">24 hours</span></p>
          </div>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs">✓</span>
              Featured placement at top of browse feed
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs">✓</span>
              "Boosted" badge makes your post stand out
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs">✓</span>
              Get more applications, faster
            </li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleBoost} disabled={boosting}>
            <Rocket className="w-4 h-4 mr-1" />
            {boosting ? "Boosting..." : "Boost for $3"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
