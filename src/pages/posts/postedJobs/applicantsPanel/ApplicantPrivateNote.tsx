import { Pencil } from "lucide-react";

/**
 * The poster's private note on one applicant: localStorage only, never sent to
 * the server (useApplicantComparison). Shown once one exists or is being
 * written; the note icon on the card or table row starts it. Moved verbatim out
 * of ApplicantsPanel (component-size ratchet) so the desktop table (board 170)
 * shows the same note the phone card does.
 */
export function ApplicantPrivateNote({
  editing,
  note,
  draft,
  setDraft,
  onSave,
  onCancel,
  onEdit,
  className = "pt-1.5 flex items-start justify-between gap-3",
}: {
  editing: boolean;
  note: string | undefined;
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onEdit: () => void;
  className?: string;
}) {
  if (!editing && !note) return null;
  return (
    <div className={className}>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex gap-2 items-start">
            <textarea
              autoFocus
              aria-label="Private note"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSave(); }
                if (e.key === "Escape") onCancel();
              }}
              className="flex-1 text-ds-12 rounded-ds-sm border border-input bg-background px-2 py-1 resize-none"
              rows={2}
            />
            <button
              type="button"
              onClick={onSave}
              className="text-ds-12 font-medium px-2 py-1 rounded"
              style={{ color: "hsl(var(--sage))" }}
            >
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="text-left w-full text-ds-12 flex items-start gap-1.5"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            <Pencil className="w-3 h-3 mt-0.5 shrink-0" />
            {note}
          </button>
        )}
      </div>
    </div>
  );
}
