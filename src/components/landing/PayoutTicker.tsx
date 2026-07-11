import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { useReducedMotion } from "@/lib/accessibility";
import { queryKeys } from "@/lib/queryKeys";

/**
 * PayoutTicker — thin one-line social-proof strip showing recent
 * platform payouts on anonymous marketing surfaces (issue #87).
 *
 * Each line reads like
 *   "Maria S. earned $47 in Baton Rouge · 2 min ago"
 * and auto-rotates every ROTATE_MS through up to 10 recent payouts
 * pulled from the public `get_recent_public_payouts()` RPC.
 *
 * Privacy: the RPC redacts the helper name to "First L." IN SQL
 * (see migration 20260520204942_redact_public_payout_names.sql) and
 * returns it as `display_name`. The client renders that value as-is
 * — no raw `full_name` ever crosses the wire to an anonymous caller.
 * Older callers / pre-migration deploys still emit `full_name`; we
 * fall back to client-side `formatName()` so the ticker survives the
 * window between merging the migration and `supabase db push`.
 *
 * Hidden states (renders `null` so the page lays out as if absent):
 *   - the RPC isn't deployed yet (PGRST202) — between merging the
 *     migration and `supabase db push` running in prod, we don't
 *     want the ticker to crash or flash an empty marquee.
 *   - the RPC returned zero rows (cold start, post-pause, etc.).
 *   - the supabase chunk hasn't resolved yet (first paint).
 *
 * Motion:
 *   - rotates every ROTATE_MS, pausing on hover/focus so a reader
 *     can finish the entry that interested them.
 *   - respects `prefers-reduced-motion`: skips the slide+fade entry
 *     transition AND freezes the rotation on the first entry (a
 *     reduced-motion user gets one snapshot of social proof, not a
 *     ticker that updates under them).
 *
 * Accessibility:
 *   - `aria-live="off"` on the visible row: announcing every 4 s
 *     would be hostile to AT users. Instead we render an offscreen
 *     summary the first time data loads ("Recent activity: N payouts
 *     in the last 14 days") so the social proof is conveyed once,
 *     non-interruptively. The visible ticker carries `aria-hidden`.
 */

// The post-redaction RPC returns `display_name` (already redacted to
// "First L." in SQL). `full_name` is kept optional so the client still
// renders correctly against the OLD function definition during the
// brief window between merging the new migration and `supabase db push`
// landing it in prod — see the resolver below.
type PayoutRow = {
  display_name?: string | null;
  full_name?: string | null;
  amount_dollars: number;
  city: string | null;
  paid_at: string;
};

const ROTATE_MS = 4000;
const MAX_ROWS = 10;

