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

export function JobBoostDialog({ jobId, open, onClose, onBoosted }: JobBoostDialogProps) {
  const [boosting, setBoosting] = useState(false);

  const handleBoost = async () => {
    setBoosting(true);
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

      const { error } = await supabase
        .from("jobs")
        .update({
          boosted_at: now.toISOString(),
          boost_expires_at: expiresAt.toISOString(),
        } as any)
        .eq("id", jobId);

      if (error) throw error;
      toast.success("Job boosted! It will appear at the top of the feed for 24 hours.");
      onBoosted();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to boost job");
    } finally {
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
            <p className="text-sm text-muted-foreground">Your job will appear at the top of the feed for <span className="font-semibold text-foreground">24 hours</span></p>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
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
