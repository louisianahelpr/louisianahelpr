import { useState, useEffect } from "react";
import { TimePickerSelect } from "@/components/TimePickerSelect";
import { DatePickerField } from "@/components/DatePickerField";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogCallout,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
// `Lock` is the lucide glyph, imported explicitly. Without this line the
// identifier still RESOLVES — to the DOM global `Lock` (the Web Locks API
// interface in lib.dom.d.ts) — so the file parses and only a full `tsc`
// catches it. Same trap for Range / Selection / Notification / Image / Text.
import { Lock } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHero } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { categories, type Job } from "./activityConstants";
import { todayLocalISO } from "@/lib/dateUtils";
import { computeJobExpiresAt } from "@/lib/jobExpiry";

interface EditJobDialogProps {
  job: Job | null;
  onClose: () => void;
  onSaved: () => void;
}

// Section heading — a Bodoni-italic chapter label with a trailing hairline
// rule, mirroring the Post-a-Task SectionCard header but light enough for a
// dialog.
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
      setBudget(job.budget?.toString() || "");
      setSpecialReq(job.special_requirements || "");
    }
  }, [job]);

  const save = async () => {
    if (!job) return;
    setSaving(true);
    const scheduleChanged =
      dateNeeded !== (job.date_needed || "") || startTime !== (job.start_time || "");
    const updateData: any = {
      title: title.trim(), description: description.trim(), category,
      location: location.trim(), date_needed: dateNeeded, start_time: startTime || null,
      special_requirements: specialReq.trim() || null,
      // Moving the schedule MUST move the listing expiry with it. It didn't:
      // a job pushed 08-31 -> 09-03 kept its 08-31 expires_at, which is what
      // the feed and the map filter on, so the poster's paid listing stayed
      // invisible with no in-app way to un-expire it short of re-posting and
      // paying again. Recomputed from the same rule the post wizard uses.
      //
      // Only written when the schedule actually moved — a poster fixing a typo
      // on a job whose date genuinely lapsed must not resurrect the listing.
      // trg_job_expiry_floor (20260831201631) enforces the same recompute
      // server-side, so this also holds for any other client.
      ...(scheduleChanged ? { expires_at: computeJobExpiresAt(dateNeeded, startTime) } : {}),
    };
    try {
      unwrapMutation(
        await supabase.from("jobs").update(updateData).eq("id", job.id).select("id"),
        { action: "save these changes" },
      );
      hapticSuccess();
      onSaved();
      onClose();
    } catch (err) {
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't save your changes — please try again."));
    } finally {
      setSaving(false);
    }
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

  return (
    <>
    <Dialog open={!!job} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHero title={title ? `"${title}"` : "Edit Job"} />
        <div className="space-y-5">
          {locked && (
            <DialogCallout icon={Lock}>
              These fields are locked — a Helpr's already accepted this job.
            </DialogCallout>
          )}

          {/* ── The task — what it is ─────────────────────────────────── */}
          <section className="space-y-4">
            <SectionHeading>The job</SectionHeading>
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Title</Label>
              <Input aria-label="Job title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={hasHelper} autoCapitalize="sentences" enterKeyHint="next" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Description</Label>
              <Textarea aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={hasHelper} autoCapitalize="sentences" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Category</Label>
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
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Location</Label>
              <Input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} disabled={hasHelper} autoCapitalize="words" enterKeyHint="next" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-date-needed" className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Date needed</Label>
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
                <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Start time</Label>
                <TimePickerSelect value={startTime} onChange={setStartTime} disabled={hasHelper} />
              </div>
            </div>
          </section>

          {/* ── Anything else — optional extras ───────────────────────── */}
          <section className="space-y-4">
            <SectionHeading>Anything else</SectionHeading>
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Special requirements</Label>
              <Textarea aria-label="Special requirements" value={specialReq} onChange={(e) => setSpecialReq(e.target.value)} rows={2} disabled={hasHelper} autoCapitalize="sentences" />
            </div>
          </section>
        </div>
        <DialogFooter>
          {/* The `ghost` variant already IS transparent/borderless/unshadowed
              with a muted label and a secondary hover — the class list here
              was re-declaring it by hand, one hover token off from every other
              dialog's Cancel. */}
          <DialogSecondaryAction onClick={() => handleClose(false)}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction
            onClick={handleSaveClick}
            disabled={saving || hasHelper}
          >
            {saving ? "Saving…" : "Save Changes"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
      <AlertDialogContent>
        <AlertDialogHero
          title="Save These Changes?"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={save}>Save Changes</AlertDialogAction>
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
          title="Discard Your Changes?"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Editing</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDiscard}>Discard Changes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
