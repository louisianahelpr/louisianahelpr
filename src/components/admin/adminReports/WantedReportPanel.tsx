/**
 * A reported or held Wanted post in the reports queue (posting audit 10-30 #8): its words and every photo, with the held
 * ones marked, so an admin judges what members would see. "Take It Down" removes the post and the poster reads the
 * reason. "Show Photos" clears a held photo an admin found fine. The server resolves the report and logs the report id.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogDestructiveAction,
  DialogFooter,
  DialogHero,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { FallbackImg } from "@/components/declutter/FallbackImg";
import { photoPublicUrl, releaseWantedPhotos, takeDownWanted, type ReportedWanted } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";

export function WantedReportPanel({ post, reportId, open, onDone }: {
  post: ReportedWanted;
  reportId: string;
  /** False once the report is resolved or dismissed: the post still reads, and the actions are gone. */
  open: boolean;
  onDone: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast(done);
      setAsking(false);
      onDone();
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-ds-sm bg-muted/50 p-3 text-ds-11" data-wanted-report="">
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="font-semibold">Wanted post: </span>{post.what}</p>
      {post.removed && <p className="font-semibold">This post was taken down or removed.</p>}
      {post.photo_paths.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Photos on this post">
          {post.photo_paths.map((p, i) => (
            <li key={p} className="w-20 space-y-1">
              <a href={photoPublicUrl(p)} target="_blank" rel="noreferrer" aria-label={`Open photo ${i + 1}`} className="block h-20 w-20 overflow-hidden rounded-ds-sm">
                <FallbackImg src={photoPublicUrl(p)} alt="" className="h-full w-full bg-photo-empty object-cover" />
              </a>
              {post.photos_held.includes(p) && <p className="font-semibold text-destructive-ink">Hidden from members</p>}
            </li>
          ))}
        </ul>
      )}
      {open && !post.removed && (
        <div className="flex flex-wrap gap-2 pt-1">
          {post.photos_held.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => releaseWantedPhotos(post.wanted_id, reportId), "Photos showing. The report is closed.")}>
              Show Photos
            </Button>
          )}
          <Button size="sm" variant="outline" className="text-destructive-ink hover:text-destructive-ink" disabled={busy} onClick={() => { setNote(""); setAsking(true); }}>
            Take It Down
          </Button>
        </div>
      )}
      <Dialog open={asking} onOpenChange={(o) => { if (!busy) setAsking(o); }}>
        <DialogContent role="alertdialog">
          <DialogHero title="Take this post down?" />
          <DialogDescription>It comes off Wanted now and can't be posted again. The poster reads your reason.</DialogDescription>
          <Textarea aria-label="Reason the poster reads" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <DialogSecondaryAction disabled={busy}>Cancel</DialogSecondaryAction>
            <DialogDestructiveAction onClick={() => run(() => takeDownWanted(post.wanted_id, note.trim(), reportId), "Post taken down. The poster was told.")} disabled={busy || !note.trim()}>
              {busy ? "Taking it down…" : "Take It Down"}
            </DialogDestructiveAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
