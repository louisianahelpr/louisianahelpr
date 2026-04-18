import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, X, Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PreferredParishesProps {
  helperId: string;
}

const MAX_PARISHES = 5;

export const PreferredParishes = ({ helperId }: PreferredParishesProps) => {
  const [allParishes, setAllParishes] = useState<string[]>([]);
  const [selected, setSelected] = useState<{ id: string; parish: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [parishRes, savedRes] = await Promise.all([
        supabase.from("louisiana_zip_parishes").select("parish"),
        supabase.from("helper_preferred_parishes").select("id, parish").eq("helper_id", helperId),
      ]);
      const uniqueParishes = Array.from(
        new Set((parishRes.data || []).map((p) => p.parish))
      ).sort();
      setAllParishes(uniqueParishes);
      setSelected(savedRes.data || []);
      setLoading(false);
    };
    load();
  }, [helperId]);

  const add = async () => {
    if (!adding) return;
    if (selected.length >= MAX_PARISHES) {
      toast.error(`You can only select up to ${MAX_PARISHES} home parishes.`);
      return;
    }
    if (selected.some((s) => s.parish === adding)) {
      toast.error("Already selected.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("helper_preferred_parishes")
      .insert({ helper_id: helperId, parish: adding })
      .select("id, parish")
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSelected([...selected, data]);
    setAdding("");
    toast.success(`${adding} added — you'll get instant alerts for jobs there.`);
  };

  const remove = async (id: string, parish: string) => {
    const { error } = await supabase.from("helper_preferred_parishes").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSelected(selected.filter((s) => s.id !== id));
    toast.success(`${parish} removed.`);
  };

  const available = allParishes.filter((p) => !selected.some((s) => s.parish === p));

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2 shrink-0">
          <Bell className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-display font-semibold text-foreground text-sm">Instant Job Alerts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick up to {MAX_PARISHES} home parishes. We'll notify you the second a job drops in your territory.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selected.map((s) => (
                <Badge key={s.id} variant="secondary" className="gap-1.5 pl-2.5 pr-1 py-1 text-xs">
                  <MapPin className="w-3 h-3" />
                  {s.parish}
                  <button
                    onClick={() => remove(s.id, s.parish)}
                    className="ml-0.5 rounded-full hover:bg-background/50 p-0.5 transition-colors"
                    aria-label={`Remove ${s.parish}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No home parishes set yet.</p>
          )}

          {selected.length < MAX_PARISHES && (
            <div className="flex gap-2">
              <Select value={adding} onValueChange={setAdding}>
                <SelectTrigger className="flex-1 h-9 text-sm">
                  <SelectValue placeholder="Add a parish…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={add} disabled={!adding || saving} className="h-9">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
              </Button>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {selected.length} of {MAX_PARISHES} parishes selected
          </p>
        </>
      )}
    </div>
  );
};
