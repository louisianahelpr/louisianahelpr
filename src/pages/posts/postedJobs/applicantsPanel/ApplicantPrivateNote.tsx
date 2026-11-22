import { ListRow } from "@/components/ui/ListRow";
import { Pencil } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useId } from "react";

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
  const noteId = useId();
  if (!editing && !note) return null;
  return (
    <div className={className}>
      <div className="min-w-0 flex-1">
        {editing ? (
          // Audit 11-21 (L27): an empty box with only "Save" beside it: no label, no placeholder, nothing saying it is
          // private. The label says it; Save is the shared Button.
          <div className="space-y-1">
          <label htmlFor={noteId} className="block text-ds-12 font-semibold text-foreground">Private note: only you see this</label>
          <div className="flex gap-2 items-start">
            <Textarea
              id={noteId}
              autoFocus
              placeholder="e.g. Asked about weekend times"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSave(); }
                if (e.key === "Escape") onCancel();
              }}
              className="flex-1 text-ds-12 rounded-ds-sm border border-input bg-background px-2 py-1 resize-none min-h-0"
              rows={2}
            />
            <Button type="button" variant="outline" size="sm" onClick={onSave}>
              Save
            </Button>
          </div>
          </div>
        ) : (
          <ListRow variant="flush"
            onClick={onEdit}
            className="min-h-11 px-0 py-0 text-left w-full text-ds-12 flex items-start gap-1.5"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            <Pencil className="w-3 h-3 mt-0.5 shrink-0" />
            {note}
          </ListRow>
        )}
      </div>
    </div>
  );
}
