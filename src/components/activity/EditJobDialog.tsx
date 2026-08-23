import { useState, useEffect } from "react";
import { TimePickerSelect } from "@/components/TimePickerSelect";
import { DatePickerField } from "@/components/DatePickerField";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHero } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { categories, type Job } from "./activityConstants";
import { todayLocalISO } from "@/lib/dateUtils";

interface EditJobDialogProps {
  job: Job | null;
  onClose: () => void;
  onSaved: () => void;
}

// Section heading — a Bodoni-italic chapter label with a trailing hairline
// rule, mirroring the Post-a-Task SectionCard header but light enough for a
// dialog. Deliberately distinct from the burnt-sienna field eyebrows so the
// group → field hierarchy reads at a glance.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="font-display italic font-bold whitespace-nowrap text-ds-15"
        style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
      >
        {children}
      </span>
      <span className="flex-1 h-px" style={{ background: "hsl(var(--olivewood) / 0.14)" }} />
    </div>
  );
}

export function EditJobDialog({ job, onClose, onSaved }: EditJobDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [location, setLocation] = useState("");
  const [dateNeeded, setDateNeeded] = useState("");
  const [startTime, setStartTime] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [, setBudget] = useState("");
  const [specialReq, setSpecialReq] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);

  // Reset all fields when job changes (prepopulate)
  useEffect(() => {
    if (job) {
      setTitle(job.title || "");
      setDescription(job.description || "");
      setCategory(job.category || "other");
      setLocation(job.location || "");
      setDateNeeded(job.date_needed || "");
      setStartTime(job.start_time || "");
      setEstimatedHours(job.estimated_hours?.toString() || "");
      setBudget(job.budget?.toString() || "");
      setSpecialReq(job.special_requirements || "");
    }
  }, [job]);

  const save = async () => {
    if (!job) return;
    setSaving(true);
    const updateData: any = {
      title: title.trim(), description: description.trim(), category,
      location: location.trim(), date_needed: dateNeeded, start_time: startTime || null,
      estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
      special_requirements: specialReq.trim() || null,
    };
    const { error } = await supabase.from("jobs").update(updateData).eq("id", job.id);
    setSaving(false);
    if (error) { hapticError(); toast.error("We couldn't save your changes — please try again."); }
    else { hapticSuccess(); toast.success("Job updated"); onSaved(); onClose(); }
  };

  const handleSaveClick = () => setShowConfirm(true);

  // Dirty check — did the user actually edit anything? Compares current
  // form state against the job's persisted values. Used to gate the
  // Discard-changes prompt on close so a user who opened the dialog and
  // typed nothing exits with one tap (no confirm), while a user with
  // unsaved edits sees "Discard changes?" instead of losing them silently.
  const isDirty = !!job && (
    title !== (job.title || "") ||
    description !== (job.description || "") ||
    category !== (job.category || "other") ||
    location !== (job.location || "") ||
    dateNeeded !== (job.date_needed || "") ||
    startTime !== (job.start_time || "") ||
    estimatedHours !== (job.estimated_hours?.toString() || "") ||
    specialReq !== (job.special_requirements || "")
  );

  const handleClose = (nextOpen: boolean) => {
    if (nextOpen) return; // Radix passes true on programmatic open — no-op
    if (isDirty) {
      setShowDiscard(true);
      return;
    }
    onClose();
  };

  const confirmDiscard = () => {
    setShowDiscard(false);
    onClose();
  };

  if (!job) return null;

  const hasHelper = !!job.helper_id;
  const locked = hasHelper;

  const eyebrowCls = "font-serif italic uppercase block";
  const eyebrowStyle = { fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" } as const;

  return (
    <>
    <Dialog open={!!job} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !gap-3">
        <DialogHero eyebrow="Editing your job" title={title ? `"${title}"` : "Edit job"} />
        <div className="space-y-5">
          {locked && (
            <p
              className="font-serif italic text-ds-13 leading-relaxed rounded-ds-md p-2.5"
              style={{
                color: "hsl(var(--olivewood) / 0.85)",
                background: "hsl(var(--amber-tint) / 0.10)",
                border: "0.5px solid hsl(var(--amber-tint) / 0.30)",
              }}
            >
              These fields are locked — a Helpr's already accepted this job.
            </p>
          )}

          {/* ── The task — what it is ─────────────────────────────────── */}
          <section className="space-y-4">
            <SectionHeading>The job</SectionHeading>
            <div className="space-y-1.5">
              <Label className={eyebrowCls} style={eyebrowStyle}>Title</Label>
              <Input aria-label="Job title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={hasHelper} autoCapitalize="sentences" enterKeyHint="next" />
            </div>
            <div className="space-y-1.5">
              <Label className={eyebrowCls} style={eyebrowStyle}>Description</Label>
              <Textarea aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={hasHelper} autoCapitalize="sentences" />
            </div>
            <div className="space-y-1.5">
              <Label className={eyebrowCls} style={eyebrowStyle}>Category</Label>
              <Select value={category} onValueChange={setCategory} disabled={hasHelper}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* ── When & where — the logistics ──────────────────────────── */}
          <section className="space-y-4">
            <SectionHeading>When &amp; where</SectionHeading>
            <div className="space-y-1.5">
              <Label className={eyebrowCls} style={eyebrowStyle}>Location</Label>
              <Input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} disabled={hasHelper} autoCapitalize="words" enterKeyHint="next" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-date-needed" className={eyebrowCls} style={eyebrowStyle}>Date needed</Label>
                {hasHelper ? (
                  // When a helpr is locked in, the field is read-only. Show a
                  // disabled Input mirroring the locked state of the other
                  // fields in this dialog rather than a non-interactive
                  // DatePickerField (which has no `disabled` styling).
                  <Input id="edit-date-needed" type="date" value={dateNeeded} disabled readOnly />
                ) : (
                  <DatePickerField
                    id="edit-date-needed"
                    value={dateNeeded}
                    onChange={setDateNeeded}
                    min={todayLocalISO()}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label className={eyebrowCls} style={eyebrowStyle}>Start time</Label>
                <TimePickerSelect value={startTime} onChange={setStartTime} disabled={hasHelper} />
              </div>
            </div>
            {/* Est. hours is a short numeric — half-width so it doesn't read
                as a heavyweight full-bleed field alone on its row. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-est-hours" className={eyebrowCls} style={eyebrowStyle}>Est. hours</Label>
                <Input id="edit-est-hours" type="number" inputMode="decimal" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} disabled={hasHelper} aria-label="Estimated hours" />
              </div>
            </div>
          </section>

          {/* ── Anything else — optional extras ───────────────────────── */}
          <section className="space-y-4">
            <SectionHeading>Anything else</SectionHeading>
            <div className="space-y-1.5">
              <Label className={eyebrowCls} style={eyebrowStyle}>Special requirements</Label>
              <Textarea aria-label="Special requirements" value={specialReq} onChange={(e) => setSpecialReq(e.target.value)} rows={2} disabled={hasHelper} autoCapitalize="sentences" />
            </div>
          </section>
        </div>
        <DialogFooter className="!gap-2">
          <Button
            variant="ghost"
            onClick={() => handleClose(false)}
            className="rounded-ds-md bg-transparent border-transparent shadow-none text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveClick}
            disabled={saving || hasHelper}
            className="rounded-ds-md"
            style={{
              background: "hsl(var(--bark))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              boxShadow: "var(--elev-bark-raised)",
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
      <AlertDialogContent>
        <AlertDialogHero
          eyebrow="Editing your job"
          title="Save These Changes?"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={save}>Save changes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Discard-changes confirm — only rendered when the user has actually
        edited something and then tries to close (X, backdrop, Esc, or
        Cancel). A clean-slate close skips this and exits directly, so it
        never becomes a nag on a "peek and leave" open. */}
    <AlertDialog open={showDiscard} onOpenChange={setShowDiscard}>
      <AlertDialogContent>
        <AlertDialogHero
          eyebrow="Editing your job"
          title="Discard Your Changes?"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDiscard}>Discard changes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
