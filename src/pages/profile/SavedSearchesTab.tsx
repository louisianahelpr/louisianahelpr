import { useState } from "react";
import { ListRow } from "@/components/ui/ListRow";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { Sheet, SheetContent, SheetDestructiveAction, SheetFooter, SheetHero, SheetSecondaryAction } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SAVED_SEARCHES_KEY } from "@/components/savedSearches/SaveSearchSheet";
import { SavedSearchNewPill } from "@/components/savedSearches/SavedSearchNewPill";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { mutationErrorMessage } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import "@/lib/i18n/enAccount";
import { t, useLanguage } from "@/lib/i18n/language";
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


/** F468: the per-row "Alerts" switch; its own mutation so a failed flip puts that one row back. */
function RowAlertSwitch({ search, userId, paused }: { search: SavedSearch; userId: string; paused: boolean }) {
  useLanguage();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (notify_enabled: boolean) => updateSavedSearch(userId, search.id, { notify_enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY }),
    onError: (err) => {
      report(err, { tags: { source: "SavedSearchesTab.rowAlert" } });
      hapticError();
      toast.error(mutationErrorMessage(err, t("ss.alertFailed")));
      void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY });
    },
  });
  return (
    <Switch
      checked={search.notify_enabled}
      disabled={paused || change.isPending}
      onCheckedChange={(v) => change.mutate(v)}
      aria-label={t("ss.alertsForName", { name: search.name })}
      data-saved-search-alerts=""
      className="shrink-0"
    />
  );
}

/** One search's settings: its alerts, its email, and delete. */
function SearchSheet({ search, userId, onClose }: { search: SavedSearch | null; userId: string; onClose: () => void }) {
  useLanguage();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (patch: { notify_enabled?: boolean; notify_email?: boolean }) => updateSavedSearch(userId, search!.id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SAVED_SEARCHES_KEY }),
    onError: (err) => {
      report(err, { tags: { source: "SavedSearchesTab.change" } });
      hapticError();
      toast.error(mutationErrorMessage(err, t("ss.alertFailed")));
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
      toast.error(mutationErrorMessage(err, t("ss.deleteFailed")));
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
                  <span className="block font-sans font-semibold text-ds-15">{t("ss.alertsThis")}</span>
                  <span className="block font-sans text-ds-13 text-muted-foreground">{t("ss.alertsThisBody")}</span>
                </span>
                <Switch checked={search.notify_enabled} disabled={busy} onCheckedChange={(v) => change.mutate({ notify_enabled: v })} aria-label={t("ss.alertsThis")} />
              </label>
              <label className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
                <span className="flex-1 min-w-0">
                  <span className="block font-sans font-semibold text-ds-15">{t("ss.email")}</span>
                  <span className="block font-sans text-ds-13 text-muted-foreground">{t("ss.emailBody")}</span>
                </span>
                <Switch checked={search.notify_email} disabled={busy || !search.notify_enabled} onCheckedChange={(v) => change.mutate({ notify_email: v })} aria-label={t("ss.email")} />
              </label>
            </div>
            <SheetFooter className="mt-4">
              {asking ? (
                <>
                  <p className="font-sans text-ds-13 text-muted-foreground">{t("ss.deleteAsk")}</p>
                  <SheetSecondaryAction disabled={busy} onClick={() => setAsking(false)}>{t("ss.keep")}</SheetSecondaryAction>
                  <SheetDestructiveAction onClick={() => remove.mutate()} disabled={busy} aria-busy={remove.isPending}>
                    {t("ss.yesDelete")}
                  </SheetDestructiveAction>
                </>
              ) : (
                <SheetDestructiveAction onClick={() => setAsking(true)} disabled={busy}>
                  {t("ss.delete")}
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
  useLanguage();
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
      toast.error(mutationErrorMessage(err, t("ss.changeFailed")));
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
      <ProfileTabHeader title={t("ss.title")} onBack={onBack} />
      {loading ? (
        <ProfileTabBodyReserve tab="saved_searches" />
      ) : list.isError ? (
        <ErrorState variant="inline" title={t("ss.loadFailed")} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <p className="font-sans text-ds-13 text-muted-foreground px-1">
            {rows.length
              ? t("ss.introSome")
              : t("ss.introNone")}
          </p>
          {rows.length > 0 && (
            <ul className="rounded-2xl overflow-hidden" style={card}>
              {rows.map((s) => (
                <li key={s.id} className="flex items-center border-b border-border last:border-b-0" data-saved-search={s.section}>
                  {/* Design audit area 09 M8: no chevron (the switch and the menu already crowd the row), and the name
                      wraps to two lines instead of ending in "…". */}
                  <ListRow variant="flush" onClick={() => void open(s)} className="flex-1 min-w-0 pl-4 pr-1 py-3">
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        <span data-saved-search-name="" className="font-sans font-semibold text-ds-15 line-clamp-2 break-words" style={{ color: "hsl(var(--ink-deep))" }} title={s.name}>{s.name}</span>
                        <SavedSearchNewPill n={counts.data?.get(s.id) ?? 0} />
                      </span>
                      <span className="block font-sans text-ds-13 text-muted-foreground truncate" title={rowSummary(s, !!paused.data)}>{rowSummary(s, !!paused.data)}</span>
                    </span>
                  </ListRow>
                  {/* F468 (audit 11-10): a row that read "Alerts off" gave no way to turn that one search back on from
                      the list; each row carries its own Alerts switch (the sheet keeps Email and Delete). */}
                  <RowAlertSwitch search={s} userId={userId} paused={!!paused.data} />
                  {/* The shared compact ghost icon (44 tap, 40 wash), not a hand-made button; 16px glyph kept (B47 10-31). */}
                  <Button type="button" variant="ghost" size="iconCompact" onClick={() => setEditing(s)} aria-label={t("ss.settingsForName", { name: s.name })}
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
                <span className="block font-sans font-semibold text-ds-15">{t("ss.pauseAll")}</span>
                <span className="block font-sans text-ds-13 text-muted-foreground">{t("ss.pauseAllBody")}</span>
              </span>
              <Switch checked={!!paused.data} disabled={paused.data === undefined || pause.isPending} onCheckedChange={(v) => pause.mutate(v)} aria-label={t("ss.pauseAll")} data-testid="pause-all-alerts" />
            </label>
          )}
        </>
      )}
      <SearchSheet search={current} userId={userId} onClose={() => setEditing(null)} />
    </ProfileTabBody>
  );
}
