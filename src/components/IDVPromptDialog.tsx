import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Camera, FileCheck2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface IDVPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: short message describing why verification is required right now. */
  reason?: string;
  /** Called after the Stripe Identity tab is launched. */
  onLaunched?: () => void;
}

export function IDVPromptDialog({ open, onOpenChange, reason, onLaunched }: IDVPromptDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-idv-start", { body: {} });
      if (error) throw error;
      if (data?.alreadyVerified) {
        toast.success("You're already verified!");
        onOpenChange(false);
        onLaunched?.();
        return;
      }
      if (!data?.url) throw new Error("Could not start verification");
      window.open(data.url, "_blank", "noopener,noreferrer");
      toast.info("Verification opened in a new tab. Come back when it's done.");
      onOpenChange(false);
      onLaunched?.();
    } catch (e: any) {
      toast.error(e?.message || "Could not start verification");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[12px] p-5">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <DialogTitle>Verify your identity</DialogTitle>
          </div>
          <DialogDescription>
            {reason ?? "Helpr requires a quick ID + selfie check before you accept your first job. This protects posters and keeps the platform safe."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-start gap-3 p-3 rounded-[12px] bg-muted/40 border border-border">
            <FileCheck2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Photo of your government ID</p>
              <p className="text-muted-foreground text-xs">Driver's license, passport, or state ID</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-[12px] bg-muted/40 border border-border">
            <Camera className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-foreground">A quick selfie</p>
              <p className="text-muted-foreground text-xs">We compare it to your ID to make sure it's really you</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Verification is handled securely by Stripe Identity. Most checks finish in under 2 minutes.
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="rounded-[12px]">
            Not now
          </Button>
          <Button onClick={handleStart} disabled={loading} className="rounded-[12px]">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            Start verification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
