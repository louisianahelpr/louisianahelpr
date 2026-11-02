import { useState } from "react";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { MessageApplicantButton } from "@/components/jobs/MessageApplicantButton";
import { formatJobDate } from "@/lib/dateUtils";
import { endSentence, formatName } from "@/lib/utils";
import { hapticError } from "@/lib/haptics";
import { userFacingError } from "@/lib/userFacingError";
import {
  claimSeriesDates,
  claimSetupStep,
  fetchSeriesDates,
  giveUpSeriesDates,
  offerSeriesDates,
  type SeriesDate,
} from "@/lib/seriesDates";
import { unwrap } from "@/lib/supabaseResult";
import { todayYmd } from "@/lib/jobDate";

/**
 * Visit dates of a recurring series, per date (docs/OPEN.md Q407 (5), (6) and
 * the pick-up addendum, 2026-09-25).
 *
 * A Helpr on the series sees their dates (and can give some up), and the open
 * dates they may take: any open date once they have an offer (the first hired
 * Helpr always does), or a date another Helpr gave up ("A date opened up —
 * pick it up"). The person who posted it sees how many upcoming dates have a
 * Helpr and can offer the open ones to someone who applied.
 *
 * Collapsed by default: one line on the card, the list on demand. Renders
 * nothing until the database has the series tables (deploy lag).
 */
