import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, Bookmark, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

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
      hapticError();
      toast.error("Give your search a name");
      return;
    }
    if (
      !currentFilters.selectedCategory &&
      !currentFilters.maxBudget &&
      !currentFilters.locationFilter
    ) {
      hapticError();
      toast.error("Set at least one filter before saving");
      return;
    }
    hapticMedium();
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
      hapticError();
      toast.error(error.message);
      return;
    }
    hapticSuccess();
    toast.success("Search saved — you'll be notified of matching jobs");
    setName("");
    load();
  };

  const toggleNotify = async (s: SavedSearch) => {
    hapticLight();
    const { error } = await supabase
      .from("saved_searches")
      .update({ notify_enabled: !s.notify_enabled })
      .eq("id", s.id);
    if (error) {
      hapticError();
      toast.error(error.message);
      return;
    }
    setSearches((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, notify_enabled: !x.notify_enabled } : x))
    );
  };

  const remove = async (id: string) => {
    hapticMedium();
    const { error } = await supabase.from("saved_searches").delete().eq("id", id);
    if (error) {
      hapticError();
      toast.error(error.message);
      return;
    }
    setSearches((prev) => prev.filter((x) => x.id !== id));
    hapticSuccess();
    toast.success("Search deleted");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Saved searches"
          className="h-8 w-8 rounded-ds-md btn-press text-muted-foreground hover:text-foreground"
        >
          <Bookmark className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md gap-4"
        // Prevent Radix from auto-focusing the input, which pops the
        // iOS keyboard the moment the dialog opens. The user can tap
        // the field to focus when ready.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="!text-left space-y-0 pr-8">
          <span
            className="font-serif italic uppercase text-[0.62rem] inline-flex items-center gap-1.5"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            <Bookmark className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
            Get notified
          </span>
          <DialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            Saved searches
          </DialogTitle>
          <DialogDescription
            className="font-serif italic mt-1 text-[0.82rem] leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Save your filters and we'll send a push the moment a matching job posts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <Label
            htmlFor="search-name"
            className="font-serif italic uppercase text-[0.6rem]"
            style={{ color: "hsl(var(--olivewood) / 0.65)", letterSpacing: "0.16em" }}
          >
            Save current filters
          </Label>
          <div className="flex gap-2">
            <Input
              id="search-name"
              placeholder="e.g. Lawn care under $200"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="rounded-ds-md h-11 border-border/60 bg-white/80 focus-visible:bg-white focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
            />
            <Button
              variant="bark"
              onClick={handleSave}
              disabled={saving}
              className="h-11 w-11 p-0 rounded-ds-md shrink-0"
              aria-label="Save filter set"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2.25} />}
            </Button>
          </div>
          <p
            className="text-[11px] font-serif italic"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
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

        <div
          className="space-y-2 pt-3"
          style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : searches.length === 0 ? (
            <div className="flex flex-col items-center text-center px-6 py-6 gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                  border: "1px solid hsl(var(--olivewood) / 0.10)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                    "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
                }}
              >
                <Bookmark className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <p
                className="font-display italic font-bold text-[0.95rem]"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                No saved searches yet.
              </p>
              <p
                className="font-serif italic text-[0.78rem] leading-snug max-w-[280px]"
                style={{ color: "hsl(var(--olivewood) / 0.7)" }}
              >
                Set a filter combo above and save it — we'll ping you when fresh jobs match.
              </p>
            </div>
          ) : (
            searches.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-ds-md liquid-glass p-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApplySearch(s);
                    setOpen(false);
                    toast.success(`Applied "${s.name}"`);
                  }}
                  className="flex-1 text-left min-w-0 active:opacity-70 transition-opacity"
                >
                  <p
                    className="font-display italic font-bold text-[0.92rem] truncate"
                    style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                  >
                    {s.name}
                  </p>
                  <p
                    className="text-[11px] font-serif italic truncate mt-0.5"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    {[
                      s.category && `Category: ${s.category}`,
                      s.max_budget && `Max $${s.max_budget}`,
                      s.location_keyword && `Loc: ${s.location_keyword}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Any job"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleNotify(s)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-muted shrink-0 active:scale-[0.95] transition"
                  aria-label={s.notify_enabled ? "Mute notifications" : "Enable notifications"}
                  title={s.notify_enabled ? "Notifications on" : "Notifications off"}
                >
                  {s.notify_enabled ? (
                    <Bell className="w-4 h-4 text-primary" aria-hidden="true" />
                  ) : (
                    <BellOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-destructive/10 shrink-0 active:scale-[0.95] transition"
                  aria-label="Delete saved search"
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="pt-1">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            className="h-10 rounded-ds-md"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
