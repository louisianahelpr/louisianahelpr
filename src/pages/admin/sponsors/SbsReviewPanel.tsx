/**
 * The Small Business Saturday "Featured local" review card (owner 2026-11-20: "we review and then it gets added").
 * Top of /admin/sponsors. Each request waits here, pending, until an admin taps Approve (it shows on
 * /gift-guides/small-business-saturday under the 25 Days sponsors) or Reject. The contact email shows only here.
 * Server: sbs_admin_list / sbs_admin_review (each checks the admin role; review writes admin_audit_log). Test
 * addresses' requests are left out by the server. Guard: src/test/sbsFeaturedLocal1120.test.tsx.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { errorToast } from "@/lib/toast";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";
import { openableDocumentUrl } from "@/lib/storagePath";

export interface SbsAdminRow {
  id: string;
  created_at: string;
  business_name: string;
  town: string;
  category: string;
  link: string;
  deal: string | null;
  has_logo: boolean;
  contact_email: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
}

type LooseRpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const sb = supabase as unknown as LooseRpc;

function read<T>(res: { data: unknown; error: unknown }, words: string | null): T {
  if (res.error && words) throw new Error(words);
  return unwrap(res as Parameters<typeof unwrap>[0]) as T;
}

async function listRows(): Promise<SbsAdminRow[]> {
  const res = await sb.rpc("sbs_admin_list");
  const rows = read<unknown>(res, rpcErrorMessage("sbs_admin_list", res.error));
  return Array.isArray(rows) ? (rows as SbsAdminRow[]) : [];
}

async function review(id: string, status: SbsAdminRow["status"]): Promise<void> {
  const res = await sb.rpc("sbs_admin_review", { p_id: id, p_status: status });
  read(res, rpcErrorMessage("sbs_admin_review", res.error));
}

/** The logo's bytes as an object URL, shown on the card itself (the bucket is private; the function checks the admin role). */
async function logoObjectUrl(id: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "");
  const base = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/sbs-featured`;
  const res = await fetch(`${base}?logo=${encodeURIComponent(id)}&admin=1`, { headers: { apikey: key, Authorization: `Bearer ${data.session?.access_token ?? key}` } });
  if (!res.ok) throw new Error(`The logo could not be loaded (${res.status}).`);
  return URL.createObjectURL(await res.blob());
}

function LogoPreview({ id, name }: { id: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    logoObjectUrl(id).then(
      (u) => {
        url = u;
        if (live) setSrc(u);
        else URL.revokeObjectURL(u);
      },
      (e) => {
        report(e, { tags: { area: "sbs_featured", action: "logo_preview" } });
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  if (failed) return <span className="text-xs text-muted-foreground">Logo didn't load</span>;
  return src ? (
    <img src={src} alt={`${name} logo`} width={56} height={56} className="h-14 w-14 rounded-lg border border-border bg-white object-contain" />
  ) : (
    <span className="inline-block h-14 w-14 rounded-lg bg-muted/40" aria-hidden="true" />
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const KEY = ["sbs-featured", "admin"];

export function SbsReviewPanel() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const q = useQuery({ queryKey: KEY, queryFn: listRows, meta: { persist: false } });
  const act = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SbsAdminRow["status"] }) => review(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: unknown) => errorToast("That change was not saved", { description: userFacingError(e, "Try again in a moment.") }),
  });
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const reviewed = rows.filter((r) => r.status !== "pending");
  const list = showDone ? rows : pending;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-admin-sbs-review="">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Small Business Saturday requests{pending.length ? ` (${pending.length} waiting)` : ""}</h2>
        {reviewed.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)}>{showDone ? "Show waiting only" : `Show reviewed (${reviewed.length})`}</Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Free "Featured local" listings. Approve and it shows on the Small Business Saturday page under the 25 Days sponsors. The email is private.
      </p>
      {q.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : q.isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{userFacingError(q.error, "The requests didn't load.")}</span>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Try again</Button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-background p-3 text-sm" data-admin-sbs-row={r.status}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-semibold [overflow-wrap:anywhere]">{r.business_name}</span>
                <span className="text-xs text-muted-foreground">{fmt(r.created_at)}{r.status !== "pending" ? ` · ${r.status === "approved" ? "Approved" : "Rejected"}` : ""}</span>
              </div>
              <div className="text-xs text-muted-foreground">{r.town} · {r.category}</div>
              {r.deal && <div className="mt-1 [overflow-wrap:anywhere]">Deal: {r.deal}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {openableDocumentUrl(r.link) && <a href={openableDocumentUrl(r.link) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center font-semibold text-primary underline [overflow-wrap:anywhere]">{r.link}</a>}
                <a href={`mailto:${r.contact_email}`} className="inline-flex min-h-11 items-center [overflow-wrap:anywhere]">{r.contact_email}</a>
                {r.has_logo && <LogoPreview id={r.id} name={r.business_name} />}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.status !== "approved" && (
                  <Button size="sm" className="btn-grad-primary" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, status: "approved" })}>Approve</Button>
                )}
                {r.status !== "rejected" && (
                  <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, status: "rejected" })}>Reject</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
