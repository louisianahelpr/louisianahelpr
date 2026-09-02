import { useNavigate } from "react-router-dom";
import { Heart, Send, Star, StickyNote, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import UserAvatar from "@/components/UserAvatar";
import { formatName } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { SavedHelper } from "./types";

interface SavedHelperCardProps {
  h: SavedHelper;
  editingNoteFor: string | null;
  noteDraft: string;
  setNoteDraft: (value: string) => void;
  savingNote: boolean;
  openNoteEditor: (helperId: string, current: string | null | undefined) => void;
  cancelNoteEditor: () => void;
  saveNote: (helperId: string) => void;
  handleRemove: (helperId: string) => void;
}

export function SavedHelperCard({
  h,
  editingNoteFor,
  noteDraft,
  setNoteDraft,
  savingNote,
  openNoteEditor,
  cancelNoteEditor,
  saveNote,
  handleRemove,
}: SavedHelperCardProps) {
  const navigate = useNavigate();
  // The card must HUG its content. Three derived flags below decide whether a
  // block renders at all, instead of a block rendering empty and reserving the
  // height its content would have taken (owner, 2026-08-31: "a visible empty
  // band between the name and Add a Private Note where the missing metadata
  // line used to be"). Measured on the real screen at 375: a helpr with no
  // shared history and no note was 190px against a fully-populated 220.5px —
  // 86% of the height for ~40% of the ink.
  const hasHistory = h.completed_jobs_together > 0 || !!h.last_job_at;
  const hasNote = !!h.private_note?.trim();
  const isEditingNote = editingNoteFor === h.helper_id;
  return (
    // Whole card opens the helpr's profile (item 26) — the separate
    // "Profile" button was redundant with this. `role="button"` + tabIndex
    // since the card holds real interactive children (note editor, Offer a
    // Job, Remove) that must NOT double-fire the card's own navigation —
    // each stops propagation instead of the card being wrapped in a <Link>,
    // which would otherwise nest interactive elements inside an anchor.
    <div
      key={h.helper_id}
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/user/${h.helper_id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/user/${h.helper_id}`);
        }
      }}
      aria-label={`View ${formatName(h.full_name)}'s profile`}
      className="rounded-2xl liquid-glass p-4 space-y-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* `items-center`, not `items-start`. The avatar is a 48px block and the
          name is a 20px line, so top-aligning a single-line text column parked
          28px of dead space directly under the name — the "empty band" the
          owner saw. Centering spends the avatar's own height around the name
          instead of below it. When the column is taller than the avatar (name +
          history + skills) the two are identical, so nothing moves on a full
          card. */}
      <div className="flex items-center gap-3">
        {/* Migrated onto the shared `UserAvatar` (2026-08-31). This card used
            to hand-roll both halves and got both wrong: a bare `<img>` with no
            error path at all — so a deleted storage object rendered an empty
            box — layered over initials derived as
            `(full_name || "?").split(" ").map(w => w[0]).join("")`, which
            turns a whitespace-only name into "" and paints a tinted circle
            with nothing in it. Neither the placeholder-URL guard nor the
            blank-bitmap guard could reach it, because it never went through
            the shared component. Sizing and the hairline border stay on the
            wrapper; everything else is now the app-wide avatar behaviour.
            `aria-hidden` because the name is right beside it and the card's
            own `aria-label` already names the person. */}
        <UserAvatar
          userId={h.helper_id}
          src={h.avatar_url}
          name={h.full_name}
          pixelSize={48}
          aria-hidden
          className="w-12 h-12 border border-[hsl(var(--border)/0.6)] shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p
            className="font-display italic font-bold leading-tight truncate text-ds-16"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            {formatName(h.full_name)}
          </p>
          {/* Gated on `hasHistory`. This row used to render unconditionally:
              with no jobs together and no last job it was a zero-height flex
              box that still contributed its own `mt-1`, i.e. 4px of margin
              introducing nothing. A container that reserves space for content
              that isn't there is the exact defect class being removed here. */}
          {hasHistory && (
            <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 font-serif italic flex-wrap text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {h.completed_jobs_together > 0 && (
                <span className="flex items-center gap-1 text-primary">
                  <Star className="w-3 h-3 fill-primary" />
                  {h.completed_jobs_together} job{h.completed_jobs_together === 1 ? "" : "s"} together
                </span>
              )}
              {h.completed_jobs_together > 0 && h.last_job_at && (
                <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
              )}
              {h.last_job_at && (
                <span>
                  Last {formatDistanceToNow(new Date(h.last_job_at), { addSuffix: true })}
                </span>
              )}
            </div>
          )}
          {h.skills && (
            <p className="font-serif italic mt-1.5 line-clamp-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {h.skills}
            </p>
          )}
        </div>
      </div>

      {/* Review-snippet preview REMOVED (item 26, 2026-08-30): redundant
          with the reviews already on the Helpr's own profile page, one tap
          away now that the whole card opens it. */}

      {/* Private note — poster-only memo about this helpr.
          Closed by default, tap to expand into a small
          textarea. Never shown to the helpr (RLS scopes
          reads/writes to customer_id). */}
      {/* stopPropagation on this whole block — it's nested inside the
          card's own click-to-profile handler above, and none of the note
          editor's clicks (open, cancel, save, or typing) should navigate. */}
      {/* Rendered ONLY when there is a note to show or one being written.
          There used to be a third branch here — an "Add a Private Note" text
          button — which meant every note-less card still paid for a whole
          block row: 44px (the global HIG tap-target floor on <button>) plus
          the 10px `space-y-2.5` gap above it, 54px of card height to carry one
          17px line of tertiary text. That affordance now lives in the action
          row below, where a 44px row already exists and it costs nothing. */}
      {(isEditingNote || hasNote) && (
      <div onClick={(e) => e.stopPropagation()}>
        {isEditingNote ? (
          <div
            className="rounded-ds-md p-2.5 space-y-2"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.06)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="e.g. great with painting, prefers Tuesdays"
              rows={2}
              maxLength={500}
              aria-label="Private note about this Helpr"
              className="w-full rounded-ds-sm border border-border/40 bg-card px-2 py-1.5 text-ds-13 font-serif italic resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelNoteEditor}
                disabled={savingNote}
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void saveNote(h.helper_id)}
                disabled={savingNote}
              >
                <Check className="w-3.5 h-3.5" /> {savingNote ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          // Display only — the note is CONTENT, and its editor is the labelled
          // "Note" control in the action row below. It used to be a <button>
          // wrapping the text, which made the same card carry two different
          // ways into the same editor once the row control existed, and left
          // the poster guessing which one was the affordance.
          <div
            className="w-full text-left rounded-ds-md p-2.5 flex gap-2"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.06)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} />
            <p className="font-serif italic text-ds-13 leading-snug flex-1 min-w-0" style={{ color: "hsl(var(--olivewood) / 0.9)" }}>
              {h.private_note}
            </p>
          </div>
        )}
      </div>
      )}

      {/* "Profile" button REMOVED (item 26, 2026-08-30) — the whole card
          now opens the profile, so a dedicated button duplicated the tap
          target. Offer a Job stays a distinct primary action; Remove stays
          isolated so a stray card tap can never fire it. */}
      {/* Three controls now share this row, so the primary CTA's own width is
          measured, not assumed. With the stock `size="sm"` padding it wants
          143px intrinsic; the card's content row is only 222px at 320 and
          277px at 375, and 143 + 8 + 44 + 8 + 44 = 247 does not fit either.
          `!px-2.5` brings it to 131, and dropping the Send glyph below 360
          brings it to 99 — which clears 320's 222px row with 19px to spare.
          The budget to keep is: CTA intrinsic + 8 + 44 + 8 + 44 <= the card's
          content width, and the narrowest content width the grid produces is
          222 at 320, 242 at 900 (rail on, still two columns) and 262 at 1280
          (three columns). Re-check it after ANY change to this row's padding,
          labels or icons — `whitespace-nowrap` means the CTA silently
          overflows its own box instead of wrapping or erroring. */}
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate(`/post-job?offerTo=${h.helper_id}`)}
          className="flex-1 rounded-ds-md !px-2.5"
        >
          <Send className="w-3.5 h-3.5 mr-1.5 hidden min-[360px]:inline-block" />
          Offer a Job
        </Button>
        {/* The note affordance — what used to own a whole row of its own. It
            is a per-card tertiary action, so it belongs beside the other two
            (rebook, unsave) rather than above them, in a 44px row that already
            exists. It renders on EVERY card, adding when there is no note and
            editing when there is, so the three cards in a list have footers of
            identical shape and the primary CTA is the same width on all of
            them. Hidden only while the editor is open, where Cancel/Save are
            the controls.

            It is a square 44px icon target at EVERY width, matching the remove
            heart beside it — deliberately, and measured. A visible "Note"
            label needs 77px instead of 44, and the narrowest card the grid
            ever produces is not a phone: it is 274px at 900 (where the desktop
            rail switches on while the grid is still two columns) and 294px at
            1280 (where it becomes three). Both leave the CTA under its 131px
            intrinsic once a label is in the row, so a label that appears at
            any desktop breakpoint clips "Offer a Job" at the next one. Two
            icon actions flanking one labelled primary is the shape that holds
            at every width from 320 to 1920.
            `aria-label` + `title` carry the name (there is no visible label to
            contradict, so WCAG 2.5.3 is not in play; 4.1.2 is satisfied). */}
        {!isEditingNote && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openNoteEditor(h.helper_id, hasNote ? h.private_note : null)}
            className="rounded-ds-md shrink-0 !w-11 !px-0"
            aria-label={hasNote ? "Edit private note" : "Add a private note"}
            title={hasNote ? "Edit private note" : "Add a private note"}
          >
            <StickyNote className="w-3.5 h-3.5" style={{ color: "hsl(var(--bark))" }} />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleRemove(h.helper_id)}
          className="rounded-ds-md shrink-0 !w-11 !px-0"
          aria-label="Remove from saved"
        >
          <Heart className="w-3.5 h-3.5" style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }} />
        </Button>
      </div>
    </div>
  );
}
