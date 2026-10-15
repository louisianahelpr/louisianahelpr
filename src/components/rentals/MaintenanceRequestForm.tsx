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
      <button type="button" className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold" onClick={() => setOpen(true)}>
        Request a repair
      </button>
    );
  }

  const showEmergencySteps = urgency === "emergency" && !emergencyAcknowledged;
  const input = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";

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
        <select className={input} value={category} onChange={(e) => setCategory(e.target.value)} required>
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
          <a href="tel:911" className="inline-block rounded-full border-2 border-destructive px-4 py-2 text-sm font-semibold">
            Call 911
          </a>
          <button type="button" className="block text-sm font-semibold underline" onClick={() => setEmergencyAcknowledged(true)}>
            I'm safe. Tell my landlord now
          </button>
        </div>
      ) : (
        <>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">Describe the problem</span>
            <textarea className={input} rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} />
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
            <input className={input} maxLength={300} placeholder="e.g. weekdays after 5pm" value={accessWindows} onChange={(e) => setAccessWindows(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={petsOnSite} onChange={(e) => setPetsOnSite(e.target.checked)} />
            Pets are at home
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={okToEnterAlone} onChange={(e) => setOkToEnterAlone(e.target.checked)} />
            OK to enter without me
          </label>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">Gate or lock info (private)</span>
            <input className={input} maxLength={500} value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} />
            <span className="block text-xs text-muted-foreground mt-1">Only your landlord and the booked Helpr see this.</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={m.isPending} className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold">
              {m.isPending ? "Sending…" : "Send to my landlord"}
            </button>
            <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}
