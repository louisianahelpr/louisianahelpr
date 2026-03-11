import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const AdminSettings = () => {
  const [feePercent, setFeePercent] = useState("");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("platform_settings")
        .select("*")
        .limit(1)
        .single();

      if (data) {
        setFeePercent(String(data.platform_fee_percent));
        setSettingsId(data.id);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!settingsId) return;
    const value = parseFloat(feePercent);
    if (isNaN(value) || value < 0 || value > 100) {
      toast.error("Fee must be between 0 and 100");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("platform_settings")
      .update({ platform_fee_percent: value })
      .eq("id", settingsId);

    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Platform fee updated!");
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading settings…</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-display font-bold text-foreground">Platform Settings</h2>

      <div className="max-w-md rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="fee">Platform fee percentage (%)</Label>
          <p className="text-xs text-muted-foreground">
            This is the percentage Helpr takes from each job payment. Applied at time of escrow.
          </p>
          <Input
            id="fee"
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
            className="max-w-[120px]"
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>

      <div className="max-w-md rounded-xl border border-border bg-card p-6 space-y-3">
        <h3 className="font-semibold text-foreground">How fees work</h3>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>Customer pays the full job budget at time of posting (escrow)</li>
          <li>When the job is completed, Helpr retains the platform fee</li>
          <li>The remaining amount goes to the helper</li>
          <li>Current fee: <strong className="text-foreground">{feePercent}%</strong></li>
        </ul>
      </div>
    </div>
  );
};

export default AdminSettings;
