/**
 * GiftCard — /gift-card
 *
 * Renamed from "Pay It Forward" 2026-09-02 (owner: "gift card should be named
 * gift card not pay it forward"). The FEATURE is a gift card — you buy one and
 * a recipient claims it by email — and every user-facing string already said
 * so; only the code and the legacy route still said "pay it forward", which
 * meant the file you had to open to change gift-card behaviour was not the one
 * named after it.
 *
 * `/pay-it-forward` is GONE, route and all. It was kept briefly on the theory
 * that it was the claim URL in gift emails already sent — then checked against
 * prod rather than assumed: `pif_credits` holds 3 rows, all seed, 0 with a
 * claim_token. The feature has never been used for real, so there was no live
 * link to protect. Claim URLs are /gift-card?claim=<token> now
 * (supabase/functions/_shared/pifGiftEmail.ts).
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
import { Check, Gift, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap, functionErrorMessage } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticMedium, hapticSuccess } from "@/lib/haptics";
import { STRIPE_PCT, STRIPE_FLAT_CENTS } from "@/lib/stripeFees";
import { errorToast } from "@/lib/toast";
import { report } from "@/lib/errorLogger";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";
import type { PifCredit } from "./payItForward/types";
import { AMOUNT_PRESETS, MAX_NOTE_LENGTH } from "./payItForward/constants";
import { GIFT_OCCASIONS, DEFAULT_OCCASION, DEFAULT_DESIGN } from "./payItForward/giftCardDesigns";
import { GiftCardPreview } from "./payItForward/GiftCardPreview";
import { CreditCard } from "./payItForward/CreditCard";
import { EmptyState } from "./payItForward/EmptyState";
import { RecipientPicker } from "./payItForward/RecipientPicker";
import type { RecipientMatch } from "./payItForward/RecipientPicker";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";

// Client-side shape check only — the edge function is the authority (it also
// enforces the bounds and the self-gift block server-side). We mirror the
// bounds here so an out-of-range amount is caught in the form rather than
// after a round trip to Stripe Checkout.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_GIFT = 10; // matches MIN_GIFT_CENTS (1000) in create-pif-donation
const MAX_GIFT = 500; // matches MAX_GIFT_CENTS (50000) in create-pif-donation

// ─── Main page ────────────────────────────────────────────────────────────────
export default function GiftCard() {
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
  // Two ways to name a recipient: search by name (default — resolves to
  // `recipient_id`, server-side email resolution in create-pif-donation) or
  // type an email directly (the original flow, unchanged). Exactly one is
  // active at a time.
  const [recipientMode, setRecipientMode] = useState<"search" | "email">("search");
  const [selectedRecipient, setSelectedRecipient] = useState<RecipientMatch | null>(null);
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
  const isSelfGiftEmail = !!myEmail && trimmedRecipient === myEmail;
  // In "search" mode the recipient is a picked profile, not typed text — the
  // RPC already excludes the caller's own row, but guard here too in case a
  // stale selection lingers across a mode switch.
  const isSelfGiftSelected = !!user?.id && selectedRecipient?.user_id === user.id;
  const hasValidRecipient =
    recipientMode === "email" ? emailValid && !isSelfGiftEmail : !!selectedRecipient && !isSelfGiftSelected;

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
        report(e, { tags: { source: "GiftCard.claim" } });
        errorToast("Couldn't claim gift card", {
          description: e instanceof Error ? e.message : "Try again?",
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
        report(e, { severity: "warning", tags: { source: "GiftCard.donated" } });
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
        report(e, { severity: "warning", tags: { source: "GiftCard.received" } });
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
      if (recipientMode === "email") {
        if (!emailValid) throw new Error("Enter a valid email for the person you're gifting.");
        if (isSelfGiftEmail) throw new Error("You can't send a gift card to yourself.");
      } else {
        if (!selectedRecipient) throw new Error("Search for and select who this gift is for.");
        if (isSelfGiftSelected) throw new Error("You can't send a gift card to yourself.");
      }

      const { data, error } = await supabase.functions.invoke("create-pif-donation", {
        body: {
          amount: amt,
          ...(recipientMode === "email"
            ? { recipient_email: trimmedRecipient }
            : { recipient_id: selectedRecipient!.user_id }),
          message: note.trim(),
          occasion: occasionId,
          design_id: design.id,
          native: isNativePlatform,
        },
      });
      if (error) {
        throw new Error(await functionErrorMessage(error, "Couldn't start your gift card. Please try again."));
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Couldn't start your gift card. Please try again.");
      await openExternalUrl(data.url);
    },
    onError: (e) => {
      report(e, { tags: { source: "GiftCard.donate" } });
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
    hasValidRecipient;

  return (
    <AppPage title="Gift Card" backTo="/profile">
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

        {/* SINGLE COLUMN on desktop (owner). Was a 12-col split; both halves
            carry content, so they stack instead of one being dropped. The
            `lg:col-span-*`/`lg:sticky` classes that used to make sense on the
            old 12-col grid were left behind on this now-block-layout wrapper:
            since this page scrolls inside AppShell's internal container
            (AppPage), `position: sticky` still activates in plain block flow
            — it pinned the ENTIRE form (including this preview) at the top
            of the viewport while the "sent to you" / "sent by you" lists
            scrolled up underneath it, reading as everything overlapping the
            card. Removed along with the dead col-span classes. */}
        <div className="space-y-6">
          {/* ── Left rail: context + primary action ─────────────────────────── */}
          <aside className="space-y-6">
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
                Send a Helpr gift card to someone you know. Find them by name or type their email,
                choose an amount, and we'll send them a link to claim it — they can put it toward
                any job they need done.
              </p>
            </div>

            {/* Give a gift form */}
            <div
              data-testid="gift-form"
              className="rounded-2xl p-5 space-y-4"
              style={{
                background:
                  "radial-gradient(circle at 20% 0%, var(--gift-sheen) 0%, transparent 60%), " +
                  "linear-gradient(180deg, hsl(var(--gift-form-from) / 0.92) 0%, hsl(var(--gift-form-to) / 0.74) 100%)",
                border: "0.5px solid hsl(var(--bark) / 0.22)",
                boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.6)",
              }}
            >
              {/* Recipient — search by name (default) or type an email */}
              <RecipientPicker
                selected={selectedRecipient}
                onSelect={setSelectedRecipient}
                onClearSelected={() => setSelectedRecipient(null)}
                mode={recipientMode}
                onModeChange={(m) => {
                  setRecipientMode(m);
                  // Switching modes clears the other mode's half-entered
                  // state so a stale email can't silently ride along with a
                  // freshly-picked recipient (or vice versa).
                  if (m === "search") setRecipientEmail("");
                  else setSelectedRecipient(null);
                }}
                emailValue={recipientEmail}
                onEmailChange={setRecipientEmail}
                emailValid={emailValid}
                isSelfGiftEmail={isSelfGiftEmail}
              />

              {/* Occasion — picking one swaps the design set and the note
                  placeholder, so the choice does real work rather than just
                  tagging the gift.

                  WRAPS at every width. It used to be a masked scroll-rail
                  below `sm`, un-scrollbarred, with the fade its only "there's
                  more" hint — on a 320/375 phone that clipped a chip mid-word
                  at the right edge and hid up to three of the six occasions
                  behind a gesture nothing announced. The desktop half of this
                  component already argued the case ("a hidden one is hidden
                  product") and wrapped from `sm` up; the argument holds on a
                  phone too, and six short labels cost two or three rows. The
                  rail, the mask and the negative gutter go together. */}
              <div>
                <p
                  id="gift-occasion-label"
                  className="font-serif italic text-ds-12 mb-2"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Occasion
                </p>
                <div role="group" aria-labelledby="gift-occasion-label" className="flex flex-wrap gap-2">
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
                        // SELECTED = GLOSSY. `btn-grad-primary` is the app's one
                        // primary surface; this chip painted a flat 15%-bark
                        // tint, the same rule break the review tags and the
                        // withdraw-reason rows already had fixed. The active
                        // `style` sets COLOR ONLY — a `background` shorthand
                        // here would wipe the class's background-image.
                        // px-3 is the app's chip padding (ReviewForm's quick
                        // tags, the filter pills). It also buys a row back at
                        // 320: with px-4 only "Congratulations" and
                        // "Just because" fit alone, giving five rows.
                        className={`min-h-11 px-3 rounded-ds-pill text-ds-12 font-sans font-semibold transition-all duration-150 ease-ds-spring active:scale-[0.97] ${
                          active
                            ? "btn-grad-primary border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
                            : ""
                        }`}
                        style={
                          active
                            ? { color: "hsl(var(--parchment))" }
                            : {
                                background: "var(--surface-premium)",
                                border: "1px solid hsl(var(--bark) / 0.18)",
                                color: "hsl(var(--bark))",
                              }
                        }
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live preview — the sender is choosing an artifact, not filling
                  in a form, so they see exactly what lands in the inbox.
                  Capped to 320px: the preview holds a fixed ISO 7810 aspect
                  ratio, so at the form's full column width (this card is no
                  longer a narrow 5-col rail — see the single-column note
                  above) it grew tall enough to need scrolling to see the
                  amount below it. Capping the width caps the height with it. */}
              {/* `sm:max-w-[420px]`: the 320px cap exists so the ISO-ratio
                  card can't grow tall enough to need scrolling at the form's
                  full column width (704px at 768, 1030px at 1440). At those
                  widths a 320px card left most of the band empty around the
                  screen's stated centrepiece; 420px is still only 265px tall,
                  well inside the fold, and the phone cap is untouched. */}
              <div className="max-w-[320px] sm:max-w-[420px] mx-auto">
                <GiftCardPreview
                  design={design}
                  amount={effectiveAmount || null}
                  note={note}
                  senderName={profile?.full_name ?? null}
                  occasionLabel={occasion.label}
                />
                {/* Card design. Two bare gradient rectangles with no labels and
                    no state beyond a 2px border read as decoration, not as a
                    control — you could not tell what either one was called or
                    which was selected. Each option is now a labelled row: the
                    art stays as a swatch (it IS the thing being chosen), the
                    name is VISIBLE text (so the accessible name comes from the
                    label rather than an aria-label standing in for it —
                    WCAG 2.5.3), and the selected row wears the app's glossy
                    primary surface plus a check, like every other selected
                    control in the app.

                    One column on a phone, two from `sm`: at 320 a two-up grid
                    left ~44px for the name and truncated "Parchment" to
                    "Parch…". */}
                {occasion.designs.length > 1 && (
                  <div className="mt-3">
                    <p
                      id="gift-design-label"
                      className="font-serif italic text-ds-12 mb-2"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Card design
                    </p>
                    <div
                      role="group"
                      aria-labelledby="gift-design-label"
                      className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                    >
                      {occasion.designs.map((d) => {
                        const active = d.id === design.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setDesignId(d.id)}
                            className={`flex items-center gap-2 min-h-11 px-2 py-1.5 rounded-ds-sm text-left transition-all duration-150 ease-ds-spring active:scale-[0.97] ${
                              active
                                ? "btn-grad-primary border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
                                : ""
                            }`}
                            style={
                              active
                                ? undefined
                                : {
                                    background: "var(--surface-premium)",
                                    border: "1px solid hsl(var(--olivewood) / 0.20)",
                                  }
                            }
                          >
                            <span
                              aria-hidden
                              className="w-8 h-8 shrink-0 rounded-md"
                              style={{
                                background: d.background,
                                border: "0.5px solid hsl(var(--ink-deep) / 0.15)",
                              }}
                            />
                            <span
                              className="flex-1 min-w-0 truncate font-sans font-semibold text-ds-12"
                              style={{
                                color: active ? "hsl(var(--parchment))" : "hsl(var(--ink-deep))",
                              }}
                            >
                              {d.label}
                            </span>
                            {active && (
                              <Check
                                className="w-4 h-4 shrink-0"
                                style={{ color: "hsl(var(--parchment))" }}
                                aria-hidden
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Amount.

                  The presets and the custom field used to share ONE flex row of
                  four equal tiles: $25 / $50 / $75 / a bare unlabelled
                  <input type=number>. Empty — which is its default state — the
                  fourth tile rendered as a blank box the same size and shape as
                  the three priced ones, so it read as a preset that had failed
                  to render rather than as "type your own". Its only name was an
                  aria-label, invisible to everyone not using a screen reader.
                  So: three presets in their own grid, then the custom field on
                  its own full-width row under a REAL <label> (visible text, and
                  the accessible name derives from it rather than an aria-label
                  standing in for it — WCAG 2.5.3), with a persistent "$" so it
                  reads in the same units as the tiles above.

                  State is unchanged: picking a preset clears the custom field,
                  typing in the custom field clears the preset, and
                  `effectiveAmount` still resolves the same way. */}
              <div>
                <p
                  id="gift-amount-label"
                  className="font-serif italic text-ds-12 mb-2"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Amount
                </p>
                <div role="group" aria-labelledby="gift-amount-label" className="grid grid-cols-3 gap-2">
                  {AMOUNT_PRESETS.map((amt) => {
                    const active = selectedAmount === amt;
                    return (
                      <button
                        key={amt}
                        type="button"
                        aria-pressed={active}
                        onClick={() => { setSelectedAmount(amt); setCustomAmount(""); }}
                        // SELECTED = GLOSSY, like every other selected control.
                        // The active `style` sets COLOR ONLY: a `background`
                        // shorthand would wipe btn-grad-primary's image.
                        className={`min-h-11 px-2 rounded-ds-sm text-ds-13 font-sans font-semibold transition-all duration-150 ease-ds-spring active:scale-[0.97] ${
                          active
                            ? "btn-grad-primary border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
                            : ""
                        }`}
                        style={
                          active
                            ? { color: "hsl(var(--parchment))" }
                            : {
                                background: "var(--surface-premium)",
                                border: "1px solid hsl(var(--bark) / 0.18)",
                                color: "hsl(var(--bark))",
                              }
                        }
                      >
                        ${amt}
                      </button>
                    );
                  })}
                </div>

                <label
                  htmlFor="gift-custom-amount"
                  className="block font-serif italic text-ds-12 mt-3 mb-1.5"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Or enter a custom amount
                </label>
                <div className="relative">
                  <span
                    aria-hidden
                    className="absolute left-3 top-1/2 -translate-y-1/2 font-sans font-semibold text-ds-13 pointer-events-none"
                    style={{ color: "hsl(var(--bark) / 0.7)" }}
                  >
                    $
                  </span>
                  <input
                    id="gift-custom-amount"
                    type="number"
                    inputMode="decimal"
                    min={MIN_GIFT}
                    max={MAX_GIFT}
                    aria-invalid={amountTooLarge || undefined}
                    aria-describedby="gift-amount-help"
                    value={customAmount}
                    onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                    className="w-full min-h-11 py-2 pl-7 pr-3 rounded-ds-sm text-ds-13 font-sans font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    style={{
                      background: customAmount ? "hsl(var(--bark) / 0.10)" : "var(--surface-premium)",
                      border: amountTooLarge
                        ? "1px solid hsl(var(--burnt-sienna) / 0.55)"
                        : `1px solid hsl(var(--bark) / ${customAmount ? "0.40" : "0.18"})`,
                      color: "hsl(var(--bark))",
                      // No `outline: "none"`. An INLINE outline:none beats the
                      // global `:focus-visible { outline: 2px solid … }` rule,
                      // so this field had no visible keyboard focus at all.
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
                  id="gift-amount-help"
                  className="font-serif italic text-ds-11 mt-1.5"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  ${MIN_GIFT}–${MAX_GIFT} per gift card. A card-processing fee ({(STRIPE_PCT * 100).toFixed(1)}% + {STRIPE_FLAT_CENTS}¢) is added at checkout.
                </p>
              </div>

              {/* Personal note */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  {/* A real <label>, not an aria-label. The aria-label read
                      "Personal note (optional)" while the visible text read
                      "Personal note — optional": an accessible name that does
                      not contain its own visible label is a WCAG 2.5.3 failure,
                      and voice control ("click Personal note — optional")
                      misses it. Associating the visible text is both correct
                      and one fewer string to keep in sync. */}
                  <label
                    htmlFor="gift-note"
                    className="font-serif italic text-ds-12"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    Personal note — optional
                  </label>
                  <span
                    className="font-sans tabular-nums text-ds-11"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {note.length}/{MAX_NOTE_LENGTH}
                  </span>
                </div>
                <Textarea
                  id="gift-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
                  placeholder={occasion.notePlaceholder}
                  rows={2}
                  maxLength={MAX_NOTE_LENGTH}
                  className="rounded-ds-sm bg-background/60 border-border/60 font-serif italic text-ds-13 leading-relaxed"
                />
              </div>

              {/* Submit.

                  No inline `background` any more. The <Button> default variant
                  IS the app's glossy primary surface (`btn-grad-primary` — see
                  button.tsx), and a `background` shorthand in an inline style
                  wins the cascade AND resets `background-image`, so this CTA
                  was painting a flat bark fill over the gradient — the exact
                  failure PhotoProof.tsx documents. Disabled state comes from the
                  primitive's own `disabled:opacity-50` rather than a hand-mixed
                  15%-tint, so it dims like every other disabled CTA in the app
                  instead of turning into a different-looking control. */}
              <Button
                onClick={handleDonate}
                disabled={!canDonate || donateMutation.isPending}
                className="w-full font-display italic font-semibold"
              >
                <Gift aria-hidden />
                {donateMutation.isPending ? "Starting Checkout…" : "Continue to Checkout"}
              </Button>
            </div>
          </aside>

          {/* ── Right pane: gift listings ──────────────────────────────────────
              No `pb-8` here: AppPage's scroll column already carries the
              canonical bottom-nav clearance (safe-area + 96px dock + 1rem), and
              a second per-page pad is the double-inset CLAUDE.md warns about —
              it only adds dead space under the last card. */}
          <section className="space-y-6">
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
    </AppPage>
  );
}
