import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import type { Conversation } from "../types";

/**
 * "Their application" — the applicant's full note, at the top of the poster's
 * chat with them (owner, 2026-10-12: "yes show the full question at the top of
 * the chat"). The Applicants card clamps the note to two lines, so a question
 * asked there ("Do I need to bring my own…") was cut off exactly where the
 * poster opened the chat to answer it.
 *
 * WHO SEES IT: only the job's poster (`viewerIsPoster`), and only when the
 * other person has an application on this job with a non-empty note. The
 * applicant never sees their own note echoed back, and a thread with someone
 * who did not apply has no card.
 *
 * LAYERS (measured live on prod 2026-10-11): the read is the client's own,
 * under RLS. `applications` SELECT policy "Job owners can view applications
 * for their jobs" admits the poster (`auth.uid()` is the job's customer_id,
 * minus blocked pairs), and authenticated holds a column SELECT grant on
 * id, message, created_at and flagged_hidden (flag_reason / message_withheld
 * are withheld, Q1232/Q1206). UNIQUE (job_id, helper_id) makes it one row at
 * most. A note flagged as contact details has its text moved out of
 * `message`, so it has no readable note and no card (the Applicants card
 * already explains the hidden note).
 *
 * WHERE: first inside the thread's bottom-anchored block (ChatView), so it sits
 * directly above the first message, scrolls with the thread and can never cover
 * the composer. Guarded by src/test/chatShowsApplicationNote.test.tsx.
 */

export interface ApplicationNote {
  message: string;
  createdAt: string;
}

/** The columns read. Each must be one authenticated may SELECT
 *  (APPLICATION_READABLE_COLUMN_LIST), or PostgREST refuses the whole read. */
export const APPLICATION_NOTE_COLUMNS = "message, created_at" as const;

/** A row with no application, or a blank note, has no card. */
export function noteFromRow(row: { message: string | null; created_at: string } | null): ApplicationNote | null {
  const message = row?.message?.trim() ?? "";
  if (!row || !message) return null;
  return { message, createdAt: row.created_at };
}

/** The other person's application note on this job, or null when they have
 *  no application or an empty note. Throws on a refused or failed read. */
export async function fetchApplicationNote(jobId: string, applicantId: string): Promise<ApplicationNote | null> {
  const row = unwrap(
    await supabase
      .from("applications")
      .select(APPLICATION_NOTE_COLUMNS)
      .eq("job_id", jobId)
      .eq("helper_id", applicantId)
      .maybeSingle(),
  );
  return noteFromRow(row);
}

/** Whether this thread may show the card at all: the viewer posted the job
 *  and the other person is a live account. */
export function showsApplicationNote(convo: Pick<Conversation, "viewerIsPoster" | "otherUserId">): boolean {
  return convo.viewerIsPoster === true && !!convo.otherUserId;
}

export function ApplicationNoteCard({
  activeConvo,
  fetchNote = fetchApplicationNote,
}: {
  activeConvo: Conversation;
  /** Injected only by tests; the app always reads through Supabase. */
  fetchNote?: typeof fetchApplicationNote;
}) {
  const enabled = showsApplicationNote(activeConvo);
  const jobId = activeConvo.jobId;
  const applicantId = activeConvo.otherUserId ?? "";
  const key = `${jobId}|${applicantId}`;
  const [answer, setAnswer] = useState<{ key: string; note: ApplicationNote | null } | null>(null);

  useEffect(() => {
    if (!enabled || !jobId || !applicantId) return;
    let cancelled = false;
    fetchNote(jobId, applicantId).then(
      (note) => {
        if (!cancelled) setAnswer({ key, note });
      },
      (err: unknown) => {
        // The card is supplementary (the thread works without it), so a failed
        // read leaves it out, but never silently.
        report(err, { tags: { source: "ApplicationNoteCard.fetch" }, context: { job_id: jobId } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, jobId, applicantId, key, fetchNote]);

  const note = enabled && answer?.key === key ? answer.note : null;
  if (!note) return null;
  const applied = new Date(note.createdAt);
  return (
    <section
      aria-label="Their application"
      data-testid="chat-application-note"
      className="mb-3 rounded-ds-md border px-3 py-2.5"
      style={{ borderColor: "hsl(var(--olivewood) / 0.2)", background: "hsl(var(--ivory-sand) / 0.5)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ds-11 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
          Their application
        </h2>
        {!Number.isNaN(applied.getTime()) && (
          <span className="text-ds-11 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
            Applied {applied.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
      <p
        className="mt-1 text-ds-13 leading-snug whitespace-pre-wrap break-words"
        style={{ color: "hsl(var(--ink-deep) / 0.85)" }}
      >
        {note.message}
      </p>
    </section>
  );
}
