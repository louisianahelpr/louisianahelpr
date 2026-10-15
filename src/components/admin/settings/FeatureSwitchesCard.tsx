import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ToggleRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { requireBiometric } from "@/lib/biometricGate";
import { userFacingError } from "@/lib/userFacingError";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { useFeature } from "@/hooks/useFeature";
import { FEATURE_AUDIENCES, FEATURE_AUDIENCE_LABEL, type FeatureAudience, type FeatureKey } from "@/config/featureSwitches";
import { AdminCard } from "../AdminViewShell";
import { DeclutterReviewCard } from "./DeclutterReviewCard";
import { CategorySuggestionsCard } from "./CategorySuggestionsCard";
import { DeclutterProblemsCard } from "./DeclutterProblemsCard";

type SwitchRow = { key: string; audience: string; description: string; updated_at: string };
type PendingChange = { key: string; from: string; to: FeatureAudience };

const AUDIENCE_CONSEQUENCE: Record<FeatureAudience, string> = {
  off: "Nobody sees it — not you, not the test accounts. Its server calls refuse everyone.",
  testers: "Only admins and the test accounts see it. Everyone else is refused, in the app and at the server.",
  everyone: "Every signed-in member sees it, on web and in the app, at once. This is going live.",
};

/**
 * Hidden feature switches (owner decision 2026-10-11): every switch in
 * public.feature_switches and its audience. Changing one goes through a
 * confirmation and admin_set_feature_switch(), which writes the
 * admin_audit_log row itself, in the same transaction (Q76).
 */
export function FeatureSwitchesCard() {
  const queryClient = useQueryClient();
  const canaryReachesMe = useFeature("switch_canary");
  // What the SERVER says about this account, per switch (feature_enabled_for):
  // the proof that flipping a switch reached you, before any screen uses it.
  const reachesMe: Partial<Record<FeatureKey, boolean>> = {
    switch_canary: canaryReachesMe,
    declutter: useFeature("declutter"),
    shops: useFeature("shops"),
  };
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: switches, status, fetchStatus, error, refetch } = useQuery({
    queryKey: ["admin-feature-switches"],
    queryFn: async (): Promise<SwitchRow[]> => unwrap(await supabase.rpc("admin_list_feature_switches")) ?? [],
  });
  // Offline with nothing loaded is not "no switches" (Q571).
  const phase = useFeedPhase({ status, fetchStatus });

  const applyChange = async (change: PendingChange) => {
    const ok = await requireBiometric(`Confirm setting ${change.key} to ${FEATURE_AUDIENCE_LABEL[change.to]}`);
    if (!ok) {
      setPending(null);
      return;
    }
    setSaving(true);
    try {
      const stored = unwrap(
        await supabase.rpc("admin_set_feature_switch", { p_key: change.key, p_audience: change.to }),
      );
      // The RPC returns the audience it stored; anything else is not a write.
      if (stored !== change.to) throw new Error(`Switch ${change.key} reads ${String(stored)} after the change`);
      toast.success(`${change.key} is now ${FEATURE_AUDIENCE_LABEL[change.to]}.`);
      await queryClient.invalidateQueries({ queryKey: ["feature-enabled"] });
    } catch (err) {
      toast.error(
        rpcErrorMessage("admin_set_feature_switch", err) ??
          userFacingError(err, "Couldn't change that switch — nothing was changed. Try again."),
      );
    } finally {
      // Always re-read: the list must show what the server holds, not what we asked for.
      await refetch();
      setSaving(false);
      setPending(null);
    }
  };

  // The Declutter review queue sits beside its switch (spec B23).
  return (
    <>
    <AdminCard
      title={<span className="flex items-center gap-2"><ToggleRight className="w-4 h-4 text-primary" /> Hidden Feature Switches</span>}
      subtitle="New features ship switched to Testers only (admins and test accounts), then you flip them to Everyone. Every change is logged."
      contentClassName="space-y-3"
    >
      <p className="text-ds-11 text-muted-foreground">
        Testers-only switches {canaryReachesMe ? "reach" : "do not reach"} this account
        {canaryReachesMe ? "." : " (or the canary switch is off)."}
      </p>
      {phase === "loading" ? (
        <p className="text-ds-12 text-muted-foreground">Loading switches…</p>
      ) : phase === "offline-empty" ? (
        <OfflineEmptyState body="The feature switches will show here once you're back online." onRetry={() => refetch()} />
      ) : phase === "error" ? (
        <div className="space-y-2">
          <p className="text-ds-12 text-destructive">
            {rpcErrorMessage("admin_list_feature_switches", error) ?? "Couldn't read the switches. Nothing is shown rather than a guess."}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : !switches || switches.length === 0 ? (
        <EmptyState icon={ToggleRight} title="No switches yet" body="A switch is created by a migration, set to Off or Testers only." />
      ) : (
        <ul className="space-y-3">
          {switches.map((s) => (
            <li key={s.key} className="rounded-ds-md border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-ds-12 font-semibold text-foreground break-all">{s.key}</code>
                <Badge variant="outline">{FEATURE_AUDIENCE_LABEL[s.audience as FeatureAudience] ?? `Unknown (${s.audience}) — off`}</Badge>
              </div>
              <p className="text-ds-11 text-muted-foreground leading-snug">{s.description}</p>
              {s.key in reachesMe && (
                <p className="text-ds-11 text-muted-foreground">
                  {reachesMe[s.key as FeatureKey] ? "On for this account." : "Off for this account."}
                </p>
              )}
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Audience for ${s.key}`}>
                {FEATURE_AUDIENCES.map((aud) => (
                  <Button
                    key={aud}
                    size="sm"
                    variant={s.audience === aud ? "default" : "outline"}
                    aria-pressed={s.audience === aud}
                    disabled={saving || s.audience === aud}
                    onClick={() => setPending({ key: s.key, from: s.audience, to: aud })}
                  >
                    {FEATURE_AUDIENCE_LABEL[aud]}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <BrandConfirmDialog
        open={!!pending}
        onOpenChange={(open) => { if (!open && !saving) setPending(null); }}
        title={pending ? `Set ${pending.key} to ${FEATURE_AUDIENCE_LABEL[pending.to]}?` : "Change switch?"}
        description={pending ? AUDIENCE_CONSEQUENCE[pending.to] : ""}
        primaryLabel={saving ? "Saving…" : pending ? `Set to ${FEATURE_AUDIENCE_LABEL[pending.to]}` : "Confirm"}
        primaryTone={pending?.to === "everyone" ? "sienna" : "bark"}
        primaryDisabled={saving}
        onPrimary={(e) => {
          e.preventDefault();
          if (pending) void applyChange(pending);
        }}
        secondaryLabel="Cancel"
      />
    </AdminCard>
    <DeclutterReviewCard />
    <CategorySuggestionsCard />
    <DeclutterProblemsCard />
    </>
  );
}
