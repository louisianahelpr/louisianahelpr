import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MapPin, Save, Plus, Search } from "lucide-react";
import { logAdminAction } from "@/lib/adminAudit";

interface ParishRate {
  id: string;
  parish_name: string;
  state_rate: number;
  local_rate: number;
  total_rate: number | null;
  updated_at: string;
}

const AdminParishTaxRates = () => {
  const [rates, setRates] = useState<ParishRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, { state_rate: string; local_rate: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [newParish, setNewParish] = useState("");
  const [newLocalRate, setNewLocalRate] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase.from as any)("parish_tax_rates")
      .select("*")
      .order("parish_name", { ascending: true });
    if (error) toast.error(error.message);
    setRates((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
    const { error } = await (supabase.from as any)("parish_tax_rates")
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
      await load();
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
    const { error } = await (supabase.from as any)("parish_tax_rates").insert({
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
      await load();
    }
    setAdding(false);
  };

  const filtered = search.trim()
    ? rates.filter((r) => r.parish_name.toLowerCase().includes(search.toLowerCase()))
    : rates;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" /> Parish Tax Rates
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Update sales tax rates per parish without touching code. Used for taxable services (cleaning, yard work, handyman, etc.).
        </p>
      </div>

      {/* Add new parish */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Add new parish</p>
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Parish name (e.g. Calcasieu)"
            value={newParish}
            onChange={(e) => setNewParish(e.target.value)}
            className="flex-1 min-w-[160px]"
          />
          <Input
            placeholder="Local rate %"
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
          placeholder="Search parishes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading parishes…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No parishes match.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((rate) => {
            const edit = edits[rate.id];
            const previewTotal =
              (edit?.state_rate !== undefined && edit.state_rate !== "" ? parseFloat(edit.state_rate) : rate.state_rate) +
              (edit?.local_rate !== undefined && edit.local_rate !== "" ? parseFloat(edit.local_rate) : rate.local_rate);
            const isDirty = !!edit && (edit.state_rate !== "" || edit.local_rate !== "");

            return (
              <div key={rate.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="font-semibold text-foreground">{rate.parish_name} Parish</p>
                  <Badge className="bg-primary/10 text-primary">
                    Total: {previewTotal.toFixed(2)}%
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">State rate %</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={edit?.state_rate ?? rate.state_rate}
                      onChange={(e) => setEdit(rate.id, "state_rate", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Local rate %</label>
                    <Input
                      type="number"
                      step="0.01"
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
