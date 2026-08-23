import { TimePickerWheel } from "@/components/TimePickerWheel";
import { DatePickerField } from "@/components/DatePickerField";
import { CityAutocomplete } from "@/components/postjob/CityAutocomplete";
import { AddressAutocomplete } from "@/components/postjob/AddressAutocomplete";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { MapPin, Shield, Users, Wrench } from "lucide-react";
import { RecurringSchedulePicker } from "@/components/postjob/RecurringSchedulePicker";
import { SectionCard } from "@/components/postjob/SectionCard";
import { todayLocalISO } from "@/lib/dateUtils";
import { formatPriceExact } from "@/lib/format";
import { AppleMapPreview } from "@/components/postjob/AppleMapPreview";
import { CurrentLocationPill } from "@/components/postjob/CurrentLocationPill";
import { FieldError } from "@/components/ui/FieldError";

/**
 * Repeats is built but not yet WIRED END TO END, so the door stays shut.
 *
 * The picker, the schema, the per-visit charge cron and the standing-helper
 * model all exist. What does not exist yet is the deployment: until
 * `charge-recurring-visits` is deployed as an edge function AND scheduled to
 * run daily, nothing bills the saved card for visit 2 onward — so a poster
 * would book twelve visits and receive one. That is the exact failure the
 * rebuild set out to remove, and shipping the picker ahead of the cron would
 * re-create it with a nicer UI.
 *
 * Flip to `true` only once the cron is deployed and scheduled. Everything on
 * the other side of this flag is finished and tested; this is a wiring gate,
 * not a feature flag for unfinished work.
 */
const RECURRING_ENABLED = false;

// Normalize a reverse-geocoder's state value (full name or abbreviation)
// to the canonical 2-letter code the form stores. We special-case the only
// state Helpr serves ("Louisiana" → "LA"); any other already-2-letter code
// is upper-cased and passed through, and anything else is returned trimmed
// rather than coerced — so the field reflects what was actually geocoded
// instead of a hard-coded "LA".
function normalizeStateCode(rawState: string): string {
  const s = rawState.trim();
  if (/^louisiana$/i.test(s)) return "LA";
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return s;
}

interface LogisticsSectionProps {
  /** 1-based chapter number for the section header. */
  stepNumber: number;
  streetAddress: string;
  setStreetAddress: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  addrState: string;
  setAddrState: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
  dateNeeded: string;
  setDateNeeded: (v: string) => void;
  startTime: string;
  setStartTime: (v: string) => void;
  isFlexibleSchedule: boolean;
  setIsFlexibleSchedule: (v: boolean) => void;
  specialRequirements: string;
  setSpecialRequirements: (v: string) => void;
  isRecurring: boolean;
  setIsRecurring: (v: boolean) => void;
  /** Weekdays the series runs, 0=Sun..6=Sat. */
  recurrenceDays: number[];
  setRecurrenceDays: (v: number[]) => void;
  recurrenceWeeks: number;
  setRecurrenceWeeks: (v: number) => void;
  isGroupJob: boolean;
  setIsGroupJob: (v: boolean) => void;
  helpersNeeded: string;
  setHelpersNeeded: (v: string) => void;
  budgetNum: number;
  logisticsComplete: boolean;
  /** Active category — drives whether the "I'll provide materials" toggle shows. */
  category?: string;
  includeMaterials?: boolean;
  setIncludeMaterials?: (v: boolean) => void;
  materialsNote?: string;
  setMaterialsNote?: (v: string) => void;
}

// Categories where it's common for posters to provide their own paint /
// parts / supplies. The "Materials" toggle only renders for these — for
// pet care or errands it'd just be noise.
const MATERIALS_RELEVANT_CATEGORIES = new Set([
  "painting",
  "handyman",
  "assembly",
  "yard_work",
  "cleaning",
]);

