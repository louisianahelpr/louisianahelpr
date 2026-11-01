import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { unwrap } from "@/lib/supabaseResult";
import { JOB_CATEGORIES, JOB_CATEGORY_LABELS, type JobCategory } from "@/lib/jobCategories";
import { TAB_TITLES } from "@/pages/profile/types";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { INSTANT_BOOK_GENERIC_ERROR, INSTANT_BOOK_FLOOR_MAX_DOLLARS, INSTANT_BOOK_FLOOR_MIN_DOLLARS, INSTANT_BOOK_MAX_CATEGORIES } from "@/lib/instantBook";

const card = { background: "hsl(var(--card))" } as const;

export type InstantBookFloor = { category: string; floor_cents: number };

const floorsKey = (me: string) => ["instant-book-floors", me] as const;

/**
 * You › Jobs settings › Instant book (CMP-4). A Helpr picks up to 3 kinds of
 * work and the least they'll take for each. The amount is PRIVATE: it is read
 * only through rpc_my_instant_book_floors (the table has no client grant), and
 * a poster only ever sees that this Helpr can be booked now at the poster's
 * own price. Saving calls rpc_set_instant_book_floor (NULL removes a floor);
 * the server holds the limits ($10 to $1,000, 3 categories) and this screen
 * words its refusals.
 */
export default function InstantBookTab({ onBack }: { onBack: () => void }) {
  const { user } = useCurrentUser();
  const me = user?.id ?? "";
  const qc = useQueryClient();
  const floors = useQuery({
    queryKey: floorsKey(me),
    enabled: !!me,
    queryFn: async () => unwrap<InstantBookFloor[] | null>(await supabase.rpc("rpc_my_instant_book_floors")) ?? [],
  });
  const [category, setCategory] = useState<JobCategory | "">("");
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (v: { category: string; cents: number | null }) => {
      const { error: e } = await supabase.rpc("rpc_set_instant_book_floor", { p_category: v.category, p_floor_cents: v.cents });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      setCategory("");
      setAmount(undefined);
      void qc.invalidateQueries({ queryKey: floorsKey(me) });
    },
    onError: (e: unknown) => setError(rpcErrorMessage("rpc_set_instant_book_floor", e) ?? INSTANT_BOOK_GENERIC_ERROR),
  });

  const rows = floors.data ?? [];
  const full = rows.length >= INSTANT_BOOK_MAX_CATEGORIES;
  const used = new Set(rows.map((r) => r.category));
  const amountOk = amount !== undefined && amount >= INSTANT_BOOK_FLOOR_MIN_DOLLARS && amount <= INSTANT_BOOK_FLOOR_MAX_DOLLARS;

  return (
    <ProfileTabBody data-testid="instant-book-tab">
      <ProfileTabHeader title={TAB_TITLES.instant_book} onBack={onBack} />
      {floors.isLoading ? (
        <ProfileTabBodyReserve tab="instant_book" />
      ) : floors.isError ? (
        <ErrorState variant="inline" title={rpcErrorMessage("rpc_my_instant_book_floors", floors.error) ?? "We couldn't load your instant book settings."} onRetry={() => void floors.refetch()} />
      ) : (
        <>
          <p className="font-sans text-ds-14 text-muted-foreground px-1" data-instant-book-intro="">
            Let people book you right away. Pick up to {INSTANT_BOOK_MAX_CATEGORIES} kinds of work and the least you&apos;d take for
            each. When a job pays at least that much and you&apos;re free that day, you can show up in the poster&apos;s top 3 with a
            Book now button.
          </p>
          <p className="font-sans text-ds-13 px-1 font-semibold" style={{ color: "hsl(var(--ink-deep))" }} data-instant-book-private="">
            Your lowest price is private. Nobody else ever sees it.
          </p>
          <p className="font-sans text-ds-13 text-muted-foreground px-1">
            If you&apos;re booked, you have 2 hours to decline with no strike. After that, you&apos;re booked.
          </p>

          {rows.length > 0 && (
            <ul className="rounded-2xl overflow-hidden" style={card} aria-label="Your instant book work">
              {rows.map((r) => (
                <li key={r.category} data-instant-floor={r.category} className="flex items-center gap-3 pl-4 pr-2 py-2 min-h-[60px] border-b border-border last:border-b-0">
                  <span className="flex-1 min-w-0">
                    <span className="block font-sans font-semibold text-ds-15 truncate" style={{ color: "hsl(var(--ink-deep))" }}>
                      {JOB_CATEGORY_LABELS[r.category as JobCategory] ?? r.category}
                    </span>
                    <span className="block font-sans text-ds-13 text-muted-foreground">
                      At least ${(r.floor_cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => save.mutate({ category: r.category, cents: null })}
                    disabled={save.isPending}
                    aria-label={`Remove ${JOB_CATEGORY_LABELS[r.category as JobCategory] ?? r.category}`}
                    className="btn-press shrink-0 min-h-11 px-4 rounded-full border text-ds-14 font-semibold text-foreground disabled:opacity-60"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {full ? (
            <p className="font-sans text-ds-13 text-muted-foreground px-1">You&apos;ve picked {INSTANT_BOOK_MAX_CATEGORIES}. Remove one to add another.</p>
          ) : (
            <form
              className="rounded-2xl p-4 space-y-3"
              style={card}
              onSubmit={(e) => {
                e.preventDefault();
                if (!category || !amountOk) return;
                save.mutate({ category, cents: Math.round((amount as number) * 100) });
              }}
            >
              <label className="block font-sans text-ds-14 font-semibold text-foreground" htmlFor="instant-book-category">Kind of work</label>
              <select
                id="instant-book-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as JobCategory | "")}
                className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-ds-15 text-foreground"
              >
                <option value="">Choose one</option>
                {JOB_CATEGORIES.filter((c) => !used.has(c.value)).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <label className="block font-sans text-ds-14 font-semibold text-foreground" htmlFor="instant-book-amount">The least you&apos;d take</label>
              <CurrencyInput
                id="instant-book-amount"
                value={amount}
                onChange={setAmount}
                min={INSTANT_BOOK_FLOOR_MIN_DOLLARS}
                max={INSTANT_BOOK_FLOOR_MAX_DOLLARS}
                placeholder="50.00"
              />
              <p className="font-sans text-ds-12 text-muted-foreground">Between ${INSTANT_BOOK_FLOOR_MIN_DOLLARS} and ${INSTANT_BOOK_FLOOR_MAX_DOLLARS.toLocaleString("en-US")}.</p>
              {error && <p role="alert" className="font-sans text-ds-13" style={{ color: "hsl(var(--destructive))" }}>{error}</p>}
              <Button type="submit" className="w-full" disabled={!category || !amountOk || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </form>
          )}
        </>
      )}
    </ProfileTabBody>
  );
}
