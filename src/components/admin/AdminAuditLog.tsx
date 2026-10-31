import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatName } from "@/lib/utils";
import { formatCategory } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import type { Json } from "@/integrations/supabase/types";
import { toneBadgeClasses, type Tone } from "@/components/admin/tones";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { saveOrShareFile } from "@/lib/fileExport";
import { fetchSeedUserIds } from "@/components/admin/seedRows";
import {
  AUDIT_ACTOR_LABEL, AUDIT_KIND_LABEL, auditMatches, auditSubjects, isNoOpAudit,
  type AuditActor, type AuditKind,
} from "@/components/admin/adminAuditLog/auditRows";

interface AuditEntry {
  id: string;
  // NULL for automated writes (pg_cron / service-role) since 20260825140000.
  admin_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Json | null;
  created_at: string;
  admin_name?: string;
  /** The admin was a party to this job, so their status change is their own hire, not an override (Admin M1). */
  own_job?: boolean;
}

const PAGE_SIZE = 200;

/** The ids in batches a URL can carry: one row's snapshot can name three people, and a page holds 200 rows. */
function batches(ids: string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * One page, newest first, older than `before`. What is left out of the list:
 * a row about test data (owner: "i should never see test stuff in my admin
 * panel") and an update that changed nothing. A failed read throws, like every
 * admin fetcher: a list that silently kept its test rows would read as real.
 * `more` comes from the rows READ, not the rows kept: a page can keep none.
 */
async function fetchAuditPage(before?: string): Promise<{ entries: AuditEntry[]; more: boolean; oldest: string | null }> {
  let query = supabase.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE);
  if (before) query = query.lt("created_at", before);
  const data = unwrap(await query);
  if (!data || data.length === 0) return { entries: [], more: false, oldest: null };

  const subjects = data.map(auditSubjects);
  const jobIds = [...new Set(subjects.flatMap((x) => x.jobs))];
  const itemIds = [...new Set(subjects.flatMap((x) => x.items))];
  const jobs = new Map<string, { is_seed: boolean | null; customer_id: string | null; helper_id: string | null }>();
  for (const ids of batches(jobIds)) {
    for (const j of unwrap(await supabase.from("jobs").select("id, is_seed, customer_id, helper_id").in("id", ids)) ?? []) jobs.set(j.id, j);
  }
  const seedItems = new Set<string>();
  for (const ids of batches(itemIds)) {
    for (const i of unwrap(await supabase.from("declutter_items").select("id").in("id", ids).eq("is_seed", true)) ?? []) seedItems.add(i.id);
  }
  const seedUsers = new Set<string>();
  for (const ids of batches([...new Set(subjects.flatMap((x) => x.users))])) {
    for (const id of await fetchSeedUserIds(ids)) seedUsers.add(id);
  }
  const kept = data.filter((e, i) => {
    const about = subjects[i];
    if (isNoOpAudit(e)) return false;
    return !(about.users.some((id) => seedUsers.has(id))
      || about.jobs.some((id) => jobs.get(id)?.is_seed === true)
      || about.items.some((id) => seedItems.has(id)));
  });

  // admin_id is NULL for automated writes (pg_cron / service-role edge
  // functions) — see 20260825140000. Those nulls must not reach `.in()`:
  // postgrest serializes them as the literal `null`, and
  // `user_id=in.(null,…)` is a uuid syntax error (22P02) that fails the
  // whole query, so one system row would blank the entire tab.
  const adminIds = [...new Set(kept.map((e) => e.admin_id))]
    .filter((id): id is string => !!id);
  const nameMap = new Map<string, string | null>();
  if (adminIds.length > 0) {
    const profiles = unwrap(await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", adminIds));
    for (const p of profiles ?? []) nameMap.set(p.user_id, p.full_name);
  }
  const entries = kept.map((e) => {
    const job = e.target_id ? jobs.get(e.target_id) : undefined;
    return {
      ...e,
      admin_name: formatName(e.admin_id ? nameMap.get(e.admin_id) : undefined, "System"),
      own_job: e.action === "job_status_override" && !!e.admin_id && !!job && (job.customer_id === e.admin_id || job.helper_id === e.admin_id),
    };
  });
  return { entries, more: data.length === PAGE_SIZE, oldest: data[data.length - 1].created_at };
}

const AdminAuditLog = () => {
  const { data: first, isInitialLoading, isError, refetch } = useInstantQuery<{ entries: AuditEntry[]; more: boolean; oldest: string | null }>({
    key: ["admin-audit-log"],
    fallback: { entries: [], more: false, oldest: null },
    fetcher: () => fetchAuditPage(),
  });
  // Older pages, added by Load more. Dropped when the first page changes under them, which would leave a gap.
  const [older, setOlder] = useState<{ after: string | null; entries: AuditEntry[]; more: boolean; oldest: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [kind, setKind] = useState<AuditKind>("all");
  const [actor, setActor] = useState<AuditActor>("anyone");
  const [search, setSearch] = useState("");
  const current = older && older.after === first.oldest ? older : null;
  const loaded = current ? [...first.entries, ...current.entries] : first.entries;
  const more = current ? current.more : first.more;
  const oldest = current ? current.oldest : first.oldest;

  const loadMore = async () => {
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const page = await fetchAuditPage(oldest);
      setOlder({ after: first.oldest, entries: [...(current?.entries ?? []), ...page.entries], more: page.more, oldest: page.oldest ?? oldest });
    } catch {
      toast.error("Couldn't load older entries. Try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * Export the loaded entries as CSV.
   *
   * This used to be `URL.createObjectURL` → `<a download>` → `.click()` →
   * `revokeObjectURL`, which is a NO-OP inside the shipped app: Capacitor
   * serves bundled `dist/` from WKWebView, which honours neither the `download`
   * attribute nor a `blob:` navigation. The button was completely dead for any
   * admin on a phone — it fired, produced no file, threw nothing and logged
   * nothing (owner, 2026-08-30: "Download csv pdf etc does not work").
   *
   * `saveOrShareFile` routes per platform (native: stage the file, open the OS
   * share sheet; web: the anchor download) and toasts on every failure. See
   * src/lib/fileExport.ts.
   *
   * `charset=utf-8` is not cosmetic — admin names and free-text `details`
   * reasons are not ASCII, and an unlabelled CSV opens as mojibake in Excel.
   */
  const exportCSV = () => {
    const header = "Timestamp,Admin,Action,Target Type,Target ID,Details\n";
    const rows = shown.map(e =>
      `"${e.created_at}","${e.admin_name}","${e.action}","${e.target_type || ""}","${e.target_id || ""}","${JSON.stringify(e.details || {}).replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    return saveOrShareFile({
      blob,
      filename: `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      label: "the audit log",
      source: "AdminAuditLog.exportCSV",
    });
  };

  const actionTone: Record<string, Tone> = {
    approve_user: "success",
    deny_user: "danger",
    ban_user: "danger",
    resolve_fraud_flag: "info",
    update_settings: "notice",
    resolve_dispute: "danger",
    job_status_override: "warning",
    job_admin_refund: "danger",
    job_admin_refund_partial: "warning",
  };

  // Pull the most useful fields from details for inline display so admins
  // see the "what happened" at a glance instead of just the action label.
  const summarizeDetails = (action: string, details: Json | null): string | null => {
    if (!details || typeof details !== "object" || Array.isArray(details)) return null;
    const d = details as Record<string, Json | undefined>;
    const get = (k: string) => d[k];
    if (action === "job_status_override") {
      const from = get("from_status");
      const to = get("to_status");
      const title = get("job_title");
      if (from && to) return `${from} → ${to}${title ? ` · "${title}"` : ""}`;
    }
    if (action === "job_admin_refund" || action === "job_admin_refund_partial") {
      const title = get("job_title");
      const budget = get("budget");
      const partial = get("partial_amount_dollars");
      const reason = get("reason");
      const parts: string[] = [];
      if (title) parts.push(`"${title}"`);
      if (partial) parts.push(`$${partial} of $${budget ?? "?"}`);
      else if (budget) parts.push(`$${budget}`);
      if (reason) parts.push(`reason: ${reason}`);
      return parts.join(" · ") || null;
    }
    if (action === "resolve_dispute" || action === "resolve_fraud_flag") {
      const outcome = get("outcome") || get("resolution");
      if (outcome) return String(outcome);
    }
    if (action === "ban_user" || action === "deny_user") {
      const reason = get("reason");
      if (reason) return `reason: ${reason}`;
    }
    // Trigger-audited rows (user_bans, payout_transfers, platform_settings,
    // user_roles …) carry `{op, old, new}` snapshots and no free-text field,
    // so the fallback below printed "op: UPDATE" and nothing else — the log
    // recorded a $22.00 transfer going pending → paid with its Stripe id and
    // showed an admin none of it (prod, 2026-09-07). Say what changed.
    if (typeof get("op") === "string" && (get("new") || get("old"))) {
      const asRow = (v: Json | undefined) =>
        v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json | undefined>) : null;
      const before = asRow(get("old"));
      const after = asRow(get("new"));
      const row = after ?? before;
      const parts: string[] = [];
      if (row) {
        // Subject first: whoever or whatever the row is about.
        const who = row.user_id ?? row.helper_id ?? row.customer_id;
        if (typeof who === "string") parts.push(`user ${who.slice(0, 8)}`);
        if (typeof row.key === "string") parts.push(String(row.key));
        if (typeof row.role === "string") parts.push(`role ${row.role}`);
        if (typeof row.amount_cents === "number") parts.push(`$${(row.amount_cents / 100).toFixed(2)}`);
        if (typeof row.reason === "string" && row.reason.length < 80) parts.push(row.reason);
      }
      if (before && after) {
        const SKIP = new Set(["updated_at", "paid_at", "metadata"]);
        const changed = Object.keys(after)
          .filter((k) => !SKIP.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
          .slice(0, 3)
          .map((k) => {
            const fmt = (v: Json | undefined) => (v == null ? "—" : typeof v === "object" ? "…" : String(v).slice(0, 24));
            return `${k}: ${fmt(before[k])} → ${fmt(after[k])}`;
          });
        if (changed.length) parts.push(changed.join(", "));
      }
      if (parts.length) return parts.join(" · ");
    }
    // Fallback: surface the first short string field for unknown actions.
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === "string" && v.length < 80 && k !== "id") return `${k}: ${v}`;
    }
    return null;
  };

  const shown = loaded.filter((e) => auditMatches(e, { kind, actor, search }, `${e.own_job ? "own job " : ""}${summarizeDetails(e.action, e.details) ?? ""}`));
  const filtering = kind !== "all" || actor !== "anyone" || search.trim() !== "";

  return (
    <AdminViewShell>
      {/* Export CSV lived on a bare right-aligned row above the list, with a
          phone-width gutter of nothing beside it. It belongs to the log, so
          it sits in the log's own header — which is also where the row count
          it exports can finally be stated. */}
      <AdminCard
        title="Recent Activity"
        subtitle={
          filtering
            ? `${shown.length} of the ${loaded.length} loaded, newest first. Load more to search further back.`
            : loaded.length > 0
            ? `Last ${loaded.length} admin ${loaded.length === 1 ? "action" : "actions"}, newest first.`
            : "Every admin action is recorded here, newest first."
        }
        action={
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={shown.length === 0}>
            <Download className="w-3 h-3 mr-1" /> Export CSV
          </Button>
        }
      >
      {isInitialLoading ? (
        // Shape-matched skeletons so the audit log surface holds its
        // height while the 200-row select resolves.
        <div className="space-y-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-ds-sm border border-border/60 bg-background/40 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load the audit log."
          body="Tap Try again. Every admin action is still recorded — this is just a fetch hiccup."
          onRetry={() => refetch()}
        />
      ) : loaded.length === 0 && !more ? (
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={FileText}
          title="No audit entries yet"
          body="Admin actions land here the moment anyone approves a user, resolves a dispute, or updates settings."
        />
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-col gap-2 pb-1.5 sm:flex-row sm:items-center">
            <Input
              type="search"
              aria-label="Search the audit log"
              placeholder="Search by name, action or id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:flex-1"
            />
            <Select value={kind} onValueChange={(v) => setKind(v as AuditKind)}>
              <SelectTrigger aria-label="Kind of action" className="sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIT_KIND_LABEL) as AuditKind[]).map((k) => <SelectItem key={k} value={k}>{AUDIT_KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={actor} onValueChange={(v) => setActor(v as AuditActor)}>
              <SelectTrigger aria-label="Who did it" className="sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIT_ACTOR_LABEL) as AuditActor[]).map((k) => <SelectItem key={k} value={k}>{AUDIT_ACTOR_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {shown.length === 0 && (
            <p className="py-4 text-center text-ds-12 text-muted-foreground">
              {filtering ? "Nothing loaded matches these filters." : "Nothing to show in this stretch of the log."}
            </p>
          )}
          {shown.map(entry => {
            const summary = summarizeDetails(entry.action, entry.details);
            return (
              <div key={entry.id} className="rounded-ds-sm border border-border/60 bg-background/40 p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-ds-13 text-foreground">{entry.admin_name}</span>
                    <Badge className={toneBadgeClasses[entry.own_job ? "neutral" : actionTone[entry.action] ?? "neutral"]}>
                      {entry.own_job ? "Own job" : formatCategory(entry.action)}
                    </Badge>
                    {entry.target_type && (
                      <span className="text-ds-11 text-muted-foreground">→ {entry.target_type}</span>
                    )}
                  </div>
                  {summary && (
                    <p className="text-ds-11 text-foreground/80 mt-1 break-words">{summary}</p>
                  )}
                  <p className="text-ds-11 text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
          {more && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
      </AdminCard>
    </AdminViewShell>
  );
};

export default AdminAuditLog;
