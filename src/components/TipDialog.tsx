import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gift } from "lucide-react";
import { toast } from "sonner";

interface TipDialogProps {
  jobId: string;
  helperName?: string;
  open: boolean;
  onClose: () => void;
}

const SUGGESTED_AMOUNTS = [5, 10, 20];

export function TipDialog({ jobId, helperName, open, onClose }: TipDialogProps) {
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async (tipAmount: number) => {
    if (isNaN(tipAmount) || tipAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "tip", jobId, amount: tipAmount },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to create tip");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-primary" /> Send a Tip
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Show your appreciation{helperName ? ` to ${helperName}` : ""} with a tip!
          </p>

          {/* Custom amount — primary option */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Enter tip amount</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="1"
                  className="pl-7 text-lg font-semibold h-12"
                />
              </div>
              <Button
                className="h-12 px-6"
                onClick={() => handleSend(parseFloat(amount))}
                disabled={sending || !amount}
              >
                {sending ? "..." : "Send Tip"}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or quick pick</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Suggested amounts */}
          <div className="grid grid-cols-3 gap-3">
            {SUGGESTED_AMOUNTS.map((amt) => (
              <Button
                key={amt}
                variant="outline"
                className="text-lg font-bold h-14 hover:bg-primary hover:text-primary-foreground transition-colors"
                onClick={() => handleSend(amt)}
                disabled={sending}
              >
                ${amt}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
