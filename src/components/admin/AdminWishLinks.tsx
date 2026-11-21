/**
 * Admin -> Wish list links (owner 2026-11-21: "people can put in the wish list or family can send each other wish
 * lists, we see the list, create the links if we don't have it, and send - they buy with our link").
 * Every gift someone added from any store (a pasted shop link we do not carry, or typed words with no guide pick) waits
 * here, grouped by the list it came from, in the person's own words. Paste our affiliate link and Save: from then on
 * every list showing that gift (the shopper's planner and every list they share) uses it, and the same page on any
 * other waiting list gets it too. Not ours to make: Dismiss.
 * Server: admin_wish_link_requests / admin_wish_link_request_fill / admin_wish_link_request_dismiss (each checks the
 * admin role; fill and dismiss write admin_audit_log; test rows are left out). Migration 20261121221514.
 * Guard: src/test/wishLinkQueue1121.test.tsx.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { errorToast } from "@/lib/toast";
import { userFacingError } from "@/lib/userFacingError";
import { openableDocumentUrl } from "@/lib/storagePath";
import { AdminCard, AdminViewShell } from "./AdminViewShell";

export interface WishLinkRow {
  id: string;
  kind: "link" | "idea";
  words: string;
  url: string | null;
  list_key: string;
  list_name: string;
  status: "open" | "filled" | "dismissed";
  affiliate_url: string | null;
  created_at: string;
}

type LooseRpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const sb = supabase as unknown as LooseRpc;

function read<T>(res: { data: unknown; error: unknown }, words: string | null): T {
  if (res.error && words) throw new Error(words);
  return unwrap(res as Parameters<typeof unwrap>[0]) as T;
}

async function listRows(): Promise<WishLinkRow[]> {
  const res = await sb.rpc("admin_wish_link_requests");
  const rows = read<unknown>(res, rpcErrorMessage("admin_wish_link_requests", res.error));
  return Array.isArray(rows) ? (rows as WishLinkRow[]) : [];
}

async function fill(id: string, url: string): Promise<number> {
  const res = await sb.rpc("admin_wish_link_request_fill", { p_id: id, p_url: url });
  const out = read<{ also_filled?: unknown } | null>(res, rpcErrorMessage("admin_wish_link_request_fill", res.error));
  return typeof out?.also_filled === "number" ? out.also_filled : 0;
}

async function dismiss(id: string): Promise<void> {
  const res = await sb.rpc("admin_wish_link_request_dismiss", { p_id: id });
  read(res, rpcErrorMessage("admin_wish_link_request_dismiss", res.error));
}

/** Rows grouped by the list they came from, the lists with waiting gifts first, in the server's order. */
export function groupByList(rows: WishLinkRow[]): { key: string; name: string; rows: WishLinkRow[] }[] {
  const groups = new Map<string, { key: string; name: string; rows: WishLinkRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.list_key) ?? { key: r.list_key, name: r.list_name, rows: [] };
    g.rows.push(r);
    groups.set(r.list_key, g);
  }
  return [...groups.values()].sort((a, b) => Number(b.rows.some((r) => r.status === "open")) - Number(a.rows.some((r) => r.status === "open")));
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const KEY = ["wish-link-requests", "admin"];
const STATUS = { open: "Waiting", filled: "Our link", dismissed: "Dismissed" } as const;

function Row({ r, busy, onFill, onDismiss }: { r: WishLinkRow; busy: boolean; onFill: (url: string) => void; onDismiss: () => void }) {
  const [url, setUrl] = useState(r.affiliate_url ?? "");
  const ok = /^https:\/\/\S+\.\S+/.test(url.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) onFill(url.trim());
  };
  const pasted = r.url ? openableDocumentUrl(r.url) : null;
  return (
    <li className="rounded-xl border border-border bg-background p-3 text-sm" data-admin-wish-link={r.status}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-semibold [overflow-wrap:anywhere]">{r.words}</span>
        <span className="text-xs text-muted-foreground">{r.kind === "link" ? "Pasted link" : "Typed idea"} · {fmt(r.created_at)} · {STATUS[r.status]}</span>
      </div>
      {pasted && (
        <a href={pasted} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary underline [overflow-wrap:anywhere]">{r.url}</a>
      )}
      <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={submit}>
        <Input className="min-w-0 flex-[1_1_220px]" aria-label={`Our link for ${r.words}`} placeholder="Paste our affiliate link (https://…)" value={url} maxLength={500}
          onChange={(e) => setUrl(e.target.value)} data-admin-wish-link-url={r.id} />
        <Button type="submit" size="sm" className="btn-grad-primary" disabled={busy || !ok || url.trim() === r.affiliate_url} data-admin-wish-link-save={r.id}>
          {r.status === "filled" ? "Change" : "Save"}
        </Button>
        {r.status !== "dismissed" && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onDismiss} data-admin-wish-link-dismiss={r.id}>Dismiss</Button>
        )}
      </form>
    </li>
  );
}

export default function AdminWishLinks() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  // What the last Save did, said under the heading (success toasts are quiet app-wide; this one matters).
  const [saved, setSaved] = useState<string | null>(null);
  const q = useQuery({ queryKey: KEY, queryFn: listRows, meta: { persist: false } });
  const onError = (e: unknown) => errorToast("That change was not saved", { description: userFacingError(e, "Try again in a moment.") });
  const doFill = useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) => fill(id, url),
    onSuccess: (also) => {
      setSaved(also > 0 ? `Saved. ${also} more ${also === 1 ? "list" : "lists"} with the same gift got it too.` : "Saved. Lists with this gift switch to our link the next time they open.");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError,
  });
  const doDismiss = useMutation({
    mutationFn: (id: string) => dismiss(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError,
  });
  const rows = q.data ?? [];
  const waiting = rows.filter((r) => r.status === "open");
  const groups = groupByList(showDone ? rows : waiting);
  const busy = doFill.isPending || doDismiss.isPending;
  return (
    <AdminViewShell>
      <AdminCard
        title={`Wish list links${waiting.length ? ` (${waiting.length} waiting)` : ""}`}
        subtitle="Gifts people added from any store, in their own words. Paste our affiliate link and every list with that gift uses it."
        action={rows.length > waiting.length ? (
          <Button size="sm" variant="ghost" onClick={() => setShowDone((v) => !v)} data-admin-wish-links-done="">
            {showDone ? "Show waiting only" : `Show done (${rows.length - waiting.length})`}
          </Button>
        ) : undefined}
      >
        <div data-admin-wish-links="">
          {saved && <p className="mb-3 text-sm" role="status" data-admin-wish-links-saved="">{saved}</p>}
          {q.isPending ? (
            <p className="text-sm text-muted-foreground" role="status">Loading…</p>
          ) : q.isError ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{userFacingError(q.error, "The wish list links didn't load.")}</span>
              <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Try again</Button>
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting for a link.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <section key={g.key} aria-label={`${g.name}'s list`} data-admin-wish-list={g.key}>
                  <h3 className="mb-2 text-sm font-semibold">{g.name}'s list <span className="font-normal text-muted-foreground">· {g.rows.length} {g.rows.length === 1 ? "gift" : "gifts"}</span></h3>
                  <ul className="flex flex-col gap-2">
                    {g.rows.map((r) => (
                      <Row key={r.id} r={r} busy={busy} onFill={(url) => doFill.mutate({ id: r.id, url })} onDismiss={() => doDismiss.mutate(r.id)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </AdminCard>
    </AdminViewShell>
  );
}
