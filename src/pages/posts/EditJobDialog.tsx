import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { TimePickerWheel } from "@/components/TimePickerWheel";
import { DatePickerField } from "@/components/DatePickerField";
import { supabase } from "@/integrations/supabase/client";
import type { Database, TablesUpdate } from "@/integrations/supabase/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogCallout,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
// `Lock` is the lucide glyph, imported explicitly. Without this line the
// identifier still RESOLVES — to the DOM global `Lock` (the Web Locks API
// interface in lib.dom.d.ts) — so the file parses and only a full `tsc`
// catches it. Same trap for Range / Selection / Notification / Image / Text.
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { categories, type Job } from "../../components/job-card/activityConstants";
import { todayLocalISO } from "@/lib/dateUtils";
import { computeJobExpiresAt } from "@/lib/jobExpiry";
import { isLaborTaxable } from "@/lib/salesTax";
import { useJobAccessNote } from "@/hooks/useJobAccessNote";
import { saveJobAccessNote } from "@/lib/jobAccessNotes";
import { geocodeAddress } from "@/lib/geocode";

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
  const [isFlexible, setIsFlexible] = useState(false);
  const [, setBudget] = useState("");
  // Q1461: the two notes the post form collects, stored apart. Materials is
  // on the job row (public); Access & Parking is in job_access_notes (the
  // poster and the booked Helpr only), read here through RLS as the poster.
  const [materialsNote, setMaterialsNote] = useState("");
  const [accessNote, setAccessNote] = useState("");
  const [accessTouched, setAccessTouched] = useState(false);
  const savedAccess = useJobAccessNote(job?.id, !!job) ?? "";
  const [requirePhotoProof, setRequirePhotoProof] = useState(true);
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
      setIsFlexible(job.is_flexible_schedule ?? false);
      setBudget(job.budget?.toString() || "");
      setMaterialsNote(job.materials_note || "");
      setAccessTouched(false);
      // `?? true` mirrors the column's own NOT NULL DEFAULT, so a row read by a
      // client older than the migration prepopulates as "required" rather than
      // silently saving the requirement away.
      setRequirePhotoProof((job as { require_photo_proof?: boolean | null }).require_photo_proof ?? true);
    }
  }, [job]);

  useEffect(() => {
    if (!accessTouched) setAccessNote(savedAccess);
  }, [savedAccess, accessTouched]);

  const save = async () => {
    if (!job) return;
    // Same rule as the post wizard and the jobs_start_time_required CHECK: a
    // job names a start time or is flexible. Said here instead of letting the
    // server refuse the row with a constraint error.
    if (!isFlexible && !startTime) {
      toast.error("Pick a start time, or mark the schedule as flexible.");
      return;
    }
    setSaving(true);
    const scheduleChanged =
      dateNeeded !== (job.date_needed || "") || startTime !== (job.start_time || "");
    const updateData: TablesUpdate<"jobs"> = {
      title: title.trim(), description: description.trim(),
      // The Select below offers only `categories` values (the job_category enum).
      category: category as Database["public"]["Enums"]["job_category"],
      location: location.trim(), date_needed: dateNeeded, start_time: startTime || null,
      // Editable after posting (2026-10-02). It was never written here, so a
      // poster who forgot the box at post time had to delete and repost.
      is_flexible_schedule: isFlexible,
      // Only when it changed: a key the database does not have yet would fail
      // the whole save in the minutes between the web deploy and db-deploy.
      ...(materialsNote.trim() !== (job.materials_note ?? "") ? { materials_note: materialsNote.trim() || null } : {}),
      require_photo_proof: requirePhotoProof,
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
    // Once a Helpr is booked the place and details are locked server-side
    // (enforce_poster_jobs_money_lock, Q1204), so a booked job sends only the
    // one field the lock leaves open: photo proof, turned OFF. Everything else
    // is simply not sent (a re-trimmed location would read as a change).
    // Q1499: a changed address sends its own map point. Without one the
    // database clears the old pin (zzzzzz_jobs_location_clears_coords) and the
    // geocoder refills it later; best-effort, like the post wizard's.
    if (!job.helper_id && location.trim() !== (job.location ?? "").trim()) {
      const point = await geocodeAddress(location.trim());
      if (point) Object.assign(updateData, { latitude: point.latitude, longitude: point.longitude });
    }
    const payload: TablesUpdate<"jobs"> = job.helper_id ? { require_photo_proof: requirePhotoProof } : updateData;
    try {
      // The access note FIRST: it is the write most likely to be refused (the
      // contact scan), and refused first it leaves nothing half-saved. NOT
      // locked by a booking (owner answer 3, 2026-10-06): the poster may
      // change it until the job ends, and the database tells the booked
      // Helpr(s) (job_access_notes_changed).
      if (job.status !== "completed" && job.status !== "cancelled" && accessNote.trim() !== savedAccess.trim()) {
        await saveJobAccessNote(job.id, accessNote);
      }
      unwrapMutation(
        await supabase.from("jobs").update(payload).eq("id", job.id).select("id"),
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
    isFlexible !== (job.is_flexible_schedule ?? false) ||
    materialsNote !== (job.materials_note || "") ||
    accessNote.trim() !== savedAccess.trim()
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
  // Owner answer 3: the access notes stay editable after booking, until the job ends.
  const jobEnded = job.status === "completed" || job.status === "cancelled";
  const accessChanged = accessNote.trim() !== savedAccess.trim();
  // The only edit a booked job still takes (Q1204): relaxing photo proof.
  // Turning it ON is refused by the server once booked, so a job that already
  // has it off offers no switch, and Save needs that one change to be made.
  const savedPhotoProof = (job as { require_photo_proof?: boolean | null }).require_photo_proof ?? true;
  const bookedNothingToSave = hasHelper && requirePhotoProof === savedPhotoProof && !accessChanged;
  // ME-010: sales tax was charged at checkout from the category, so a paid job
  // cannot cross between taxed and untaxed categories (the server refuses it:
  // trg_funded_category_tax_class). Same funded test as the money lock.
  const funded = (job.payment_status ?? "unpaid") !== "unpaid" || !!job.stripe_session_id;
  const crossesTaxClass = (value: string) => funded && isLaborTaxable(value) !== isLaborTaxable(job.category);

  return (
    <>
    <Dialog open={!!job} onOpenChange={handleClose}>
      {/* NOT `role="alertdialog"` — that is the shared Dialog kit's signal
          that every DialogPrimaryAction/DialogSecondaryAction inside auto-
          wraps in DialogPrimitive.Close (see MaybeClose in ui/dialog.tsx).
          This is a real editable FORM, not a confirm: Save Changes must only
          open the "Save These Changes?" confirm below, and let THAT dialog's
          own action decide. With the role on, one click did both — opened
          the confirm dialog AND self-closed via Close, which fired
          handleClose(false), saw isDirty, and opened "Discard Your
          Changes?" on top of it in the same click — so the save button
          silently never saved anything the confirm dialog didn't first
          survive. */}
      <DialogContent>
        <DialogHero title={title ? `"${title}"` : "Edit Job"} />
        <div className="space-y-5">
          {locked && (
            <DialogCallout icon={Lock}>
              The place and details are locked once a Helpr is booked. To change them, use “Ask to change the details” on the job; everyone booked has to agree. You can still update the access and parking notes here; your Helpr is told.
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
                  {categories.map((c) => <SelectItem key={c.value} value={c.value} disabled={crossesTaxClass(c.value)}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {funded && !hasHelper && (
                <p className="text-ds-12 text-muted-foreground" data-testid="category-tax-lock-hint">
                  Sales tax was set by this category when you paid, so some categories are unavailable.
                </p>
              )}
            </div>
          </section>

          {/* ── When & where — the logistics ──────────────────────────── */}
          <section className="space-y-4">
            <SectionHeading>When &amp; where</SectionHeading>
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Location</Label>
              <Input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} disabled={hasHelper} autoCapitalize="words" enterKeyHint="next" />
            </div>
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
              <TimePickerWheel value={startTime} onChange={setStartTime} disabled={hasHelper} />
            </div>
            {/* Same control shape as the photo-proof row below, same copy as
                the post wizard's Flexible Schedule box (LogisticsSection). */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="edit-flexible-schedule" className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Flexible schedule
                </Label>
                <p className="text-ds-11 mt-1 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Any time that day works. Leave Start Time blank, or set one the Helpr can shift either way.
                </p>
              </div>
              <Switch
                id="edit-flexible-schedule"
                checked={isFlexible}
                onCheckedChange={setIsFlexible}
                disabled={hasHelper}
                aria-label="Flexible schedule"
              />
            </div>
          </section>

          {/* ── Anything else — optional extras ───────────────────────── */}
          <section className="space-y-4">
            <SectionHeading>Anything else</SectionHeading>
            {/* Q1461: the post form's two notes, under the post form's labels.
                Both lock with the other details once a Helpr is booked. */}
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Materials I'll provide</Label>
              <Textarea aria-label="Materials I'll provide" value={materialsNote} onChange={(e) => setMaterialsNote(e.target.value)} rows={2} maxLength={500} disabled={hasHelper} autoCapitalize="sentences" placeholder="Optional. Everyone viewing the job sees this." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">Access &amp; Parking notes</Label>
              <Textarea aria-label="Access and parking notes" value={accessNote} onChange={(e) => { setAccessTouched(true); setAccessNote(e.target.value); }} rows={2} maxLength={500} disabled={jobEnded} autoCapitalize="sentences" placeholder="Gate codes, where to park, which door… Only your booked Helpr sees these." />
            </div>
            {/* PHOTO PROOF — can still be turned OFF once a Helpr is assigned
                (never back on: the server refuses it, Q1204), which is the
                opposite of every field above it and is the point.
                `enforce_helper_completion_gates()` reads NEW.require_photo_proof
                at the moment the Helpr marks the job done, not the value at
                post time, so a poster who answered wrong is otherwise stuck:
                their only remedy would be cancelling a job someone is already
                working. Turning it off only ever relaxes a gate, and turning it
                back on is answerable by the Helpr, who can still add photos. */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="edit-require-photo-proof" className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Require before &amp; after photos
                </Label>
                {/* Olivewood, not shadcn's `text-muted-foreground` grey — the
                    app's own body voice, which is what dialogShell.test.ts's
                    grey-prose rule exists to hold the line on. */}
                <p className="text-ds-11 mt-1 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {requirePhotoProof
                    ? "Your Helpr can't mark this job done without them."
                    : "Your Helpr can finish without photos — good for deliveries, errands and dog walks."}
                </p>
              </div>
              <Switch
                id="edit-require-photo-proof"
                checked={requirePhotoProof}
                onCheckedChange={setRequirePhotoProof}
                disabled={hasHelper && !savedPhotoProof}
                aria-label="Require before and after photos"
              />
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
            disabled={saving || bookedNothingToSave}
          >
            {saving ? "Saving…" : "Save Changes"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
      <DialogContent role="alertdialog">
        <DialogHero
          title="Save These Changes?"
        />
        <DialogFooter>
          <DialogSecondaryAction>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={save}>Save Changes</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Discard-changes confirm — only rendered when the user has actually
        edited something and then tries to close (X, backdrop, Esc, or
        Cancel). A clean-slate close skips this and exits directly, so it
        never becomes a nag on a "peek and leave" open. */}
    <Dialog open={showDiscard} onOpenChange={setShowDiscard}>
      <DialogContent role="alertdialog">
        <DialogHero
          title="Discard Your Changes?"
        />
        <DialogFooter>
          <DialogSecondaryAction>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={confirmDiscard}>Discard Changes</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
