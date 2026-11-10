/**
 * Admin > Shops: the paperwork part of the one Shops queue (docs/NOT-LAUNCHED.md Q1952; spec L47, L52, L56, L73;
 * migration 20261110195956).
 *
 *   Permits to check      food permits and inflatable registrations a shop sent. View the document, then Approve
 *                         (the shop shows "Permit on file" until the expiry date) or Turn down with a reason the
 *                         shop reads (shops_admin_review_permit).
 *   Registrations         Secretary of State numbers waiting for a check. Look the number up on the Louisiana
 *                         Secretary of State business search, then mark it found ("Registered business") or not
 *                         found (shops_admin_check_registration). The number is read through the admin-only
 *                         shops_admin_paperwork, never a column grant.
 *
 * Test rows (a seed shop or a test account's shop) are left out (owner 2026-10-27).
 * A brand-new RPC the database has not deployed yet (PGRST202) shows as "not on the server yet", never as an empty list.
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { shopsErrorMessage } from "@/lib/shops/errors";
import {
  checkRegistration,
  fetchPaperwork,
  PERMIT_KIND_LABEL,
  permitDocumentUrl,
  reviewPermit,
  type Paperwork,
  type PendingPermit,
} from "@/lib/shops/permits";
import { AdminCard } from "./AdminViewShell";
import { withoutTestRows } from "./seedRows";

const KEY = ["admin-shops-paperwork"] as const;
const SOS_SEARCH_URL = "https://coraweb.sos.la.gov/commercialsearch/commercialsearch.aspx";

async function load(): Promise<Paperwork & { notDeployed?: boolean }> {
  try {
    const p = await fetchPaperwork();
    return { permits: withoutTestRows(p.permits), registrations: withoutTestRows(p.registrations) };
  } catch (err) {
    if (isMissingRpcNamed(err as { message?: string }, "shops_admin_paperwork")) return { permits: [], registrations: [], notDeployed: true };
    throw err;
  }
}

function dateLabel(isoDate: string): string {
  // A date column ("2027-05-29"): read it as a calendar day, never through UTC midnight.
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ShopsPaperworkCard() {
  const qc = useQueryClient();
  const noteId = useId();
  const q = useQuery({ queryKey: KEY, queryFn: load });
  const [turningDown, setTurningDown] = useState<PendingPermit | null>(null);
  const [note, setNote] = useState("");

  const done = () => void qc.invalidateQueries({ queryKey: KEY });
  const decide = useMutation({
    mutationFn: ({ id, approve, why }: { id: string; approve: boolean; why: string }) => reviewPermit(id, approve, why),
    onSuccess: (status) => {
      toast.success(status === "verified" ? "Permit checked. The shop shows Permit on file." : "Permit turned down. The shop was told why.");
      setTurningDown(null);
      setNote("");
      done();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const registration = useMutation({
    mutationFn: ({ shopId, found }: { shopId: string; found: boolean }) => checkRegistration(shopId, found),
    onSuccess: (found) => {
      toast.success(found ? "Marked as a registered business." : "Marked as not found.");
      done();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const view = async (path: string) => {
    try {
      window.open(await permitDocumentUrl(path), "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(`We couldn't open the document. ${shopsErrorMessage(err)}`);
    }
  };

  let body: JSX.Element;
  if (q.isLoading) {
    body = <div className="space-y-2" role="status" aria-label="Loading Shops paperwork"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  } else if (q.isError) {
    body = <ErrorState variant="inline" title="We couldn't load the Shops paperwork." body={shopsErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  } else if (q.data?.notDeployed) {
    body = <p className="text-sm text-muted-foreground">This isn't on the server yet (it is still deploying). Try again in a few minutes.</p>;
  } else {
    const { permits, registrations } = q.data ?? { permits: [], registrations: [] };
    body = (
      <div className="space-y-5">
        <section aria-labelledby="shops-permits-h" className="space-y-2">
          <h3 id="shops-permits-h" className="text-sm font-semibold">Permits to check</h3>
          {permits.length === 0 ? <p className="text-sm text-muted-foreground">No permits waiting.</p> : (
            <ul className="space-y-3">
              {permits.map((p) => (
                <li key={p.permit_id} className="space-y-2 text-sm" data-testid="admin-shops-permit">
                  <p className="[overflow-wrap:anywhere]">
                    <span className="font-semibold">{p.shop_name}</span> · {PERMIT_KIND_LABEL[p.kind]} · expires {dateLabel(p.expires_on)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void view(p.document_path)}>View document</Button>
                    <Button type="button" size="sm" className="btn-grad-primary" disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: p.permit_id, approve: true, why: "" })}>Approve</Button>
                    <Button type="button" size="sm" variant="outline" disabled={decide.isPending}
                      onClick={() => { setNote(""); setTurningDown(p); }}>Turn down</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="shops-sos-h" className="space-y-2">
          <h3 id="shops-sos-h" className="text-sm font-semibold">Secretary of State numbers to check</h3>
          {registrations.length === 0 ? <p className="text-sm text-muted-foreground">No numbers waiting.</p> : (
            <>
              <p className="text-xs text-muted-foreground">
                Look each number up on the <a className="underline" href={SOS_SEARCH_URL} target="_blank" rel="noopener noreferrer">Louisiana Secretary of State business search</a>.
              </p>
              <ul className="space-y-3">
                {registrations.map((r) => (
                  <li key={r.shop_id} className="space-y-2 text-sm" data-testid="admin-shops-registration">
                    <p className="[overflow-wrap:anywhere]"><span className="font-semibold">{r.shop_name}</span> · {r.area_label} · number <span className="font-mono">{r.sos_number}</span></p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" className="btn-grad-primary" disabled={registration.isPending}
                        onClick={() => registration.mutate({ shopId: r.shop_id, found: true })}>Registered</Button>
                      <Button type="button" size="sm" variant="outline" disabled={registration.isPending}
                        onClick={() => registration.mutate({ shopId: r.shop_id, found: false })}>Not found</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <AdminCard title="Shop paperwork" subtitle={'Permits and Secretary of State numbers. A checked permit shows "Permit on file" until it expires.'}>
      {body}
      <BrandConfirmDialog
        open={!!turningDown}
        onOpenChange={(o) => { if (!o && !decide.isPending) setTurningDown(null); }}
        title="Turn down this permit?"
        description="The shop reads your reason and can send a new copy."
        primaryLabel={decide.isPending ? "Saving…" : "Turn down"}
        primaryDisabled={decide.isPending || note.trim().length < 3 || note.length > 500}
        onPrimary={(e) => {
          e.preventDefault();
          if (turningDown) decide.mutate({ id: turningDown.permit_id, approve: false, why: note.trim() });
        }}
        secondaryLabel="Cancel"
      >
        <div className="space-y-1">
          <Label htmlFor={noteId}>Reason (the shop sees it)</Label>
          <Textarea id={noteId} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
      </BrandConfirmDialog>
    </AdminCard>
  );
}
