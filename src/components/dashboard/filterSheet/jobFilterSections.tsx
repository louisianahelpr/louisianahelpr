import type { ReactNode } from "react";
import { Bookmark, Clock, Rocket, SearchCheck, Zap } from "lucide-react";
import type { FilterSheetSection } from "@/components/dashboard/FilterSheet";
import {
  SortContent,
  CategoryContent,
  NearbyContent,
  WhenContent,
} from "@/components/dashboard/JobFilters";
import { PayRangeSlider, payRangeLabel } from "@/components/dashboard/filterSheet/PayRangeSlider";
import { AvailabilityRow, SignupRow, ToggleRow, WantsQuotesRow } from "@/components/dashboard/filterSheet/FilterSheetRows";

interface JobFilterSectionsArgs {
  selectedCategory: string | null;
  setSelectedCategory: (v: string | null) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  /* ---- Price range (board 24): the existing min/max budget state ---- */
  minBudget?: string;
  setMinBudget?: (v: string) => void;
  maxBudget?: string;
  setMaxBudget?: (v: string) => void;
  /* ---- When (board 24): the job's day, plus the legacy expiry window ---- */
  jobWhen?: string;
  setJobWhen?: (v: string) => void;
  expiresWithin: string;
  setExpiresWithin: (v: string) => void;
  boostedOnly: boolean;
  setBoostedOnly: (v: boolean) => void;
  urgentOnly: boolean;
  setUrgentOnly: (v: boolean) => void;
  /* ---- Distance (omit together with showNearby={false}) ---- */
  locationFilter?: string;
  setLocationFilter?: (v: string) => void;
  userLocStatus?: "idle" | "loading" | "ready" | "error";
  userLocMessage?: string;
  /* ---- "During my hours" row (omit together with showAvailability={false}) ---- */
  matchAvailability?: boolean;
  setMatchAvailability?: (v: boolean) => void;
  hasAvailability?: boolean;
  /** Hide the availability row (guests have no schedule). */
  showAvailability?: boolean;
  /* ---- "Saved jobs only" row (omit on surfaces without saves, e.g. guest) ---- */
  savedOnly?: boolean;
  onToggleSavedOnly?: () => void;
  savedCount?: number;
  /* ---- "Wants quotes" row: passed only while the hidden 'quotes' switch is on ---- */
  wantsQuotes?: boolean;
  onToggleWantsQuotes?: () => void;
  /**
   * Hide the Distance section. Default on: the radius is a client-side
   * haversine over the view's masked coordinates fed by browser geolocation,
   * which needs no account (BD-001), so a signed-out visitor can use it too.
   * No radius is selected by default and nothing asks for location until a
   * distance chip is tapped (lead, board 24: farther jobs must stay visible).
   */
  showNearby?: boolean;
  /** "Saved searches" action row at the end of "Show only" (signed-in only). */
  savedSearchesButton?: ReactNode;
  /**
   * Set on a signed-out surface: where the three account-only controls send a
   * visitor. "Saved jobs only", "During my hours" and "Saved searches" render
   * as rows that route there instead of being omitted, so a visitor can still
   * learn that saving a job or matching their hours exists.
   */
  signupHref?: string;
}

/**
 * The stacked job-filter sections for the FilterSheet (board 24), ONE builder
 * for the signed-in feed and the signed-out /browse feed so the two cannot
 * drift apart.
 *
 * Order (spec §3 "Filter sheet"): Sort · Price · Distance · When · Category ·
 * Show only. View (List / Map) is prepended by the caller where a map exists.
 *
 * Every chip section renders the SAME chip at the SAME size in a wrapping row
 * (`chipBase`/`chipRow` in JobFilters.tsx).
 *
 * Price comes back after its 2026-08 removal because board 24 (owner-approved
 * 2026-10-20) draws it. It is a two-thumb range over the existing min/max
 * budget state, so saved searches, the map and the header count already
 * honour it. The price section renders only when the caller passes the
 * budget setters.
 */
