import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, Clock, AlertTriangle, Pause, Play } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { PayoutBatch } from "./types";

interface BatchRowProps {
  batch: PayoutBatch;
  tab: "ready" | "hold";
  hold?: { reason: string; addedAt: string; addedBy?: string };
  isSelected: boolean;
  paying: string | null;
  onToggleSelected: (id: string) => void;
  onHold: (batch: PayoutBatch) => void;
  onPay: (batch: PayoutBatch) => void;
  onRelease: (helperId: string) => void;
  onDeny: (batch: PayoutBatch) => void;
}

export const BatchRow = ({
  batch,
  tab,
  hold,
  isSelected,
  paying,
  onToggleSelected,
  onHold,
  onPay,
  onRelease,
  onDeny,
}: BatchRowProps) => {
  const ageDays = Math.floor((Date.now() - new Date(batch.oldest_completed_at).getTime()) / 86_400_000);
  const isStale = ageDays >= 3;
  const isHeld = !!hold;
  return (
    <div className="rounded-ds-md liquid-glass p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      {tab === "ready" && batch.stripe_account_id && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelected(batch.helper_id)}
          aria-label={`Select ${batch.helper_name} for bulk payout`}
          className="mt-0.5"
        />
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-ds-13 text-foreground truncate">{batch.helper_name}</span>
          <Badge variant="secondary" className="text-ds-10">
            {batch.job_count} job{batch.job_count > 1 ? "s" : ""}
          </Badge>
          {!batch.stripe_account_id && (
            <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-ds-10">
              <AlertTriangle className="w-3 h-3 mr-0.5" /> No Stripe
            </Badge>
          )}
          {isStale && (
            <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-ds-10">
              <Clock className="w-3 h-3 mr-0.5" /> {ageDays}d old
            </Badge>
          )}
          {isHeld && (
            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-ds-10">
              <Pause className="w-3 h-3 mr-0.5" /> On hold
            </Badge>
          )}
        </div>
        <p className="text-ds-11 text-muted-foreground">{batch.helper_email}</p>
        <p className="text-ds-11 text-muted-foreground">
          Oldest job: {formatDistanceToNow(new Date(batch.oldest_completed_at), { addSuffix: true })}
        </p>
        {isHeld && hold.reason && (
          <p className="text-ds-11 text-amber-700 dark:text-amber-300 italic mt-1">
            Hold reason: {hold.reason}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 space-y-1">
        <p className="text-ds-17 font-bold text-primary">${Number(batch.total_payout).toFixed(2)}</p>
        {tab === "ready" ? (
          <div className="flex gap-1.5 justify-end flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onHold(batch)}
              className="gap-1"
            >
              <Pause className="w-3 h-3" /> Hold
            </Button>
            <Button
              size="sm"
              disabled={paying === batch.helper_id || !batch.stripe_account_id}
              onClick={() => onPay(batch)}
            >
              <Send className="w-3 h-3 mr-1" />
              {paying === batch.helper_id ? "Sending…" : "Pay out"}
            </Button>
          </div>
        ) : (
          <div className="flex gap-1.5 justify-end flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRelease(batch.helper_id)}
              className="gap-1"
            >
              <Play className="w-3 h-3" /> Release
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 gap-1"
              onClick={() => onDeny(batch)}
            >
              Deny
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
