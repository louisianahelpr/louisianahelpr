/**
 * Manager mode (owner 11-01, 5:05 PM): the manager drafts, then SENDS IT TO THE SELLER FOR APPROVAL before it posts.
 * This is the seller's "Waiting for your OK" list on Selling: each draft her manager sent, with Send back (a note) and
 * Approve. Approve needs her own tax statements (she attests herself; the manager never does, lead 11-01 5:13 PM) and
 * posts the listing as hers (declutter_manager_approve). Nothing shows when nothing is waiting. Lazy-loaded behind
 * the declutter_manager switch (ManagerWaitingForOkGate in DeclutterHomeView).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/declutter/distance";
import { userFacingError } from "@/lib/userFacingError";
import { approveManagerDraft, fetchWaitingDrafts, sendManagerDraftBack, useMyManagerGrants } from "@/lib/declutter/managerMode";
import { TaxStatementsCheck } from "./declutterUi";

export const WAITING_DRAFTS_KEY = ["declutter", "manager-waiting"] as const;

export default function ManagerWaitingForOk({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [ticked, setTicked] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { data: rows = [] } = useQuery({ queryKey: [...WAITING_DRAFTS_KEY, userId], queryFn: () => fetchWaitingDrafts(userId) });
  const grants = useMyManagerGrants();
  const manager = (grants.data ?? []).find((g) => g.role === "seller" && g.status === "active")?.manager_first_name || "Your manager";

  const done = () => void qc.invalidateQueries({ queryKey: ["declutter"] });
  const approve = useMutation({
    mutationFn: (id: string) => approveManagerDraft(id, { personalUse: true, notBusiness: true, notFrequent: true, keepsItem: true }),
    onSuccess: () => { toast("Approved. It's on sale now."); done(); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't approve that. Try again.")),
  });
  const sendBack = useMutation({
    mutationFn: (a: { id: string; note: string }) => sendManagerDraftBack(a.id, a.note),
    onSuccess: () => { toast(`Sent back to ${manager}.`); setNoteFor(null); setNote(""); done(); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't send that back. Try again.")),
  });

  if (rows.length === 0) return null;
  const busy = approve.isPending || sendBack.isPending;

  return (
    <section aria-labelledby="manager-waiting-title" data-manager-waiting="" className="rounded-[20px] border border-border bg-card p-4">
      <h2 id="manager-waiting-title" className="text-base font-semibold">Waiting for your OK</h2>
      {/* NextStep: what the seller does now. */}
      <p className="mt-1 text-ds-13 text-muted-foreground" data-next-step="">
        {manager} wrote {rows.length === 1 ? "this listing" : `these ${rows.length} listings`} for you. Next: {ticked ? "" : "tick the statements below, then "}approve to put {rows.length === 1 ? "it" : "each"} on sale, or send it back with a note.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {rows.map((r) => (
          <li key={r.item_id} className="py-3" data-waiting-draft={r.item_id}>
            {/* Green primary on the right (lead 11-01): at 375 the buttons wrap under the title, right-aligned. */}
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              <div className="min-w-[12rem] flex-1">
                <p className="truncate text-ds-15 font-medium">{r.title}</p>
                <p className="text-ds-13 text-muted-foreground">{r.price_cents === 0 ? "Free" : formatPrice(r.price_cents)}</p>
              </div>
              <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => { setNoteFor(noteFor === r.item_id ? null : r.item_id); setNote(""); }}>
                Send back
              </Button>
              <Button className="rounded-full" disabled={busy || !ticked} onClick={() => approve.mutate(r.item_id)}>
                Approve
              </Button>
            </div>
            {noteFor === r.item_id && (
              <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) sendBack.mutate({ id: r.item_id, note: note.trim() }); }}>
                <label htmlFor={`send-back-${r.item_id}`} className="block text-ds-13 font-medium">Note for {manager}</label>
                <textarea id={`send-back-${r.item_id}`} className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-ds-14"
                  maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change" />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setNoteFor(null)}>Cancel</Button>
                  <Button type="submit" className="rounded-full" disabled={busy || !note.trim()}>Send</Button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-2xl bg-muted/50 p-3">
        <TaxStatementsCheck id="manager-waiting-tax" checked={ticked} onChange={setTicked} />
      </div>
    </section>
  );
}
