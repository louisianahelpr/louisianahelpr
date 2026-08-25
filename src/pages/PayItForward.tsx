/**
 * Pay It Forward — /pay-it-forward
 *
 * Document-scroll page (PageHeader + min-h-screen).
 *
 * Directed-gift model: a donor NAMES a recipient by email and pays Stripe up
 * front; only that person can redeem. There is no public "browse credits near
 * you" pool — every gift is directed. All mint/claim/redeem flow through
 * service-role edge functions (the client can no longer write pif_credits), so
 * this page:
 *   - launches Stripe Checkout via `create-pif-donation` (never inserts a row),
 *   - lists gifts sent TO the current user (matched by resolved id OR the named
 *     email, since an unclaimed gift is visible to its named address via RLS),
 *   - redeems by navigating to Post-a-Job with the credit id (the actual
 *     redemption + $0/difference math happens server-side at checkout).
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap, functionErrorMessage } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticMedium, hapticSuccess } from "@/lib/haptics";
import { STRIPE_PCT, STRIPE_FLAT_CENTS } from "@/lib/stripeFees";
import { errorToast } from "@/lib/toast";
import { report } from "@/lib/errorLogger";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";
import type { PifCredit } from "./payItForward/types";
import { AMOUNT_PRESETS, MAX_NOTE_LENGTH } from "./payItForward/constants";
import { GIFT_OCCASIONS, DEFAULT_OCCASION, DEFAULT_DESIGN } from "./payItForward/giftCardDesigns";
import { GiftCardPreview } from "./payItForward/GiftCardPreview";
import { CreditCard } from "./payItForward/CreditCard";
import { EmptyState } from "./payItForward/EmptyState";

// Client-side shape check only — the edge function is the authority (it also
// enforces the bounds and the self-gift block server-side). We mirror the
// bounds here so an out-of-range amount is caught in the form rather than
// after a round trip to Stripe Checkout.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_GIFT = 10; // matches MIN_GIFT_CENTS (1000) in create-pif-donation
const MAX_GIFT = 500; // matches MAX_GIFT_CENTS (50000) in create-pif-donation

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PayItForward() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  usePageTitle("Gift Card — Helpr");

  const { user, profile, isLoading: authLoading } = useCurrentUser();
  const myEmail = user?.email?.toLowerCase() ?? "";
  const queryClient = useQueryClient();

  // ── Claim state (?claim=<token> cold-start from the emailed gift link) ─────
  const [claiming, setClaiming] = useState(false);
  // Fire the claim exactly once per token — the effect re-runs as auth settles
  // and as we strip the param, so a ref (not just the param) gates it.
  const claimedTokenRef = useRef<string | null>(null);

  // ── Give a gift form state ────────────────────────────────────────────────
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [note, setNote] = useState("");
  // Occasion drives which designs are offered and what the note placeholder
  // suggests; design is what the recipient actually sees. Both persist on the
  // credit row, so a card looks the same when opened as when it was sent.
  const [occasionId, setOccasionId] = useState<string>(DEFAULT_OCCASION.id);
  const [designId, setDesignId] = useState<string>(DEFAULT_DESIGN.id);
  const occasion = GIFT_OCCASIONS.find((o) => o.id === occasionId) ?? DEFAULT_OCCASION;
  const design = occasion.designs.find((d) => d.id === designId) ?? occasion.designs[0];

  const effectiveAmount = selectedAmount ?? (customAmount ? parseFloat(customAmount) : null);
  const trimmedRecipient = recipientEmail.trim().toLowerCase();
  const emailValid = EMAIL_RE.test(trimmedRecipient);
  const isSelfGift = !!myEmail && trimmedRecipient === myEmail;

  // ── Stripe return handling (?gift=success | ?gift=cancelled) ───────────────
  useEffect(() => {
    const gift = searchParams.get("gift");
    if (gift === "cancelled") {
      toast("Gift cancelled", { description: "No charge was made." });
    }
    if (gift) {
      searchParams.delete("gift");
      setSearchParams(searchParams, { replace: true });
    }
    // Only react to the param on mount / when it changes.
  }, [searchParams, setSearchParams]);

  // ── Claim a directed gift (?claim=<token>) ────────────────────────────────
  // The donor's email carried a claim link. This route is ProtectedRoute-
  // wrapped, so an unauthenticated visitor is bounced to /login?redirect=…
  // and returns here signed in — by the time this fires, `user` is the caller
  // who should own the gift. The edge function is the authority: it enforces
  // the email-match guard, idempotency, and the race-safe atomic bind; we just
  // surface its verdict.
  useEffect(() => {
    const claimToken = searchParams.get("claim");
    if (!claimToken) return;
    // Wait for the session to resolve — on a cold start `user` is briefly null
    // while ProtectedRoute settles; acting now would misread "not signed in".
    if (authLoading || !user?.id) return;
    // Exactly-once per token.
    if (claimedTokenRef.current === claimToken) return;
    claimedTokenRef.current = claimToken;

    void (async () => {
      setClaiming(true);
      try {
        const { data, error } = await supabase.functions.invoke("claim-pif-credit", {
          body: { claim_token: claimToken },
        });
        if (error) {
          throw new Error(await functionErrorMessage(error, "Couldn't claim this gift. Please try again."));
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.ok) throw new Error("Couldn't claim this gift. Please try again.");

        hapticSuccess();
        // Surface the freshly-attached credit in the received list.
        await queryClient.invalidateQueries({ queryKey: ["pif-received"] });
      } catch (e) {
        report(e, { tags: { source: "PayItForward.claim" } });
        errorToast("Couldn't claim gift card", {
          description: e instanceof Error ? e.message : "Please try again.",
        });
      } finally {
        setClaiming(false);
        // Strip ?claim so a refresh / back-nav doesn't replay it.
        searchParams.delete("claim");
        setSearchParams(searchParams, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams, authLoading, user?.id, queryClient]);

  // ── Queries ───────────────────────────────────────────────────────────────
  // isError is load-bearing on both lists: these are real, paid gift cards.
  // A failed fetch collapses to [] and would otherwise render the "nothing
  // here yet" empty state — telling someone their unredeemed money doesn't
  // exist. A failure must read as a failure, with a way back.
  const {
    data: myDonated = [],
    isLoading: loadingDonated,
    isError: donatedFailed,
    isFetching: donatedFetching,
    refetch: refetchDonated,
  } = useQuery({
    queryKey: ["pif-donated", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const rows = unwrap(
          await supabase
            .from("pif_credits" as never)
            .select("*")
            .eq("donor_id", user.id)
            .order("created_at", { ascending: false }),
        ) as PifCredit[];
        return rows;
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("PGRST202")) return [];
        report(e, { severity: "warning", tags: { source: "PayItForward.donated" } });
        throw e;
      }
    },
    enabled: !!user?.id,
  });

  // Gifts sent TO me — matched by resolved recipient_id OR my named email, since
  // a gift I haven't claimed yet has recipient_id = null but is visible to my
  // email via RLS. Newest first.
  const {
    data: myReceived = [],
    isLoading: loadingReceived,
    isError: receivedFailed,
    isFetching: receivedFetching,
    refetch: refetchReceived,
  } = useQuery({
    queryKey: ["pif-received", user?.id, myEmail],
    queryFn: async () => {
      if (!user?.id) return [];
      // Quote the email value so a reserved char in the local-part (`,` `.` `(`
      // `)`) can't break the PostgREST .or() grammar. user.id is a UUID, so it
      // needs no quoting. RLS still constrains rows regardless.
      const orClause = myEmail
        ? `recipient_id.eq.${user.id},recipient_email.eq."${myEmail.replace(/(["\\])/g, "\\$1")}"`
        : `recipient_id.eq.${user.id}`;
      try {
        const rows = unwrap(
          await supabase
            .from("pif_credits" as never)
            .select("*")
            .or(orClause)
            .order("created_at", { ascending: false }),
        ) as PifCredit[];

        // Attach the donor's display name for the "from {name}" subline. We can't
        // embed it via PostgREST — pif_credits.donor_id FKs to auth.users (no
        // full_name, auth schema isn't embeddable), which 400s the whole request
        // and silently hides every gift from its recipient. So resolve names in a
        // separate, non-load-bearing profiles lookup keyed by user_id = donor_id.
        // A failure here leaves the cosmetic name null (CreditCard shows "A
        // neighbor") but never drops the gifts themselves.
        const donorIds = [...new Set(rows.map((r) => r.donor_id).filter(Boolean))];
        if (donorIds.length > 0) {
          try {
            const donors = unwrap(
              await supabase
                .from("profiles")
                .select("user_id, full_name")
                .in("user_id", donorIds),
            ) as Array<{ user_id: string; full_name: string | null }>;
            const nameById = new Map(donors.map((d) => [d.user_id, d.full_name]));
            return rows.map((r) => ({
              ...r,
              donor: { full_name: nameById.get(r.donor_id) ?? null },
            }));
          } catch {
            // Name lookup is cosmetic — never let it hide the gifts.
            return rows;
          }
        }
        return rows;
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("PGRST202")) return [];
        report(e, { severity: "warning", tags: { source: "PayItForward.received" } });
        throw e;
      }
    },
    enabled: !!user?.id,
  });

  // ── Donate mutation — launches Stripe Checkout, never writes the row ───────
  const donateMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Please sign in to send a gift card.");
      const amt = effectiveAmount;
      if (!amt || isNaN(amt) || amt < MIN_GIFT) throw new Error(`The smallest gift card is $${MIN_GIFT}.`);
      if (amt > MAX_GIFT) throw new Error(`The largest single gift card is $${MAX_GIFT}.`);
      if (!emailValid) throw new Error("Enter a valid email for the person you're gifting.");
      if (isSelfGift) throw new Error("You can't send a gift card to yourself.");

      const { data, error } = await supabase.functions.invoke("create-pif-donation", {
        body: {
          amount: amt,
          recipient_email: trimmedRecipient,
          message: note.trim(),
          occasion: occasionId,
          design_id: design.id,
        },
      });
      if (error) {
        throw new Error(await functionErrorMessage(error, "Couldn't start your gift card. Please try again."));
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Couldn't start your gift card. Please try again.");
      window.location.href = data.url;
    },
    onError: (e) => {
      report(e, { tags: { source: "PayItForward.donate" } });
      errorToast("Couldn't send gift card", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    },
  });

  const handleDonate = () => {
    hapticMedium();
    donateMutation.mutate();
  };

  // Redeem = navigate to Post-a-Job carrying the credit. The redemption itself
  // (marking it redeemed, the $0/difference math) is settled server-side at
  // checkout by create-payment — the client can no longer write the row.
  const handleUseGift = (creditId: string) => {
    hapticMedium();
    const credit = myReceived.find((c) => c.id === creditId);
    const budget = credit?.amount ?? 0;
    navigate(`/post-job?budget=${budget}&pif_credit=${creditId}`);
  };

  const amountTooLarge = effectiveAmount != null && !isNaN(effectiveAmount) && effectiveAmount > MAX_GIFT;

  const canDonate =
    !!effectiveAmount &&
    effectiveAmount >= MIN_GIFT &&
    effectiveAmount <= MAX_GIFT &&
    !isNaN(effectiveAmount) &&
    emailValid &&
    !isSelfGift;

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* Geometry is the CANONICAL Profile sub-screen ladder, shared verbatim
          with the Profile tab bodies (Profile.tsx) and PageHeader's `default`
          width. The header used to declare `width="2xl-5xl-7xl"` against a
          body that had already moved to the wide ladder, so the title sat in
          a different column from the content underneath it. `onBack` went to
          `navigate(-1)`, which is a dead end when the page is opened straight
          from an emailed claim link; every sibling returns to /profile. */}
      <PageHeader
        title="Gift Card"
        backTo="/profile"
      />

      <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8">
        {/* ── Claiming a gift (from the emailed claim link) ─────────────────── */}
        {/* Spans full width above the split so the status is visible regardless
            of which column the eye lands on first. */}
        {claiming && (
          <div
            className="rounded-ds-md p-4 flex items-center gap-3 mb-6"
            style={{
              background: "hsl(var(--gift-tint) / 0.06)",
              border: "0.5px solid hsl(var(--gift-tint) / 0.18)",
            }}
          >
            <div
              className="w-4 h-4 shrink-0 rounded-full border-2 border-t-transparent motion-safe:animate-spin"
              style={{ borderColor: "hsl(var(--success-ink))", borderTopColor: "transparent" }}
            />
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--gift-ink))" }}>
              Claiming your gift card…
            </p>
          </div>
        )}

        {/* Desktop splits into a sticky context/action rail on the left and the
            gift history listings on the right. Mobile stays a single stacked
            column — the grid degrades to grid-cols-1 below lg. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 xl:gap-12 items-start">
          {/* ── Left rail: context + primary action ─────────────────────────── */}
          <aside className="lg:col-span-5 xl:col-span-4 space-y-6 lg:sticky lg:top-6 lg:self-start">
            {/* What is this? */}
            {/* Card radius + padding are the canonical profile-card values
                (`rounded-2xl … p-5`). Only the FILL stays gift-tinted — the
                bespoke `rounded-ds-md p-4` box these used made the screen read
                as a different app than the tabs it is opened from. */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: "hsl(var(--gift-tint) / 0.06)",
                border: "0.5px solid hsl(var(--gift-tint) / 0.18)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--success-ink))" }} />
                <p
                  className="font-sans font-semibold text-ds-14"
                  style={{ color: "hsl(var(--gift-ink))" }}
                >
                  What is this?
                </p>
              </div>
              <p
                className="font-serif italic text-ds-13 leading-relaxed"
                style={{ color: "hsl(var(--ink-deep) / 0.75)" }}
              >
                Send a Helpr gift card to someone you know. Enter their email, choose an amount, and
                we'll send them a link to claim it — they can put it toward any job they need done.
              </p>
            </div>

            {/* Give a gift form */}
            <div
              className="rounded-2xl p-5 space-y-4"
              style={{
                background:
                  "radial-gradient(circle at 20% 0%, var(--gift-sheen) 0%, transparent 60%), " +
                  "linear-gradient(180deg, hsl(var(--gift-form-from) / 0.92) 0%, hsl(var(--gift-form-to) / 0.74) 100%)",
                border: "0.5px solid hsl(var(--bark) / 0.22)",
                boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.6)",
              }}
            >
              {/* Recipient email */}
              <div>
                <p
                  className="font-serif italic text-ds-12 mb-2"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Recipient's email
                </p>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  aria-label="Recipient's email"
                  className="w-full rounded-ds-sm py-2 px-3 text-ds-13 font-sans"
                  style={{
                    background: "hsl(var(--parchment) / 0.6)",
                    border: `0.5px solid hsl(var(--bark) / ${recipientEmail && !emailValid ? "0.4" : "0.22"})`,
                    color: "hsl(var(--ink-deep))",
                    outline: "none",
                  }}
                />
                {recipientEmail.trim() && !emailValid && (
                  <p
                    className="font-serif italic text-ds-11 mt-1.5"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  >
                    Enter a valid email address.
                  </p>
                )}
                {isSelfGift && (
                  <p
                    className="font-serif italic text-ds-11 mt-1.5"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  >
                    You can't send a gift to yourself.
                  </p>
                )}
              </div>

              {/* Occasion — a horizontal chip rail. Picking one swaps the
                  design set and the note placeholder, so the choice does real
                  work rather than just tagging the gift. */}
              <div>
                <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Occasion
                </p>
                {/* Scroll-rail on phone, wrapped grid from sm up. The rail's
                    fade mask is the only "there's more" affordance, and it has
                    no scrollbar — fine under a thumb, but on desktop it hid 3
                    of the 6 occasions behind a gesture, clipped mid-word, while
                    the column beside it sat empty. Each occasion swaps the card
                    art AND the note placeholder, so a hidden one is hidden
                    product. sm:flex-wrap drops the rail, the mask and the
                    negative gutter together. */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1 [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] sm:flex-wrap sm:overflow-x-visible sm:mx-0 sm:px-0 sm:[-webkit-mask-image:none] sm:[mask-image:none]">
                  {GIFT_OCCASIONS.map((o) => {
                    const active = o.id === occasionId;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setOccasionId(o.id);
                          // Reset to that occasion's first design — keeping a
                          // design from the previous occasion would show a
                          // birthday cake on a sympathy card.
                          setDesignId(o.designs[0].id);
                        }}
                        className="shrink-0 px-3 h-9 rounded-ds-pill text-ds-12 font-sans font-semibold transition-colors"
                        style={{
                          background: active ? "hsl(var(--bark) / 0.15)" : "transparent",
                          border: `1px solid hsl(var(--bark) / ${active ? "0.40" : "0.18"})`,
                          color: "hsl(var(--bark))",
                        }}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live preview — the sender is choosing an artifact, not filling
                  in a form, so they see exactly what lands in the inbox. */}
              <div>
                <GiftCardPreview
                  design={design}
                  amount={effectiveAmount || null}
                  note={note}
                  senderName={profile?.full_name ?? null}
                />
                {occasion.designs.length > 1 && (
                  <div className="flex gap-2 mt-3">
                    {occasion.designs.map((d) => {
                      const active = d.id === design.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          aria-label={`${d.label} design`}
                          aria-pressed={active}
                          onClick={() => setDesignId(d.id)}
                          className="flex-1 h-10 rounded-ds-sm transition-transform active:scale-95"
                          style={{
                            background: d.background,
                            border: active
                              ? "2px solid hsl(var(--bark))"
                              : "0.5px solid hsl(var(--olivewood) / 0.20)",
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Amount chips */}
              <div>
                <p
                  className="font-serif italic text-ds-12 mb-2"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Amount
                </p>
                <div className="flex gap-2 flex-wrap">
                  {AMOUNT_PRESETS.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => { setSelectedAmount(amt); setCustomAmount(""); }}
                      className="flex-1 py-2 rounded-ds-sm text-ds-13 font-sans font-semibold transition-colors"
                      style={{
                        background: selectedAmount === amt ? "hsl(var(--bark) / 0.15)" : "transparent",
                        border: `1px solid hsl(var(--bark) / ${selectedAmount === amt ? "0.4" : "0.18"})`,
                        color: "hsl(var(--bark))",
                      }}
                    >
                      ${amt}
                    </button>
                  ))}
                  <input
                    type="number"
                    aria-label="Custom gift amount in dollars"
                    min={MIN_GIFT}
                    max={MAX_GIFT}
                    value={customAmount}
                    onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                    className="flex-1 py-2 px-3 rounded-ds-sm text-ds-13 font-sans font-semibold text-center"
                    style={{
                      background: customAmount ? "hsl(var(--bark) / 0.10)" : "transparent",
                      border: amountTooLarge
                        ? "1px solid hsl(var(--burnt-sienna) / 0.55)"
                        : `1px solid hsl(var(--bark) / ${customAmount ? "0.40" : "0.18"})`,
                      color: "hsl(var(--bark))",
                      outline: "none",
                      minWidth: 0,
                    }}
                  />
                </div>
                {amountTooLarge && (
                  <p
                    className="font-serif italic text-ds-11 mt-1.5"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  >
                    The largest single gift card is ${MAX_GIFT}.
                  </p>
                )}
                <p
                  className="font-serif italic text-ds-11 mt-1.5"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  ${MIN_GIFT}–${MAX_GIFT} per gift card. A card-processing fee ({(STRIPE_PCT * 100).toFixed(1)}% + {STRIPE_FLAT_CENTS}¢) is added at checkout.
                </p>
              </div>

              {/* Personal note */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p
                    className="font-serif italic text-ds-12"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    Personal note — optional
                  </p>
                  <span
                    className="font-sans tabular-nums text-ds-11"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {note.length}/{MAX_NOTE_LENGTH}
                  </span>
                </div>
                <Textarea
                  aria-label="Personal note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
                  placeholder={occasion.notePlaceholder}
                  rows={2}
                  maxLength={MAX_NOTE_LENGTH}
                  className="rounded-ds-sm bg-background/60 border-border/60 font-serif italic text-ds-13 leading-relaxed"
                />
              </div>

              {/* Submit */}
              <Button
                onClick={handleDonate}
                disabled={!canDonate || donateMutation.isPending}
                className="w-full rounded-ds-sm font-display italic font-semibold"
                style={{
                  background: canDonate ? "hsl(var(--success-ink))" : "hsl(var(--bark) / 0.15)",
                  color: canDonate ? "hsl(var(--parchment))" : "hsl(var(--bark) / 0.5)",
                  border: "none",
                }}
              >
                <Gift className="w-4 h-4 mr-2" />
                {donateMutation.isPending ? "Starting Checkout…" : "Continue to Checkout"}
              </Button>
            </div>
          </aside>

          {/* ── Right pane: gift listings ────────────────────────────────────── */}
          <section className="lg:col-span-7 xl:col-span-8 space-y-6 pb-8">
            {/* Gifts sent to you */}
            <div>
              <p className="text-ds-13 font-sans font-semibold mb-3" style={{ color: "hsl(var(--ink-deep))" }}>
                Gift cards sent to you
              </p>
              {loadingReceived ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="rounded-ds-md h-24 motion-safe:animate-pulse"
                      style={{ background: "hsl(var(--olivewood) / 0.07)" }}
                    />
                  ))}
                </div>
              ) : receivedFailed ? (
                <div className="flex">
                  <ErrorState
                    variant="inline"
                    title="We couldn't load your gift cards."
                    body="Any gift card sent to you is still yours — we just couldn't reach it right now. Tap Try again."
                    onRetry={() => void refetchReceived()}
                    retryDisabled={receivedFetching}
                  />
                </div>
              ) : myReceived.length === 0 ? (
                <EmptyState message="When someone sends you a Helpr gift card, it'll show up here." />
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {myReceived.map((credit) => (
                    <CreditCard
                      key={credit.id}
                      credit={credit}
                      perspective="received"
                      onRedeem={handleUseGift}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Gifts you've sent */}
            <div>
              <p className="text-ds-13 font-sans font-semibold mb-3" style={{ color: "hsl(var(--ink-deep))" }}>
                Gift cards you've sent
              </p>
              {loadingDonated ? (
                <div
                  className="rounded-ds-md h-16 motion-safe:animate-pulse"
                  style={{ background: "hsl(var(--olivewood) / 0.07)" }}
                />
              ) : donatedFailed ? (
                <div className="flex">
                  <ErrorState
                    variant="inline"
                    title="We couldn't load the gift cards you've sent."
                    body="Nothing was lost — we just couldn't reach your gift history. Tap Try again."
                    onRetry={() => void refetchDonated()}
                    retryDisabled={donatedFetching}
                  />
                </div>
              ) : myDonated.length === 0 ? (
                <EmptyState message="Gift cards you send will appear here." />
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {myDonated.map((credit) => (
                    <CreditCard key={credit.id} credit={credit} perspective="sent" />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
