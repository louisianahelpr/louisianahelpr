import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import {
  X, MapPin, Clock, ChevronDown, MoreHorizontal, ArrowUpRight,
  ArrowUpDown, LayoutGrid, CalendarRange, Rocket,
  type LucideIcon,
} from "lucide-react";
import {
  categoryLabels, categoryIcons, categoryColors,
} from "@/components/activity/activityConstants";

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
  boostedOnly: boolean;
  setBoostedOnly: (v: boolean) => void;
  userLocStatus?: "idle" | "loading" | "ready" | "error";
  userLocMessage?: string;
}

const chipBase =
  "inline-flex items-center gap-1 px-2 rounded-full text-[9px] font-semibold tracking-tight transition-all duration-200 btn-press squircle border h-[22px]";
const chipActive =
  "bg-primary text-primary-foreground border-primary shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.45)]";
const chipIdle =
  "bg-white/70 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90";

// Brand-tinted gradient surface — used for popovers and accordion content.
// Light mint-to-white in light mode, subtle dark in dark mode.
const surfaceGradient =
  "bg-gradient-to-br from-[hsl(var(--primary)/0.08)] via-background to-background dark:from-[hsl(var(--primary)/0.12)] dark:via-card dark:to-card";

// Dropdown-trigger button used in the horizontal filter bar — full-width
// inside its grid cell so the four filters split the row evenly.
const triggerBase =
  "w-full inline-flex items-center justify-between gap-1.5 h-8 px-3 rounded-full text-[10.5px] font-semibold tracking-tight leading-none transition-all btn-press squircle border whitespace-nowrap";

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "highest_pay", label: "Highest pay" },
  { value: "lowest_pay", label: "Lowest pay" },
  { value: "ending_soon", label: "Ending soon" },
];

