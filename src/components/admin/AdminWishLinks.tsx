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
 *
 * "Get shop details" (gift lists lane, 2026-11-21): the edge function wish-link-pages (admin only) reads up to 8 waiting
 * pasted links' pages on a fixed list of shops (never Amazon, never a short or affiliate link) and each row then shows
 * the page's photo, title and price, with the day it was read; a page we could not read says so. Migration
 * 20261122034304. Guard: src/test/wishLinkPagesAdmin1121.test.tsx.
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
  /** What the pasted link's page said (wish-link-pages), once read. */
  page_title?: string | null;
  page_image?: string | null;
  page_price?: number | string | null;
  page_status?: "ok" | "none" | "skipped" | "blocked" | "failed" | null;
  page_checked_at?: string | null;
}

/** What one "Get shop details" run did (counts only: nothing about a page that failed). */
interface PagesRun { checked: number; ok: number; none: number; skipped: number; blocked: number; failed: number; unsaved: number; more: boolean }

/** Read up to 8 waiting pages (admin only, server side). Throws with words an admin can act on. */
async function readPages(): Promise<PagesRun> {
  const { data, error } = await supabase.functions.invoke("wish-link-pages", { body: {} });
  if (error) {
    // The function's own words when it sent some (403, 503); a missing function or an expired sign-in says so
    // (lh-silent-failure review: every failure read "try again"); no answer at all is a connection problem.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.status === "number") {
      if (ctx.status === 404) throw new Error("Shop details aren't set up yet (the wish-link-pages function isn't deployed).");
      if (ctx.status === 401) throw new Error("Your sign-in expired. Sign in again and retry.");
      if (ctx.status === 403) throw new Error("Only admins can read shop pages.");
      const body = typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
      throw new Error(typeof body?.error === "string" ? body.error : `Couldn't read the shop pages (error ${ctx.status}). Try again in a moment.`);
    }
    throw new Error("Couldn't reach the server to read the shop pages. Check your connection and try again.");
  }
  const d = data as Partial<PagesRun> | null;
  if (!d || typeof d.checked !== "number") throw new Error("Couldn't read the shop pages. Try again in a moment.");
  return { checked: d.checked, ok: d.ok ?? 0, none: d.none ?? 0, skipped: d.skipped ?? 0, blocked: d.blocked ?? 0, failed: d.failed ?? 0, unsaved: d.unsaved ?? 0, more: d.more === true };
}

/** "Checked 5 links: 3 with details, 2 couldn't be read." (counts only; nothing saved is never a "Checked"). */
export function pagesRunLine(r: PagesRun): string {
  if (r.checked === 0 && r.unsaved === 0) return "No new shop pages to read.";
  if (r.checked === 0) return `None of the ${r.unsaved} ${r.unsaved === 1 ? "link" : "links"} could be saved. Try again in a moment.`;
  const parts = [`${r.ok} with details`];
  if (r.none) parts.push(`${r.none} with nothing to show`);
  if (r.skipped) parts.push(`${r.skipped} not on our shop list`);
  if (r.blocked + r.failed) parts.push(`${r.blocked + r.failed} couldn't be read`);
  if (r.unsaved) parts.push(`${r.unsaved} not saved`);
  return `Checked ${r.checked} ${r.checked === 1 ? "link" : "links"}: ${parts.join(", ")}.${r.more && !r.unsaved ? " More are waiting: tap again." : ""}`;
}

/** An Amazon link is never read (the Associates agreement): it never counts as waiting for shop details. */
const isAmazonLink = (url: string | null) => {
  try {
    return url ? /(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co)$/i.test(new URL(url).hostname) : false;
  } catch {
    // An unreadable link is never read either.
    return true;
  }
};

const PAGE_NOTE = { skipped: "Not a shop we read", blocked: "Shop page couldn't be read", failed: "Shop page couldn't be read", none: "The shop page showed no details" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

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
      <PageLine r={r} />
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

/** What the pasted link's page said: its photo, title and price, read on <day>; or why there is nothing. */
function PageLine({ r }: { r: WishLinkRow }) {
  if (!r.page_status || !r.page_checked_at) return null;
  const price = r.page_price === null || r.page_price === undefined ? null : Number(r.page_price);
  if (r.page_status !== "ok") {
    return <p className="m-0 text-xs text-muted-foreground" data-admin-wish-link-page-note={r.id}>{PAGE_NOTE[r.page_status]} · {day(r.page_checked_at)}</p>;
  }
  return (
    <div className="mt-1 flex items-center gap-3" data-admin-wish-link-page={r.id}>
      {r.page_image && (
        <img loading="lazy" src={r.page_image} alt="" width={48} height={48} referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-md object-contain" data-admin-wish-link-page-img="" />
      )}
      <span className="min-w-0 text-xs">
        {r.page_title && <span className="block font-medium [overflow-wrap:anywhere]" data-admin-wish-link-page-title="">{r.page_title}</span>}
        <span className="text-muted-foreground">
          {price !== null && Number.isFinite(price) ? <span data-admin-wish-link-page-price="">${price.toFixed(2)} on the page · </span> : null}
          read {day(r.page_checked_at)}
        </span>
      </span>
    </div>
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
  const [pagesLine, setPagesLine] = useState<string | null>(null);
  const doPages = useMutation({
    mutationFn: readPages,
    onSuccess: (run) => {
      setPagesLine(pagesRunLine(run));
      // Some pages read but not saved: an error, not just a line (lh-silent-failure review).
      if (run.unsaved > 0) errorToast("Some shop details were not saved", { description: `${run.unsaved} ${run.unsaved === 1 ? "link" : "links"} will be tried again next time.` });
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: unknown) => {
      errorToast("Shop details were not read", { description: userFacingError(e, "Try again in a moment.") });
      // A run cut short may still have saved some rows: reload so the list is true.
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const rows = q.data ?? [];
  const waiting = rows.filter((r) => r.status === "open");
  const groups = groupByList(showDone ? rows : waiting);
  const busy = doFill.isPending || doDismiss.isPending;
  const unread = waiting.filter((r) => r.kind === "link" && !r.page_checked_at && !isAmazonLink(r.url)).length;
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
          {(unread > 0 || pagesLine) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              {unread > 0 && (
                <Button size="sm" variant="outline" disabled={doPages.isPending} onClick={() => doPages.mutate()} data-admin-wish-links-pages="">
                  {doPages.isPending ? "Reading shop pages…" : `Get shop details (${unread})`}
                </Button>
              )}
              {pagesLine && <span role="status" data-admin-wish-links-pages-line="">{pagesLine}</span>}
            </div>
          )}
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
