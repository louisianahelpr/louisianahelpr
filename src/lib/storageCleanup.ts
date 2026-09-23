/**
 * Removing the storage a deleted row owned, from the client.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * The 2026-09-14 storage audit (docs/archive/storage-audit-2026-09-14.md) found
 * files outliving their rows: a chat attachment whose message was deleted
 * (`Messages.tsx` deleteMessage removed the row only), and job photos of jobs
 * deleted after a failed checkout (`cleanupOrphanJob`). Once the row is gone
 * nothing can reach the file.
 *
 * ── Rules ───────────────────────────────────────────────────────────────────
 * 1. Call BEFORE the row delete. Storage RLS is what lets this caller remove
 *    the file, and both policies read the row: `message-attachments` SELECT
 *    requires a `messages.attachment_url` naming the object (and remove()
 *    returns the deleted rows, so it needs SELECT), `job-photos` DELETE
 *    requires a job the caller posted.
 * 2. Never throws and never blocks the deletion. A failure is reported
 *    (`report()`), not dropped, and the weekly storage-orphan-sweep is the net.
 * 3. `remove()` answers `{ data: [], error: null }` for paths it did not
 *    delete, so the count that came back is checked, never assumed.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

const MARKER = "/message-attachments/";

/** The object path from a stored `attachment_url` (bare path or full URL). */
export function messageAttachmentObjectPath(attachmentUrl: string | null | undefined): string | null {
  if (!attachmentUrl) return null;
  const idx = attachmentUrl.indexOf(MARKER);
  const raw = idx >= 0 ? attachmentUrl.slice(idx + MARKER.length).split("?")[0] : attachmentUrl;
  if (!raw || /^https?:/i.test(raw)) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed % escape in client-written text: use the raw path, as accountPurge does.
    return raw;
  }
}

async function removePaths(bucket: string, paths: string[], source: string, context: Record<string, unknown>): Promise<number> {
  if (paths.length === 0) return 0;
  try {
    const { data, error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      report(error, { tags: { source, kind: "storage_remove_failed" }, context: { bucket, ...context } });
      return 0;
    }
    const removed = data?.length ?? 0;
    if (removed < paths.length) {
      report(new Error(`Storage remove deleted ${removed} of ${paths.length} object(s)`), {
        severity: "warning",
        tags: { source, kind: "storage_remove_incomplete" },
        context: { bucket, requested: paths.length, removed, ...context },
      });
    }
    return removed;
  } catch (err) {
    report(err, { tags: { source, kind: "storage_remove_failed" }, context: { bucket, ...context } });
    return 0;
  }
}

/** Remove a message's attachment. Call before deleting the message row. */
export async function removeMessageAttachment(attachmentUrl: string | null | undefined, messageId: string): Promise<number> {
  const path = messageAttachmentObjectPath(attachmentUrl);
  if (!path) return 0;
  return removePaths("message-attachments", [path], "Messages.deleteMessage", { message_id: messageId });
}

/**
 * Remove every photo and the scope video of a job the caller posted. Call
 * before deleting the job row. Paths are `<jobId>/…` (useJobMediaUpload.ts).
 */
export async function removeJobPhotos(jobId: string, source: string): Promise<number> {
  try {
    const { data, error } = await supabase.storage.from("job-photos").list(jobId, { limit: 1000 });
    if (error) {
      report(error, { tags: { source, kind: "storage_list_failed" }, context: { bucket: "job-photos", job_id: jobId } });
      return 0;
    }
    const paths = (data ?? []).filter((o) => o.id != null).map((o) => `${jobId}/${o.name}`);
    return removePaths("job-photos", paths, source, { job_id: jobId });
  } catch (err) {
    report(err, { tags: { source, kind: "storage_list_failed" }, context: { bucket: "job-photos", job_id: jobId } });
    return 0;
  }
}