export function SeriesDatesPanel({
  jobId,
  jobTitle,
  dateNeeded,
  recurrenceDays,
  recurrenceWeeks,
  userId,
  isPoster,
  firstHelpr,
  firstVisitHasHelpr = false,
  splitOk,
  inset = true,
}: {
  jobId: string;
  jobTitle: string | null;
  dateNeeded: string;
  recurrenceDays: number[];
  recurrenceWeeks: number;
  userId: string | null;
  isPoster: boolean;
  /** recurring_helper_id when it is still the Helpr hired on the parent. */
  firstHelpr: string | null;
  /** The first visit (the series' own job row) has a Helpr hired on it: jobs.helper_id is set. */
  firstVisitHasHelpr?: boolean;
  splitOk: boolean;
  /** Card-edge margins (the poster's card); false inside an already padded footer. */
  inset?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  // Owner ruling 2026-10-23: payout setup is paused; a claim that waits on it
  // says so instead of "Set up payouts" (claimSetupStep).
  const setupPaused = usePayoutSetupPaused();
  const key = ["series-dates", jobId, userId];

  const { data: view, isError } = useQuery({
    queryKey: key,
    staleTime: 30_000,
    queryFn: () =>
      fetchSeriesDates({ jobId, dateNeeded, recurrenceDays, recurrenceWeeks, viewer: userId, firstHelpr }),
  });

  const { data: applicants } = useQuery({
    queryKey: ["series-applicants", jobId],
    enabled: isPoster && open,
    staleTime: 60_000,
    queryFn: async () => {
      const data = unwrap(
        await supabase
          .from("applications")
          .select("helper_id")
          .eq("job_id", jobId)
          .eq("status", "pending"),
      );
      const ids = [...new Set((data ?? []).map((a) => a.helper_id as string))];
      if (ids.length === 0) return [] as Array<{ id: string; name: string }>;
      const people = unwrap(await supabase.rpc("get_safe_profiles", { user_ids: ids }));
      const names = new Map((people ?? []).map((p: { user_id: string; full_name: string | null }) => [p.user_id, formatName(p.full_name, "Helpr")]));
      return ids.map((id) => ({ id, name: names.get(id) ?? "Helpr" }));
    },
  });

  if (!view || isError) return null;

  const mine = view.dates.filter((d) => d.state === "mine");
  const openDates = view.dates.filter((d) => d.state === "open" || d.state === "released");
  // What this viewer may take: any open date with an offer; otherwise, if they
  // are on the series, a date someone ELSE gave up.
  const onSeries = mine.length > 0 || view.offered;
  const takeable = isPoster
    ? []
    : openDates.filter((d) => view.offered ? d.releasedBy !== userId : d.state === "released" && d.releasedBy !== userId && onSeries);
  const pickUpCount = takeable.filter((d) => d.state === "released").length;
  const held = view.dates.filter((d) => d.state === "mine" || d.state === "taken").length;

  if (!isPoster && mine.length === 0 && takeable.length === 0) return null;

  const refresh = async () => {
    setPicked([]);
    await queryClient.invalidateQueries({ queryKey: ["series-dates", jobId] });
  };

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await action());
      await refresh();
    } catch (err) {
      hapticError();
      toast.error(userFacingError(err, "Couldn't update your visit dates. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (d: string) => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  const pickedMine = picked.filter((d) => mine.some((m) => m.date === d));
  const pickedOpen = picked.filter((d) => takeable.some((t) => t.date === d));

  // The poster's count includes the FIRST visit (the series' own job row) while it is still ahead: the dates read
  // lists only the later visits, so a 4-visit series posted on Review read "0 of 3 upcoming dates" (audit 2026-10-28
  // A2-C37). Guard: src/components/series/SeriesDatesPanel.test.tsx.
  const firstAhead = isPoster && dateNeeded >= todayYmd();
  const allDates = view.dates.length + (firstAhead ? 1 : 0);
  const allHeld = held + (firstAhead && firstVisitHasHelpr ? 1 : 0);
  const allOpen = openDates.length + (firstAhead && !firstVisitHasHelpr ? 1 : 0);
  const summary = isPoster
    ? `${allHeld} of ${allDates} upcoming date${allDates === 1 ? "" : "s"} have a Helpr${allOpen ? ` · ${allOpen} open` : ""}`
    : pickUpCount > 0
      ? "A date opened up — pick it up"
      : `${mine.length} upcoming date${mine.length === 1 ? "" : "s"} are yours${takeable.length ? ` · ${takeable.length} open` : ""}`;

  // Board 118 (restyle only, owner 2026-10-21): each visit is a row, the day in bold and its real state
  // under it, in sentence case. Only the states the series read has (no "Done · paid", no Skip/Pause).
  const stateWords = (d: SeriesDate) =>
    d.state === "mine" ? "Yours" : d.state === "taken" ? "Has a Helpr" : d.state === "released" ? "Opened up" : "Open";
  const row = (d: SeriesDate, selectable: boolean) => (
    <li key={d.date} className="flex items-center gap-2 min-h-[52px] border-b border-border last:border-b-0">
      {selectable ? (
        <label className="flex items-center gap-2 min-h-[44px] flex-1 cursor-pointer">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] min-h-0 min-w-0 shrink-0"
            checked={picked.includes(d.date)}
            onChange={() => toggle(d.date)}
            aria-label={formatJobDate(d.date)}
          />
          <span className="flex flex-col">
            <span className="text-ds-15 font-semibold text-foreground">{formatJobDate(d.date)}</span>
            <span className="text-ds-12 font-semibold text-primary">{stateWords(d)}</span>
          </span>
        </label>
      ) : (
        <span className="flex flex-1 flex-col">
          <span className="text-ds-15 font-semibold text-foreground">{formatJobDate(d.date)}</span>
          <span className={`text-ds-12 font-semibold ${d.state === "open" || d.state === "released" ? "text-muted-foreground" : "text-primary"}`}>{stateWords(d)}</span>
        </span>
      )}
    </li>
  );

  return (
    <div className={`${inset ? "mx-4 mb-2 " : ""}rounded-ds-md`} style={{ border: "0.5px solid hsl(var(--bark) / 0.18)" }} data-series-dates>
      <button
        type="button"
        className="w-full min-h-[44px] px-3 flex items-center gap-1.5 text-ds-11 font-semibold text-left"
        style={{ color: "hsl(var(--bark))" }}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="truncate flex-1 min-w-0" title={`Visit dates · ${summary}`}>Visit dates · {summary}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3" onClick={(e) => e.stopPropagation()}>
          <p className="text-ds-11 text-muted-foreground leading-snug">
            {splitOk
              ? "Different Helprs can take different dates. A date nobody takes isn't charged, or most of it comes back to your card if it was already paid."
              : "One Helpr for every visit. A date nobody takes isn't charged, or most of it comes back to your card if it was already paid."}
          </p>

          {!isPoster && mine.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-ds-12 font-semibold text-foreground">Your dates</h4>
              <ul>{mine.map((d) => row(d, true))}</ul>
              <button
                type="button"
                disabled={busy || pickedMine.length === 0}
                onClick={() => setConfirmGiveUp(true)}
                className="min-h-[44px] px-1 text-ds-11 font-semibold underline underline-offset-2 disabled:opacity-40"
                // Not money, so not rust (spec §1.1): giving a date up is the alert text action.
                style={{ color: "hsl(var(--alert, 4 71% 41%))" }}
              >
                Give up {pickedMine.length || ""} date{pickedMine.length === 1 ? "" : "s"}
              </button>
            </section>
          )}

          {!isPoster && takeable.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-ds-12 font-semibold text-foreground">
                {pickUpCount > 0 ? "A date opened up — pick it up" : "Open dates you can pick"}
              </h4>
              <ul>{takeable.map((d) => row(d, true))}</ul>
              <button
                type="button"
                disabled={busy || pickedOpen.length === 0}
                onClick={() =>
                  run(async () => {
                    const r = await claimSeriesDates(jobId, pickedOpen);
                    // ID once (20261020043346): what the Helpr's setup still lacks.
                    const step = claimSetupStep(r, setupPaused);
                    if (r.claimed.length === 0 && r.alreadyYours.length > 0 && r.taken.length + r.refused.length + r.needsSetup.length === 0) {
                      return r.alreadyYours.length === 1 ? "That date is already yours." : "Those dates are already yours.";
                    }
                    if (r.claimed.length === 0) {
                      throw new Error(step ?? "Those dates were taken or can't be booked in time any more.");
                    }
                    const lost = r.taken.length + r.refused.length + r.needsSetup.length;
                    return `You have ${r.claimed.length} more date${r.claimed.length === 1 ? "" : "s"}.${lost ? ` ${lost} couldn't be added.` : ""}${step ? ` ${step}` : ""}`;
                  })
                }
                className="btn-grad-primary min-h-[44px] px-4 rounded-full text-ds-12 font-semibold disabled:opacity-40"
              >
                Pick {pickedOpen.length || ""} date{pickedOpen.length === 1 ? "" : "s"}
              </button>
            </section>
          )}

          {isPoster && (
            <section className="space-y-2">
              <h4 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">Visits</h4>
              <ul>{view.dates.map((d) => row(d, false))}</ul>
              {openDates.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-ds-12 font-semibold text-foreground">Offer the open dates</h4>
                  {(applicants ?? []).length === 0 ? (
                    <p className="text-ds-11 text-muted-foreground">
                      Nobody is waiting on this series right now. When someone applies, you can offer them the open dates here.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {(applicants ?? []).map((a) => (
                        <li key={a.id} className="flex items-center gap-2 min-h-[44px]">
                          <span className="text-ds-12 text-foreground flex-1 truncate">{a.name}</span>
                          {/* Pending applicants only (the query above), so always messageable; poster-first. */}
                          <MessageApplicantButton jobId={jobId} helperId={a.id} helperName={a.name} appearance="row" />
                          <button
                            type="button"
                            disabled={busy || view.offeredTo.includes(a.id)}
                            onClick={() =>
                              run(async () => {
                                const r = await offerSeriesDates(jobId, a.id);
                                return `Offered ${r.openDates} open date${r.openDates === 1 ? "" : "s"} to ${endSentence(a.name)}`;
                              })
                            }
                            className="min-h-[44px] px-3 rounded-full text-ds-11 font-semibold border border-border disabled:opacity-40"
                          >
                            {view.offeredTo.includes(a.id) ? "Offered" : "Offer dates"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <BrandConfirmDialog
        open={confirmGiveUp}
        onOpenChange={(next) => {
          if (!busy) setConfirmGiveUp(next);
        }}
        title={`Give up ${pickedMine.length} date${pickedMine.length === 1 ? "" : "s"} on "${jobTitle ?? "this series"}"?`}
        description={`They go back to the series: ${endSentence(splitOk ? "another Helpr on it can pick them up, or the person who posted it can offer them to someone new" : "the person who posted it can offer them to someone new")} Giving up a date that starts within 24 hours counts as a reliability strike, the same as a late cancel.`}
        primaryLabel={busy ? "Giving up…" : "Give up"}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={busy}
        onPrimary={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await giveUpSeriesDates(jobId, pickedMine);
            setConfirmGiveUp(false);
            return r.strike
              ? `Gave up ${r.released.length} date${r.released.length === 1 ? "" : "s"}. One started within 24 hours, so it counts as a reliability strike.`
              : `Gave up ${r.released.length} date${r.released.length === 1 ? "" : "s"}.`;
          });
        }}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
