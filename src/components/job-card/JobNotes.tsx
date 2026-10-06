import { KeyRound, Wrench, type LucideIcon } from "lucide-react";

/**
 * THE POSTER'S TWO NOTES, ONE TREATMENT (Q1438, owner 2026-10-06).
 *
 *   Materials provided — what the poster will have on site. PUBLIC: shown to
 *     everyone who can see the job (jobs.materials_note).
 *   Access & Parking   — gate codes, where to park, which door. PRIVATE: only
 *     the poster and the booked Helpr(s) ever receive it (job_access_notes,
 *     RLS), so a surface passes `access` only from useJobAccessNote.
 *
 * Both used to be one string in jobs.special_requirements that only the
 * poster's own card printed, under "Special Requirements". Every surface that
 * shows either note renders it through this component, so the labels, the
 * order and the wrapping are one decision, not four.
 *
 * Labels address nobody in particular (CLAUDE.md: copy is never for one role
 * only): "Materials provided" reads the same to the poster and the Helpr.
 */
export interface JobNotesProps {
  materials?: string | null;
  access?: string | null;
  className?: string;
}

export const MATERIALS_LABEL = "Materials provided";
export const ACCESS_LABEL = "Access & Parking";

export function JobNotes({ materials, access, className }: JobNotesProps) {
  const m = materials?.trim();
  const a = access?.trim();
  if (!m && !a) return null;
  return (
    <div className={`space-y-1.5 min-w-0 ${className ?? ""}`} data-job-notes="">
      {m && <JobNote label={MATERIALS_LABEL} icon={Wrench} text={m} testId="job-note-materials" />}
      {a && <JobNote label={ACCESS_LABEL} icon={KeyRound} text={a} testId="job-note-access" />}
    </div>
  );
}

/** True when JobNotes would render something (for a card deciding whether its body band has content). */
export function hasJobNotes(materials?: string | null, access?: string | null): boolean {
  return !!materials?.trim() || !!access?.trim();
}

function JobNote({ label, icon: Icon, text, testId }: { label: string; icon: LucideIcon; text: string; testId: string }) {
  return (
    <section aria-label={label} data-testid={testId} className="rounded-ds-sm bg-secondary/30 p-2 min-w-0">
      <p className="text-ds-10 text-muted-foreground mb-0.5 flex items-center gap-1">
        <Icon aria-hidden className="w-2.5 h-2.5 shrink-0" />
        <span>{label}</span>
      </p>
      {/* `break-words`: a gate code or a pasted address is one unbroken token
          and must wrap, never clip (measured at 375 on the description,
          2026-09-07). `whitespace-pre-line` keeps the poster's line breaks. */}
      <p className="text-ds-11 text-foreground break-words whitespace-pre-line">{text}</p>
    </section>
  );
}
