import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNavigate } from "react-router-dom";
import {
  X, MapPin, DollarSign, Clock,
  Sparkles, Leaf, Truck, ShoppingBag, Wrench, Paintbrush,
  Package, PawPrint, Hammer, MoreHorizontal, ArrowUpRight,
  type LucideIcon,
} from "lucide-react";

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

// Unified Lucide icon set — replaces emoji for consistent stroke weight
// and visual harmony with the rest of the app.
const categoryIcons: Record<string, LucideIcon> = {
  cleaning: Sparkles, yard_work: Leaf, moving: Truck, errands: ShoppingBag,
  handyman: Wrench, painting: Paintbrush, delivery: Package, pet_care: PawPrint,
  assembly: Hammer, other: MoreHorizontal,
};

export { categoryLabels };

interface JobFiltersProps {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  selectedCategory: string | null;
  setSelectedCategory: (v: string | null) => void;
  maxBudget: string;
  setMaxBudget: (v: string) => void;
  locationFilter: string;
  setLocationFilter: (v: string) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  filtersOpen: boolean;
  setFiltersOpen: (v: boolean) => void;
  expiresWithin: string;
  setExpiresWithin: (v: string) => void;
  matchAvailability: boolean;
  setMatchAvailability: (v: boolean) => void;
  hasAvailability: boolean;
}

// Shared chip styles — ensures Sort, Category, and Expires chips look identical.
const chipBase =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-tight transition-all duration-200 btn-press squircle border";
const chipActive =
  "bg-primary text-primary-foreground border-primary shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.45)]";
const chipIdle =
  "bg-white/60 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90";

const JobFilters = ({
  searchQuery: _searchQuery, setSearchQuery, selectedCategory, setSelectedCategory,
  maxBudget, setMaxBudget, locationFilter, setLocationFilter,
  sortBy, setSortBy, filtersOpen: _filtersOpen, setFiltersOpen: _setFiltersOpen,
  expiresWithin, setExpiresWithin,
  matchAvailability, setMatchAvailability, hasAvailability,
}: JobFiltersProps) => {
  const navigate = useNavigate();
  const activeFilterCount = [selectedCategory, maxBudget, locationFilter, expiresWithin, matchAvailability ? "on" : ""].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
    setMatchAvailability(false);
  };

  return (
    <div className="overflow-hidden">
      <div className="space-y-5 px-4 py-4">
        {/* Sort */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Sort by</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "newest", label: "Newest" },
              { value: "highest_pay", label: "Highest pay" },
              { value: "lowest_pay", label: "Lowest pay" },
              { value: "ending_soon", label: "Ending soon" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={`${chipBase} ${sortBy === opt.value ? chipActive : chipIdle}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category pills */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Category</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(categoryLabels).map(([key, label]) => {
              const Icon = categoryIcons[key] ?? MoreHorizontal;
              const isActive = selectedCategory === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedCategory(isActive ? null : key)}
                  className={`${chipBase} ${isActive ? chipActive : chipIdle}`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "" : "text-primary"}`} strokeWidth={2.25} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Location & Budget */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Location</p>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70" />
              <Input
                placeholder="City or parish"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="pl-9 h-10 text-sm rounded-xl squircle border-border bg-white/80 dark:bg-card/80 placeholder:text-muted-foreground/80 focus:bg-background focus:border-primary/60 focus:ring-2 focus:ring-primary/15 transition-all"
              />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Max budget</p>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70" />
              <Input
                type="number"
                inputMode="numeric"
                placeholder="No limit"
                value={maxBudget}
                onChange={(e) => setMaxBudget(e.target.value)}
                className="pl-9 h-10 text-sm rounded-xl squircle border-border bg-white/80 dark:bg-card/80 placeholder:text-muted-foreground/80 focus:bg-background focus:border-primary/60 focus:ring-2 focus:ring-primary/15 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Expires within */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Expires within</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "", label: "Any time" },
              { value: "24h", label: "24 hours" },
              { value: "3d", label: "3 days" },
              { value: "7d", label: "7 days" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setExpiresWithin(expiresWithin === opt.value ? "" : opt.value)}
                className={`${chipBase} ${expiresWithin === opt.value ? chipActive : chipIdle}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Match availability — actionable when no schedule is set */}
        <div
          className={`squircle rounded-2xl glass-card p-3.5 flex items-center justify-between gap-3 ${
            !hasAvailability ? "ring-1 ring-primary/20" : ""
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary/12 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Match my availability</p>
              {hasAvailability ? (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Only show jobs on days &amp; times I'm free
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate("/schedule")}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors btn-press"
                >
                  Set your hours in Schedule
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <Switch
            checked={matchAvailability}
            onCheckedChange={setMatchAvailability}
            disabled={!hasAvailability}
            aria-label="Match my availability"
          />
        </div>

        {/* Clear all */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground text-xs h-9 rounded-full squircle hover:bg-destructive/10 hover:text-destructive btn-press"
          >
            <X className="w-3.5 h-3.5 mr-1" /> Clear all filters
          </Button>
        )}
      </div>
    </div>
  );
};

export default JobFilters;
