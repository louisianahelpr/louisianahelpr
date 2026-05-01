import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  X, MapPin, Clock, ChevronDown,
  Sparkles, Leaf, Truck, ShoppingBag, Wrench, Paintbrush,
  Package, PawPrint, Hammer, MoreHorizontal, ArrowUpRight,
  ArrowUpDown, LayoutGrid, CalendarClock, CalendarRange,
  type LucideIcon,
} from "lucide-react";

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

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
  userLocStatus?: "idle" | "loading" | "ready" | "error";
  userLocMessage?: string;
}

const chipBase =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-tight transition-all duration-200 btn-press squircle border";
const chipActive =
  "bg-primary text-primary-foreground border-primary shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.45)]";
const chipIdle =
  "bg-white/70 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90";

// Brand-tinted gradient surface — used for popovers and accordion content.
// Light mint-to-white in light mode, subtle dark in dark mode.
const surfaceGradient =
  "bg-gradient-to-br from-[hsl(var(--primary)/0.08)] via-background to-background dark:from-[hsl(var(--primary)/0.12)] dark:via-card dark:to-card";

// Dropdown-trigger button used in the mobile filter bar.
const triggerBase =
  "inline-flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-semibold tracking-tight leading-none transition-all btn-press squircle border whitespace-nowrap shrink-0";

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
  <div className="flex flex-wrap gap-1.5">
    {sortOptions.map((opt) => (
      <button
        key={opt.value}
        onClick={() => setSortBy(opt.value)}
        className={`${chipBase} ${sortBy === opt.value ? chipActive : chipIdle}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const CategoryContent = ({
  selectedCategory, setSelectedCategory,
}: { selectedCategory: string | null; setSelectedCategory: (v: string | null) => void }) => (
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
      <div className="flex flex-wrap gap-1.5">
        {radiusOptions.map((mi) => {
          const active = current === mi;
          return (
            <button
              key={mi}
              type="button"
              onClick={() => setLocationFilter(active ? "" : `nearby:${mi}`)}
              className={`${chipBase} ${active ? chipActive : chipIdle}`}
            >
              <MapPin className={`w-3.5 h-3.5 ${active ? "" : "text-primary"}`} strokeWidth={2.25} />
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
  <div className="flex flex-wrap gap-1.5">
    {expiresOptions.map((opt) => (
      <button
        key={opt.value}
        onClick={() => setExpiresWithin(expiresWithin === opt.value ? "" : opt.value)}
        className={`${chipBase} ${expiresWithin === opt.value ? chipActive : chipIdle}`}
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
              onClick={() => navigate("/availability")}
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
  );
};

// ---------------- Desktop accordion section ----------------

interface SectionProps {
  icon: LucideIcon;
  label: string;
  badge?: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Section = ({ icon: Icon, label, badge, defaultOpen = true, children }: SectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-xl px-2 py-2 text-left squircle hover:bg-primary/5 transition-colors">
        <span className="inline-flex items-center gap-2">
          <Icon className={`w-4 h-4 ${badge ? "text-primary" : "text-muted-foreground"}`} strokeWidth={2.25} />
          <span className={`text-xs font-bold uppercase tracking-wider ${badge ? "text-primary" : "text-foreground"}`}>
            {label}
          </span>
          {badge && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
              {badge}
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
        <div className="pt-2 pb-1 px-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
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
        <Icon className={`w-3.5 h-3.5 ${active ? "" : "text-primary"}`} strokeWidth={2.25} />
        {label}
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
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
  userLocStatus, userLocMessage,
}: JobFiltersProps) => {
  const activeFilterCount = [
    selectedCategory, maxBudget, locationFilter, expiresWithin, matchAvailability ? "on" : "",
  ].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory(null);
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
    setMatchAvailability(false);
  };

  const sortLabel = sortOptions.find((o) => o.value === sortBy)?.label ?? "Sort";
  const categoryLabel = selectedCategory ? categoryLabels[selectedCategory] : "Category";
  const expiresLabel = expiresWithin
    ? expiresOptions.find((o) => o.value === expiresWithin)?.label ?? "Expires"
    : "Expires";
  const nearbyMi = locationFilter.startsWith("nearby:") ? locationFilter.slice(7) : null;
  const placeBudgetLabel = nearbyMi ? `${nearbyMi} mi` : "Nearby";

  return (
    <div className={`overflow-hidden ${surfaceGradient}`}>
      {/* ============ MOBILE: horizontal dropdown bar ============ */}
      <div className="md:hidden px-3 py-3">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
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

          <MobileDropdown icon={CalendarClock} label={expiresLabel} active={!!expiresWithin}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Expires within</p>
            <ExpiresContent expiresWithin={expiresWithin} setExpiresWithin={setExpiresWithin} />
          </MobileDropdown>

          <MobileDropdown icon={Clock} label={matchAvailability ? "My hours" : "Availability"} active={matchAvailability}>
            <AvailabilityContent
              matchAvailability={matchAvailability}
              setMatchAvailability={setMatchAvailability}
              hasAvailability={hasAvailability}
            />
          </MobileDropdown>
        </div>

        {hasFilters && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground text-xs h-8 rounded-full squircle hover:bg-destructive/10 hover:text-destructive btn-press"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Clear all ({activeFilterCount})
            </Button>
          </div>
        )}
      </div>

      {/* ============ DESKTOP: collapsible accordion sections ============ */}
      <div className="hidden md:block px-4 py-4 space-y-1">
        <Section icon={ArrowUpDown} label="Sort" badge={sortBy !== "newest" ? sortLabel : null}>
          <SortContent sortBy={sortBy} setSortBy={setSortBy} />
        </Section>

        <Section
          icon={LayoutGrid}
          label="Category"
          badge={selectedCategory ? categoryLabels[selectedCategory] : null}
        >
          <CategoryContent
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
          />
        </Section>

        <Section
          icon={MapPin}
          label="Nearby"
          badge={nearbyMi ? `${nearbyMi} mi` : null}
        >
          <NearbyContent
            locationFilter={locationFilter}
            setLocationFilter={setLocationFilter}
            status={userLocStatus}
            message={userLocMessage}
          />
        </Section>

        <Section
          icon={CalendarRange}
          label="Expires within"
          badge={expiresWithin ? expiresOptions.find((o) => o.value === expiresWithin)?.label ?? null : null}
        >
          <ExpiresContent expiresWithin={expiresWithin} setExpiresWithin={setExpiresWithin} />
        </Section>

        <Section
          icon={Clock}
          label="Availability"
          badge={matchAvailability ? "On" : null}
        >
          <AvailabilityContent
            matchAvailability={matchAvailability}
            setMatchAvailability={setMatchAvailability}
            hasAvailability={hasAvailability}
          />
        </Section>

        {hasFilters && (
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground text-xs h-9 rounded-full squircle hover:bg-destructive/10 hover:text-destructive btn-press"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Clear all filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default JobFilters;
