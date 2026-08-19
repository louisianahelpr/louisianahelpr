import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip, FileText, Trash2, Pencil, Check, X } from "lucide-react";
import { AttachmentLink } from "@/components/AttachmentLink";
import { JobCardPhotoStrip } from "../JobCardPhotoStrip";
import type { AppliedApp, Job } from "../activityConstants";

interface PendingApplicationSectionProps {
  app: AppliedApp;
  job: Job;
  uploadingAttachment: string | null;
  editingMessageAppId: string | null;
  setEditingMessageAppId: (id: string | null) => void;
  editMessageText: string;
  setEditMessageText: (value: string) => void;
  savingMessage: boolean;
  handleSaveMessage: (appId: string) => void;
  handleAddAttachment: (appId: string, jobId: string, currentUrls: string[], file: File) => void;
  handleRemoveAttachment: (appId: string, currentUrls: string[], urlToRemove: string) => void;
}

export function PendingApplicationSection({
  app,
  job,
  uploadingAttachment,
  editingMessageAppId,
  setEditingMessageAppId,
  editMessageText,
  setEditMessageText,
  savingMessage,
  handleSaveMessage,
  handleAddAttachment,
  handleRemoveAttachment,
}: PendingApplicationSectionProps) {
  return (
    <div className="px-4 pb-3 space-y-2">
      <JobCardPhotoStrip urls={job.photos || []} size="sm" stopPropagation />

      {/* The editable "Your Offer" price block lived here, on accept_bids
          jobs only. Bidding was removed (zero production usage), so a
          pending application is just a message + attachments now. */}

      {/* Your application message — editable */}
      <div className="rounded-ds-sm bg-primary/5 border border-primary/15 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-ds-10 text-muted-foreground font-medium">Your Message</p>
          {editingMessageAppId !== app.id && (
            <button
              type="button"
              aria-label="Edit your message"
              className="text-primary hover:text-primary/80 btn-press p-0.5 -m-0.5"
              onClick={() => { setEditingMessageAppId(app.id); setEditMessageText(app.message || ""); }}
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
        {editingMessageAppId === app.id ? (
          <div className="space-y-1.5">
            <Textarea
              value={editMessageText}
              onChange={(e) => setEditMessageText(e.target.value)}
              aria-label="Edit your application message"
              placeholder="Introduce yourself or share relevant experience…"
              rows={3}
              className="text-ds-11"
            />
            <div className="flex items-center gap-1.5 justify-end">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-ds-11" onClick={() => setEditingMessageAppId(null)} disabled={savingMessage}>
                <X className="w-3 h-3 mr-0.5" /> Cancel
              </Button>
              <Button size="sm" className="h-7 px-2 text-ds-11" onClick={() => handleSaveMessage(app.id)} disabled={savingMessage}>
                <Check className="w-3 h-3 mr-0.5" /> {savingMessage ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-ds-11 text-foreground">{app.message || <span className="text-muted-foreground italic">No message — tap the pencil to add one</span>}</p>
        )}
      </div>

      {/* Your attachments */}
      <div className="space-y-1.5">
        <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide">Your Attachments</p>
        {(app.attachment_urls || []).map((url, i) => {
          const last = url.split('/').pop() || `File ${i + 1}`;
          let filename = last;
          try { filename = decodeURIComponent(last); } catch {}
          return (
            <div key={i} className="flex items-center gap-2 text-ds-11 bg-secondary/30 rounded-ds-sm px-2.5 py-1.5">
              <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate flex-1 text-foreground">
                {filename.length > 30 ? filename.slice(-30) : filename}
              </span>
              <AttachmentLink url={url} index={i} variant="chip" className="!px-1.5 !py-0.5" />
              <button type="button" onClick={(e) => { e.stopPropagation(); handleRemoveAttachment(app.id, app.attachment_urls || [], url); }} aria-label="Remove attachment" className="text-destructive hover:text-destructive/80">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {(app.attachment_urls || []).length < 5 && (
          <label className="flex items-center gap-2 text-ds-11 text-primary cursor-pointer hover:underline" onClick={(e) => e.stopPropagation()}>
            <Paperclip className="w-3.5 h-3.5" />
            <span>{uploadingAttachment === app.id ? "Uploading…" : "Add cert or work sample"}</span>
            <input
              type="file"
              className="hidden"
              accept="image/*,.pdf,.doc,.docx"
              disabled={uploadingAttachment === app.id}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAddAttachment(app.id, app.job_id, app.attachment_urls || [], file);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {(app.attachment_urls || []).length === 0 && !uploadingAttachment && (
          <p className="text-muted-foreground text-ds-11">No attachments yet</p>
        )}
      </div>
    </div>
  );
}
