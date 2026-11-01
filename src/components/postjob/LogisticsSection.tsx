import { TimePickerWheel } from "@/components/TimePickerWheel";
import { DatePickerField } from "@/components/DatePickerField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PetPicker } from "@/components/postjob/PetPicker";
import { Switch } from "@/components/ui/switch";
import { MapPin, Shield, Users, Wrench, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { AddressBlock } from "@/components/postjob/AddressBlock";
import { RecurringSchedulePicker } from "@/components/postjob/RecurringSchedulePicker";
import { SectionCard } from "@/components/postjob/SectionCard";
import { todayLocalISO } from "@/lib/dateUtils";
import { jobStartTimeLabel, todayYmd } from "@/lib/jobDate";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { dayStrip, timeChipOf, timeChipsFor } from "@/components/postjob/whenChoices";
import { samePlace as sameAddress, type SavedAddress } from "@/pages/post-job/useSavedJobAddress";
import { formatPriceExact } from "@/lib/format";
import { crewSmallestShare } from "@/components/postjob/crewSmallestShare";

import { FieldError } from "@/components/ui/FieldError";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { GROUP_JOBS_ENABLED } from "@/lib/groupJobs";
import { SCHEDULE_TOO_SOON_COPY, TODAY_CLOSED_COPY } from "@/lib/jobScheduleCopy";
import { useSameDayPick } from "@/components/postjob/useSameDayPick";

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
  { value: "once", label: "One-time" },
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
  /** Board 45's saved address (the poster's last full job address) or null; the WHERE radio shows only with one. */
  savedAddress?: SavedAddress | null;
  /** GROW-4: the poster's other places (earlier jobs), newest first; each is one more WHERE card. */
  otherSavedAddresses?: SavedAddress[];
}

const NO_OTHER_PLACES: SavedAddress[] = [];

