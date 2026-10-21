import { TimePickerWheel } from "@/components/TimePickerWheel";
import { DatePickerField } from "@/components/DatePickerField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PetPicker } from "@/components/postjob/PetPicker";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { MapPin, Users, Wrench } from "lucide-react";
import { AddressBlock } from "@/components/postjob/AddressBlock";
import { RecurringSchedulePicker } from "@/components/postjob/RecurringSchedulePicker";
import { SectionCard } from "@/components/postjob/SectionCard";
import { todayLocalISO } from "@/lib/dateUtils";
import { formatPriceExact } from "@/lib/format";
import { allocateCents } from "../../../supabase/functions/_shared/crewShares";

import { FieldError } from "@/components/ui/FieldError";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { GROUP_JOBS_ENABLED } from "@/lib/groupJobs";
import { SCHEDULE_TOO_SOON_COPY } from "@/lib/jobScheduleCopy";

/** The smallest of the N frozen crew shares of `budget`, in dollars. */
function crewSmallestShare(budget: number, n: number): number {
  return allocateCents(Math.round((Number.isFinite(budget) ? budget : 0) * 100), n, Math.max(0, n - 1)) / 100;
}

/**
 * Repeats is ON as of 2026-08-23 (owner approved).
 *
 * The gate this replaces was a WIRING gate, not a feature flag: the picker, the
 * schema, the standing-helper model and the per-visit charge function were all
 * finished and tested, and the only thing missing was the deployment. Until
 * `charge-recurring-visits` was deployed AND scheduled, nothing billed the saved
 * card for visit 2 onward — a poster would book twelve visits and receive one.
 *
 * Both halves are now true: the function is deployed and ACTIVE on prod, and
 * migration 20260823170000 schedules it daily at 06:00 UTC. That migration ships
 * in the SAME COMMIT as this line, which is what 20260821020000 asked for when
 * it unscheduled the withdrawn path — so the charge path and the feature cannot
 * drift apart again.
 *
 * The ordering that makes this safe lives in the function, not here: the
 * PaymentIntent succeeds FIRST and the visit's job row is inserted after, so an
 * unfunded visit cannot exist for a helpr to walk into.
 */
const RECURRING_ENABLED = true;


/** "Repeats", not "Recurring" — it names what the poster is doing rather than
 *  the billing category. */
const JOB_TYPE_OPTIONS: SegmentedOption<"once" | "recurring" | "group">[] = [
  { value: "once", label: "One-Time" },
  ...(RECURRING_ENABLED ? ([{ value: "recurring", label: "Repeats" }] as const) : []),
  ...(GROUP_JOBS_ENABLED ? ([{ value: "group", label: "Group" }] as const) : []),
];