export function buildJobFilterSections(args: JobFilterSectionsArgs): FilterSheetSection[] {
  const {
    selectedCategory, setSelectedCategory,
    locationFilter = "", setLocationFilter,
    sortBy, setSortBy,
    minBudget = "", setMinBudget, maxBudget = "", setMaxBudget,
    jobWhen = "", setJobWhen,
    expiresWithin, setExpiresWithin,
    matchAvailability = false, setMatchAvailability, hasAvailability = false,
    boostedOnly, setBoostedOnly,
    urgentOnly, setUrgentOnly,
    userLocStatus, userLocMessage,
    savedOnly = false, onToggleSavedOnly, savedCount = 0,
    wantsQuotes = false, onToggleWantsQuotes, showAvailability = true,
    showNearby = true,
    savedSearchesButton, signupHref,
  } = args;

  const sections: FilterSheetSection[] = [
    {
      key: "sort",
      title: "Sort",
      content: <SortContent sortBy={sortBy} setSortBy={setSortBy} />,
    },
  ];

  if (setMinBudget && setMaxBudget) {
    sections.push({
      key: "price",
      title: "Price",
      trailing: (
        // Rust only when it shows a real $ range (rust = money); "Any price" is muted ink.
        <span
          className={`text-ds-13 font-bold ${minBudget || maxBudget ? "" : "text-muted-foreground"}`}
          style={minBudget || maxBudget ? { color: "hsl(var(--burnt-sienna))" } : undefined}
          data-testid="pay-range-value"
        >
          {payRangeLabel(minBudget, maxBudget)}
        </span>
      ),
      content: (
        <PayRangeSlider
          minBudget={minBudget}
          setMinBudget={setMinBudget}
          maxBudget={maxBudget}
          setMaxBudget={setMaxBudget}
        />
      ),
    });
  }

  if (showNearby && setLocationFilter) {
    sections.push({
      key: "nearby",
      title: "Distance",
      content: (
        <NearbyContent
          locationFilter={locationFilter}
          setLocationFilter={setLocationFilter}
          status={userLocStatus}
          message={userLocMessage}
        />
      ),
    });
  }

  if (setJobWhen) {
    sections.push({
      key: "when",
      title: "When",
      content: (
        <WhenContent
          jobWhen={jobWhen}
          setJobWhen={setJobWhen}
          expiresWithin={expiresWithin}
          setExpiresWithin={setExpiresWithin}
        />
      ),
    });
  }

  sections.push(
    {
      key: "category",
      title: "Category",
      content: (
        <CategoryContent
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
        />
      ),
    },
    {
      key: "show-only",
      title: "Show only",
      content: (
        <div className="space-y-2.5">
          {onToggleWantsQuotes && <WantsQuotesRow checked={wantsQuotes} onToggle={onToggleWantsQuotes} />}
          {onToggleSavedOnly && (
            <ToggleRow
              icon={Bookmark}
              label="Saved jobs only"
              hint={<p className="text-ds-11 text-muted-foreground leading-snug">{savedCount > 0 ? `${savedCount} saved` : "None open right now"}</p>}
              checked={savedOnly}
              onChange={() => onToggleSavedOnly()}
              ariaLabel="Show saved jobs only"
            />
          )}
          <ToggleRow
            icon={Rocket}
            label="Boosted jobs"
            hint={
              <p className="text-ds-11 text-muted-foreground leading-snug">
                Promoted by the person who posted it
              </p>
            }
            checked={boostedOnly}
            onChange={setBoostedOnly}
            ariaLabel="Show boosted jobs only"
          />
          {/* Urgent is NOT a synonym for Boosted: Boosted is paid placement;
              Urgent is `urgent_fee` on top of the budget, which the Helpr
              takes home, so it is the one switch that finds better-paying work. */}
          <ToggleRow
            icon={Zap}
            label="Urgent jobs"
            hint={
              <p className="text-ds-11 text-muted-foreground leading-snug">
                Pays a bonus on top of the price
              </p>
            }
            checked={urgentOnly}
            onChange={setUrgentOnly}
            ariaLabel="Show urgent jobs only"
          />
          {signupHref && (
            <SignupRow
              icon={Bookmark}
              label="Saved jobs only"
              hint="Sign up to save jobs and filter to just those"
              href={signupHref}
            />
          )}
          {signupHref && (
            <SignupRow
              icon={Clock}
              label="During my hours"
              hint="Sign up to save your weekly hours and match on them"
              href={signupHref}
            />
          )}
          {!signupHref && showAvailability && setMatchAvailability && (
            <AvailabilityRow
              matchAvailability={matchAvailability}
              setMatchAvailability={setMatchAvailability}
              hasAvailability={hasAvailability}
            />
          )}
          {savedSearchesButton}
          {signupHref && (
            <SignupRow
              icon={SearchCheck}
              label="Saved searches"
              hint="Sign up to save this search and get told about new matches"
              href={signupHref}
            />
          )}
        </div>
      ),
    },
  );

  return sections;
}