// Categories where posters often supply their own paint / parts / supplies; the "Materials" toggle renders only for
// these (for pet care or errands it'd be noise).
const MATERIALS_RELEVANT_CATEGORIES = new Set(["painting", "handyman", "assembly", "yard_work", "cleaning"]);

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
  savedAddress = null,
  otherSavedAddresses = NO_OTHER_PLACES,
}: LogisticsSectionProps) {
  const materialsToggleRelevant =
    !!category && MATERIALS_RELEVANT_CATEGORIES.has(category);

  // WHEN (board 45). The day strip is Louisiana's next days: jobs.date_needed
  // is a Louisiana calendar day (src/lib/jobDate.ts), so the strip starts on
  // todayYmd(), never the device's today (postJobDayStrip.tz.test.tsx).
  const strip = dayStrip(todayYmd());
  const dateOnStrip = !dateNeeded || strip.some((d) => d.iso === dateNeeded);
  const [moreDates, setMoreDates] = useState(false);
  const showCalendar = moreDates || !dateOnStrip;
  const [otherTime, setOtherTime] = useState(false);
  const pickTime = (v: string) => {
    setOtherTime(false);
    setStartTime(v);
  };
  const dateLabel = isRecurring ? "Start date" : "Date needed";
  // Q2438 "Need it today": today, at the soonest start the server takes (2 hours' notice).
  const today = strip[0]?.iso ?? todayYmd();
  const { sameDayStart, markTodayStart, pickDay } = useSameDayPick({ today, startTime, setDateNeeded, setStartTime });
  // F19: no start left today → today is closed everywhere here (button, strip card, calendar day).
  const todayClosed = !sameDayStart;
  const isToday = !isRecurring && dateNeeded === today && !todayClosed;
  const holdsClosedToday = todayClosed && dateNeeded === today;
  // JA-44: today offers only the starts it allows (the earliest first); any other day, the board's chips.
  const timeChips = timeChipsFor(dateNeeded, today, sameDayStart);
  const chip = timeChipOf(startTime, timeChips);
  // A stored time no chip names (a draft, a rebook, the wheel) IS "Other time".
  const showWheel = otherTime || (!!startTime.trim() && !chip);
  const needItToday = () => {
    if (!sameDayStart) return;
    setIsFlexibleSchedule(false);
    setOtherTime(false);
    setMoreDates(false);
    setDateNeeded(today);
    markTodayStart(sameDayStart);
  };

  // WHERE (board 45). The saved address is filled in for the poster only while
  // the form holds no address of its own (a draft or a rebook already did),
  // and "Somewhere else" opens the existing address entry.
  const [whereElse, setWhereElse] = useState(false);
  const applySaved = (a: SavedAddress) => {
    setStreetAddress(a.streetAddress);
    setCity(a.city);
    setAddrState(a.addrState);
    setZipCode(a.zipCode);
  };
  const [savedOffered, setSavedOffered] = useState(false);
  useEffect(() => {
    if (!savedAddress || savedOffered) return;
    setSavedOffered(true);
    if (!streetAddress.trim() && !zipCode.trim()) {
      applySaved(savedAddress);
    }
    // Once, when the saved address first arrives; never again over the poster's own typing.
  }, [savedAddress]);
  // GROW-4: the newest place first, then the poster's other places (a rebook for another property is one tap).
  const places = savedAddress ? [savedAddress, ...otherSavedAddresses] : NO_OTHER_PLACES;
  const placeIndex = whereElse ? -1 : places.findIndex((p) => sameAddress({ streetAddress, city, zipCode }, p));
  const onSaved = placeIndex >= 0;
  const chooseWhere = (v: string) => {
    if (!savedAddress) return;
    const picked = v === "saved" ? savedAddress : /^saved-\d+$/.test(v) ? places[Number(v.slice(6))] : undefined;
    if (picked) {
      setWhereElse(false);
      applySaved(picked);
      return;
    }
    setWhereElse(true);
    if (places.some((p) => sameAddress({ streetAddress, city, zipCode }, p))) {
      setStreetAddress("");
      setZipCode("");
      setCity("");
    }
  };
  const town = city.trim();

  return (
    <SectionCard
      stepNumber={stepNumber}
      title="Logistics"
      icon={MapPin}
      complete={logisticsComplete}
    >
      {/* Whether a job repeats is the first scheduling fact (owner,
          2026-08-24): it changes what the date below means (single visit vs
          series start), so it stays ABOVE the date, at the top of the screen.
          Board 45 does not draw it; it is kept, not dropped.

          Job type — One-time / Repeats / Group are mutually exclusive (a series
          books one standing helper across many dates; group splits one date
          across many helpers), so a segmented control makes that obvious up
          front instead of toggles that quietly disable each other.

          Repeats: the poster picks weekdays and a number of weeks, the budget is
          PER VISIT, and `charge-recurring-visits` bills the saved card a few days
          before each date, creating the job row only AFTER the money is in
          escrow, so an unfunded visit cannot exist for a helper to walk into.
          One standing helper holds every date and can release a single one they
          can't make. (It was withdrawn once because every visit after the first
          was posted with nothing behind it; see RECURRING_ENABLED above.) */}
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

      {/* WHEN (board 45): "A set time" / "Flexible" write jobs.is_flexible_schedule.
          Flexible is a SUBSTITUTE for a start time (owner 2026-09-19: "they also
          need times unless they were checked off as flexible"): with no time the
          card reads "Flexible", with one it reads "9:00 AM · Flexible"
          (jobStartTimeLabel), so under Flexible the time stays optional.

          The board's "Any time this week" is LEFT OUT on purpose: jobs.date_needed
          is one NOT NULL day (verified on prod 2026-10-25, information_schema) and
          no column can say "any day this week", so storing it would print one
          specific day on every card, reminder and day-of check. */}
      <div className="space-y-3">
        <Label id="when-label">When</Label>
        <div id="flexible" role="radiogroup" aria-labelledby="when-label" className="flex flex-wrap gap-2">
          <ChoicePill selected={!isFlexibleSchedule} onClick={() => setIsFlexibleSchedule(false)}>A set time</ChoicePill>
          <ChoicePill selected={isFlexibleSchedule} onClick={() => setIsFlexibleSchedule(true)}>Flexible</ChoicePill>
        </div>
        {isFlexibleSchedule && (
          <p className="text-ds-12 text-muted-foreground leading-snug">
            Any time that day works. Add a start time if you like; the Helpr can shift it either way.
          </p>
        )}
        {/* Q2438: same-day jobs. Not for a repeating job (a series starts on a day the cron bills ahead). */}
        {!isRecurring && (
          <div className="flex flex-col gap-2" data-testid="need-it-today">
            {/* A plain toggle button, not a ChoicePill: ChoicePill is role="radio" and
                this sits in no radiogroup. Pressed while the form holds today. */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={isToday}
                onClick={needItToday}
                disabled={!sameDayStart}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 font-sans text-ds-13 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
                  todayClosed
                    ? "cursor-not-allowed border border-dashed border-border bg-transparent text-muted-foreground"
                    : isToday ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card text-foreground"
                }`}
              >
                <Zap className="h-4 w-4" aria-hidden />
                Need it today
              </button>
            </div>
            {!sameDayStart ? (
              <p className="text-ds-12 text-muted-foreground leading-snug">{TODAY_CLOSED_COPY}</p>
            ) : isToday ? (
              <p className="text-ds-12 text-muted-foreground leading-snug" data-testid="need-it-today-note">
                Today{startTime.trim() ? `, starting ${jobStartTimeLabel(startTime)}` : ""}. Helprs nearby who are available now hear about it first, and it closes when it starts.
              </p>
            ) : (
              <p className="text-ds-12 text-muted-foreground leading-snug">Today, from {jobStartTimeLabel(sameDayStart)} at the earliest. Jobs need 2 hours' notice.</p>
            )}
          </div>
        )}
      </div>

      {/* Day and time sit side by side once THIS GRID is 560px wide (owner,
          2026-10-05: side by side on a wide screen); stacked below that. Keyed
          to the column, not the screen (lead, 2026-10-25): at 1180 the desktop
          rail, step list and preview card leave the form about 370px.
          index.css .pj-when-grid; guard postJobFitsItsColumn.test.ts. */}
      <div className="pj-cq">
      <div className="pj-when-grid grid gap-5">
      <div className="flex flex-col gap-3 min-w-0">
        {/* A repeating job's date is when the series STARTS (owner,
            2026-09-14, VN-51); the same field feeds RecurringSchedulePicker's
            `startDate` above. */}
        <Label id="date-label">{dateLabel}<span aria-hidden className="text-[hsl(var(--destructive-ink))]">{" *"}</span></Label>
        <div id={showCalendar ? undefined : "date"} role="radiogroup" aria-labelledby="date-label" aria-describedby={holdsClosedToday ? "date-closed-error" : undefined} aria-required className="grid grid-cols-5 gap-1.5">
          {strip.map((d) => {
            const on = d.iso === dateNeeded;
            const closed = todayClosed && d.iso === today;
            return (
              <button
                key={d.iso}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={d.long}
                disabled={closed}
                onClick={() => pickDay(d.iso)}
                className={`flex min-h-[60px] min-w-0 flex-col items-center justify-center rounded-ds-md px-1 py-2 font-sans transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
                  closed
                    ? `cursor-not-allowed border border-dashed bg-transparent text-muted-foreground ${on ? "border-[hsl(var(--destructive-ink))]" : "border-border"}`
                    : on ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card text-foreground"
                }`}
              >
                <span className={`text-ds-11 leading-tight ${on ? "" : "text-muted-foreground"}`}>{d.weekday}</span>
                <span className="text-ds-17 font-bold leading-tight tabular-nums">{d.day}</span>
              </button>
            );
          })}
        </div>
        {/* A held-over today: the error sits on the date, the field to change. */}
        <FieldError id="date-closed-error">{holdsClosedToday ? TODAY_CLOSED_COPY : undefined}</FieldError>
        {!showCalendar && (
          <button type="button" onClick={() => setMoreDates(true)} className="self-start inline-flex min-h-[44px] items-center font-sans text-ds-13 font-semibold text-[hsl(var(--bark))]">
            More dates
          </button>
        )}
        {/* "More dates" opens the existing calendar INLINE, on the same field
            (never a popover: the owner's 2026-10-08 "calendar always open" now
            reads "open in place once asked"); a date past the strip keeps it
            open so the chosen day is always on screen. */}
        {showCalendar && (
        <DatePickerField
          id="date"
          inline
          labelledBy="date-label"
          value={dateNeeded}
          onChange={pickDay}
          min={todayLocalISO()}
          isDateDisabled={todayClosed ? (iso) => iso === today : undefined}
        />
        )}
      </div>

      {/* `id="start-time"` is the scroll anchor `scrollToField` targets when
          the submit handler refuses a schedule that has already passed. */}
      <div id="start-time" className="flex flex-col gap-3 min-w-0">
        {/* The `*` is conditional because the requirement is: under Flexible
            the time is optional, and a required marker would contradict it. */}
        <Label id="start-time-label">
          Start time
          {!isFlexibleSchedule && <span aria-hidden className="text-[hsl(var(--destructive-ink))]">{" *"}</span>}
        </Label>
        <div
          role="radiogroup"
          aria-labelledby="start-time-label"
          aria-required={!isFlexibleSchedule}
          aria-describedby={scheduleInPast && !holdsClosedToday ? "start-time-error" : undefined}
          className="flex flex-wrap gap-2"
        >
          {isFlexibleSchedule && (
            <ChoicePill selected={!startTime.trim() && !showWheel} onClick={() => pickTime("")}>No set time</ChoicePill>
          )}
          {timeChips.map((t) => (
            <ChoicePill key={t.value} selected={!showWheel && chip === t.value} onClick={() => pickTime(t.value)}>{t.label}</ChoicePill>
          ))}
          <ChoicePill selected={showWheel} onClick={() => setOtherTime(true)}>Other time</ChoicePill>
        </div>
        {/* "Other time" opens the existing wheel; it never picks on its own
            (timeWheelNeverPicksOnItsOwn.test.tsx). */}
        {showWheel && (
        <div className="flex flex-col justify-center rounded-2xl border border-input glass-field p-3">
          <TimePickerWheel value={startTime} onChange={setStartTime} ariaLabel="Start time" variant="wheels" className="max-w-none w-full" />
        </div>
        )}
        {/* Live, not submit-only: this clears the moment the poster moves the
            date or the time, so fixing it visibly changes the screen. */}
        <FieldError id="start-time-error">
          {scheduleInPast && !holdsClosedToday ? SCHEDULE_TOO_SOON_COPY : undefined}
        </FieldError>
      </div>
      </div>
      </div>

      {/* WHERE (board 45): the saved address or "Somewhere else" (the existing
          address entry). No saved address: the entry alone, as before. */}
      <div className="space-y-3">
        <Label id="where-label">Where</Label>
        {savedAddress && (
          <RadioCardList
            label="Where"
            options={[
              { value: "saved", label: savedAddress.streetAddress, sub: `${savedAddress.city} · from your last job` },
              ...otherSavedAddresses.map((p, i) => ({ value: `saved-${i + 1}`, label: p.streetAddress, sub: `${p.city} · from an earlier job` })),
              { value: "else", label: "Somewhere else", sub: !onSaved && streetAddress.trim() ? "Address below" : "Add an address" },
            ]}
            value={placeIndex === 0 ? "saved" : placeIndex > 0 ? `saved-${placeIndex}` : "else"}
            onChange={(v) => chooseWhere(v)}
          />
        )}
        {(!savedAddress || !onSaved) && (
          <AddressBlock
            streetAddress={streetAddress}
            setStreetAddress={setStreetAddress}
            city={city}
            setCity={setCity}
            addrState={addrState}
            setAddrState={setAddrState}
            zipCode={zipCode}
            setZipCode={setZipCode}
            privacyLine={false}
          />
        )}
        {/* No exact address before hire: Helprs see the town and the distance. */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-card p-4">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--bark))]" aria-hidden />
          <p className="font-sans text-ds-13 leading-snug text-muted-foreground">
            Helprs see <span className="font-semibold text-foreground">{town || "your town"}</span> and the distance. The street address is sent only to the Helpr you offer the job to.
          </p>
        </div>
      </div>

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
