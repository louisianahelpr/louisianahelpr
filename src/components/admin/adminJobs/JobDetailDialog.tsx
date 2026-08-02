import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { MapPin, Calendar, Clock, DollarSign, User, Trash2, AlertTriangle, Shield, CheckCircle2, History as HistoryIcon } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { paymentStatusLabel } from "@/lib/statusLabels";
import { categoryLabels, paymentColors, type Job } from "./types";
import { formatJobDate } from "@/lib/dateUtils";

interface JobDetailDialogProps {
  detailJob: Job | null;
  deleteOpen: boolean;
  jobFlags: Map<string, string[]>;
  resolvedFlags: Set<string>;
  posterName: string;
  helperName: string;
  onClose: () => void;
  onReopenFlag: (jobId: string) => void;
  onMarkFlagResolved: (jobId: string) => void;
  onOpenDelete: () => void;
  onOpenOverride: (job: Job) => void;
  onOpenRefund: () => void;
}

export const JobDetailDialog = ({
  detailJob,
  deleteOpen,
  jobFlags,
  resolvedFlags,
  posterName,
  helperName,
  onClose,
  onReopenFlag,
  onMarkFlagResolved,
  onOpenDelete,
  onOpenOverride,
  onOpenRefund,
}: JobDetailDialogProps) => {
  return (
    <Dialog open={!!detailJob && !deleteOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHero eyebrow="Job details" title={detailJob?.title} />
        {detailJob && (
          <div className="space-y-4">
            {/* Flags banner */}
            {jobFlags.has(detailJob.id) && (
              resolvedFlags.has(detailJob.id) ? (
                <div className="rounded-ds-sm bg-primary/5 border border-primary/20 p-3 flex items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <p className="text-ds-11 font-semibold text-primary flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Flags marked as resolved
                    </p>
                    <p className="text-ds-11 text-muted-foreground pl-5">An admin reviewed this job and confirmed it's fine.</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onReopenFlag(detailJob.id)}>
                    Reopen
                  </Button>
                </div>
              ) : (
                <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-ds-11 font-semibold text-destructive flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Auto-flagged Issues
                    </p>
                    <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => onMarkFlagResolved(detailJob.id)}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark Resolved
                    </Button>
                  </div>
                  {jobFlags.get(detailJob.id)!.map((flag, i) => (
                    <p key={i} className="text-ds-11 text-destructive/80 pl-5">• {flag}</p>
                  ))}
                </div>
              )
            )}

            {/* Removal info */}
            {detailJob.removal_reason && (
              <div className="rounded-ds-sm bg-destructive/10 border border-destructive/30 p-3">
                <p className="text-ds-11 font-semibold text-destructive flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" /> Removed by Admin
                </p>
                <p className="text-ds-13 text-foreground mt-1">{detailJob.removal_reason}</p>
                {detailJob.removed_at && (
                  <p className="text-ds-11 text-muted-foreground mt-1">
                    Removed on {new Date(detailJob.removed_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {(detailJob.photos || []).length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {(detailJob.photos || []).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                    <img loading="lazy" decoding="async" src={url} alt={`Photo ${i + 1}`} className="w-32 h-24 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="sienna" className="capitalize">{categoryLabels[detailJob.category] || detailJob.category}</Badge>
              <StatusBadge status={detailJob.status} className="text-ds-11" />
              <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium ${paymentColors[detailJob.payment_status || "unpaid"]}`}>
                {paymentStatusLabel(detailJob.payment_status ?? "unpaid")}
              </span>
            </div>

            <p className="text-ds-13 text-foreground">{detailJob.description}</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-ds-sm bg-secondary/30 p-3">
                <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Budget</p>
                <p className="font-semibold text-foreground">${detailJob.budget}</p>
              </div>
              <div className="rounded-ds-sm bg-secondary/30 p-3">
                <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</p>
                <p className="font-semibold text-foreground">{detailJob.location}</p>
              </div>
              <div className="rounded-ds-sm bg-secondary/30 p-3">
                <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Date Needed</p>
                <p className="font-semibold text-foreground">{formatJobDate(detailJob.date_needed)}</p>
              </div>
              {detailJob.start_time && (
                <div className="rounded-ds-sm bg-secondary/30 p-3">
                  <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Start Time</p>
                  <p className="font-semibold text-foreground">{detailJob.start_time}</p>
                </div>
              )}
              {detailJob.estimated_hours && (
                <div className="rounded-ds-sm bg-secondary/30 p-3">
                  <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                  <p className="font-semibold text-foreground">{detailJob.estimated_hours}h</p>
                </div>
              )}
              {detailJob.platform_fee_amount && (
                <div className="rounded-ds-sm bg-secondary/30 p-3">
                  <p className="text-ds-11 text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Platform Fee</p>
                  <p className="font-semibold text-foreground">${detailJob.platform_fee_amount} ({detailJob.platform_fee_percent}%)</p>
                </div>
              )}
            </div>

            {detailJob.special_requirements && (
              <div className="rounded-ds-sm bg-secondary/30 p-3">
                <p className="text-ds-11 text-muted-foreground mb-1">Special Requirements</p>
                <p className="text-ds-13 text-foreground">{detailJob.special_requirements}</p>
              </div>
            )}

            {detailJob.revision_note && (
              <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
                <p className="text-ds-11 text-destructive mb-1">Revision Note</p>
                <p className="text-ds-13 text-foreground">{detailJob.revision_note}</p>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-ds-13">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Posted by</span>
                <span className="font-medium text-foreground">{posterName || "Loading…"}</span>
              </div>
              {detailJob.helper_id && (
                <div className="flex items-center gap-2 text-ds-13">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Assigned to</span>
                  <span className="font-medium text-foreground">{helperName || "Loading…"}</span>
                </div>
              )}
              <p className="text-ds-11 text-muted-foreground">
                Created {new Date(detailJob.created_at).toLocaleString()}
              </p>
            </div>

            {/* Admin actions */}
            {!(detailJob as { removal_reason?: string }).removal_reason && (
              <div className="pt-3 border-t border-border flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onOpenDelete}
                  className="gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove Job
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenOverride(detailJob)}
                  className="gap-1.5"
                >
                  <HistoryIcon className="w-3.5 h-3.5" /> Manual Override
                </Button>
                {/* Refund only relevant when money has actually changed
                    hands. payment_status='escrow' = captured but held.
                    payment_status='released' = transferred to helper. */}
                {(detailJob.payment_status === "escrow" || detailJob.payment_status === "released") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenRefund}
                    className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/5"
                  >
                    <DollarSign className="w-3.5 h-3.5" /> Refund Customer
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
