// The queue: every row of `marketing_content`, what state it is in, and the
// actions that move it.
//
// `marketing_content` IS the queue (the migration explains why there is no
// separate task table), so this list is both the content library and the
// dispatch board. The columns that only matter when something has gone wrong —
// `attempts`, `last_error` — are shown ONLY on the rows where they mean
// something, so a healthy queue stays readable and a failed row explains itself
// without a click.

import { useMemo, useState } from "react";
import {
  Ban,
  ExternalLink,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { AdminCard, AdminFilterStrip } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { cn } from "@/lib/utils";
import { report } from "@/lib/errorLogger";
import { mutationErrorMessage } from "@/lib/mutationResult";
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  blockingIssues,
  formatDateTime,
  validateDraft,
  type MarketingContentRow,
  type MarketingDraftInput,
  type MarketingStatus,
} from "./marketingTypes";
import {
  cancelMarketingContent,
  deleteMarketingContent,
  reopenMarketingContent,
  retryMarketingContent,
  scheduleMarketingContent,
} from "./marketingApi";

type Filter = "all" | MarketingStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "publishing", label: "Publishing" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

/** Status → badge treatment. `failed` is the only one that gets the alarm
 *  colour; `publishing` reads as in-flight rather than as done. */
const STATUS_VARIANT: Record<MarketingStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  scheduled: "secondary",
  publishing: "secondary",
  published: "default",
  failed: "destructive",
  cancelled: "outline",
};

interface Props {
  rows: MarketingContentRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onEdit: (row: MarketingContentRow) => void;
  onChanged: () => void;
  onCompose: () => void;
}

/** A row, in the shape the shared validator understands. */
const toInput = (row: MarketingContentRow): MarketingDraftInput => ({
  channel: row.channel,
  body: row.body,
  hashtags: row.hashtags ?? [],
  media_urls: row.media_urls ?? [],
  parish: row.parish,
  campaign: row.campaign,
  scheduled_for: row.scheduled_for,
});

