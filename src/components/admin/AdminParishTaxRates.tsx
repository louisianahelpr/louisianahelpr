import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Plus, Search } from "lucide-react";
import { logAdminAction } from "@/lib/adminAudit";
import { useInstantQuery } from "@/hooks/useInstantQuery";

interface ParishRate {
  id: string;
  parish_name: string;
  state_rate: number;
  local_rate: number;
  total_rate: number | null;
  updated_at: string;
}

const AdminParishTaxRates = () => {
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, { state_rate: string; local_rate: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [newParish, setNewParish] = useState("");
  const [newLocalRate, setNewLocalRate] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: rates, isFetching, refetch } = useInstantQuery<ParishRate[]>({
    key: ["admin-parish-tax-rates"],
    fallback: [],
    fetcher: async () => {
      const { data, error } = await supabase.from("parish_tax_rates")
        .select("*")
        .order("parish_name", { ascending: true });
      if (error) throw error;
      return (data as ParishRate[]) || [];
    },
  });
  const loading = isFetching && rates.length === 0;

  const setEdit = (id: string, field: "state_rate" | "local_rate", value: string) => {
    setEdits((prev) => ({
      ...prev,
      [id]: {
        state_rate: prev[id]?.state_rate ?? "",
        local_rate: prev[id]?.local_rate ?? "",
        [field]: value,
      } as any,
    }));
  };

  const saveRate = async (rate: ParishRate) => {
    const edit = edits[rate.id];
    const stateRate = edit?.state_rate !== undefined && edit.state_rate !== ""
      ? parseFloat(edit.state_rate)
      : rate.state_rate;
    const localRate = edit?.local_rate !== undefined && edit.local_rate !== ""
      ? parseFloat(edit.local_rate)
      : rate.local_rate;

    if (isNaN(stateRate) || isNaN(localRate) || stateRate < 0 || localRate < 0 || stateRate > 20 || localRate > 20) {
      toast.error("Rates must be between 0 and 20");
      return;
    }

    setSaving(rate.id);
    const { error } = await supabase.from("parish_tax_rates")
      .update({
        state_rate: stateRate,
        local_rate: localRate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rate.id);

    if (error) toast.error(error.message);
    else {
      toast.success(`Updated ${rate.parish_name} Parish — total rate now ${(stateRate + localRate).toFixed(2)}%`);
      await logAdminAction("update_parish_tax", "parish_tax_rate", rate.id, {
        parish: rate.parish_name,
        old_state: rate.state_rate,
        old_local: rate.local_rate,
        new_state: stateRate,
        new_local: localRate,
      });
      setEdits((prev) => { const next = { ...prev }; delete next[rate.id]; return next; });
      await refetch();
    }
    setSaving(null);
  };

  const addParish = async () => {
    if (!newParish.trim()) {
      toast.error("Parish name required");
      return;
    }
    const local = parseFloat(newLocalRate);
    if (isNaN(local) || local < 0 || local > 20) {
      toast.error("Local rate must be between 0 and 20");
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("parish_tax_rates").insert({
      parish_name: newParish.trim(),
      state_rate: 5.00,
      local_rate: local,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Added ${newParish.trim()} Parish`);
      await logAdminAction("add_parish_tax", "parish_tax_rate", newParish.trim(), { local_rate: local });
      setNewParish("");
      setNewLocalRate("");
      await refetch();
    }
    setAdding(false);
  };

  const filtered = search.trim()
    ? rates.filter((r) => r.parish_name.toLowerCase().includes(search.toLowerCase()))
    : rates;

  return (
    <div className="space-y-6">
      <p className="text-ds-11 text-muted-foreground">
        Update sales tax rates per parish without touching code. Used for taxable services (cleaning, yard work, handyman, etc.).
      </p>

      {/* Add new parish */}
      <div className="rounded-ds-md liquid-glass p-4 space-y-3">
        <p className="text-ds-13 font-semibold text-foreground">Add new parish</p>
        <div className="flex gap-2 flex-wrap">
          <Input
            aria-label="Parish name"
            value={newParish}
            onChange={(e) => setNewParish(e.target.value)}
            className="flex-1 min-w-[160px]"
          />
          <Input
            aria-label="Local tax rate (percent)"
            type="number"
            step="0.01"
            value={newLocalRate}
            onChange={(e) => setNewLocalRate(e.target.value)}
            className="w-[120px]"
          />
          <Button onClick={addParish} disabled={adding}>
            <Plus className="w-4 h-4 mr-1" /> {adding ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search parishes"
          placeholder="Search parishes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <p className="text-ds-11 text-muted-foreground">Loading parishes…</p>
      ) : filtered.length === 0 ? (
        <p className="text-ds-11 text-muted-foreground text-center py-8">No parishes match.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((rate) => {
            const edit = edits[rate.id];
            const previewTotal =
              (edit?.state_rate !== undefined && edit.state_rate !== "" ? parseFloat(edit.state_rate) : rate.state_rate) +
              (edit?.local_rate !== undefined && edit.local_rate !== "" ? parseFloat(edit.local_rate) : rate.local_rate);
            const isDirty = !!edit && (edit.state_rate !== "" || edit.local_rate !== "");

            return (
              <div key={rate.id} className="rounded-ds-md liquid-glass p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="font-semibold text-foreground">{rate.parish_name} Parish</p>
                  <Badge className="bg-primary/10 text-primary">
                    Total: {previewTotal.toFixed(2)}%
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-ds-11 uppercase tracking-wider text-muted-foreground">State rate %</label>
                    <Input
                      type="number"
                      step="0.01"
                      aria-label={`State tax rate for ${rate.parish_name}`}
                      value={edit?.state_rate ?? rate.state_rate}
                      onChange={(e) => setEdit(rate.id, "state_rate", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-ds-11 uppercase tracking-wider text-muted-foreground">Local rate %</label>
                    <Input
                      type="number"
                      step="0.01"
                      aria-label={`Local tax rate for ${rate.parish_name}`}
                      value={edit?.local_rate ?? rate.local_rate}
                      onChange={(e) => setEdit(rate.id, "local_rate", e.target.value)}
                    />
                  </div>
                </div>
                {isDirty && (
                  <Button size="sm" onClick={() => saveRate(rate)} disabled={saving === rate.id}>
                    <Save className="w-3 h-3 mr-1" /> {saving === rate.id ? "Saving…" : "Save"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminParishTaxRates;
