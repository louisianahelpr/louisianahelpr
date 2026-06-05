import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  X, MapPin, Clock, ChevronDown, ArrowUpRight,
  ArrowUpDown, LayoutGrid, CalendarRange, Rocket,
  type LucideIcon,
} from "lucide-react";
import {
  categoryLabels, categoryColors,
} from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { hapticLight } from "@/lib/haptics";

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
  "inline-flex items-center gap-1 px-2.5 rounded-full text-[10px] font-semibold tracking-tight transition-all duration-200 btn-press squircle border h-8";
const chipActive =
  "bg-primary text-primary-foreground border-primary shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.45)]";
const chipIdle =
  "bg-white/70 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90";

// Solid surface used for popovers. Was previously a translucent
// gradient that let the "Boosted only" pill bleed through — now an
// opaque white/card surface so the popover always reads as a discrete
// floating panel.
const surfaceGradient =
  "bg-background dark:bg-card";

// Dropdown-trigger button used in the filter pill row. Sized to its
// content so the icon + label both stay visible in the horizontal
// scroll row instead of getting crushed to icon-only circles when the
// flex container tries to share width across 5 chips on a narrow phone.
const triggerBase =
  "inline-flex items-center justify-between gap-1.5 h-9 pl-3 pr-2.5 rounded-full text-[12px] font-semibold tracking-tight leading-none transition-all btn-press squircle border whitespace-nowrap shrink-0";