// Best-effort dollar formatter — payout_transfers amounts are
// always USD on this platform, so Intl.NumberFormat with currency:
// "USD" + maximumFractionDigits: 0 yields "$47" cleanly.
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const PayoutTicker = () => {
  const reduceMotion = useReducedMotion();

  const { data: rows } = useQuery<PayoutRow[]>({
    queryKey: queryKeys.publicPayouts.ticker(),
    queryFn: async () => {
      // Use a typed-as-any handle so this compiles regardless of
      // whether `supabase/types.ts` has been regenerated against the
      // new RPC yet. The runtime contract is enforced by the RPC.
      const { data, error } = await (supabase.rpc as any)(
        "get_recent_public_payouts",
        { _limit: MAX_ROWS },
      );
      if (error) {
        // PGRST202 ("function not found") is the expected state
        // between merging this PR and the manual `supabase db push`
        // landing in prod. Treat as empty so the ticker hides
        // silently instead of throwing.
        if (String(error?.code ?? "") === "PGRST202") return [];
        throw error;
      }
      return (data as PayoutRow[] | null) ?? [];
    },
    // 60 s stale window — the ticker is a "real activity is happening"
    // signal, not a real-time feed, so we don't need to refetch on
    // every focus. Saves the public landing surface a query per nav.
    staleTime: 60_000,
    // Keep the query quiet on error: no retries (the RPC is either
    // deployed or not — retrying won't help), no error toasts.
    retry: false,
  });

  const payouts = useMemo(
    () => (rows ?? []).filter((r) => r && typeof r.amount_dollars === "number"),
    [rows],
  );

  // Index of the currently-visible payout. Initialized at 0 and
  // wraps via modulo against payouts.length on each tick.
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Reset the cursor if the data shrinks underneath us (e.g. an
  // initial fetch returns 10 then a refetch returns 3 — the old
  // index would point past the end of the new array).
  useEffect(() => {
    if (payouts.length > 0 && index >= payouts.length) setIndex(0);
  }, [payouts.length, index]);

  // Rotate. Skipped entirely when reduced motion is preferred OR the
  // user is hovering/focused on the ticker OR there's <2 entries to
  // rotate between (rotation through a single item is just a flash).
  useEffect(() => {
    if (reduceMotion || paused) return;
    if (payouts.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % payouts.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion, paused, payouts.length]);

  // Hide entirely when no data — don't render an empty marquee.
  if (payouts.length === 0) return null;

  const current = payouts[Math.min(index, payouts.length - 1)];
  // Prefer the SQL-redacted `display_name` (post-migration). Fall back to
  // client-side `formatName(full_name)` for the pre-deploy window when the
  // old function definition is still live and only emits `full_name`.
  const firstLast =
    (current.display_name ?? "").trim() !== ""
      ? (current.display_name as string)
      : formatName(current.full_name, "Someone");
  const amount = dollars.format(current.amount_dollars);
  const city = (current.city ?? "").trim();
  // formatDistanceToNow throws on invalid date strings; we guard so a
  // bad row doesn't take the whole ticker down. The catch arm intentionally
  // leaves `relative` empty so the suffix span just doesn't render.
  let relative: string;
  try {
    relative = formatDistanceToNow(new Date(current.paid_at), { addSuffix: true });
  } catch {
    relative = "";
  }

  return (
    <div
      className="w-full flex justify-center px-4 py-6 sm:py-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Visible row — aria-hidden so screen readers don't get a
          chatty 4-second update loop. The offscreen <span> below
          conveys the same social-proof signal once, non-disruptively. */}
      <div
        aria-hidden="true"
        className="liquid-glass inline-flex items-center gap-2.5 max-w-full px-5 py-2.5 rounded-full"
        style={{
          color: "hsl(var(--ink-deep))",
          fontFamily: "Montserrat, system-ui, sans-serif",
          fontSize: "0.78rem",
          letterSpacing: "0.005em",
          minHeight: 32,
        }}
      >
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            backgroundColor: "hsl(var(--burnt-sienna))",
            boxShadow: "0 0 6px hsl(var(--burnt-sienna) / 0.55)",
          }}
        />
        {/* The text row keys on index so React re-mounts the inner
            span on each tick, replaying the subtle slide-up + fade.
            With reduced motion we drop the animation class — the
            key change still re-mounts, but instantly. */}
        <span
          key={index}
          className={
            reduceMotion
              ? "min-w-0 truncate"
              : "min-w-0 truncate animate-in fade-in slide-in-from-bottom-1 duration-500"
          }
        >
          <span style={{ fontWeight: 600 }}>{firstLast}</span>{" "}
          <span style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            earned{" "}
          </span>
          <span style={{ fontWeight: 600, color: "hsl(var(--burnt-sienna))" }}>
            {amount}
          </span>
          {city ? (
            <>
              <span style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
                {" "}in{" "}
              </span>
              <span>{city}</span>
            </>
          ) : null}
          {relative ? (
            <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {" "}· {relative}
            </span>
          ) : null}
        </span>
      </div>

      {/* Offscreen summary — announced once when the data lands so
          AT users get the social-proof signal without the rotation
          noise. `sr-only` is the project-wide visually-hidden utility. */}
      <span className="sr-only" aria-live="polite">
        Recent platform activity: {payouts.length}{" "}
        {payouts.length === 1 ? "payout" : "payouts"} in the last 14 days.
      </span>
    </div>
  );
};

export default PayoutTicker;
