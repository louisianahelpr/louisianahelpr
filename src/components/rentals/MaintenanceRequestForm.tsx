/**
 * The tenant's maintenance request form (Q38: category, description, photos,
 * urgency, when someone may come in, pets on site, OK to enter without me,
 * private gate/lock notes). Q40: choosing "Emergency" first shows what to do
 * RIGHT NOW (911 / the utility); only after "I'm safe, tell my landlord" is
 * the request sent. The app never sends a Helpr on its own.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fileRequest } from "@/lib/rentals/api";
import { EMERGENCY_STEPS, MAINTENANCE_CATEGORIES, URGENCY_LABEL, rentalsErrorMessage, type Urgency } from "@/lib/rentals/copy";

// The private user-documents bucket takes JPEG/PNG/WebP/HEIC/PDF up to 10 MB
// (storage.buckets, measured on prod 2026-10-15): no video yet.
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function MaintenanceRequestForm({ tenancyId, uid, onFiled }: { tenancyId: string; uid: string; onFiled: () => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Urgency | "">("");
  const [accessWindows, setAccessWindows] = useState("");
  const [petsOnSite, setPetsOnSite] = useState(false);
  const [okToEnterAlone, setOkToEnterAlone] = useState(false);
  const [accessNotes, setAccessNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [emergencyAcknowledged, setEmergencyAcknowledged] = useState(false);

  const m = useMutation({
    mutationFn: () =>
      fileRequest(uid, {
        tenancyId,
        category,
        description,
        urgency: urgency as Urgency,
        accessWindows,
        petsOnSite,
        okToEnterAlone,
        accessNotes,
        photos,
      }),
    onSuccess: () => {
      toast.success(urgency === "emergency" ? "Your landlord was alerted." : "Request sent to your landlord.");
      setOpen(false);
      setDescription("");
      setPhotos([]);
      setEmergencyAcknowledged(false);
      onFiled();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Request a repair
      </Button>
    );
  }

  const showEmergencySteps = urgency === "emergency" && !emergencyAcknowledged;
  // The one native control left: a <select>, styled as the shared field (h-12, rounded-2xl, glass-field).
  const select = "flex h-12 w-full rounded-2xl border border-[hsl(var(--ink-deep)/0.15)] glass-field px-4 text-ds-15";

  return (
    <form
      className="space-y-3"
      aria-label="Repair request"
      onSubmit={(e) => {
        e.preventDefault();
        if (!category || !urgency) return toast.error("Choose what's wrong and how urgent it is.");
        if (showEmergencySteps) return;
        m.mutate();
      }}
    >
      <label className="block text-sm">
        <span className="block mb-1 font-medium">What's wrong?</span>
        <select className={select} value={category} onChange={(e) => setCategory(e.target.value)} required>
          <option value="">Choose one</option>
          {MAINTENANCE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium mb-1">How urgent?</legend>
        {(Object.keys(URGENCY_LABEL) as Urgency[]).map((u) => (
          <label key={u} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`urgency-${tenancyId}`}
              value={u}
              checked={urgency === u}
              onChange={() => {
                setUrgency(u);
                setEmergencyAcknowledged(false);
              }}
            />
            {URGENCY_LABEL[u]}
          </label>
        ))}
      </fieldset>

      {showEmergencySteps ? (
        <div role="alert" className="rounded-xl border-2 border-destructive p-3 space-y-2">
          <p className="font-semibold">Stay safe first</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {EMERGENCY_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <Button asChild size="sm" variant="destructive">
            <a href="tel:911">Call 911</a>
          </Button>
          <Button type="button" size="sm" variant="outline" className="block" onClick={() => setEmergencyAcknowledged(true)}>
            I'm safe. Tell my landlord now
          </Button>
        </div>
      ) : (
        <>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">Describe the problem</span>
            <Textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">Photos (up to 10)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                const tooBig = files.find((f) => f.size > MAX_PHOTO_BYTES);
                if (tooBig) toast.error(`${tooBig.name} is over 10 MB.`);
                setPhotos(files.filter((f) => f.size <= MAX_PHOTO_BYTES).slice(0, 10));
              }}
            />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">When may someone come in?</span>
            <Input maxLength={300} placeholder="e.g. weekdays after 5pm" value={accessWindows} onChange={(e) => setAccessWindows(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={petsOnSite} onCheckedChange={(v) => setPetsOnSite(v === true)} />
            Pets are at home
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={okToEnterAlone} onCheckedChange={(v) => setOkToEnterAlone(v === true)} />
            OK to enter without me
          </label>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">Gate or lock info (private)</span>
            <Input maxLength={500} value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} />
            <span className="block text-xs text-muted-foreground mt-1">Only your landlord and the booked Helpr see this.</span>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={m.isPending}>
              {m.isPending ? "Sending…" : "Send to my landlord"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