export function MarketingQueue({
  rows,
  isLoading,
  isError,
  onRetry,
  onEdit,
  onChanged,
  onCompose,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MarketingContentRow | null>(null);

  const counts = useMemo(() => {
    const map: Partial<Record<Filter, number>> = { all: rows?.length ?? 0 };
    for (const row of rows ?? []) map[row.status] = (map[row.status] ?? 0) + 1;
    return map;
  }, [rows]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === "all" || r.status === filter),
    [rows, filter],
  );

  const run = async (row: MarketingContentRow, fn: () => Promise<void>, done: string) => {
    setBusyId(row.id);
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (err) {
      report(err, { tags: { source: "MarketingQueue.action" }, context: { id: row.id } });
      toast.error(mutationErrorMessage(err, "Couldn't do that — try again."));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * draft → scheduled, from the row rather than the editor.
   *
   * Runs the SAME validator the composer runs before writing, so the
   * Instagram-needs-media CHECK cannot be reached from this shortcut either —
   * the owner is sent to the editor with the reason, instead of getting a
   * constraint-violation toast.
   */
  const schedule = (row: MarketingContentRow) => {
    const issues = blockingIssues(validateDraft(toInput(row), "scheduled"));
    if (issues.length > 0) {
      toast.error(issues[0].message);
      onEdit(row);
      return;
    }
    void run(
      row,
      () => scheduleMarketingContent(row.id, row.scheduled_for as string),
      "Post scheduled.",
    );
  };

  const retry = (row: MarketingContentRow) => {
    const issues = blockingIssues(validateDraft(toInput(row), "scheduled"));
    if (issues.length > 0) {
      toast.error(issues[0].message);
      onEdit(row);
      return;
    }
    // A failed row's original time is in the past; retrying means "go on the
    // next run", so the existing time is reused rather than invented.
    void run(
      row,
      () => retryMarketingContent(row.id, row.scheduled_for ?? new Date().toISOString()),
      "Queued for another attempt.",
    );
  };

  if (isLoading) {
    return (
      <AdminCard title="Queue">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </AdminCard>
    );
  }

  if (isError) {
    return (
      <AdminCard title="Queue">
        <ErrorState
          title="We couldn't load the queue."
          body="The post queue didn't load, so this is not a list of everything that's scheduled. Try again."
          onRetry={onRetry}
          surfaceStyle={NESTED_EMPTY_SURFACE}
        />
      </AdminCard>
    );
  }

  return (
    <>
      <AdminCard
        title="Queue"
        subtitle={`${rows?.length ?? 0} post${(rows?.length ?? 0) === 1 ? "" : "s"}`}
        action={
          <Button size="sm" onClick={onCompose}>
            New post
          </Button>
        }
      >
        <AdminFilterStrip label="Filter by status" className="mb-4">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-ds-11 transition-colors",
                filter === f.id
                  ? "border-transparent bg-foreground text-background"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              {counts[f.id] ? ` (${counts[f.id]})` : ""}
            </button>
          ))}
        </AdminFilterStrip>

        {visible.length === 0 ? (
          <EmptyState
            icon={Send}
            title={filter === "all" ? "No posts yet." : "Nothing here."}
            body={
              filter === "all"
                ? "Write a post and it'll appear here as a draft until you schedule it."
                : "No posts in this state right now."
            }
            surfaceStyle={NESTED_EMPTY_SURFACE}
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((row) => {
              const busy = busyId === row.id;
              const thumb = row.media_urls?.[0];
              return (
                <li
                  key={row.id}
                  className="rounded-xl border border-border/60 p-3 sm:p-4"
                >
                  <div className="flex gap-3">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/60">
                        <span className="text-ds-11 text-muted-foreground">No image</span>
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={STATUS_VARIANT[row.status]}>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                        <span className="text-ds-11 text-muted-foreground">
                          {CHANNEL_LABEL[row.channel]}
                        </span>
                        {row.parish && (
                          <span className="text-ds-11 text-muted-foreground">· {row.parish}</span>
                        )}
                        {row.campaign && (
                          <span className="text-ds-11 text-muted-foreground">
                            · {row.campaign}
                          </span>
                        )}
                      </div>

                      {/* `line-clamp` rather than a substring: a truncated body
                          that ends mid-word with "…" reads as corrupted data. */}
                      <p className="line-clamp-3 whitespace-pre-wrap text-ds-13 text-foreground">
                        {row.body}
                      </p>

                      {row.hashtags?.length > 0 && (
                        <p className="line-clamp-1 text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                          {row.hashtags.map((t) => `#${t}`).join(" ")}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ds-11 text-muted-foreground">
                        {row.status === "published" && row.published_at ? (
                          <span>Published {formatDateTime(row.published_at)}</span>
                        ) : row.scheduled_for ? (
                          <span>Scheduled {formatDateTime(row.scheduled_for)}</span>
                        ) : (
                          <span>No time set</span>
                        )}
                        {/* Attempts only mean something once one has failed. */}
                        {row.attempts > 0 && row.status !== "published" && (
                          <span>
                            {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
                          </span>
                        )}
                        {row.generated_by && <span>via {row.generated_by}</span>}
                      </div>

                      {/* `failed` is not the only status where last_error means
                          something. When the dispatcher declines a row — channel
                          off, over the daily cap, outside the posting window —
                          `releaseRow` puts it BACK to `scheduled` with the reason
                          in last_error (marketing-publish/index.ts:489-501). Gating
                          this on `failed` hid exactly that case: the row read
                          "Scheduled 9:00am", the time passed, nothing published,
                          and the explanation sat in a column the UI would not
                          render. Both write paths that move a row INTO `scheduled`
                          deliberately null last_error (scheduleMarketingContent,
                          retryMarketingContent), so a scheduled row carrying one is
                          unambiguously a deferral — never a stale message.
                          Amber, not red: it will be retried on the next tick. */}
                      {row.last_error && (row.status === "failed" || row.status === "scheduled") && (
                        <p
                          className="rounded-md px-2 py-1.5 text-ds-11"
                          style={
                            row.status === "failed"
                              ? {
                                  background: "hsl(var(--destructive) / 0.08)",
                                  // --destructive-ink, not the raw --destructive
                                  // text token: on this tint the raw token measures
                                  // 3.30:1 in dark mode, well under the 4.5:1 an
                                  // 11px error line needs.
                                  color: "hsl(var(--destructive-ink))",
                                }
                              : {
                                  background: "hsl(var(--amber-tint) / 0.12)",
                                  color: "hsl(var(--burnt-sienna))",
                                }
                          }
                        >
                          {row.status === "scheduled" ? `Held back — ${row.last_error}` : row.last_error}
                        </p>
                      )}

                      {row.status === "publishing" && (
                        <p className="text-ds-11 text-muted-foreground">
                          A dispatcher is publishing this right now — it can't be edited or
                          cancelled until it finishes or times out.
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

                        {(row.status === "draft" ||
                          row.status === "scheduled" ||
                          row.status === "failed" ||
                          row.status === "cancelled") && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(row)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        )}

                        {row.status === "draft" && (
                          <Button size="sm" disabled={busy} onClick={() => schedule(row)}>
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            Schedule
                          </Button>
                        )}

                        {(row.status === "scheduled" || row.status === "failed") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void run(row, () => cancelMarketingContent(row.id), "Post cancelled.")
                            }
                          >
                            <Ban className="mr-1.5 h-3.5 w-3.5" />
                            Cancel
                          </Button>
                        )}

                        {row.status === "failed" && (
                          <Button size="sm" disabled={busy} onClick={() => retry(row)}>
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                            Retry
                          </Button>
                        )}

                        {row.status === "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void run(row, () => reopenMarketingContent(row.id), "Moved back to drafts.")
                            }
                          >
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                            Reopen as draft
                          </Button>
                        )}

                        {(row.status === "draft" || row.status === "cancelled") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setDeleteTarget(row)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Delete
                          </Button>
                        )}

                        {row.status === "published" && row.external_url && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={row.external_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              View post
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>

      <BrandConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this post?"
        description="This removes the post permanently. It hasn't been published, so nothing public changes — but the copy and its image link are gone."
        primaryLabel="Delete"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          const row = deleteTarget;
          setDeleteTarget(null);
          if (row) void run(row, () => deleteMarketingContent(row.id), "Post deleted.");
        }}
        secondaryLabel="Cancel"
      />
    </>
  );
}
