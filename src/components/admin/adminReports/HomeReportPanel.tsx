/**
 * A Homes listing report in the admin reports queue (audit 11-05 A-H2, 20261106165850): the copy the report kept, a
 * link to the listing, and "Take It Down". That runs rentals_admin_remove_listing (20261104175521): every open
 * listing on the property comes down, the owner reads the reason, and it is written to the admin audit log. Then the
 * report resolves.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
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
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";
import { homeCanComeDown, type ReportedHome } from "./reportedHomes";

/** rentals_admin_remove_listing refuses a reason under 5 characters (reason_required). */
const HOME_TAKEDOWN_MIN_REASON = 5;

// RentalsCopyError carries the admin copy's words for a refusal (adminRemoveListing); a report that didn't close
// carries unwrapMutation's userMessage.
const errorWords = (err: unknown) => {
  const e = err as { words?: string | null; userMessage?: string } | null;
  return e?.words ?? e?.userMessage ?? "That didn't work. Refresh the reports list and try again.";
};

export function HomeReportPanel({ home, reportId, content, open: reportOpen, onDone }: {
  home: ReportedHome | undefined;
  reportId: string;
  content: string | null | undefined;
  /** The report is still pending or being looked at. */
  open: boolean;
  onDone: () => void;
}) {
  const [dialog, setDialog] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!home) return;
    setBusy(true);
    try {
      const { adminRemoveListing } = await import("@/lib/rentals/listings");
      await adminRemoveListing(home.id, note.trim());
      // The listing is down either way; a report that didn't resolve stays in the queue for the next look.
      unwrapMutation(await supabase.from("reports").update({ status: "resolved" }).eq("id", reportId).select("id"),
        { action: "close this report", context: { reportId } });
      toast("Listing taken down. Its owner was told why.");
      setDialog(false);
      onDone();
    } catch (err) {
      toast.error(errorWords(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-ds-sm bg-muted/50 p-3 text-ds-11" data-home-report={home ? home.status : "gone"}>
      {content && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="font-semibold">Reported listing: </span>{content}</p>}
      {home && !homeCanComeDown(home) && <p className="font-semibold">This listing is no longer up.</p>}
      <div className="flex flex-wrap gap-2">
        {home && (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/rentals/listings/${home.id}`}>View Listing</Link>
          </Button>
        )}
        {home && reportOpen && homeCanComeDown(home) && (
          <Button size="sm" variant="outline" className="text-destructive-ink hover:text-destructive-ink" onClick={() => { setNote(""); setDialog(true); }}>
            Take It Down
          </Button>
        )}
      </div>
      <Dialog open={dialog} onOpenChange={(o) => { if (!busy) setDialog(o); }}>
        <DialogContent role="alertdialog">
          <DialogHero title="Take this listing down?" />
          <DialogDescription>
            {`"${home?.headline ?? "This listing"}" and every other open listing on the same property come down now. The address can't be listed again until an admin lifts it. The owner reads your reason.`}
          </DialogDescription>
          <Textarea aria-label="Reason the owner reads" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <DialogSecondaryAction disabled={busy}>Cancel</DialogSecondaryAction>
            <DialogDestructiveAction onClick={submit} disabled={busy || note.trim().length < HOME_TAKEDOWN_MIN_REASON}>
              {busy ? "Working…" : "Take It Down"}
            </DialogDestructiveAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