export function LogisticsSection({
  stepNumber,
  streetAddress,
  setStreetAddress,
  city,
  setCity,
  addrState,
  setAddrState,
  zipCode,
  setZipCode,
  dateNeeded,
  setDateNeeded,
  startTime,
  setStartTime,
  isFlexibleSchedule,
  setIsFlexibleSchedule,
  specialRequirements,
  setSpecialRequirements,
  isRecurring,
  setIsRecurring,
  recurrenceDays,
  setRecurrenceDays,
  recurrenceWeeks,
  setRecurrenceWeeks,
  isGroupJob,
  setIsGroupJob,
  helpersNeeded,
  setHelpersNeeded,
  budgetNum,
  logisticsComplete,
  category,
  includeMaterials,
  setIncludeMaterials,
  materialsNote,
  setMaterialsNote,
}: LogisticsSectionProps) {
  const materialsToggleRelevant =
    !!category && MATERIALS_RELEVANT_CATEGORIES.has(category);
  // Apple MapKit JS — when the token is configured and the script
  // loads, swap the plain street input for AddressAutocomplete (which
  // fills street + city + zip on a single tap). When MapKit isn't
  // usable (missing token, script blocked, etc.) the plain inputs are
  // the fallback — same UX the page shipped with before this feature.
  const mapKitStatus = useMapKitJs();
  const mapKitReady = mapKitStatus === "ready";
  return (
    <SectionCard
      stepNumber={stepNumber}
      title="Logistics"
      icon={MapPin}
      complete={logisticsComplete}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>Location <span className="text-destructive">*</span></Label>
          {/* "Use my current location" — Capacitor/web Geolocation +
              MapKit reverse-geocode in one tap. Falls back to a tasteful
              error toast if location is denied or no street can be
              resolved. */}
          <CurrentLocationPill
            onResolved={({ street, city: pickedCity, state: pickedState, zipCode: pickedZip }) => {
              if (street) setStreetAddress(street);
              if (pickedCity) setCity(pickedCity);
              // Store the state the geocoder actually resolved — never a
              // hard-coded "LA", which produced "San Francisco, LA 94108".
              // The pill already rejects clearly out-of-state geocodes, so
              // this only normalizes the LA name/code to the canonical
              // 2-letter "LA" we store (a coarse/blank geocode passes
              // through untouched for the form's own validation to gate).
              if (pickedState) setAddrState(normalizeStateCode(pickedState));
              if (pickedZip) setZipCode(pickedZip);
            }}
          />
        </div>
        {mapKitReady ? (
          <AddressAutocomplete
            id="streetAddress"
            value={streetAddress}
            onChange={setStreetAddress}
            onPick={({ street, city: pickedCity, zipCode: pickedZip }) => {
              setStreetAddress(street);
              // Only overwrite the city/zip when MapKit actually gave
              // us a value — otherwise we'd blank a user-typed field.
              if (pickedCity) setCity(pickedCity);
              if (pickedZip) setZipCode(pickedZip);
            }}
          />
        ) : (
          <Input id="streetAddress" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} required maxLength={200} autoComplete="street-address" autoCapitalize="words" aria-label="Street address" />
        )}
        <div className="grid grid-cols-3 gap-2.5">
          {/* City is the only address part shown publicly on job cards.
              CityAutocomplete suggests canonical Louisiana city names so
              card display + filtering stay consistent; free-typed
              values are still accepted and title-cased. */}
          <CityAutocomplete
            id="city"
            value={city}
            onChange={setCity}
            className="px-3 text-ds-14"
          />
          {/* State is locked to LA — Helpr only operates in Louisiana,
              so this is a fixed field rather than a free input. */}
          <Input
            id="state"
            value={addrState || "LA"}
            readOnly
            tabIndex={-1}
            aria-label="State (Louisiana)"
            className="px-3 text-ds-14 bg-muted/50 text-muted-foreground cursor-default"
          />
          <Input id="zipCode" value={zipCode} onChange={(e) => setZipCode(e.target.value)} required maxLength={10} inputMode="numeric" autoComplete="postal-code" aria-label="Zip code" aria-invalid={streetAddress.trim().length > 0 && !zipCode.trim()} className="px-3 text-ds-14" />
        </div>
        {/* Address-gate hint — the submit button stays disabled until Zip is
            filled, but the Zip sits to the side of the read-only State field,
            so a poster who typed a street address could be silently blocked
            with no idea why (LH-53). State is locked to LA, so Zip is the only
            field a poster can still be missing here; name it inline using the
            same error treatment as the description placeholder guard (LH-23). */}
        {streetAddress.trim().length > 0 && !zipCode.trim() && (
          <FieldError>
            Add the zip code to continue.
          </FieldError>
        )}
        {/* Parish is silently looked up from zip for Louisiana sales tax (admin-only). */}
        <p className="text-ds-11 text-muted-foreground flex items-center gap-1.5">
          <Shield className="w-3 h-3 shrink-0" />
          Only your city is shown until you pick a Helpr.
        </p>
        {/* Apple MapKit JS embedded preview — confirms visually that the
            typed address resolved to the right spot. Hides itself when
            MapKit isn't configured. */}
        <AppleMapPreview
          street={streetAddress}
          city={city}
          state={addrState || "LA"}
          zipCode={zipCode}
        />
      </div>

      <div className="space-y-3">
        <Label htmlFor="date">Date needed <span className="text-destructive">*</span></Label>
        <DatePickerField
          id="date"
          value={dateNeeded}
          onChange={setDateNeeded}
          min={todayLocalISO()}
        />
      </div>

      <div className="space-y-3">
        <Label>Start time <span className="text-destructive">*</span></Label>
        <TimePickerWheel value={startTime} onChange={setStartTime} />
      </div>

      <label
        htmlFor="flexible"
        className="flex items-start gap-3 rounded-2xl border border-border bg-background/40 p-4 cursor-pointer min-h-[44px]"
      >
        <Checkbox
          id="flexible"
          checked={isFlexibleSchedule}
          onCheckedChange={(checked) => setIsFlexibleSchedule(!!checked)}
          className="mt-0.5"
        />
        <span className="text-ds-11 text-muted-foreground leading-snug">
          <span className="font-medium text-foreground">Flexible schedule</span> — Helpr can start earlier or later on the scheduled day
        </span>
      </label>

      <div className="space-y-2.5">
        <Label htmlFor="requirements">Access &amp; parking notes</Label>
        <Textarea id="requirements" value={specialRequirements} onChange={(e) => setSpecialRequirements(e.target.value)} placeholder="Gate codes, where to park, which door, pets on site… (optional)" rows={2} maxLength={500} autoCapitalize="sentences" />
      </div>

      {/* "I'll provide materials" — only shows for the categories where
          this is a meaningful poster signal (paint, repair, assembly,
          yard, cleaning). When on, a freeform note appears so the
          poster can list paint colors, parts numbers, supplies, etc.
          The note is appended into special_requirements at submit so
          helprs see it on the job card. */}
      {materialsToggleRelevant && setIncludeMaterials && (
        <div
          className={`rounded-ds-md border p-4 space-y-3 ${
            includeMaterials ? "border-primary/30 bg-primary/5" : "border-border"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="include-materials" className="flex items-center gap-2 cursor-pointer">
              <Wrench className="w-4 h-4 text-primary" />
              <span className="text-ds-13 font-semibold text-foreground">
                I'll provide materials
              </span>
            </label>
            <Switch
              id="include-materials"
              checked={!!includeMaterials}
              onCheckedChange={setIncludeMaterials}
            />
          </div>
          {includeMaterials && setMaterialsNote && (
            <div className="space-y-2">
              <Label htmlFor="materials-note" className="text-ds-11">
                Materials I'll provide
              </Label>
              <Textarea
                id="materials-note"
                value={materialsNote ?? ""}
                onChange={(e) => setMaterialsNote(e.target.value)}
                placeholder="e.g. 1 gallon of Sherwin-Williams 'Cotton White', rollers, drop cloth — everything is staged by the door."
                rows={2}
                maxLength={500}
                autoCapitalize="sentences"
              />
              <p className="text-ds-11 text-muted-foreground">
                Listed on the job so applicants know what they don't need to bring.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Job type — One-time / Repeats / Group are mutually exclusive (a series
          books one standing helper across many dates; group splits one date
          across many helpers), so a segmented control makes that obvious up
          front instead of toggles that quietly disable each other.

          RECURRING WAS WITHDRAWN AND IS BACK, REBUILT. It was never finishable as built:
          the poster funded escrow ONCE at checkout, and `spawn-recurring-jobs`
          then posted every later visit straight into `jobs` with no payment at
          all — `action: "escrow"` is invoked from exactly one place in the app
          (useJobSubmit), the post flow, so there is no code path anywhere that
          funds an already-existing job. Every visit after the first was
          publicly listed and acceptable with nothing behind it: a helper could
          do the work and there would be no escrow to release. Meanwhile this
          screen showed "About 12 visits — roughly $600 total", which reads as
          a $600 commitment against a $50 charge.

          What replaced it: the poster picks weekdays and a number of weeks, the
          budget is PER VISIT, and `charge-recurring-visits` bills the saved
          card a few days before each date — creating the job row only AFTER
          the money is in escrow, so an unfunded visit cannot exist for a helper
          to walk into. One standing helper holds every date and can release a
          single one they can't make. */}
      <div className="space-y-3">
        <Label>Job type</Label>
        <div className={`grid ${RECURRING_ENABLED ? "grid-cols-3" : "grid-cols-2"} gap-1 p-1 rounded-2xl border border-input bg-background/70`}>
          {([
            { key: "once", label: "One-time" },
            // "Repeats", not "Recurring" — it names what the poster is doing
            // rather than the billing category.
            ...(RECURRING_ENABLED ? [{ key: "recurring", label: "Repeats" } as const] : []),
            { key: "group", label: "Group" },
          ] as const).map((opt) => {
            const active =
              (opt.key === "once" && !isRecurring && !isGroupJob) ||
              (opt.key === "recurring" && isRecurring) ||
              (opt.key === "group" && isGroupJob);
            return (
              <button
                key={opt.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setIsRecurring(opt.key === "recurring");
                  setIsGroupJob(opt.key === "group");
                }}
                className={`h-10 rounded-ds-md text-ds-13 font-semibold tracking-tight transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {isRecurring && (
          <RecurringSchedulePicker
            days={recurrenceDays}
            setDays={setRecurrenceDays}
            weeks={recurrenceWeeks}
            setWeeks={setRecurrenceWeeks}
            startDate={dateNeeded}
            budget={budgetNum}
          />
        )}

        {isGroupJob && (
          <div className="rounded-ds-md border border-border p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-ds-13 font-semibold text-foreground">Group job</span>
            </div>
            <Label>How many Helprs needed?</Label>
            <Input
              type="number"
              inputMode="numeric"
              min="2"
              max="10"
              value={helpersNeeded}
              onChange={(e) => setHelpersNeeded(e.target.value)}
              className="w-24"
              aria-label="Number of helpers needed"
            />
            <p className="text-ds-11 text-muted-foreground">
              Budget of ${formatPriceExact(budgetNum)} will be split: ~${formatPriceExact(budgetNum / (parseInt(helpersNeeded) || 2))}/Helpr
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
