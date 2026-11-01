import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap, Star, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandConfirmDialog from "@/components/ui/BrandConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatName } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { declineTimeLeft, declineUntilClock, INSTANT_BOOK_DECLINE_HOURS, INSTANT_BOOK_GENERIC_ERROR } from "@/lib/instantBook";

export type InstantCandidate = {
  helper_id: string;
  display_name: string;
  avatar_url: string | null;
  jobs_done: number;
  rating: number | null;
  review_count: number;
};

/** The booking columns of the poster's own job (RLS: the poster reads their own row). */
export type InstantBookingState = {
  status: string | null;
  helper_id: string | null;
  offered_to_helper_id: string | null;
  direct_offer_status: string | null;
  instant_decline_until: string | null;
  payment_status: string | null;
};

const stateKey = (jobId: string) => [...queryKeys.jobs.all, "instant-book-state", jobId] as const;
const candidatesKey = (jobId: string) => [...queryKeys.jobs.all, "instant-book-candidates", jobId] as const;

/** Can a Helpr be booked on this job now? Open, nobody hired or offered, the card held (or paid). */
export function canInstantBook(s: InstantBookingState | null | undefined): boolean {
  return !!s && s.status === "open" && !s.helper_id && !s.offered_to_helper_id
    && (s.payment_status === "held" || s.payment_status === "escrow");
}

/** A live booking: offered and waiting out the decline window. */
export function liveBooking(s: InstantBookingState | null | undefined): boolean {
  return !!s && s.status === "open" && !!s.offered_to_helper_id && s.direct_offer_status === "pending" && !!s.instant_decline_until;
}

/**
 * CMP-4, the poster's side: on their own open job, the top 3 Helprs who would
 * take it at the poster's own price (instant_book_candidates: their private
 * floor at or below it, free that day, 3+ real jobs done), each with Book now
 * (rpc_instant_book). The card is HELD, not charged: the Helpr has 2 hours to
 * decline, then the card is charged and they're hired. While booked, this
 * says who and until when. Nothing when nobody qualifies.
 */
export function InstantBookPanel({ jobId, now }: { jobId: string; now?: number }) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: stateKey(jobId),
    queryFn: async () => unwrap<InstantBookingState | null>(await supabase.from("jobs")
      .select("status, helper_id, offered_to_helper_id, direct_offer_status, instant_decline_until, payment_status")
      .eq("id", jobId).maybeSingle()),
    staleTime: 30_000,
  });
  const bookable = canInstantBook(state.data);
  const booked = liveBooking(state.data);
  const candidates = useQuery({
    queryKey: candidatesKey(jobId),
    enabled: bookable,
    queryFn: async () => unwrap<InstantCandidate[] | null>(await supabase.rpc("instant_book_candidates", { p_job_id: jobId })) ?? [],
    staleTime: 60_000,
  });
  const bookedName = useQuery({
    queryKey: [...queryKeys.jobs.all, "instant-book-name", state.data?.offered_to_helper_id ?? ""],
    enabled: booked,
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc("get_safe_profiles", { user_ids: [state.data!.offered_to_helper_id!] })) ?? [];
      return formatName(rows[0]?.full_name, "Your Helpr");
    },
  });
  const [confirm, setConfirm] = useState<InstantCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const book = useMutation({
    mutationFn: async (helperId: string) => {
      const { error: e } = await supabase.rpc("rpc_instant_book", { p_job_id: jobId, p_helper_id: helperId });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
    },
    onError: (e: unknown) => {
      setConfirm(null);
      setError(rpcErrorMessage("rpc_instant_book", e) ?? INSTANT_BOOK_GENERIC_ERROR);
      void qc.invalidateQueries({ queryKey: candidatesKey(jobId) });
    },
  });

  if (booked && state.data?.instant_decline_until) {
    const left = declineTimeLeft(state.data.instant_decline_until, now);
    const name = bookedName.data ?? "Your Helpr";
    return (
      <section data-instant-booked="" aria-labelledby="instant-booked-title" className="rounded-2xl border border-border bg-card p-4 space-y-1.5">
        <h2 id="instant-booked-title" className="flex items-center gap-2 text-ds-16 font-semibold">
          <Zap className="h-4 w-4 text-primary" aria-hidden /> Booked: {name}
        </h2>
        <p className="text-ds-14 text-muted-foreground">
          {name.split(" ")[0]} has until {declineUntilClock(state.data.instant_decline_until)} to say if they can&apos;t make it.
          Your card is held, not charged. If they don&apos;t decline, it&apos;s charged then and they&apos;re hired.
        </p>
        {left && (
          <p className="flex items-center gap-1.5 text-ds-13 font-semibold tabular-nums" style={{ color: "hsl(var(--amber-ink))" }}>
            <Timer className="h-4 w-4" aria-hidden /> {left}
          </p>
        )}
      </section>
    );
  }
  if (!bookable) return null;
  if (candidates.isError) {
    return <ErrorState variant="inline" title={rpcErrorMessage("instant_book_candidates", candidates.error) ?? "We couldn't load Helprs you can book now."} onRetry={() => void candidates.refetch()} />;
  }
  const list = (candidates.data ?? []).slice(0, 3);
  if (list.length === 0 && !error) return null;

  return (
    <section data-instant-book="" aria-labelledby="instant-book-title" className="space-y-3">
      <div className="space-y-1">
        <h2 id="instant-book-title" className="flex items-center gap-2 text-ds-16 font-semibold">
          <Zap className="h-4 w-4 text-primary" aria-hidden /> Book now
        </h2>
        <p className="text-ds-14 text-muted-foreground">
          These Helprs take jobs like this at your price and are free that day. Your card is held, not charged, for{" "}
          {INSTANT_BOOK_DECLINE_HOURS} hours while they can decline.
        </p>
      </div>
      {error && <p role="alert" className="text-ds-14" style={{ color: "hsl(var(--destructive))" }}>{error}</p>}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {list.map((c) => {
          const name = formatName(c.display_name, "A Helpr");
          return (
            <li key={c.helper_id} data-instant-candidate={c.helper_id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ds-15 font-semibold">{name}</span>
                <span className="flex items-center gap-1 text-ds-13 text-muted-foreground tabular-nums">
                  {c.rating != null && c.review_count > 0 && (
                    <><Star className="h-3.5 w-3.5 fill-current" aria-hidden />{c.rating.toFixed(1)} ({c.review_count}) · </>
                  )}
                  {c.jobs_done} jobs done
                </span>
              </span>
              <Button size="sm" className="shrink-0 rounded-full" disabled={book.isPending} onClick={() => setConfirm(c)} aria-label={`Book ${name} now`}>
                Book now
              </Button>
            </li>
          );
        })}
      </ul>
      <BrandConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm ? `Book ${formatName(confirm.display_name, "this Helpr")} now?` : "Book now?"}
        description={`Your card is held, not charged. They have ${INSTANT_BOOK_DECLINE_HOURS} hours to decline. If they don't, your card is charged and they're hired.`}
        primaryLabel={book.isPending ? "Booking…" : "Book now"}
        primaryDisabled={book.isPending}
        onPrimary={(e) => { e.preventDefault(); if (confirm) book.mutate(confirm.helper_id); }}
        secondaryLabel="Not now"
      />
    </section>
  );
}
