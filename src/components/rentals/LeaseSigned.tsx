/**
 * Signed leases: reading one, its PDF, and the past leases a tenancy no longer shows (moved out of
 * LeasePanel.tsx as is, to keep that file under the component size limit; LeasePanel re-exports
 * SignedLeases and downloadLease).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { dayLabel } from "@/lib/rentals/rent";
import { report } from "@/lib/errorLogger";
import { shareFileNative } from "@/lib/nativeShare";
import type { LeaseSection } from "@/lib/rentals/leaseTemplate";
import { fetchMyLeases, verifiedLeaseSections, type SignedLease } from "@/lib/rentals/lease";
import { buildLeasePdf, leaseSignedAtLabel } from "@/lib/rentals/leasePdf";
import { RENTALS_ITEM_CARD, RentalsCard } from "./rentalsUi";

export const MY_LEASES_KEY = ["rent-my-leases"];

export function dayOf(iso: string | null): string {
  return iso ? dayLabel(iso.slice(0, 10)) : "";
}

export function LeaseText({ sections }: { sections: LeaseSection[] }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed" data-testid="lease-text">
      {sections.map((s) => (
        <section key={s.heading} className="space-y-1.5">
          <h3 className="font-semibold">{s.heading}</h3>
          {s.paragraphs.map((p, i) => (
            <p key={i} className={p.startsWith("- ") || /^\([a-j]\) /.test(p) ? "pl-3" : ""}>
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Lead review #5: the PDF prints only after its fingerprint is re-checked against the stored blanks. */
export async function downloadLease(l: SignedLease, homeLabel: string): Promise<void> {
  const v = await verifiedLeaseSections(l);
  if (!v.ok) {
    if (v.reason === "unknown_version") {
      toast.error("This lease needs the newest app. Update the app and try again.");
      return;
    }
    report(new Error("lease fingerprint mismatch"), { severity: "error", tags: { source: "rentalsLease.pdfHash" }, context: { lease_id: l.id } });
    toast.error("This lease's record doesn't match its words, so no PDF was made. Contact support.");
    return;
  }
  try {
    const file = await buildLeasePdf({
      sections: v.sections,
      bodySha256: l.body_sha256,
      landlordSignedName: l.landlord_signed_name,
      landlordSignedAt: l.landlord_signed_at,
      tenantSignedName: l.tenant_signed_name,
      tenantSignedAt: l.tenant_signed_at,
      homeLabel,
    });
    const outcome = await shareFileNative({ ...file, title: "Lease", dialogTitle: "Save the lease", source: "rentalsLease", suppressDownloadConfirmation: true });
    if (outcome === "downloaded") toast("Lease downloaded", { description: file.fileName });
  } catch (err) {
    report(err, { severity: "error", tags: { source: "rentalsLease.pdf" } });
    toast.error("Couldn't make the PDF. Try again.");
  }
}

export function SignedRow({ l, homeLabel, onRead, label }: { l: SignedLease; homeLabel: string; onRead: () => void; label?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs" data-testid="lease-signed">
      <span className="min-w-0 text-muted-foreground">{label ?? `Signed by both on ${dayOf(l.tenant_signed_at)}`}</span>
      <span className="flex shrink-0 gap-1">
        <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={onRead}>
          Read
        </Button>
        <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => void downloadLease(l, homeLabel)}>
          PDF
        </Button>
      </span>
    </div>
  );
}

export function ReadSigned({ l, homeLabel }: { l: SignedLease; homeLabel: string }) {
  // Round 2 #9 / round 3 L5: the same check as the PDF; a record whose words don't match says so and is reported.
  const v = useQuery({ queryKey: ["rent-lease-verified", l.id, l.body_sha256], queryFn: () => verifiedLeaseSections(l) });
  const mismatch = v.data !== undefined && !v.data.ok && v.data.reason === "mismatch";
  useEffect(() => {
    if (mismatch) report(new Error("lease fingerprint mismatch"), { severity: "error", tags: { source: "rentalsLease.readHash" }, context: { lease_id: l.id } });
  }, [mismatch, l.id]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Signed by {l.landlord_signed_name} ({leaseSignedAtLabel(l.landlord_signed_at)}) and {l.tenant_signed_name} ({leaseSignedAtLabel(l.tenant_signed_at)}).
      </p>
      {v.isPending && <div className="h-40 animate-pulse rounded-lg bg-muted" role="status" aria-label="Loading the lease" />}
      {v.isError && <p className="text-sm">Couldn't open the lease. Close and try again.</p>}
      {v.data && !v.data.ok && (
        <p role="alert" className="rounded-lg bg-muted p-2 text-xs" data-testid="lease-verify-warning">
          {v.data.reason === "unknown_version"
            ? "This lease needs the newest app. Update the app to read it."
            : "This lease's record doesn't match its words. Contact support before relying on it."}
        </p>
      )}
      {v.data?.ok && (
        <>
          <div className="max-h-[60dvh] overflow-y-auto rounded-lg border border-border p-3">
            <LeaseText sections={v.data.sections} />
          </div>
          <SheetFooter>
            <SheetPrimaryAction type="button" onClick={() => void downloadLease(l, homeLabel)}>
              Download PDF
            </SheetPrimaryAction>
          </SheetFooter>
        </>
      )}
    </div>
  );
}

/**
 * Signed leases whose tenancy is no longer on the Homes screen (ended long ago, or deleted with the
 * property or the other person's account): both people keep them (lead review #2).
 */
export function SignedLeases({ shownTenancyIds, side }: { shownTenancyIds: ReadonlySet<string>; side: "landlord" | "tenant" }) {
  const q = useQuery({ queryKey: MY_LEASES_KEY, queryFn: fetchMyLeases });
  const [reading, setReading] = useState<SignedLease | null>(null);
  const rows = (q.data ?? []).filter((l) => l.side === side && (!l.tenancy_id || !shownTenancyIds.has(l.tenancy_id)));
  if (rows.length === 0) return null;
  return (
    <RentalsCard title="Past leases" bare>
      <div className={`${RENTALS_ITEM_CARD} space-y-2`}>
      {rows.map((l) => (
        <SignedRow
          key={l.id}
          l={l}
          homeLabel={l.home_label ?? "home"}
          label={`${l.home_label ?? "A home"}: signed ${dayOf(l.tenant_signed_at)}`}
          onRead={() => setReading(l)}
        />
      ))}
      </div>
      <Sheet open={reading !== null} onOpenChange={(o) => !o && setReading(null)}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
          <SheetHero title="Signed lease" />
          {reading && <ReadSigned l={reading} homeLabel={reading.home_label ?? "home"} />}
        </SheetContent>
      </Sheet>
    </RentalsCard>
  );
}
