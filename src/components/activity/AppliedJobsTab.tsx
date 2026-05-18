import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Send } from "lucide-react";
import { VirtualList } from "@/components/VirtualList";
import { type Application, type AppliedApp } from "./activityConstants";
import { AppliedJobCard } from "./AppliedJobCard";

interface AppliedJobsTabProps {
  apps: AppliedApp[];
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  startRequestedJobIds: Set<string>;
  helperReviewedJobIds: Set<string>;
  userId: string;
  onHelperResponse: (app: Application, accept: boolean) => void;
  onMarkOnTheWay: (jobId: string) => void;
  onTheWayLoading: string | null;
  onMarkArrived: (jobId: string) => void;
  arrivedLoading: string | null;
  onStartJob: (jobId: string) => void;
  startJobLoading: string | null;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onResolveRevision: (jobId: string) => void;
  onHelperReview: (jobId: string, posterId: string, posterName: string) => void;
}

export const AppliedJobsTab = ({
  apps, expandedJobId, setExpandedJobId, startRequestedJobIds: _startRequestedJobIds,
  helperReviewedJobIds, userId, onHelperResponse,
  onMarkOnTheWay: _onMarkOnTheWay, onTheWayLoading: _onTheWayLoading,
  onMarkArrived: _onMarkArrived, arrivedLoading: _arrivedLoading,
  onStartJob: _onStartJob, startJobLoading: _startJobLoading,
  onComplete, completingJobId,
  onResolveRevision, onHelperReview,
}: AppliedJobsTabProps) => {
  const navigate = useNavigate();
  const [disputeResponse, setDisputeResponse] = useState("");
  const [respondingJobId, setRespondingJobId] = useState<string | null>(null);
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [withdrawingAppId, setWithdrawingAppId] = useState<string | null>(null);
  // Slide-up confirmation sheet for Withdraw — friction where it matters.
  const [withdrawTarget, setWithdrawTarget] = useState<{ appId: string; jobTitle: string } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState<string | null>(null);
  const [editingMessageAppId, setEditingMessageAppId] = useState<string | null>(null);
  const [editMessageText, setEditMessageText] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);

  const handleSaveMessage = async (appId: string) => {
    setSavingMessage(true);
    const { error } = await supabase.from("applications").update({ message: editMessageText.trim() || null }).eq("id", appId);
    if (error) toast.error("Failed to save message");
    else toast.success("Message updated");
    setSavingMessage(false);
    setEditingMessageAppId(null);
  };

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return;
    const { appId, jobTitle } = withdrawTarget;
    setWithdrawingAppId(appId);
    const { error } = await supabase.from("applications").delete().eq("id", appId).eq("helper_id", userId);
    if (error) {
      toast.error("Failed to withdraw application");
    } else {
      toast.success(`Successfully withdrawn from "${jobTitle}"`);
    }
    setWithdrawingAppId(null);
    setWithdrawTarget(null);
  };

  const handleAddAttachment = async (appId: string, jobId: string, currentUrls: string[], file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
    setUploadingAttachment(appId);
    const ext = file.name.split('.').pop();
    const path = `${userId}/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("application-attachments").upload(path, file);
    if (uploadErr) { toast.error("Upload failed"); setUploadingAttachment(null); return; }
    const newUrls = [...currentUrls, path];
    const { error } = await supabase.from("applications").update({ attachment_urls: newUrls }).eq("id", appId);
    if (error) toast.error("Failed to save attachment");
    else toast.success("Attachment added");
    setUploadingAttachment(null);
  };

  const handleRemoveAttachment = async (appId: string, currentUrls: string[], urlToRemove: string) => {
    const newUrls = currentUrls.filter(u => u !== urlToRemove);
    const { error } = await supabase.from("applications").update({ attachment_urls: newUrls }).eq("id", appId);
    if (error) toast.error("Failed to remove attachment");
    else toast.success("Attachment removed");
  };

  if (apps.length === 0) {
    return (
      <div
        className="flex items-stretch h-full"
        style={{
          // Pull the empty-state card past the scroll container's bottom
          // safe-area padding so it bleeds all the way to the panel's
          // bottom edge — like the home page does.
          marginBottom: "calc(-1 * (env(safe-area-inset-bottom, 0px) + 96px))",
        }}
      >
        <div
          className="flex flex-col items-center text-center justify-center gap-4 px-6 py-10 flex-1"
          style={{
            backgroundColor: "hsl(0, 0%, 100%)",
            border: "0.5px solid hsl(var(--olivewood) / 0.10)",
            borderTopLeftRadius: "1rem",
            borderTopRightRadius: "1rem",
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            borderBottom: "none",
            boxShadow:
              "0 1px 2px hsl(var(--olivewood) / 0.04), " +
              "0 12px 32px -8px hsl(var(--olivewood) / 0.14)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 2.5rem)",
          }}
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: "hsla(0, 0%, 100%, 0.55)",
              backdropFilter: "blur(16px) saturate(150%)",
              WebkitBackdropFilter: "blur(16px) saturate(150%)",
              border: "1px solid hsla(0, 0%, 100%, 0.7)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
            }}
          >
            <Send className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
          </div>
          <div className="space-y-1.5">
            <span className="text-display-eyebrow">No applications</span>
            <p
              className="font-display italic font-bold leading-tight"
              style={{
                fontSize: "clamp(1.1rem, 1.5vw + 0.4rem, 1.4rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.02em",
              }}
            >
              Nothing in this view yet.
            </p>
            <p
              className="font-serif italic text-ds-13 leading-relaxed"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              Browse open tasks near you and apply — your applications will land here.
            </p>
          </div>
          <Button onClick={() => navigate("/dashboard")} className="rounded-ds-md btn-press">
            <Send className="w-4 h-4 mr-1.5" /> Browse tasks
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <VirtualList
        items={apps}
        getKey={(app) => app.id}
        estimateSize={260}
        overscan={4}
        itemClassName="pb-3"
        renderItem={(app) => (
          <AppliedJobCard
            app={app}
            expandedJobId={expandedJobId}
            setExpandedJobId={setExpandedJobId}
            helperReviewedJobIds={helperReviewedJobIds}
            userId={userId}
            onHelperResponse={onHelperResponse}
            onComplete={onComplete}
            completingJobId={completingJobId}
            onResolveRevision={onResolveRevision}
            onHelperReview={onHelperReview}
            disputeResponse={disputeResponse}
            setDisputeResponse={setDisputeResponse}
            respondingJobId={respondingJobId}
            setRespondingJobId={setRespondingJobId}
            submittingResponse={submittingResponse}
            setSubmittingResponse={setSubmittingResponse}
            withdrawingAppId={withdrawingAppId}
            setWithdrawTarget={setWithdrawTarget}
            uploadingAttachment={uploadingAttachment}
            editingMessageAppId={editingMessageAppId}
            setEditingMessageAppId={setEditingMessageAppId}
            editMessageText={editMessageText}
            setEditMessageText={setEditMessageText}
            savingMessage={savingMessage}
            handleSaveMessage={handleSaveMessage}
            handleAddAttachment={handleAddAttachment}
            handleRemoveAttachment={handleRemoveAttachment}
          />
        )}
      />

      {/* Withdraw confirmation — slide-up sheet with dimmed backdrop. */}
      <Sheet open={!!withdrawTarget} onOpenChange={(open) => { if (!open) setWithdrawTarget(null); }}>
        <SheetContent
          side="bottom"
          className="rounded-t-[20px] border-t-0 px-5 pt-6 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]"
        >
          {/* Drag-handle affordance */}
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
          <SheetHeader className="text-center">
            <SheetTitle className="font-display text-ds-24 font-bold tracking-tight">
              Withdraw Application?
            </SheetTitle>
            <SheetDescription className="text-ds-11 text-muted-foreground leading-relaxed">
              Withdrawing will remove you from consideration for{" "}
              <span className="font-medium text-foreground">"{withdrawTarget?.jobTitle}"</span>.
              You can re-apply later if the position is still open.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-2.5">
            <Button
              size="lg"
              variant="destructive"
              className="w-full rounded-ds-md text-[15px] font-semibold"
              disabled={!!withdrawingAppId}
              onClick={confirmWithdraw}
            >
              {withdrawingAppId ? "Withdrawing…" : "Confirm Withdrawal"}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full rounded-ds-md text-[15px] font-medium text-muted-foreground hover:text-foreground"
              disabled={!!withdrawingAppId}
              onClick={() => setWithdrawTarget(null)}
            >
              Keep My Application
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
