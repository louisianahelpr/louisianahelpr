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

/**
 * THE READ-BACK OF WHAT THEY SUBMITTED — and it looks like the screen they
 * submitted it on.
 *
 * Owner, 2026-08-30: "this should basically be similar to the screen they
 * applied on. Except this will just show their messages and attachments.
 * Shouldn't be such a big design different." Plus, the same day: "remove eye
 * brows" — reversing the earlier ask that put them back.
 *
 * The screen being matched is ApplyBody (`components/dashboard/applyConfirmDialog`),
 * which is what the helper actually typed into. Three things came straight
 * across from it, and each one replaces something this block was doing
 * differently for no reason:
 *
 *  - **No eyebrow.** ApplyBody had already dropped the burnt-sienna small-caps
 *    label for exactly the reason the owner is now giving here — its own
 *    comment reads "the small-caps italic burnt-sienna eyebrow it replaces was
 *    styled like a section masthead for what is an optional note field." The
 *    two surfaces disagreeing about that is the "big design difference".
 *  - **No tinted panel.** The message sat in a `bg-primary/5` bordered box; on
 *    the apply screen it is a plain field on the sheet. A read-back does not
 *    need more chrome than the thing it reads back.
 *  - **The same type.** `font-sans text-ds-14 leading-relaxed` — literally the
 *    Textarea's own classes — so the sentence reads back at the size it was
 *    written at, and the editor and the static text are the same block of text
 *    rather than two.
 *
 * WHAT LABELS THE BLOCKS NOW THAT THE EYEBROWS ARE GONE: type, not headings.
 * The poster's job description above renders `text-ds-11 text-muted-foreground`
 * (small, grey) and the helper's own message renders `text-ds-14` in
 * `text-foreground` (larger, dark) — so "which of these did I write" is
 * answered by weight and size, the way the apply screen answers it. The words
 * survive for assistive tech: every block keeps a real `sr-only` <label> or
 * heading, so nothing here is an unlabelled control or an anonymous region.
 */
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
  const editing = editingMessageAppId === app.id;
  const messageFieldId = `app-message-${app.id}`;
  const attachmentsHeadingId = `app-attachments-${app.id}`;

  return (
    /* `space-y-3.5` is ApplyBody's own `gap-3.5` between its blocks — the two
       screens stack their sections at the same rhythm. */
    <div className="px-4 pb-3 space-y-3.5">
      <JobCardPhotoStrip urls={job.photos || []} size="sm" stopPropagation />

      {/* The editable "Your Offer" price block lived here, on accept_bids
          jobs only. Bidding was removed (zero production usage), so a
          pending application is just a message + attachments now. */}

      {/* THEIR MESSAGE. */}
      <section aria-label="Your message to the poster" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <div className="space-y-1.5">
            {/* The eyebrow used to be this control's <label htmlFor>, so
                removing it visibly must not remove it structurally — a
                textarea with no accessible name is a WCAG 3.3.2 failure and
                VoiceOver reads it as "text field, blank". `sr-only` keeps the
                association and the announced name, verbatim. */}
            <label htmlFor={messageFieldId} className="sr-only">
              Your message to the poster
            </label>
            <Textarea
              id={messageFieldId}
              value={editMessageText}
              onChange={(e) => setEditMessageText(e.target.value)}
              placeholder="Introduce yourself or share relevant experience…"
              rows={3}
              /* Verbatim from ApplyBody's Textarea. */
              className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-sans text-ds-14 leading-relaxed"
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
          /* Read-back: the sentence, and a pencil. The pencil sits INSIDE the
             text flow rather than in a header bar above it, because there is
             no header bar any more — it is the only control here, so it rides
             the end of the paragraph it edits. */
          <div className="flex items-start justify-between gap-2">
            <p className="font-sans text-ds-14 leading-relaxed text-foreground min-w-0">
              {app.message || <span className="text-muted-foreground italic">No message yet — add one</span>}
            </p>
            <button
              type="button"
              aria-label="Edit your message"
              /* `p-2 -m-2` grows the hit area to ~44px without moving the
                 glyph — the same trick the meta row's location chip uses. */
              className="text-primary hover:text-primary/80 btn-press p-2 -m-2 shrink-0"
              onClick={() => { setEditingMessageAppId(app.id); setEditMessageText(app.message || ""); }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* THEIR ATTACHMENTS. The heading is `sr-only` for the same reason the
          message's label is: the region still has to be named for a screen
          reader even though the owner does not want the name drawn. */}
      <section aria-labelledby={attachmentsHeadingId} className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
        <h4 id={attachmentsHeadingId} className="sr-only">Your attachments</h4>
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
            className="flex items-center gap-2 min-h-11 text-ds-12 text-primary cursor-pointer hover:underline focus-within:underline"
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
          <p className="text-muted-foreground text-ds-12">No attachments yet</p>
        )}
      </section>
    </div>
  );
}
