import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { Sheet, SheetContent, SheetDestructiveAction, SheetFooter, SheetHero, SheetSecondaryAction } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SAVED_SEARCHES_KEY } from "@/components/savedSearches/SaveSearchSheet";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { mutationErrorMessage } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticLight } from "@/lib/haptics";
import {
  deleteSavedSearch,
  fetchNewCounts,
  fetchPaused,
  fetchSavedSearches,
  markSeen,
  resultsPath,
  rowSummary,
  setPaused,
  updateSavedSearch,
  type SavedSearch,
} from "@/lib/savedSearches";

const card = { background: "hsl(var(--card))" } as const;

/** The olive "3 new" pill (board 91). Hidden at 0: every number is real or hidden. */
function NewPill({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 font-sans font-semibold text-ds-11 tabular-nums" style={{ background: "hsl(var(--bark))", color: "hsl(var(--primary-foreground))" }} data-testid="saved-search-new">
      {n} new
    </span>
  );
}

/** One search's settings: its alerts, its email, and delete. */
function SearchSheet({ search, userId, onClose }: { search: SavedSearch | null; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (patch: { notify_enabled?: boolean; notify_email?: boolean }) => updateSavedSearch(userId, search!.id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY }),
    onError: (err) => {
      report(err, { tags: { source: "SavedSearchesTab.change" } });
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't change that alert. Please try again."));
      void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteSavedSearch(userId, search!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY });
      close();
    },
    onError: (err) => {
      report(err, { tags: { source: "SavedSearchesTab.remove" } });
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't delete that search. Please try again."));
    },
  });
  const busy = change.isPending || remove.isPending;
  // Deleting can't be undone, so it asks once, here in the sheet.
  const [asking, setAsking] = useState(false);
  const close = () => { setAsking(false); onClose(); };
  return (
    <Sheet open={!!search} onOpenChange={(o) => !o && close()}>
      <SheetContent side="bottom" floor data-testid="saved-search-sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
        {search && (
          <>
            <SheetHero title={search.name} />
            <div className="rounded-2xl overflow-hidden" style={card}>
              <label className="flex items-center gap-3 px-4 py-3 min-h-[56px] border-b border-border">
                <span className="flex-1 min-w-0">
                  <span className="block font-sans font-semibold text-ds-15">Alerts for this search</span>
                  <span className="block font-sans text-ds-13 text-muted-foreground">In the app when something new matches</span>
                </span>
                <Switch checked={search.notify_enabled} disabled={busy} onCheckedChange={(v) => change.mutate({ notify_enabled: v })} aria-label="Alerts for this search" />
              </label>
              <label className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
                <span className="flex-1 min-w-0">
                  <span className="block font-sans font-semibold text-ds-15">Email</span>
                  <span className="block font-sans text-ds-13 text-muted-foreground">Once a day, only if there's something new</span>
                </span>
                <Switch checked={search.notify_email} disabled={busy || !search.notify_enabled} onCheckedChange={(v) => change.mutate({ notify_email: v })} aria-label="Email" />
              </label>
            </div>
            <SheetFooter className="mt-4">
              {asking ? (
                <>
                  <p className="font-sans text-ds-13 text-muted-foreground">Delete this search? Its alerts stop, and it can't be brought back.</p>
                  <SheetSecondaryAction disabled={busy} onClick={() => setAsking(false)}>Keep it</SheetSecondaryAction>
                  <SheetDestructiveAction onClick={() => remove.mutate()} disabled={busy} aria-busy={remove.isPending}>
                    Yes, delete it
                  </SheetDestructiveAction>
                </>
              ) : (
                <SheetDestructiveAction onClick={() => setAsking(true)} disabled={busy}>
                  Delete search
                </SheetDestructiveAction>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * You › Settings › Saved searches (board 91, right). Each saved search with
 * its real "N new" (saved_search_new_counts), its channel and filters; tapping
 * one opens that section's Browse with the filters on and restarts the count.
 * "Pause all alerts" keeps the searches and stops the alerts.
 */
export default function SavedSearchesTab({ onBack }: { onBack: () => void }) {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SavedSearch | null>(null);

  const list = useQuery({ queryKey: [...SAVED_SEARCHES_KEY, "list", userId], enabled: !!userId, queryFn: () => fetchSavedSearches(userId) });
  const counts = useQuery({ queryKey: [...SAVED_SEARCHES_KEY, "counts", userId], enabled: !!userId, queryFn: fetchNewCounts, staleTime: 30_000 });
  const paused = useQuery({ queryKey: [...SAVED_SEARCHES_KEY, "paused", userId], enabled: !!userId, queryFn: () => fetchPaused(userId) });
  const pause = useMutation({
    mutationFn: (v: boolean) => setPaused(userId, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...SAVED_SEARCHES_KEY, "paused"] }),
    onError: (err) => {
      report(err, { tags: { source: "SavedSearchesTab.pause" } });
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't change that. Please try again."));
    },
  });

  const open = async (s: SavedSearch) => {
    hapticLight();
    try {
      await markSeen(userId, s.id);
    } catch (err) {
      // The results still open; only the "new" count stays as it was.
      report(err, { tags: { source: "SavedSearchesTab.markSeen" } });
    }
    void qc.invalidateQueries({ queryKey: [...SAVED_SEARCHES_KEY, "counts"] });
    navigate(resultsPath(s));
  };

  // One gate: the rows, their "N new" and the pause switch arrive in one paint.
  const loading = list.isLoading || counts.isLoading || paused.isLoading;
  const rows = list.data ?? [];
  const current = editing ? rows.find((r) => r.id === editing.id) ?? null : null;

  return (
    <ProfileTabBody data-testid="saved-searches-tab">
      <ProfileTabHeader title="Saved searches" onBack={onBack} />
      {loading ? (
        <ProfileTabBodyReserve tab="saved_searches" />
      ) : list.isError ? (
        <ErrorState variant="inline" title="We couldn't load your saved searches." onRetry={() => void list.refetch()} />
      ) : (
        <>
          <p className="font-sans text-ds-13 text-muted-foreground px-1">
            {rows.length
              ? "You get an alert when something new matches. Tap one to see results."
              : "Search in Jobs or Declutter, then tap Save this search to be told when something new matches."}
          </p>
          {rows.length > 0 && (
            <ul className="rounded-2xl overflow-hidden" style={card}>
              {rows.map((s) => (
                <li key={s.id} className="flex items-center border-b border-border last:border-b-0" data-saved-search={s.section}>
                  <button type="button" onClick={() => void open(s)} className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-1 py-3 min-h-[60px] text-left ctl-tint">
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-sans font-semibold text-ds-15 truncate" style={{ color: "hsl(var(--ink-deep))" }} title={s.name}>{s.name}</span>
                        <NewPill n={counts.data?.get(s.id) ?? 0} />
                      </span>
                      <span className="block font-sans text-ds-13 text-muted-foreground truncate" title={rowSummary(s, !!paused.data)}>{rowSummary(s, !!paused.data)}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                  {/* The shared compact ghost icon (44 tap, 40 wash), not a hand-made button; 16px glyph kept (B47 10-31). */}
                  <Button type="button" variant="ghost" size="iconCompact" onClick={() => setEditing(s)} aria-label={`Settings for ${s.name}`}
                    className="shrink-0 mr-1 rounded-full text-muted-foreground [&_svg]:size-4">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <label className="flex items-center gap-3 rounded-2xl px-4 py-3 min-h-[60px]" style={card}>
              <span className="flex-1 min-w-0">
                <span className="block font-sans font-semibold text-ds-15">Pause all alerts</span>
                <span className="block font-sans text-ds-13 text-muted-foreground">Keep the searches, stop the alerts</span>
              </span>
              <Switch checked={!!paused.data} disabled={paused.data === undefined || pause.isPending} onCheckedChange={(v) => pause.mutate(v)} aria-label="Pause all alerts" data-testid="pause-all-alerts" />
            </label>
          )}
        </>
      )}
      <SearchSheet search={current} userId={userId} onClose={() => setEditing(null)} />
    </ProfileTabBody>
  );
}
