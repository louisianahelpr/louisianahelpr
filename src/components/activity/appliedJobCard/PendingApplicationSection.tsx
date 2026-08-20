import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip, Trash2, Pencil, Check, X } from "lucide-react";
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
          {/* Same eyebrow token as "Your attachments" 40px below. These were
              `text-ds-10 font-medium` Title Case and `text-ds-10 uppercase
              tracking-wide font-semibold` respectively — two sibling labels,
              two treatments, neither matching the card's own eyebrow. */}
          <p
            className="font-serif italic uppercase text-ds-10"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Your message
          </p>
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
          <p className="text-ds-11 text-foreground">{app.message || <span className="text-muted-foreground italic">No message yet — add one</span>}</p>
        )}
      </div>

      {/* Your attachments */}
      <div className="space-y-1.5">
        <p
          className="font-serif italic uppercase text-ds-10"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
        >
          Your attachments
        </p>
        {/* Each row used to render a FileText icon and the filename, then embed
            an <AttachmentLink variant="chip"> that renders its OWN FileText and
            the SAME filename inside its own tinted chip — a chip inside a chip
            with the icon and name doubled. AttachmentLink owns the whole row
            now; the trash sits outside it.

            The name is no longer sliced in JS either: `filename.slice(-30)` cut
            the HEAD off with no ellipsis while the CSS `truncate` on the same
            span cut the TAIL, so a long name rendered chopped at both ends with
            one visible ellipsis. `truncate` alone handles it. */}
        {(app.attachment_urls || []).map((url, i) => (
          <div key={i} className="flex items-center gap-1">
            <AttachmentLink url={url} index={i} variant="chip" className="flex-1 min-w-0" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleRemoveAttachment(app.id, app.attachment_urls || [], url); }}
              aria-label="Remove attachment"
              className="shrink-0 hover:opacity-70"
              style={{ color: "hsl(var(--danger-ink))" }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {(app.attachment_urls || []).length < 5 && (
          // `hidden` on the input is `display: none`, which takes it OUT of the
          // tab order — and a <label> is not focusable — so adding an
          // attachment was unreachable by keyboard entirely (WCAG 2.1.1). It
          // was also the smallest target on the card at ~16px tall, since the
          // global 44px minimum applies to `button`, not `label`. `sr-only`
          // keeps the input focusable; `min-h-11` gives the row a real target.
          <label
            className="flex items-center gap-2 min-h-11 text-ds-11 text-primary cursor-pointer hover:underline focus-within:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <Paperclip className="w-3.5 h-3.5" />
            <span>{uploadingAttachment === app.id ? "Uploading…" : "Add cert or work sample"}</span>
            <input
              type="file"
              className="sr-only"
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
