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
import { errorToast } from "@/lib/toast";
import { report } from "@/lib/errorLogger";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PifCredit } from "./payItForward/types";
import { AMOUNT_PRESETS, CATEGORIES, MAX_NOTE_LENGTH } from "./payItForward/constants";
import { CreditCard } from "./payItForward/CreditCard";
import { EmptyState } from "./payItForward/EmptyState";

// Client-side shape check only — the edge function is the authority (it also
// enforces the $10–$500 bounds and the self-gift block server-side).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_GIFT = 10; // matches MIN_GIFT_CENTS in create-pif-donation

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PayItForward() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  usePageTitle("Pay It Forward — Helpr");

  const { user, isLoading: authLoading } = useCurrentUser();
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
  const [selectedCategory, setSelectedCategory] = useState("Any");
  const [note, setNote] = useState("");

  const effectiveAmount = selectedAmount ?? (customAmount ? parseFloat(customAmount) : null);
  const trimmedRecipient = recipientEmail.trim().toLowerCase();
  const emailValid = EMAIL_RE.test(trimmedRecipient);
  const isSelfGift = !!myEmail && trimmedRecipient === myEmail;

  // ── Stripe return handling (?gift=success | ?gift=cancelled) ───────────────
  useEffect(() => {
    const gift = searchParams.get("gift");
    if (gift === "success") {
      toast.success("Gift on its way!", {
        description: "We've emailed your recipient a link to claim their credit.",
        icon: "💚",
      });
    } else if (gift === "cancelled") {
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
        toast.success(data.already_claimed ? "This gift is already yours" : "Gift claimed!", {
          description: data.already_claimed
            ? "Find it under “Gifts sent to you” below."
            : "It's ready to put toward your next job.",
          icon: "💚",
        });
        // Surface the freshly-attached credit in the received list.
        await queryClient.invalidateQueries({ queryKey: ["pif-received"] });
      } catch (e) {
        report(e, { tags: { source: "PayItForward.claim" } });
        errorToast("Couldn't claim gift", {
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
  const { data: myDonated = [], isLoading: loadingDonated } = useQuery({
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
        throw e;
      }
    },
    enabled: !!user?.id,
  });

  // Gifts sent TO me — matched by resolved recipient_id OR my named email, since
  // a gift I haven't claimed yet has recipient_id = null but is visible to my
  // email via RLS. Newest first.
  const { data: myReceived = [], isLoading: loadingReceived } = useQuery({
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
            .select("*, donor:donor_id(full_name)")
            .or(orClause)
            .order("created_at", { ascending: false }),
        ) as PifCredit[];
        return rows;
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("PGRST202")) return [];
        throw e;
      }
    },
    enabled: !!user?.id,
  });

  // ── Donate mutation — launches Stripe Checkout, never writes the row ───────
  const donateMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Please sign in to send a gift.");
      const amt = effectiveAmount;
      if (!amt || isNaN(amt) || amt < MIN_GIFT) throw new Error(`The smallest gift is $${MIN_GIFT}.`);
      if (!emailValid) throw new Error("Enter a valid email for the person you're gifting.");
      if (isSelfGift) throw new Error("You can't send a gift to yourself.");

      const { data, error } = await supabase.functions.invoke("create-pif-donation", {
        body: {
          amount: amt,
          recipient_email: trimmedRecipient,
          category: selectedCategory,
          message: note.trim(),
        },
      });
      if (error) {
        throw new Error(await functionErrorMessage(error, "Couldn't start your gift. Please try again."));
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Couldn't start your gift. Please try again.");
      window.location.href = data.url;
    },
    onError: (e) => {
      report(e, { tags: { source: "PayItForward.donate" } });
      errorToast("Couldn't send gift", {
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

  const canDonate =
    !!effectiveAmount && effectiveAmount >= MIN_GIFT && !isNaN(effectiveAmount) && emailValid && !isSelfGift;

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Community giving"
        title="Pay It Forward"
        meta="Send a neighbor a Helpr credit"
        onBack={() => navigate(-1)}
        showBrand
        rightSlot={<NotificationPanel />}
        width="2xl"
      />

      <div className="max-w-2xl mx-auto px-5 lg:px-8 pt-4 space-y-6">
        {/* ── Claiming a gift (from the emailed claim link) ─────────────────── */}
        {claiming && (
          <div
            className="rounded-ds-md p-4 flex items-center gap-3"
            style={{
              background: "hsl(var(--pif-tint) / 0.06)",
              border: "0.5px solid hsl(var(--pif-tint) / 0.18)",
            }}
          >
            <div
              className="w-4 h-4 shrink-0 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "hsl(var(--pif-green))", borderTopColor: "transparent" }}
            />
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--pif-ink))" }}>
              Claiming your gift…
            </p>
          </div>
        )}

        {/* ── What is this? ───────────────────────────────────────────────── */}
        <div
          className="rounded-ds-md p-4"
          style={{
            background: "hsl(var(--pif-tint) / 0.06)",
            border: "0.5px solid hsl(var(--pif-tint) / 0.18)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--pif-green))" }} />
            <p
              className="font-display italic font-semibold text-ds-14"
              style={{ color: "hsl(var(--pif-ink))" }}
            >
              What is this?
            </p>
          </div>
          <p className="font-serif italic text-ds-13 leading-relaxed" style={{ color: "hsl(var(--ink-deep) / 0.75)" }}>
            Prepay a Helpr credit for someone specific. Enter their email, choose an amount, and
            we'll send them a link to claim it — they can put it toward any job they need done.
          </p>
        </div>

        {/* ── Give a gift form ────────────────────────────────────────────── */}
        <div
          className="rounded-ds-md p-4 space-y-4"
          style={{
            background:
              "radial-gradient(circle at 20% 0%, var(--pif-sheen) 0%, transparent 60%), " +
              "linear-gradient(180deg, hsl(var(--pif-form-from) / 0.92) 0%, hsl(var(--pif-form-to) / 0.74) 100%)",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
            boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.6)",
          }}
        >
          <p
            className="font-serif italic uppercase"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Send a gift
          </p>

          {/* Recipient email */}
          <div>
            <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Recipient's email
            </p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="friend@example.com"
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
              <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
                Enter a valid email address.
              </p>
            )}
            {isSelfGift && (
              <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
                You can't send a gift to yourself.
              </p>
            )}
          </div>

          {/* Amount chips */}
          <div>
            <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
                min={MIN_GIFT}
                placeholder="Custom"
                value={customAmount}
                onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                className="flex-1 py-2 px-3 rounded-ds-sm text-ds-13 font-sans font-semibold text-center"
                style={{
                  background: customAmount ? "hsl(var(--bark) / 0.10)" : "transparent",
                  border: `1px solid hsl(var(--bark) / ${customAmount ? "0.40" : "0.18"})`,
                  color: "hsl(var(--bark))",
                  outline: "none",
                  minWidth: 0,
                }}
              />
            </div>
            <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              ${MIN_GIFT} minimum. A small processing fee is added at checkout.
            </p>
          </div>

          {/* Category */}
          <div>
            <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Category suggestion — optional
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className="py-1 px-2.5 rounded-full text-ds-12 font-sans font-medium transition-colors"
                  style={{
                    background: selectedCategory === cat ? "hsl(var(--bark) / 0.14)" : "hsl(var(--bark) / 0.04)",
                    border: `0.5px solid hsl(var(--bark) / ${selectedCategory === cat ? "0.38" : "0.14"})`,
                    color: "hsl(var(--bark))",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Personal note */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Personal note — optional
              </p>
              <span className="font-sans tabular-nums text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {note.length}/{MAX_NOTE_LENGTH}
              </span>
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              placeholder="Hope this helps — thinking of you!"
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
              background: canDonate ? "hsl(var(--pif-green))" : "hsl(var(--bark) / 0.15)",
              color: canDonate ? "#fff" : "hsl(var(--bark) / 0.5)",
              border: "none",
            }}
          >
            <Gift className="w-4 h-4 mr-2" />
            {donateMutation.isPending ? "Starting checkout…" : "Continue to checkout"}
          </Button>
        </div>

        {/* ── Gifts sent to you ───────────────────────────────────────────── */}
        <div>
          <p
            className="font-serif italic uppercase mb-3"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Gifts sent to you
          </p>
          {loadingReceived ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="rounded-ds-md h-24 animate-pulse"
                  style={{ background: "hsl(var(--olivewood) / 0.07)" }}
                />
              ))}
            </div>
          ) : myReceived.length === 0 ? (
            <EmptyState message="When someone sends you a Helpr credit, it'll show up here." />
          ) : (
            <div className="space-y-3">
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

        {/* ── Gifts you've sent ───────────────────────────────────────────── */}
        <div className="pb-8">
          <p
            className="font-serif italic uppercase mb-3"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Gifts you've sent
          </p>
          {loadingDonated ? (
            <div
              className="rounded-ds-md h-16 animate-pulse"
              style={{ background: "hsl(var(--olivewood) / 0.07)" }}
            />
          ) : myDonated.length === 0 ? (
            <EmptyState message="Gifts you send will appear here." />
          ) : (
            <div className="space-y-3">
              {myDonated.map((credit) => (
                <CreditCard key={credit.id} credit={credit} perspective="sent" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
