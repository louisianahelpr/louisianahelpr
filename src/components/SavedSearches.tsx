import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bell, BellOff, Bookmark, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface SavedSearch {
  id: string;
  name: string;
  category: string | null;
  parish: string | null;
  max_budget: number | null;
  min_budget: number | null;
  location_keyword: string | null;
  notify_enabled: boolean;
  created_at: string;
}

interface Props {
  /** Current dashboard filters — used to pre-fill "Save current search" */
  currentFilters: {
    selectedCategory: string | null;
    maxBudget: string;
    locationFilter: string;
  };
  userId: string;
  /** Called when the user clicks an existing saved search to apply it */
  onApplySearch: (search: SavedSearch) => void;
}

export function SavedSearches({ currentFilters, userId, onApplySearch }: Props) {
  const [open, setOpen] = useState(false);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) load();
  }, [open]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("saved_searches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (!error) setSearches(data || []);
    setLoading(false);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give your search a name");
      return;
    }
    if (
      !currentFilters.selectedCategory &&
      !currentFilters.maxBudget &&
      !currentFilters.locationFilter
    ) {
      toast.error("Set at least one filter before saving");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("saved_searches").insert({
      user_id: userId,
      name: trimmed,
      category: currentFilters.selectedCategory,
      max_budget: currentFilters.maxBudget ? Number(currentFilters.maxBudget) : null,
      location_keyword: currentFilters.locationFilter || null,
      notify_enabled: true,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Search saved — you'll be notified of matching jobs");
    setName("");
    load();
  };

  const toggleNotify = async (s: SavedSearch) => {
    const { error } = await supabase
      .from("saved_searches")
      .update({ notify_enabled: !s.notify_enabled })
      .eq("id", s.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSearches((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, notify_enabled: !x.notify_enabled } : x))
    );
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("saved_searches").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSearches((prev) => prev.filter((x) => x.id !== id));
    toast.success("Search deleted");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Saved searches"
          className="h-8 w-8 rounded-xl btn-press text-muted-foreground hover:text-foreground"
        >
          <Bookmark className="w-4 h-4" strokeWidth={2} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Saved searches</DialogTitle>
          <DialogDescription>
            Save your filters and we'll send a push when matching jobs post.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-b border-border pb-4">
          <Label htmlFor="search-name">Save current filters</Label>
          <div className="flex gap-2">
            <Input
              id="search-name"
              placeholder="e.g. Lawn care under $200"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <Button onClick={handleSave} disabled={saving} size="default">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Active filters:{" "}
            {[
              currentFilters.selectedCategory && `Category: ${currentFilters.selectedCategory}`,
              currentFilters.maxBudget && `Max $${currentFilters.maxBudget}`,
              currentFilters.locationFilter && `Location: ${currentFilters.locationFilter}`,
            ]
              .filter(Boolean)
              .join(" · ") || "None — set filters first"}
          </p>
        </div>

        <div className="space-y-2 mt-2">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : searches.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No saved searches yet. Save your first one above.
            </p>
          ) : (
            searches.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-lg liquid-glass p-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApplySearch(s);
                    setOpen(false);
                    toast.success(`Applied "${s.name}"`);
                  }}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[
                      s.category && `Category: ${s.category}`,
                      s.max_budget && `Max $${s.max_budget}`,
                      s.location_keyword && `Loc: ${s.location_keyword}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleNotify(s)}
                  className="p-1.5 rounded hover:bg-muted shrink-0"
                  aria-label={s.notify_enabled ? "Mute notifications" : "Enable notifications"}
                  title={s.notify_enabled ? "Notifications on" : "Notifications off"}
                >
                  {s.notify_enabled ? (
                    <Bell className="w-4 h-4 text-primary" />
                  ) : (
                    <BellOff className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="p-1.5 rounded hover:bg-destructive/10 shrink-0"
                  aria-label="Delete saved search"
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