// Tailwind needs the whole class name as a literal to emit it, so these are
// spelled out rather than built as `grid-cols-${n}`.
const JOB_TYPE_COLS =
  1 + (RECURRING_ENABLED ? 1 : 0) + (GROUP_JOBS_ENABLED ? 1 : 0) === 3
    ? "grid-cols-3"
    : 1 + (RECURRING_ENABLED ? 1 : 0) + (GROUP_JOBS_ENABLED ? 1 : 0) === 2
      ? "grid-cols-2"
      : "grid-cols-1";


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
  /**
   * The chosen date + start time has already gone by. Rendered as an inline
   * error under the schedule rather than left to the submit handler's toast:
   * the toast fires at the top of a page whose submit button is far below the
   * fold, so from the poster's viewport the button just stopped working.
   */
  scheduleInPast?: boolean;
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
  /** Q407 (4): one Helpr for every visit, or OK to split the days. */
  seriesSplitOk: boolean;
  setSeriesSplitOk: (v: boolean) => void;
  isGroupJob: boolean;
  setIsGroupJob: (v: boolean) => void;
  helpersNeeded: string;
  setHelpersNeeded: (v: string) => void;
  budgetNum: number;
  logisticsComplete: boolean;
  /** Active category — drives whether the "I'll provide materials" toggle shows,
      and whether the pet picker appears at all. */
  category?: string;
  /** Pet profile ids attached to this job (pet-care category only). */
  selectedPetIds?: string[];
  onTogglePet?: (petId: string) => void;
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
  scheduleInPast = false,
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
  seriesSplitOk,
  setSeriesSplitOk,
  isGroupJob,
  setIsGroupJob,
  helpersNeeded,
  setHelpersNeeded,
  budgetNum,
  logisticsComplete,
  category,
  selectedPetIds,
  onTogglePet,
  includeMaterials,
  setIncludeMaterials,
  materialsNote,
  setMaterialsNote,
}: LogisticsSectionProps) {
  const materialsToggleRelevant =
    !!category && MATERIALS_RELEVANT_CATEGORIES.has(category);
  return (
    <SectionCard
      stepNumber={stepNumber}
      title="Logistics"
      icon={MapPin}
      complete={logisticsComplete}
    >
      <AddressBlock
        streetAddress={streetAddress}
        setStreetAddress={setStreetAddress}
        city={city}
        setCity={setCity}
        addrState={addrState}
        setAddrState={setAddrState}
        zipCode={zipCode}
        setZipCode={setZipCode}
      />

      {/* MOVED ABOVE THE DATE (owner, 2026-08-24): whether a job repeats is
          the first scheduling fact — it changes what the date below means
          (single visit vs series start) — and buried seventh in this section
          the owner themselves couldn't find it. */}
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
        <Label id="job-type-label">Job type</Label>
        {/* With Group withdrawn, a restored draft carrying `isGroupJob: true`
            (useJobEntry:123 rehydrates it) must not leave the whole control
            unselected — One-Time is what that draft now IS, and
            `jobSubmitHelpers` forces the same coercion on the way into the
            insert. */}
        <SegmentedControl
          ariaLabel="Job type"
          layout="grid"
          gridClassName={JOB_TYPE_COLS}
          options={JOB_TYPE_OPTIONS}
          value={
            isRecurring ? "recurring" : GROUP_JOBS_ENABLED && isGroupJob ? "group" : "once"
          }
          onChange={(next) => {
            setIsRecurring(next === "recurring");
            setIsGroupJob(next === "group");
          }}
        />

        {isRecurring && (
          <RecurringSchedulePicker
            days={recurrenceDays}
            setDays={setRecurrenceDays}
            weeks={recurrenceWeeks}
            setWeeks={setRecurrenceWeeks}
            startDate={dateNeeded}
            budget={budgetNum}
            splitOk={seriesSplitOk}
            setSplitOk={setSeriesSplitOk}
          />
        )}

        {GROUP_JOBS_ENABLED && isGroupJob && (
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
              aria-label="Number of Helprs needed"
            />
            <p className="text-ds-11 text-muted-foreground">
              {/* The server's split (crew_slot_share_cents, largest remainder in
                  cents): the smallest share, so no Helpr gets less than shown. */}
              Budget of ${formatPriceExact(budgetNum)} will be split: ~${formatPriceExact(crewSmallestShare(budgetNum, parseInt(helpersNeeded) || 2))}/Helpr
            </p>
          </div>
        )}
      </div>

      {/* Date and Start Time sit side by side from md up (owner, 2026-10-05);
          stacked on a phone, where each needs the full width. */}
      {/* The calendar is always open (owner, 2026-10-08), and the two columns
          are one height: Start Time's card stretches to the calendar's with
          the wheel centred in it. */}
      <div className="grid gap-5 md:grid-cols-2 md:items-stretch">
      <div className="flex flex-col gap-3 min-w-0">
        {/* A repeating job's date is when the series STARTS (owner,
            2026-09-14, VN-51); the same field feeds RecurringSchedulePicker's
            `startDate` above. */}
        <Label id="date-label">{isRecurring ? "Start date" : "Date needed"} <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
        <DatePickerField
          id="date"
          inline
          labelledBy="date-label"
          value={dateNeeded}
          onChange={setDateNeeded}
          min={todayLocalISO()}
        />
      </div>

      {/* `id="start-time"` is the scroll anchor `scrollToField` targets when
          the submit handler refuses a schedule that has already passed — the
          refusal used to scroll to the DATE field, which is not the thing that
          is wrong when the date is today and the time is what has gone by. */}
      <div
        id="start-time"
        className="flex flex-col gap-3 min-w-0"
        role="group"
        aria-labelledby="start-time-label"
        aria-describedby={scheduleInPast ? "start-time-error" : undefined}
      >
        {/* The `*` is conditional because the requirement is. Ticking
            "Flexible Schedule" below IS the answer to "when does this start?",
            so a red required-marker over a field the form has stopped asking
            for is the form contradicting itself. See the checkbox copy. */}
        <Label id="start-time-label">
          Start time
          {!isFlexibleSchedule && <span className="text-[hsl(var(--destructive-ink))]">{" *"}</span>}
        </Label>
        {/* Fills its column like Date Needed beside it (owner, 2026-10-07:
            "make time fill that empty space on the right"). */}
        <div className="flex-1 flex flex-col justify-center rounded-2xl border border-input glass-field p-3">
          {/* Wheels at every width: the desktop's native time field sat as one
              thin bar in a card the calendar's height (2026-10-08). */}
          <TimePickerWheel value={startTime} onChange={setStartTime} ariaLabel="Start time" variant="wheels" className="max-w-none w-full" />
        </div>
        {/* Live, not submit-only: this clears the moment the poster moves the
            date or the time, so fixing it visibly changes the screen. */}
        <FieldError id="start-time-error">
          {scheduleInPast ? SCHEDULE_TOO_SOON_COPY : undefined}
        </FieldError>
      </div>
      </div>

      {/* `items-center`, and no `mt-0.5` on the box. The label is one line at
          every width this card is used at, so top-aligning the checkbox and
          then nudging it down 2px sat it visibly high against its own text. */}
      <label
        htmlFor="flexible"
        className="flex items-center gap-3 rounded-2xl border border-border bg-background/40 p-4 cursor-pointer min-h-[44px]"
      >
        <Checkbox
          id="flexible"
          checked={isFlexibleSchedule}
          onCheckedChange={(checked) => setIsFlexibleSchedule(!!checked)}
        />
        {/* COPY MOVED WITH THE BEHAVIOUR (2026-09-19). This used to read
            "Helpr can start earlier or later on the scheduled day" — which
            describes a job that HAS a time, i.e. a pure modifier. The box is
            now a SUBSTITUTE for the start time (owner: "they also need times
            unless they were checked off as flexible"), so that sentence was
            wrong for the case it now enables, and the box would have been
            the only thing on the screen still claiming a time was required.

            Both readings are named on purpose, because both stay legal: with
            Start Time left blank the flag stands IN PLACE OF a time (the job
            card renders "Flexible" — see jobStartTimeLabel), and with a time
            set it stands BESIDE it as a preference (the card renders the clock
            time). One sentence, no second reading to guess at. */}
        <span className="text-ds-11 text-muted-foreground leading-snug">
          <span className="font-medium text-foreground">Flexible Schedule</span> — any time that day works. Leave Start Time blank, or set one the Helpr can shift either way.
        </span>
      </label>

      {/* PETS — only on a pet-care job. See PetPicker for why this exists at
          all; in short, a pet profile could not previously reach the person
          holding the leash. It sits directly above the access notes because
          that is the box posters were retyping the pet's details into. */}
      {category === "pet_care" && (
        <PetPicker selectedIds={selectedPetIds ?? []} onToggle={onTogglePet ?? (() => {})} />
      )}

      <div className="space-y-2.5">
        <Label htmlFor="requirements">Access &amp; parking notes</Label>
        <Textarea id="requirements" value={specialRequirements} onChange={(e) => setSpecialRequirements(e.target.value)} placeholder="Gate codes, where to park, which door, pets on site… (optional)" rows={2} maxLength={500} autoCapitalize="sentences" />
      </div>

      {/* "I'll provide materials" — only shows for the categories where
          this is a meaningful poster signal (paint, repair, assembly,
          yard, cleaning). When on, a freeform note appears so the
          poster can list paint colors, parts numbers, supplies, etc.
          Q1461: the note is stored on its own (jobs.materials_note) and
          shown to everyone viewing the job; the Access & Parking notes
          above go to job_access_notes, which only the booked Helpr sees. */}
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

    </SectionCard>
  );
}