const expiresOptions = [
  { value: "", label: "Any time" },
  { value: "24h", label: "24 hours" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

// ---------------- Reusable filter content blocks ----------------

const SortContent = ({
  sortBy, setSortBy,
}: { sortBy: string; setSortBy: (v: string) => void }) => (
  <div className="grid grid-cols-4 gap-1">
    {sortOptions.map((opt) => (
      <button
        key={opt.value}
        onClick={() => setSortBy(opt.value)}
        className={`${chipBase} w-full justify-center px-1 text-[8.5px] ${sortBy === opt.value ? chipActive : chipIdle}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const CategoryContent = ({
  selectedCategory, setSelectedCategory,
}: { selectedCategory: string | null; setSelectedCategory: (v: string | null) => void }) => (
  // Single-line horizontal scroll — fits all 10 categories without
  // wrapping onto a second/third row, no matter the viewport width.
  <div className="-mx-2 px-2 overflow-x-auto scrollbar-hide">
    <div className="flex items-center gap-1.5 pb-0.5 w-max">
      {Object.entries(categoryLabels).map(([key, label]) => {
        const Icon = categoryIcons[key] ?? MoreHorizontal;
        const isActive = selectedCategory === key;
        const titleColor = (categoryColors[key] || categoryColors.other).title;
        return (
          <button
            key={key}
            onClick={() => setSelectedCategory(isActive ? null : key)}
            className={`${chipBase} shrink-0 ${isActive ? chipActive : chipIdle}`}
          >
            <Icon className={`w-2.5 h-2.5 ${isActive ? "" : titleColor}`} strokeWidth={2.25} />
            {label}
          </button>
        );
      })}
    </div>
  </div>
);

const radiusOptions = [5, 10, 25, 50];

const NearbyContent = ({
  locationFilter, setLocationFilter, status, message,
}: {
  locationFilter: string;
  setLocationFilter: (v: string) => void;
  status?: "idle" | "loading" | "ready" | "error";
  message?: string;
}) => {
  const current = locationFilter.startsWith("nearby:") ? parseFloat(locationFilter.slice(7)) : null;
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Nearby radius</p>
      <div className="grid grid-cols-4 gap-1.5">
        {radiusOptions.map((mi) => {
          const active = current === mi;
          return (
            <button
              key={mi}
              type="button"
              onClick={() => setLocationFilter(active ? "" : `nearby:${mi}`)}
              className={`${chipBase} w-full justify-center ${active ? chipActive : chipIdle}`}
            >
              {mi} mi
            </button>
          );
        })}
      </div>
      {current !== null && status === "loading" && (
        <p className="text-[11px] text-muted-foreground mt-2">Getting your location…</p>
      )}
      {current !== null && status === "error" && (
        <p className="text-[11px] text-destructive mt-2">{message || "Couldn't get your location"}</p>
      )}
      {current !== null && status === "ready" && (
        <p className="text-[11px] text-muted-foreground mt-2">Showing jobs within {current} miles of you</p>
      )}
    </div>
  );
};

const ExpiresContent = ({
  expiresWithin, setExpiresWithin,
}: { expiresWithin: string; setExpiresWithin: (v: string) => void }) => (
  <div className="grid grid-cols-4 gap-1.5">
    {expiresOptions.map((opt) => (
      <button
        key={opt.value}
        onClick={() => setExpiresWithin(expiresWithin === opt.value ? "" : opt.value)}
        className={`${chipBase} w-full justify-center ${expiresWithin === opt.value ? chipActive : chipIdle}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const AvailabilityContent = ({
  matchAvailability, setMatchAvailability, hasAvailability,
}: {
  matchAvailability: boolean; setMatchAvailability: (v: boolean) => void; hasAvailability: boolean;
}) => {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between gap-3 w-full">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Clock className="w-3.5 h-3.5 shrink-0 text-primary" strokeWidth={2.25} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-foreground leading-snug">Only my hours</p>
          {!hasAvailability && (
            <button
              type="button"
              onClick={() => navigate("/availability")}
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors btn-press"
            >
              Set hours
              <ArrowUpRight className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>
      <Switch
        checked={matchAvailability}
        onCheckedChange={setMatchAvailability}
        disabled={!hasAvailability}
        aria-label="Match my availability"
        className="shrink-0"
      />
    </div>
  );
};

// ---------------- Mobile dropdown trigger ----------------

interface DropdownProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  children: React.ReactNode;
}

const MobileDropdown = ({ icon: Icon, label, active, children }: DropdownProps) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        className={`${triggerBase} ${
          active
            ? "bg-primary text-primary-foreground border-primary shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.45)]"
            : "bg-white/80 dark:bg-card/70 backdrop-blur text-foreground border-border/60 hover:border-primary/50"
        }`}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <Icon className={`w-3 h-3 shrink-0 ${active ? "" : "text-primary"}`} strokeWidth={2.25} />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="w-3 h-3 opacity-70 shrink-0" />
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      sideOffset={8}
      collisionPadding={{ bottom: 96, top: 12, left: 12, right: 12 }}
      className={`w-[min(92vw,340px)] rounded-2xl squircle border border-border/40 ring-1 ring-border/20 shadow-2xl ${surfaceGradient} p-0 overflow-hidden`}
    >
      <div
        className="max-h-[min(60vh,calc(100dvh-9rem))] overflow-y-auto overscroll-contain p-3"
        style={{
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 16px), transparent 100%)",
          maskImage:
            "linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 16px), transparent 100%)",
        }}
      >
        {children}
      </div>
    </PopoverContent>
  </Popover>
);

// ---------------- Main component ----------------

const JobFilters = ({
  searchQuery: _searchQuery, setSearchQuery, selectedCategory, setSelectedCategory,
  maxBudget, setMaxBudget, locationFilter, setLocationFilter,
  sortBy, setSortBy, filtersOpen: _filtersOpen, setFiltersOpen: _setFiltersOpen,
  expiresWithin, setExpiresWithin,
  matchAvailability, setMatchAvailability, hasAvailability,
  boostedOnly, setBoostedOnly,
  userLocStatus, userLocMessage,
}: JobFiltersProps) => {
  const activeFilterCount = [
    selectedCategory, maxBudget, locationFilter, expiresWithin, matchAvailability ? "on" : "", boostedOnly ? "on" : "",
  ].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
    setMatchAvailability(false);
    setBoostedOnly(false);
  };

  const sortLabel = sortOptions.find((o) => o.value === sortBy)?.label ?? "Sort";
  const categoryLabel = selectedCategory ? categoryLabels[selectedCategory] : "Category";
  const nearbyMi = locationFilter.startsWith("nearby:") ? locationFilter.slice(7) : null;
  const placeBudgetLabel = nearbyMi ? `${nearbyMi} mi` : "Nearby";

  const whenLabel = expiresWithin
    ? (expiresOptions.find((o) => o.value === expiresWithin)?.label ?? "When")
    : matchAvailability
      ? "My hours"
      : "When";

  // Horizontal pill bar — Sort by · Category · Where · When. Click any
  // pill and a popover drops down with that filter's content. Keeps the
  // panel compact (single row + transient popover) instead of stacking
  // multiple expandable sections vertically.
  return (
    <div className="px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span
          className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
          style={{ color: "hsl(var(--burnt-sienna))" }}
        >
          Filters {activeFilterCount > 0 && `· ${activeFilterCount} active`}
        </span>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-[0.7rem] font-sans font-medium hover:underline transition-opacity"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            <X className="w-3 h-3 inline-block mr-0.5 -mt-px" /> Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
          <MobileDropdown icon={ArrowUpDown} label={sortLabel} active={sortBy !== "newest"}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Sort by</p>
            <SortContent sortBy={sortBy} setSortBy={setSortBy} />
          </MobileDropdown>

          <MobileDropdown icon={LayoutGrid} label={categoryLabel} active={!!selectedCategory}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Category</p>
            <CategoryContent
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
            />
          </MobileDropdown>

          <MobileDropdown icon={MapPin} label={placeBudgetLabel} active={!!locationFilter}>
            <NearbyContent
              locationFilter={locationFilter}
              setLocationFilter={setLocationFilter}
              status={userLocStatus}
              message={userLocMessage}
            />
          </MobileDropdown>

          <MobileDropdown icon={CalendarRange} label={whenLabel} active={!!expiresWithin || matchAvailability}>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Expires within</p>
                <ExpiresContent expiresWithin={expiresWithin} setExpiresWithin={setExpiresWithin} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Match my availability</p>
                <AvailabilityContent
                  matchAvailability={matchAvailability}
                  setMatchAvailability={setMatchAvailability}
                  hasAvailability={hasAvailability}
                />
              </div>
            </div>
          </MobileDropdown>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setBoostedOnly(!boostedOnly)}
          aria-pressed={boostedOnly}
          className={`${chipBase} shrink-0 ${boostedOnly ? chipActive : chipIdle}`}
          style={
            boostedOnly
              ? {
                  background: "linear-gradient(90deg, hsl(var(--gold-warm) / 0.85), hsl(var(--primary)))",
                  borderColor: "hsl(var(--gold-warm) / 0.6)",
                  color: "white",
                }
              : undefined
          }
        >
          <Rocket className="w-2.5 h-2.5" strokeWidth={2.25} />
          Boosted only
        </button>
      </div>
    </div>
  );
};

export default JobFilters;
