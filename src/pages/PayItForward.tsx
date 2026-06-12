/**
 * Pay It Forward — /pay-it-forward
 *
 * Document-scroll page (PageHeader + min-h-screen).
 * Lets users donate job credits for neighbors and redeem existing credits.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Gift, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticSuccess, hapticMedium } from "@/lib/haptics";
import { errorToast } from "@/lib/toast";
import { report } from "@/lib/errorLogger";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ─── Local types (until schema is regenerated from live DB) ──────────────────
type PifCredit = {
  id: string;
  donor_id: string;
  recipient_id: string | null;
  amount: number;
  status: string;
  message: string | null;
  category: string | null;
  parish: string | null;
  job_id: string | null;
  expires_at: string | null;
  created_at: string;
  redeemed_at: string | null;
  donor?: { full_name: string | null } | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────
const AMOUNT_PRESETS = [25, 50, 75];
const CATEGORIES = ["Any", "Cleaning", "Yard Work", "Handyman", "Groceries"];
const LOUISIANA_PARISHES = [
  "Orleans",
  "Jefferson",
  "Lafayette",
  "East Baton Rouge",
  "St. Tammany",
  "Caddo",
  "Calcasieu",
  "Livingston",
  "Rapides",
];
const MAX_NOTE_LENGTH = 140;

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    available: { label: "Available", color: "hsl(155 50% 30%)", bg: "hsl(155 50% 35% / 0.12)" },
    redeemed: { label: "Redeemed", color: "hsl(var(--bark))", bg: "hsl(var(--bark) / 0.10)" },
    reserved: { label: "Reserved", color: "hsl(var(--gold-warm))", bg: "hsl(var(--gold-warm) / 0.12)" },
    expired: { label: "Expired", color: "hsl(var(--olivewood) / 0.6)", bg: "hsl(var(--olivewood) / 0.08)" },
  };
  const s = map[status] ?? map.available;
  return (
    <span
      className="text-ds-10 font-sans font-semibold uppercase px-1.5 py-0.5 rounded-ds-sm"
      style={{ color: s.color, background: s.bg, letterSpacing: "0.06em" }}
    >
      {s.label}
    </span>
  );
}

// ─── Credit card ──────────────────────────────────────────────────────────────
function CreditCard({
  credit,
  onRedeem,
  redeeming,
}: {
  credit: PifCredit;
  onRedeem?: (id: string) => void;
  redeeming?: boolean;
}) {
  const donorFirst = (credit.donor?.full_name ?? "A neighbor").split(" ")[0];
  return (
    <div
      className="rounded-ds-md p-4"
      style={{
        background:
          "radial-gradient(circle at 15% 0%, hsla(0,0%,100%,0.55) 0%, transparent 55%), " +
          "linear-gradient(180deg, hsl(155 50% 97%) 0%, hsl(155 40% 94%) 100%)",
        border: "0.5px solid hsl(155 50% 35% / 0.22)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.5), " +
          "0 1px 3px hsl(155 50% 35% / 0.08)",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p
            className="font-display italic font-bold leading-tight"
            style={{ fontSize: "1.35rem", color: "hsl(155 50% 28%)", letterSpacing: "-0.02em" }}
          >
            ${Number(credit.amount).toFixed(0)}
          </p>
          <p
            className="font-serif italic mt-0.5"
            style={{ fontSize: "0.75rem", color: "hsl(155 40% 40%)" }}
          >
            from {donorFirst}
            {credit.parish ? ` · ${credit.parish}` : ""}
          </p>
        </div>
        <StatusPill status={credit.status} />
      </div>

      {credit.category && credit.category !== "Any" && (
        <p
          className="font-sans text-ds-11 font-semibold uppercase mb-2"
          style={{ color: "hsl(155 40% 40%)", letterSpacing: "0.06em" }}
        >
          For: {credit.category}
        </p>
      )}

      {credit.message && (
        <p
          className="font-serif italic text-ds-13 leading-relaxed mb-3"
          style={{ color: "hsl(var(--ink-deep) / 0.75)" }}
        >
          "{credit.message}"
        </p>
      )}

      {onRedeem && credit.status === "available" && (
        <Button
          size="sm"
          disabled={redeeming}
          onClick={() => onRedeem(credit.id)}
          className="w-full rounded-ds-sm font-display italic font-semibold text-ds-13"
          style={{
            background: "hsl(155 50% 30%)",
            color: "#fff",
            border: "none",
          }}
        >
          {redeeming ? "Redeeming…" : "Redeem this credit"}
        </Button>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="rounded-ds-md p-4 text-center"
      style={{ background: "hsl(var(--bark) / 0.04)", border: "0.5px dashed hsl(var(--bark) / 0.18)" }}
    >
      <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
        {message}
      </p>
    </div>
  );
}

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
      hapticMedium();
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
      <PageHeader title="Pay It Forward" onBack={() => navigate(-1)} />

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-6">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "hsl(155 50% 35% / 0.12)" }}
          >
            <Heart className="w-5 h-5" style={{ color: "hsl(155 50% 30%)" }} />
          </span>
          <div>
            <h1
              className="font-display italic font-bold leading-tight"
              style={{ fontSize: "1.25rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
            >
              Pay It Forward
            </h1>
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.70)" }}>
              Help a neighbor who needs it
            </p>
          </div>
        </div>

        {/* ── What is this? ───────────────────────────────────────────────── */}
        <div
          className="rounded-ds-md p-4"
          style={{
            background: "hsl(155 50% 35% / 0.06)",
            border: "0.5px solid hsl(155 50% 35% / 0.18)",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 shrink-0" style={{ color: "hsl(155 50% 30%)" }} />
            <p
              className="font-display italic font-semibold text-ds-14"
              style={{ color: "hsl(155 50% 28%)" }}
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
              "radial-gradient(circle at 20% 0%, hsla(0,0%,100%,0.55) 0%, transparent 60%), " +
              "linear-gradient(180deg, hsla(38,50%,96%,0.92) 0%, hsla(38,30%,92%,0.74) 100%)",
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
            <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
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
            <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
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
            <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              Parish
            </p>
            <select
              value={resolvedParish}
              onChange={(e) => setParish(e.target.value)}
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
              <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Personal note — optional
              </p>
              <span className="font-sans tabular-nums text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.5)" }}>
                {note.length}/{MAX_NOTE_LENGTH}
              </span>
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              placeholder="Hoping this helps someone near me…"
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
              className="rounded-ds-sm bg-white/60 border-border/60 font-serif italic text-ds-13 leading-relaxed"
            />
          </div>

          {/* Submit */}
          {showSuccess ? (
            <div
              className="flex items-center gap-2 py-3 px-4 rounded-ds-sm"
              style={{ background: "hsl(155 50% 35% / 0.10)", border: "0.5px solid hsl(155 50% 35% / 0.22)" }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "hsl(155 50% 30%)" }} />
              <p className="font-serif italic text-ds-13" style={{ color: "hsl(155 50% 28%)" }}>
                Credit donated — a neighbor will see it soon!
              </p>
            </div>
          ) : (
            <Button
              onClick={handleDonate}
              disabled={!canDonate || donateMutation.isPending}
              className="w-full rounded-ds-sm font-display italic font-semibold"
              style={{
                background: canDonate ? "hsl(155 50% 30%)" : "hsl(var(--bark) / 0.15)",
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
