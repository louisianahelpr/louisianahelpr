import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutationRow, mutationErrorMessage } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess, hapticLight } from "@/lib/haptics";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { JOB_CATEGORY_LABELS, LICENSE_REQUIRED_CATEGORIES, type JobCategory } from "@/lib/jobCategories";

const LICENSED = Object.keys(LICENSE_REQUIRED_CATEGORIES) as JobCategory[];
const QUERY_KEY = (userId: string) => ["licensedCategories", userId] as const;

/**
 * "Which licensed services does your license cover?" (owner 2026-10-19).
 * Locksmith, mobile vet, hair stylist, massage and mobile bartending jobs take
 * only Helprs whose verified license covers that service. The Helpr ticks the
 * services their license document covers; the admin checks the document
 * against them in the same review as the license itself
 * (get_pending_credentials shows them). Changing them on a verified license
 * sends it back to review (auto_pending_credentials), so the card says so
 * before saving. The server is what enforces it (20261019184311).
 *
 * Its own query, not CredentialsTab's: before the migration deploys the column
 * does not exist (42703), and a shared select would break the whole tab. Then
 * this card simply does not show.
 */
export function LicensedCategoriesCard({ userId, licenseVerified }: { userId: string; licenseVerified: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<JobCategory[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const { data: saved } = useQuery({
    queryKey: QUERY_KEY(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<JobCategory[] | null> => {
      const { data, error } = await supabase.from("profiles").select("license_categories").eq("user_id", userId).maybeSingle();
      if (error) {
        if ((error as { code?: string }).code !== "42703") report(error, { tags: { source: "LicensedCategoriesCard" } });
        return null;
      }
      return (data?.license_categories ?? []) as JobCategory[];
    },
  });
  if (saved === null || saved === undefined) return null;

  const value = draft ?? saved;
  const dirty = draft !== null && [...draft].sort().join() !== [...saved].sort().join();
  const toggle = (c: JobCategory) => {
    hapticLight();
    setDraft(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  };

  const save = async () => {
    if (!dirty || saving || draft === null) return;
    setSaving(true);
    try {
      unwrapMutationRow(
        await supabase.from("profiles").update({ license_categories: draft }).eq("user_id", userId).select("license_categories"),
        {
          action: "save the services your license covers",
          rejectedMessage: "We couldn't save that — please try again.",
          context: { userId },
        },
      );
    } catch (err) {
      setSaving(false);
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't save that — please try again."));
      return;
    }
    setSaving(false);
    setDraft(null);
    void qc.invalidateQueries({ queryKey: QUERY_KEY(userId) });
    void qc.invalidateQueries({ queryKey: ["viewerLicensedCategories"] });
    void qc.invalidateQueries({ queryKey: ["credentials"] });
    hapticSuccess();
    toast.success(licenseVerified ? "Saved — your license is back in review while we check it covers these." : "Saved.");
  };

  return (
    <div className="rounded-2xl liquid-glass p-card space-y-3" data-testid="licensed-categories-card">
      <div>
        <h3 className="font-display font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
          Licensed Services
        </h3>
        <p className="font-sans mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          These jobs take only Helprs with a verified license for them. Tick the ones your license covers and we check it in the same review.
        </p>
      </div>
      <div role="group" aria-label="Services your license covers" className="space-y-2">
        {LICENSED.map((c) => {
          const on = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              className="flex min-h-11 w-full items-center gap-3 rounded-ds-md px-3 py-2 text-left ctl-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                background: on ? "hsl(var(--bark) / 0.08)" : "hsl(var(--parchment))",
                border: `0.5px solid hsl(var(--${on ? "bark" : "border"}) / ${on ? "0.35" : "0.7"})`,
              }}
            >
              <CategoryIcon category={c} aria-hidden className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--bark))" }} strokeWidth={2.25} />
              <span className="min-w-0 flex-1">
                <span className="block font-sans font-semibold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
                  {JOB_CATEGORY_LABELS[c]}
                </span>
                <span className="block font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Needs {LICENSE_REQUIRED_CATEGORIES[c]}
                </span>
              </span>
              <span
                aria-hidden
                className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center"
                style={{ background: on ? "hsl(var(--bark))" : "transparent", border: on ? "none" : "1.5px solid hsl(var(--border))" }}
              >
                {on && <Check className="w-3 h-3" style={{ color: "hsl(var(--parchment))" }} strokeWidth={3.5} />}
              </span>
            </button>
          );
        })}
      </div>
      {dirty && (
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={saving}
          onClick={() => (licenseVerified ? setConfirm(true) : void save())}
        >
          {saving ? "Saving…" : "Save Licensed Services"}
        </Button>
      )}
      <BrandConfirmDialog
        open={confirm}
        onOpenChange={(open) => { if (!open) setConfirm(false); }}
        title="Send Your License Back to Review?"
        description="We check your license covers these services. Your Licensed badge comes off while we look, usually within one business day."
        primaryLabel="Save It"
        primaryHaptic="warning"
        primaryDisabled={saving}
        onPrimary={() => { setConfirm(false); void save(); }}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
