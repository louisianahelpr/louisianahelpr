import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search, X, MapPin, DollarSign, SlidersHorizontal, ChevronDown, ChevronUp, Timer,
} from "lucide-react";

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
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
  const activeFilterCount = [searchQuery, selectedCategory, maxBudget, locationFilter, expiresWithin].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
  };

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input placeholder="Search tasks…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 pr-8 h-8 text-sm" />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <button onClick={() => setFiltersOpen(!filtersOpen)} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
        <SlidersHorizontal className="w-3.5 h-3.5" /><span>Filters</span>
        {activeFilterCount > 0 && <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">{activeFilterCount}</span>}
        <span className="flex-1" />
        {filtersOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {filtersOpen && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Category</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(categoryLabels).map(([key, label]) => (
                <button key={key} onClick={() => setSelectedCategory(selectedCategory === key ? null : key)}
                  className={`px-2 py-1 rounded-full text-[11px] font-medium transition-colors ${selectedCategory === key ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Location</p>
              <div className="relative">
                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input placeholder="Any location" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="pl-7 text-xs h-8" />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Max budget</p>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input type="number" placeholder="No limit" value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} className="pl-7 text-xs h-8" />
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Expires within</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: "", label: "Any time" },
                { value: "24h", label: "24 hours" },
                { value: "3d", label: "3 days" },
                { value: "7d", label: "7 days" },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setExpiresWithin(expiresWithin === opt.value ? "" : opt.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${expiresWithin === opt.value ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                  <Timer className="w-3 h-3 inline mr-1" />{opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Sort by</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: "newest", label: "Newest" },
                { value: "highest_pay", label: "Highest pay" },
                { value: "lowest_pay", label: "Lowest pay" },
                { value: "ending_soon", label: "Ending soon" },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setSortBy(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${sortBy === opt.value ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Clear all</Button>}
        </div>
      )}
      {!filtersOpen && hasFilters && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCategory && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{categoryLabels[selectedCategory]}<button onClick={() => setSelectedCategory(null)}><X className="w-3 h-3" /></button></span>}
          {locationFilter && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{locationFilter}<button onClick={() => setLocationFilter("")}><X className="w-3 h-3" /></button></span>}
          {maxBudget && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">≤ ${maxBudget}<button onClick={() => setMaxBudget("")}><X className="w-3 h-3" /></button></span>}
          {expiresWithin && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">Expires: {expiresWithin}<button onClick={() => setExpiresWithin("")}><X className="w-3 h-3" /></button></span>}
        </div>
      )}
    </div>
  );
};

export default JobFilters;
