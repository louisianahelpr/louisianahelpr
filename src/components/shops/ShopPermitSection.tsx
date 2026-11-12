/**
 * "Permit on file" for the shop owner (docs/NOT-LAUNCHED.md Q1952; spec L47, L52; migration 20261110195956).
 * Optional. A shop that sells home food under a permit, or rents out inflatables (bounce houses), sends a copy and
 * its expiry date; once an admin checks it, the shop page shows "Permit on file" until that date. A turned-down copy
 * shows the admin's reason and can be sent again. Saves on its own, outside the shop form (like the pickup address).
 */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { fetchMyPermits, PERMIT_DOC_EXT_BY_TYPE, PERMIT_KIND_LABEL, submitPermit, type MyPermit, type PermitKind } from "@/lib/shops/permits";

const KEY = ["shops", "my-permits"] as const;

function dateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function statusLine(p: MyPermit): string {
  if (p.status === "verified") return p.expired ? `Expired ${dateLabel(p.expires_on)}. Send the new one to keep the badge.` : `Checked. Your shop shows "Permit on file" until ${dateLabel(p.expires_on)}.`;
  if (p.status === "rejected") return `We couldn't check it: ${p.review_note ?? "no reason given"} Send a new copy below.`;
  return "Sent. We check it within a few days.";
}

export default function ShopPermitSection({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const ids = { kind: useId(), file: useId(), date: useId() };
  const current = useQuery({ queryKey: KEY, queryFn: fetchMyPermits });
  const [kind, setKind] = useState<PermitKind>("food_permit");
  const [file, setFile] = useState<File | null>(null);
  const [expires, setExpires] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => submitPermit(userId, kind, file as File, expires),
    onSuccess: () => {
      toast("Permit sent. We'll check it soon.");
      setFile(null);
      setExpires("");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => setProblem(shopsErrorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setProblem("Choose a photo or PDF of the permit.");
    if (!PERMIT_DOC_EXT_BY_TYPE[file.type]) return setProblem("Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return setProblem("Enter the date the permit expires.");
    setProblem(null);
    send.mutate();
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="shop-permit-heading" data-testid="shop-permit">
      <div className="space-y-1">
        <h2 id="shop-permit-heading" className="text-base font-semibold">Permit on file (optional)</h2>
        <p className="text-ds-13 text-muted-foreground">
          Have a food permit or an inflatable (bounce house) registration? Send a copy. Once we check it, your shop shows "Permit on file" until it expires. Only our team sees the copy.
        </p>
      </div>
      {current.isError ? (
        <ErrorState variant="inline" title="We couldn't load your permits." body={shopsErrorMessage(current.error)} onRetry={() => void current.refetch()} />
      ) : current.isLoading ? (
        <div role="status" aria-label="Loading your permits"><Skeleton className="h-10 w-full rounded-xl" /></div>
      ) : (
        <>
          {(current.data ?? []).length > 0 && (
            <ul className="space-y-2">
              {(current.data ?? []).map((p) => (
                <li key={p.kind} className="text-ds-13" data-testid="shop-permit-row">
                  <span className="font-medium">{PERMIT_KIND_LABEL[p.kind]}:</span> {statusLine(p)}
                </li>
              ))}
            </ul>
          )}
          <form className="space-y-3" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor={ids.kind}>Type</Label>
              <select id={ids.kind} className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-ds-13" value={kind}
                onChange={(e) => setKind(e.target.value as PermitKind)}>
                {(Object.keys(PERMIT_KIND_LABEL) as PermitKind[]).map((k) => <option key={k} value={k}>{PERMIT_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.file}>Photo or PDF of the permit</Label>
              <Input id={ids.file} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.date}>Expires on</Label>
              <Input id={ids.date} type="date" className="min-w-0" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
            {problem && <p className="text-ds-13 text-destructive-ink" role="alert">{problem}</p>}
            <Button type="submit" className="w-full" variant="outline" disabled={send.isPending}>
              {send.isPending ? "Sending…" : "Send for a check"}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
