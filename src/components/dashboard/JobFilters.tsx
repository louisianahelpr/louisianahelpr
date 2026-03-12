import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  X, MapPin, DollarSign, Timer,
} from "lucide-react";

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

const categoryIcons: Record<string, string> = {
  cleaning: "🧹", yard_work: "🌿", moving: "📦", errands: "🏃",
  handyman: "🔧", painting: "🎨", delivery: "🚗", pet_care: "🐾",
  assembly: "🪛", other: "📋",
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
}

const JobFilters = ({
  searchQuery, setSearchQuery, selectedCategory, setSelectedCategory,
  maxBudget, setMaxBudget, locationFilter, setLocationFilter,
  sortBy, setSortBy, filtersOpen, setFiltersOpen,
  expiresWithin, setExpiresWithin,
}: JobFiltersProps) => {
  const activeFilterCount = [selectedCategory, maxBudget, locationFilter, expiresWithin].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
  };

  return (
    <div className="overflow-hidden">
      <div className="space-y-4 px-4 py-3">
        {/* Category pills */}
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Category</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(categoryLabels).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSelectedCategory(selectedCategory === key ? null : key)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-200 btn-press ${
                  selectedCategory === key
                    ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]"
                    : "bg-secondary/70 text-secondary-foreground hover:bg-secondary"
                }`}
              >
                <span className="text-xs">{categoryIcons[key]}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Location & Budget */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Location</p>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Any location" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="pl-8 text-xs h-9 rounded-xl border-border/50 bg-muted/30 focus:bg-background transition-colors" />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Max budget</p>
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input type="number" placeholder="No limit" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} className="pl-8 text-xs h-9 rounded-xl border-border/50 bg-muted/30 focus:bg-background transition-colors" />
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
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-200 btn-press ${
                  expiresWithin === opt.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-secondary/70 text-secondary-foreground hover:bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

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
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-200 btn-press ${
                  sortBy === opt.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-secondary/70 text-secondary-foreground hover:bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Clear all */}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground text-xs h-8 rounded-xl hover:bg-destructive/10 hover:text-destructive btn-press">
            <X className="w-3.5 h-3.5 mr-1" /> Clear all filters
          </Button>
        )}
      </div>
    </div>
  );
};

export default JobFilters;
