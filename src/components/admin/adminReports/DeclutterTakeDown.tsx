/**
 * "Take It Down" on a listing report (item B, owner 2026-10-29). The admin writes the reason the seller reads;
 * declutter_admin_take_down_item closes the listing's open offers (buyers told, nothing charged), resolves the
 * report and logs its id in admin_audit_log.
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
import { takeDownListing } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";

export function DeclutterTakeDown({ itemId, reportId, title, onDone }: {
  itemId: string;
  reportId: string;
  title: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await takeDownListing(itemId, note.trim(), reportId);
      toast.success("Listing taken down. The seller and any buyers with offers were told.");
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error(declutterErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" className="text-destructive-ink hover:text-destructive-ink" onClick={() => { setNote(""); setOpen(true); }}>
        Take It Down
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent role="alertdialog">
          <DialogHero title="Take this listing down?" />
          <DialogDescription>
            {title} comes off Declutter now. Open offers close and their buyers are told nothing was charged. The seller reads your reason.
          </DialogDescription>
          <Textarea aria-label="Reason the seller reads" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <DialogSecondaryAction disabled={busy}>Cancel</DialogSecondaryAction>
            <DialogDestructiveAction onClick={submit} disabled={busy || !note.trim()}>
              {busy ? "Taking it down…" : "Take It Down"}
            </DialogDestructiveAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
