import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { storageExtFor } from "@/lib/storageExt";
import { PROOF_PHOTO_TYPES, isAllowedUploadType, unsupportedUploadCopy } from "@/lib/uploadTypes";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { MISSED_LABEL_HELPR, MISSED_LABEL_POSTER, reportContinueDayMissed } from "@/lib/continueDayMissed";

const MAX_PHOTOS = 5;

/**
 * Owner decision #4 (11-08): the agreed continue day passed without "Mark done".
 *  - the poster's "Didn't come back": optional photos of what's left plus a note;
 *  - the Helpr's "Can't come back": a note.
 * Either one sends the job to Louisiana Helpr (report_continue_day_missed); nothing is paid or refunded until an admin
 * decides. Photos go to the poster's immutable evidence folder (proof-photos `<uid>/disputes/<job>/`, DisputeDialog's).
 */
export function MissedReturnSheet({
  open,
  onOpenChange,
  jobId,
  side,
  otherFirst,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  side: "poster" | "helpr";
  otherFirst: string | null;
  onSent: () => void;
}) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const poster = side === "poster";
  const other = (otherFirst ?? "").trim() || (poster ? "your Helpr" : "the person who posted it");

  const pick = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const bad = picked.find((f) => !isAllowedUploadType(f, PROOF_PHOTO_TYPES));
    if (bad) toast.error(unsupportedUploadCopy(bad, "a JPG, PNG, WebP or HEIC photo"));
    setFiles((prev) => [...prev, ...picked.filter((f) => isAllowedUploadType(f, PROOF_PHOTO_TYPES))].slice(0, MAX_PHOTOS));
  };

  const send = async () => {
    setBusy(true);
    try {
      const paths: string[] = [];
      if (poster && files.length > 0) {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw authError ?? new Error("Sign in again to send this.");
        for (const file of files) {
          const path = `${auth.user.id}/disputes/${jobId}/missed-${Date.now()}-${Math.random().toString(36).slice(2)}.${storageExtFor(file, "jpg")}`;
          const { error } = await supabase.storage.from("proof-photos").upload(path, file, { cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
          if (error) {
            report(error, { tags: { source: "MissedReturnSheet.upload" } });
            throw new Error("A photo didn't upload. Check your connection and try again.");
          }
          paths.push(path);
        }
      }
      await reportContinueDayMissed(jobId, note, paths);
      toast("Sent to Louisiana Helpr. We'll review the job and decide the payment.");
      onOpenChange(false);
      onSent();
    } catch (err) {
      toast.error(userFacingError(err, "Couldn't send that. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent side="bottom" data-missed-return-sheet={side}>
        <SheetHero title={poster ? MISSED_LABEL_POSTER : MISSED_LABEL_HELPR} />
        <p className="text-ds-13 text-muted-foreground">
          {`We'll tell ${other} and review the job. Nothing is paid or refunded until Louisiana Helpr decides.`}
        </p>
        <div className="mt-4 space-y-3">
          {poster && (
            <div className="space-y-2">
              <p className="text-ds-14 font-semibold">Photos of what's left (optional)</p>
              {files.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-ds-md border px-2 py-1 text-ds-12">
                      <span className="max-w-[10rem] truncate">{f.name}</span>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${f.name}`} disabled={busy} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {files.length < MAX_PHOTOS && (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" /> {files.length === 0 ? "Add photos" : "Add more"}
                </Button>
              )}
              <HiddenFileInput ref={input} accept="image/*" multiple aria-hidden="true" tabIndex={-1}
                onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-ds-14 font-semibold">Note{poster ? " (optional)" : ""}</span>
            <Textarea value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)}
              placeholder={poster ? "What's left to do" : "Why you can't come back"} />
          </label>
          <SheetFooter>
            <SheetPrimaryAction disabled={busy || (!poster && !note.trim())} onClick={() => void send()}>
              {busy ? "Sending…" : "Send to Louisiana Helpr"}
            </SheetPrimaryAction>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