const sortOptions = [
  // "Best match" (value "smart") is the default — a composite recency +
  // budget + urgency + proximity score. See src/lib/smartSort.ts. The
  // user-facing label avoids the opaque "Smart" jargon.
  { value: "smart", label: "Best match" },
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
  sortBy, setSortBy, onSelect,
}: { sortBy: string; setSortBy: (v: string) => void; onSelect?: () => void }) => (
  <div className="grid grid-cols-2 gap-1.5">
    {sortOptions.map((opt) => (
      <button
        key={opt.value}
        onClick={() => { hapticLight(); setSortBy(opt.value); onSelect?.(); }}
        className={`${chipBase} w-full justify-center px-2 h-8 text-ds-11 ${sortBy === opt.value ? chipActive : chipIdle}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const CategoryContent = ({
  selectedCategory, setSelectedCategory, onSelect,
}: { selectedCategory: string | null; setSelectedCategory: (v: string | null) => void; onSelect?: () => void }) => (
  // Single-line horizontal scroll — fits all 10 categories without
  // wrapping onto a second/third row, no matter the viewport width.
  <div className="-mx-2 px-2 overflow-x-auto scrollbar-hide">
    <div className="flex items-center gap-1.5 pb-0.5 w-max">
      {Object.entries(categoryLabels).map(([key, label]) => {
        const isActive = selectedCategory === key;
        const titleColor = (categoryColors[key] || categoryColors.other).title;
        return (
          <button
            key={key}
            onClick={() => { hapticLight(); setSelectedCategory(isActive ? null : key); onSelect?.(); }}
            className={`${chipBase} shrink-0 ${isActive ? chipActive : chipIdle}`}
          >
            <CategoryIcon
              category={key}
              aria-hidden
              className={`w-2.5 h-2.5 ${isActive ? "" : titleColor}`}
              strokeWidth={2.25}
            />
            {label}
          </button>
        );
      })}
    </div>
  </div>
);

const radiusOptions = [5, 10, 25, 50];

const NearbyContent = ({
  locationFilter, setLocationFilter, status, message, onSelect,
}: {
  locationFilter: string;
  setLocationFilter: (v: string) => void;
  status?: "idle" | "loading" | "ready" | "error";
  message?: string;
  onSelect?: () => void;
}) => {
  const current = locationFilter.startsWith("nearby:") ? parseFloat(locationFilter.slice(7)) : null;
  return (
    <div>
      <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest mb-2">Nearby radius</p>
      <div className="grid grid-cols-4 gap-1.5">
        {radiusOptions.map((mi) => {
          const active = current === mi;
          return (
            <button
              key={mi}
              type="button"
              onClick={() => { hapticLight(); setLocationFilter(active ? "" : `nearby:${mi}`); onSelect?.(); }}
              className={`${chipBase} w-full justify-center ${active ? chipActive : chipIdle}`}
            >
              {mi} mi
            </button>
          );
        })}
      </div>
      {current !== null && status === "loading" && (
        <p className="text-ds-11 text-muted-foreground mt-2">Getting your location…</p>
      )}
      {current !== null && status === "error" && (
        <p className="text-ds-11 text-destructive mt-2">{message || "Couldn't get your location"}</p>
      )}
      {current !== null && status === "ready" && (
        <p className="text-ds-11 text-muted-foreground mt-2">Showing jobs within {current} miles of you</p>
      )}
    </div>
  );
};

const ExpiresContent = ({
  expiresWithin, setExpiresWithin, onSelect,
}: { expiresWithin: string; setExpiresWithin: (v: string) => void; onSelect?: () => void }) => (
  <div className="grid grid-cols-4 gap-1.5">
    {expiresOptions.map((opt) => (
      <button
        key={opt.value}
        onClick={() => { hapticLight(); setExpiresWithin(expiresWithin === opt.value ? "" : opt.value); onSelect?.(); }}
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
          <p className="text-ds-11 font-semibold text-foreground leading-snug">Only my hours</p>
          {!hasAvailability && (
            <button
              type="button"
              onClick={() => navigate("/availability")}
              className="inline-flex items-center gap-0.5 text-ds-10 font-semibold text-primary hover:text-primary/80 transition-colors btn-press"
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
  /** Function-as-children so the popover can hand its `close()` down
      to the inner content. Selection handlers call `close()` and the
      popover dismisses itself instead of lingering on top of the list. */
  children: (close: () => void) => React.ReactNode;
}

const MobileDropdown = ({ icon: Icon, label, active, children }: DropdownProps) => {
  const [open, setOpen] = useState(false);
  return (
  <Popover open={open} onOpenChange={setOpen}>
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
        {children(() => setOpen(false))}
      </div>
    </PopoverContent>
  </Popover>
  );
};

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

  // Single horizontal-scroll row of filter pills. Each pill is a popover
  // trigger; tapping one drops the relevant filter content as a floating
  // panel instead of expanding the page. Boosted lives in the same row
  // as a toggle pill. Clear-all tucks in at the end when filters apply.
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-3 px-3">
        <MobileDropdown icon={ArrowUpDown} label={sortLabel} active={sortBy !== "smart"}>
          {(close) => (
            <>
              <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest mb-2">Sort by</p>
              <SortContent sortBy={sortBy} setSortBy={setSortBy} onSelect={close} />
            </>
          )}
        </MobileDropdown>

        <MobileDropdown icon={LayoutGrid} label={categoryLabel} active={!!selectedCategory}>
          {(close) => (
            <>
              <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest mb-2">Category</p>
              <CategoryContent
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                onSelect={close}
              />
            </>
          )}
        </MobileDropdown>

        <MobileDropdown icon={MapPin} label={placeBudgetLabel} active={!!locationFilter}>
          {(close) => (
            <NearbyContent
              locationFilter={locationFilter}
              setLocationFilter={setLocationFilter}
              status={userLocStatus}
              message={userLocMessage}
              onSelect={close}
            />
          )}
        </MobileDropdown>

        <MobileDropdown icon={CalendarRange} label={whenLabel} active={!!expiresWithin || matchAvailability}>
          {(close) => (
            <div className="space-y-3">
              <div>
                <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest mb-2">Expires within</p>
                <ExpiresContent expiresWithin={expiresWithin} setExpiresWithin={setExpiresWithin} onSelect={close} />
              </div>
              <div>
                <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest mb-2">Match my availability</p>
                <AvailabilityContent
                  matchAvailability={matchAvailability}
                  setMatchAvailability={setMatchAvailability}
                  hasAvailability={hasAvailability}
                />
              </div>
            </div>
          )}
        </MobileDropdown>

        <button
          type="button"
          onClick={() => setBoostedOnly(!boostedOnly)}
          aria-pressed={boostedOnly}
          className={`${triggerBase} shrink-0`}
          style={
            boostedOnly
              ? {
                  background: "linear-gradient(90deg, hsl(var(--gold-warm) / 0.92), hsl(var(--burnt-sienna)))",
                  borderColor: "hsl(var(--gold-warm) / 0.6)",
                  color: "white",
                  boxShadow: "0 4px 14px -4px hsl(var(--gold-warm) / 0.45)",
                }
              : undefined
          }
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Rocket className="w-3 h-3 shrink-0" strokeWidth={2.25} />
            <span className="truncate">Boosted</span>
          </span>
        </button>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 h-9 rounded-full text-[0.72rem] font-sans font-semibold tracking-wide active:opacity-70 transition-opacity"
            style={{
              color: "hsl(var(--burnt-sienna))",
              background: "hsl(var(--burnt-sienna) / 0.10)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <X className="w-3 h-3" strokeWidth={2.25} /> Clear
            {activeFilterCount > 0 && (
              <span
                className="ml-0.5 px-1 py-0.5 rounded-full text-[8.5px] font-bold tabular-nums"
                style={{ background: "hsl(var(--burnt-sienna) / 0.18)" }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default JobFilters;
