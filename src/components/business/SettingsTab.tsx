// Team-level settings tab.
//
// Owner-only controls:
//   - Approval threshold (require_approval_above)
//   - Require 2FA flag (require_2fa)
//   - Default payment method (default_payment_method_id) — the value is
//     a Stripe payment_method ID. We just persist it for now; the real
//     "pick a card from the saved methods" UI lives in the Stripe
//     customer portal that already opens from the Plan card.
//   - Monthly budget + alert ratio
//
// All writes go through the businesses table. Casts to `any` shield the
// new columns from the not-yet-regenerated supabase types — and if the
// column is absent on prod, we surface a friendly error rather than
// crash.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, CreditCard, DollarSign, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";

interface SettingsTabProps {
  businessId: string;
  initial: {
    require_approval_above: number | null;
    require_2fa: boolean;
    default_payment_method_id: string | null;
    monthly_budget: number | null;
    monthly_budget_alert_at: number | null;
  };
  isOwner: boolean;
}

const SECTION_HEADER =
  "font-semibold flex items-center gap-2";

export function SettingsTab({ businessId, initial, isOwner }: SettingsTabProps) {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState<string>(
    initial.require_approval_above != null ? String(initial.require_approval_above) : "",
  );
  const [require2fa, setRequire2fa] = useState<boolean>(initial.require_2fa);
  const [paymentMethodId, setPaymentMethodId] = useState<string>(
    initial.default_payment_method_id ?? "",
  );
  const [monthlyBudget, setMonthlyBudget] = useState<string>(
    initial.monthly_budget != null ? String(initial.monthly_budget) : "",
  );
  const [alertAt, setAlertAt] = useState<string>(
    initial.monthly_budget_alert_at != null
      ? String(Math.round(initial.monthly_budget_alert_at * 100))
      : "80",
  );
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setRequire2fa(initial.require_2fa);
  }, [initial.require_2fa]);

  if (!isOwner) {
    return (
      <Card className="p-5">
        <p className="font-medium">Owner-only settings</p>
        <p className="text-ds-11 text-muted-foreground mt-1">
          Only the business owner can change team settings.
        </p>
      </Card>
    );
  }

  const updateBusiness = async (
    patch: Record<string, unknown>,
    label: string,
    key: string,
  ) => {
    setSaving(key);
    const { error } = await supabase
      .from("businesses")
      .update(patch as any)
      .eq("id", businessId);
    setSaving(null);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST204" || code === "42703") {
        toast.error(`${label} isn't available yet — the platform update is finishing deploying.`);
      } else {
        toast.error(error.message || `Couldn't save ${label}.`);
      }
      return false;
    }
    toast.success(`${label} saved.`);
    queryClient.invalidateQueries({ queryKey: queryKeys.business.allMine });
    return true;
  };

  return (
    <div className="space-y-4">
      {/* APPROVAL WORKFLOW */}
      <Card className="p-5 space-y-3">
        <h3 className={SECTION_HEADER}>
          <ShieldCheck className="w-4 h-4" /> Approval workflow
        </h3>
        <p className="text-ds-11 text-muted-foreground">
          Posts whose budget exceeds this threshold go to "pending approval" instead of going live.
          Leave blank to disable.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="threshold" className="text-ds-11">
              Threshold (USD)
            </Label>
            <Input
              id="threshold"
              type="number"
              min={0}
              inputMode="decimal"
              placeholder="e.g. 500"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <Button
            onClick={() =>
              updateBusiness(
                {
                  require_approval_above: threshold.trim() === "" ? null : Number(threshold),
                },
                "Threshold",
                "threshold",
              )
            }
            disabled={saving === "threshold"}
          >
            {saving === "threshold" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </Card>

      {/* 2FA */}
      <Card className="p-5 space-y-3">
        <h3 className={SECTION_HEADER}>
          <ShieldCheck className="w-4 h-4" /> Require 2FA to post
        </h3>
        <p className="text-ds-11 text-muted-foreground">
          When on, teammates must enroll in two-factor auth before they can post jobs. (We show a
          banner today; hard enforcement at the post-job page ships next.)
        </p>
        <div className="flex items-center justify-between">
          <span className="text-ds-13">{require2fa ? "Required" : "Optional"}</span>
          {/* The adjacent "Required"/"Optional" span is status text, not a
              <label>, so this switch had no accessible name — axe
              button-name (critical). */}
          <Switch
            aria-label="Require teammates to enroll in two-factor auth before posting"
            checked={require2fa}
            onCheckedChange={async (next) => {
              setRequire2fa(next);
              const ok = await updateBusiness({ require_2fa: next }, "2FA requirement", "2fa");
              if (!ok) setRequire2fa(!next);
            }}
            disabled={saving === "2fa"}
          />
        </div>
      </Card>

      {/* DEFAULT PAYMENT METHOD */}
      <Card className="p-5 space-y-3">
        <h3 className={SECTION_HEADER}>
          <CreditCard className="w-4 h-4" /> Default payment method
        </h3>
        <p className="text-ds-11 text-muted-foreground">
          Stripe payment_method ID owned by the business. When set, jobs posted under this business
          charge this card instead of the poster's personal card. Manage your saved cards from the
          Plan tab's billing portal.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="pm" className="text-ds-11">
              payment_method ID
            </Label>
            <Input
              id="pm"
              type="text"
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
            />
          </div>
          <Button
            onClick={() =>
              updateBusiness(
                {
                  default_payment_method_id:
                    paymentMethodId.trim() === "" ? null : paymentMethodId.trim(),
                },
                "Payment method",
                "pm",
              )
            }
            disabled={saving === "pm"}
          >
            {saving === "pm" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </Card>

      {/* MONTHLY BUDGET */}
      <Card className="p-5 space-y-3">
        <h3 className={SECTION_HEADER}>
          <DollarSign className="w-4 h-4" /> Monthly budget
        </h3>
        <p className="text-ds-11 text-muted-foreground">
          We'll alert you when the team's monthly posted total crosses the alert percentage.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="budget" className="text-ds-11">
              Budget (USD)
            </Label>
            <Input
              id="budget"
              type="number"
              inputMode="decimal"
              min={0}
              value={monthlyBudget}
              onChange={(e) => setMonthlyBudget(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="alert-at" className="text-ds-11">
              Alert at %
            </Label>
            <Input
              id="alert-at"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={alertAt}
              onChange={(e) => setAlertAt(e.target.value)}
            />
          </div>
        </div>
        <Button
          onClick={() =>
            updateBusiness(
              {
                monthly_budget: monthlyBudget.trim() === "" ? null : Number(monthlyBudget),
                monthly_budget_alert_at:
                  alertAt.trim() === "" ? null : Math.max(0.01, Math.min(1, Number(alertAt) / 100)),
              },
              "Monthly budget",
              "budget",
            )
          }
          disabled={saving === "budget"}
        >
          {saving === "budget" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <BellRing className="w-4 h-4 mr-1.5" />
              Save budget alert
            </>
          )}
        </Button>
      </Card>
    </div>
  );
}

export default SettingsTab;
