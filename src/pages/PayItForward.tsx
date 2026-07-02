/**
 * Pay It Forward — /pay-it-forward
 *
 * Document-scroll page (PageHeader + min-h-screen).
 * Lets users donate job credits for neighbors and redeem existing credits.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticSuccess, hapticMedium } from "@/lib/haptics";
import { errorToast } from "@/lib/toast";
import { report } from "@/lib/errorLogger";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PifCredit } from "./payItForward/types";
import { AMOUNT_PRESETS, CATEGORIES, LOUISIANA_PARISHES, MAX_NOTE_LENGTH } from "./payItForward/constants";
import { CreditCard } from "./payItForward/CreditCard";
import { EmptyState } from "./payItForward/EmptyState";

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PayItForward() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  usePageTitle("Pay It Forward — Helpr");

  const { user, profile } = useCurrentUser();
  const userParish = profile?.parish ?? "";

  // ── Give credit form state ────────────────────────────────────────────────
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Any");
  const [parish, setParish] = useState(userParish);
  const [note, setNote] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  // Sync parish from profile once loaded
  const resolvedParish = parish || userParish;

  const effectiveAmount = selectedAmount ?? (customAmount ? parseFloat(customAmount) : null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: availableCredits = [], isLoading: loadingAvailable } = useQuery({
    queryKey: ["pif-available", resolvedParish],
    queryFn: async () => {
      if (!resolvedParish) return [];
      // PGRST202 fallback: table doesn't exist yet on prod
      try {
        const rows = unwrap(
          await supabase
            .from("pif_credits" as never)
            .select("*, donor:donor_id(full_name)")
            .eq("status", "available")
            .eq("parish", resolvedParish)
            .order("created_at", { ascending: false }),
        ) as PifCredit[];
        return rows;
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("PGRST202")) return [];
        throw e;
      }
    },
    enabled: !!resolvedParish,
  });

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

  const { data: myReceived = [], isLoading: loadingReceived } = useQuery({
    queryKey: ["pif-received", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const rows = unwrap(
          await supabase
            .from("pif_credits" as never)
            .select("*, donor:donor_id(full_name)")
            .eq("recipient_id", user.id)
            .order("redeemed_at", { ascending: false }),
        ) as PifCredit[];
        return rows;
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("PGRST202")) return [];
        throw e;
      }
    },
    enabled: !!user?.id,
  });

  // ── Donate mutation ───────────────────────────────────────────────────────
  const donateMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not signed in");
      const amt = effectiveAmount;
      if (!amt || isNaN(amt) || amt <= 0) throw new Error("Enter a valid amount");
      unwrap(
        await supabase.from("pif_credits" as never).insert({
          donor_id: user.id,
          amount: amt,
          category: selectedCategory === "Any" ? null : selectedCategory,
          parish: resolvedParish || null,
          message: note.trim() || null,
        } as never),
      );
    },
    onSuccess: () => {
      hapticSuccess();
      setShowSuccess(true);
      setSelectedAmount(null);
      setCustomAmount("");
      setSelectedCategory("Any");
      setNote("");
      setTimeout(() => setShowSuccess(false), 5000);
      queryClient.invalidateQueries({ queryKey: ["pif-available"] });
      queryClient.invalidateQueries({ queryKey: ["pif-donated", user?.id] });
      toast.success("Credit donated!", {
        description: "A neighbor in your parish can now redeem it.",
        icon: "💚",
      });
    },
    onError: (e) => {
      report(e, { tags: { source: "PayItForward.donate" } });
      errorToast("Couldn't donate credit", { description: e instanceof Error ? e.message : "Please try again." });
    },
  });

  // ── Redeem mutation ───────────────────────────────────────────────────────
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const redeemMutation = useMutation({
    mutationFn: async (creditId: string) => {
      if (!user?.id) throw new Error("Not signed in");
      unwrap(
        await supabase
          .from("pif_credits" as never)
          .update({
            recipient_id: user.id,
            status: "redeemed",
            redeemed_at: new Date().toISOString(),
          } as never)
          .eq("id", creditId)
          .eq("status", "available"),
      );
      return creditId;
    },
    onMutate: (id) => setRedeemingId(id),
    onSuccess: (creditId) => {
      hapticSuccess();
      setRedeemingId(null);
      queryClient.invalidateQueries({ queryKey: ["pif-available"] });
      queryClient.invalidateQueries({ queryKey: ["pif-received", user?.id] });
      const credit = availableCredits.find((c) => c.id === creditId);
      const budget = credit?.amount ?? 0;
      toast.success("Credit redeemed!", {
        description: `$${budget.toFixed(0)} pre-filled as your job budget.`,
        icon: "🎉",
      });
      navigate(`/post-job?budget=${budget}&pif_credit=${creditId}`);
    },
    onError: (e) => {
      setRedeemingId(null);
      report(e, { tags: { source: "PayItForward.redeem" } });
      errorToast("Couldn't redeem credit", { description: e instanceof Error ? e.message : "It may have just been claimed by someone else." });
    },
  });

  const handleDonate = () => {
    hapticMedium();
    donateMutation.mutate();
  };

  const handleRedeem = (id: string) => {
    hapticMedium();
    redeemMutation.mutate(id);
  };

  const canDonate =
    !!effectiveAmount && effectiveAmount > 0 && !isNaN(effectiveAmount) && !!resolvedParish;

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        eyebrow="Community giving"
        title="Pay It Forward"
        meta="Help a neighbor who needs it"
        onBack={() => navigate(-1)}
        showBrand
        rightSlot={<NotificationPanel />}
        width="2xl"
      />

      <div className="max-w-2xl mx-auto px-5 lg:px-8 pt-4 space-y-6">
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
            Pay for a job someone else needs but can't afford right now. Choose an amount, add a
            personal note, and a neighbor in your parish redeems it — anonymously if they prefer.
          </p>
        </div>

        {/* ── Give a credit form ──────────────────────────────────────────── */}
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
            Give a credit
          </p>

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
                min={1}
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

          {/* Parish */}
          <div>
            <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Parish
            </p>
            <select
              value={resolvedParish}
              onChange={(e) => setParish(e.target.value)}
              aria-label="Parish"
              className="w-full rounded-ds-sm py-2 px-3 text-ds-13 font-sans"
              style={{
                background: "hsl(var(--parchment) / 0.6)",
                border: "0.5px solid hsl(var(--bark) / 0.22)",
                color: "hsl(var(--ink-deep))",
                outline: "none",
              }}
            >
              <option value="">Select parish…</option>
              {LOUISIANA_PARISHES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
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
              placeholder="Hoping this helps someone near me…"
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
              className="rounded-ds-sm bg-background/60 border-border/60 font-serif italic text-ds-13 leading-relaxed"
            />
          </div>

          {/* Submit */}
          {showSuccess ? (
            <div
              className="flex items-center gap-2 py-3 px-4 rounded-ds-sm"
              style={{ background: "hsl(var(--pif-tint) / 0.10)", border: "0.5px solid hsl(var(--pif-tint) / 0.22)" }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--pif-green))" }} />
              <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--pif-ink))" }}>
                Credit donated — a neighbor will see it soon!
              </p>
            </div>
          ) : (
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
              {donateMutation.isPending ? "Donating…" : "Donate this credit"}
            </Button>
          )}
        </div>

        {/* ── Available credits near you ──────────────────────────────────── */}
        <div>
          <p
            className="font-serif italic uppercase mb-3"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Available credits near you
            {resolvedParish ? ` · ${resolvedParish}` : ""}
          </p>
          {!resolvedParish ? (
            <EmptyState message="Set your parish above to see available credits." />
          ) : loadingAvailable ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="rounded-ds-md h-24 animate-pulse"
                  style={{ background: "hsl(var(--olivewood) / 0.07)" }}
                />
              ))}
            </div>
          ) : availableCredits.filter((c) => c.donor_id !== user?.id).length === 0 ? (
            <EmptyState message="No credits available in your parish yet — be the first to pay it forward!" />
          ) : (
            <div className="space-y-3">
              {availableCredits
                .filter((c) => c.donor_id !== user?.id)
                .map((credit) => (
                  <CreditCard
                    key={credit.id}
                    credit={credit}
                    onRedeem={handleRedeem}
                    redeeming={redeemingId === credit.id && redeemMutation.isPending}
                  />
                ))}
            </div>
          )}
        </div>

        {/* ── Your giving history ─────────────────────────────────────────── */}
        <div>
          <p
            className="font-serif italic uppercase mb-3"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Your giving history
          </p>
          {loadingDonated ? (
            <div
              className="rounded-ds-md h-16 animate-pulse"
              style={{ background: "hsl(var(--olivewood) / 0.07)" }}
            />
          ) : myDonated.length === 0 ? (
            <EmptyState message="Credits you donate will appear here." />
          ) : (
            <div className="space-y-3">
              {myDonated.map((credit) => (
                <CreditCard key={credit.id} credit={credit} />
              ))}
            </div>
          )}
        </div>

        {/* ── Your received credits ───────────────────────────────────────── */}
        <div className="pb-8">
          <p
            className="font-serif italic uppercase mb-3"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Credits you've redeemed
          </p>
          {loadingReceived ? (
            <div
              className="rounded-ds-md h-16 animate-pulse"
              style={{ background: "hsl(var(--olivewood) / 0.07)" }}
            />
          ) : myReceived.length === 0 ? (
            <EmptyState message="Credits redeemed for your jobs will appear here." />
          ) : (
            <div className="space-y-3">
              {myReceived.map((credit) => (
                <CreditCard key={credit.id} credit={credit} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
