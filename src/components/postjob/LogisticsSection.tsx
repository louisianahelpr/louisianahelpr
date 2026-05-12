import { TimePickerWheel } from "@/components/TimePickerWheel";
import { DatePickerField } from "@/components/DatePickerField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPin, Shield, Repeat, Users, CheckCircle2 } from "lucide-react";

interface LogisticsSectionProps {
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
  estimatedHours: string;
  setEstimatedHours: (v: string) => void;
  specialRequirements: string;
  setSpecialRequirements: (v: string) => void;
  isRecurring: boolean;
  setIsRecurring: (v: boolean) => void;
  recurrenceInterval: string;
  setRecurrenceInterval: (v: string) => void;
  recurrenceEndDate: string;
  setRecurrenceEndDate: (v: string) => void;
  isGroupJob: boolean;
  setIsGroupJob: (v: boolean) => void;
  helpersNeeded: string;
  setHelpersNeeded: (v: string) => void;
  budgetNum: number;
  logisticsComplete: boolean;
}

export function LogisticsSection({
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
  estimatedHours,
  setEstimatedHours,
  specialRequirements,
  setSpecialRequirements,
  isRecurring,
  setIsRecurring,
  recurrenceInterval,
  setRecurrenceInterval,
  recurrenceEndDate,
  setRecurrenceEndDate,
  isGroupJob,
  setIsGroupJob,
  helpersNeeded,
  setHelpersNeeded,
  budgetNum,
  logisticsComplete,
}: LogisticsSectionProps) {
  return (
    <section className="rounded-2xl liquid-glass p-5 space-y-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <MapPin className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="font-display text-ds-15 font-semibold">Logistics</h2>
        </div>
        {logisticsComplete && <CheckCircle2 className="w-4 h-4 text-primary" />}
      </div>

      <div className="space-y-3">
        <Label>Location <span className="text-destructive">*</span></Label>
        <Input id="streetAddress" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} placeholder="Street address" required maxLength={200} autoComplete="street-address" aria-label="Street address" />
        <div className="grid grid-cols-3 gap-2.5">
          <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" required maxLength={100} autoComplete="address-level2" aria-label="City" className="px-3 text-[14px]" />
          <Input id="state" value={addrState} onChange={(e) => setAddrState(e.target.value)} placeholder="State" required maxLength={50} autoComplete="address-level1" aria-label="State" className="px-3 text-[14px]" />
          <Input id="zipCode" value={zipCode} onChange={(e) => setZipCode(e.target.value)} placeholder="Zip code" required maxLength={10} inputMode="numeric" autoComplete="postal-code" aria-label="Zip code" className="px-3 text-[14px]" />
        </div>
        {/* Parish is silently looked up from zip for Louisiana sales tax (admin-only). */}
        <p className="text-ds-11 text-muted-foreground flex items-center gap-1.5">
          <Shield className="w-3 h-3 shrink-0" />
          Only the city will be visible to applicants until you select a helper.
        </p>
      </div>

      <div className="space-y-3">
        <Label htmlFor="date">Date needed <span className="text-destructive">*</span></Label>
        <DatePickerField
          id="date"
          value={dateNeeded}
          onChange={setDateNeeded}
          min={new Date().toISOString().split("T")[0]}
          placeholder="Choose a date"
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
          <span className="font-medium text-foreground">Flexible schedule</span> — helpr can start earlier or later on the scheduled day
        </span>
      </label>

      <div className="space-y-3">
        <Label htmlFor="hours">Estimated hours <span className="text-destructive">*</span></Label>
        <Input id="hours" type="number" inputMode="decimal" step="0.5" min="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="2" required />
      </div>

      <div className="space-y-2.5">
        <Label htmlFor="requirements">Special requirements</Label>
        <Textarea id="requirements" value={specialRequirements} onChange={(e) => setSpecialRequirements(e.target.value)} placeholder="Any tools needed, access instructions, etc. (optional)" rows={2} maxLength={500} />
      </div>

      {/* Recurring Job — mutually exclusive with Group job. Recurring
          bills weekly/monthly to one helper; group splits a single
          job across many. The two semantics don't compose. */}
      <div className={`rounded-ds-md border p-4 space-y-3 ${isGroupJob ? "border-border/40 bg-muted/20 opacity-60" : "border-border"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-primary" />
            <Label htmlFor="recurring" className={isGroupJob ? "cursor-not-allowed" : "cursor-pointer"}>Recurring task</Label>
          </div>
          <Switch
            id="recurring"
            checked={isRecurring}
            disabled={isGroupJob}
            onCheckedChange={setIsRecurring}
          />
        </div>
        {isGroupJob && (
          <p className="text-ds-11 text-muted-foreground">
            Turn off Group job to make this recurring instead.
          </p>
        )}
        {isRecurring && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="space-y-2.5">
              <Label>Frequency</Label>
              <Select value={recurrenceInterval} onValueChange={setRecurrenceInterval}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2.5">
              <Label>Until</Label>
              <Input type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} min={dateNeeded} />
            </div>
          </div>
        )}
      </div>

      {/* Group Job — mutually exclusive with Recurring (see above). */}
      <div className={`rounded-ds-md border p-4 space-y-3 ${isRecurring ? "border-border/40 bg-muted/20 opacity-60" : "border-border"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <Label htmlFor="group" className={isRecurring ? "cursor-not-allowed" : "cursor-pointer"}>Group job (multiple helprs)</Label>
          </div>
          <Switch
            id="group"
            checked={isGroupJob}
            disabled={isRecurring}
            onCheckedChange={setIsGroupJob}
          />
        </div>
        {isRecurring && (
          <p className="text-ds-11 text-muted-foreground">
            Turn off Recurring task to split this across multiple helprs instead.
          </p>
        )}
        {isGroupJob && (
          <div className="space-y-2 pt-1">
            <Label>How many helprs needed?</Label>
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
              Budget of ${budgetNum.toFixed(2)} will be split: ~${(budgetNum / (parseInt(helpersNeeded) || 2)).toFixed(2)}/helpr
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
